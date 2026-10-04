/**
 * @file newWorksRestoredPendingWorkflow.test.ts
 * @description 10-19：页面刷新后「恢复回填」确认 workflow 单测（纯 DI）：
 *              有批次 → source 逐字交既有确认入库流程（sourceKind='restored' / cancelled 映射 /
 *              元信息 / works 逐字）+ 确认收口后清盘（清盘严格在确认之后）；
 *              无批次 / 空 works → 不确认不清盘（现状零漂移：仅摘要 toast）；
 *              fetch 失败 → logError 静默；确认流程抛错 → logError + 仍清盘、不向上抛。
 * @module dashboard/tabs
 */
import { describe, expect, it, vi } from 'vitest';
import {
  runNewWorksRestoredPendingWorkflow,
  type NewWorksRestoredPendingWorkflowDeps,
} from './newWorksRestoredPendingWorkflow';
import type { ManualPendingBatch } from '../../features/newWorks/newWorksManualPendingBatch';

function makeWorks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `CODE${i + 1}`,
    actorId: 'A1',
    actorName: '演员一',
    title: `作品 ${i + 1}`,
    javdbUrl: `https://example.com/v/CODE${i + 1}`,
    tags: [],
    discoveredAt: 1700000000000 + i,
    isRead: false,
  }));
}

function makeBatch(overrides: Partial<ManualPendingBatch> = {}): ManualPendingBatch {
  return {
    status: 'cancelled',
    startedAt: 1000,
    terminalAt: 2000,
    pendingCount: 2,
    identifiedTotal: 5,
    existingCount: 1,
    breakdown: { dateRange: 2, viewed: 0, browsed: 1, want: 0, ar: 0, categoryBlack: 0 },
    works: makeWorks(2),
    ...overrides,
  };
}

function deps(overrides: Partial<NewWorksRestoredPendingWorkflowDeps> = {}) {
  return {
    fetchPendingBatch: vi.fn(async () => null as ManualPendingBatch | null),
    confirmAndCommit: vi.fn(async () => undefined),
    consumePendingBatch: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('runNewWorksRestoredPendingWorkflow', () => {
  it('有批次（cancelled）→ source 逐字交确认流程（sourceKind=restored + cancelled=true）+ 清盘', async () => {
    const batch = makeBatch();
    const runtimeDeps = deps({ fetchPendingBatch: vi.fn(async () => batch) });

    await runNewWorksRestoredPendingWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.confirmAndCommit).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.confirmAndCommit).toHaveBeenCalledWith({
      cancelled: true,
      identifiedTotal: 5,
      existingCount: 1,
      breakdown: { dateRange: 2, viewed: 0, browsed: 1, want: 0, ar: 0, categoryBlack: 0 },
      pendingWorks: batch.works,
      sourceKind: 'restored',
    });
    expect(runtimeDeps.consumePendingBatch).toHaveBeenCalledTimes(1);
  });

  it('批次 status=done → cancelled=false（其余字段同口径）', async () => {
    const batch = makeBatch({ status: 'done' });
    const runtimeDeps = deps({ fetchPendingBatch: vi.fn(async () => batch) });

    await runNewWorksRestoredPendingWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.confirmAndCommit).toHaveBeenCalledWith(expect.objectContaining({
      cancelled: false,
      sourceKind: 'restored',
      pendingWorks: batch.works,
    }));
  });

  it('清盘严格在确认流程收口之后（调用顺序锁：每批次只弹一次的前提）', async () => {
    const order: string[] = [];
    const batch = makeBatch();
    const runtimeDeps = deps({
      fetchPendingBatch: vi.fn(async () => batch),
      confirmAndCommit: vi.fn(async () => { order.push('confirm'); }),
      consumePendingBatch: vi.fn(() => { order.push('consume'); }),
    });

    await runNewWorksRestoredPendingWorkflow({ deps: runtimeDeps });

    expect(order).toEqual(['confirm', 'consume']);
  });

  it('无批次（null）→ 不确认、不清盘（现状零漂移：仅摘要 toast）', async () => {
    const runtimeDeps = deps();

    await runNewWorksRestoredPendingWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.confirmAndCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.consumePendingBatch).not.toHaveBeenCalled();
    expect(runtimeDeps.logError).not.toHaveBeenCalled();
  });

  it('空 works → 不确认、不清盘（防御：SW 侧本就不落盘空批次）', async () => {
    const runtimeDeps = deps({
      fetchPendingBatch: vi.fn(async () => makeBatch({ works: [], pendingCount: 0 })),
    });

    await runNewWorksRestoredPendingWorkflow({ deps: runtimeDeps });

    expect(runtimeDeps.confirmAndCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.consumePendingBatch).not.toHaveBeenCalled();
  });

  it('fetch 失败 → logError 静默、不确认、不清盘、不抛', async () => {
    const runtimeDeps = deps({
      fetchPendingBatch: vi.fn(async () => { throw new Error('SW 缺席'); }),
    });

    await expect(runNewWorksRestoredPendingWorkflow({ deps: runtimeDeps })).resolves.toBeUndefined();

    expect(runtimeDeps.logError).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.confirmAndCommit).not.toHaveBeenCalled();
    expect(runtimeDeps.consumePendingBatch).not.toHaveBeenCalled();
  });

  it('确认流程抛错（入库失败等）→ logError + 仍清盘（不向上抛，下次重载不再弹，与 live 现状语义一致）', async () => {
    const batch = makeBatch();
    const runtimeDeps = deps({
      fetchPendingBatch: vi.fn(async () => batch),
      confirmAndCommit: vi.fn(async () => { throw new Error('commit failed'); }),
    });

    await expect(runNewWorksRestoredPendingWorkflow({ deps: runtimeDeps })).resolves.toBeUndefined();

    expect(runtimeDeps.logError).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.consumePendingBatch).toHaveBeenCalledTimes(1);
  });
});
