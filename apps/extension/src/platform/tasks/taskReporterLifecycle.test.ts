// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTaskHeartbeatReporter } from './taskHeartbeatReporter';
import { installTaskVisibilityReporter } from './taskVisibilityReporter';

type ChromeRuntimeStub = {
  sendMessage: ReturnType<typeof vi.fn>;
};

const chromeRuntime: ChromeRuntimeStub = {
  sendMessage: vi.fn(),
};

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { chrome?: unknown }).chrome;
  chromeRuntime.sendMessage.mockReset();
});

describe('content task reporter lifecycle', () => {
  it('clears the heartbeat interval when disposed', () => {
    vi.useFakeTimers();
    (globalThis as { chrome?: unknown }).chrome = { runtime: chromeRuntime };

    const dispose = installTaskHeartbeatReporter(() => ['task-1']);
    expect(chromeRuntime.sendMessage).toHaveBeenCalledTimes(1);

    dispose();
    vi.advanceTimersByTime(15_000);

    expect(chromeRuntime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('removes the visibility listener when disposed', () => {
    const dispose = installTaskVisibilityReporter();
    chromeRuntime.sendMessage.mockReset();
    (globalThis as { chrome?: unknown }).chrome = { runtime: chromeRuntime };

    document.dispatchEvent(new Event('visibilitychange'));
    expect(chromeRuntime.sendMessage).toHaveBeenCalledTimes(1);

    dispose();
    chromeRuntime.sendMessage.mockReset();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(chromeRuntime.sendMessage).not.toHaveBeenCalled();
  });
});
