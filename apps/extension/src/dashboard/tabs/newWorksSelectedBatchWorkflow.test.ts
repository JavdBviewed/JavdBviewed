import { describe, expect, it, vi } from 'vitest';
import {
  findSelectedBatchWorkById,
  runSelectedBatchOpenWorkflow,
} from './newWorksSelectedBatchWorkflow';

function deps(overrides: Partial<Parameters<typeof runSelectedBatchOpenWorkflow>[0]['deps']> = {}) {
  return {
    confirm: vi.fn(async () => true),
    setLoading: vi.fn(),
    getCurrentPageWork: vi.fn((id: string) => id === 'dom-1' ? { id, url: 'https://javdb.com/v/dom-1', isRead: false } : undefined),
    findWorkById: vi.fn(async (id: string) => id === 'remote-1' ? { id, url: 'https://javdb.com/v/remote-1', isRead: true } : undefined),
    openWorkUrl: vi.fn(async () => undefined),
    markAsRead: vi.fn(async () => undefined),
    removeSelection: vi.fn(),
    render: vi.fn(async () => undefined),
    showMessage: vi.fn(),
    updateBatchOperations: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('new works selected batch open workflow', () => {
  it('shows info when no works are selected', async () => {
    const runtimeDeps = deps();

    await runSelectedBatchOpenWorkflow({ selectedIds: [], deps: runtimeDeps });

    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('未选择任何作品', 'info');
    expect(runtimeDeps.confirm).not.toHaveBeenCalled();
  });

  it('stops after confirmation is cancelled', async () => {
    const runtimeDeps = deps({
      confirm: vi.fn(async () => false),
    });

    await runSelectedBatchOpenWorkflow({ selectedIds: ['dom-1'], deps: runtimeDeps });

    expect(runtimeDeps.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '批量打开（已选）',
      type: 'warning',
    }));
    expect(runtimeDeps.openWorkUrl).not.toHaveBeenCalled();
  });

  it('opens current page and fallback works, marks unread as read, clears selection and renders', async () => {
    const runtimeDeps = deps();

    await runSelectedBatchOpenWorkflow({ selectedIds: ['dom-1', 'remote-1'], deps: runtimeDeps });

    expect(runtimeDeps.getCurrentPageWork).toHaveBeenCalledWith('dom-1');
    expect(runtimeDeps.findWorkById).toHaveBeenCalledWith('remote-1');
    expect(runtimeDeps.openWorkUrl).toHaveBeenNthCalledWith(1, 'https://javdb.com/v/dom-1');
    expect(runtimeDeps.openWorkUrl).toHaveBeenNthCalledWith(2, 'https://javdb.com/v/remote-1');
    expect(runtimeDeps.markAsRead).toHaveBeenCalledWith(['dom-1']);
    expect(runtimeDeps.removeSelection).toHaveBeenCalledWith(['dom-1', 'remote-1']);
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('已打开 2 个已选作品（并标记未读为已读）', 'success');
    expect(runtimeDeps.setLoading).toHaveBeenNthCalledWith(1, true);
    expect(runtimeDeps.setLoading).toHaveBeenLastCalledWith(false);
    expect(runtimeDeps.updateBatchOperations).toHaveBeenCalledTimes(1);
  });

  it('opens at most six selected works', async () => {
    const selectedIds = Array.from({ length: 10 }, (_, index) => `dom-${index + 1}`);
    const runtimeDeps = deps({
      getCurrentPageWork: vi.fn((id: string) => ({
        id,
        url: `https://javdb.com/v/${id}`,
        isRead: false,
      })),
    });

    await runSelectedBatchOpenWorkflow({ selectedIds, deps: runtimeDeps });

    expect(runtimeDeps.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('前 6 个'),
    }));
    expect(runtimeDeps.openWorkUrl).toHaveBeenCalledTimes(6);
    expect(runtimeDeps.markAsRead).toHaveBeenCalledWith(['dom-1', 'dom-2', 'dom-3', 'dom-4', 'dom-5', 'dom-6']);
  });

  it('shows warning when selected works have no resolved urls', async () => {
    const runtimeDeps = deps({
      getCurrentPageWork: vi.fn(() => undefined),
      findWorkById: vi.fn(async () => undefined),
    });

    await runSelectedBatchOpenWorkflow({ selectedIds: ['missing'], deps: runtimeDeps });

    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('未找到可打开的作品链接', 'warn');
    expect(runtimeDeps.openWorkUrl).not.toHaveBeenCalled();
    expect(runtimeDeps.removeSelection).not.toHaveBeenCalled();
    expect(runtimeDeps.updateBatchOperations).toHaveBeenCalledTimes(1);
  });

  it('finds selected batch work by id from remote query', async () => {
    const getNewWorks = vi.fn(async () => ({
      works: [
        { id: 'A', javdbUrl: 'https://javdb.com/v/A', isRead: false },
        { id: 'B', javdbUrl: 'https://javdb.com/v/B', isRead: true },
      ],
    }));

    await expect(findSelectedBatchWorkById('B', getNewWorks)).resolves.toEqual({
      id: 'B',
      url: 'https://javdb.com/v/B',
      isRead: true,
    });
    expect(getNewWorks).toHaveBeenCalledWith({ search: 'B' });
  });

  it('returns undefined when remote selected batch work has no url or query fails', async () => {
    await expect(findSelectedBatchWorkById('A', vi.fn(async () => ({
      works: [{ id: 'A', isRead: false }],
    })))).resolves.toBeUndefined();

    await expect(findSelectedBatchWorkById('A', vi.fn(async () => {
      throw new Error('load failed');
    }))).resolves.toBeUndefined();
  });
});
