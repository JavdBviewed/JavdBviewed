import { describe, expect, it, vi } from 'vitest';
import { runNewWorksAutoStatusSyncWorkflow } from './newWorksAutoStatusSyncWorkflow';

function deps(overrides: Partial<Parameters<typeof runNewWorksAutoStatusSyncWorkflow>[0]['deps']> = {}) {
  return {
    syncWithVideoRecords: vi.fn(async () => ({
      updated: 2,
      details: [
        { id: 'A', oldStatus: 'new', newStatus: 'viewed' },
        { id: 'B', oldStatus: 'new', newStatus: 'browsed' },
      ],
    })),
    render: vi.fn(async () => undefined),
    logInfo: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('new works auto status sync workflow', () => {
  it('syncs statuses silently and renders when records changed', async () => {
    const runtimeDeps = deps();

    await runNewWorksAutoStatusSyncWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.syncWithVideoRecords).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.logInfo).toHaveBeenCalledWith('自动同步新作品状态...');
    expect(runtimeDeps.logInfo).toHaveBeenCalledWith('自动同步完成，更新了 2 个作品的状态');
    expect(runtimeDeps.logInfo).toHaveBeenCalledWith('• A: new → viewed');
    expect(runtimeDeps.logInfo).toHaveBeenCalledWith('• B: new → browsed');
  });

  it('skips render when no status changed', async () => {
    const runtimeDeps = deps({
      syncWithVideoRecords: vi.fn(async () => ({ updated: 0, details: [] })),
    });

    await runNewWorksAutoStatusSyncWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.render).not.toHaveBeenCalled();
    expect(runtimeDeps.logInfo).toHaveBeenCalledWith('自动同步完成，没有需要更新的作品状态');
  });

  it('does not render when the automatic sync is skipped by its TTL gate', async () => {
    const runtimeDeps = deps({
      syncWithVideoRecords: vi.fn(async () => ({ updated: 0, details: [], skipped: true })),
    });

    await runNewWorksAutoStatusSyncWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.render).not.toHaveBeenCalled();
    expect(runtimeDeps.logInfo).toHaveBeenCalledWith('自动同步新作品状态已跳过：最近已同步');
  });

  it('logs sync failures without surfacing user messages', async () => {
    const runtimeDeps = deps({
      syncWithVideoRecords: vi.fn(async () => { throw new Error('sync failed'); }),
    });

    await runNewWorksAutoStatusSyncWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.render).not.toHaveBeenCalled();
    expect(runtimeDeps.logError).toHaveBeenCalledWith('自动同步状态失败:', expect.any(Error));
  });
});
