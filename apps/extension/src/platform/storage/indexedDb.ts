/**
 * @file indexedDb.ts
 * @description IndexedDB 门面（Facade） —— 提供稳定的 CRUD API，内部由 focused modules 实现
 * @module platform/storage
 *
 * 包含：视频记录、清单、日志、演员、新作、磁力缓存、Insights 等全部表的操作方法。
 */
import type { VideoRecord, ActorRecord, LogEntry, ListRecord, NewWorkRecord } from '../../types';
import { buildNewWorksTrendPointsFromDailyMap, mergeNewWorksDailyStatForTrend } from './trendUtils';
import { getSettings } from '../../utils/storage';
import { normalizeListRecordForUse } from '../../shared/utils/listRecordHelpers';
import { cleanVideoRecordInjectedSourceTags } from '../../shared/utils/tagFilter';
import { enqueueVideoChange, scheduleEnqueue } from '../../features/cloudSync/enqueueLocalChange';
import type { ViewsDaily, ReportMonthly } from '../../types/insights';
import { initDB, resetDBConnection } from './indexedDbConnection';
import { buildLogsIndexedCursorSource, deriveLogCategory, deriveLogSource } from './indexedDbLogFields';
import {
  MAX_INDEX_NUMBER,
  type MagnetCacheRecord,
  type NewWorksDailyStat,
  type PersistedLogEntry,
  type PersistedMagnetPushLogEntry,
  type ViewedTagIndexRecord,
} from './indexedDbSchema';
import {
  buildViewedTimeCursorSource,
  clearViewedSecondaryIndexesByVideoId,
  ensureViewedSecondaryIndexesReady,
  getVideoIdsForListFilter,
  normalizeViewedRecord,
  syncViewedSecondaryIndexes,
} from './indexedDbViewedIndexes';
import { loadActorsForTrend } from './actorTrendQuery';
export { initDB } from './indexedDbConnection';
export { viewedStatusGetMany } from './indexedDbViewedStatus';
export type {
  MagnetCacheRecord,
  NewWorksDailyStat,
  PersistedLogEntry,
  PersistedMagnetPushLogEntry,
  ViewedListIndexRecord,
  ViewedTagIndexRecord,
} from './indexedDbSchema';

// ----- daily trends (records/actors/newWorks) -----

type DateMode = 'cumulative' | 'daily';

function fmtDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function eachDate(startDate: string, endDate: string): { date: string; startMs: number; endMs: number }[] {
  const res: { date: string; startMs: number; endMs: number }[] = [];
  const [sY, sM, sD] = startDate.split('-').map(n => Number(n));
  const [eY, eM, eD] = endDate.split('-').map(n => Number(n));
  let cur = new Date(sY, (sM || 1) - 1, sD || 1);
  const end = new Date(eY, (eM || 1) - 1, eD || 1);
  while (cur.getTime() <= end.getTime()) {
    const dStart = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 0, 0, 0, 0).getTime();
    const dEnd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 23, 59, 59, 999).getTime();
    res.push({ date: fmtDateYMD(cur), startMs: dStart, endMs: dEnd });
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return res;
}

export interface RecordsTrendPoint { date: string; total: number; viewed: number; browsed: number; want: number; }
export async function trendsRecordsRange(startDate: string, endDate: string, mode: DateMode = 'cumulative'): Promise<RecordsTrendPoint[]> {
  const db = await initDB();
  const store = db.transaction('viewedRecords').store;
  const idxCreated = store.index('by_createdAt');
  const items: RecordsTrendPoint[] = [];
  const dates = eachDate(startDate, endDate);
  
  if (mode === 'daily') {
    // 每日模式：只查询一次所有数据，然后按日期分组
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    // @ts-ignore
    const allRecords = await idxCreated.getAll(IDBKeyRange.bound(firstDate.startMs, lastDate.endMs));
    
    // 按日期分组统计
    for (const d of dates) {
      let total = 0, viewed = 0, browsed = 0, want = 0;
      for (const r of allRecords) {
        const ts = (r as any)?.createdAt || 0;
        if (ts >= d.startMs && ts <= d.endMs) {
          total++;
          const status = (r as any)?.status;
          if (status === 'viewed') viewed++;
          else if (status === 'browsed') browsed++;
          else if (status === 'want') want++;
        }
      }
      items.push({ date: d.date, total, viewed, browsed, want });
    }
  } else {
    // 累计模式：查询一次所有数据，然后累计计算
    const lastDate = dates[dates.length - 1];
    // @ts-ignore
    const allRecords = await idxCreated.getAll(IDBKeyRange.upperBound(lastDate.endMs));
    
    // 按 createdAt 排序
    allRecords.sort((a: any, b: any) => ((a?.createdAt || 0) - (b?.createdAt || 0)));
    
    let recordIndex = 0;
    let cumulativeTotal = 0, cumulativeViewed = 0, cumulativeBrowsed = 0, cumulativeWant = 0;
    
    for (const d of dates) {
      // 累加到当前日期为止的所有记录
      while (recordIndex < allRecords.length && (allRecords[recordIndex] as any)?.createdAt <= d.endMs) {
        const r = allRecords[recordIndex];
        cumulativeTotal++;
        const status = (r as any)?.status;
        if (status === 'viewed') cumulativeViewed++;
        else if (status === 'browsed') cumulativeBrowsed++;
        else if (status === 'want') cumulativeWant++;
        recordIndex++;
      }
      items.push({ date: d.date, total: cumulativeTotal, viewed: cumulativeViewed, browsed: cumulativeBrowsed, want: cumulativeWant });
    }
  }
  
  return items;
}

export interface ActorsTrendPoint { date: string; total: number; female: number; male: number; blacklisted: number; }
export async function trendsActorsRange(startDate: string, endDate: string, mode: DateMode = 'cumulative'): Promise<ActorsTrendPoint[]> {
  const db = await initDB();
  const days = eachDate(startDate, endDate);
  const lastDate = days[days.length - 1];
  if (!lastDate) return [];
  const all = await loadActorsForTrend(db, lastDate.endMs);
  const points: ActorsTrendPoint[] = [];
  
  // 预处理：提取时间戳并排序
  const actorsWithTs = all.map(a => ({
    actor: a,
    ts: typeof (a as any)?.createdAt === 'number' ? (a as any).createdAt : (typeof (a as any)?.updatedAt === 'number' ? (a as any).updatedAt : 0),
    gender: (a as any)?.gender,
    blacklisted: !!(a as any)?.blacklisted
  })).filter(item => item.ts > 0);
  
  if (mode === 'daily') {
    // 每日模式：按日期分组
    for (const d of days) {
      let total = 0, female = 0, male = 0, blacklisted = 0;
      for (const item of actorsWithTs) {
        if (item.ts >= d.startMs && item.ts <= d.endMs) {
          total++;
          if (item.gender === 'female') female++;
          else if (item.gender === 'male') male++;
          if (item.blacklisted) blacklisted++;
        }
      }
      points.push({ date: d.date, total, female, male, blacklisted });
    }
  } else {
    // 累计模式：排序后累加
    actorsWithTs.sort((a, b) => a.ts - b.ts);
    
    let actorIndex = 0;
    let cumulativeTotal = 0, cumulativeFemale = 0, cumulativeMale = 0, cumulativeBlacklisted = 0;
    
    for (const d of days) {
      while (actorIndex < actorsWithTs.length && actorsWithTs[actorIndex].ts <= d.endMs) {
        const item = actorsWithTs[actorIndex];
        cumulativeTotal++;
        if (item.gender === 'female') cumulativeFemale++;
        else if (item.gender === 'male') cumulativeMale++;
        if (item.blacklisted) cumulativeBlacklisted++;
        actorIndex++;
      }
      points.push({ date: d.date, total: cumulativeTotal, female: cumulativeFemale, male: cumulativeMale, blacklisted: cumulativeBlacklisted });
    }
  }
  
  return points;
}

// ----- newWorksDailyStats API -----

export async function newWorksDailyStatGet(date: string): Promise<NewWorksDailyStat | undefined> {
  const db = await initDB();
  return db.get('newWorksDailyStats', date);
}

export async function newWorksDailyStatPut(stat: NewWorksDailyStat): Promise<void> {
  const db = await initDB();
  await db.put('newWorksDailyStats', stat);
  try {
    const { scheduleEnqueue, enqueueNewWorkDailyStatChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueNewWorkDailyStatChange(stat));
  } catch { /* Cloud 可选 */ }
}

export async function newWorksDailyStatsRange(startDate: string, endDate: string): Promise<NewWorksDailyStat[]> {
  const db = await initDB();
  const all = await db.getAll('newWorksDailyStats');
  return all.filter(s => s.date >= startDate && s.date <= endDate);
}

/**
 * 更新当日快照：统计 IDB 中今日发现的作品数量（total/unread），
 * 并与已有快照取最大值（防止清理后数值下降）。
 */
export async function newWorksDailyStatRefreshToday(): Promise<void> {
  try {
    const db = await initDB();
    const today = fmtDateYMD(new Date());
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);

    // 统计今日 IDB 中的数据
    const store = db.transaction('newWorks').store;
    const idxDisc = store.index('by_discoveredAt');
    // @ts-ignore
    const todayRecords = await idxDisc.getAll(IDBKeyRange.bound(dayStart.getTime(), dayEnd.getTime()));
    const liveTotal = todayRecords.length;
    const liveUnread = todayRecords.filter((w: any) => !w.isRead).length;

    // 与已有快照取最大值（已读/清理不会让快照数值下降）
    const existing = await db.get('newWorksDailyStats', today);
    const stat: NewWorksDailyStat = {
      date: today,
      total: Math.max(liveTotal, existing?.total ?? 0),
      unread: Math.max(liveUnread, existing?.unread ?? 0),
    };
    await db.put('newWorksDailyStats', stat);
    try {
      const { scheduleEnqueue, enqueueNewWorkDailyStatChange } = await import('../../features/cloudSync/enqueueLocalChange');
      scheduleEnqueue(() => enqueueNewWorkDailyStatChange(stat));
    } catch { /* Cloud 可选 */ }
  } catch {}
}

