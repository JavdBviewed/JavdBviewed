/**
 * @file newWorksManualConfirmWorkflow.test.ts
 * @description 「收集-确认-入库」编排：Y=0 不弹窗、不入库零写入、失败转 warn、每个分支都渲染一次
 * @module dashboard/tabs
 */
import { describe, expect, it, vi } from 'vitest';
import {
  runNewWorksManualConfirmWorkflow,
  type NewWorksManualConfirmWorkflowDeps,
} from './newWorksManualConfirmWorkflow';
import type { NewWorksManualConfirmSource } from './newWorksManualConfirmViewModel';

const pendingWorks = [
  { id: 'ABC-001', title: '作品一', actorName: 'Alice' },
  { id: 'ABC-002', title: '作品二', actorName: 'Bob' },
];

function source(overrides: Partial<NewWorksManualConfirmSource> = {}): NewWorksManualConfirmSource {
  return {
    cancelled: false,
    identifiedTotal: 43,
    existingCount: 3,
    breakdown: { dateRange: 38, viewed: 1, browsed: 1, want: 0, ar: 0, categoryBlack: 0 },
    pendingWorks,
    ...overrides,
  };
}

function deps(overrides: Partial<NewWorksManualConfirmWorkflowDeps> = {}): NewWorksManualConfirmWorkflowDeps {
  return {
    showConfirmModal: vi.fn(async () => true),
    sendManualCommit: vi.fn(async () => ({ success: true, result: { total: 2, saved: 2, failed: 0 } })),
    render: vi.fn(async () => undefined),
    showMessage: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  } as NewWorksManualConfirmWorkflowDeps;
}

describe('runNewWorksManualConfirmWorkflow', () => {
  it('确认入库：弹窗参数与提交内容一致，成功后 toast 并渲染', async () => {
    const runtimeDeps = deps();

    await runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source() });

    expect(runtimeDeps.showConfirmModal).toHaveBeenCalledTimes(1);
    const modalOptions = vi.mocked(runtimeDeps.showConfirmModal).mock.calls[0][0];
    expect(modalOptions.title).toBe('新作品检查完成');
    expect(modalOptions.confirmLabel).toBe('确认入库（2 部）');
    expect(modalOptions.cancelLabel).toBe('不入库');
    expect(modalOptions.html).toContain('已识别 43 部 ｜ 可入库 2 部 ｜ 已在新作品库 3 部');

    expect(runtimeDeps.sendManualCommit).toHaveBeenCalledWith(pendingWorks);
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('已入库 2 部', 'success');
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
  });

  it('可入库为 0：不弹窗、不提交，直接 toast 分项去向', async () => {
    const runtimeDeps = deps();

    await runNewWorksManualConfirmWorkflow({
      deps: runtimeDeps,
      source: source({ pendingWorks: [], identifiedTotal: 7 }),
    });

    expect(runtimeDeps.showConfirmModal).not.toHaveBeenCalled();
    expect(runtimeDeps.sendManualCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith(
      '本次检查没有可入库的新作品（已识别 7，按规则剔除 40，已在新作品库 3）',
      'info',
    );
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
  });

  it('点「不入库」：零写入（不发 commit 消息），toast 说明已放弃', async () => {
    const runtimeDeps = deps({ showConfirmModal: vi.fn(async () => false) });

    await runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source() });

    expect(runtimeDeps.sendManualCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('已放弃本次 2 条结果，未写入新作品库', 'info');
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
  });

  it('取消场景标题走「已取消」文案，脚注含取消说明', async () => {
    const runtimeDeps = deps({ showConfirmModal: vi.fn(async () => false) });

    await runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source({ cancelled: true }) });

    const modalOptions = vi.mocked(runtimeDeps.showConfirmModal).mock.calls[0][0];
    expect(modalOptions.title).toBe('新作品检查已取消');
    expect(modalOptions.html).toContain('取消 = 停止检查后续演员');
  });

  it('入库返回失败：logError + error toast，仍渲染一次', async () => {
    const runtimeDeps = deps({
      sendManualCommit: vi.fn(async () => ({ success: false, error: '后台拒绝' })),
    });

    await runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source() });

    expect(runtimeDeps.logError).toHaveBeenCalledWith('新作品手动确认入库失败:', '后台拒绝');
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('入库失败：后台拒绝', 'error');
    expect(runtimeDeps.render).toHaveBeenCalledTimes(1);
  });

  it('入库部分失败：toast 转 warn 并给出 saved/total', async () => {
    const runtimeDeps = deps({
      sendManualCommit: vi.fn(async () => ({ success: true, result: { total: 2, saved: 1, failed: 1 } })),
    });

    await runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source() });

    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('已入库 1/2 部，1 条写入失败，详见控制台', 'warn');
  });

  it('提交抛异常：兜成入库失败提示，不外溢', async () => {
    const runtimeDeps = deps({
      sendManualCommit: vi.fn(async () => {
        throw new Error('channel closed');
      }),
    });

    await expect(
      runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source() }),
    ).resolves.toBeUndefined();

    expect(runtimeDeps.logError).toHaveBeenCalledWith('新作品手动确认入库异常:', expect.any(Error));
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('入库失败：channel closed', 'error');
  });

  it('弹窗抛异常：不入库并提示', async () => {
    const runtimeDeps = deps({
      showConfirmModal: vi.fn(async () => {
        throw new Error('modal boom');
      }),
    });

    await runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source() });

    expect(runtimeDeps.sendManualCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('入库确认弹窗异常，本次结果未写入新作品库', 'error');
  });

  it('渲染异常不覆盖业务提示，也不外溢', async () => {
    const runtimeDeps = deps({
      render: vi.fn(async () => {
        throw new Error('render boom');
      }),
    });

    await expect(
      runNewWorksManualConfirmWorkflow({ deps: runtimeDeps, source: source() }),
    ).resolves.toBeUndefined();

    expect(runtimeDeps.showMessage).toHaveBeenCalledWith('已入库 2 部', 'success');
  });

  it('pendingWorks 缺失：按 0 条处理（不弹窗、不提交）', async () => {
    const runtimeDeps = deps();

    await runNewWorksManualConfirmWorkflow({
      deps: runtimeDeps,
      source: { identifiedTotal: 5 },
    });

    expect(runtimeDeps.showConfirmModal).not.toHaveBeenCalled();
    expect(runtimeDeps.sendManualCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.showMessage).toHaveBeenCalledWith(
      '本次检查没有可入库的新作品（已识别 5，按规则剔除 0，已在新作品库 0）',
      'info',
    );
  });
});
