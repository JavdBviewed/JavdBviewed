// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('InitOrchestrator lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears monitor intervals when disposed', async () => {
    vi.useFakeTimers();
    const { InitOrchestrator, initOrchestrator } = await import('./initOrchestrator');
    const baselineTimerCount = vi.getTimerCount();
    const orchestrator = new InitOrchestrator();

    expect(vi.getTimerCount()).toBe(baselineTimerCount + 2);

    orchestrator.dispose();

    expect(vi.getTimerCount()).toBe(baselineTimerCount);
    initOrchestrator.dispose();
  });
});
