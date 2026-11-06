import type { SyncEntity } from '@javdb/sync-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idbRecords = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const idbSpies = vi.hoisted(() => ({
  viewedBulkPut: vi.fn(),
  viewedGet: vi.fn(),
  actorsBulkPut: vi.fn(),
  actorsGet: vi.fn(),
  listsBulkPut: vi.fn(),
  listsGet: vi.fn(),
  newWorksBulkPut: vi.fn(),
  newWorksDelete: vi.fn(),
  newWorksGet: vi.fn(),
  initDB: vi.fn(),
}));
vi.mock('../../platform/storage/indexedDb', () => idbSpies);

const PENDING_KEY = 'cloud_sync_pending_v1';
const DELTA_KEY = 'cloud_sync_pending_delta_v1';
const KEY_A = 'video\0A';
const oldFields = {
  sourceType: 'emby', sourceId: 'old', positionMs: 900,
  durationMs: 1000, completed: true, status: 'viewed',
};
const remoteFields = {
  sourceType: 'jellyfin', sourceId: 'remote', positionMs: 100,
  durationMs: 1100, completed: false, status: 'untracked',
};
const video = (id: string, payload: Record<string, unknown>): SyncEntity => ({
  type: 'video', id, updatedAt: 1, payload,
} as SyncEntity);

describe('createExtensionEntityStore().applyRemote pending watched refresh (G4-9)', () => {
  let storedValues: Record<string, unknown>;
  let failWrites: boolean;
  let storageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    idbRecords.clear();
    failWrites = false;
    storedValues = { [PENDING_KEY]: [], [DELTA_KEY]: {} };
    idbSpies.viewedBulkPut.mockImplementation(async (records: Array<Record<string, unknown>>) => {
      for (const record of records) idbRecords.set(String(record.id), structuredClone(record));
    });
    idbSpies.viewedGet.mockImplementation(async (id: string) => idbRecords.get(id));
    const storageGet = vi.fn((_keys: string[], callback: (items: Record<string, unknown>) => void) => {
      queueMicrotask(() => callback(structuredClone(storedValues)));
    });
    storageSet = vi.fn((items: Record<string, unknown>, callback: () => void) => {
      queueMicrotask(() => {
        if (!failWrites) storedValues = { ...storedValues, ...structuredClone(items) };
        callback();
      });
    });
    vi.stubGlobal('chrome', {
      runtime: { get lastError() { return failWrites ? { message: 'storage unavailable' } : undefined; } },
      storage: { local: { get: storageGet, set: storageSet } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes only an existing pending key from applied IDB values and isolates refresh failures', async () => {
    const pendingA = video('A', { ...oldFields, title: 'Local title' });
    storedValues[DELTA_KEY] = { [KEY_A]: pendingA };
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();
    const remoteA = video('A', { ...remoteFields, title: 'Remote title' });
    const remoteB = video('B', remoteFields);

    await store.applyRemote([remoteA, remoteB]);

    expect(idbSpies.viewedBulkPut).toHaveBeenCalledWith([
      { ...remoteFields, title: 'Remote title', id: 'A' },
      { ...remoteFields, id: 'B' },
    ], { skipCloudEnqueue: true });
    expect(idbSpies.viewedGet).toHaveBeenCalledWith('A');
    expect((storedValues[DELTA_KEY] as Record<string, SyncEntity>)[KEY_A]).toEqual({
      ...pendingA, payload: { ...remoteFields, title: 'Local title' },
    });
    expect(Object.keys(storedValues[DELTA_KEY] as object)).toEqual([KEY_A]);
    expect(storageSet).toHaveBeenCalledTimes(1);
    expect(Object.keys(storageSet.mock.calls[0][0])).toEqual([DELTA_KEY]);

    failWrites = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nextRemote = video('A', { ...remoteFields, positionMs: 900 });
    await expect(store.applyRemote([nextRemote])).resolves.toBeUndefined();

    expect(idbSpies.viewedBulkPut).toHaveBeenLastCalledWith(
      [{ ...remoteFields, positionMs: 900, id: 'A' }],
      { skipCloudEnqueue: true },
    );
    expect(idbRecords.get('A')).toEqual({ ...remoteFields, positionMs: 900, id: 'A' });
    expect((storedValues[DELTA_KEY] as Record<string, SyncEntity>)[KEY_A].payload).toEqual({
      ...remoteFields, title: 'Local title',
    });
    expect(warn).toHaveBeenCalledWith(
      '[cloudSync] 刷新 pending 失败，不阻断远端应用',
      expect.objectContaining({ message: 'storage unavailable' }),
    );
  });
});
