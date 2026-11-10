import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { records, getRecord, refresh } = vi.hoisted(() => ({ records: vi.fn(), getRecord: vi.fn(), refresh: vi.fn() }));
vi.mock('../../platform/storage/indexedDb', () => ({ viewedGetAll: records, viewedGet: getRecord }));
vi.mock('../records/refresh/application/mediaRecordRefresh', () => ({ refreshMediaRecordById: refresh }));
const key = 'media_metadata_batches_v1';
const current = { id: 'media:a', videoCode: 'ABC-123', title: '合成影片', status: 'viewed', createdAt: 1, updatedAt: 1 };
const sender = { id: 'synthetic-extension', url: 'chrome-extension://synthetic-extension/dashboard/dashboard.html#tab-sync', frameId: 0 };
let stored: Record<string, unknown>; let set: ReturnType<typeof vi.fn>;
beforeEach(() => {
 vi.resetModules(); stored = {}; records.mockResolvedValue([current]); getRecord.mockResolvedValue(current); refresh.mockReset();
 set = vi.fn(async (value: object) => { Object.assign(stored, structuredClone(value)); });
 vi.stubGlobal('chrome', { runtime: { id: sender.id, getURL: (p: string) => `chrome-extension://${sender.id}/${p}` }, storage: { local: { get: async () => structuredClone(stored), set } } });
});
afterEach(() => vi.unstubAllGlobals());
it('rejects non-dashboard commands before reading private media data or contacting sites', async () => {
 const { handleMediaMetadataMessage } = await import('./mediaMetadataRuntime');
 for (const invalid of [{ ...sender, url: 'https://javdb.com/v/a' }, { ...sender, frameId: 2 }, { ...sender, id: 'other' }]) {
  expect((await handleMediaMetadataMessage({ type: 'MEDIA_METADATA:LIST' }, invalid)).success).toBe(false);
 }
 expect(records).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
});
it('persists pending membership, refuses guessed consent, and records a deleted target as failure', async () => {
 const { handleMediaMetadataMessage: handle, mediaMetadataTasks } = await import('./mediaMetadataRuntime');
 await mediaMetadataTasks.discover();
 const list = await handle({ type: 'MEDIA_METADATA:LIST' }, sender); const batch = 'batches' in list ? list.batches![0] : undefined;
 expect(batch?.status).toBe('pending'); expect(refresh).not.toHaveBeenCalled();
 expect((await handle({ type: 'MEDIA_METADATA:STEP', batchId: batch!.id, runId: 'guessed' }, sender)).success).toBe(false);
 const confirmed = await handle({ type: 'MEDIA_METADATA:CONFIRM', batchId: batch!.id }, sender);
 getRecord.mockResolvedValue(undefined);
 const result = await handle({ type: 'MEDIA_METADATA:STEP', batchId: batch!.id, runId: 'batch' in confirmed ? confirmed.batch!.runId : '' }, sender);
 expect('batch' in result && result.batch?.items[0].status).toBe('failed'); expect(refresh).not.toHaveBeenCalled();
});
it('does not overwrite corrupt tasks or treat unreadable storage as an empty queue', async () => {
 stored[key] = { version: 1, batches: [{ id: 'broken', items: null }] }; const original = structuredClone(stored);
 const { handleMediaMetadataMessage } = await import('./mediaMetadataRuntime');
 expect((await handleMediaMetadataMessage({ type: 'MEDIA_METADATA:LIST' }, sender)).success).toBe(false);
 expect(stored).toEqual(original); expect(set).not.toHaveBeenCalled();
});
