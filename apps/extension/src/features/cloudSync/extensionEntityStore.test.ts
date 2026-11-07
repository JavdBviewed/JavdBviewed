/**
 * @file extensionEntityStore.test.ts
 * @description applyRemote 远端回写必须跳过 cloud pending 入队（防拉取回声重推）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncEntity, SyncSessionResponse } from '@javdb/sync-protocol';

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

describe('storage_item 未知键兼容', () => {
  // 与未来产品键名无关，保证后续支持新索引时仍覆盖旧客户端的未知键行为。
  const UNKNOWN_KEY = 'compat_fixture_unknown_storage_key';
  const unknownEntity = (deletedAt?: number): SyncEntity => ({
    type: 'storage_item',
    id: UNKNOWN_KEY,
    revision: 9,
    updatedAt: 9,
    ...(deletedAt === undefined ? {} : { deletedAt }),
    payload: { key: UNKNOWN_KEY, value: { entries: [{ code: 'ABC-001' }] } },
  });
  let storageValues: Record<string, unknown>;
  let storageSet: ReturnType<typeof vi.fn>;
  let storageRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storageValues = {
      unrelated_local_value: { preserved: true },
      cloud_sync_pending_v1: [],
      cloud_sync_pending_delta_v1: {},
    };
    storageSet = vi.fn((values: Record<string, unknown>, callback?: () => void) => {
      Object.assign(storageValues, structuredClone(values));
      queueMicrotask(() => callback?.());
    });
    storageRemove = vi.fn((keys: string | string[], callback?: () => void) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete storageValues[key];
      queueMicrotask(() => callback?.());
    });
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((keys: string | string[], callback: (values: Record<string, unknown>) => void) => {
            const result: Record<string, unknown> = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              if (Object.prototype.hasOwnProperty.call(storageValues, key)) {
                result[key] = structuredClone(storageValues[key]);
              }
            }
            queueMicrotask(() => callback(result));
          }),
          set: storageSet,
          remove: storageRemove,
        },
      },
      runtime: { lastError: undefined },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('忽略未知 storage_item 普通值，不写入本机存储或 pending', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const before = structuredClone(storageValues);

    await createExtensionEntityStore().applyRemote([unknownEntity()]);

    expect(storageValues).toEqual(before);
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(spies.initDB).not.toHaveBeenCalled();
  });

  it('忽略未知 storage_item 墓碑，保留同名本机键且不写 pending', async () => {
    storageValues[UNKNOWN_KEY] = { entries: [{ code: 'ABC-002' }] };
    const before = structuredClone(storageValues);
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    // 墓碑可以只带实体 id，没有 payload.key，仍须经过未知键过滤。
    const tombstone = { ...unknownEntity(10), payload: {} };

    await createExtensionEntityStore().applyRemote([tombstone]);

    expect(storageValues).toEqual(before);
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(spies.initDB).not.toHaveBeenCalled();
  });

  it('未知键与已知 storage_item、video 混批时不阻断已知实体', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const { shouldSuppressCloudStorageChange } = await import('./storageChangeGate');
    const index = { entries: [], updatedAt: 8 };
    const before = structuredClone(storageValues);

    await createExtensionEntityStore().applyRemote([
      unknownEntity(),
      {
        type: 'storage_item', id: 'emby_library_state', revision: 8, updatedAt: 8,
        payload: { key: 'emby_library_state', value: index },
      },
      { type: 'video', id: 'ABC-003', revision: 8, updatedAt: 8, payload: { code: 'ABC-003', status: 'viewed' } },
      { ...unknownEntity(10), payload: {} },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.viewedBulkPut).toHaveBeenCalledWith(
      [{ code: 'ABC-003', status: 'viewed', id: 'ABC-003' }],
      { skipCloudEnqueue: true },
    );
    expect(storageValues).toEqual({ ...before, emby_library_state: index });
    expect(storageSet).toHaveBeenCalledTimes(1);
    expect(storageSet).toHaveBeenCalledWith({ emby_library_state: index }, expect.any(Function));
    expect(storageRemove).not.toHaveBeenCalled();
    expect(shouldSuppressCloudStorageChange('emby_library_state', { newValue: index })).toBe(true);
  });

  it('真实 adapter 和同步引擎忽略未知键后持久化游标，下一次请求携带新游标', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const { createChromeCursorStore, CLOUD_CURSORS_STORAGE_KEY } = await import('./chromeCursorStore');
    const { createApiClient, createMemoryTokenStore, createSyncEngine, PROTOCOL_VERSION } = await import('@javdb/sync-client');
    const initialCursors = { storage_item: 3, video: 5 };
    const serverCursors = { storage_item: 41, video: 5 };
    storageValues[CLOUD_CURSORS_STORAGE_KEY] = initialCursors;
    const before = structuredClone(storageValues);
    const response: SyncSessionResponse = {
      protocolVersion: PROTOCOL_VERSION,
      apply: [unknownEntity()],
      results: [],
      stats: { uploaded: 0, downloaded: 1, merged: 0, rejected: 0, byType: { storage_item: 1 } },
      code: 'SYNC_OK',
      message: 'ok',
      cursors: serverCursors,
      hasMore: false,
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...response, apply: [], code: 'SYNC_EMPTY',
        stats: { ...response.stats, downloaded: 0, byType: {} },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({
      baseUrl: 'https://cloud.example.test',
      tokens: createMemoryTokenStore({ accessToken: 'fixture-access-token' }),
    });
    const engine = createSyncEngine({ api, local: createExtensionEntityStore(), cursors: createChromeCursorStore() });

    const first = await engine.syncSession('fixture-device');

    expect(first.pulled).toBe(1);
    expect(first.cursors).toEqual(serverCursors);
    expect(storageValues).toEqual({ ...before, [CLOUD_CURSORS_STORAGE_KEY]: serverCursors });
    expect(storageSet).toHaveBeenCalledTimes(1);
    expect(storageSet).toHaveBeenCalledWith({ [CLOUD_CURSORS_STORAGE_KEY]: serverCursors }, expect.any(Function));
    expect(await createChromeCursorStore().get()).toEqual(serverCursors);

    // 重建引擎和游标 store，验证持久化结果被下一轮读取，并非留在旧实例内存。
    const next = createSyncEngine({ api, local: createExtensionEntityStore(), cursors: createChromeCursorStore() });
    const second = await next.syncSession('fixture-device');

    expect(second.pulled).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) }))).toEqual([
      { url: 'https://cloud.example.test/v1/sync/session', body: { protocolVersion: PROTOCOL_VERSION, deviceId: 'fixture-device', cursors: initialCursors, changes: [] } },
      { url: 'https://cloud.example.test/v1/sync/session', body: { protocolVersion: PROTOCOL_VERSION, deviceId: 'fixture-device', cursors: serverCursors, changes: [] } },
    ]);
    expect(storageValues).toEqual({ ...before, [CLOUD_CURSORS_STORAGE_KEY]: serverCursors });
    expect(storageRemove).not.toHaveBeenCalled();
    expect(spies.initDB).not.toHaveBeenCalled();
  });
});
