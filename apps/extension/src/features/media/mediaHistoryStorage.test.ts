import { beforeEach, expect, it, vi } from 'vitest';
const { store } = vi.hoisted(() => ({ store: {} as Record<string, any> }));
vi.mock('../../utils/storage', () => ({ getValue: async (key: string, fallback: unknown) => structuredClone(store[key] ?? fallback), setValue: async (key: string, value: unknown) => { store[key] = structuredClone(value); } }));
import { saveMediaDeletionHistory } from '../mediaCleanup/mediaCleanupStorage';
import { collectWatchedKeys } from './watchHistory';
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal('chrome', { runtime: {}, storage: { local: {
    get: (keys: string[], cb: (value: unknown) => void) => cb(Object.fromEntries(keys.map(k => [k, structuredClone(store[k])]))),
    set: (payload: Record<string, unknown>, cb: () => void) => { Object.assign(store, structuredClone(payload)); cb(); },
  } } });
});
it('clearing the old deletion journal first retains its reliable watched facts', async () => {
  store.media_deletion_history = { version: 1, updatedAt: 10, records: {
    a: { id: 'a', code: 'AAA-001', source: 'emby', copyId: 'emby:https://media.example:1', itemId: '1', watchedAt: 100, deletedAt: 200 },
    b: { id: 'b', code: 'BBB-002', source: 'emby', copyId: 'emby:https://media.example:2', itemId: '2', deletedAt: 200 },
  } };
  await saveMediaDeletionHistory({ version: 1, updatedAt: 300, records: {} });
  expect([...collectWatchedKeys(store.media_watch_evidence)]).toEqual(['AAA-001']);
  expect(store.media_deletion_history.records).toEqual({});
});
it('does not clear history when evidence retention fails', async () => {
  store.media_deletion_history = { version: 1, records: { a: { code: 'AAA-001', source: 'emby', copyId: 'a', watchedAt: 100 } } };
  const before = structuredClone(store.media_deletion_history);
  vi.spyOn(chrome.storage.local, 'set').mockImplementation(() => { throw new Error('quota'); });
  await expect(saveMediaDeletionHistory({ version: 1, updatedAt: 300, records: {} })).rejects.toThrow('quota');
  expect(store.media_deletion_history).toEqual(before);
});
