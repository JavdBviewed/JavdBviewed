// src/dashboard/dbClient.ts
// Dashboard 到后台 Service Worker 的 DB 消息封装

import type { LogEntry, VideoRecord, ListRecord, NewWorkRecord } from '../types';
import type { ViewsDaily, ReportMonthly } from '../types/insights';
import type { ActorRecord } from '../types';
import { readLocalViewedStatuses } from './localViewedStatus';

export interface MagnetsQueryParams {
  videoId: string;
  sources?: string[];
  hasSubtitle?: boolean;
  minSizeBytes?: number;
  offset?: number;
  limit?: number;
  orderBy?: 'createdAt' | 'sizeBytes' | 'date';
  order?: 'asc' | 'desc';
}

export interface MagnetCacheRecord {
  key: string;
  videoId: string;
  source: string;
  name: string;
  magnet: string;
  size?: string;
  sizeBytes?: number;
  date?: string;
  seeders?: number;
  leechers?: number;
  hasSubtitle?: boolean;
  quality?: string;
  createdAt: number;
  expireAt?: number;
}

function getDefaultTimeoutMs(type: string): number {
  switch (type) {
    case 'DB:VIEWED_QUERY':
      return 22000;
    case 'DB:LOGS_QUERY':
    case 'DB:MAGNET_PUSH_LOGS_QUERY':
      return 12000;
    default:
      return 8000;
  }
}

function sendMessage<T = any>(type: string, payload?: any, timeoutMs = getDefaultTimeoutMs(type)): Promise<T> {
  const tryOnce = (): Promise<T> => new Promise<T>((resolve, reject) => {
    let timer: number | undefined;
    try {
      timer = window.setTimeout(() => {
        reject(new Error(`DB message timeout: ${type}`));
      }, timeoutMs);
    } catch {}

    // 检查 runtime 是否可用
    if (!chrome?.runtime?.id) {
      if (timer) window.clearTimeout(timer);
      reject(new Error('Extension context invalidated'));
      return;
    }

    try {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        if (timer) window.clearTimeout(timer);
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          reject(new Error(lastErr.message || 'runtime error'));
          return;
        }
        if (!resp || resp.success !== true) {
          reject(new Error(resp?.error || 'unknown db error'));
          return;
        }
        resolve(resp as T);
      });
    } catch (e: any) {
      if (timer) window.clearTimeout(timer);
      reject(e);
    }
  });

  // 针对 Service Worker 冷启动/休眠的“Receiving end does not exist”采用指数退避多次重试
  return new Promise<T>((resolve, reject) => {
    let attempt = 0;
    const maxAttempts = 5;
    const run = () => {
      tryOnce().then(resolve).catch((err: any) => {
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('receiving end does not exist') && attempt < maxAttempts) {
          const delay = [150, 350, 700, 1400, 2200][attempt] || 2200;
          attempt++;
          try { setTimeout(run, delay); } catch { run(); }
          return;
        }
        // 只在最后一次失败时输出警告
        if (attempt >= maxAttempts && msg.includes('receiving end does not exist')) {
          console.warn(`[DB] Background script not responding after ${maxAttempts} attempts for: ${type}`);
        }
        reject(err);
      });
    };
    run();
  });
}

export async function pingBackground(): Promise<void> {
  await sendMessage('ping-background');
}

export async function ensureBackgroundReady(maxWaitMs: number = 4000): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  const delays = [80, 160, 320, 640, 1000, 1200];
  while (true) {
    try {
      await pingBackground();
      return;
    } catch (e) {
      const elapsed = Date.now() - start;
      if (elapsed >= maxWaitMs) throw e;
      const d = delays[Math.min(attempt, delays.length - 1)];
      attempt++;
      await new Promise((r) => setTimeout(r, d));
    }
  }
}

// ----- Viewed APIs -----
export interface ViewedPageParams {
  offset: number;
  limit: number;
  status?: VideoRecord['status'];
  orderBy?: 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
  isFavorite?: boolean;
}

export interface ViewedStats {
  total: number;
  byStatus: Record<string, number>;
  last7Days: number;
  last30Days: number;
}

export interface ViewedQueryParams {
  search?: string;
  status?: VideoRecord['status'] | 'all';
  tags?: string[];
  listIds?: string[];
  orderBy?: 'updatedAt' | 'createdAt' | 'id' | 'title';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  adv?: Array<{ field: string; op: string; value?: string }>;
  isFavorite?: boolean;
}

