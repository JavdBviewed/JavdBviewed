/**
 * @file extensionEntityStore.test.ts
 * @description applyRemote 远端回写必须跳过 cloud pending 入队（防拉取回声重推）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  viewedBulkPut: vi.fn(async () => undefined),
  actorsBulkPut: vi.fn(async () => undefined),
  listsBulkPut: vi.fn(async () => undefined),
  newWorksBulkPut: vi.fn(async () => undefined),
  viewedGet: vi.fn(async () => undefined),
  actorsGet: vi.fn(async () => undefined),
  listsGet: vi.fn(async () => undefined),
  newWorksGet: vi.fn(async () => undefined),
  listsDelete: vi.fn(async () => undefined),
  newWorksDelete: vi.fn(async () => undefined),
  initDB: vi.fn(async () => {
    throw new Error('initDB should not be called by applyRemote for bulk entity types');
  }),
}));

vi.mock('../../platform/storage/indexedDb', () => spies);

describe('createExtensionEntityStore().applyRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies pulled entities without re-enqueueing them into the cloud pending queue', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      { type: 'video', id: 'ABP-100', payload: { code: 'ABP-100' }, updatedAt: 1 },
      { type: 'actor', id: 'actor-1', payload: { name: 'A' }, updatedAt: 1 },
      { type: 'list', id: 'list-1', payload: { title: 'L' }, updatedAt: 1 },
      { type: 'new_work', id: 'nw-1', payload: { title: 'W' }, updatedAt: 1 },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.viewedBulkPut).toHaveBeenCalledWith(
      [{ code: 'ABP-100', id: 'ABP-100' }],
      { skipCloudEnqueue: true },
    );
    expect(spies.actorsBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.actorsBulkPut).toHaveBeenCalledWith(
      [{ name: 'A', id: 'actor-1' }],
      { skipCloudEnqueue: true },
    );
    expect(spies.listsBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.listsBulkPut).toHaveBeenCalledWith(
      [{ title: 'L', id: 'list-1' }],
      { skipCloudEnqueue: true },
    );
    expect(spies.newWorksBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.newWorksBulkPut).toHaveBeenCalledWith(
      [{ title: 'W', id: 'nw-1' }],
      { skipCloudEnqueue: true },
    );
  });

  it('applies remote tombstones (deletedAt) without enqueuing either', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      { type: 'video', id: 'ABP-200', payload: { code: 'ABP-200' }, updatedAt: 1, deletedAt: 2 },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.viewedBulkPut).toHaveBeenCalledWith(
      [{ code: 'ABP-200', id: 'ABP-200', deletedAt: 2 }],
      { skipCloudEnqueue: true },
    );
  });

  it('soft-writes-back list tombstones, hard-deletes new_work tombstones (10-25: list 对齐 viewed/actor 软删)', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      { type: 'list', id: 'list-del-1', payload: { title: 'L' }, updatedAt: 1, deletedAt: 2 },
      { type: 'new_work', id: 'nw-del-1', payload: { title: 'W' }, updatedAt: 1, deletedAt: 2 },
    ]);

    // list：远端墓碑软写回（保留墓碑实体），listsDelete 零调用
    expect(spies.listsBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.listsBulkPut).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'list-del-1', title: 'L', deletedAt: 2 })],
      { skipCloudEnqueue: true },
    );
    expect(spies.listsDelete).not.toHaveBeenCalled();
    // new_work：本地硬删除语义不变
    expect(spies.newWorksBulkPut).not.toHaveBeenCalled();
    expect(spies.newWorksDelete).toHaveBeenCalledWith('nw-del-1');
  });
});

describe('collectLocalSyncEntities tombstone envelope (C1-1)', () => {
  it('promotes soft-deleted viewed/actor/list records to entity.deletedAt; live records stay clean', async () => {
    const fakeDb = {
      getAll: vi.fn(async (store: string) => {
        if (store === 'viewedRecords') {
          return [
            { id: 'V1', title: 't1', status: 'viewed', createdAt: 1, updatedAt: 10, deletedAt: 111 },
            { id: 'V2', title: 't2', status: 'viewed', createdAt: 2, updatedAt: 12 },
          ];
        }
        if (store === 'actors') return [{ id: 'A1', name: 'n', updatedAt: 20, deletedAt: 222 }];
        if (store === 'lists') return [{ id: 'L1', title: 'l', updatedAt: 30, deletedAt: 333 }];
        if (store === 'newWorks') return [{ id: 'W1', discoveredAt: 40 }];
        return [];
      }),
    };
    vi.mocked(spies.initDB).mockResolvedValue(fakeDb as any);
    const { collectLocalSyncEntities } = await import('./extensionEntityStore');
    const entities = await collectLocalSyncEntities();
    const byKey = (t: string, id: string) => entities.find((e) => e.type === t && e.id === id);

    expect(byKey('video', 'V1')?.deletedAt).toBe(111);
    expect(byKey('video', 'V2')?.deletedAt).toBeUndefined();
    expect(byKey('actor', 'A1')?.deletedAt).toBe(222);
    expect(byKey('list', 'L1')?.deletedAt).toBe(333);
    // new_work：NewWorkRecord 无 deletedAt 字段（物理删不产墓碑，登记不修）
    expect(byKey('new_work', 'W1')?.deletedAt).toBeUndefined();
  });
  it('new_work 带 sourceType=cloud-scan：spread 透传进 newWorksBulkPut，且不触发清单/演员入库（A.4 零自动入库锁）', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      { type: 'new_work', id: 'nw-c1', payload: { title: 'W', sourceType: 'cloud-scan' }, updatedAt: 1 },
    ]);

    expect(spies.newWorksBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.newWorksBulkPut).toHaveBeenCalledWith(
      [{ title: 'W', sourceType: 'cloud-scan', id: 'nw-c1' }],
      { skipCloudEnqueue: true },
    );
    expect(spies.listsBulkPut).not.toHaveBeenCalled();
    expect(spies.actorsBulkPut).not.toHaveBeenCalled();
  });
});


describe('countLocalSyncEntities（10-24 风险 A 轻量计数）', () => {
  let storedValues: Record<string, unknown>;
  let storageGet: ReturnType<typeof vi.fn>;
  let storageGetKeys: ReturnType<typeof vi.fn>;
  let countFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storedValues = {
      new_works_subscriptions: { sub1: { enabled: true }, sub2: { enabled: false } },
      user_profile: { name: 'u' },
      adv_search_presets: [{ id: 'p1' }, { id: 'p2' }],
    };
    countFn = vi.fn(async (store: string) => {
      const table: Record<string, number> = {
        viewedRecords: 40,
        actors: 3,
        lists: 2,
        newWorks: 1,
        magnets: 0,
        insightsViews: 1,
        insightsReports: 0,
        newWorksDailyStats: 1,
      };
      return table[store] ?? 0;
    });
    spies.initDB.mockResolvedValue({ count: countFn } as any);
    storageGet = vi.fn((keys: string | string[], cb: (items: Record<string, unknown>) => void) => {
      queueMicrotask(() => {
        const out: Record<string, unknown> = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) {
          if (Object.prototype.hasOwnProperty.call(storedValues, k)) out[k] = storedValues[k];
        }
        cb(out);
      });
    });
    storageGetKeys = vi.fn((cb: (keys: string[]) => void) => {
      queueMicrotask(() => cb(['settings', 'emby_library_state', 'cloud_sync_session_v1', 'unknown_cache']));
    });
    vi.stubGlobal('chrome', { storage: { local: { get: storageGet, getKeys: storageGetKeys } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('IDB 走 count() 零记录体传输，storage_item 按 getKeys+策略过滤计数，不读值', async () => {
    const { countLocalSyncEntities } = await import('./extensionEntityStore');
    const result = await countLocalSyncEntities();

    expect(result.byType).toEqual({
      video: 40,
      actor: 3,
      list: 2,
      new_work: 1,
      insights_view: 1,
      new_work_daily_stat: 1,
      new_work_subscription: 2,
      user_profile: 1,
      search_preset: 2,
      // settings + emby_library_state 通过 shouldSyncStorageItemKey；session 键与未知键被过滤
      storage_item: 2,
    });
    expect(result.total).toBe(55);
    // 零记录体传输：IDB 只调 count，从不 getAll
    expect(countFn).toHaveBeenCalledTimes(8);
    expect(storageGetKeys).toHaveBeenCalledTimes(1);
  });
});
