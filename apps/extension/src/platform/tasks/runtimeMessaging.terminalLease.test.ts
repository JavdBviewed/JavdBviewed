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
    timeoutMs: 30_000,
    retryLimit: 0,
    resumePolicy: 'restart',
    createdAt: 1,
  };
}

describe('terminal task lease wait reasons', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('waitForTaskLease stops immediately instead of polling until timeout', async () => {
    const leaseCalls: number[] = [];
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'task-center:request-lease') {
        leaseCalls.push(Date.now());
        return { granted: false, waitReason: 'task-done' };
      }
      return {};
    });
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', lastError: undefined, sendMessage } });

    const { waitForTaskLease } = await import('./runtimeMessaging');
    const startedAt = Date.now();
    const result = await waitForTaskLease('task-gone', 30_000, 5);

    expect(result).toEqual({ granted: false, waitReason: 'task-done' });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(leaseCalls.length).toBeLessThanOrEqual(2);
  });

  it('runRegisteredManagedTask does not send FAIL when the task already finished', async () => {
    const sentTypes: string[] = [];
    const sendMessage = vi.fn(async (message: { type: string }) => {
      sentTypes.push(message.type);
      if (message.type === 'task-center:request-lease') {
        return { granted: false, waitReason: 'task-error' };
      }
      return {};
    });
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', lastError: undefined, sendMessage } });

    const { runRegisteredManagedTask } = await import('./runtimeMessaging');
    const result = await runRegisteredManagedTask(descriptor('finished'), async () => 'should-not-run');

    expect(result).toEqual({ executed: false, waitReason: 'task-error' });
    expect(sentTypes).not.toContain('task-center:fail');
  });
});
