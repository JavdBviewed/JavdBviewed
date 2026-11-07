import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncHttpError } from '@javdb/sync-client';
import { collectLocalSyncEntities, createExtensionEntityStore, preparePushQueueStats } from './extensionEntityStore';
import { flushIndexReportOutbox, queueLocalIndexReport, queueIndexSourceRetirement } from './indexReportOutbox';
import { enqueueStorageItemChange, enqueueStorageItemDeletion } from './enqueueLocalChange';
import { shouldSyncStorageItemKey } from './storageItemPolicy';

vi.mock('./cloudSettingsStorage', () => ({
  CLOUD_SETTINGS_STORAGE_KEY: 'cloud_sync_settings_v1',
  loadCloudSettings: async () => ({ baseUrl: 'https://cloud.test', accountIdentifier: 'u', deviceId: 'd' }),
}));
vi.mock('./chromeTokenStore', () => ({
  CLOUD_SESSION_STORAGE_KEY: 'cloud_sync_session_v1',
  loadCloudSession: async () => ({ accessToken: 'a', userId: 'u', deviceId: 'd' }),
}));
vi.mock('../../platform/storage/indexedDb', () => ({
  initDB: async () => ({ getAll: async () => [], count: async () => 0 }),
}));

const aggregateKeys = ['emby_library_state', 'drive115_library_state'];
const entities = [...aggregateKeys, 'settings'].map((key) => ({
  type: 'storage_item', id: key, payload: { key, value: { entries: [], updatedAt: 1 } }, updatedAt: 1,
}));
const reportApi = {
  getIndexReportCapabilities: async () => ({ version: 1 as const, kinds: ['emby', 'drive115'] as const as ['emby', 'drive115'], maxPageEntries: 500, maxPageBytes: 2097152 }),
  startIndexReport: async () => ({ runId: 'run-1', generation: 1, published: false, revision: 1 }),
  putIndexReport: async () => ({ runId: 'run-1', generation: 1, published: true, revision: 1 }),
  retireIndexSource: async () => ({ retired: true }),
};
let storage: Record<string, any>;
beforeEach(() => {
  storage = {
    cloud_sync_session_v1: { accessToken: 'a' },
    cloud_sync_pending_v1: structuredClone(entities),
    emby_library_state: { entries: [], updatedAt: 1 },
    drive115_library_state: { entries: [], updatedAt: 1 },
    settings: {},
  };
  vi.stubGlobal('chrome', { runtime: {}, storage: { local: {
    get(keys: string[] | string | null, callback: (value: unknown) => void) {
      callback(structuredClone(keys === null ? storage : Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).filter((key) => key in storage).map((key) => [key, storage[key]]),
      )));
    },
    set(values: Record<string, unknown>, callback?: () => void) { Object.assign(storage, structuredClone(values)); callback?.(); },
    remove(keys: string[], callback: () => void) { keys.forEach((key) => delete storage[key]); callback(); },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('outbound-only aggregate policy', () => {
  it('suppresses only aggregate full snapshots and stale pending after capability discovery', async () => {
    await queueLocalIndexReport({ kind: 'emby', sourceId: 'https://media.test', entries: [], complete: true });
    await queueLocalIndexReport({ kind: 'drive115', sourceId: 'account:root', entries: [], complete: true });
    await flushIndexReportOutbox(reportApi);
    const full = await collectLocalSyncEntities();
    expect(full.filter((e) => aggregateKeys.includes(e.id))).toEqual([]);
    expect(full.some((e) => e.id === 'settings')).toBe(true);
    const store = createExtensionEntityStore();
    expect((await store.listPending!()).map((e) => e.id)).toEqual(['settings']);
    const stats = await preparePushQueueStats(entities);
    expect(stats.pendingCount).toBe(1);
  });

  it('still applies inbound aggregates without generating reports or aggregate pending echoes', async () => {
    await queueLocalIndexReport({ kind: 'emby', sourceId: 'https://media.test', entries: [], complete: true });
    await queueLocalIndexReport({ kind: 'drive115', sourceId: 'account:root', entries: [], complete: true });
    await flushIndexReportOutbox(reportApi);
    for (const key of aggregateKeys) expect(shouldSyncStorageItemKey(key)).toBe(true);
    const remote = {
      entries: {
        'ABC-123': [{
          serverType: 'emby', serverName: 'Remote', serverUrl: 'https://remote.test',
          itemId: 'remote', itemName: 'ABC-123', updatedAt: 5,
        }],
      },
      updatedAt: 5,
    };
    const store = createExtensionEntityStore();
    await store.applyRemote([{ ...entities[0], payload: { key: aggregateKeys[0], value: remote } }]);
    expect(storage.emby_library_state).toEqual(remote);
    expect(Object.keys(storage).filter((key) => key.startsWith('cloud_index_report_outbox_v1:'))).toEqual([]);
    await enqueueStorageItemChange(aggregateKeys[0], remote);
    await enqueueStorageItemDeletion(aggregateKeys[1]);
    expect(storage.cloud_sync_pending_delta_v1).toBeUndefined();
    await enqueueStorageItemChange('settings', { display: { enabled: true } });
    expect(Object.keys(storage.cloud_sync_pending_delta_v1)).toEqual(['storage_item\0settings']);
  });

  it('preserves legacy full and pending behavior for old Cloud capability 404', async () => {
    await flushIndexReportOutbox({ ...reportApi, getIndexReportCapabilities: async () => { throw new SyncHttpError(404, 'old server'); } });
    const full = await collectLocalSyncEntities();
    expect(full.filter((e) => aggregateKeys.includes(e.id))).toHaveLength(2);
    expect(await createExtensionEntityStore().listPending!()).toEqual(entities);
  });
});


it('keeps each kind in legacy mode until a durable local source exists, then keeps report mode after retirement', async () => {
  await flushIndexReportOutbox(reportApi);
  expect((await createExtensionEntityStore().listPending!()).map((e) => e.id)).toEqual([...aggregateKeys, 'settings']);
  await queueLocalIndexReport({ kind: 'emby', sourceId: 'https://media.test', entries: [], complete: true });
  expect((await createExtensionEntityStore().listPending!()).map((e) => e.id)).toEqual(['drive115_library_state', 'settings']);
  await flushIndexReportOutbox(reportApi);
  await queueIndexSourceRetirement('emby', 'https://media.test');
  await flushIndexReportOutbox(reportApi);
  expect((await createExtensionEntityStore().listPending!()).map((e) => e.id)).toEqual(['drive115_library_state', 'settings']);
  const full = await collectLocalSyncEntities();
  expect(full.filter((e) => aggregateKeys.includes(e.id)).map((e) => e.id)).toEqual(['drive115_library_state']);
});

it('does not change legacy enqueue behavior for keys other than the two aggregate indexes', async () => {
  await flushIndexReportOutbox(reportApi);
  await enqueueStorageItemChange('legacy_custom_key', { value: 1 });
  await enqueueStorageItemDeletion('legacy_custom_deleted_key');
  expect(Object.keys(storage.cloud_sync_pending_delta_v1)).toEqual([
    'storage_item\0legacy_custom_key', 'storage_item\0legacy_custom_deleted_key',
  ]);
});

describe('inbound Emby image authentication', () => {
  it('saves locally authenticated images and marks that exact value for echo suppression without network requests', async () => {
    const { shouldSuppressCloudStorageChange } = await import('./storageChangeGate');
    const fetch = vi.fn(() => { throw new Error('inbound hydration must not use the network'); });
    vi.stubGlobal('fetch', fetch);
    storage.settings = {
      emby: {
        mediaServers: [{ id: 'local-media', type: 'emby', name: 'Local', url: 'https://media.test/emby', apiKey: 'local-image-key', enabled: true }],
      },
    };
    const imageUrl = 'https://media.test/emby/Items/42/Images/Primary';
    const remote = {
      entries: {
        'ABC-123': [{
          serverType: 'emby', serverName: 'Remote', serverUrl: 'https://media.test/emby', itemId: '42', itemName: 'ABC-123',
          coverImageUrl: imageUrl, imageUrls: { Primary: imageUrl }, updatedAt: 77,
        }],
      },
      updatedAt: 77,
    };
    await createExtensionEntityStore().applyRemote([
      { type: 'storage_item', id: 'emby_library_state', payload: { key: 'emby_library_state', value: remote }, updatedAt: 77 },
    ]);
    const saved = storage.emby_library_state;
    expect(new URL(saved.entries['ABC-123'][0].coverImageUrl).searchParams.get('api_key')).toBe('local-image-key');
    expect(new URL(saved.entries['ABC-123'][0].imageUrls.Primary).searchParams.get('api_key')).toBe('local-image-key');
    expect(shouldSuppressCloudStorageChange('emby_library_state', { newValue: saved })).toBe(true);
    expect(remote.entries['ABC-123'][0].coverImageUrl).toBe(imageUrl);
    expect(storage.cloud_sync_pending_delta_v1).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['same batch', 'later batch', 'local credential rotation'])('rehydrates an existing index after %s without an aggregate echo', async (arrival) => {
    const { shouldSuppressCloudStorageChange } = await import('./storageChangeGate');
    const fetch = vi.fn(() => { throw new Error('hydration must not fetch'); });
    vi.stubGlobal('fetch', fetch);
    const imageUrl = 'https://media.test/emby/Items/42/Images/Primary';
    const settings = { emby: { mediaServers: [{
      id: 'local-media', type: 'emby', name: 'Local', url: 'https://media.test/emby', apiKey: 'new-key', enabled: true,
    }] } };
    const remote = { entries: { 'ABC-123': [{
      serverType: 'emby', serverUrl: 'https://media.test/emby', itemId: '42', itemName: 'ABC-123',
      coverImageUrl: imageUrl, imageUrls: { Primary: imageUrl }, updatedAt: 77,
    }] }, updatedAt: 77 };
    const indexEntity = { type: 'storage_item', id: 'emby_library_state', payload: { key: 'emby_library_state', value: remote }, updatedAt: 77 };
    const settingsEntity = { type: 'storage_item', id: 'settings', payload: { key: 'settings', value: settings }, updatedAt: 78 };
    const store = createExtensionEntityStore();
    if (arrival === 'same batch') {
      await store.applyRemote([indexEntity, settingsEntity]);
    } else if (arrival === 'later batch') {
      await store.applyRemote([indexEntity]);
      expect(storage.emby_library_state.entries['ABC-123'][0].coverImageUrl).toBe(imageUrl);
      await store.applyRemote([settingsEntity]);
    } else {
      storage.settings = structuredClone(settings);
      storage.settings.emby.mediaServers[0].apiKey = 'old-key';
      await store.applyRemote([indexEntity]);
      expect(new URL(storage.emby_library_state.entries['ABC-123'][0].coverImageUrl).searchParams.get('api_key')).toBe('old-key');
      storage.settings = settings;
      await enqueueStorageItemChange('settings', settings);
    }
    const saved = storage.emby_library_state;
    expect(new URL(saved.entries['ABC-123'][0].coverImageUrl).searchParams.get('api_key')).toBe('new-key');
    expect(new URL(saved.entries['ABC-123'][0].imageUrls.Primary).searchParams.get('api_key')).toBe('new-key');
    expect(saved.updatedAt).toBe(77);
    expect(shouldSuppressCloudStorageChange('emby_library_state', { newValue: saved })).toBe(true);
    expect(Object.keys(storage.cloud_sync_pending_delta_v1 ?? {})).not.toContain('storage_item\0emby_library_state');
    expect(Object.keys(storage).some((key) => key.startsWith('cloud_index_report_outbox_v1:'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves drive115 values and Emby deletion semantics unchanged', async () => {
    const driveValue = { entries: [{ code: 'ABC-123', coverImageUrl: 'https://media.test/Items/42/Images/Primary' }], updatedAt: 88 };
    const store = createExtensionEntityStore();
    await store.applyRemote([
      { type: 'storage_item', id: 'drive115_library_state', payload: { key: 'drive115_library_state', value: driveValue }, updatedAt: 88 },
      { type: 'storage_item', id: 'emby_library_state', payload: { key: 'emby_library_state' }, updatedAt: 88, deletedAt: 88 },
    ]);
    expect(storage.drive115_library_state).toEqual(driveValue);
    expect(storage.emby_library_state).toBeUndefined();
  });
});

it('treats capability 503 as unknown and blocks only prepared aggregates, including after a previous 404', async () => {
  await queueLocalIndexReport({ kind: 'emby', sourceId: 'https://media.test', entries: [], complete: true });
  const unavailable = { ...reportApi, getIndexReportCapabilities: async () => { throw new SyncHttpError(503, 'private upstream body'); } };
  expect(await flushIndexReportOutbox(unavailable)).toMatchObject({ supported: null, failed: 1 });
  expect((await createExtensionEntityStore().listPending!()).map((entity) => entity.id)).toEqual(['drive115_library_state', 'settings']);
  expect((await collectLocalSyncEntities()).some((entity) => entity.id === 'emby_library_state')).toBe(false);
  await enqueueStorageItemChange('emby_library_state', { entries: {}, updatedAt: 9 });
  expect(storage.cloud_sync_pending_delta_v1).toBeUndefined();
  await flushIndexReportOutbox({ ...reportApi, getIndexReportCapabilities: async () => { throw new SyncHttpError(404, 'old Cloud'); } });
  expect((await createExtensionEntityStore().listPending!()).some((entity) => entity.id === 'emby_library_state')).toBe(true);
  await flushIndexReportOutbox(unavailable);
  expect((await createExtensionEntityStore().listPending!()).some((entity) => entity.id === 'emby_library_state')).toBe(false);
});
