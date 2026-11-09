/** @description 历史隐私运行态通过真实采集、pending与apply路径时保持本机隔离 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncEntity, SyncSessionResponse } from '@javdb/sync-protocol';
import { collectLocalSyncEntities, createExtensionEntityStore, preparePushQueueStats } from './extensionEntityStore';
import { enqueueStorageItemChange, enqueueStorageItemDeletion } from './enqueueLocalChange';

const mocks = vi.hoisted(() => ({ session: vi.fn(), kinds: vi.fn() }));
vi.mock('./createExtensionCloudClient', () => ({ createExtensionCloudClient: async () => ({ api: { session: mocks.session } }) }));
vi.mock('./indexReportOutbox', () => ({
  flushIndexReportOutbox: async () => ({ supported: true, failed: 0 }),
  getIndexReportKinds: mocks.kinds,
}));
vi.mock('../../platform/storage/indexedDb', () => ({
  initDB: async () => ({ getAll: async () => [], count: async () => 0 }),
}));

const CURSORS = 'cloud_sync_cursors_v1';
const pending: SyncEntity = { type: 'storage_item', id: 'settings', updatedAt: 2, payload: { key: 'settings', value: {} } };
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


describe('device privacy runtime isolation', () => {
  const keys = ['privacy_state', 'privacy_session', 'privacy_encryption_key'];
  const entities = () => keys.flatMap(key => [
    { type: 'storage_item', id: key, updatedAt: 20, payload: { key, value: 'foreign' } },
    { type: 'storage_item', id: 'alias', updatedAt: 20, payload: { key: ` ${key} `, value: 'foreign' } },
    { type: 'storage_item', id: key, updatedAt: 20, payload: { key: 'settings', value: 'foreign' } },
  ]);
  it('ignores inbound values, aliases and tombstones without overwriting local state or settings', async () => {
    for (const key of keys) storage[key] = `local-${key}`;
    storage.settings = { privacy: { privateMode: { passwordHash: 'keep' } } };
    const before = structuredClone(storage);
    await createExtensionEntityStore().applyRemote(entities());
    await createExtensionEntityStore().applyRemote(entities().map(e => ({ ...e, deletedAt: 30 })));
    expect(storage).toEqual(before);
  });
  it('excludes full collection, normal changes and historical base/delta queues', async () => {
    for (const key of keys) {
      storage[key] = `local-${key}`;
      await enqueueStorageItemChange(key, 'local'); await enqueueStorageItemDeletion(key);
    }
    expect(storage.cloud_sync_pending_delta_v1).toBeUndefined();
    expect((await collectLocalSyncEntities()).filter(e => keys.includes(e.id))).toEqual([]);
    storage.cloud_sync_pending_v1 = [pending, ...entities()];
    storage.cloud_sync_pending_delta_v1 = Object.fromEntries(entities().map((e, i) => [String(i), { ...e, deletedAt: 30 }]));
    expect(await createExtensionEntityStore().listPending?.()).toEqual([pending]);
    expect((await preparePushQueueStats(entities())).localEntityCount).toBe(0);
  });
});
