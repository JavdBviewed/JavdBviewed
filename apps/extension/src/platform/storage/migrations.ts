/**
 * @file migrations.ts
 * @description 数据迁移与周期维护任务
 * @module platform/storage
 *
 * 职责：
 * - chrome.storage → IndexedDB 数据迁移（视频记录、日志、演员、磁力缓存）
 * - 过期磁力缓存自动清理
 * - 启动时执行一次性迁移 + 周期性维护
 */

import { initDB, viewedBulkPut as idbViewedBulkPut, viewedCount as idbViewedCount, magnetsClearExpired as idbMagnetsClearExpired, logsBulkAdd as idbLogsBulkAdd, magnetPushLogsBulkAdd as idbMagnetPushLogsBulkAdd, actorsBulkPut as idbActorsBulkPut } from './indexedDb';
import { getValue, setValue } from '../../utils/storage';
import { STORAGE_KEYS } from '../../utils/config';

/**
 * 10-08：兜底补迁移主体（启动路径与 DB:VIEWED_FALLBACK_MIGRATE 路由复用）。
 * - 将 viewed 记录按 500 条分批写入 IDB，末尾置 idb_migrated 旗标（保持启动路径「首次 0 条也置旗标」语义；兜底路由仅在老键非空时调用本函数）
 * - 写入失败向上抛：启动路径吞掉（不阻塞扩展启动），路由侧响应 success:false
 */
export async function migrateViewedBatch(records: any[]): Promise<number> {
  await initDB();
  const all = records || [];
  const BATCH = 500;
  for (let i = 0; i < all.length; i += BATCH) {
    const slice = all.slice(i, i + BATCH);
    await idbViewedBulkPut(slice);
    console.info('[Background] Migrated batch', { from: i, to: Math.min(i + BATCH, all.length) });
  }
  await setValue(STORAGE_KEYS.IDB_MIGRATED, true);
  return all.length;
}

async function ensureIDBMigrated(): Promise<void> {
  try {
    await initDB();
    const migrated = await getValue<boolean>(STORAGE_KEYS.IDB_MIGRATED, false);
    if (migrated) return;

    const viewedObj = await getValue<Record<string, any>>(STORAGE_KEYS.VIEWED_RECORDS, {});
    const all = Object.values(viewedObj || {});
    console.info('[Background] Starting initial migration to IndexedDB...', { count: all.length });

    await migrateViewedBatch(all);
    const cnt = await idbViewedCount().catch(() => -1);
    console.info('[Background] Migration finished', { total: all.length, idbCount: cnt });
  } catch (e) {
    console.warn('[Background] Migration failed (will not block extension)', (e as any)?.message);
  }
}


async function ensureIDBLogsMigrated(): Promise<void> {
  try {
    await initDB();
    const migrated = await getValue<boolean>(STORAGE_KEYS.IDB_LOGS_MIGRATED, false);
    if (migrated) return;

    const oldLogs = await getValue<any[]>(STORAGE_KEYS.LOGS, []);
    if (Array.isArray(oldLogs) && oldLogs.length > 0) {
      try { await idbLogsBulkAdd(oldLogs as any); } catch {}
      try { await setValue(STORAGE_KEYS.LOGS, []); } catch {}
    }
    await setValue(STORAGE_KEYS.IDB_LOGS_MIGRATED, true);
    console.info('[Background] Logs migration to IDB finished', { migrated: Array.isArray(oldLogs) ? oldLogs.length : 0 });
  } catch (e) {
    console.warn('[Background] Logs migration to IDB failed (will not block extension)', (e as any)?.message);
  }
}

async function ensureMagnetPushLogsMigrated(): Promise<void> {
  try {
    await initDB();
    const migrated = await getValue<boolean>('idb_magnet_push_logs_migrated' as any, false);
    if (migrated) return;

    const oldLogs = await getValue<any[]>('drive115_logs' as any, []);
    if (Array.isArray(oldLogs) && oldLogs.length > 0) {
      const mapped = oldLogs
        .filter((item: any) => item && (item.type === 'push_start' || item.type === 'push_success' || item.type === 'push_failed'))
        .map((item: any) => ({
          type: item.type,
          videoId: String(item.videoId || ''),
          message: String(item.message || ''),
          timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
          data: item.data,
        }));
      if (mapped.length > 0) {
        try { await idbMagnetPushLogsBulkAdd(mapped as any); } catch {}
      }
    }
    await setValue('idb_magnet_push_logs_migrated' as any, true);
  } catch (e) {
    console.warn('[Background] Magnet push logs migration failed (will not block extension)', (e as any)?.message);
  }
}

export function ensureMigrationsStart(): void {
  // fire-and-forget on startup/wakeup
  try { ensureIDBMigrated(); } catch {}
  try { ensureIDBLogsMigrated(); } catch {}
  try { ensureMagnetPushLogsMigrated(); } catch {}
  try { ensureIDBActorsMigrated(); } catch {}

  // Best-effort: 清理过期的磁链缓存
  try { idbMagnetsClearExpired(Date.now()).catch(() => {}); } catch {}

  // 定时清理过期的磁链缓存（chrome.alarms）
  try {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      // 每 12 小时触发一次，名称固定，重复创建会覆盖
      chrome.alarms.create('MAGNETS_CLEAN_EXPIRED', { periodInMinutes: 720 });
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm?.name === 'MAGNETS_CLEAN_EXPIRED') {
          try { idbMagnetsClearExpired(Date.now()).catch(() => {}); } catch {}
        }
      });
    }
  } catch {}
}

// 迁移：将旧版 local storage 中的演员库迁移至 IndexedDB
async function ensureIDBActorsMigrated(): Promise<void> {
  try {
    await initDB();
    const migrated = await getValue<boolean>(STORAGE_KEYS.IDB_ACTORS_MIGRATED, false);
    if (migrated) return;

    const actorObj = await getValue<Record<string, any>>(STORAGE_KEYS.ACTOR_RECORDS, {});
    const all = Object.values(actorObj || {});
    console.info('[Background] Starting actors migration to IndexedDB...', { count: all.length });

    const BATCH = 500;
    for (let i = 0; i < all.length; i += BATCH) {
      const slice = all.slice(i, i + BATCH);
      await idbActorsBulkPut(slice);
      console.info('[Background] Actors migrated batch', { from: i, to: Math.min(i + BATCH, all.length) });
    }

    await setValue(STORAGE_KEYS.IDB_ACTORS_MIGRATED, true);
    console.info('[Background] Actors migration finished', { total: all.length });
  } catch (e) {
    console.warn('[Background] Actors migration to IDB failed (will not block extension)', (e as any)?.message);
  }
}
