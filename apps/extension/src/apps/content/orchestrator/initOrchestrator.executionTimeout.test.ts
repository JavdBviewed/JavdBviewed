// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const managedTaskRunner = vi.hoisted(() => vi.fn());

vi.mock('../../../platform/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/tasks')>();
  return {
    ...actual,
    ensureManagedTaskRegistered: vi.fn(async (descriptor) => descriptor),
    runManagedTask: managedTaskRunner,
    runRegisteredManagedTask: managedTaskRunner,
  };
});

describe('InitOrchestrator execution timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('starts the execution timeout only after a delayed lease invokes the task', async () => {
    vi.useFakeTimers();
    managedTaskRunner.mockImplementation(async (_descriptor, runner) => {
      await new Promise((resolve) => window.setTimeout(resolve, 15_000));
      return { executed: true, result: await runner() };
    });
    const { InitOrchestrator } = await import('./initOrchestrator');
    const orchestrator = new InitOrchestrator();
    let executed = 0;

    orchestrator.add('deferred', async () => {
      executed += 1;
    }, { label: 'delayed-lease-task', timeout: 10_000 });

    await orchestrator.run();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(executed).toBe(1);
    expect(orchestrator.getState().timeline.some((entry) => (
      entry.label === 'delayed-lease-task' && entry.status === 'done'
    ))).toBe(true);
    expect(orchestrator.getState().timeline.some((entry) => (
      entry.label === 'delayed-lease-task' && entry.status === 'error'
    ))).toBe(false);

    orchestrator.dispose();
  });
});
