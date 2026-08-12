import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForDomReady } from './domReadyPoller';

describe('waitForDomReady', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the DOM predicate becomes ready', async () => {
    vi.useFakeTimers();
    let ready = false;
    const promise = waitForDomReady(() => ready, { intervalMs: 100 });

    ready = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBe(true);
  });

  it('stops polling and resolves false when the owner is aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const predicate = vi.fn(() => false);
    const promise = waitForDomReady(predicate, {
      signal: controller.signal,
      intervalMs: 100,
    });

    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toBe(false);
    expect(predicate).toHaveBeenCalledTimes(1);
  });
});
