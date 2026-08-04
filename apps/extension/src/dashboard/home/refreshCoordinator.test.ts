import { describe, expect, it, vi } from 'vitest';
import { createRefreshCoordinator } from './refreshCoordinator';

describe('createRefreshCoordinator', () => {
  it('shares the active refresh promise across concurrent callers', async () => {
    let release!: () => void;
    const activeRefresh = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn(() => activeRefresh);
    const request = createRefreshCoordinator(refresh);

    const first = request();
    const second = request();

    expect(first).toBe(second);
    expect(refresh).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});
