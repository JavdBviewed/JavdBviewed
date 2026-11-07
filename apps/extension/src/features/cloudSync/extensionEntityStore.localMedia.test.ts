import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncEntity, SyncSessionRequest, SyncSessionResponse } from '@javdb/sync-protocol';
import { collectLocalSyncEntities, createExtensionEntityStore, preparePushQueueStats } from './extensionEntityStore';
import { enqueueStorageItemChange, enqueueStorageItemDeletion, enqueueSyncEntities } from './enqueueLocalChange';
import { registerCloudSyncStorageListener } from './backgroundCloudSync';
import { runCloudSyncNow } from './runCloudSyncNow';
import { filterOutgoingSyncEntities } from './storageItemPolicy';

const mocks = vi.hoisted(() => ({ session: vi.fn(), kinds: vi.fn() }));
vi.mock('./createExtensionCloudClient', () => ({ createExtensionCloudClient: async () => ({ api: { session: mocks.session } }) }));
vi.mock('./indexReportOutbox', () => ({
  flushIndexReportOutbox: async () => ({ supported: true, failed: 0 }),
  getIndexReportKinds: mocks.kinds,
}));
vi.mock('../../platform/storage/indexedDb', () => ({
  initDB: async () => ({ getAll: async () => [], count: async () => 0 }),
}));

