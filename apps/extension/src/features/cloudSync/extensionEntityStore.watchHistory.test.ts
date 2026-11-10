import { beforeEach, describe, expect, it, vi } from 'vitest';
const { values } = vi.hoisted(() => ({ values: {} as Record<string, any> }));
vi.mock('../../utils/storage', () => ({
  getValue: async (key: string, fallback: unknown) => structuredClone(values[key] ?? fallback),
  setValue: async (key: string, value: unknown) => { values[key] = structuredClone(value); },
  getSettings: async () => ({}),
}));
vi.mock('./chromePendingStore', () => ({ refreshCloudPendingWatchedFields: vi.fn(async () => {}) }));
import { createExtensionEntityStore } from './extensionEntityStore';
import { mergePersistedWatchEvidence, revokeWatchEvidence } from '../media/mediaWatchEvidence';
import { shouldSuppressCloudStorageChange } from './storageChangeGate';
import { collectWatchedKeys } from '../media/watchHistory';
const key = 'media_watch_evidence';
const facts = (code: string, item: string) => ({ version: 2, titles: { [code]: { copies: { [item]: { source: 'emby', sourceItemId: item, watched: true, percent: 95, lastPlayedAt: 100 } } } } });
beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  vi.stubGlobal('chrome', { runtime: {}, storage: { local: {
    get: (keys: string[], cb: (v: unknown) => void) => cb(Object.fromEntries(keys.map(key => [key, structuredClone(values[key])]))),
    set: (data: Record<string, unknown>, cb: () => void) => { Object.assign(values, structuredClone(data)); cb(); },
  } } });
});
describe('Cloud watch evidence apply', () => {
 it('unions remote history without losing local facts and marks the exact merged value as received', async () => {
  await mergePersistedWatchEvidence(facts('AAA-001', 'a'));
  await createExtensionEntityStore().applyRemote([{ type: 'storage_item', id: key, payload: { key, value: facts('BBB-002', 'b') }, updatedAt: 2 }]);
  expect([...collectWatchedKeys(values[key])].sort()).toEqual(['AAA-001', 'BBB-002']);
  expect(shouldSuppressCloudStorageChange(key, { newValue: values[key] })).toBe(true);
 });
 it('keeps source cancellation during an old remote restore', async () => {
  await mergePersistedWatchEvidence(facts('AAA-001', 'a'));
  await revokeWatchEvidence('AAA-001', 'a', 'emby', 'a', 200);
  await createExtensionEntityStore().applyRemote([{ type: 'storage_item', id: key, payload: { key, value: facts('AAA-001', 'a') }, updatedAt: 300 }]);
  expect(collectWatchedKeys(values[key]).size).toBe(0);
 });
});
