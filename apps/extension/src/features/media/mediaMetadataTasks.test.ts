import { describe, expect, it, vi } from 'vitest';
import { MediaMetadataTaskService, type MediaMetadataBatch } from './mediaMetadataTasks';
import type { VideoRecord } from '../../types';

const record = (id: string, code?: string): VideoRecord => ({ id: `media:${id}`, title: id, videoCode: code, status: 'viewed', createdAt: 1, updatedAt: 1 });
function fixture() {
  let stored: MediaMetadataBatch[] = [];
  const records = [record('a', 'ABC-123'), record('b', 'DEF-456'), record('c')];
  const refresh = vi.fn(async (_id: string) => {});
  let id = 0;
  const deps = { load: async () => structuredClone(stored), save: async (b: MediaMetadataBatch[]) => { stored = structuredClone(b); }, records: async () => records, refresh, id: () => `id${++id}`, now: () => 100 };
  return { deps, records, refresh, service: new MediaMetadataTaskService(deps) };
}

describe('media metadata confirmation batches', () => {
  it('groups new records, excludes existing site/deleted records, and makes zero requests before confirmation', async () => {
    const f = fixture();
    f.records.push({ ...record('site', 'GHI-789'), javdbUrl: 'https://javdb.com/v/site' }, { ...record('deleted'), deletedAt: 5 });
    const batches = await f.service.discover();
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe('pending');
    expect(batches[0].items.map(i => i.status)).toEqual(['pending', 'pending', 'unidentified']);
    await expect(f.service.step(batches[0].id, 'guessed')).rejects.toThrow();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(await f.service.discover()).toEqual(batches);
  });
  it('only executes confirmed members, leaves later discoveries awaiting consent, and persists each result', async () => {
    const f = fixture(); const [first] = await f.service.discover();
    const started = await f.service.confirm(first.id);
    f.records.push(record('d', 'JKL-001'));
    expect(await f.service.discover()).toHaveLength(2);
    const one = await f.service.step(first.id, started.runId!);
    expect(one.items.map(i => i.status)).toEqual(['done', 'pending', 'unidentified']);
    const two = await f.service.step(first.id, started.runId!);
    expect(two.status).toBe('completed'); expect(f.refresh.mock.calls).toEqual([['media:a'], ['media:b']]);
    expect((await f.service.list())[1].status).toBe('pending');
  });
  it('retains failure, continues other items, and explicitly retries only failures after service restart', async () => {
    const f = fixture(); const [batch] = await f.service.discover(); const run = await f.service.confirm(batch.id);
    f.refresh.mockRejectedValueOnce(new Error('source unavailable'));
    expect((await f.service.step(batch.id, run.runId!)).items[0].status).toBe('failed');
    await f.service.step(batch.id, run.runId!);
    const restarted = new MediaMetadataTaskService(f.deps); const retry = await restarted.confirm(batch.id);
    expect((await restarted.step(batch.id, retry.runId!)).items.map(i => i.status)).toEqual(['done', 'done', 'unidentified']);
    expect(f.refresh.mock.calls).toEqual([['media:a'], ['media:b'], ['media:a']]);
  });
  it('pauses after admitted work, rejects stale runs and does not recreate dismissed tasks', async () => {
    const f = fixture(); const [b] = await f.service.discover(); const run = await f.service.confirm(b.id);
    let release!: () => void; f.refresh.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    const step = f.service.step(b.id, run.runId!); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await f.service.pause(b.id); release();
    expect((await step).status).toBe('paused');
    await expect(f.service.step(b.id, run.runId!)).rejects.toThrow();
    const resumed = await f.service.confirm(b.id);
    await expect(f.service.step(b.id, run.runId!)).rejects.toThrow();
    await f.service.dismiss(b.id);
    await expect(f.service.step(b.id, resumed.runId!)).rejects.toThrow();
    expect(await f.service.discover()).toHaveLength(1);
  });
  it('reconfirms a skipped historical batch after restart without repeating completed items', async () => {
    const f = fixture(); const [batch] = await f.service.discover(); const oldRun = await f.service.confirm(batch.id);
    await f.service.step(batch.id, oldRun.runId!);
    await f.service.dismiss(batch.id);
    const restarted = new MediaMetadataTaskService(f.deps);
    expect((await restarted.discover())[0].status).toBe('cancelled');
    await expect(restarted.step(batch.id, oldRun.runId!)).rejects.toThrow();
    expect(f.refresh.mock.calls).toEqual([['media:a']]);
    const retry = await restarted.confirm(batch.id);
    expect(retry.id).toBe(batch.id); expect(retry.runId).not.toBe(oldRun.runId);
    await expect(restarted.step(batch.id, oldRun.runId!)).rejects.toThrow();
    expect((await restarted.step(batch.id, retry.runId!)).items.map(i => i.status)).toEqual(['done', 'done', 'unidentified']);
    expect(f.refresh.mock.calls).toEqual([['media:a'], ['media:b']]);
    expect(await restarted.discover()).toHaveLength(1);
  });
  it('does not reactivate a skipped batch while its admitted item is finishing', async () => {
    const f = fixture(); const [batch] = await f.service.discover(); const run = await f.service.confirm(batch.id);
    let release!: () => void; f.refresh.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    const step = f.service.step(batch.id, run.runId!); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await f.service.dismiss(batch.id);
    await expect(f.service.confirm(batch.id)).rejects.toThrow('当前影片');
    release(); expect((await step).status).toBe('cancelled');
    const retry = await f.service.confirm(batch.id);
    await f.service.step(batch.id, retry.runId!);
    expect(f.refresh.mock.calls).toEqual([['media:a'], ['media:b']]);
  });
  it('blocks duplicate in-flight work and recovers a lost running response only on explicit resume', async () => {
    const f = fixture(); const [b] = await f.service.discover(); const run = await f.service.confirm(b.id);
    let release!: () => void; f.refresh.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    const step = f.service.step(b.id, run.runId!); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(f.service.step(b.id, run.runId!)).rejects.toThrow();
    await expect(f.service.confirm(b.id)).rejects.toThrow();
    release(); await step;
    const restarted = new MediaMetadataTaskService(f.deps);
    await expect(restarted.step(b.id, run.runId!)).rejects.toThrow();
    const again = await restarted.confirm(b.id); await restarted.step(b.id, again.runId!);
    expect(f.refresh).toHaveBeenCalledTimes(2);
  });
});