export interface NewWorksTrendPoint { date: string; total: number; unread: number; }
export async function trendsNewWorksRange(startDate: string, endDate: string, mode: DateMode = 'cumulative'): Promise<NewWorksTrendPoint[]> {
  const db = await initDB();
  const dates = eachDate(startDate, endDate);
  const dailyMap = new Map<string, { total: number; unread: number }>();
  const countDay = (records: any[], d: { startMs: number; endMs: number }) => {
    let total = 0, unread = 0;
    for (const w of records) {
      const ts = (w as any)?.discoveredAt || 0;
      if (ts >= d.startMs && ts <= d.endMs) {
        total++;
        if (!(w as any)?.isRead) unread++;
      }
    }
    return { total, unread };
  };

  // 读取快照数据（key 为 date 字符串，直接范围过滤）
  const snapshots = await db.getAll('newWorksDailyStats');
  const snapMap = new Map<string, NewWorksDailyStat>();
  for (const s of snapshots) {
    if (s.date >= startDate && s.date <= endDate) snapMap.set(s.date, s);
  }

  if (mode === 'daily') {
    // 每日模式：优先用快照，快照没有的日期从 IDB 实时查
    const store = db.transaction('newWorks').store;
    const idxDisc = store.index('by_discoveredAt');
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    // @ts-ignore
    const allRecords = await idxDisc.getAll(IDBKeyRange.bound(firstDate.startMs, lastDate.endMs));

    for (const d of dates) {
      const snap = snapMap.get(d.date);
      dailyMap.set(d.date, mergeNewWorksDailyStatForTrend(snap, countDay(allRecords, d)));
    }
  } else {
    // 累计模式：先用快照补全每日数据，再累加
    // 对于没有快照的日期，从 IDB 实时查
    const store = db.transaction('newWorks').store;
    const idxDisc = store.index('by_discoveredAt');
    const lastDate = dates[dates.length - 1];
    // @ts-ignore
    const allRecords = await idxDisc.getAll(IDBKeyRange.upperBound(lastDate.endMs));
    allRecords.sort((a: any, b: any) => ((a?.discoveredAt || 0) - (b?.discoveredAt || 0)));

    // 构建每日数据（快照优先）
    for (const d of dates) {
      const snap = snapMap.get(d.date);
      dailyMap.set(d.date, mergeNewWorksDailyStatForTrend(snap, countDay(allRecords, d)));
    }

    // 累加
  }

  return buildNewWorksTrendPointsFromDailyMap(dates, dailyMap, mode);
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

export interface ViewedPageParams {
  offset?: number;
  limit?: number;
  status?: VideoRecord['status'];
  orderBy?: 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
  isFavorite?: boolean;
}

export async function viewedQuery(params: ViewedQueryParams): Promise<{ items: VideoRecord[]; total: number }> {
  const { search = '', status = 'all', tags = [], listIds = [], orderBy = 'updatedAt', order = 'desc', offset = 0, limit = 50, isFavorite } = params || {} as any;
  const lower = String(search || '').trim().toLowerCase();
  const needTags = Array.isArray(tags) && tags.length > 0;
  const needListIds = Array.isArray(listIds) && listIds.length > 0;
  const adv = Array.isArray(params?.adv) ? params!.adv! : [];
  const favoriteOnly = isFavorite === true;

  if (!lower && !needTags && !needListIds && adv.length === 0 && (orderBy === 'updatedAt' || orderBy === 'createdAt')) {
    return viewedPage({
      offset,
      limit,
      status: status !== 'all' ? status as VideoRecord['status'] : undefined,
      orderBy,
      order,
      isFavorite: favoriteOnly,
    });
  }

  const usesCandidateIndexes = needListIds;
  if (usesCandidateIndexes) {
    try {
      const db = await initDB();
      const indexesReady = await ensureViewedSecondaryIndexesReady(db, false, needListIds);
      if (indexesReady) {
        const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList']);
        const viewedStore = tx.objectStore('viewedRecords');
        const listCandidates = await getVideoIdsForListFilter(tx.objectStore('viewedByList'), listIds);
        const shouldFallbackToScan = listCandidates == null;
        if (!shouldFallbackToScan) {
          if (listCandidates.size === 0) {
            return { items: [], total: 0 };
          }
          const list: VideoRecord[] = [];
          const ids = Array.from(listCandidates);
          for (const videoId of ids) {
        const r = await viewedStore.get(videoId) as VideoRecord | undefined;
        if (!r) continue;
        if (r.deletedAt) continue; // 跳过已删除记录
        if (status && status !== 'all' && r.status !== status) continue;
        if (favoriteOnly && r.isFavorite !== true) continue;
        if (lower) {
          const idS = (r.id || '').toLowerCase();
          const titleS = (r.title || '').toLowerCase();
          const tagsArr = [
            ...(Array.isArray(r.tags) ? r.tags : []),
            ...(Array.isArray(r.userTags) ? r.userTags : []),
          ];
          const inTags = tagsArr.some(t => String(t || '').toLowerCase().includes(lower));
          if (!idS.includes(lower) && !titleS.includes(lower) && !inTags) continue;
        }
        if (needTags) {
          const arr = [
            ...(Array.isArray(r.tags) ? r.tags : []),
            ...(Array.isArray(r.userTags) ? r.userTags : []),
          ];
          const arrLower = arr.map(s => String(s).toLowerCase());
          const queryLower = tags.map(s => String(s).toLowerCase());
          if (!queryLower.every(qt => arrLower.some(t => t.includes(qt)))) continue;
        }
        if (needListIds) {
          const recListIds = Array.isArray((r as any).listIds) ? ((r as any).listIds as string[]) : [];
          if (recListIds.length === 0) continue;
          if (!listIds.some((id) => recListIds.includes(String(id)))) continue;
        }
        if (adv.length > 0 && !matchAdvBasic(r, adv)) continue;
        list.push(r);
      }

      if (orderBy === 'id' || orderBy === 'title') {
        list.sort((a, b) => {
          const av = String((orderBy === 'id' ? a.id : a.title) || '');
          const bv = String((orderBy === 'id' ? b.id : b.title) || '');
          return order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      } else {
        list.sort((a, b) => {
          const aVal = orderBy === 'createdAt' ? (a.createdAt || 0) : (a.updatedAt || 0);
          const bVal = orderBy === 'createdAt' ? (b.createdAt || 0) : (b.updatedAt || 0);
          return order === 'asc' ? aVal - bVal : bVal - aVal;
        });
      }

          const total = list.length;
          const items = list.slice(offset, offset + limit);
          return { items, total };
        }
      }
    } catch {}
  }

  const db = await initDB();
  const tx = db.transaction('viewedRecords');
  const store = tx.store;

  let source: any = store;
  let range: IDBKeyRange | undefined = undefined;
  const dir = order === 'asc' ? 'next' : 'prev';
  if (orderBy === 'updatedAt' || orderBy === 'createdAt') {
    try {
      const selected = buildViewedTimeCursorSource(store, {
        status: status !== 'all' ? status as VideoRecord['status'] : undefined,
        orderBy,
        favoriteOnly,
      });
      source = selected.source;
      range = selected.range;
    } catch {
      if (status && status !== 'all') {
        const idxName = orderBy === 'createdAt' ? 'by_status_createdAt' : 'by_status_updatedAt';
        source = store.index(idxName as any);
        range = IDBKeyRange.bound([status, 0] as any, [status, MAX_INDEX_NUMBER] as any);
      } else {
        const idxName = orderBy === 'createdAt' ? 'by_createdAt' : 'by_updatedAt';
        source = store.index(idxName as any);
      }
    }
  } else if (status && status !== 'all') {
    source = store.index('by_status');
    range = IDBKeyRange.only(status);
  }

  const list: VideoRecord[] = [];
  for (let cursor = await source.openCursor(range as any, dir); cursor; cursor = await cursor.continue()) {
    const r = cursor.value as VideoRecord;
    if (!r) continue;
    if (r.deletedAt) continue; // 跳过已删除记录
    if (status && status !== 'all' && r.status !== status) continue;
    if (favoriteOnly && r.isFavorite !== true) continue;

    if (lower) {
      const idS = (r.id || '').toLowerCase();
      const titleS = (r.title || '').toLowerCase();
      const tagsArr = [
        ...(Array.isArray(r.tags) ? r.tags : []),
        ...(Array.isArray(r.userTags) ? r.userTags : []),
      ];
      const inTags = tagsArr.some(t => String(t || '').toLowerCase().includes(lower));
      if (!idS.includes(lower) && !titleS.includes(lower) && !inTags) continue;
    }
    if (needTags) {
      const arr = [
        ...(Array.isArray(r.tags) ? r.tags : []),
        ...(Array.isArray(r.userTags) ? r.userTags : []),
      ];
      const arrLower = arr.map(s => String(s).toLowerCase());
      const queryLower = tags.map(s => String(s).toLowerCase());
      if (!queryLower.every(qt => arrLower.some(t => t.includes(qt)))) continue;
    }
    if (needListIds) {
      const recListIds = Array.isArray((r as any).listIds) ? ((r as any).listIds as string[]) : [];
      if (recListIds.length === 0) continue;
      if (!listIds.some((id) => recListIds.includes(String(id)))) continue;
    }
    if (adv.length > 0 && !matchAdvBasic(r, adv)) continue;
    list.push(r);
  }

  if (orderBy === 'id' || orderBy === 'title') {
    list.sort((a, b) => {
      const av = String((orderBy === 'id' ? a.id : a.title) || '');
      const bv = String((orderBy === 'id' ? b.id : b.title) || '');
      return order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  const total = list.length;
  const items = list.slice(offset, offset + limit);
  return { items, total };
}

function matchAdvBasic(r: VideoRecord, adv: Array<{ field: string; op: string; value?: string }>): boolean {
  const get = (k: string): any => {
    switch (k) {
      case 'id': return r.id || '';
      case 'title': return r.title || '';
      case 'status': return r.status || '';
      case 'tags': return Array.isArray(r.tags) ? r.tags : [];
      case 'releaseDate': return r.releaseDate || '';
      case 'createdAt': return r.createdAt;
      case 'updatedAt': return r.updatedAt;
      case 'rating': return r.rating;
      case 'userRating': return r.userRating;
      case 'javdbUrl': return r.javdbUrl || '';
      case 'javdbImage': return r.javdbImage || '';
      default: return undefined;
    }
  };
  for (const c of adv) {
    const v = get(c.field);
    const op = c.op;
    const val = c.value ?? '';
    const isRatingField = c.field === 'rating' || c.field === 'userRating';
    const isRated = Number.isFinite(Number(v)) && Number(v) > 0;
    if (op === 'empty') {
      if (isRatingField ? isRated : !(v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === ''))) return false;
      continue;
    }
    if (op === 'not_empty') {
      if (isRatingField ? !isRated : v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '')) return false;
      continue;
    }

    // 文本比较：与前端一致，忽略大小写
    if (op === 'contains' || op === 'equals' || op === 'starts_with' || op === 'ends_with') {
      const sv = String(v ?? '').toLowerCase();
      const cv = String(val ?? '').toLowerCase();
      if (op === 'contains' && !sv.includes(cv)) return false;
      if (op === 'equals' && !(sv === cv)) return false;
      if (op === 'starts_with' && !sv.startsWith(cv)) return false;
      if (op === 'ends_with' && !sv.endsWith(cv)) return false;
      continue;
    }

    // tags 比较
    if (op === 'includes' || op === 'includes_all' || op === 'includes_any') {
      const arr: string[] = Array.isArray(v) ? v : [];
      if (op === 'includes') {
        if (!arr.includes(String(val))) return false; // 精确匹配
        continue;
      }
      const arrLower = arr.map(s => String(s).toLowerCase());
      const tokens = String(val || '').split(/[，,;；\s]+/).map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase());
      if (tokens.length === 0) return false;
      if (op === 'includes_all') { if (!tokens.every(tok => arrLower.some(tag => tag.includes(tok)))) return false; continue; }
      if (op === 'includes_any') { if (!tokens.some(tok => arrLower.some(tag => tag.includes(tok)))) return false; continue; }
    }
    // 数组长度比较（如 tags 长度）
    if (op === 'length_eq' || op === 'length_gt' || op === 'length_gte' || op === 'length_lt') {
      const arr = Array.isArray(v) ? v : [];
      const cmp = Number(val);
      if (Number.isNaN(cmp)) return false;
      if (op === 'length_eq' && !(arr.length === cmp)) return false;
      if (op === 'length_gt' && !(arr.length > cmp)) return false;
      if (op === 'length_gte' && !(arr.length >= cmp)) return false;
      if (op === 'length_lt' && !(arr.length < cmp)) return false;
      continue;
    }
    // 数值比较
    const num = Number(v);
    const cmp = Number(val);
    if (['gt', 'gte', 'lt', 'lte', 'eq'].includes(op)) {
      if ((isRatingField && !isRated) || Number.isNaN(num) || Number.isNaN(cmp)) return false;
      if (op === 'gt' && !(num > cmp)) return false;
      if (op === 'gte' && !(num >= cmp)) return false;
      if (op === 'lt' && !(num < cmp)) return false;
      if (op === 'lte' && !(num <= cmp)) return false;
      if (op === 'eq' && !(num === cmp)) return false;
    }
  }
  return true;
}
// ----- lists API -----

export async function listsPut(record: ListRecord): Promise<void> {
  const db = await initDB();
  await db.put('lists', record);
  try {
    const { scheduleEnqueue, enqueueListChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueListChange(record));
  } catch { /* Cloud 可选 */ }
}

export async function listsBulkPut(records: ListRecord[]): Promise<void> {
  if (!records || records.length === 0) return;
  const db = await initDB();
  const tx = db.transaction('lists', 'readwrite');
  try {
    for (const r of records) {
      await tx.store.put(r);
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
  try {
    const { scheduleEnqueue, enqueueListChanges } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueListChanges(records));
  } catch { /* Cloud 可选 */ }
}

export async function listsGet(id: string): Promise<ListRecord | undefined> {
  const db = await initDB();
  return db.get('lists', id);
}

export async function listsGetAll(): Promise<ListRecord[]> {
  const db = await initDB();
  return db.getAll('lists');
}

export async function listsClear(): Promise<void> {
  const db = await initDB();
  await db.clear('lists');
}

export async function listsDelete(id: string): Promise<void> {
  const db = await initDB();
  await db.delete('lists', id);
}

/**
 * 规范化清单记录：对缺失 source 字段的旧数据补全为 'javdb'，不修改其他字段
 */
function normalizeListRecord(r: any): ListRecord {
  return normalizeListRecordForUse({ ...r, source: r.source ?? 'javdb' });
}

/**
 * 获取所有清单并规范化 source 字段（兼容旧数据）
 */
export async function listsGetAllNormalized(): Promise<ListRecord[]> {
  const records = await listsGetAll();
  return records.map(normalizeListRecord);
}

/**
 * 按 ID 获取单条清单并规范化 source 字段（兼容旧数据）
 */
export async function listsGetNormalized(id: string): Promise<ListRecord | undefined> {
  const record = await listsGet(id);
  if (!record) return undefined;
  return normalizeListRecord(record);
}

/**
 * 按来源查询清单（使用 by_source 索引）
 */
export async function listsGetBySource(source: 'javdb' | 'local'): Promise<ListRecord[]> {
  const db = await initDB();
  const idx = db.transaction('lists').store.index('by_source');
  // @ts-ignore
  const records = await idx.getAll(IDBKeyRange.only(source));
  return records.map(normalizeListRecord);
}

/**
 * 原子更新单个视频的 listIds（在单个 IndexedDB 事务中完成读取-修改-写入）
 * 使用 Set 保证幂等性：add 时不重复添加，remove 时安全删除
 */
export async function viewedPatchListIds(
  videoId: string,
  listId: string,
  action: 'add' | 'remove'
): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
  const viewedStore = tx.objectStore('viewedRecords');
  const oldRecord = await viewedStore.get(videoId);
  if (!oldRecord) { await tx.done; return; }
  const record = normalizeViewedRecord(oldRecord);
  const ids = new Set<string>(Array.isArray(record.listIds) ? record.listIds : []);
  if (action === 'add') ids.add(listId);
  else ids.delete(listId);
  record.listIds = Array.from(ids);
  record.updatedAt = Date.now();
  await viewedStore.put(record as any);
  await syncViewedSecondaryIndexes(tx.objectStore('viewedByTag'), tx.objectStore('viewedByList'), oldRecord, record);
  await tx.done;
}

/**
 * 批量更新多个视频的 listIds
 * @param videoIds 视频 ID 数组，或 'all' 表示所有视频
 * @param listId 目标清单 ID
 * @param action 'add' 或 'remove'
 * @returns 成功与失败计数
 */
export async function viewedBulkPatchListIds(
  videoIds: string[] | 'all',
  listId: string,
  action: 'add' | 'remove'
): Promise<{ successCount: number; failCount: number }> {
  let ids: string[];
  if (videoIds === 'all') {
    const db = await initDB();
    ids = await db.getAllKeys('viewedRecords') as string[];
  } else {
    ids = videoIds;
  }

  let successCount = 0;
  let failCount = 0;

  // 串行执行，单条失败不中断整体流程
  for (const videoId of ids) {
    try {
      await viewedPatchListIds(videoId, listId, action);
      successCount++;
    } catch {
      failCount++;
    }
  }

  return { successCount, failCount };
}

// ----- viewedRecords API -----

/** viewedPut 结果 */
export interface ViewedPutResult {
  success: boolean;
  skipped?: boolean;  // 记录在回收站中，跳过更新
  reason?: string;
}

export async function viewedPut(record: VideoRecord): Promise<ViewedPutResult> {
  const db = await initDB();
  const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
  const viewedStore = tx.objectStore('viewedRecords');
  const normalized = normalizeViewedRecord(record);
  const oldRecord = await viewedStore.get(normalized.id) as VideoRecord | undefined;
  // 如果记录在回收站中，跳过更新（保留软删除状态）
  if (oldRecord?.deletedAt) {
    await tx.done;
    return { success: true, skipped: true, reason: 'record_in_trash' };
  }
  await viewedStore.put(normalized as any);
  await syncViewedSecondaryIndexes(tx.objectStore('viewedByTag'), tx.objectStore('viewedByList'), oldRecord, normalized);
  await tx.done;
  // A local database write is durable before this point. Cloud's pending queue
  // must not hold content-page work or its cross-page lease open.
  scheduleEnqueue(() => enqueueVideoChange(normalized as VideoRecord));
  return { success: true };
}

export async function viewedBulkPut(records: VideoRecord[]): Promise<void> {
  if (!records || records.length === 0) return;
  const db = await initDB();
  const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
  const viewedStore = tx.objectStore('viewedRecords');
  const written: VideoRecord[] = [];
  try {
    for (const r of records) {
      const normalized = normalizeViewedRecord(r);
      const oldRecord = await viewedStore.get(normalized.id) as VideoRecord | undefined;
      // 如果记录在回收站中，跳过更新（保留软删除状态）
      if (oldRecord?.deletedAt) continue;
      await viewedStore.put(normalized as any);
      await syncViewedSecondaryIndexes(tx.objectStore('viewedByTag'), tx.objectStore('viewedByList'), oldRecord, normalized);
      written.push(normalized as VideoRecord);
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
  if (written.length) {
    try {
      const { scheduleEnqueue, enqueueVideoChanges } = await import('../../features/cloudSync/enqueueLocalChange');
      scheduleEnqueue(() => enqueueVideoChanges(written));
    } catch { /* Cloud 可选 */ }
  }
}

export interface ViewedInjectedSourceTagCleanupReport {
  scannedCount: number;
  affectedCount: number;
  tagsRemoved: number;
  categoriesRemoved: number;
  removedTagNames: string[];
  dryRun: boolean;
}

export interface ViewedInjectedSourceTagCleanupOptions {
  dryRun?: boolean;
  nowMs?: number;
}

function mergeRemovedTagNames(target: string[], names: string[]): void {
  const seen = new Set(target.map((name) => String(name || '').trim().toLowerCase()).filter(Boolean));
  for (const name of names) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    target.push(name);
  }
}

/**
 * 清理历史记录里由详情页增强来源入口误写入的标签，并同步刷新标签二级索引。
 */
export async function viewedCleanInjectedSourceTags(
  options: ViewedInjectedSourceTagCleanupOptions = {},
): Promise<ViewedInjectedSourceTagCleanupReport> {
  const dryRun = options.dryRun === true;
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
  const db = await initDB();
  const allRecords = await db.getAll('viewedRecords') as VideoRecord[];
  const activeRecords = allRecords.filter((record) => !record.deletedAt);
  const changedPairs: Array<{ oldRecord: VideoRecord; newRecord: VideoRecord }> = [];
  const removedTagNames: string[] = [];
  let tagsRemoved = 0;
  let categoriesRemoved = 0;

  for (const record of activeRecords) {
    const cleanup = cleanVideoRecordInjectedSourceTags(record, nowMs);
    if (!cleanup.changed) continue;
    changedPairs.push({ oldRecord: record, newRecord: cleanup.record });
    tagsRemoved += cleanup.tagsRemoved;
    categoriesRemoved += cleanup.categoriesRemoved;
    mergeRemovedTagNames(removedTagNames, cleanup.removedTagNames);
  }

  if (!dryRun && changedPairs.length > 0) {
    const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
    const viewedStore = tx.objectStore('viewedRecords');
    const tagStore = tx.objectStore('viewedByTag');
    const listStore = tx.objectStore('viewedByList');
    const written: VideoRecord[] = [];
    try {
      for (const pair of changedPairs) {
        const normalized = normalizeViewedRecord(pair.newRecord);
        await viewedStore.put(normalized as any);
        await syncViewedSecondaryIndexes(tagStore, listStore, pair.oldRecord, normalized);
        written.push(normalized as VideoRecord);
      }
      await tx.done;
    } catch (e) {
      try { await tx.done; } catch {}
      throw e;
    }

    if (written.length > 0) {
      try {
        const { scheduleEnqueue, enqueueVideoChanges } = await import('../../features/cloudSync/enqueueLocalChange');
        scheduleEnqueue(() => enqueueVideoChanges(written));
      } catch { /* Cloud 可选 */ }
    }
  }

  return {
    scannedCount: activeRecords.length,
    affectedCount: changedPairs.length,
    tagsRemoved,
    categoriesRemoved,
    removedTagNames,
    dryRun,
  };
}

export async function viewedReplaceAll(records: VideoRecord[]): Promise<number> {
  const db = await initDB();
  const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
  const viewedStore = tx.objectStore('viewedRecords');
  const tagStore = tx.objectStore('viewedByTag');
  const listStore = tx.objectStore('viewedByList');
  try {
    await viewedStore.clear();
    await tagStore.clear();
    await listStore.clear();
    let written = 0;
    for (const r of Array.isArray(records) ? records : []) {
      const normalized = normalizeViewedRecord(r);
      await viewedStore.put(normalized as any);
      await syncViewedSecondaryIndexes(tagStore, listStore, null, normalized);
      written++;
    }
    await tx.done;
    return written;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
}

export async function viewedGet(videoId: string): Promise<VideoRecord | undefined> {
  const db = await initDB();
  return db.get('viewedRecords', videoId);
}
export async function viewedDelete(videoId: string): Promise<void> {
  const db = await initDB();
  const record = await db.get('viewedRecords', videoId) as VideoRecord | undefined;
  if (record) {
    await db.put('viewedRecords', { ...record, deletedAt: Date.now() } as VideoRecord);
  }
}

export async function viewedBulkDelete(videoIds: string[]): Promise<void> {
  if (!videoIds || videoIds.length === 0) return;
  const db = await initDB();
  const now = Date.now();
  for (const id of videoIds) {
    const record = await db.get('viewedRecords', id) as VideoRecord | undefined;
    if (record) {
      await db.put('viewedRecords', { ...record, deletedAt: now } as VideoRecord);
    }
  }
}

/** 恢复单条番号（清除 deletedAt） */
export async function viewedRestore(videoId: string): Promise<void> {
  const db = await initDB();
  const record = await db.get('viewedRecords', videoId) as VideoRecord | undefined;
  if (record && record.deletedAt) {
    const { deletedAt, ...rest } = record;
    await db.put('viewedRecords', rest as VideoRecord);
  }
}

/** 批量恢复番号 */
export async function viewedBulkRestore(videoIds: string[]): Promise<void> {
  if (!videoIds || videoIds.length === 0) return;
  const db = await initDB();
  for (const id of videoIds) {
    const record = await db.get('viewedRecords', id) as VideoRecord | undefined;
    if (record && record.deletedAt) {
      const { deletedAt, ...rest } = record;
      await db.put('viewedRecords', rest as VideoRecord);
    }
  }
}

/** 永久删除单条番号（物理删除 + 清理二级索引） */
export async function viewedPurge(videoId: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
  await clearViewedSecondaryIndexesByVideoId(tx.objectStore('viewedByTag'), tx.objectStore('viewedByList'), videoId);
  await tx.objectStore('viewedRecords').delete(videoId);
  await tx.done;
}

/** 批量永久删除番号 */
export async function viewedBulkPurge(videoIds: string[]): Promise<void> {
  if (!videoIds || videoIds.length === 0) return;
  const db = await initDB();
  const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
  try {
    for (const id of videoIds) {
      await clearViewedSecondaryIndexesByVideoId(tx.objectStore('viewedByTag'), tx.objectStore('viewedByList'), id);
      await tx.objectStore('viewedRecords').delete(id);
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
}

/** 查询番号回收站（deletedAt != null，按 deletedAt 降序） */
export async function viewedQueryRecycleBin(params?: { offset?: number; limit?: number }): Promise<{ items: VideoRecord[]; total: number }> {
  const { offset = 0, limit = 50 } = params || {};
  const db = await initDB();
  const all = await db.getAll('viewedRecords');
  const trashed = all.filter(r => !!r.deletedAt);
  trashed.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  return { items: trashed.slice(offset, offset + limit), total: trashed.length };
}

/** 清理过期番号（deletedAt 超过 expiryMs 的记录） */
export async function viewedPurgeExpired(expiryMs: number): Promise<number> {
  const db = await initDB();
  const all = await db.getAll('viewedRecords');
  const now = Date.now();
  const expired = all.filter(r => r.deletedAt && (now - r.deletedAt > expiryMs));
  if (expired.length === 0) return 0;
  const ids = expired.map(r => r.id);
  await viewedBulkPurge(ids);
  return ids.length;
}

export async function viewedCount(): Promise<number> {
  const db = await initDB();
  return db.count('viewedRecords');
}

export async function viewedGetAll(): Promise<VideoRecord[]> {
  const db = await initDB();
  return db.getAll('viewedRecords');
}

export async function viewedTagIndexGetAll(): Promise<ViewedTagIndexRecord[]> {
  const db = await initDB();
  return db.getAll('viewedByTag');
}

export async function viewedCountByStatus(status?: VideoRecord['status']): Promise<number> {
  const db = await initDB();
  if (!status) return db.count('viewedRecords');
  const idx = db.transaction('viewedRecords').store.index('by_status');
  // @ts-ignore
  return idx.count(IDBKeyRange.only(status));
}

export async function viewedPage(params: ViewedPageParams): Promise<{ items: VideoRecord[]; total: number; }> {
  const { offset = 0, limit = 50, status, orderBy = 'updatedAt', order = 'desc', isFavorite } = params || {} as any;
  const db = await initDB();
  const favoriteOnly = isFavorite === true;
  const dir = order === 'asc' ? 'next' : 'prev';

  try {
    const tx = db.transaction('viewedRecords');
    const store = tx.store;
    const { source, range } = buildViewedTimeCursorSource(store, {
      status,
      orderBy,
      favoriteOnly,
    });

    let total = 0;
    try {
      total = range ? await source.count(range as any) : await store.count();
    } catch {
      total = 0;
    }

    const items: VideoRecord[] = [];
    let skipped = 0;
    let collected = 0;
    for (let cursor = await source.openCursor(range as any, dir); cursor; cursor = await cursor.continue()) {
      const record = cursor.value as VideoRecord;
      if (record.deletedAt) continue; // 跳过已删除记录
      if (skipped < offset) {
        skipped++;
        continue;
      }
      items.push(record);
      collected++;
      if (collected >= limit) break;
    }

    return { items, total };
  } catch {
    const tx = db.transaction('viewedRecords');
    const store = tx.store;
    const allItems: VideoRecord[] = [];
    for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
      const record = cursor.value as VideoRecord;
      if (record.deletedAt) continue; // 跳过已删除记录
      const matchesStatus = !status || record.status === status;
      const matchesFavorite = !favoriteOnly || record.isFavorite === true;
      if (matchesStatus && matchesFavorite) {
        allItems.push(record);
      }
    }
    allItems.sort((a, b) => {
      const aVal = orderBy === 'createdAt' ? (a.createdAt || 0) : (a.updatedAt || 0);
      const bVal = orderBy === 'createdAt' ? (b.createdAt || 0) : (b.updatedAt || 0);
      return order === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return {
      items: allItems.slice(offset, offset + limit),
      total: allItems.length,
    };
  }
}

// ----- viewed stats -----
export interface ViewedStats {
  total: number;
  byStatus: Record<string, number>;
  last7Days: number;
  last30Days: number;
}

export async function viewedStats(): Promise<ViewedStats> {
  const db = await initDB();
  const tx = db.transaction('viewedRecords');
  const store = tx.store;
  const idxStatus = store.index('by_status');
  const idxCreated = store.index('by_createdAt');

  const total = await store.count();

  let viewed = 0, browsed = 0, want = 0;
  try { /* @ts-ignore */ viewed = await idxStatus.count(IDBKeyRange.only('viewed')); } catch {}
  try { /* @ts-ignore */ browsed = await idxStatus.count(IDBKeyRange.only('browsed')); } catch {}
  try { /* @ts-ignore */ want = await idxStatus.count(IDBKeyRange.only('want')); } catch {}

  const now = Date.now();
  const last7 = now - 7 * 24 * 60 * 60 * 1000;
  const last30 = now - 30 * 24 * 60 * 60 * 1000;
  let last7Days = 0;
  let last30Days = 0;
  try { /* @ts-ignore */ last7Days = await idxCreated.count(IDBKeyRange.lowerBound(last7)); } catch {}
  try { /* @ts-ignore */ last30Days = await idxCreated.count(IDBKeyRange.lowerBound(last30)); } catch {}

  return {
    total,
    byStatus: { viewed, browsed, want },
    last7Days,
    last30Days,
  };
}

// ----- logs API -----

function normalizeLog(entry: LogEntry): PersistedLogEntry {
  const timestampISO = entry.timestamp || new Date().toISOString();
  const ms = Date.parse(timestampISO) || Date.now();
  const source = deriveLogSource(String(entry.message || ''));
  const category = deriveLogCategory(String(entry.message || ''));
  return {
    ...entry,
    timestamp: timestampISO,
    timestampISO,
    timestampMs: ms,
    source,
    category,
  } as PersistedLogEntry;
}

function normalizeMagnetPushLog(entry: any): PersistedMagnetPushLogEntry {
  const ts = typeof entry?.timestamp === 'number' ? entry.timestamp : Date.now();
  const normalized: PersistedMagnetPushLogEntry = {
    type: entry?.type,
    videoId: String(entry?.videoId || ''),
    message: String(entry?.message || ''),
    timestamp: ts,
    timestampMs: ts,
    timestampISO: new Date(ts).toISOString(),
    source: 'DRIVE115',
    category: 'DRIVE115',
    data: entry?.data,
  };
  if (typeof entry?.id === 'number' && Number.isFinite(entry.id)) {
    normalized.id = entry.id;
  }
  return normalized;
}

export async function logsAdd(entry: LogEntry): Promise<number> {
  const db = await initDB();
  const v = normalizeLog(entry);
  // @ts-ignore id will be auto generated
  const id = await db.add('logs', v as any);
  const persisted = typeof id === 'number' ? { ...v, id } : v;
  try {
    const { scheduleEnqueue, enqueueLogChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueLogChange(persisted as unknown as Record<string, unknown>));
  } catch { /* Cloud 可选 */ }
  try { await logsEnforceRetention(); } catch {}
  return id as number;
}

export async function logsBulkAdd(entries: LogEntry[]): Promise<void> {
  if (!entries || entries.length === 0) return;
  const db = await initDB();
  const tx = db.transaction('logs', 'readwrite');
  const written: PersistedLogEntry[] = [];
  try {
    for (const e of entries) {
      const v = normalizeLog(e);
      const id = await tx.store.add(v as any);
      written.push(typeof id === 'number' ? { ...v, id } : v);
    }
    await tx.done;
    try {
      const { scheduleEnqueue, enqueueLogChanges } = await import('../../features/cloudSync/enqueueLocalChange');
      scheduleEnqueue(() => enqueueLogChanges(written as unknown as Array<Record<string, unknown>>));
    } catch { /* Cloud 可选 */ }
    try { await logsEnforceRetention(); } catch {}
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
}

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

export async function logsQuery(params: LogsQueryParams): Promise<{ items: PersistedLogEntry[]; total: number; }> {
  const { level, minLevel, fromMs, toMs, offset = 0, limit = 100, order = 'desc', query = '', hasDataOnly = false, source = 'ALL', category } = params || {} as any;
  const db = await initDB();
  const store = db.transaction('logs').store;
  const dir = order === 'asc' ? 'next' : 'prev';
  const q = String(query || '').trim().toLowerCase();
  const normalizedCategory = category && category !== 'ALL' ? String(category).toUpperCase() : '';

  const rank = (lv: LogEntry['level']) => {
    switch (lv) {
      case 'DEBUG': return 0;
      case 'INFO': return 1;
      case 'WARN': return 2;
      case 'ERROR': return 3;
      default: return 0;
    }
  };
  const minRank = (() => {
    if (!minLevel) return null;
    if (minLevel === 'OFF') return Infinity;
    return rank(minLevel as LogEntry['level']);
  })();

  const canUseExactIndexedPage = !q && !hasDataOnly && !minLevel && (
    (!!level && source === 'ALL' && !normalizedCategory) ||
    (!level && source !== 'ALL' && !normalizedCategory) ||
    (!level && source === 'ALL' && !!normalizedCategory) ||
    (!level && source === 'ALL' && !normalizedCategory)
  );

  if (canUseExactIndexedPage) {
    const { source: cursorSource, range } = buildLogsIndexedCursorSource(store, {
      level,
      source,
      category: normalizedCategory || undefined,
      fromMs,
      toMs,
    });
    let total = 0;
    try {
      total = range ? await cursorSource.count(range as any) : await store.count();
    } catch {
      total = 0;
    }

    const items: PersistedLogEntry[] = [];
    let skipped = 0;
    let collected = 0;
    for (let cursor = await cursorSource.openCursor(range as any, dir); cursor; cursor = await cursor.continue()) {
      if (skipped < offset) {
        skipped++;
        continue;
      }
      items.push(cursor.value as PersistedLogEntry);
      collected++;
      if (collected >= limit) break;
    }
    return { items, total };
  }

  const { source: cursorSource, range } = buildLogsIndexedCursorSource(store, {
    level,
    source,
    category: normalizedCategory || undefined,
    fromMs,
    toMs,
  });

  const items: PersistedLogEntry[] = [];
  let skipped = 0;
  let collected = 0;
  let total = 0;
  for (let cursor = await cursorSource.openCursor(range as any, dir); cursor; cursor = await cursor.continue()) {
    const v = cursor.value as PersistedLogEntry;
    const sourceValue = v.source || deriveLogSource(String(v.message || ''));
    const categoryValue = (v.category || deriveLogCategory(String(v.message || ''))).toUpperCase();

    if (level && v.level !== level) continue;
    if (minRank != null && minRank !== Infinity && rank(v.level as any) < minRank) continue;
    if (minRank === Infinity) continue;
    if (hasDataOnly && !v.data) continue;
    if (q) {
      const inMsg = String(v.message || '').toLowerCase().includes(q);
      let inData = false;
      try { inData = v.data ? JSON.stringify(v.data).toLowerCase().includes(q) : false; } catch { inData = false; }
      if (!inMsg && !inData) continue;
    }
    if (source && source !== 'ALL' && sourceValue !== source) continue;
    if (normalizedCategory && categoryValue !== normalizedCategory) continue;

    total++;
    if (skipped < offset) {
      skipped++;
      continue;
    }
    if (collected < limit) {
      items.push(v);
      collected++;
    }
  }
  return { items, total };
}

export async function logsClear(beforeMs?: number): Promise<void> {
  const db = await initDB();
  const tx = db.transaction('logs', 'readwrite');
  const idx = tx.store.index('by_timestamp');
  if (beforeMs == null) {
    await tx.store.clear();
  } else {
    for (let cursor = await idx.openCursor(IDBKeyRange.upperBound(beforeMs)); cursor; cursor = await cursor.continue()) {
      await cursor.delete();
    }
  }
  await tx.done;
}

export async function logsGetAll(): Promise<PersistedLogEntry[]> {
  const db = await initDB();
  return db.getAll('logs');
}

async function ensureMagnetPushLogsStore(): Promise<void> {
  const db = await initDB();
  if (db.objectStoreNames.contains('magnetPushLogs')) return;
  db.close();
  resetDBConnection();
  await initDB();
}

export async function magnetPushLogsAdd(entry: any): Promise<number> {
  await ensureMagnetPushLogsStore();
  const db = await initDB();
  const v = normalizeMagnetPushLog(entry);
  try {
    console.info('[115Trace] idb:magnet-log:add:normalized', {
      traceId: (v.data as any)?.traceId || (v.data as any)?.correlationId || '',
      correlationId: (v.data as any)?.correlationId || '',
      taskId: (v.data as any)?.taskId || '',
      type: v.type,
      videoId: v.videoId,
      timestampMs: v.timestampMs,
      hasData: !!v.data,
    });
  } catch {}
  const id = await db.add('magnetPushLogs', v as any);
  const persisted = typeof id === 'number' ? { ...v, id } : v;
  try {
    console.info('[115Trace] idb:magnet-log:add:done', {
      traceId: (v.data as any)?.traceId || (v.data as any)?.correlationId || '',
      correlationId: (v.data as any)?.correlationId || '',
      taskId: (v.data as any)?.taskId || '',
      id,
      type: v.type,
      videoId: v.videoId,
    });
  } catch {}
  try {
    const { scheduleEnqueue, enqueueMagnetPushLogChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueMagnetPushLogChange(persisted as unknown as Record<string, unknown>));
  } catch { /* Cloud 可选 */ }
  try { await magnetPushLogsEnforceRetention(); } catch {}
  return id as number;
}

export async function magnetPushLogsBulkAdd(entries: any[]): Promise<void> {
  if (!entries || entries.length === 0) return;
  await ensureMagnetPushLogsStore();
  const db = await initDB();
  const tx = db.transaction('magnetPushLogs', 'readwrite');
  const written: PersistedMagnetPushLogEntry[] = [];
  try {
    for (const e of entries) {
      const v = normalizeMagnetPushLog(e);
      const id = await tx.store.add(v as any);
      written.push(typeof id === 'number' ? { ...v, id } : v);
    }
    await tx.done;
    try {
      const { scheduleEnqueue, enqueueMagnetPushLogChanges } = await import('../../features/cloudSync/enqueueLocalChange');
      scheduleEnqueue(() => enqueueMagnetPushLogChanges(written as unknown as Array<Record<string, unknown>>));
    } catch { /* Cloud 可选 */ }
    try { await magnetPushLogsEnforceRetention(); } catch {}
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
}

export async function magnetPushLogsQuery(params: {
  type?: 'push_start' | 'push_success' | 'push_failed' | 'ALL';
  fromMs?: number;
  toMs?: number;
  offset?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  query?: string;
  status?: 'ALL' | 'SUCCESS' | 'FAILED';
}): Promise<{ items: PersistedMagnetPushLogEntry[]; total: number; }> {
  const { type = 'ALL', fromMs, toMs, offset = 0, limit = 100, order = 'desc', query = '', status = 'ALL' } = params || {} as any;
  await ensureMagnetPushLogsStore();
  const db = await initDB();
  try {
    console.info('[115Trace] idb:magnet-log:query:start', { type, fromMs, toMs, offset, limit, order, query, status });
  } catch {}
  const store = db.transaction('magnetPushLogs').store;
  const idx = store.index('by_timestamp');
  const dir = order === 'asc' ? 'next' : 'prev';
  const q = String(query || '').trim().toLowerCase();
  const items: PersistedMagnetPushLogEntry[] = [];
  let skipped = 0;
  let total = 0;
  for (let cursor = await idx.openCursor(undefined, dir); cursor; cursor = await cursor.continue()) {
    const v = cursor.value as PersistedMagnetPushLogEntry;
    if (fromMs != null && v.timestampMs < fromMs) continue;
    if (toMs != null && v.timestampMs > toMs) continue;
    if (type !== 'ALL' && v.type !== type) continue;
    if (status === 'SUCCESS' && v.type !== 'push_success') continue;
    if (status === 'FAILED' && v.type !== 'push_failed') continue;
    if (q) {
      const inMsg = String(v.message || '').toLowerCase().includes(q);
      let inData = false;
      try { inData = v.data ? JSON.stringify(v.data).toLowerCase().includes(q) : false; } catch { inData = false; }
      if (!inMsg && !inData) continue;
    }
    total++;
    if (skipped < offset) { skipped++; continue; }
    if (items.length < limit) items.push(v);
  }
  try {
    console.info('[115Trace] idb:magnet-log:query:done', { total, items: items.length, type, query, status, offset, limit });
  } catch {}
  return { items, total };
}

export async function magnetPushLogsClear(beforeMs?: number): Promise<void> {
  await ensureMagnetPushLogsStore();
  const db = await initDB();
  const tx = db.transaction('magnetPushLogs', 'readwrite');
  const idx = tx.store.index('by_timestamp');
  if (beforeMs == null) {
    await tx.store.clear();
  } else {
    for (let cursor = await idx.openCursor(IDBKeyRange.upperBound(beforeMs)); cursor; cursor = await cursor.continue()) {
      await cursor.delete();
    }
  }
  await tx.done;
}

export async function magnetPushLogsGetAll(): Promise<PersistedMagnetPushLogEntry[]> {
  await ensureMagnetPushLogsStore();
  const db = await initDB();
  return db.getAll('magnetPushLogs');
}

async function magnetPushLogsEnforceRetention(): Promise<void> {
  try {
    const settings = await getSettings();
    const logging: any = (settings as any)?.logging || {};
    let maxEntries = Number(logging.maxMagnetPushEntries ?? 10000);
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) maxEntries = 10000;
    const db = await initDB();
    const total = await db.count('magnetPushLogs');
    if (total <= maxEntries) return;
    const toRemove = total - maxEntries;
    const tx = db.transaction('magnetPushLogs', 'readwrite');
    const idx = tx.store.index('by_timestamp');
    let removed = 0;
    for (let cursor = await idx.openCursor(undefined, 'next'); cursor && removed < toRemove; cursor = await cursor.continue()) {
      await cursor.delete();
      removed++;
    }
    await tx.done;
  } catch {}
}

// 保留策略：按条数限制
async function logsEnforceRetention(): Promise<void> {
  try {
    const settings = await getSettings();
    const logging: any = (settings as any)?.logging || {};
    let maxEntries = Number(logging.maxLogEntries ?? logging.maxEntries ?? 5000);
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) maxEntries = 5000;

    const db = await initDB();
    const total = await db.count('logs');
    if (total <= maxEntries) return;

    const toRemove = total - maxEntries;
    const tx = db.transaction('logs', 'readwrite');
    const idx = tx.store.index('by_timestamp');
    let removed = 0;
    for (let cursor = await idx.openCursor(undefined, 'next'); cursor && removed < toRemove; cursor = await cursor.continue()) {
      await cursor.delete();
      removed++;
    }
    await tx.done;
  } catch {
    // 忽略保留清理错误，避免阻断日志写入
  }
}

// ----- export helpers -----

export async function viewedExportJSON(): Promise<string> {
  const list = await viewedGetAll();
  return JSON.stringify(list);
}

export async function logsExportJSON(): Promise<string> {
  const list = await logsGetAll();
  return JSON.stringify(list);
}

// ----- magnets API -----

export interface MagnetsQueryParams {
  videoId?: string;
  sources?: string[];
  hasSubtitle?: boolean;
  minSizeBytes?: number;
  offset?: number;
  limit?: number;
  orderBy?: 'createdAt' | 'sizeBytes' | 'date';
  order?: 'asc' | 'desc';
}

export async function magnetsUpsertMany(records: MagnetCacheRecord[]): Promise<void> {
  if (!records || records.length === 0) return;
  const db = await initDB();
  const tx = db.transaction('magnets', 'readwrite');
  try {
    for (const r of records) {
      await tx.store.put(r);
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
  try {
    const { scheduleEnqueue, enqueueMagnetChanges } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueMagnetChanges(records));
  } catch { /* Cloud 可选 */ }
}

export async function magnetsQuery(params: MagnetsQueryParams): Promise<{ items: MagnetCacheRecord[]; total: number; }> {
  const { videoId, sources, hasSubtitle, minSizeBytes, offset = 0, limit = 200, orderBy = 'createdAt', order = 'desc' } = params || {} as any;
  const db = await initDB();
  let allByVideo: MagnetCacheRecord[] = [];
  if (videoId) {
    const idx = db.transaction('magnets').store.index('by_videoId');
    // @ts-ignore
    allByVideo = await idx.getAll(IDBKeyRange.only(videoId));
  } else {
    allByVideo = await db.getAll('magnets');
  }

  const now = Date.now();
  // 简单过滤（排除过期）
  let filtered = allByVideo.filter((it) => {
    if (typeof it.expireAt === 'number' && it.expireAt > 0 && it.expireAt <= now) return false;
    if (sources && sources.length > 0 && !sources.includes(String(it.source))) return false;
    if (hasSubtitle === true && it.hasSubtitle !== true) return false;
    if (typeof minSizeBytes === 'number' && (it.sizeBytes || 0) < minSizeBytes) return false;
    return true;
  });

  // 排序（内存）
  const cmp = (a: MagnetCacheRecord, b: MagnetCacheRecord) => {
    let av: any;
    let bv: any;
    switch (orderBy) {
      case 'sizeBytes':
        av = a.sizeBytes || 0; bv = b.sizeBytes || 0; break;
      case 'date':
        av = Date.parse(a.date || '') || 0; bv = Date.parse(b.date || '') || 0; break;
      case 'createdAt':
      default:
        av = a.createdAt || 0; bv = b.createdAt || 0; break;
    }
    return order === 'asc' ? (av - bv) : (bv - av);
  };
  filtered.sort(cmp);

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  return { items, total };
}

export async function magnetsClearAll(): Promise<void> {
  const db = await initDB();
  await db.clear('magnets');
}

export async function magnetsClearExpired(beforeMs?: number): Promise<number> {
  const db = await initDB();
  const tx = db.transaction('magnets', 'readwrite');
  const idx = tx.store.index('by_expireAt');
  const now = typeof beforeMs === 'number' ? beforeMs : Date.now();
  let removed = 0;
  for (let cursor = await idx.openCursor(IDBKeyRange.upperBound(now)); cursor; cursor = await cursor.continue()) {
    await cursor.delete();
    removed++;
  }
  await tx.done;
  return removed;
}

// ----- insights (views / reports) API -----

export async function insViewsPut(view: ViewsDaily): Promise<void> {
  const db = await initDB();
  await db.put('insightsViews', view);
  try {
    const { scheduleEnqueue, enqueueInsightsViewChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueInsightsViewChange(view));
  } catch { /* Cloud 可选 */ }
}

export async function insViewsBulkPut(views: ViewsDaily[]): Promise<void> {
  if (!views || views.length === 0) return;
  const db = await initDB();
  const tx = db.transaction('insightsViews', 'readwrite');
  try {
    for (const v of views) {
      await tx.store.put(v as any);
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
  try {
    const { scheduleEnqueue, enqueueInsightsViews } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueInsightsViews(views));
  } catch { /* Cloud 可选 */ }
}

export async function insViewsRange(startDate: string, endDate: string): Promise<ViewsDaily[]> {
  const db = await initDB();
  const idx = db.transaction('insightsViews').store.index('by_date');
  // 字符串范围 YYYY-MM-DD 可按字典序比较
  // @ts-ignore
  const range = IDBKeyRange.bound(startDate, endDate);
  const list: ViewsDaily[] = [];
  for (let cursor = await idx.openCursor(range as any); cursor; cursor = await cursor.continue()) {
    list.push(cursor.value as ViewsDaily);
  }
  return list;
}

export async function insReportsPut(report: ReportMonthly): Promise<void> {
  const db = await initDB();
  await db.put('insightsReports', report);
  try {
    const { scheduleEnqueue, enqueueInsightsReportChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueInsightsReportChange(report));
  } catch { /* Cloud 可选 */ }
}

export async function insReportsGet(month: string): Promise<ReportMonthly | undefined> {
  const db = await initDB();
  return db.get('insightsReports', month);
}

export async function insReportsList(limit = 24): Promise<ReportMonthly[]> {
  const db = await initDB();
  const idx = db.transaction('insightsReports').store.index('by_createdAt');
  const list: ReportMonthly[] = [];
  // 最新在前
  for (let cursor = await idx.openCursor(undefined, 'prev'); cursor; cursor = await cursor.continue()) {
    list.push(cursor.value as ReportMonthly);
    if (list.length >= limit) break;
  }
  return list;
}

export async function insReportsDelete(month: string): Promise<void> {
  const db = await initDB();
  await db.delete('insightsReports', month);
}

export async function insReportsExportJSON(): Promise<string> {
  const db = await initDB();
  const all = await db.getAll('insightsReports');
  return JSON.stringify(all || []);
}

export async function insReportsImportJSON(json: string): Promise<number> {
  const db = await initDB();
  const arr = JSON.parse(json || '[]');
  if (!Array.isArray(arr)) return 0;
  const tx = db.transaction('insightsReports', 'readwrite');
  let cnt = 0;
  try {
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue;
      const month = (r as any)?.month;
      const period = (r as any)?.period || {};
      const stats = (r as any)?.stats || {};
      const html = (r as any)?.html;
      const createdAt = (r as any)?.createdAt;
      const status = (r as any)?.status;
      const origin = (r as any)?.origin;
      // 基础校验
      if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) continue;
      if (typeof period?.start !== 'string' || typeof period?.end !== 'string') continue;
      if (typeof html !== 'string' || html.length === 0) continue;
      if (typeof createdAt !== 'number') continue;
      if (status !== 'final' && status !== 'draft') continue;
      if (origin !== 'auto' && origin !== 'manual') continue;
      // 统计结构软校验
      const okStats = stats && Array.isArray(stats.tagsTop) && Array.isArray(stats.trend) && stats.changes && Array.isArray(stats.changes.newTags);
      if (!okStats) continue;
      await tx.store.put({ ...r, month } as any);
      cnt++;
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
  return cnt;
}

// ----- actors API -----

export interface ActorsQueryParams {
  query?: string; // 在名称或别名中做子串搜索
  gender?: 'female' | 'male' | 'unknown';
  category?: 'censored' | 'uncensored' | 'western' | 'unknown';
  blacklist?: 'all' | 'exclude' | 'only';
  sortBy?: 'name' | 'updatedAt' | 'worksCount';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export async function actorsPut(record: ActorRecord): Promise<void> {
  const db = await initDB();
  // 如果记录在回收站中，跳过更新（保留软删除状态）
  const existing = await db.get('actors', record.id) as ActorRecord | undefined;
  if (existing?.deletedAt) return;
  await db.put('actors', record);
  try {
    const { scheduleEnqueue, enqueueActorChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueActorChange(record));
  } catch { /* Cloud 可选 */ }
}

export async function actorsBulkPut(records: ActorRecord[]): Promise<void> {
  if (!records || records.length === 0) return;
  const db = await initDB();
  const tx = db.transaction('actors', 'readwrite');
  const written: ActorRecord[] = [];
  try {
    for (const r of records) {
      const existing = await tx.store.get(r.id) as ActorRecord | undefined;
      // 如果记录在回收站中，跳过更新（保留软删除状态）
      if (existing?.deletedAt) continue;
      await tx.store.put(r);
      written.push(r);
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
  if (written.length) {
    try {
      const { scheduleEnqueue, enqueueActorChanges } = await import('../../features/cloudSync/enqueueLocalChange');
      scheduleEnqueue(() => enqueueActorChanges(written));
    } catch { /* Cloud 可选 */ }
  }
}

export async function actorsGet(id: string): Promise<ActorRecord | undefined> {
  const db = await initDB();
  return db.get('actors', id);
}

export async function actorsDelete(id: string): Promise<void> {
  const db = await initDB();
  const record = await db.get('actors', id) as ActorRecord | undefined;
  if (record) {
    await db.put('actors', { ...record, deletedAt: Date.now() } as ActorRecord);
  }
}

/** 恢复单条演员 */
export async function actorsRestore(id: string): Promise<void> {
  const db = await initDB();
  const record = await db.get('actors', id) as ActorRecord | undefined;
  if (record && record.deletedAt) {
    const { deletedAt, ...rest } = record;
    await db.put('actors', rest as ActorRecord);
  }
}

/** 批量恢复演员 */
export async function actorsBulkRestore(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const db = await initDB();
  for (const id of ids) {
    const record = await db.get('actors', id) as ActorRecord | undefined;
    if (record && record.deletedAt) {
      const { deletedAt, ...rest } = record;
      await db.put('actors', rest as ActorRecord);
    }
  }
}

/** 永久删除单条演员 */
export async function actorsPurge(id: string): Promise<void> {
  const db = await initDB();
  await db.delete('actors', id);
}

/** 批量永久删除演员 */
export async function actorsBulkPurge(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const db = await initDB();
  const tx = db.transaction('actors', 'readwrite');
  try {
    for (const id of ids) {
      await tx.store.delete(id);
    }
    await tx.done;
  } catch (e) {
    try { await tx.done; } catch {}
    throw e;
  }
}

/** 查询演员回收站（deletedAt != null，按 deletedAt 降序） */
export async function actorsQueryRecycleBin(params?: { offset?: number; limit?: number }): Promise<{ items: ActorRecord[]; total: number }> {
  const { offset = 0, limit = 50 } = params || {};
  const db = await initDB();
  const all = await db.getAll('actors');
  const trashed = all.filter(a => !!a.deletedAt);
  trashed.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  return { items: trashed.slice(offset, offset + limit), total: trashed.length };
}

/** 清理过期演员（deletedAt 超过 expiryMs 的记录） */
export async function actorsPurgeExpired(expiryMs: number): Promise<number> {
  const db = await initDB();
  const all = await db.getAll('actors');
  const now = Date.now();
  const expired = all.filter(a => a.deletedAt && (now - a.deletedAt > expiryMs));
  if (expired.length === 0) return 0;
  await actorsBulkPurge(expired.map(a => a.id));
  return expired.length;
}

export async function actorsQuery(params: ActorsQueryParams): Promise<{ items: ActorRecord[]; total: number; }> {
  const { query = '', gender, category, blacklist = 'all', sortBy = 'name', order = 'asc', offset = 0, limit = 20 } = params || {} as any;
  const db = await initDB();
  const all = await db.getAll('actors');
  const q = (query || '').trim().toLowerCase();
  let filtered = all.filter((a) => {
    if (a.deletedAt) return false; // 排除已删除记录
    if (q) {
      const inName = (a.name || '').toLowerCase().includes(q);
      const inAliases = Array.isArray(a.aliases) && a.aliases.some(s => (s || '').toLowerCase().includes(q));
      if (!inName && !inAliases) return false;
    }
    if (gender && a.gender !== gender) return false;
    if (category && a.category !== category) return false;
    if (blacklist === 'exclude' && a.blacklisted) return false;
    if (blacklist === 'only' && !a.blacklisted) return false;
    return true;
  });

  filtered.sort((a, b) => {
    let av: any; let bv: any;
    switch (sortBy) {
      case 'updatedAt':
        av = a.updatedAt || 0; bv = b.updatedAt || 0; break;
      case 'worksCount':
        av = a.details?.worksCount || 0; bv = b.details?.worksCount || 0; break;
      case 'name':
      default:
        av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase();
    }
    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv);
      return order === 'asc' ? cmp : -cmp;
    }
    return order === 'asc' ? (av - bv) : (bv - av);
  });

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  return { items, total };
}

export async function actorsStats(): Promise<{ total: number; byGender: Record<string, number>; byCategory: Record<string, number>; blacklisted: number; recentlyAdded: number; recentlyUpdated: number; }> {
  const db = await initDB();
  const tx = db.transaction('actors');
  const store = tx.store;

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const countIndexed = (indexName: 'by_gender' | 'by_category' | 'by_createdAt' | 'by_updatedAt', key: IDBValidKey | IDBKeyRange): Promise<number> => (
    store.index(indexName).count(key as any).catch(() => 0)
  );
  // IndexedDB does not support boolean index keys, so legacy `blacklisted`
  // values are absent from `by_blacklisted` and must be counted directly.
  const blacklistedActors = await store.getAll();
  const [
    total,
    female,
    male,
    unknownGender,
    censored,
    uncensored,
    western,
    unknownCategory,
    recentlyAdded,
    recentlyUpdated,
  ] = await Promise.all([
    store.count(),
    countIndexed('by_gender', IDBKeyRange.only('female')),
    countIndexed('by_gender', IDBKeyRange.only('male')),
    countIndexed('by_gender', IDBKeyRange.only('unknown')),
    countIndexed('by_category', IDBKeyRange.only('censored')),
    countIndexed('by_category', IDBKeyRange.only('uncensored')),
    countIndexed('by_category', IDBKeyRange.only('western')),
    countIndexed('by_category', IDBKeyRange.only('unknown')),
    countIndexed('by_createdAt', IDBKeyRange.lowerBound(weekAgo, true)),
    countIndexed('by_updatedAt', IDBKeyRange.lowerBound(weekAgo, true)),
  ]);

  return {
    total,
    byGender: { female, male, unknown: unknownGender },
    byCategory: { censored, uncensored, western, unknown: unknownCategory },
    blacklisted: blacklistedActors.filter((actor: any) => actor?.blacklisted === true).length,
    recentlyAdded,
    recentlyUpdated,
  };
}

export async function actorsExportJSON(): Promise<string> {
  const db = await initDB();
  const list = await db.getAll('actors');
  return JSON.stringify(list);
}

// ----- newWorks API -----

export interface NewWorksQueryParams {
  search?: string;
  filter?: 'all' | 'unread' | 'today' | 'week';
  sort?: 'discoveredAt' | 'releaseDate' | 'actorName';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export async function newWorksPut(record: NewWorkRecord): Promise<void> {
  const db = await initDB();
  await db.put('newWorks', record);
  await newWorksDailyStatRefreshToday();
  try {
    const { scheduleEnqueue, enqueueNewWorkChange } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueNewWorkChange(record));
  } catch { /* Cloud 可选 */ }
}

export async function newWorksBulkPut(records: NewWorkRecord[]): Promise<void> {
  if (!records || records.length === 0) return;
  console.log(`[IDB] newWorksBulkPut: 准备写入 ${records.length} 个作品到 IndexedDB`);
  const db = await initDB();
  const tx = db.transaction('newWorks', 'readwrite');
  try {
    for (const r of records) {
      await tx.store.put(r);
    }
    await tx.done;
    console.log(`[IDB] newWorksBulkPut: 成功写入 ${records.length} 个作品到 IndexedDB`);

    // 验证写入：立即读取确认
    const count = await db.count('newWorks');
    console.log(`[IDB] newWorksBulkPut: 写入后 IndexedDB 中共有 ${count} 个作品`);
  } catch (e) {
    console.error(`[IDB] newWorksBulkPut: 写入失败`, e);
    try { await tx.done; } catch {}
    throw e;
  }
  // 写入后刷新当日快照，确保趋势数据不因后续已读/清理而丢失
  await newWorksDailyStatRefreshToday();
  try {
    const { scheduleEnqueue, enqueueNewWorkChanges } = await import('../../features/cloudSync/enqueueLocalChange');
    scheduleEnqueue(() => enqueueNewWorkChanges(records));
  } catch { /* Cloud 可选 */ }
}

export async function newWorksDelete(id: string): Promise<void> {
  const db = await initDB();
  await db.delete('newWorks', id);
}

export async function newWorksGetAll(): Promise<NewWorkRecord[]> {
  const db = await initDB();
  return db.getAll('newWorks');
}

export async function newWorksGet(id: string): Promise<NewWorkRecord | undefined> {
  const db = await initDB();
  return db.get('newWorks', id);
}

export async function newWorksQuery(params: NewWorksQueryParams): Promise<{ items: NewWorkRecord[]; total: number; }> {
  const { search = '', filter = 'all', sort = 'discoveredAt', order = 'desc', offset = 0, limit = 20 } = params || {} as any;
  const db = await initDB();
  const normalizedSearch = search.trim();
  const canUseDiscoveredAtPage = normalizedSearch.length === 0
    && filter === 'all'
    && sort === 'discoveredAt'
    && Number.isInteger(offset)
    && offset >= 0
    && Number.isInteger(limit)
    && limit >= 0;

  if (canUseDiscoveredAtPage) {
    const store = db.transaction('newWorks').store;
    const discoveredAtIndex = store.index('by_discoveredAt');
    const total = await discoveredAtIndex.count();
    const items: NewWorkRecord[] = [];
    let cursor = await discoveredAtIndex.openCursor(undefined, order === 'asc' ? 'next' : 'prev');
    let skipped = 0;

    while (cursor && skipped < offset) {
      cursor = await cursor.continue();
      skipped += 1;
    }
    while (cursor && items.length < limit) {
      items.push(cursor.value);
      cursor = await cursor.continue();
    }

    return { items, total };
  }

  let items = await db.getAll('newWorks');
  console.log(`[IDB] newWorksQuery: 从 IndexedDB 获取到 ${items.length} 个作品`, { search, filter, sort, order, offset, limit });

  const q = normalizedSearch.toLowerCase();
  if (q) {
    items = items.filter(w => (w.title || '').toLowerCase().includes(q) || (w.actorName || '').toLowerCase().includes(q) || (w.id || '').toLowerCase().includes(q));
  }

  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  if (filter === 'unread') items = items.filter(w => !w.isRead);
  else if (filter === 'today') items = items.filter(w => (w.discoveredAt || 0) >= todayStart);
  else if (filter === 'week') items = items.filter(w => (w.discoveredAt || 0) >= weekStart);

  items.sort((a, b) => {
    let av: any; let bv: any;
    switch (sort) {
      case 'releaseDate':
        av = a.releaseDate || ''; bv = b.releaseDate || ''; break;
      case 'actorName':
        av = (a.actorName || '').toLowerCase(); bv = (b.actorName || '').toLowerCase(); break;
      case 'discoveredAt':
      default:
        av = a.discoveredAt || 0; bv = b.discoveredAt || 0; break;
    }
    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv);
      return order === 'asc' ? cmp : -cmp;
    }
    return order === 'asc' ? (av - bv) : (bv - av);
  });

  const total = items.length;
  const pageItems = items.slice(offset, offset + limit);
  return { items: pageItems, total };
}

export async function newWorksStats(): Promise<{ total: number; unread: number; today: number; week: number; }> {
  const db = await initDB();
  const tx = db.transaction('newWorks');
  const store = tx.store;
  
  console.log(`[IDB] newWorksStats: 开始统计`);
  
  const total = await store.count();
  
  // 使用索引统计未读数量
  let unread = 0;
  try {
    const isReadIndex = store.index('by_isRead');
    unread = await isReadIndex.count(IDBKeyRange.only(false));
  } catch {
    // 如果索引不存在，回退到全量查询
    const items = await store.getAll();
    unread = items.filter(w => !w.isRead).length;
  }
  
  // 使用索引统计今日和本周发现的作品
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  
  let today = 0;
  let week = 0;
  try {
    const discoveredIndex = store.index('by_discoveredAt');
    today = await discoveredIndex.count(IDBKeyRange.lowerBound(todayStart));
    week = await discoveredIndex.count(IDBKeyRange.lowerBound(weekStart));
  } catch {
    const items = await store.getAll();
    today = items.filter(w => (w.discoveredAt || 0) >= todayStart).length;
    week = items.filter(w => (w.discoveredAt || 0) >= weekStart).length;
  }
  
  console.log(`[IDB] newWorksStats: 统计结果`, { total, unread, today, week });
  return { total, unread, today, week };
}

export async function newWorksExportJSON(): Promise<string> {
  const db = await initDB();
  const list = await db.getAll('newWorks');
  return JSON.stringify(list);
}
