import { describe, expect, it, vi } from 'vitest';

import { createNewWorksAutoSyncScheduler } from './newWorksAutoSyncScheduler';

describe('new works automatic status sync scheduler', () => {
  it('runs the pending sync only after the active page reaches an idle slice', () => {
    let idleCallback: (() => void) | undefined;
    const run = vi.fn();
    const scheduler = createNewWorksAutoSyncScheduler({
      run,
      schedule: (callback) => {
        idleCallback = callback;
        return { cancel: vi.fn() };
      },
    });

    scheduler.request();

    expect(run).not.toHaveBeenCalled();
    idleCallback?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancels an unstarted sync while hidden and reschedules it after restore', () => {
    const callbacks: Array<() => void> = [];
    const cancels: Array<ReturnType<typeof vi.fn>> = [];
    const run = vi.fn();
    const scheduler = createNewWorksAutoSyncScheduler({
      run,
      schedule: (callback) => {
        callbacks.push(callback);
        const cancel = vi.fn();
        cancels.push(cancel);
        return { cancel };
      },
    });

    scheduler.request();
    scheduler.setActive(false);
    callbacks[0]?.();

    expect(cancels[0]).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    scheduler.setActive(true);
    callbacks[1]?.();

    expect(run).toHaveBeenCalledTimes(1);
  });
});
