/**
 * @file newWorksScanRestoreWorkflow.ts
 * @description 刷新/重开后扫描状态回填 workflow（纯 DI，issue#52）：
 *              running → 恢复进度 UI（字段逐一映射）；done/cancelled 带摘要 → 一次性摘要 toast
 *              （terminal 状态已被 SW 查询侧消费，无需页面 ack 往返）；interrupted → 一次性轻提示；
 *              idle → 无操作（10-05 F-2：注入 restoreOrphanPendingWorks 时例外——terminal 已被死亡页
 *              消费后 storage.session 可能残留孤儿批次，页载再弹恢复回填；interrupted 同理，
 *              SW 重启清 terminal 但 storage.session 批次留存）；查询失败 → logError 静默返回不抛。
 *              三处新文案 builder 精确字符串锁定（最终措辞由 coord 核版，机制已批）。
 * @module dashboard/tabs
 */
import type { ManualScanResultSummary } from '../../features/newWorks/newWorksScanState';

/** SW 查询通道回传的 running 状态（页面视角，扁平字段；SW 侧完整状态是它的超集） */
export interface RestoreRunningScanState {
    processed?: number;
    total?: number;
    identifiedTotal?: number;
    pendingTotal?: number;
    actorName?: string;
    activeActorNames: string[];
    concurrency?: number;
}

/** 页面侧查询结果（SW ManualScanStatusQueryResult 的页面映射形态） */
export type ScanStatusQueryResult =
    | { status: 'idle' }
    | ({ status: 'running' } & RestoreRunningScanState)
    | { status: 'done' | 'cancelled'; result?: ManualScanResultSummary }
    | { status: 'interrupted' };

export interface NewWorksScanRestoreDeps {
    queryStatus(): Promise<ScanStatusQueryResult>;
    restoreProgressUI(state: RestoreRunningScanState): void;
    showSummaryToast(status: 'done' | 'cancelled', result: ManualScanResultSummary): void;
    showInterruptedToast(): void;
    logError(message: string, error: unknown): void;
    /** 10-19：terminal + pendingCount>0 → 页面取回 SW 持久化作品并喂入库确认弹窗（缺省不处理，零漂移） */
    restorePendingWorks?(status: 'done' | 'cancelled', result: ManualScanResultSummary): Promise<void> | void;
    /**
     * 10-05 F-2：页载再弹孤儿批次。查询结果 idle（terminal 已被死亡页消费）或 interrupted
     * （SW 重启清 terminal）时调用——取回 storage.session 残留孤儿批次并喂入库确认弹窗
     * （复用 10-19 恢复回填链 + R1 脚注；收口必清盘，单页载至多触发一路径，无第三次弹路径）。
     * 缺省不处理（旧调用方零漂移）。
     */
    restoreOrphanPendingWorks?(): Promise<void> | void;
}

export async function restoreNewWorksScanState(deps: NewWorksScanRestoreDeps): Promise<void> {
    let query: ScanStatusQueryResult;
    try {
        query = await deps.queryStatus();
    } catch (error) {
        deps.logError('新作品检查状态查询失败，跳过后填', error);
        return;
    }
    if (!query || query.status === 'idle') {
        // 10-05 F-2：idle 但 storage.session 可能残留孤儿批次（terminal 被死亡页消费后留存）→ 页载再弹
        deps.restoreOrphanPendingWorks?.();
        return;
    }

    switch (query.status) {
        case 'running':
            deps.restoreProgressUI({
                processed: query.processed,
                total: query.total,
                identifiedTotal: query.identifiedTotal,
                pendingTotal: query.pendingTotal,
                actorName: query.actorName,
                activeActorNames: query.activeActorNames,
                concurrency: query.concurrency,
            });
            return;
        case 'done':
        case 'cancelled':
            // terminal 查询即消费（SW 侧已清盘）：只补一次性提示，不做任何持久化
            if (query.result) {
                deps.showSummaryToast(query.status, query.result);
                // 10-19：收集数 > 0 → 取回持久化作品弹入库确认弹窗（批次清盘由确认流程收口锁定）
                if (
                    typeof query.result.pendingCount === 'number'
                    && query.result.pendingCount > 0
                    && deps.restorePendingWorks
                ) {
                    await deps.restorePendingWorks(query.status, query.result);
                }
            }
            return;
        case 'interrupted':
            deps.showInterruptedToast();
            // 10-05 F-2：SW 重启清 terminal 但 storage.session 孤儿批次留存 → 一次性提示后页载再弹
            deps.restoreOrphanPendingWorks?.();
            return;
    }
}

/** C-B 完成/取消摘要 toast（刷新期间完成，未写入新作品库；计数口径，非记录） */
export function buildScanSummaryToastMessage(status: 'done' | 'cancelled', result: ManualScanResultSummary): string {
    const identified = `已识别 ${result.identifiedTotal}`;
    if (status === 'cancelled') {
        return `新作品检查已取消：${identified}，已收集 ${result.pendingCount}（未写入新作品库）`;
    }
    return `新作品检查已完成：${identified}，可入库 ${result.pendingCount}（刷新期间完成，未写入新作品库）`;
}

/** SW 重启致扫描中断的一次性轻提示（低频，不持久化、不弹窗） */
export function buildScanInterruptedToastMessage(): string {
    return '上一次新作品检查已中断（扩展后台服务重启），进度未保存';
}
