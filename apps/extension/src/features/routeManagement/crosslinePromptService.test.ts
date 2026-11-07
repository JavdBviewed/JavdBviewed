import { describe, expect, it, vi } from 'vitest';
import { createCrosslinePromptService, type CrosslinePromptDependencies } from './crosslinePromptService';
import type { CrosslinePageContext } from '../../shared/protocols/crosslineSession';
const ctx: CrosslinePageContext = { tabId: 1, documentId: 'doc', origin: 'https://javdb575.com', targetHost: 'javdb575.com', storeId: '0', incognito: false };
function fixture() {
  let now = 2_000_000;
  let enabled = true;
  const storage: Record<string, unknown> = {};
  const states: Record<string, 'authenticated' | 'anonymous' | 'unknown'> = { 'javdb.com': 'authenticated', 'javdb575.com': 'anonymous' };
  const signatures: Record<string, string> = { 'javdb.com': 'source-cookie', 'javdb575.com': 'anonymous-cookie' };
  let writes = 0;
  const deps: CrosslinePromptDependencies = {
    now: () => now, id: (() => { let i = 0; return () => `offer-${++i}`; })(),
    enabled: async () => enabled, hosts: async () => Object.keys(states), current: async () => true,
    snapshot: async (_ctx, host) => signatures[host] || '',
    verify: vi.fn(async (_ctx, host) => states[host] || 'unknown'),
    read: async (area, key) => storage[`${area}:${key}`],
    write: async (area, key, value) => { storage[`${area}:${key}`] = structuredClone(value); },
    copy: async (_ctx, _host, check) => { const early = await check(); if (early) return early; writes++; states[ctx.targetHost] = 'authenticated'; return 'authenticated'; },
  };
  return { deps, service: createCrosslinePromptService(deps), states, signatures, storage, writes: () => writes,
    advance: (ms: number) => { now += ms; }, disable: () => { enabled = false; } };
}
describe('crossline page operations', () => {
  it('discovers already stored login, but never returns cookie signatures', async () => {
    const f = fixture(); const result = await f.service.status(ctx);
    expect(result.sources).toEqual([{ host: 'javdb.com' }]);
    expect(result.offerId).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('source-cookie');
    expect(JSON.stringify(result)).not.toContain('anonymous-cookie');
  });
  it('does not offer anonymous or unknown sources, or an authenticated target', async () => {
    for (const state of ['anonymous', 'unknown'] as const) {
      const f = fixture(); f.states['javdb.com'] = state;
      expect((await f.service.status(ctx)).sources).toEqual([]);
    }
    const f = fixture(); f.states[ctx.targetHost] = 'authenticated';
    expect((await f.service.status(ctx)).offerId).toBeUndefined();
    expect(f.deps.verify).toHaveBeenCalledTimes(1);
  });
  it('arbitrates simultaneous tabs and persists a 24h dismissal through service recreation', async () => {
    const f = fixture(); const ctx2 = { ...ctx, tabId: 2, documentId: 'other' };
    const a = await f.service.status(ctx), b = await f.service.status(ctx2);
    expect(await Promise.all([f.service.claim(ctx, a.offerId || ''), f.service.claim(ctx2, b.offerId || '')])).toEqual([true, false]);
    await f.service.dismiss(ctx, a.offerId || '');
    const restarted = createCrosslinePromptService(f.deps);
    const again = await restarted.status(ctx);
    expect(await restarted.claim(ctx, again.offerId || '')).toBe(false);
    expect(again.sources).toHaveLength(1);
  });
  it('requires a fresh offer bound to the exact source, document and store', async () => {
    const f = fixture(); const s = await f.service.status(ctx); const id = s.offerId || '';
    expect(await f.service.copy({ ...ctx, documentId: 'navigated' }, id, 'javdb.com')).toBe('stale');
    expect(await f.service.copy({ ...ctx, storeId: '1' }, id, 'javdb.com')).toBe('stale');
    expect(await f.service.copy(ctx, id, 'evil.example')).toBe('stale');
    f.advance(60_001);
    expect(await f.service.copy(ctx, id, 'javdb.com')).toBe('stale');
    expect(f.writes()).toBe(0);
  });
  it('rejects source replacement and disabled operation, rechecks target login before copying', async () => {
    const f = fixture(); const s = await f.service.status(ctx);
    f.signatures['javdb.com'] = 'different-account';
    expect(await f.service.copy(ctx, s.offerId || '', 'javdb.com')).toBe('stale');
    expect(f.writes()).toBe(0);
    const g = fixture(); const t = await g.service.status(ctx); g.states[ctx.targetHost] = 'authenticated';
    expect(await g.service.copy(ctx, t.offerId || '', 'javdb.com')).toBe('already-authenticated');
    expect(g.writes()).toBe(0);
    const h = fixture(); const u = await h.service.status(ctx); h.disable();
    expect(await h.service.copy(ctx, u.offerId || '', 'javdb.com')).toBe('stale');
    expect(h.writes()).toBe(0);
  });
  it('copies only after revalidation, and cannot reuse the same offer', async () => {
    const f = fixture(); const s = await f.service.status(ctx);
    expect(await f.service.copy(ctx, s.offerId || '', 'javdb.com')).toBe('authenticated');
    expect(await f.service.copy(ctx, s.offerId || '', 'javdb.com')).toBe('stale');
    expect(f.writes()).toBe(1);
  });
  it('does not probe with disabled feature and skips sources without browser cookies', async () => {
    const f = fixture(); f.disable(); await f.service.status(ctx);
    expect(f.deps.verify).not.toHaveBeenCalled();
    const g = fixture(); g.signatures['javdb.com'] = '';
    expect((await g.service.status(ctx)).sources).toEqual([]);
    expect(g.deps.verify).toHaveBeenCalledTimes(1);
  });
  it('persists logout separately from dismissal and never grants automatic expansion', async () => {
    const f = fixture(); await f.service.logout(ctx);
    const state = JSON.stringify(f.storage);
    expect(state).toContain('logout');
    expect(state).not.toContain('source-cookie');
    const s = await f.service.status(ctx);
    expect(await f.service.claim(ctx, s.offerId || '')).toBe(false);
  });
});

it('persists a validated logout intent even if its document has just navigated', async () => {
  const f = fixture(); f.deps.current = async () => false;
  await f.service.logout(ctx);
  expect(JSON.stringify(f.storage)).toContain('logout');
});

it('does not overwrite a target that changes while the source is being revalidated', async () => {
  const f = fixture(); const s = await f.service.status(ctx);
  f.deps.verify = async (_ctx, host) => {
    if (host === 'javdb.com') f.signatures[ctx.targetHost] = 'newly-logged-in';
    return f.states[host];
  };
  expect(await f.service.copy(ctx, s.offerId || '', 'javdb.com')).toBe('stale');
  expect(f.writes()).toBe(0);
});
it('invalidates both cached evidence and offers when route settings change', async () => {
  const f = fixture(); const first = await f.service.status(ctx);
  f.service.invalidate();
  expect(await f.service.copy(ctx, first.offerId || '', 'javdb.com')).toBe('stale');
  f.states['javdb.com'] = 'anonymous';
  expect((await f.service.status(ctx)).sources).toEqual([]);
});
it('drops a response that began before settings invalidation', async () => {
  const f = fixture();
  f.deps.verify = async (_ctx, host) => { f.service.invalidate(); return f.states[host]; };
  expect((await f.service.status(ctx)).sources).toEqual([]);
});
