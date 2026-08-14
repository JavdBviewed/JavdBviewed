import { describe, expect, it, vi } from 'vitest';
import type { NewWorkRecord } from '../../types';
import { runUnreadBatchOpenWorkflow } from './newWorksBatchOpenWorkflow';

function work(id: string, isRead = false): NewWorkRecord {
  return {
    id,
    actorId: `actor-${id}`,
    actorName: `Actor ${id}`,
    title: `Work ${id}`,
    javdbUrl: `https://javdb.com/v/${id}`,
    tags: [],
    discoveredAt: 1,
    isRead,
  };
}

function deps(overrides: Partial<Parameters<typeof runUnreadBatchOpenWorkflow>[0]['deps']> = {}) {
  return {
    getCooldownRemaining: vi.fn(() => 0),
    getCooldownSeconds: vi.fn(() => 0),
    updateButton: vi.fn(),
    getNewWorks: vi.fn(async () => ({ works: [work('1'), work('2')], total: 2, hasMore: false })),
    confirm: vi.fn(async () => true),
    openWorkUrl: vi.fn(async () => undefined),
    markAsRead: vi.fn(async () => undefined),
    startCooldown: vi.fn(),
    render: vi.fn(async () => undefined),
    showMessage: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('new works unread batch open workflow', () => {
  it('shows cooldown message before fetching page data', async () => {
    const runtimeDeps = deps({
      getCooldownRemaining: vi.fn(() => 10_000),
      getCooldownSeconds: vi.fn(() => 10),
    });

    await runUnreadBatchOpenWorkflow({
      filters: { filter: 'unread' },
      page: 1,
      pageSize: 10,
      deps: runtimeDeps,
    });

    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('批量打开冷却中，请在 10 秒后重试', 'info');
    expect(runtimeDeps.updateButton).toHaveBeenCalledWith();
    expect(runtimeDeps.getNewWorks).not.toHaveBeenCalled();
  });

  it('shows empty message when current page has no unread targets', async () => {
    const runtimeDeps = deps({
      getNewWorks: vi.fn(async () => ({ works: [work('read', true)], total: 1, hasMore: false })),
    });

    await runUnreadBatchOpenWorkflow({
      filters: { filter: 'unread' },
      page: 1,
      pageSize: 10,
      deps: runtimeDeps,
    });

    expect(runtimeDeps.updateButton).toHaveBeenCalledWith({ loading: true });
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('当前页没有未读作品', 'info');
    expect(runtimeDeps.confirm).not.toHaveBeenCalled();
    expect(runtimeDeps.updateButton).toHaveBeenLastCalledWith();
  });

  it('stops after confirmation is cancelled', async () => {
    const runtimeDeps = deps({
      confirm: vi.fn(async () => false),
    });

    await runUnreadBatchOpenWorkflow({
      filters: { filter: 'unread' },
      page: 1,
      pageSize: 10,
      deps: runtimeDeps,
    });

    expect(runtimeDeps.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '批量打开未读',
      type: 'warning',
      isHtml: true,
      message: expect.stringContaining('可能提高浏览器的 CPU 和内存占用'),
    }));
    expect(runtimeDeps.openWorkUrl).not.toHaveBeenCalled();
    expect(runtimeDeps.markAsRead).not.toHaveBeenCalled();
  });

  it('opens unread targets, marks them as read, starts cooldown and renders', async () => {
    const runtimeDeps = deps();

    await runUnreadBatchOpenWorkflow({
      filters: { filter: 'unread', sort: 'discoveredAt_desc' },
      page: 2,
      pageSize: 10,
      deps: runtimeDeps,
    });

    expect(runtimeDeps.getNewWorks).toHaveBeenCalledWith({
      filter: 'unread',
      sort: 'discoveredAt_desc',
      page: 2,
      pageSize: 10,
    });
    expect(runtimeDeps.openWorkUrl).toHaveBeenNthCalledWith(1, 'https://javdb.com/v/1');
    expect(runtimeDeps.openWorkUrl).toHaveBeenNthCalledWith(2, 'https://javdb.com/v/2');
    expect(runtimeDeps.markAsRead).toHaveBeenCalledWith(['1', '2']);
    expect(runtimeDeps.startCooldown).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('已打开 2 个未读作品并标为已读', 'success');
  });
});
