// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const isGlobalTaskLabelCompleted = vi.hoisted(() => vi.fn());

vi.mock('../../../platform/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/tasks')>();
  return {
    ...actual,
    isGlobalTaskLabelCompleted,
  };
});

describe('InitOrchestrator global dependencies', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('keeps each detail page waiting for its own metadata load', async () => {
    isGlobalTaskLabelCompleted.mockResolvedValue(true);
    const { InitOrchestrator } = await import('./initOrchestrator');
    const orchestrator = new InitOrchestrator();

    await expect((orchestrator as any).filterUnmetDependencies([
      'videoEnhancement:loadData',
    ])).resolves.toEqual(['videoEnhancement:loadData']);
    expect(isGlobalTaskLabelCompleted).not.toHaveBeenCalled();

    orchestrator.dispose();
  });
});
