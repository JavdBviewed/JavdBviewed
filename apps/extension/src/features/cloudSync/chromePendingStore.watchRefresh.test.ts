import type { SyncEntity } from '@javdb/sync-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const viewedGetMock = vi.hoisted(() => vi.fn());
vi.mock('../../platform/storage/indexedDb', () => ({ viewedGet: viewedGetMock }));

const PENDING_KEY = 'cloud_sync_pending_v1';
const DELTA_KEY = 'cloud_sync_pending_delta_v1';
const SESSION_KEY = 'cloud_sync_session_v1';
const key = (id: string) => `video\0${id}`;

const oldFields = {
  sourceType: 'emby', sourceId: 'old-source', positionMs: 900,
  durationMs: 1000, completed: true, status: 'viewed',
};
const newFields = {
  sourceType: 'jellyfin', sourceId: 'new-source', positionMs: 100,
  durationMs: 1200, completed: false, status: 'untracked',
};
const video = (id: string, payload: Record<string, unknown>): SyncEntity => ({
  type: 'video', id, revision: 3, updatedAt: '2026-11-05T00:00:00Z', payload,
} as SyncEntity);

describe('chromePendingStore.watchRefresh (G4 1-8)', () => {
  let storedValues: Record<string, unknown>;
  let storageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    viewedGetMock.mockReset();
    viewedGetMock.mockResolvedValue(undefined);
    storedValues = { [PENDING_KEY]: [], [SESSION_KEY]: { accessToken: 'test-token' } };
    const storageGet = vi.fn((_keys: string[], callback: (items: Record<string, unknown>) => void) => {
      queueMicrotask(() => callback(structuredClone(storedValues)));
    });
    storageSet = vi.fn((items: Record<string, unknown>, callback: () => void) => {
      queueMicrotask(() => {
        storedValues = { ...storedValues, ...structuredClone(items) };
        callback();
      });
    });
    vi.stubGlobal('chrome', { storage: { local: { get: storageGet, set: storageSet } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('G4-1 skips a video absent from pending without creating a base or delta entry', async () => {
    const { refreshCloudPendingWatchedFields } = await import('./chromePendingStore');
    expect(await refreshCloudPendingWatchedFields([video('missing', newFields)])).toBe(0);
    expect(storedValues[PENDING_KEY]).toEqual([]);
    expect(storedValues[DELTA_KEY]).toBeUndefined();
    expect(storageSet).not.toHaveBeenCalled();
    expect(viewedGetMock).not.toHaveBeenCalled();
  });

  it('G4-2 refreshes six fields in delta but retains other payload and envelope fields', async () => {
    const retained = { title: 'Local title', tags: ['a', 'b'], userNotes: 'local note', listIds: ['list-1'] };
    const original = video('A', { ...oldFields, ...retained });
    storedValues[DELTA_KEY] = { [key('A')]: original };
    viewedGetMock.mockResolvedValue(newFields);
    const { refreshCloudPendingWatchedFields } = await import('./chromePendingStore');

    expect(await refreshCloudPendingWatchedFields([video('A', { ...oldFields, positionMs: 200, title: 'Remote title' })])).toBe(1);
    expect((storedValues[DELTA_KEY] as Record<string, SyncEntity>)[key('A')]).toEqual({
      ...original, payload: { ...oldFields, ...newFields, ...retained },
    });
    expect(storageSet).toHaveBeenCalledTimes(1);
    expect(Object.keys(storageSet.mock.calls[0][0])).toEqual([DELTA_KEY]);
    expect(viewedGetMock).toHaveBeenCalledWith('A');
  });

  it('G4-3 overlays a base-only key into delta without rewriting base', async () => {
    const original = video('A', { ...oldFields, title: 'Keep me' });
    const base = [original];
    storedValues[PENDING_KEY] = base;
    const { refreshCloudPendingWatchedFields } = await import('./chromePendingStore');

    expect(await refreshCloudPendingWatchedFields([video('A', newFields)])).toBe(1);
    expect(storedValues[PENDING_KEY]).toBe(base);
    expect(storedValues[DELTA_KEY]).toEqual({
      [key('A')]: { ...original, payload: { ...newFields, title: 'Keep me' } },
    });
    expect(Object.keys(storageSet.mock.calls[0][0])).toEqual([DELTA_KEY]);
  });

  it('G4-4 ignores actor, list, and new_work even when those keys exist', async () => {
    const otherTypes = ['actor', 'list', 'new_work'];
    storedValues[PENDING_KEY] = otherTypes.map((type) => ({ type, id: 'A', payload: oldFields }));
    const { refreshCloudPendingWatchedFields } = await import('./chromePendingStore');
    const inbound = otherTypes.map((type) => ({ type, id: 'A', payload: newFields } as SyncEntity));

    expect(await refreshCloudPendingWatchedFields(inbound)).toBe(0);
    expect(storedValues[DELTA_KEY]).toBeUndefined();
    expect(storageSet).not.toHaveBeenCalled();
    expect(viewedGetMock).not.toHaveBeenCalled();
  });

  it('G4-5 is idempotent on the same source and performs no second storage write', async () => {
    storedValues[PENDING_KEY] = [video('A', oldFields)];
    const { refreshCloudPendingWatchedFields } = await import('./chromePendingStore');
    expect(await refreshCloudPendingWatchedFields([video('A', newFields)])).toBe(1);
    const firstDelta = structuredClone(storedValues[DELTA_KEY]);
    storageSet.mockClear();

    expect(await refreshCloudPendingWatchedFields([video('A', newFields)])).toBe(0);
    expect(storedValues[DELTA_KEY]).toEqual(firstDelta);
    expect(storageSet).not.toHaveBeenCalled();
    expect(viewedGetMock).toHaveBeenCalledTimes(1);
  });

  it('G4-6 locks the cloud overlay whitelist and its order', async () => {
    const { CLOUD_OVERLAY_WATCHED_FIELDS } = await import('./chromePendingStore');
    expect(CLOUD_OVERLAY_WATCHED_FIELDS).toEqual([
      'sourceType', 'sourceId', 'positionMs', 'durationMs', 'completed', 'status',
    ]);
  });

  it('G4-7 serializes refresh, upsert, and clear without dropping unrelated writes', async () => {
    const a = video('A', oldFields);
    const b = video('B', oldFields);
    const removed = video('removed', oldFields);
    storedValues[PENDING_KEY] = [a];
    storedValues[DELTA_KEY] = { [key('B')]: b, [key('removed')]: removed };
    const { refreshCloudPendingWatchedFields, upsertCloudPending, clearCloudPending } = await import('./chromePendingStore');
    const c = video('C', { ...oldFields, title: 'Unrelated update' });

    const results = await Promise.all([
      refreshCloudPendingWatchedFields([video('A', newFields)]),
      upsertCloudPending([c]),
      clearCloudPending([{ type: 'video', id: 'removed' }]),
      refreshCloudPendingWatchedFields([video('B', newFields)]),
    ]);
    expect(results).toEqual([1, undefined, undefined, 1]);
    expect(storedValues[PENDING_KEY]).toEqual([a]);
    expect(storedValues[DELTA_KEY]).toEqual({
      [key('A')]: { ...a, payload: newFields },
      [key('B')]: { ...b, payload: newFields },
      [key('C')]: c,
    });
    expect(storageSet).toHaveBeenCalledTimes(4);
  });

  it('G4-8 uses current IDB watched values over a stale inbound sync batch', async () => {
    const original = video('A', { ...oldFields, title: 'Local title' });
    storedValues[PENDING_KEY] = [original];
    const live = { status: 'untracked', completed: false, positionMs: 950, durationMs: 1200 };
    viewedGetMock.mockResolvedValue(live);
    const { refreshCloudPendingWatchedFields } = await import('./chromePendingStore');
    const stale = video('A', { ...oldFields, positionMs: 200, title: 'Remote title' });

    expect(await refreshCloudPendingWatchedFields([stale])).toBe(1);
    expect((storedValues[DELTA_KEY] as Record<string, SyncEntity>)[key('A')]).toEqual({
      ...original, payload: { ...oldFields, ...live, title: 'Local title' },
    });
    expect(viewedGetMock).toHaveBeenCalledWith('A');
  });

  it('keeps pending unchanged when IDB read fails instead of applying a stale inbound snapshot', async () => {
    const original = video('A', { ...oldFields, title: 'Local title' });
    storedValues[PENDING_KEY] = [original];
    viewedGetMock.mockRejectedValue(new Error('IDB unavailable'));
    const { refreshCloudPendingWatchedFields } = await import('./chromePendingStore');

    expect(await refreshCloudPendingWatchedFields([video('A', newFields)])).toBe(0);
    expect(storedValues[PENDING_KEY]).toEqual([original]);
    expect(storedValues[DELTA_KEY]).toBeUndefined();
    expect(storageSet).not.toHaveBeenCalled();
  });
});