export async function dbViewedCount(status?: VideoRecord['status']): Promise<number> {
  const resp = await sendMessage<{ success: true; total: number }>('DB:VIEWED_COUNT', { status });
  // @ts-ignore
  return resp.total || 0;
}

export async function dbViewedPage(params: ViewedPageParams): Promise<{ items: VideoRecord[]; total: number }>{
  const resp = await sendMessage<{ success: true; items: VideoRecord[]; total: number }>('DB:VIEWED_PAGE', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

export async function dbViewedStats(): Promise<ViewedStats> {
  const resp = await sendMessage<{ success: true } & ViewedStats>('DB:VIEWED_STATS');
  // @ts-ignore
  return resp as ViewedStats;
}

export async function dbViewedGet(id: string): Promise<VideoRecord | undefined> {
  const resp = await sendMessage<{ success: true; record?: VideoRecord }>('DB:VIEWED_GET', { id });
  // @ts-ignore
  return resp.record;
}

export async function dbViewedStatusGetMany(
  ids: readonly string[],
): Promise<Array<Pick<VideoRecord, 'id' | 'status'>>> {
  if (ids.length === 0) return [];
  if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
    try {
      return await readLocalViewedStatuses(ids);
    } catch {
      // 非 Dashboard 页面、旧数据库或升级窗口继续使用后台兼容路径。
    }
  }
  const resp = await sendMessage<{
    success: true;
    records?: Array<Pick<VideoRecord, 'id' | 'status'>>;
  }>('DB:VIEWED_STATUS_GET_MANY', { ids: [...new Set(ids)] }, 30000);
  return resp.records || [];
}

export async function dbViewedDelete(id: string): Promise<void> {
  await sendMessage('DB:VIEWED_DELETE', { id });
}

export async function dbViewedBulkDelete(ids: string[]): Promise<void> {
  await sendMessage('DB:VIEWED_BULK_DELETE', { ids });
}

// 番号库回收站
export async function dbViewedRestore(id: string): Promise<void> {
  await sendMessage('DB:VIEWED_RESTORE', { id });
}

export async function dbViewedBulkRestore(ids: string[]): Promise<void> {
  await sendMessage('DB:VIEWED_BULK_RESTORE', { ids });
}

export async function dbViewedPurge(id: string): Promise<void> {
  await sendMessage('DB:VIEWED_PURGE', { id });
}

export async function dbViewedBulkPurge(ids: string[]): Promise<void> {
  await sendMessage('DB:VIEWED_BULK_PURGE', { ids });
}

export async function dbViewedQueryRecycleBin(params?: { offset?: number; limit?: number }): Promise<{ items: VideoRecord[]; total: number }> {
  const resp = await sendMessage<{ success: true; items: VideoRecord[]; total: number }>('DB:VIEWED_QUERY_RECYCLE_BIN', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

export async function dbViewedQuery(params: ViewedQueryParams): Promise<{ items: VideoRecord[]; total: number }>{
  const resp = await sendMessage<{ success: true; items: VideoRecord[]; total: number }>('DB:VIEWED_QUERY', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

export async function dbViewedPut(record: VideoRecord): Promise<void> {
  await sendMessage('DB:VIEWED_PUT', { record });
}

export async function dbViewedExport(): Promise<string> {
  const resp = await sendMessage<{ success: true; json: string }>('DB:VIEWED_EXPORT');
  // @ts-ignore
  return resp.json || '[]';
}

export interface ViewedInjectedSourceTagCleanupReport {
  scannedCount: number;
  affectedCount: number;
  tagsRemoved: number;
  categoriesRemoved: number;
  removedTagNames: string[];
  dryRun: boolean;
}

export async function dbViewedCleanInjectedSourceTags(params?: { dryRun?: boolean }): Promise<ViewedInjectedSourceTagCleanupReport> {
  const resp = await sendMessage<{ success: true } & ViewedInjectedSourceTagCleanupReport>(
    'DB:VIEWED_CLEAN_INJECTED_SOURCE_TAGS',
    params || {},
    22000,
  );
  // @ts-ignore
  return resp as ViewedInjectedSourceTagCleanupReport;
}

export async function dbListsGetAll(): Promise<ListRecord[]> {
  const resp = await sendMessage<{ success: true; records: ListRecord[] }>('DB:LISTS_GET_ALL');
  // @ts-ignore
  return resp.records || [];
}

// ----- Lists 增强 APIs -----

/** 新增或更新单条清单记录 */
export async function dbListsPut(record: ListRecord): Promise<void> {
  await sendMessage('DB:LISTS_PUT', { record });
}

/** 删除指定 ID 的清单记录 */
export async function dbListsDelete(id: string): Promise<void> {
  await sendMessage('DB:LISTS_DELETE', { id });
}

/** 获取所有清单（自动补全缺失的 source 字段为 'javdb'） */
export async function dbListsGetAllNormalized(): Promise<ListRecord[]> {
  const resp = await sendMessage<{ success: true; records: ListRecord[] }>('DB:LISTS_GET_ALL_NORMALIZED');
  // @ts-ignore
  return resp.records || [];
}

/** 原子更新单个视频的 listIds（添加或移除指定清单 ID） */
export async function dbViewedPatchList(videoId: string, listId: string, action: 'add' | 'remove'): Promise<void> {
  await sendMessage('DB:VIEWED_PATCH_LIST', { videoId, listId, action });
}

/** 批量更新多个视频的 listIds，支持 videoIds 传 'all' 表示所有视频 */
export async function dbViewedBulkPatchList(
  videoIds: string[] | 'all',
  listId: string,
  action: 'add' | 'remove'
): Promise<{ successCount: number; failCount: number }> {
  const resp = await sendMessage<{ success: true; successCount: number; failCount: number }>(
    'DB:VIEWED_BULK_PATCH_LIST',
    { videoIds, listId, action }
  );
  // @ts-ignore
  return { successCount: resp.successCount ?? 0, failCount: resp.failCount ?? 0 };
}

// ----- Logs APIs -----
export interface LogsQueryParams {
  level?: LogEntry['level'];
  minLevel?: LogEntry['level'] | 'OFF';
  fromMs?: number;
  toMs?: number;
  offset?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  query?: string;
  hasDataOnly?: boolean;
  source?: 'ALL' | 'GENERAL' | 'DRIVE115' | 'MEDIA';
  category?: string; // 新增：日志类别筛选（如 DB、BG、CONTENT等）
}

export async function dbLogsQuery(params: LogsQueryParams): Promise<{ items: LogEntry[]; total: number }>{
  const resp = await sendMessage<{ success: true; items: LogEntry[]; total: number }>('DB:LOGS_QUERY', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

export async function dbLogsClear(beforeMs?: number): Promise<void> {
  await sendMessage('DB:LOGS_CLEAR', { beforeMs });
}

export async function dbLogsExport(): Promise<string> {
  const resp = await sendMessage<{ success: true; json: string }>('DB:LOGS_EXPORT');
  // @ts-ignore
  return resp.json || '[]';
}

export interface MagnetPushLogEntry extends LogEntry {
  id?: number;
  type: 'push_start' | 'push_success' | 'push_failed';
  videoId: string;
  timestampMs: number;
}

export interface MagnetPushLogsQueryParams {
  type?: 'push_start' | 'push_success' | 'push_failed' | 'ALL';
  fromMs?: number;
  toMs?: number;
  offset?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  query?: string;
  status?: 'ALL' | 'SUCCESS' | 'FAILED';
}

export async function dbMagnetPushLogsQuery(params: MagnetPushLogsQueryParams): Promise<{ items: MagnetPushLogEntry[]; total: number }>{
  const resp = await sendMessage<{ success: true; items: MagnetPushLogEntry[]; total: number }>('DB:MAGNET_PUSH_LOGS_QUERY', params);
  return { items: resp.items || [], total: resp.total || 0 } as any;
}

export async function dbMagnetPushLogsClear(beforeMs?: number): Promise<void> {
  await sendMessage('DB:MAGNET_PUSH_LOGS_CLEAR', { beforeMs });
}

export async function dbMagnetPushLogsBulkAdd(entries: MagnetPushLogEntry[]): Promise<void> {
  await sendMessage('DB:MAGNET_PUSH_LOGS_BULK', { entries });
}

export async function dbMagnetPushLogsExport(): Promise<string> {
  const resp = await sendMessage<{ success: true; json: string }>('DB:MAGNET_PUSH_LOGS_EXPORT');
  return (resp as any).json || '[]';
}

export async function dbMagnetsQuery(params: MagnetsQueryParams): Promise<{ items: MagnetCacheRecord[]; total: number }>{
  const resp = await sendMessage<{ success: true; items: MagnetCacheRecord[]; total: number }>('DB:MAGNETS_QUERY', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

// ----- Actors APIs -----

export interface ActorsQueryParams {
  query?: string; // search in name or aliases (substring)
  gender?: 'female' | 'male' | 'unknown';
  category?: 'censored' | 'uncensored' | 'western' | 'unknown';
  blacklist?: 'all' | 'exclude' | 'only';
  sortBy?: 'name' | 'updatedAt' | 'worksCount';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export async function dbActorsPut(record: ActorRecord): Promise<void> {
  await sendMessage('DB:ACTORS_PUT', { record });
}

export async function dbActorsBulkPut(records: ActorRecord[]): Promise<void> {
  await sendMessage('DB:ACTORS_BULK_PUT', { records });
}

export async function dbActorsGet(id: string): Promise<ActorRecord | undefined> {
  const resp = await sendMessage<{ success: true; record?: ActorRecord }>('DB:ACTORS_GET', { id });
  // @ts-ignore
  return resp.record;
}

export async function dbActorsDelete(id: string): Promise<void> {
  await sendMessage('DB:ACTORS_DELETE', { id });
}

// 演员库回收站
export async function dbActorsRestore(id: string): Promise<void> {
  await sendMessage('DB:ACTORS_RESTORE', { id });
}

export async function dbActorsBulkRestore(ids: string[]): Promise<void> {
  await sendMessage('DB:ACTORS_BULK_RESTORE', { ids });
}

export async function dbActorsPurge(id: string): Promise<void> {
  await sendMessage('DB:ACTORS_PURGE', { id });
}

export async function dbActorsBulkPurge(ids: string[]): Promise<void> {
  await sendMessage('DB:ACTORS_BULK_PURGE', { ids });
}

export async function dbActorsQueryRecycleBin(params?: { offset?: number; limit?: number }): Promise<{ items: ActorRecord[]; total: number }> {
  const resp = await sendMessage<{ success: true; items: ActorRecord[]; total: number }>('DB:ACTORS_QUERY_RECYCLE_BIN', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

export async function dbActorsQuery(params: ActorsQueryParams): Promise<{ items: ActorRecord[]; total: number }>{
  const resp = await sendMessage<{ success: true; items: ActorRecord[]; total: number }>('DB:ACTORS_QUERY', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

export async function dbActorsStats(): Promise<{ total: number; byGender: Record<string, number>; byCategory: Record<string, number>; blacklisted: number; recentlyAdded: number; recentlyUpdated: number; }>{
  const resp = await sendMessage<{ success: true; total: number; byGender: Record<string, number>; byCategory: Record<string, number>; blacklisted: number; recentlyAdded: number; recentlyUpdated: number; }>('DB:ACTORS_STATS');
  // @ts-ignore
  return resp;
}

export async function dbActorsExport(): Promise<string> {
  const resp = await sendMessage<{ success: true; json: string }>('DB:ACTORS_EXPORT');
  // @ts-ignore
  return resp.json || '[]';
}

// ----- NewWorks APIs -----

export interface NewWorksQueryParams {
  search?: string;
  filter?: 'all' | 'unread' | 'today' | 'week';
  sort?: 'discoveredAt' | 'releaseDate' | 'actorName';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export async function dbNewWorksPut(record: NewWorkRecord): Promise<void> {
  await sendMessage('DB:NEWWORKS_PUT', { record });
}

export async function dbNewWorksBulkPut(records: NewWorkRecord[]): Promise<void> {
  // 批量写入可能需要更长时间，使用 30 秒超时
  await sendMessage('DB:NEWWORKS_BULK_PUT', { records }, 30000);
}

export async function dbNewWorksDelete(id: string): Promise<void> {
  await sendMessage('DB:NEWWORKS_DELETE', { id });
}

export async function dbNewWorksGet(id: string): Promise<NewWorkRecord | undefined> {
  const resp = await sendMessage<{ success: true; record?: NewWorkRecord }>('DB:NEWWORKS_GET', { id });
  // @ts-ignore
  return resp.record;
}

export async function dbNewWorksGetAll(): Promise<NewWorkRecord[]> {
  const resp = await sendMessage<{ success: true; records: NewWorkRecord[] }>('DB:NEWWORKS_GET_ALL');
  // @ts-ignore
  return resp.records || [];
}

export async function dbNewWorksQuery(params: NewWorksQueryParams): Promise<{ items: NewWorkRecord[]; total: number }>{
  const resp = await sendMessage<{ success: true; items: NewWorkRecord[]; total: number }>('DB:NEWWORKS_QUERY', params);
  // @ts-ignore
  return { items: resp.items || [], total: resp.total || 0 };
}

export async function dbNewWorksStats(): Promise<{ total: number; unread: number; today: number; week: number; }>{
  const resp = await sendMessage<{ success: true; total: number; unread: number; today: number; week: number; }>('DB:NEWWORKS_STATS');
  // @ts-ignore
  return resp;
}

export async function dbNewWorksExport(): Promise<string> {
  const resp = await sendMessage<{ success: true; json: string }>('DB:NEWWORKS_EXPORT');
  // @ts-ignore
  return resp.json || '[]';
}

// ----- Insights APIs -----

export async function dbInsViewsPut(view: ViewsDaily): Promise<void> {
  await sendMessage('DB:INSIGHTS_VIEWS_PUT', { view });
}

export async function dbInsViewsBulkPut(views: ViewsDaily[]): Promise<void> {
  await sendMessage('DB:INSIGHTS_VIEWS_BULK_PUT', { views });
}

export async function dbInsViewsRange(startDate: string, endDate: string): Promise<ViewsDaily[]> {
  const resp = await sendMessage<{ success: true; records: ViewsDaily[] }>('DB:INSIGHTS_VIEWS_RANGE', { startDate, endDate });
  // @ts-ignore
  return resp.records || [];
}

export async function dbInsReportsPut(report: ReportMonthly): Promise<void> {
  await sendMessage('DB:INSIGHTS_REPORTS_PUT', { report });
}

export async function dbInsReportsGet(month: string): Promise<ReportMonthly | undefined> {
  const resp = await sendMessage<{ success: true; record?: ReportMonthly }>('DB:INSIGHTS_REPORTS_GET', { month });
  // @ts-ignore
  return resp.record;
}

export async function dbInsReportsList(limit = 24): Promise<ReportMonthly[]> {
  const resp = await sendMessage<{ success: true; records: ReportMonthly[] }>('DB:INSIGHTS_REPORTS_LIST', { limit });
  // @ts-ignore
  return resp.records || [];
}

export async function dbInsReportsDelete(month: string): Promise<void> {
  await sendMessage('DB:INSIGHTS_REPORTS_DELETE', { month });
}

export async function dbInsReportsExport(): Promise<string> {
  const resp = await sendMessage<{ success: true; json: string }>('DB:INSIGHTS_REPORTS_EXPORT');
  // @ts-ignore
  return resp.json || '[]';
}

export async function dbInsReportsImport(json: string): Promise<number> {
  const resp = await sendMessage<{ success: true; count: number }>('DB:INSIGHTS_REPORTS_IMPORT', { json });
  // @ts-ignore
  return resp.count || 0;
}

// ----- Trends (daily ranges) -----
export async function dbTrendsRecordsRange(startDate: string, endDate: string, mode: 'cumulative' | 'daily' = 'cumulative'): Promise<any[]> {
  const resp = await sendMessage<{ success: true; points: any[] }>('DB:TRENDS_RECORDS_RANGE', { startDate, endDate, mode });
  // @ts-ignore
  return resp.points || [];
}

export async function dbTrendsActorsRange(startDate: string, endDate: string, mode: 'cumulative' | 'daily' = 'cumulative'): Promise<any[]> {
  const resp = await sendMessage<{ success: true; points: any[] }>('DB:TRENDS_ACTORS_RANGE', { startDate, endDate, mode });
  // @ts-ignore
  return resp.points || [];
}

export async function dbTrendsNewWorksRange(startDate: string, endDate: string, mode: 'cumulative' | 'daily' = 'cumulative'): Promise<any[]> {
  const resp = await sendMessage<{ success: true; points: any[] }>('DB:TRENDS_NEWWORKS_RANGE', { startDate, endDate, mode });
  // @ts-ignore
  return resp.points || [];
}

export async function dbNewWorksDailyStatRefresh(): Promise<void> {
  await sendMessage('DB:NEWWORKS_DAILY_STAT_REFRESH');
}

export async function dbNewWorksManualCheck(): Promise<{ success: boolean; result?: { discovered: number; errors: string[]; cancelled?: boolean; identifiedTotal?: number; effectiveTotal?: number }; error?: string }> {
  const resp = await sendMessage<{ success: boolean; result?: { discovered: number; errors: string[]; cancelled?: boolean; identifiedTotal?: number; effectiveTotal?: number }; error?: string }>(
    'new-works-manual-check',
    undefined,
    300000,
  );
  return resp;
}
