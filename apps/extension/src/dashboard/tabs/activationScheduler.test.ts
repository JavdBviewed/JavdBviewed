import { describe, expect, it } from 'vitest';

import { createLatestActivationScheduler } from './activationScheduler';

describe('createLatestActivationScheduler', () => {
  it('runs the current activation and coalesces intermediate tab requests', async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const scheduler = createLatestActivationScheduler(async (tabId: string) => {
      started.push(tabId);
      if (tabId === 'home') await firstFinished;
    });

    const first = scheduler.schedule('home');
    const second = scheduler.schedule('records');
    const latest = scheduler.schedule('settings');
    releaseFirst?.();

    await Promise.all([first, second, latest]);

    expect(started).toEqual(['home', 'settings']);
  });
});
