import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalTaskDescriptor } from '../../shared/taskCenterTypes';

function descriptor(label: string): GlobalTaskDescriptor {
  return {
    taskId: `task-${label}`,
    label,
    tabId: 0,
    pageUrl: 'https://javdb.com/v/test',
    pageType: 'detail',
    mainId: 'test',
    pageInstanceId: 'page-test',
    phase: 'high',
    priority: 5,
    cost: 'light',
    visibilityPolicy: 'foreground_first',
    timeoutMs: 10_000,
    retryLimit: 2,
    resumePolicy: 'restart',
    createdAt: 1,
  };
}

describe('ensureManagedTasksRegistered', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('registers a blueprint batch with one runtime message and preserves descriptor order', async () => {
    const sendMessage = vi.fn(async () => ({
        results: [
          { ok: true, taskId: 'registered-first', tabId: 7, status: 'registered' },
          { ok: true, taskId: 'registered-second', tabId: 7, status: 'registered' },
        ],
      }));
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', lastError: undefined, sendMessage } });

    const { ensureManagedTasksRegistered } = await import('./runtimeMessaging');
    const results = await ensureManagedTasksRegistered([descriptor('first'), descriptor('second')]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: 'task-center:register-batch',
      payload: { descriptors: [expect.objectContaining({ label: 'first' }), expect.objectContaining({ label: 'second' })] },
    });
    expect(results.map((result) => result.taskId)).toEqual(['registered-first', 'registered-second']);
    expect(results.map((result) => result.tabId)).toEqual([7, 7]);
  });

  it('falls back to individual registration when batch registration fails', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'task-center:register-batch') {
        return undefined;
      }
      return { ok: true, taskId: `registered-${sendMessage.mock.calls.length}`, tabId: 9, status: 'registered' };
    });
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', lastError: undefined, sendMessage } });

    const { ensureManagedTasksRegistered } = await import('./runtimeMessaging');
    const results = await ensureManagedTasksRegistered([descriptor('first'), descriptor('second')]);

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'task-center:register-batch',
      'task-center:register',
      'task-center:register',
    ]);
    expect(results.map((result) => result.tabId)).toEqual([9, 9]);
  });
});

describe('waitForTaskLease', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps a source-page task queued past its execution timeout until the lease group is available', async () => {
    vi.useFakeTimers();
    let leaseRequests = 0;
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        lastError: undefined,
        sendMessage: vi.fn(async () => {
          leaseRequests += 1;
          return leaseRequests >= 25
            ? { granted: true }
            : { granted: false, waitReason: 'source-page-heavy-budget' };
        }),
      },
    });

    const { waitForTaskLease } = await import('./runtimeMessaging');
    const pendingLease = waitForTaskLease('queued-detail-sync', 10_000, 500);

    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pendingLease).resolves.toEqual({ granted: true });
  });

  it('returns to the orchestrator when a capacity-queued task becomes hidden', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ granted: false, waitReason: 'source-page-heavy-budget' })
      .mockResolvedValueOnce({ granted: false, waitReason: 'tab-hidden' });
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension', lastError: undefined, sendMessage },
    });

    const { waitForTaskLease } = await import('./runtimeMessaging');
    let result: { granted: boolean; waitReason?: string } | undefined;
    void waitForTaskLease('hidden-detail-sync', 10_000, 500).then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(result).toEqual({ granted: false, waitReason: 'tab-hidden' });
  });
});