const KEY = 'local_media_library_state';
const DONE = 'cloud_local_media_index_migration_v1';
const CURSORS = 'cloud_sync_cursors_v1';
const pending: SyncEntity = { type: 'storage_item', id: 'settings', updatedAt: 2, payload: { key: 'settings', value: {} } };
const file = (producerId = 'device-a', sourceId = 'source-a', relativePath = 'ABC-123.mp4') => ({
  serverType: 'local', serverName: 'Movies', relativePath, fileName: relativePath.split('/').pop(),
  code: 'ABC-123', size: 42, mtime: 10, updatedAt: 20,
  producerId, sourceId, key: JSON.stringify([producerId, sourceId, relativePath]),
});
const index = (entries = [file()]) => ({ version: 1, updatedAt: 20, entries });
const remote = (value: unknown = index()): SyncEntity => ({ type: 'storage_item', id: KEY, updatedAt: 20, payload: { key: KEY, value } });
const response = (apply: SyncEntity[] = []): SyncSessionResponse => ({
  protocolVersion: 1, apply, results: [],
  stats: { uploaded: 0, downloaded: apply.length, merged: 0, rejected: 0, byType: {} },
  code: 'SYNC_OK', message: '同步完成', cursors: { storage_item: 100, video: 41 },
});
let storage: Record<string, unknown>;
let writes: Array<Record<string, unknown>>;
let failKey: string | undefined;
let storageChanged: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kinds.mockResolvedValue([]);
  mocks.session.mockResolvedValue(response());
  failKey = undefined;
  storageChanged = undefined;
  writes = [];
  storage = {
    cloud_sync_session_v1: { accessToken: 'a', refreshToken: 'r', userId: 'u', deviceId: 'd' },
    cloud_sync_settings_v1: { baseUrl: 'https://cloud.test', accountIdentifier: 'u', deviceId: 'd' },
    [CURSORS]: { storage_item: 80, video: 41 },
    cloud_sync_pending_v1: [structuredClone(pending)],
    cloud_sync_entities_v1: { untouched: true },
  };
  const runtime: { lastError?: { message: string } } = {};
  vi.stubGlobal('chrome', { runtime, storage: { local: {
    get(keys: string[] | string | null, callback?: (data: Record<string, unknown>) => void) {
      const selected = keys === null ? storage : Object.fromEntries((Array.isArray(keys) ? keys : [keys])
        .filter((key) => key in storage).map((key) => [key, storage[key]]));
      const result = structuredClone(selected);
      callback?.(result);
      return Promise.resolve(result);
    },
    getKeys: async () => Object.keys(storage),
    set(values: Record<string, unknown>, callback?: () => void) {
      writes.push(structuredClone(values));
      if (failKey && Object.hasOwn(values, failKey)) {
        if (!callback) return Promise.reject(new Error('storage failed'));
        runtime.lastError = { message: 'storage failed' };
        callback();
        delete runtime.lastError;
        return Promise.resolve();
      }
      Object.assign(storage, structuredClone(values));
      callback?.();
      return Promise.resolve();
    },
    remove(keys: string | string[], callback?: () => void) {
      if (failKey && (Array.isArray(keys) ? keys : [keys]).includes(failKey)) {
        if (!callback) return Promise.reject(new Error('storage failed'));
        runtime.lastError = { message: 'storage failed' };
        callback();
        delete runtime.lastError;
        return Promise.resolve();
      }
      for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
      callback?.();
      return Promise.resolve();
    },
  }, onChanged: { addListener: (listener: typeof storageChanged) => { storageChanged = listener; } } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('local media receive-only consumption', () => {
  it('applies the complete file array without merging equal codes across files, sources or devices', async () => {
    const value = index([file(), file('device-a', 'source-a', 'extra/ABC-123.mkv'), file('device-a', 'source-b'), file('device-b')]);
    await createExtensionEntityStore().applyRemote([remote(value)]);
    expect(storage[KEY]).toEqual(value);
    expect(storage[DONE]).toBe(true);
    expect(storage.cloud_sync_pending_v1).toEqual([pending]);
    expect(storage.cloud_sync_pending_delta_v1).toBeUndefined();
  });

  it('replaces the snapshot after retirement and clears membership on an inbound tombstone', async () => {
    const store = createExtensionEntityStore();
    await store.applyRemote([remote(index([file(), file('device-b')]))]);
    await store.applyRemote([remote(index([file('device-b')]))]);
    expect(storage[KEY]).toEqual(index([file('device-b')]));
    await store.applyRemote([{ ...remote(), deletedAt: 30 }]);
    expect(storage[KEY]).toBeUndefined();
    expect(storage[DONE]).toBe(true);
  });

  it.each([null, {}, { version: 2, updatedAt: 20, entries: [] }, { version: 1, updatedAt: 20, entries: {} }, index([{ ...file(), key: 'wrong-owner' }])])
    ('rejects invalid index %j without recording migration completion', async (value) => {
      await expect(createExtensionEntityStore().applyRemote([remote(value)])).rejects.toThrow();
      expect(storage[KEY]).toBeUndefined();
      expect(storage[DONE]).toBeUndefined();
    });

  it('does not complete migration if persisting the received index fails', async () => {
    failKey = KEY;
    await expect(createExtensionEntityStore().applyRemote([remote()])).rejects.toThrow('storage failed');
    expect(storage[KEY]).toBeUndefined();
    expect(storage[DONE]).toBeUndefined();
  });

  it('rejects a failed tombstone deletion instead of silently advancing past the stale index', async () => {
    storage[KEY] = index();
    storage[DONE] = true;
    failKey = KEY;
    await expect(createExtensionEntityStore().applyRemote([{ ...remote(), deletedAt: 30 }])).rejects.toThrow('storage failed');
    expect(storage[KEY]).toEqual(index());
  });

  it('excludes full snapshots and normal/deleted incremental values without depending on capabilities', async () => {
    storage[KEY] = index();
    expect((await collectLocalSyncEntities()).some((entity) => entity.id === KEY)).toBe(false);
    await enqueueStorageItemChange(KEY, index());
    await enqueueStorageItemDeletion(KEY);
    expect(storage.cloud_sync_pending_delta_v1).toBeUndefined();
    expect(mocks.kinds).not.toHaveBeenCalled();
  });

  it.each(['value', 'tombstone'] as const)('filters existing base/delta and alias %s entries while keeping unrelated pending', async (kind) => {
    const blocked: SyncEntity[] = [
      remote(), { ...remote(), id: 'alias' },
      { ...remote(), id: 'alias-spaces', payload: { key: ` ${KEY} `, value: index() } },
      { ...remote(), id: 'alias-bom', payload: { key: `\ufeff${KEY}\ufeff`, value: index() } },
      { ...remote(), id: ` ${KEY} `, payload: { key: 'unrelated', value: index() } },
    ].map((entity) => kind === 'tombstone' ? { ...entity, deletedAt: 30 } : entity);
    storage.cloud_sync_pending_v1 = [pending, ...blocked];
    storage.cloud_sync_pending_delta_v1 = { 'storage_item\0alias-delta': { ...blocked[0], id: 'alias-delta' } };
    expect(await createExtensionEntityStore().listPending?.()).toEqual([pending]);
    expect((await preparePushQueueStats(blocked)).localEntityCount).toBe(0);
    const before = structuredClone(storage);
    await enqueueSyncEntities(blocked);
    expect(storage).toEqual(before);
    expect(await filterOutgoingSyncEntities(blocked)).toEqual([]);
  });

  it('does not enqueue or schedule background sync for received local indices or completion marks', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    registerCloudSyncStorageListener();
    storageChanged?.({ [KEY]: { newValue: index() }, [DONE]: { newValue: true } }, 'local');
    storageChanged?.({ [KEY]: { oldValue: index() } }, 'local');
    await Promise.resolve();
    expect(storage.cloud_sync_pending_delta_v1).toBeUndefined();
    expect(timer).not.toHaveBeenCalled();
  });

  it('preserves a previously valid snapshot if a malformed replacement arrives', async () => {
    storage[KEY] = index();
    await expect(createExtensionEntityStore().applyRemote([remote({ version: 1, updatedAt: 30, entries: [null] })])).rejects.toThrow();
    expect(storage[KEY]).toEqual(index());
    expect(storage[DONE]).toBeUndefined();
  });

  it('keeps Emby/115 legacy capability fallback and excludes only local aggregates', async () => {
    const entities = ['emby_library_state', 'drive115_library_state', KEY].map((key) => ({ ...remote(), id: key, payload: { key, value: {} } }));
    expect((await filterOutgoingSyncEntities(entities)).map((entity) => entity.id)).toEqual(['emby_library_state', 'drive115_library_state']);
    mocks.kinds.mockResolvedValue(['emby', 'drive115']);
    expect(await filterOutgoingSyncEntities(entities)).toEqual([]);
  });
});

describe('upgrade replay through the real adapter, engine and persisted cursors', () => {
  it('resets only storage_item before the first request and keeps other state intact', async () => {
    mocks.session.mockImplementation(async (request: SyncSessionRequest) => {
      expect(request.cursors).toEqual({ storage_item: 0, video: 41 });
      expect(request.changes).toEqual([pending]);
      expect(storage.cloud_sync_pending_v1).toEqual([pending]);
      expect(storage.cloud_sync_entities_v1).toEqual({ untouched: true });
      return response([remote()]);
    });
    await runCloudSyncNow();
    expect(storage[KEY]).toEqual(index());
    expect(storage[DONE]).toBe(true);
    expect(storage[CURSORS]).toEqual({ storage_item: 100, video: 41 });
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(writes.filter((write) => (write[CURSORS] as Record<string, number> | undefined)?.storage_item === 0)).toHaveLength(1);
  });

  it('accepts empty entries as complete and never replays on the following sync', async () => {
    mocks.session.mockResolvedValue(response([remote(index([]))]));
    await runCloudSyncNow();
    expect(storage[DONE]).toBe(true);
    expect(storage[KEY]).toEqual(index([]));
    await runCloudSyncNow();
    expect(mocks.session.mock.calls.map(([request]) => request.cursors.storage_item)).toEqual([0, 100]);
  });

  it.each([index(), index([])])('does not replay an already stored valid index %j', async (value) => {
    storage[KEY] = value;
    await runCloudSyncNow();
    expect(mocks.session.mock.calls[0][0].cursors.storage_item).toBe(80);
    expect(writes.some((write) => (write[CURSORS] as Record<string, number> | undefined)?.storage_item === 0)).toBe(false);
  });

  it('keeps incremental cursors when the completion mark exists even after the index is removed', async () => {
    storage[DONE] = true;
    await runCloudSyncNow();
    expect(mocks.session.mock.calls[0][0].cursors.storage_item).toBe(80);
  });

  it('does not loop within a failed sync and retries on the following invocation', async () => {
    mocks.session.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(runCloudSyncNow()).rejects.toThrow('network unavailable');
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(storage[DONE]).toBeUndefined();
    storage[CURSORS] = { storage_item: 90, video: 41 };
    mocks.session.mockResolvedValue(response([remote(index([]))]));
    await runCloudSyncNow();
    expect(mocks.session.mock.calls.map(([request]) => request.cursors.storage_item)).toEqual([0, 0]);
    expect(storage[DONE]).toBe(true);
  });

  it('retries next round when no index was returned even though the server advanced the cursor', async () => {
    await runCloudSyncNow();
    expect(storage[DONE]).toBeUndefined();
    await runCloudSyncNow();
    expect(mocks.session.mock.calls.map(([request]) => request.cursors.storage_item)).toEqual([0, 0]);
  });

  it('treats a malformed stored index as absent and retries after an application failure', async () => {
    storage[KEY] = { version: 1, entries: 'corrupt' };
    mocks.session.mockResolvedValue(response([remote()]));
    failKey = KEY;
    await expect(runCloudSyncNow()).rejects.toThrow('storage failed');
    expect(storage[DONE]).toBeUndefined();
    expect(mocks.session).toHaveBeenCalledTimes(1);
    failKey = undefined;
    await runCloudSyncNow();
    expect(mocks.session.mock.calls.map(([request]) => request.cursors.storage_item)).toEqual([0, 0]);
    expect(storage[DONE]).toBe(true);
  });

  it('does not send a request if the cursor reset could not be persisted', async () => {
    failKey = CURSORS;
    await expect(runCloudSyncNow()).rejects.toThrow('storage failed');
    expect(mocks.session).not.toHaveBeenCalled();
    expect(storage[DONE]).toBeUndefined();
    expect(storage[CURSORS]).toEqual({ storage_item: 80, video: 41 });
  });
});
