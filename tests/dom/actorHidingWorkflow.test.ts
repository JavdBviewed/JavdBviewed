/**
 * @file actorHidingWorkflow.test.ts
 * @description actor hiding workflow 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyActorBasedHiding,
} from '../../apps/extension/src/features/listEnhancement/application/actorHidingWorkflow';
import type { ActorRecord } from '../../apps/extension/src/types';

function createActor(id: string, name: string, overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    id,
    name,
    aliases: [],
    gender: 'female',
    category: 'unknown',
    profileUrl: `https://javdb.com/actors/${id}`,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createItem(actorIds: string[]): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = actorIds.map(id => `<a href="/actors/${id}">${id}</a>`).join('');
  document.body.appendChild(item);
  return item;
}

describe('actor hiding workflow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('clears actor hiding when all actor filters are disabled', async () => {
    const item = createItem(['actor-a']);
    const clearActorOnlyHiding = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-001', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: false,
      hideByNonFavorited: false,
      hideUnrecognized: false,
      ensureActorIndex: vi.fn(),
      getActorById: vi.fn(),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding,
      logger: vi.fn(),
    });

    expect(clearActorOnlyHiding).toHaveBeenCalledWith(item);
  });

  it('does not early-clear and hides as ACTOR_UNRECOGNIZED when only hideUnrecognized is on', async () => {
    const item = createItem([]);
    const hideItemByActor = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-010', title: 'Unrecognized', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: false,
      hideByNonFavorited: false,
      hideUnrecognized: true,
      ensureActorIndex: vi.fn(async () => new Map([['someone', createActor('a', 'Someone')]])),
      getActorById: vi.fn(),
      hideItemByActor,
      clearActorOnlyHiding: vi.fn(),
      logger: vi.fn(),
    });

    expect(hideItemByActor).toHaveBeenCalledWith(item, 'ACTOR_UNRECOGNIZED');
  });

  it('does not hide via unrecognized when the actor index is empty (protective valve)', async () => {
    const item = createItem([]);
    const clearActorOnlyHiding = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-011', title: 'Unrecognized', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: false,
      hideByNonFavorited: false,
      hideUnrecognized: true,
      ensureActorIndex: vi.fn(async () => new Map()),
      getActorById: vi.fn(),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding,
      logger: vi.fn(),
    });

    expect(clearActorOnlyHiding).toHaveBeenCalledWith(item);
  });

  it('hides a list item when a DOM actor is blacklisted', async () => {
    const item = createItem(['actor-black']);
    const blacklisted = createActor('actor-black', 'Blocked Actor', { blacklisted: true });
    const hideItemByActor = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-002', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: true,
      hideByNonFavorited: true,
      hideUnrecognized: true,
      ensureActorIndex: vi.fn(async () => new Map()),
      getActorById: vi.fn(async () => blacklisted),
      hideItemByActor,
      clearActorOnlyHiding: vi.fn(),
      logger: vi.fn(),
    });

    expect(hideItemByActor).toHaveBeenCalledWith(item, 'ACTOR_BLACKLIST');
  });

  it('falls back to title matching when no DOM actor links exist', async () => {
    const item = createItem([]);
    const actor = createActor('actor-miho', 'Miho Nana');
    const clearActorOnlyHiding = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-003', title: 'Great Movie Miho Nana', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: true,
      hideByNonFavorited: true,
      hideUnrecognized: true,
      ensureActorIndex: vi.fn(async () => new Map([['miho nana', actor]])),
      getActorById: vi.fn(),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding,
      logger: vi.fn(),
    });

    expect(clearActorOnlyHiding).toHaveBeenCalledWith(item);
  });

  it('第 4 旗单独开时不再短路，并按 ACTOR_SUBSCRIBED 隐藏（09-30-popup-actorfilter-subscribed）', async () => {
    const item = createItem(['actor-sub']);
    const hideItemByActor = vi.fn();
    const clearActorOnlyHiding = vi.fn();
    const getSubscribedActorIds = vi.fn(async () => new Set(['actor-sub']));

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-020', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: false,
      hideByNonFavorited: false,
      hideUnrecognized: false,
      hideBySubscribed: true,
      getSubscribedActorIds,
      ensureActorIndex: vi.fn(async () => new Map()),
      getActorById: vi.fn(async () => null),
      hideItemByActor,
      clearActorOnlyHiding,
      logger: vi.fn(),
    });

    expect(getSubscribedActorIds).toHaveBeenCalledTimes(1);
    expect(clearActorOnlyHiding).not.toHaveBeenCalled();
    expect(hideItemByActor).toHaveBeenCalledWith(item, 'ACTOR_SUBSCRIBED');
  });

  it('四旗全关 → 短路清理且完全不读订阅数据（零成本锁）', async () => {
    const item = createItem(['actor-a']);
    const clearActorOnlyHiding = vi.fn();
    const getSubscribedActorIds = vi.fn(async () => new Set(['actor-a']));

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-021', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: false,
      hideByNonFavorited: false,
      hideUnrecognized: false,
      getSubscribedActorIds,
      ensureActorIndex: vi.fn(),
      getActorById: vi.fn(),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding,
      logger: vi.fn(),
    });

    expect(clearActorOnlyHiding).toHaveBeenCalledWith(item);
    expect(getSubscribedActorIds).not.toHaveBeenCalled();
  });

  it('订阅旗标关但其它旗标开 → 不调用订阅来源（存量路径零额外 storage 读）', async () => {
    const item = createItem(['actor-a']);
    const getSubscribedActorIds = vi.fn(async () => new Set(['actor-a']));

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-022', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: true,
      hideByNonFavorited: true,
      hideUnrecognized: true,
      getSubscribedActorIds,
      ensureActorIndex: vi.fn(async () => new Map()),
      getActorById: vi.fn(async () => null),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding: vi.fn(),
      logger: vi.fn(),
    });

    expect(getSubscribedActorIds).not.toHaveBeenCalled();
  });

  it('订阅集合未命中 → 不隐藏并清理（不误隐）', async () => {
    const item = createItem(['actor-a']);
    const clearActorOnlyHiding = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-023', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: false,
      hideByNonFavorited: false,
      hideUnrecognized: false,
      hideBySubscribed: true,
      getSubscribedActorIds: async () => new Set(['someone-else']),
      ensureActorIndex: vi.fn(async () => new Map()),
      getActorById: vi.fn(async () => null),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding,
      logger: vi.fn(),
    });

    expect(clearActorOnlyHiding).toHaveBeenCalledWith(item);
  });

  it('订阅来源抛错 → 按空集合处理，不隐藏（零命中零误隐）', async () => {
    const item = createItem(['actor-a']);
    const logger = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-024', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: false,
      hideByNonFavorited: false,
      hideUnrecognized: false,
      hideBySubscribed: true,
      getSubscribedActorIds: async () => { throw new Error('storage unavailable'); },
      ensureActorIndex: vi.fn(async () => new Map()),
      getActorById: vi.fn(async () => null),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding: vi.fn(),
      logger,
    });

    expect(logger).toHaveBeenCalled();
  });

  it('does not emit per-item diagnostic logs for a normal hiding decision', async () => {
    const item = createItem(['actor-normal']);
    const actor = createActor('actor-normal', 'Normal Actor');
    const logger = vi.fn();

    await applyActorBasedHiding({
      item,
      videoInfo: { code: 'ABC-004', title: 'Sample', url: 'https://javdb.com/v/abc' },
      hideByBlacklist: true,
      hideByNonFavorited: true,
      hideUnrecognized: true,
      ensureActorIndex: vi.fn(async () => new Map()),
      getActorById: vi.fn(async () => actor),
      hideItemByActor: vi.fn(),
      clearActorOnlyHiding: vi.fn(),
      logger,
    });

    expect(logger).not.toHaveBeenCalled();
  });
});
