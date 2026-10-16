/**
 * @file embyStateRerun.ts
 * @description EMBY_LIBRARY_STATE_UPDATED 广播 re-mark 路径的有界重跑（10-15 A1-1/A1-2 幻视修复）。
 *
 * 根因链（10-16 审计定案）：scheduler 仅在状态写时广播（50ms debounce，
 * background/scheduler.ts）；广播落在「页面未就绪」窗时，contentMessageRouter
 * 的首次 processVisibleItems({ force: true }) 被 isPageProperlyLoaded 门控
 * （content/itemProcessor.ts）整批静默跳过，无重试无兜底；页面就绪后广播不会
 * 重发 → 已入库卡片的隐藏 re-mark 永久丢失 → 「隐藏已入库」概率性幻视。
 *
 * 修法（最小面，全部落在广播 re-mark 路径内）：
 *   - 首次 pass 返回 false（被门控拦截）时，按 EMBY_STATE_RERUN_DELAYS_MS
 *     调度有界重跑；每次重跑自门控（processVisibleItems 内部复查门控，
 *     页面未就绪即静默 no-op），页面恢复即执行 re-mark pass。
 *   - 某次重跑执行成功 → 取消剩余重试（不冗余重跑全量 pass）。
 *   - 全部重跑仍被拦截 → 末次回退 recomputeAllListHiding（无门控；
 *     settings-updated 分支既有兜底先例，仅重算已带来源标记的卡片，无害）。
 *   - 新广播到达即重置重试链（不堆叠）；每次广播都重读最新 STATE，
 *     重跑始终作用于最新索引态。
 * 零新协议消息、零新存储键、广播机制（scheduler）零改动。
 * @module features/listEnhancement
 */
import { log } from '../../contentState';
import { listEnhancementManager } from '../listEnhancementManager';
import { processVisibleItems } from './itemProcessor';

/** 有界重跑延迟（ms）：页面恢复后首个到达档即执行 pass；末次档携带无门控兜底。 */
export const EMBY_STATE_RERUN_DELAYS_MS = [400, 1500, 4000] as const;

let pendingTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearPendingTimers(): void {
    for (const timer of pendingTimers) {
        clearTimeout(timer);
    }
    pendingTimers = [];
}

function runFinalFallback(): void {
    try {
        listEnhancementManager.recomputeAllListHiding();
    } catch (error) {
        log('Failed to recompute list hiding after emby library state rerun fallback:', error as any);
    }
}

function attemptRerun(index: number): void {
    const isLast = index >= EMBY_STATE_RERUN_DELAYS_MS.length - 1;
    let processed = false;
    try {
        processed = processVisibleItems({ force: true });
    } catch (error) {
        log('Emby library state rerun pass failed:', error as any);
    }
    if (processed) {
        // 门控已恢复且 re-mark pass 已执行 → 取消剩余重试（避免冗余全量 pass）
        clearPendingTimers();
        log(`Emby library state rerun #${index + 1} processed after page gate recovered`);
        return;
    }
    if (isLast) {
        runFinalFallback();
    }
}

/**
 * 广播 re-mark 首次 pass 之后调用：调度有界重跑链。
 * 仅在首次 pass 被门控拦截（processVisibleItems 返回 false）时由
 * contentMessageRouter 调用；健康页零成本。新广播会重置既有链（不堆叠）。
 */
export function scheduleEmbyStateRerun(): void {
    clearPendingTimers();
    for (let index = 0; index < EMBY_STATE_RERUN_DELAYS_MS.length; index += 1) {
        const timer = setTimeout(() => attemptRerun(index), EMBY_STATE_RERUN_DELAYS_MS[index]);
        pendingTimers.push(timer);
    }
}

/** 清除全部挂起重跑（测试复位 / 页面卸载场景）。 */
export function cancelEmbyStateRerun(): void {
    clearPendingTimers();
}
