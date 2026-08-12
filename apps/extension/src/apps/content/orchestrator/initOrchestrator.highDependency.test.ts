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

describe('InitOrchestrator high dependencies', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('runs a high task after its deferred dependency completes', async () => {
    managedTaskRunner.mockImplementation(async (_descriptor, runner) => ({
      executed: true,
      result: await runner(),
    }));
    const { InitOrchestrator } = await import('./initOrchestrator');
    const orchestrator = new InitOrchestrator();
    const executed: string[] = [];

    await orchestrator.add('high', () => {
      executed.push('finish');
    }, {
      label: 'finish',
      dependsOn: ['load-data'],
    });
    await orchestrator.add('deferred', () => {
      executed.push('load-data');
    }, { label: 'load-data' });

    await orchestrator.run();
    await vi.waitFor(() => expect(executed).toEqual(['load-data', 'finish']));

    orchestrator.dispose();
  });
});
