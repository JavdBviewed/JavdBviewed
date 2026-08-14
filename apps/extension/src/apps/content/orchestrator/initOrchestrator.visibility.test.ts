// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const managedTaskRunner = vi.hoisted(() => vi.fn());

vi.mock('../../../platform/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/tasks')>();
  return {
    ...actual,
    runManagedTask: managedTaskRunner,
  };
});

describe('InitOrchestrator foreground task recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('waits without polling while hidden and resumes a foreground task when the page becomes visible', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    managedTaskRunner
      .mockResolvedValueOnce({ executed: false, waitReason: 'tab-hidden' })
      .mockResolvedValueOnce({ executed: false, waitReason: 'tab-hidden' })
      .mockImplementationOnce(async (_descriptor, runner) => ({ executed: true, result: await runner() }));

    const { InitOrchestrator } = await import('./initOrchestrator');
    const orchestrator = new InitOrchestrator();
    const task = vi.fn(() => undefined);

    await orchestrator.add('deferred', task, {
      label: 'videoEnhancement:loadData',
      visibilityPolicy: 'foreground_first',
    });
    await orchestrator.run();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(managedTaskRunner).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1);

    expect(managedTaskRunner).toHaveBeenCalledTimes(2);
    expect(task).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_200);

    expect(managedTaskRunner).toHaveBeenCalledTimes(3);
    expect(task).toHaveBeenCalledTimes(1);

    orchestrator.dispose();
  });
});
