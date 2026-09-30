import { describe, expect, it, vi } from 'vitest';
import type { ActorSubscription } from '../../types';
import { runSingleSubscriptionCheckWorkflow } from './newWorksSingleSubscriptionCheckWorkflow';

function subscription(overrides: Partial<ActorSubscription> = {}): ActorSubscription {
  return {
    actorId: 'actor-1',
    actorName: 'Alice',
    subscribedAt: 1,
    enabled: true,
    ...overrides,
  };
}

function button() {
  return {
    disabled: false,
    innerHTML: '<i class="fas fa-sync-alt"></i>',
  } as HTMLButtonElement;
}

function deps(overrides: Partial<Parameters<typeof runSingleSubscriptionCheckWorkflow>[0]['deps']> = {}) {
  return {
    sendSingleActorCheck: vi.fn(async () => ({
      success: true,
      result: {
        identified: 5,
        effective: 2,
        discovered: 1,
      },
    })),
    render: vi.fn(async () => undefined),
    showMessage: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('new works single subscription check workflow', () => {
  it('checks one actor, renders and restores button after success', async () => {
    const runtimeDeps = deps();
    const checkButton = button();

    await runSingleSubscriptionCheckWorkflow({
      subscription: subscription(),
      button: checkButton,
      deps: runtimeDeps,
    });

    expect(checkButton.disabled).toBe(false);
    expect(checkButton.innerHTML).toBe('<i class="fas fa-sync-alt"></i>');
    expect(runtimeDeps.showMessage).toHaveBeenNthCalledWith(1, '已开始检查 Alice', 'info');
    expect(runtimeDeps.sendSingleActorCheck).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'actor-1',
      actorName: 'Alice',
    }));
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.showMessage).toHaveBeenLastCalledWith('Alice: 识别 5，可入库 2，新增 1', 'success');
  });

  it('uses info result when no new works were discovered', async () => {
    const runtimeDeps = deps({
      sendSingleActorCheck: vi.fn(async () => ({
        success: true,
        result: { discovered: 0 },
      })),
    });

    await runSingleSubscriptionCheckWorkflow({
      subscription: subscription({ actorName: 'Bob' }),
      button: button(),
      deps: runtimeDeps,
    });

    expect(runtimeDeps.showMessage).toHaveBeenLastCalledWith('Bob: 新增 0', 'info');
  });

  it('reports failed background response and restores button', async () => {
    const runtimeDeps = deps({
      sendSingleActorCheck: vi.fn(async () => ({ success: false, error: '后台失败' })),
    });
    const checkButton = button();

    await runSingleSubscriptionCheckWorkflow({
      subscription: subscription(),
      button: checkButton,
      deps: runtimeDeps,
    });

    expect(runtimeDeps.render).not.toHaveBeenCalled();
    expect(runtimeDeps.logError).toHaveBeenCalledWith('检查演员 Alice 失败:', expect.any(Error));
    expect(runtimeDeps.showMessage).toHaveBeenLastCalledWith('检查 Alice 失败: 后台失败', 'error');
    expect(checkButton.disabled).toBe(false);
    expect(checkButton.innerHTML).toBe('<i class="fas fa-sync-alt"></i>');
  });
  it('新链：后台回收 pendingWorks 时交确认入库，不出旧统计 toast 也不重复 render', async () => {
    const confirmAndCommit = vi.fn(async () => undefined);
    const runtimeDeps = deps({
      confirmAndCommit,
      sendSingleActorCheck: vi.fn(async () => ({
        success: true,
        result: {
          identified: 6,
          effective: 2,
          discovered: 2,
          existingCount: 1,
          breakdown: { dateRange: 3, viewed: 0, browsed: 1, want: 0, ar: 0, categoryBlack: 0 },
          pendingWorks: [{ id: 'ABC-001', title: '作品一' }],
        },
      })),
    });
    const checkButton = button();

    await runSingleSubscriptionCheckWorkflow({
      subscription: subscription(),
      button: checkButton,
      deps: runtimeDeps,
    });

    expect(confirmAndCommit).toHaveBeenCalledTimes(1);
    expect(confirmAndCommit).toHaveBeenCalledWith({
      identifiedTotal: 6,
      existingCount: 1,
      breakdown: { dateRange: 3, viewed: 0, browsed: 1, want: 0, ar: 0, categoryBlack: 0 },
      pendingWorks: [{ id: 'ABC-001', title: '作品一' }],
    });
    expect(runtimeDeps.render).not.toHaveBeenCalled();
    // 只剩「已开始检查」那条，统计 toast 由确认流程给出
    expect(runtimeDeps.showMessage).toHaveBeenCalledTimes(1);
    expect(checkButton.disabled).toBe(false);
    expect(checkButton.innerHTML).toBe('<i class="fas fa-sync-alt"></i>');
  });

  it('旧版后台未回收 pendingWorks：回落当场直写统计提示', async () => {
    const confirmAndCommit = vi.fn(async () => undefined);
    const runtimeDeps = deps({ confirmAndCommit });

    await runSingleSubscriptionCheckWorkflow({
      subscription: subscription(),
      button: button(),
      deps: runtimeDeps,
    });

    expect(confirmAndCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.showMessage).toHaveBeenLastCalledWith('Alice: 识别 5，可入库 2，新增 1', 'success');
  });
});
