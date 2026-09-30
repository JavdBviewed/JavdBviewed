import { describe, expect, it, vi } from 'vitest';
import { runNewWorksManualCheckWorkflow } from './newWorksManualCheckWorkflow';

function deps(overrides: Partial<Parameters<typeof runNewWorksManualCheckWorkflow>[0]['deps']> = {}) {
  return {
    setCheckingButtonLoading: vi.fn(),
    getSubscriptions: vi.fn(async () => [{ enabled: true }, { enabled: false }]),
    ensureProgressUI: vi.fn(),
    updateProgressUI: vi.fn(),
    attachProgressListener: vi.fn(),
    detachProgressListener: vi.fn(),
    hideProgressUIAfter: vi.fn(),
    sendManualCheck: vi.fn(async () => ({
      success: true,
      result: {
        identifiedTotal: 4,
        effectiveTotal: 2,
        discovered: 1,
        errors: [],
      },
    })),
    render: vi.fn(async () => undefined),
    showMessage: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('new works manual check workflow', () => {
  it('shows warning and skips background check when there are no active subscriptions', async () => {
    const runtimeDeps = deps({
      getSubscriptions: vi.fn(async () => [{ enabled: false }]),
    });

    await runNewWorksManualCheckWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.setCheckingButtonLoading).toHaveBeenNthCalledWith(1, true);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('没有活跃的订阅演员，请先添加订阅', 'warn');
    expect(runtimeDeps.ensureProgressUI).not.toHaveBeenCalled();
    expect(runtimeDeps.sendManualCheck).not.toHaveBeenCalled();
    expect(runtimeDeps.detachProgressListener).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.hideProgressUIAfter).toHaveBeenCalledWith(1500);
    expect(runtimeDeps.setCheckingButtonLoading).toHaveBeenLastCalledWith(false);
  });

  it('runs manual check, renders results and marks progress done on success', async () => {
    const runtimeDeps = deps();

    await runNewWorksManualCheckWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.ensureProgressUI).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.updateProgressUI).toHaveBeenNthCalledWith(1, {
      processed: 0,
      total: 1,
      identifiedTotal: 0,
      effectiveTotal: 0,
    });
    expect(runtimeDeps.attachProgressListener).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.sendManualCheck).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('检查完成！已识别 4，可入库 2，新增 1', 'success');
    expect(runtimeDeps.updateProgressUI).toHaveBeenLastCalledWith({ done: true });
    expect(runtimeDeps.detachProgressListener).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.hideProgressUIAfter).toHaveBeenCalledWith(1500);
  });

  it('shows cancelled warning message with first error and error count', async () => {
    const runtimeDeps = deps({
      sendManualCheck: vi.fn(async () => ({
        success: true,
        result: {
          identifiedTotal: 6,
          effectiveTotal: 3,
          discovered: 0,
          cancelled: true,
          errors: ['站点 A 失败', '站点 B 失败'],
        },
      })),
    });

    await runNewWorksManualCheckWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.logWarn).toHaveBeenCalledWith('新作品检查错误详情:', ['站点 A 失败', '站点 B 失败']);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith(
      '检查已取消（已识别 6，可入库 3，新增 0，已保留已获取数据），错误：站点 A 失败（共2个错误，详情请查看控制台）',
      'warn',
    );
  });

  it('reports failed background response and still restores button and progress listener', async () => {
    const runtimeDeps = deps({
      sendManualCheck: vi.fn(async () => ({ success: false, error: '后台失败' })),
    });

    await runNewWorksManualCheckWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.render).not.toHaveBeenCalled();
    expect(runtimeDeps.logError).toHaveBeenCalledWith('立即检查失败:', expect.any(Error));
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('检查失败，请重试', 'error');
    expect(runtimeDeps.detachProgressListener).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.hideProgressUIAfter).toHaveBeenCalledWith(1500);
    expect(runtimeDeps.setCheckingButtonLoading).toHaveBeenLastCalledWith(false);
  });
});

describe('new works manual check workflow（收集-确认-入库新链）', () => {
  const pendingWorks = [
    { id: 'ABC-001', title: '作品一', actorName: 'Alice' },
    { id: 'ABC-002', title: '作品二', actorName: 'Bob' },
  ];
  const breakdown = { dateRange: 38, viewed: 1, browsed: 1, want: 0, ar: 1, categoryBlack: 0 };

  function confirmDeps(overrides: Parameters<typeof deps>[0] = {}) {
    return deps({
      confirmAndCommit: vi.fn(async () => undefined),
      sendManualCheck: vi.fn(async () => ({
        success: true,
        result: {
          identifiedTotal: 43,
          effectiveTotal: 2,
          discovered: 2,
          errors: [],
          pendingWorks,
          breakdown,
          existingCount: 3,
        },
      })),
      ...overrides,
    });
  }

  it('后台回收 pendingWorks 且页面接入确认流程：交确认入库，不重复 render、不出旧统计 toast', async () => {
    const runtimeDeps = confirmDeps();

    await runNewWorksManualCheckWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.confirmAndCommit).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.confirmAndCommit).toHaveBeenCalledWith({
      cancelled: false,
      identifiedTotal: 43,
      existingCount: 3,
      breakdown,
      pendingWorks,
    });
    expect(runtimeDeps.render).not.toHaveBeenCalled();
    expect(runtimeDeps.showMessage).not.toHaveBeenCalled();
    expect(runtimeDeps.updateProgressUI).toHaveBeenLastCalledWith({ done: true });
    expect(runtimeDeps.detachProgressListener).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.setCheckingButtonLoading).toHaveBeenLastCalledWith(false);
  });

  it('新链下检查错误：先 logWarn + 错误 toast，再进确认流程（已收集结果仍由用户决定）', async () => {
    const runtimeDeps = confirmDeps({
      sendManualCheck: vi.fn(async () => ({
        success: true,
        result: {
          identifiedTotal: 10,
          effectiveTotal: 2,
          discovered: 2,
          cancelled: true,
          errors: ['检查演员 Zoe 失败: 网络超时'],
          pendingWorks,
          breakdown,
          existingCount: 3,
        },
      })),
    });

    await runNewWorksManualCheckWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.logWarn).toHaveBeenCalledWith('新作品检查错误详情:', ['检查演员 Zoe 失败: 网络超时']);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith(
      '部分演员检查失败：检查演员 Zoe 失败: 网络超时，详情见控制台',
      'warn',
    );
    expect(runtimeDeps.confirmAndCommit).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
  });

  it('旧版后台未回收 pendingWorks：即使接入确认流程也回落旧直写提示', async () => {
    const runtimeDeps = deps({
      confirmAndCommit: vi.fn(async () => undefined),
    });

    await runNewWorksManualCheckWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.confirmAndCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('检查完成！已识别 4，可入库 2，新增 1', 'success');
  });
});
