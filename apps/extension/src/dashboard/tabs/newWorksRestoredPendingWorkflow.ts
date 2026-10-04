/**
 * @file newWorksRestoredPendingWorkflow.ts
 * @description 10-19：页面刷新后「恢复回填」确认 workflow（纯 DI）：
 *              取回 SW 持久化的 pending 批次 → 有可用作品则喂既有入库确认流程
 *              （sourceKind='restored' 追加恢复脚注，弹窗/viewmodel/commit 链全复用）；
 *              确认流程收口后必清盘（consume）——无论入库成功 / 不入库 / pending=0 / 异常，
 *              批次只弹一次、永不再现（生命周期不变式 C1/C2）。
 *              无批次 / 空作品 / 取回失败 → 静默 no-op（现状零漂移：仅摘要 toast）。
 * @module dashboard/tabs
 */
import type { ManualPendingBatch } from '../../features/newWorks/newWorksManualPendingBatch';
import type { NewWorksManualConfirmSource } from './newWorksManualConfirmViewModel';

export interface NewWorksRestoredPendingWorkflowDeps {
    /** 只读取回（不消费）；失败 reject，由本流程静默处理 */
    fetchPendingBatch(): Promise<ManualPendingBatch | null>;
    /** 既有「收集-确认-入库」确认流程（与 live 路径同一入口；sourceKind='restored' 追加恢复脚注） */
    confirmAndCommit(source: NewWorksManualConfirmSource): Promise<void>;
    /** 清盘：确认流程收口后必发（含异常；与现状 live 语义一致——入库失败也不再重弹） */
    consumePendingBatch(): void;
    logError(message: string, error: unknown): void;
}

export interface RunNewWorksRestoredPendingWorkflowInput {
    deps: NewWorksRestoredPendingWorkflowDeps;
}

export async function runNewWorksRestoredPendingWorkflow(input: RunNewWorksRestoredPendingWorkflowInput): Promise<void> {
    const { deps } = input;

    let batch: ManualPendingBatch | null;
    try {
        batch = await deps.fetchPendingBatch();
    } catch (error) {
        deps.logError('刷新恢复 pending 批次取回失败，跳过回填确认', error);
        return;
    }

    if (!batch || !Array.isArray(batch.works) || batch.works.length === 0) return;

    try {
        await deps.confirmAndCommit({
            cancelled: batch.status === 'cancelled',
            identifiedTotal: batch.identifiedTotal,
            existingCount: batch.existingCount,
            breakdown: batch.breakdown,
            pendingWorks: batch.works,
            sourceKind: 'restored',
        });
    } catch (error) {
        deps.logError('刷新恢复确认流程异常（仍清盘批次，不再重弹）', error);
    } finally {
        try {
            deps.consumePendingBatch();
        } catch {}
    }
}
