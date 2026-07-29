/**
 * @file mediaWatchEvidence.test.ts
 * @description 本地观看证据单测
 * @module features/media
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};

vi.mock('../../utils/storage', () => ({
  getValue: vi.fn(async (key: string, fallback: unknown) => {
    return key in store ? store[key] : fallback;
  }),
  setValue: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
}));

import { getWatchEvidence, loadMediaPlaybackProgressList, reportWatchProgress } from './mediaWatchEvidence';

describe('mediaWatchEvidence', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
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

});
