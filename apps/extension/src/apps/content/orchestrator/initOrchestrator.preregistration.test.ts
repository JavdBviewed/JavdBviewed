// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const registerBatch = vi.hoisted(() => vi.fn());
const registerOne = vi.hoisted(() => vi.fn());

vi.mock('../../../platform/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/tasks')>();
  return {
    ...actual,
    ensureManagedTasksRegistered: registerBatch,
    ensureManagedTaskRegistered: registerOne,
  };
});

describe('InitOrchestrator preregistration', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reuses a preregistered finish descriptor when the task is added', async () => {
    registerBatch.mockImplementation(async (descriptors) => descriptors);
    registerOne.mockImplementation(async (descriptor) => descriptor);

    const { InitOrchestrator } = await import('./initOrchestrator');
    const orchestrator = new InitOrchestrator();

    await orchestrator.preregisterBlueprints([{
      phase: 'high',
      label: 'videoEnhancement:finish',
    }]);
    await orchestrator.add('high', () => undefined, {
      label: 'videoEnhancement:finish',
      priority: 8,
      dependsOn: ['videoEnhancement:loadData'],
    });

    expect(registerBatch).toHaveBeenCalledTimes(1);
    expect(registerOne).not.toHaveBeenCalled();

    orchestrator.dispose();
  });
});
