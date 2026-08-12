/**
 * @file contentRecordCache.ts
 * @description 内容脚本只保留当前页面需要的记录摘要，详情页再按番号补全。
 */
import type { VideoRecord } from '../../types';
import { dbViewedGet, dbViewedStatusGetMany } from '../../platform/storage/dbRuntimeClient';
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

export async function loadContentRecordSummaries(videoIds: readonly string[]): Promise<void> {
    countContentPerformanceEvent('storage.viewedSummaryQuery');
    const ids = [...new Set(videoIds.filter(Boolean))];
    const missing = ids.filter((id) => !STATE.records[id] && !STATE.recordSummaries[id]);
    if (missing.length === 0) return;

    // “没有记录”也缓存为未跟踪，避免设置刷新或 DOM 观察器反复查询同一批番号。
    missing.forEach((id) => setContentRecordSummary({ id, status: 'untracked', isFavorite: false }));
    const summaries = await dbViewedStatusGetMany(missing);
    countContentPerformanceEvent('storage.viewedSummaryIds', missing.length);
    summaries.forEach(setContentRecordSummary);
    log('[ContentRecordCache] loaded page summaries', { requested: missing.length, found: summaries.length });
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

