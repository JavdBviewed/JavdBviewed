import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isCrosslinePageCurrent, verifyCrosslineAccount } from './crosslinePromptBrowser';
import { isCrosslineProbeActive, withCrosslineProbeGuard } from './crosslineSessionGuards';
import { CROSSLINE_SESSION_KEY, CROSSLINE_SUPPRESSION_KEY } from './crosslinePromptPolicy';
import { shouldSyncStorageItemKey } from '../cloudSync/storageItemPolicy';
import type { CrosslinePageContext } from '../../shared/protocols/crosslineSession';
const ctx: CrosslinePageContext = { tabId: 7, documentId: 'document', origin: 'https://javdb575.com', targetHost: 'javdb575.com', storeId: '1', incognito: true };
const member = '<a href="/users/profile">Profile</a><a href="/logout">Logout</a>';
const execute = vi.fn(), query = vi.fn(), get = vi.fn(), fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([{ result: { html: member, url: `${ctx.origin}/users/profile`, origin: ctx.origin, status: 200 } }]);
  query.mockResolvedValue([{ id: 7, url: ctx.origin, incognito: true }]);
  get.mockResolvedValue({ id: 7, url: ctx.origin, incognito: true });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', { runtime: {}, declarativeNetRequest: { updateSessionRules: vi.fn().mockResolvedValue(undefined) }, cookies: { getAllCookieStores: (callback: (stores: unknown[]) => void) => callback([
    { id: '0', tabIds: [8] }, { id: '1', tabIds: [7] },
  ]) }, tabs: { query, get }, scripting: { executeScript: execute } });
});
afterEach(() => vi.unstubAllGlobals());
it('verifies incognito only in its own store, without normal-worker fetch', async () => {
  expect(await verifyCrosslineAccount(ctx, ctx.targetHost)).toBe('authenticated');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7, frameIds: [0] }, world: 'ISOLATED' }));
});
it('does not borrow a normal tab to verify incognito cookies', async () => {
  query.mockResolvedValue([{ id: 8, url: ctx.origin, incognito: false }]);
  expect(await verifyCrosslineAccount(ctx, ctx.targetHost)).toBe('unknown');
  expect(execute).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
it('falls back to a same-origin first-party tab only when background verification is unknown', async () => {
  const normal = { ...ctx, tabId: 8, storeId: '0', incognito: false };
  fetchMock.mockRejectedValue(new TypeError('network failure'));
  query.mockResolvedValue([{ id: 8, url: ctx.origin, incognito: false }]);
  expect(await verifyCrosslineAccount(normal, ctx.targetHost)).toBe('authenticated');
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
});
it('rejects probe results from a navigated tab', async () => {
  execute.mockResolvedValue([{ result: { html: member, url: 'https://other.invalid/users/profile', origin: 'https://other.invalid', status: 200 } }]);
  expect(await verifyCrosslineAccount(ctx, ctx.targetHost)).toBe('unknown');
});
it('checks both cookie store membership and exact document identity', async () => {
  execute.mockResolvedValue([{ result: ctx.origin }]);
  expect(await isCrosslinePageCurrent(ctx)).toBe(true);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7, documentIds: ['document'] } }));
  expect(await isCrosslinePageCurrent({ ...ctx, storeId: '0' })).toBe(false);
  execute.mockRejectedValue(new Error('document removed'));
  expect(await isCrosslinePageCurrent(ctx)).toBe(false);
});
it('keeps nested probes guarded and releases the guard on error', async () => {
  await expect(withCrosslineProbeGuard([ctx.targetHost], '1', async () => {
    expect(isCrosslineProbeActive(ctx.targetHost, '1')).toBe(true);
    expect(isCrosslineProbeActive(ctx.targetHost, '0')).toBe(false);
    await withCrosslineProbeGuard([ctx.targetHost], '1', async () => undefined);
    expect(isCrosslineProbeActive(ctx.targetHost, '1')).toBe(true);
    throw new Error('test failure');
  })).rejects.toThrow('test failure');
  expect(isCrosslineProbeActive(ctx.targetHost, '1')).toBe(false);
});
it('keeps browser-local prompt suppression and session bookkeeping out of Cloud storage items', () => {
  expect(shouldSyncStorageItemKey(CROSSLINE_SESSION_KEY)).toBe(false);
  expect(shouldSyncStorageItemKey(CROSSLINE_SUPPRESSION_KEY)).toBe(false);
});
it('resolves an opaque HTTP login redirect only through the fixed protected login URL', async () => {
  const normal = { ...ctx, tabId: 8, storeId: '0', incognito: false };
  fetchMock.mockResolvedValueOnce({ type: 'opaqueredirect', ok: false, status: 0, url: '', text: async () => '' })
    .mockImplementationOnce(async (url: string) => ({ type: 'basic', ok: true, status: 200, url, text: async () => '<a href="/login">Login</a>' }));
  expect(await verifyCrosslineAccount(normal, ctx.targetHost)).toBe('anonymous');
  expect(fetchMock.mock.calls[1][0]).toMatch(/^https:\/\/javdb575\.com\/login\?__javdb_session_probe=/);
  expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  expect(execute).not.toHaveBeenCalled();
});
