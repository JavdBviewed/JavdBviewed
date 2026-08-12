import { describe, expect, it, vi } from 'vitest';
import { createHomeChartRenderQueue, scheduleHomeChartRender, yieldToBrowser } from './homeRenderScheduler';

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

describe('scheduleHomeChartRender', () => {
  it('defers a non-critical chart until an idle callback and can cancel it', () => {
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 8 } as IdleDeadline);
      return 17;
    });
    const cancelIdleCallback = vi.fn();
    const render = vi.fn();
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

    const task = scheduleHomeChartRender(render);

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    task.cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(17);
    vi.unstubAllGlobals();
  });

  it('uses a timeout fallback when requestIdleCallback is unavailable', () => {
    const timeout = vi.fn((callback: TimerHandler) => {
      if (typeof callback === 'function') callback();
      return 23;
    });
    const render = vi.fn();
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal('setTimeout', timeout);

    const task = scheduleHomeChartRender(render, { timeoutMs: 900 });

    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 900);
    expect(render).toHaveBeenCalledTimes(1);
    task.cancel();
    vi.unstubAllGlobals();
  });
});

describe('createHomeChartRenderQueue', () => {
  it('runs non-critical charts one idle slice at a time', () => {
    const callbacks: IdleRequestCallback[] = [];
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const cancelIdleCallback = vi.fn();
    const render = vi.fn();
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

    const queue = createHomeChartRenderQueue();
    queue.enqueue(() => render('first'));
    queue.enqueue(() => render('second'));

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    callbacks.shift()?.({ didTimeout: false, timeRemaining: () => 8 } as IdleDeadline);
    expect(render).toHaveBeenCalledWith('first');
    expect(requestIdleCallback).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(1);
    callbacks.shift()?.({ didTimeout: false, timeRemaining: () => 8 } as IdleDeadline);
    expect(render).toHaveBeenCalledWith('second');

    queue.cancel();
    expect(cancelIdleCallback).toHaveBeenCalledTimes(0);
    vi.unstubAllGlobals();
  });
});
