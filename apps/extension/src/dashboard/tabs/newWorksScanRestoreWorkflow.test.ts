/**
 * @file newWorksScanRestoreWorkflow.test.ts
 * @description 刷新后扫描状态回填 workflow 单测（纯 DI）：
 *              running → 恢复进度 UI（字段逐一映射）；done/cancelled 带摘要 → 摘要 toast（查询侧已消费）；
 *              interrupted → 一次性提示；idle → 无操作；查询失败 → logError 静默不抛。
 *              三处新文案 builder 精确字符串锁定（C-B 摘要 / interrupted 提示，双扫描拒绝文案在
 *              newWorksManualCheckWorkflow.test.ts 锁定）。
 * @module dashboard/tabs
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildScanInterruptedToastMessage,
  buildScanSummaryToastMessage,
  restoreNewWorksScanState,
  type NewWorksScanRestoreDeps,
} from './newWorksScanRestoreWorkflow';

function deps(overrides: Partial<NewWorksScanRestoreDeps> = {}) {
  return {
    queryStatus: vi.fn(async () => ({ status: 'idle' as const })),
    restoreProgressUI: vi.fn(),
    showSummaryToast: vi.fn(),
    showInterruptedToast: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

const RUNNING_STATE = {
  status: 'running' as const,
  processed: 2,
  total: 5,
  identifiedTotal: 3,
  pendingTotal: 1,
  actorName: 'C',
  activeActorNames: ['D', 'E'],
  concurrency: 2,
};

describe('restoreNewWorksScanState', () => {
  it('idle → 无任何 UI 副作用', async () => {
    const runtimeDeps = deps();
    await restoreNewWorksScanState(runtimeDeps);
    expect(runtimeDeps.restoreProgressUI).not.toHaveBeenCalled();
    expect(runtimeDeps.showSummaryToast).not.toHaveBeenCalled();
    expect(runtimeDeps.showInterruptedToast).not.toHaveBeenCalled();
  });

  it('running → 恢复进度 UI，状态字段逐一映射', async () => {
    const runtimeDeps = deps({ queryStatus: vi.fn(async () => ({ ...RUNNING_STATE })) });

    await restoreNewWorksScanState(runtimeDeps);

    expect(runtimeDeps.restoreProgressUI).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.restoreProgressUI).toHaveBeenCalledWith({
      processed: 2,
      total: 5,
      identifiedTotal: 3,
      pendingTotal: 1,
      actorName: 'C',
      activeActorNames: ['D', 'E'],
      concurrency: 2,
    });
    expect(runtimeDeps.showSummaryToast).not.toHaveBeenCalled();
    expect(runtimeDeps.showInterruptedToast).not.toHaveBeenCalled();
  });

  it('done + 摘要 → 摘要 toast（done）', async () => {
    const result = { discovered: 2, identifiedTotal: 3, pendingCount: 2, existingCount: 1, cancelled: false, errorCount: 0 };
    const runtimeDeps = deps({ queryStatus: vi.fn(async () => ({ status: 'done' as const, result })) });

    await restoreNewWorksScanState(runtimeDeps);

    expect(runtimeDeps.showSummaryToast).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.showSummaryToast).toHaveBeenCalledWith('done', result);
    expect(runtimeDeps.restoreProgressUI).not.toHaveBeenCalled();
  });

  it('cancelled + 摘要 → 摘要 toast（cancelled）', async () => {
    const result = { discovered: 0, identifiedTotal: 3, pendingCount: 1, existingCount: 0, cancelled: true, errorCount: 0 };
    const runtimeDeps = deps({ queryStatus: vi.fn(async () => ({ status: 'cancelled' as const, result })) });

    await restoreNewWorksScanState(runtimeDeps);

    expect(runtimeDeps.showSummaryToast).toHaveBeenCalledWith('cancelled', result);
  });

  it('done 无摘要 → 不弹 toast（无信息可报）', async () => {
    const runtimeDeps = deps({ queryStatus: vi.fn(async () => ({ status: 'done' as const })) });
    await restoreNewWorksScanState(runtimeDeps);
    expect(runtimeDeps.showSummaryToast).not.toHaveBeenCalled();
  });

  it('interrupted → 一次性提示，不动进度 UI', async () => {
    const runtimeDeps = deps({ queryStatus: vi.fn(async () => ({ status: 'interrupted' as const })) });

    await restoreNewWorksScanState(runtimeDeps);

    expect(runtimeDeps.showInterruptedToast).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.restoreProgressUI).not.toHaveBeenCalled();
    expect(runtimeDeps.showSummaryToast).not.toHaveBeenCalled();
  });

  it('查询失败 → logError 静默返回，不抛、无 UI 副作用', async () => {
    const runtimeDeps = deps({ queryStatus: vi.fn(async () => { throw new Error('no SW'); }) });

    await expect(restoreNewWorksScanState(runtimeDeps)).resolves.toBeUndefined();
    expect(runtimeDeps.logError).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.restoreProgressUI).not.toHaveBeenCalled();
    expect(runtimeDeps.showSummaryToast).not.toHaveBeenCalled();
    expect(runtimeDeps.showInterruptedToast).not.toHaveBeenCalled();
  });
});

describe('文案 builder（最终措辞由 coord 核版，机制已批）', () => {
  it('done 摘要 toast 精确措辞（C-B；10-19 删「重新检查可入库」分句：pending>0 已改由恢复回填直接给出确认弹窗）', () => {
    expect(buildScanSummaryToastMessage('done', {
      discovered: 2, identifiedTotal: 3, pendingCount: 2, existingCount: 1, cancelled: false, errorCount: 0,
    })).toBe('新作品检查已完成：已识别 3，可入库 2（刷新期间完成，未写入新作品库）');
  });

  it('cancelled 摘要 toast 精确措辞（C-B 变体）', () => {
    expect(buildScanSummaryToastMessage('cancelled', {
      discovered: 0, identifiedTotal: 3, pendingCount: 1, existingCount: 0, cancelled: true, errorCount: 0,
    })).toBe('新作品检查已取消：已识别 3，已收集 1（未写入新作品库）');
  });

  it('interrupted 提示精确措辞（一次性轻提示）', () => {
    expect(buildScanInterruptedToastMessage()).toBe('上一次新作品检查已中断（扩展后台服务重启），进度未保存');
  });
});


describe('terminal + pendingCount>0 → 恢复回填确认（10-19）', () => {
  const resultWithPending = { discovered: 2, identifiedTotal: 3, pendingCount: 2, existingCount: 1, cancelled: false, errorCount: 0 };

  it('done + pendingCount>0 + dep 在位 → 摘要 toast 后调 restorePendingWorks(done, result) 逐字', async () => {
    const restorePendingWorks = vi.fn(async () => undefined);
    const runtimeDeps = deps({
      queryStatus: vi.fn(async () => ({ status: 'done' as const, result: resultWithPending })),
      restorePendingWorks,
    });

    await restoreNewWorksScanState(runtimeDeps);

    expect(runtimeDeps.showSummaryToast).toHaveBeenCalledWith('done', resultWithPending);
    expect(restorePendingWorks).toHaveBeenCalledTimes(1);
    expect(restorePendingWorks).toHaveBeenCalledWith('done', resultWithPending);
  });

  it('cancelled + pendingCount>0 → restorePendingWorks(cancelled, result)', async () => {
    const result = { discovered: 0, identifiedTotal: 3, pendingCount: 1, existingCount: 0, cancelled: true, errorCount: 0 };
    const restorePendingWorks = vi.fn(async () => undefined);
    const runtimeDeps = deps({
      queryStatus: vi.fn(async () => ({ status: 'cancelled' as const, result })),
      restorePendingWorks,
    });

    await restoreNewWorksScanState(runtimeDeps);

    expect(restorePendingWorks).toHaveBeenCalledTimes(1);
    expect(restorePendingWorks).toHaveBeenCalledWith('cancelled', result);
  });

  it('pendingCount=0 → 不调 restorePendingWorks（零漂移：现状摘要 toast 即收口）', async () => {
    const restorePendingWorks = vi.fn();
    const runtimeDeps = deps({
      queryStatus: vi.fn(async () => ({ status: 'done' as const, result: { ...resultWithPending, pendingCount: 0 } })),
      restorePendingWorks,
    });

    await restoreNewWorksScanState(runtimeDeps);

    expect(restorePendingWorks).not.toHaveBeenCalled();
  });

  it('dep 未注入（旧调用方）→ 不崩，摘要 toast 照旧', async () => {
    const runtimeDeps = deps({
      queryStatus: vi.fn(async () => ({ status: 'cancelled' as const, result: resultWithPending })),
    });

    await expect(restoreNewWorksScanState(runtimeDeps)).resolves.toBeUndefined();
    expect(runtimeDeps.showSummaryToast).toHaveBeenCalledTimes(1);
  });
});

describe('10-05 F-2 页载再弹孤儿批次（idle/interrupted + storage.session 孤儿批次 → 恢复回填再弹）', () => {
  it('idle + dep 在位 → 调 restoreOrphanPendingWorks() 恰一次，无其它 UI 副作用', async () => {
    const restoreOrphanPendingWorks = vi.fn();
    const d = deps({
      queryStatus: vi.fn(async () => ({ status: 'idle' as const })),
      restoreOrphanPendingWorks,
    });

    await restoreNewWorksScanState(d);

    expect(restoreOrphanPendingWorks).toHaveBeenCalledTimes(1);
    expect(d.restoreProgressUI).not.toHaveBeenCalled();
    expect(d.showSummaryToast).not.toHaveBeenCalled();
    expect(d.showInterruptedToast).not.toHaveBeenCalled();
  });

  it('interrupted + dep 在位 → 一次性提示照发 + 再弹孤儿批次（SW 重启后 terminal 已清但批次留存）', async () => {
    const restoreOrphanPendingWorks = vi.fn();
    const d = deps({
      queryStatus: vi.fn(async () => ({ status: 'interrupted' as const })),
      restoreOrphanPendingWorks,
    });

    await restoreNewWorksScanState(d);

    expect(d.showInterruptedToast).toHaveBeenCalledTimes(1);
    expect(restoreOrphanPendingWorks).toHaveBeenCalledTimes(1);
    expect(d.restoreProgressUI).not.toHaveBeenCalled();
  });

  it('running → 不调孤儿再弹（扫描进行中，无孤儿语义）', async () => {
    const restoreOrphanPendingWorks = vi.fn();
    const d = deps({
      queryStatus: vi.fn(async () => ({ ...RUNNING_STATE })),
      restoreOrphanPendingWorks,
    });

    await restoreNewWorksScanState(d);

    expect(restoreOrphanPendingWorks).not.toHaveBeenCalled();
    expect(d.restoreProgressUI).toHaveBeenCalledTimes(1);
  });

  it('terminal（done+pending>0）→ 走既有 restorePendingWorks 路径，不走孤儿再弹（单页载至多一路径触发）', async () => {
    const result = { discovered: 2, identifiedTotal: 3, pendingCount: 2, existingCount: 1, cancelled: false, errorCount: 0 };
    const restorePendingWorks = vi.fn(async () => undefined);
    const restoreOrphanPendingWorks = vi.fn();
    const d = deps({
      queryStatus: vi.fn(async () => ({ status: 'done' as const, result })),
      restorePendingWorks,
      restoreOrphanPendingWorks,
    });

    await restoreNewWorksScanState(d);

    expect(restorePendingWorks).toHaveBeenCalledTimes(1);
    expect(restoreOrphanPendingWorks).not.toHaveBeenCalled();
  });

  it('dep 未注入（旧调用方）→ idle/interrupted 零副作用不崩（既有行为零漂移）', async () => {
    const idleDeps = deps({ queryStatus: vi.fn(async () => ({ status: 'idle' as const })) });
    await expect(restoreNewWorksScanState(idleDeps)).resolves.toBeUndefined();

    const interruptedDeps = deps({ queryStatus: vi.fn(async () => ({ status: 'interrupted' as const })) });
    await expect(restoreNewWorksScanState(interruptedDeps)).resolves.toBeUndefined();
    expect(interruptedDeps.showInterruptedToast).toHaveBeenCalledTimes(1);
  });

  it('查询失败 → 不调孤儿再弹（查询不可信时不动批次，与现状一致）', async () => {
    const restoreOrphanPendingWorks = vi.fn();
    const d = deps({
      queryStatus: vi.fn(async () => { throw new Error('no SW'); }),
      restoreOrphanPendingWorks,
    });

    await expect(restoreNewWorksScanState(d)).resolves.toBeUndefined();
    expect(d.logError).toHaveBeenCalledTimes(1);
    expect(restoreOrphanPendingWorks).not.toHaveBeenCalled();
  });
});
