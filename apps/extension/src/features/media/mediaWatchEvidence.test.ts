/**
 * @file mediaWatchEvidence.test.ts
 * @description 本地观看证据单测
 * @module features/media
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};

import {
  getWatchEvidence,
  mergePersistedWatchEvidence,
  revokeWatchEvidence,
  loadWatchEvidenceState,
  loadMediaPlaybackProgressList,
  reportWatchProgress,
} from './mediaWatchEvidence';

describe('mediaWatchEvidence', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal('chrome', {
      runtime: {},
      storage: {
        local: {
          get: (keys: string[], callback: (items: Record<string, unknown>) => void) => {
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              if (key in store) result[key] = store[key];
            }
            callback(result);
          },
          set: (payload: Record<string, unknown>, callback?: () => void) => {
            Object.assign(store, payload);
            callback?.();
          },
        },
      },
    });
  });

  it('merges higher percent and marks watched at threshold', async () => {
    await reportWatchProgress({ code: 'abc-1', source: 'drive115', percent: 20 });
    const mid = await getWatchEvidence('ABC-1');
    expect(mid?.percent).toBe(20);
    expect(mid?.watched).toBe(false);

    await reportWatchProgress({ code: 'ABC-1', source: 'drive115', percent: 95 });
    const done = await getWatchEvidence('abc-1');
    expect(done?.percent).toBe(95);
    expect(done?.watched).toBe(true);
  });

  it('does not decrease percent', async () => {
    await reportWatchProgress({ code: 'X-1', source: 'drive115', percent: 80 });
    await reportWatchProgress({ code: 'X-1', source: 'drive115', percent: 10 });
    const e = await getWatchEvidence('X-1');
    expect(e?.percent).toBe(80);
  });

  it('keeps progress for two physical copies of the same title independently', async () => {
    await reportWatchProgress({
      code: 'ABC-1',
      source: 'emby',
      sourceItemId: 'emby-item-1',
      copyId: 'emby:http://emby.local:emby-item-1',
      percent: 25,
    });
    await reportWatchProgress({
      code: 'ABC-1',
      source: 'drive115',
      sourceItemId: '115-pick-1',
      copyId: '115:115-file-1',
      fileId: '115-file-1',
      pickCode: '115-pick-1',
      percent: 80,
    });

    const emby = await getWatchEvidence('ABC-1', 'emby:http://emby.local:emby-item-1');
    const drive115 = await getWatchEvidence('ABC-1', '115:115-file-1');
    const progress = await loadMediaPlaybackProgressList();

    expect(emby?.percent).toBe(25);
    expect(drive115?.percent).toBe(80);
    expect(progress).toHaveLength(2);
    expect(progress.map((item) => item.sourceItemId).sort()).toEqual(['115-pick-1', 'emby-item-1']);
  });

  it('stores 115 playback resume position and keeps progress monotonic', async () => {
    await reportWatchProgress({
      code: 'D115-1',
      source: 'drive115',
      positionSec: 300,
      durationSec: 1000,
      pickCode: 'p1',
      fileName: 'D115-1.mp4',
    });
    await reportWatchProgress({
      code: 'D115-1',
      source: 'drive115',
      positionSec: 120,
      durationSec: 1000,
    });
    const e = await getWatchEvidence('d115-1');
    expect(e?.percent).toBe(30);
    expect(e?.positionSec).toBe(300);
    expect(e?.durationSec).toBe(1000);
    expect(e?.pickCode).toBe('p1');
    expect(e?.fileName).toBe('D115-1.mp4');
  });

  it('exposes 115 watch evidence as unified playback progress for cloud restore', async () => {
    await reportWatchProgress({
      code: 'D115-2',
      source: 'drive115',
      positionSec: 180,
      durationSec: 600,
      pickCode: 'pick-2',
      fileId: 'file-2',
      fileName: 'D115-2.mp4',
    });

    const list = await loadMediaPlaybackProgressList();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      code: 'D115-2',
      source: 'drive115',
      sourceItemId: 'pick-2',
      positionSeconds: 180,
      durationSeconds: 600,
      percent: 30,
      completed: false,
      fileName: 'D115-2.mp4',
    });
  });

  it('serializes concurrent playback and incoming restores without losing either copy', async () => {
    await Promise.all([
      reportWatchProgress({ code: 'ABC-1', copyId: 'a', source: 'emby', percent: 95 }),
      reportWatchProgress({ code: 'ABC-1', copyId: 'b', source: 'jellyfin', percent: 91 }),
      mergePersistedWatchEvidence({ version: 2, titles: { 'DEF-2': { copies: { c: { source: 'drive115', watched: true, percent: 100, lastPlayedAt: 10 } } } } }),
    ]);
    const state = await loadWatchEvidenceState();
    expect(Object.keys(state.titles['ABC-1'].copies)).toEqual(['a', 'b']);
    expect(state.titles['DEF-2'].copies.c.watched).toBe(true);
  });

  it('keeps a source cancellation through repeated old restores and accepts later playback', async () => {
    const fact = { source: 'emby', sourceItemId: '1', watched: true, percent: 100, lastPlayedAt: 100 };
    const old = { version: 2, titles: { 'ABC-1': { copies: { a: fact } } } };
    await mergePersistedWatchEvidence(old);
    await revokeWatchEvidence('ABC-1', 'a', 'emby', '1', 200);
    await Promise.all([mergePersistedWatchEvidence(old), mergePersistedWatchEvidence(old)]);
    expect((await getWatchEvidence('ABC-1', 'a'))?.watched).toBe(false);
    await reportWatchProgress({ code: 'ABC-1', copyId: 'a', source: 'emby', sourceItemId: '1', percent: 95 });
    expect((await getWatchEvidence('ABC-1', 'a'))?.watched).toBe(true);
    expect((await getWatchEvidence('ABC-1', 'a'))?.revokedAt).toBe(200);
  });

  it('does not publish merged memory on a failed storage write', async () => {
    await reportWatchProgress({ code: 'ABC-1', source: 'emby', percent: 95 });
    const before = JSON.stringify(store);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(() => { throw new Error('quota'); });
    await expect(revokeWatchEvidence('ABC-1', 'a', 'emby', '1')).rejects.toThrow('quota');
    expect(JSON.stringify(store)).toBe(before);
  });

});
