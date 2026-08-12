import { describe, expect, it } from 'vitest';

import { createLatestActivationScheduler, createSingleFlightAsyncTask } from './activationScheduler';

describe('createLatestActivationScheduler', () => {
  it('prepares the latest visible state before an earlier initialization settles', async () => {
    const prepared: string[] = [];
    const started: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const scheduler = createLatestActivationScheduler(
      async (tabId: string) => {
        started.push(tabId);
        if (tabId === 'records') await firstFinished;
      },
      (tabId: string) => {
        prepared.push(tabId);
      },
    );

    const first = scheduler.schedule('records');
    const latest = scheduler.schedule('settings');

    expect(prepared).toEqual(['records', 'settings']);
    expect(started).toEqual(['records']);

    releaseFirst?.();
    await Promise.all([first, latest]);
    expect(started).toEqual(['records', 'settings']);
  });

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

  it('marks an activation stale when a newer request arrives while it is awaiting', async () => {
    let releaseFirst: (() => void) | null = null;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const latestStates: boolean[] = [];
    const scheduler = createLatestActivationScheduler(async (tabId: string, isLatest: () => boolean) => {
      if (tabId === 'home') await firstFinished;
      latestStates.push(isLatest());
    });

    const first = scheduler.schedule('home');
    const latest = scheduler.schedule('settings');
    releaseFirst?.();

    await Promise.all([first, latest]);

    expect(latestStates).toEqual([false, true]);
  });
});

describe('createSingleFlightAsyncTask', () => {
  it('shares concurrent initialization and allows retry after failure', async () => {
    let calls = 0;
    let shouldFail = true;
    const initialize = createSingleFlightAsyncTask(async () => {
      calls += 1;
      if (shouldFail) throw new Error('first attempt failed');
      return 'ready';
    });

    const first = initialize();
    const second = initialize();
    expect(first).toBe(second);
    await expect(first).rejects.toThrow('first attempt failed');
    expect(calls).toBe(1);

    shouldFail = false;
    await expect(initialize()).resolves.toBe('ready');
    expect(calls).toBe(2);
  });
});
