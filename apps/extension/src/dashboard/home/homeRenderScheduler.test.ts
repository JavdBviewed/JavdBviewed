import { describe, expect, it, vi } from 'vitest';
import { yieldToBrowser } from './homeRenderScheduler';

describe('yieldToBrowser', () => {
  it('waits for an animation frame and a macrotask before continuing', async () => {
    const frame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const timeout = vi.fn((callback: TimerHandler) => {
      if (typeof callback === 'function') callback();
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', frame);
    vi.stubGlobal('setTimeout', timeout);

    await yieldToBrowser();

    expect(frame).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
