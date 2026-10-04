/**
 * @file contentRecordCache.ts
 * @description 内容脚本只保留当前页面需要的记录摘要，详情页再按番号补全。
 */
import type { VideoRecord } from '../../types';
import { dbViewedGet, dbViewedStatusGetMany, dbViewedStatusGetManyFolded } from '../../platform/storage/dbRuntimeClient';
import { STATE, SELECTORS, log, setContentRecord, setContentRecordSummary } from './index';
import { countContentPerformanceEvent } from '../../platform/tasks';

function extractVideoId(item: Element): string | null {
    const title = item.querySelector<HTMLElement>(SELECTORS.VIDEO_ID)?.textContent?.trim();
    if (title) return title;
    const href = item.querySelector<HTMLAnchorElement>('a[href*="/v/"]')?.href || '';
    const match = href.match(/\/v\/([^/?#]+)/);
    return match?.[1] || null;
}

export function collectCurrentListVideoIds(): string[] {
    return [...document.querySelectorAll(SELECTORS.MOVIE_LIST_ITEM)]
        .map(extractVideoId)
        .filter((id): id is string => Boolean(id));
}

/**
 * 在途摘要加载任务。
 * ids 为本次写入占位摘要的番号集；done 在真实摘要落地（含失败）后 settle。
 */
interface SummaryLoadTask {
    ids: Set<string>;
    done: Promise<void>;
}

const inflightSummaryLoads = new Set<SummaryLoadTask>();
/** 番号 → 占位引用数（>0 即“真实摘要尚在途”）。引用计数避免并发批次互相误清。 */
const pendingSummaryRefs = new Map<string, number>();

/** 等待在途摘要落地的最大轮次；每轮至少等一个任务 settle，故必然终止。 */
const SUMMARY_WAIT_MAX_ROUNDS = 8;

function retainPendingSummaries(ids: readonly string[]): void {
    ids.forEach((id) => pendingSummaryRefs.set(id, (pendingSummaryRefs.get(id) ?? 0) + 1));
}

function releasePendingSummaries(ids: readonly string[]): void {
    ids.forEach((id) => {
        const next = (pendingSummaryRefs.get(id) ?? 0) - 1;
        if (next > 0) pendingSummaryRefs.set(id, next);
        else pendingSummaryRefs.delete(id);
    });
}

/**
 * 该番号的摘要是否仍是“untracked 占位、真实结果在途”。
 * 占位不是终态：调用方不得据它定型卡片显隐（否则真实状态落地后无重算路径）。
 */
export function isContentRecordSummaryPending(id: string): boolean {
    return (pendingSummaryRefs.get(id) ?? 0) > 0;
}

/** 从 ids 中挑出仍为占位（真实摘要在途）的番号。 */
export function pickPendingContentRecordIds(ids: readonly string[]): string[] {
    return ids.filter((id) => isContentRecordSummaryPending(id));
}

/** 等待覆盖这些番号的在途摘要加载全部落地（成功或失败均返回）。 */
export async function waitForContentRecordSummaries(ids: readonly string[]): Promise<void> {
    const wanted = new Set(ids);
    for (let round = 0; round < SUMMARY_WAIT_MAX_ROUNDS; round += 1) {
        const relevant: Promise<void>[] = [];
        inflightSummaryLoads.forEach((task) => {
            for (const id of wanted) {
                if (task.ids.has(id)) {
                    relevant.push(task.done);
                    return;
                }
            }
        });
        if (relevant.length === 0) return;
        await Promise.allSettled(relevant);
    }
}

export async function loadContentRecordSummaries(videoIds: readonly string[]): Promise<void> {
    countContentPerformanceEvent('storage.viewedSummaryQuery');
    const ids = [...new Set(videoIds.filter(Boolean))];
    const missing = ids.filter((id) => !STATE.records[id] && !STATE.recordSummaries[id]);
    if (missing.length === 0) return;

    // “没有记录”也缓存为未跟踪，避免设置刷新或 DOM 观察器反复查询同一批番号。
    // 但占位写入后、IDB 结果前的窗口内它不代表真实状态，故登记为 pending（见 waitForContentRecordSummaries）。
    retainPendingSummaries(missing);
    missing.forEach((id) => setContentRecordSummary({ id, status: 'untracked', isFavorite: false }));

    const task: SummaryLoadTask = { ids: new Set(missing), done: Promise.resolve() };
    inflightSummaryLoads.add(task);
    task.done = (async () => {
        try {
            const summaries = await dbViewedStatusGetMany(missing);
            countContentPerformanceEvent('storage.viewedSummaryIds', missing.length);
            summaries.forEach(setContentRecordSummary);
            log('[ContentRecordCache] loaded page summaries', { requested: missing.length, found: summaries.length });
            // issue#51 大小写折叠兜底：欧美卡原文键与记录大写键分裂时精确键必 miss，
            // 对 miss 集一次性折叠查询，命中者以查询键回写真实摘要（覆盖 untracked 占位）。只读路径，写路径零改动。
            const hitIds = new Set(summaries.map((s) => s.id));
            const missSet = missing.filter((id) => !hitIds.has(id));
            if (missSet.length > 0) {
                const folded = await dbViewedStatusGetManyFolded(missSet);
                folded.forEach(setContentRecordSummary);
                log('[ContentRecordCache] folded summary fallback', { requested: missSet.length, found: folded.length });
            }
        } finally {
            inflightSummaryLoads.delete(task);
            releasePendingSummaries(missing);
        }
    })();
    await task.done;
}

export async function loadCurrentPageRecordState(options: { videoId?: string; isListPage?: boolean } = {}): Promise<void> {
    if (options.videoId) {
        const record = await dbViewedGet(options.videoId);
        if (record) setContentRecord(record);
        return;
    }
    if (options.isListPage) {
        await loadContentRecordSummaries(collectCurrentListVideoIds());
    }
}

export async function loadFullContentRecord(videoId: string): Promise<VideoRecord | undefined> {
    const existing = STATE.records[videoId];
    if (existing) return existing;
    const record = await dbViewedGet(videoId);
    if (record) setContentRecord(record);
    return record;
}

