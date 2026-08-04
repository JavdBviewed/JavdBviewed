import { describe, expect, it, vi } from 'vitest';
import { createLatestValueWriter } from './latestValueWriter';

describe('createLatestValueWriter', () => {
  it('keeps only the latest pending value while a write is in flight', async () => {
    const releases: Array<() => void> = [];
    const writes: string[] = [];
    const write = vi.fn((value: string) => new Promise<void>((resolve) => {
      writes.push(value);
      releases.push(resolve);
    }));
    const queue = createLatestValueWriter(write);

    queue.enqueue('first');
    queue.enqueue('stale');
    queue.enqueue('latest');

    expect(writes).toEqual(['first']);
    releases[0]?.();
    await Promise.resolve();

    expect(writes).toEqual(['first', 'latest']);
    releases[1]?.();
    await queue.flush();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('flushes the final value when no write is already running', async () => {
    const write = vi.fn(async (value: string) => value);
    const queue = createLatestValueWriter(write);

    queue.enqueue('final');
    await queue.flush();

    expect(write).toHaveBeenCalledWith('final');
  });
});
