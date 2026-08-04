import { describe, expect, it, vi } from 'vitest';
import { createInsightsRefreshScheduler } from './insights';

describe('createInsightsRefreshScheduler', () => {
  it('coalesces a message burst into one active refresh and one trailing refresh', async () => {
    vi.useFakeTimers();
    let releaseFirstRefresh!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let refreshCount = 0;
    const refresh = vi.fn(async () => {
      refreshCount += 1;
      if (refreshCount === 1) await firstRefresh;
    });
    const schedule = createInsightsRefreshScheduler(refresh, 100);

    schedule();
    schedule();
    schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);

    schedule();
    schedule();
    releaseFirstRefresh();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
