/**
 * @file restoreService.ts
 * @description restoreService
 * @module features/webdavSync
 */
import {
  logsBulkAdd as idbLogsBulkAdd,
  logsGetAll as idbLogsGetAll,
  magnetPushLogsBulkAdd as idbMagnetPushLogsBulkAdd,
  magnetPushLogsGetAll as idbMagnetPushLogsGetAll,
  initDB,
  logsClear as idbLogsClear,
  viewedGetAll as idbViewedGetAll,
  viewedReplaceAll as idbViewedReplaceAll,
} from '../../../platform/storage/indexedDb';
import {
  CLOUD_SETTINGS_STORAGE_KEY,
  getWebDAVRestorableIdbStoreNames,
  resolveChromeStorageAssetPolicy,
} from '../../../shared/dataAssets/assetRegistry';
import { STORAGE_KEYS } from '../../../utils/config';
import { getSettings, getValue, saveSettings, setValue } from '../../../utils/storage';
import type { WebDAVClientLog } from '../infrastructure/webdavClient';
import { ensureWebDAVClientIdentity } from './clientIdentity';
import { sanitizeImportedSettings } from './importSanitizer';
import { deriveLogCategory, deriveLogSource } from '../../../platform/storage/indexedDbLogFields';
import { parseBackupFromUrl, resolveWebDavUrl } from './restorePreview';
import {
  RESTORE_BATCH_SIZE,
  clearStore,
  putRecordsInBatches,
  toArrayFromObjMap,
} from './restoreStorage';
import { performWebDAVUpload } from './uploadService';
import { mergeMediaCleanupStorageValue } from '../../mediaCleanup';

let restoreInProgress = false;

export interface RestoreServiceOptions {
  logger?: WebDAVClientLog;
  onProgress?: (event: RestoreProgressEvent) => void;
}

export type RestoreCategoryKey =
  | 'settings'
  | 'userProfile'
  | 'viewed'
  | 'actors'
  | 'newWorks'
  | 'lists'
  | 'magnets'
  | 'logs'
  | 'magnetPushLogs'
  | 'importStats';

export type RestoreCategoryMode = 'skip' | 'merge' | 'replace';

export type RestoreCategorySelection = Partial<Record<RestoreCategoryKey, boolean>>;
export type RestoreCategoryModes = Partial<Record<RestoreCategoryKey, RestoreCategoryMode>>;

export interface RestoreProgressEvent {
  stage: 'prepare' | 'autoBackup' | 'download' | 'parse' | 'apply' | 'category' | 'complete' | 'error';
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  message: string;
  category?: RestoreCategoryKey;
  categoryMode?: RestoreCategoryMode;
  completedCategories?: number;
  totalCategories?: number;
  summary?: Record<string, any>;
  error?: string;
}

interface RestoreApplyOptions {
  categories?: RestoreCategorySelection;
  categoryModes?: RestoreCategoryModes;
}

const DEFAULT_RESTORE_CATEGORIES: Record<RestoreCategoryKey, boolean> = {
  settings: true,
  userProfile: true,
  viewed: true,
  actors: true,
  newWorks: true,
  lists: true,
  importStats: true,
  logs: false,
  magnetPushLogs: false,
  magnets: false,
};

const DEFAULT_RESTORE_MODES: Record<RestoreCategoryKey, RestoreCategoryMode> = {
  settings: 'replace',
  userProfile: 'replace',
  viewed: 'merge',
  actors: 'merge',
  newWorks: 'merge',
  lists: 'merge',
  magnets: 'merge',
  logs: 'merge',
  magnetPushLogs: 'merge',
  importStats: 'replace',
};

const EXPLICIT_RESTORE_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.SETTINGS,
  STORAGE_KEYS.USER_PROFILE,
  STORAGE_KEYS.VIEWED_RECORDS,
  STORAGE_KEYS.ACTOR_RECORDS,
  STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS,
  STORAGE_KEYS.NEW_WORKS_RECORDS,
  STORAGE_KEYS.NEW_WORKS_CONFIG,
  STORAGE_KEYS.LAST_IMPORT_STATS,
  STORAGE_KEYS.LOGS,
  'magnetPushLogs_backup',
]);

const GENERIC_IDB_RESTORE_KEY_FIELDS: Record<string, string> = {
  insightsViews: 'date',
  insightsReports: 'month',
  newWorksDailyStats: 'date',
};

async function getCurrentSettingsWithIdentity(): Promise<any> {
  return ensureWebDAVClientIdentity({ getSettings, saveSettings });
}

export async function applyImportDataDirect(importData: any, options?: RestoreApplyOptions, serviceOptions: RestoreServiceOptions = {}): Promise<{ success: boolean; error?: string; summary?: any }> {
  const logger = serviceOptions.logger;
  const opts = {
    categories: { ...DEFAULT_RESTORE_CATEGORIES, ...(options?.categories || {}) },
    categoryModes: { ...DEFAULT_RESTORE_MODES, ...(options?.categoryModes || {}) },
  };

  if (restoreInProgress) return { success: false, error: '另一个恢复任务正在进行，请稍后再试' };
  restoreInProgress = true;
  const tStart = Date.now();
  const summary: any = { categories: {}, startedAt: new Date().toISOString() };
  try {
    const db = await initDB();
    const mark = (name: string, info: any) => { summary.categories[name] = info; };
    const selectedCategories = getSelectedRestoreCategories(opts);
    let completedCategories = 0;
    const emit = serviceOptions.onProgress;
    emit?.({ stage: 'apply', status: 'running', message: '正在应用恢复策略...' });
    const restoreCategory = async (category: RestoreCategoryKey, work: () => Promise<void>): Promise<void> => {
      const categoryMode = opts.categoryModes[category];
      emit?.({
        stage: 'category',
        status: 'running',
        message: `正在恢复${getRestoreCategoryLabel(category)}（${getRestoreCategoryModeLabel(categoryMode)}）...`,
        category,
        categoryMode,
        completedCategories,
        totalCategories: selectedCategories.length,
      });
      try {
        await work();
        completedCategories++;
        const categorySummary = summary.categories[category];
        emit?.({
          stage: 'category',
          status: categorySummary?.reason === 'error' ? 'error' : categorySummary?.reason === 'missing' ? 'skipped' : 'done',
          message: `${getRestoreCategoryLabel(category)}恢复完成`,
          category,
          categoryMode,
          completedCategories,
          totalCategories: selectedCategories.length,
          summary: categorySummary,
          error: categorySummary?.error,
        });
      } catch (e: any) {
        completedCategories++;
        emit?.({
          stage: 'category',
          status: 'error',
          message: `${getRestoreCategoryLabel(category)}恢复失败`,
          category,
          categoryMode,
          completedCategories,
          totalCategories: selectedCategories.length,
          error: e?.message,
        });
        throw e;
      }
    };

    if (shouldRestore(opts, 'settings')) {
      await restoreCategory('settings', async () => {
        const c0 = Date.now();
        try {
          if (importData?.settings) {
            const currentSettings = await getCurrentSettingsWithIdentity();
            await saveSettings(sanitizeImportedSettings(importData.settings, currentSettings));
            mark('settings', { mode: opts.categoryModes.settings, replaced: true, durationMs: Date.now() - c0 });
          } else {
            mark('settings', { mode: opts.categoryModes.settings, replaced: false, reason: 'missing', durationMs: Date.now() - c0 });
          }
        } catch (e: any) {
          mark('settings', { mode: opts.categoryModes.settings, replaced: false, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'userProfile')) {
      await restoreCategory('userProfile', async () => {
        const c0 = Date.now();
        try {
          const val = importData?.userProfile ?? importData?.storageAll?.[STORAGE_KEYS.USER_PROFILE];
          if (val != null) {
            await setValue(STORAGE_KEYS.USER_PROFILE, val);
            mark('userProfile', { mode: opts.categoryModes.userProfile, replaced: true, durationMs: Date.now() - c0 });
          } else {
            mark('userProfile', { mode: opts.categoryModes.userProfile, replaced: false, reason: 'missing', durationMs: Date.now() - c0 });
          }
        } catch (e: any) {
          mark('userProfile', { mode: opts.categoryModes.userProfile, replaced: false, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'viewed')) {
      await restoreCategory('viewed', async () => {
        const c0 = Date.now();
        try {
          const cloudItems = readViewedRecords(importData);
          const mode = opts.categoryModes.viewed;
          if (mode === 'merge') {
            const localItems = await safeGetAll(() => idbViewedGetAll());
            const merged = mergeRecordsByKey(localItems, cloudItems, { key: 'id' });
            const written = await idbViewedReplaceAll(merged.records);
            mark('viewed', { mode, cleared: true, written, ...merged.summary, durationMs: Date.now() - c0 });
          } else {
            const records = dedupeRecordsByKey(cloudItems, 'id');
            const written = await idbViewedReplaceAll(records);
            mark('viewed', { mode, cleared: true, written, durationMs: Date.now() - c0 });
          }
        } catch (e: any) {
          mark('viewed', { cleared: false, written: 0, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'actors')) {
      await restoreCategory('actors', async () => {
        const c0 = Date.now();
        try {
          const cloudItems = readActorRecords(importData);
          const mode = opts.categoryModes.actors;
          const localItems = mode === 'merge' ? await safeGetAll(() => db.getAll('actors')) : [];
          const merged = mode === 'merge' ? mergeRecordsByKey(localItems, cloudItems, { key: 'id' }) : null;
          const items = merged ? merged.records : dedupeRecordsByKey(cloudItems, 'id');
          const written = await replaceStoreRecords(db, 'actors', items, logger);
          mark('actors', { mode, cleared: true, written, ...(merged?.summary || {}), durationMs: Date.now() - c0 });
        } catch (e: any) {
          mark('actors', { cleared: false, written: 0, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'newWorks')) {
      await restoreCategory('newWorks', async () => {
        const c0 = Date.now();
        try {
          const cloudItems = readNewWorksRecords(importData);
          const mode = opts.categoryModes.newWorks;
          const localItems = mode === 'merge' ? await safeGetAll(() => db.getAll('newWorks')) : [];
          const mergedIdb = mode === 'merge' ? mergeRecordsByKey(localItems, cloudItems, { key: 'id' }) : null;
          const items = mergedIdb ? mergedIdb.records : dedupeRecordsByKey(cloudItems, 'id');
          const written = await replaceStoreRecords(db, 'newWorks', items, logger);
          const subs = importData?.newWorks?.subscriptions ?? importData?.storageAll?.[STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS];
          const recs = importData?.newWorks?.records ?? importData?.storageAll?.[STORAGE_KEYS.NEW_WORKS_RECORDS];
          const cfg = importData?.newWorks?.config ?? importData?.storageAll?.[STORAGE_KEYS.NEW_WORKS_CONFIG];
          if (subs != null) await setValue(STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS, mode === 'merge'
            ? mergeObjectMaps(await getValueSafe(STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS, {}), subs).map
            : subs);
          if (recs != null) await setValue(STORAGE_KEYS.NEW_WORKS_RECORDS, mode === 'merge'
            ? mergeObjectMaps(await getValueSafe(STORAGE_KEYS.NEW_WORKS_RECORDS, {}), recs).map
            : recs);
          if (cfg != null) await setValue(STORAGE_KEYS.NEW_WORKS_CONFIG, cfg);
          mark('newWorks', { mode, cleared: true, written, ...(mergedIdb?.summary || {}), durationMs: Date.now() - c0 });
        } catch (e: any) {
          mark('newWorks', { cleared: false, written: 0, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'lists')) {
      await restoreCategory('lists', async () => {
        const c0 = Date.now();
        try {
          const cloudItems = Array.isArray(importData?.idb?.lists) ? importData.idb.lists : [];
          const mode = opts.categoryModes.lists;
          const localItems = mode === 'merge' ? await safeGetAll(() => db.getAll('lists')) : [];
          const merged = mode === 'merge' ? mergeRecordsByKey(localItems, cloudItems, { key: 'id' }) : null;
          const items = merged ? merged.records : dedupeRecordsByKey(cloudItems, 'id');
          const written = await replaceStoreRecords(db, 'lists', items, logger);
          mark('lists', { mode, cleared: true, written, ...(merged?.summary || {}), durationMs: Date.now() - c0 });
        } catch (e: any) {
          mark('lists', { cleared: false, written: 0, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'magnets')) {
      await restoreCategory('magnets', async () => {
        const c0 = Date.now();
        try {
          let items: any[] = [];
          if (Array.isArray(importData?.idb?.magnets)) items = importData.idb.magnets;
          const mode = opts.categoryModes.magnets;
          const localItems = mode === 'merge' ? await safeGetAll(() => db.getAll('magnets')) : [];
          const merged = mode === 'merge'
            ? mergeRecordsByIdentity(localItems, items, getMagnetRecordKey)
            : null;
          const records = merged ? merged.records : dedupeRecordsByIdentity(items, getMagnetRecordKey);
          const written = await replaceStoreRecords(db, 'magnets', records, logger);
          mark('magnets', { mode, cleared: true, written, ...(merged?.summary || {}), durationMs: Date.now() - c0 });
        } catch (e: any) {
          mark('magnets', { cleared: false, written: 0, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'logs')) {
      await restoreCategory('logs', async () => {
        const c0 = Date.now();
        try {
          let items: any[] = [];
          if (Array.isArray(importData?.idb?.logs)) items = importData.idb.logs;
          else if (Array.isArray(importData?.logs)) items = importData.logs;
          const mode = opts.categoryModes.logs;
          const cloudItems = dedupeRecordsByIdentity(items, getLogRecordKey).map(stripAutoIncrementId);
          if (mode === 'merge') {
            const localItems = await safeGetAll(() => idbLogsGetAll());
            const additions = selectCloudOnlyRecords(localItems, cloudItems, getLogRecordKey).map(stripAutoIncrementId);
            if (additions.length > 0) await idbLogsBulkAdd(additions as any);
            mark('logs', {
              mode,
              cleared: false,
              written: additions.length,
              added: additions.length,
              kept: localItems.length,
              total: localItems.length + additions.length,
              durationMs: Date.now() - c0,
            });
          } else {
            await idbLogsClear();
            if (cloudItems.length > 0) await idbLogsBulkAdd(cloudItems as any);
            mark('logs', { mode, cleared: true, written: cloudItems.length, durationMs: Date.now() - c0 });
          }
        } catch (e: any) {
          mark('logs', { cleared: false, written: 0, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'magnetPushLogs')) {
      await restoreCategory('magnetPushLogs', async () => {
        const c0 = Date.now();
        try {
          let items: any[] = [];
          if (Array.isArray(importData?.idb?.magnetPushLogs)) items = importData.idb.magnetPushLogs;
          else if (Array.isArray(importData?.magnetPushLogs)) items = importData.magnetPushLogs;
          else if (Array.isArray(importData?.data?.magnetPushLogs)) items = importData.data.magnetPushLogs;
          const mode = opts.categoryModes.magnetPushLogs;
          const cloudItems = dedupeRecordsByIdentity(items, getMagnetPushLogRecordKey).map(stripAutoIncrementId);
          if (mode === 'merge') {
            const localItems = await safeGetAll(() => idbMagnetPushLogsGetAll());
            const additions = selectCloudOnlyRecords(localItems, cloudItems, getMagnetPushLogRecordKey).map(stripAutoIncrementId);
            if (additions.length > 0) await idbMagnetPushLogsBulkAdd(additions as any);
            mark('magnetPushLogs', {
              mode,
              cleared: false,
              written: additions.length,
              added: additions.length,
              kept: localItems.length,
              total: localItems.length + additions.length,
              durationMs: Date.now() - c0,
            });
          } else {
            try { await clearStore(db, 'magnetPushLogs', logger); } catch {}
            if (cloudItems.length > 0) await idbMagnetPushLogsBulkAdd(cloudItems as any);
            mark('magnetPushLogs', { mode, cleared: true, written: cloudItems.length, durationMs: Date.now() - c0 });
          }
        } catch (e: any) {
          mark('magnetPushLogs', { cleared: false, written: 0, reason: 'error', error: e?.message, durationMs: Date.now() - c0 });
        }
      });
    }

    if (shouldRestore(opts, 'importStats')) {
      await restoreCategory('importStats', async () => {
        const c0 = Date.now();
        const val = importData?.importStats ?? importData?.storageAll?.[STORAGE_KEYS.LAST_IMPORT_STATS];
        if (val != null) {
          await setValue(STORAGE_KEYS.LAST_IMPORT_STATS, val);
          mark('importStats', { mode: opts.categoryModes.importStats, replaced: true, durationMs: Date.now() - c0 });
        } else {
          mark('importStats', { mode: opts.categoryModes.importStats, replaced: false, reason: 'missing', durationMs: Date.now() - c0 });
        }
      });
    }

    await restoreRegisteredStorageAll(importData, summary);
    await restoreRegisteredIdbStores(importData, db, summary, logger);

    summary.totalDurationMs = Date.now() - tStart;
    emit?.({ stage: 'apply', status: 'done', message: '恢复数据写入完成' });
    return { success: true, summary };
  } catch (e: any) {
    return { success: false, error: e?.message, summary };
  } finally {
    restoreInProgress = false;
  }
}

export async function performRestoreUnified(filename: string, options?: {
  categories?: RestoreCategorySelection;
  categoryModes?: RestoreCategoryModes;
  autoBackupBeforeRestore?: boolean;
}, serviceOptions: RestoreServiceOptions = {}): Promise<{ success: boolean; error?: string; summary?: any }> {
  const logger = serviceOptions.logger;
  const emit = serviceOptions.onProgress;
  const opts = {
    categories: { ...DEFAULT_RESTORE_CATEGORIES, ...(options?.categories || {}) },
    categoryModes: { ...DEFAULT_RESTORE_MODES, ...(options?.categoryModes || {}) },
    autoBackupBeforeRestore: options?.autoBackupBeforeRestore ?? true,
  };

  if (restoreInProgress) return { success: false, error: '另一个恢复任务正在进行，请稍后再试' };
  restoreInProgress = true;
  const tStart = Date.now();
  const summary: any = { categories: {}, startedAt: new Date().toISOString() };
  try {
    emit?.({ stage: 'prepare', status: 'running', message: '正在检查 WebDAV 配置...' });
    const settings = await getSettings();
    if (!settings.webdav.enabled || !settings.webdav.url) {
      throw new Error('WebDAV 未启用或 URL 未配置');
    }
    const finalUrl = resolveWebDavUrl(filename, settings.webdav.url);
    emit?.({ stage: 'prepare', status: 'done', message: 'WebDAV 配置检查完成' });
    if (opts.autoBackupBeforeRestore) {
      emit?.({ stage: 'autoBackup', status: 'running', message: '正在进行恢复前自动备份...' });
      try {
        await performWebDAVUpload({ getSettings, saveSettings, logger });
        emit?.({ stage: 'autoBackup', status: 'done', message: '恢复前自动备份完成' });
      } catch (e: any) {
        logger?.('WARN', 'Auto-backup before restore failed', { error: e?.message });
        emit?.({ stage: 'autoBackup', status: 'error', message: '恢复前自动备份失败，继续执行恢复', error: e?.message });
      }
    }

    const importData = await parseBackupFromUrl(
      finalUrl,
      { username: settings.webdav.username, password: settings.webdav.password },
      event => emit?.(event),
    );
    restoreInProgress = false;
    const directResult = await applyImportDataDirect(importData, {
      categories: opts.categories,
      categoryModes: opts.categoryModes,
    }, serviceOptions);
    summary.categories = directResult.summary?.categories || {};
    summary.totalDurationMs = Date.now() - tStart;
    if (directResult.success) {
      emit?.({ stage: 'complete', status: 'done', message: '恢复完成' });
      return { success: true, summary };
    }
    emit?.({ stage: 'error', status: 'error', message: '恢复失败', error: directResult.error });
    return { success: false, error: directResult.error, summary };
  } catch (e: any) {
    emit?.({ stage: 'error', status: 'error', message: '恢复失败', error: e?.message });
    return { success: false, error: e?.message, summary };
  } finally {
    restoreInProgress = false;
  }
}

function shouldRestore(opts: { categories: Record<RestoreCategoryKey, boolean>; categoryModes: Record<RestoreCategoryKey, RestoreCategoryMode> }, category: RestoreCategoryKey): boolean {
  return opts.categories[category] === true && opts.categoryModes[category] !== 'skip';
}

function getSelectedRestoreCategories(opts: { categories: Record<RestoreCategoryKey, boolean>; categoryModes: Record<RestoreCategoryKey, RestoreCategoryMode> }): RestoreCategoryKey[] {
  return (Object.keys(DEFAULT_RESTORE_CATEGORIES) as RestoreCategoryKey[])
    .filter(category => shouldRestore(opts, category));
}

function getRestoreCategoryLabel(category: RestoreCategoryKey): string {
  const labels: Record<RestoreCategoryKey, string> = {
    settings: '扩展设置',
    userProfile: '账号信息',
    viewed: '观看记录',
    actors: '演员库',
    newWorks: '新作品',
    lists: '清单 / 系列 / 番号',
    magnets: '磁链缓存',
    logs: '日志记录',
    magnetPushLogs: '磁力推送日志',
    importStats: '导入统计',
  };
  return labels[category];
}

function getRestoreCategoryModeLabel(mode: RestoreCategoryMode): string {
  const labels: Record<RestoreCategoryMode, string> = {
    skip: '跳过',
    merge: '合并',
    replace: '覆盖',
  };
  return labels[mode];
}

function readViewedRecords(importData: any): any[] {
  if (Array.isArray(importData?.idb?.viewedRecords)) return importData.idb.viewedRecords;
  if (importData?.data) return toArrayFromObjMap(importData.data);
  if (importData?.viewed) return toArrayFromObjMap(importData.viewed);
  if (importData?.storageAll?.[STORAGE_KEYS.VIEWED_RECORDS]) return toArrayFromObjMap(importData.storageAll[STORAGE_KEYS.VIEWED_RECORDS]);
  return [];
}

function readActorRecords(importData: any): any[] {
  if (Array.isArray(importData?.idb?.actors)) return importData.idb.actors;
  if (importData?.actorRecords) return toArrayFromObjMap(importData.actorRecords);
  if (importData?.storageAll?.[STORAGE_KEYS.ACTOR_RECORDS]) return toArrayFromObjMap(importData.storageAll[STORAGE_KEYS.ACTOR_RECORDS]);
  return [];
}

function readNewWorksRecords(importData: any): any[] {
  if (Array.isArray(importData?.idb?.newWorks)) return importData.idb.newWorks;
  if (importData?.newWorks?.records) return toArrayFromObjMap(importData.newWorks.records);
  if (importData?.storageAll?.[STORAGE_KEYS.NEW_WORKS_RECORDS]) return toArrayFromObjMap(importData.storageAll[STORAGE_KEYS.NEW_WORKS_RECORDS]);
  return [];
}

async function safeGetAll<T>(reader: () => Promise<T[]>): Promise<T[]> {
  try {
    const items = await reader();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function getValueSafe(key: string, fallback: any): Promise<any> {
  try {
    return await getValue(key as any, fallback);
  } catch {
    return fallback;
  }
}

async function restoreRegisteredStorageAll(importData: any, summary: any): Promise<void> {
  const storageAll = importData?.storageAll;
  if (!storageAll || typeof storageAll !== 'object' || Array.isArray(storageAll)) {
    return;
  }

  const restored: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(storageAll as Record<string, unknown>)) {
    const policy = resolveChromeStorageAssetPolicy(key);
    if (!policy?.webdav.restore || EXPLICIT_RESTORE_STORAGE_KEYS.has(key)) {
      skipped.push(key);
      continue;
    }

    if (key === CLOUD_SETTINGS_STORAGE_KEY) {
      await setValue(key, await mergeCloudSettingsForRestore(value));
    } else if (policy.webdav.restoreMode === 'merge') {
      const localValue = await getValueSafe(key, undefined);
      await setValue(key, mergeMediaCleanupStorageValue(key, localValue, value));
    } else {
      await setValue(key, value);
    }
    restored.push(key);
  }

  if (restored.length > 0 || skipped.length > 0) {
    summary.categories.storageAll = {
      restored: restored.sort(),
      skipped: skipped.sort(),
    };
  }
}

async function restoreRegisteredIdbStores(
  importData: any,
  db: any,
  summary: any,
  logger?: WebDAVClientLog,
): Promise<void> {
  const idbData = importData?.idb;
  if (!idbData || typeof idbData !== 'object' || Array.isArray(idbData)) {
    return;
  }

  const restorableStores = new Set(getWebDAVRestorableIdbStoreNames());
  const storeSummary: Record<string, any> = {};
  for (const [storeName, keyField] of Object.entries(GENERIC_IDB_RESTORE_KEY_FIELDS)) {
    if (!restorableStores.has(storeName)) continue;
    const cloudItems = Array.isArray(idbData[storeName]) ? idbData[storeName] : [];
    if (cloudItems.length === 0) continue;

    const localItems = await safeGetAll(() => db.getAll(storeName));
    const merged = mergeRecordsByKey(localItems, cloudItems, { key: keyField });
    const written = await replaceStoreRecords(db, storeName, merged.records, logger);
    storeSummary[storeName] = {
      mode: 'merge',
      cleared: true,
      written,
      ...merged.summary,
    };
  }

  if (Object.keys(storeSummary).length > 0) {
    summary.categories.idbRegistry = storeSummary;
  }
}

async function mergeCloudSettingsForRestore(remoteValue: unknown): Promise<Record<string, unknown>> {
  const remote = remoteValue && typeof remoteValue === 'object'
    ? { ...(remoteValue as Record<string, unknown>) }
    : {};
  const local = await getValueSafe(CLOUD_SETTINGS_STORAGE_KEY, {});
  const localRecord = local && typeof local === 'object' ? local as Record<string, unknown> : {};
  const localDeviceId =
    typeof localRecord.deviceId === 'string' && localRecord.deviceId.trim()
      ? localRecord.deviceId.trim()
      : '';
  const remoteDeviceId =
    typeof remote.deviceId === 'string' && remote.deviceId.trim()
      ? remote.deviceId.trim()
      : '';

  return {
    ...remote,
    deviceId: localDeviceId || remoteDeviceId,
  };
}

async function replaceStoreRecords(
  db: any,
  storeName: string,
  records: any[],
  logger?: WebDAVClientLog,
): Promise<number> {
  await clearStore(db, storeName, logger);
  return putRecordsInBatches(db, storeName, records, RESTORE_BATCH_SIZE, logger);
}

function dedupeRecordsByKey<T extends Record<string, any>>(records: T[], key: string): T[] {
  return Array.from(buildLatestRecordMap(records, key).values());
}

function mergeRecordsByKey<T extends Record<string, any>>(
  localRecords: T[],
  cloudRecords: T[],
  options: { key: string },
): { records: T[]; summary: { added: number; updated: number; kept: number; total: number } } {
  const localMap = buildLatestRecordMap(localRecords, options.key);
  const cloudMap = buildLatestRecordMap(cloudRecords, options.key);
  const merged = new Map<string, T>(localMap);
  let added = 0;
  let updated = 0;

  for (const [id, cloud] of cloudMap.entries()) {
    const local = localMap.get(id);
    if (!local) {
      merged.set(id, cloud);
      added++;
      continue;
    }
    const winner = pickLatestRecord(local, cloud);
    merged.set(id, winner);
    if (winner !== local) updated++;
  }

  const kept = Array.from(localMap.keys()).filter(id => !cloudMap.has(id) || merged.get(id) === localMap.get(id)).length;
  return {
    records: Array.from(merged.values()),
    summary: {
      added,
      updated,
      kept,
      total: merged.size,
    },
  };
}

function dedupeRecordsByIdentity<T extends Record<string, any>>(
  records: T[],
  getKey: (record: T) => string,
): T[] {
  return Array.from(buildLatestIdentityMap(records, getKey).values());
}

function mergeRecordsByIdentity<T extends Record<string, any>>(
  localRecords: T[],
  cloudRecords: T[],
  getKey: (record: T) => string,
): { records: T[]; summary: { added: number; updated: number; kept: number; total: number } } {
  const localMap = buildLatestIdentityMap(localRecords, getKey);
  const cloudMap = buildLatestIdentityMap(cloudRecords, getKey);
  const merged = new Map<string, T>(localMap);
  let added = 0;
  let updated = 0;

  for (const [key, cloud] of cloudMap.entries()) {
    const local = localMap.get(key);
    if (!local) {
      merged.set(key, cloud);
      added++;
      continue;
    }
    const winner = pickLatestRecord(local, cloud);
    merged.set(key, winner);
    if (winner !== local) updated++;
  }

  const kept = Array.from(localMap.keys()).filter(key => !cloudMap.has(key) || merged.get(key) === localMap.get(key)).length;
  return {
    records: Array.from(merged.values()),
    summary: {
      added,
      updated,
      kept,
      total: merged.size,
    },
  };
}

function selectCloudOnlyRecords<T extends Record<string, any>>(
  localRecords: T[],
  cloudRecords: T[],
  getKey: (record: T) => string,
): T[] {
  const localKeys = new Set(Array.from(buildLatestIdentityMap(localRecords, getKey).keys()));
  return dedupeRecordsByIdentity(cloudRecords, getKey).filter(record => !localKeys.has(getKey(record)));
}

function buildLatestRecordMap<T extends Record<string, any>>(records: T[], key: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of Array.isArray(records) ? records : []) {
    const id = String(record?.[key] || '').trim();
    if (!id) continue;
    const current = map.get(id);
    map.set(id, current ? pickLatestRecord(current, record) : record);
  }
  return map;
}

function buildLatestIdentityMap<T extends Record<string, any>>(
  records: T[],
  getKey: (record: T) => string,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of Array.isArray(records) ? records : []) {
    const key = String(getKey(record) || '').trim();
    if (!key) continue;
    const current = map.get(key);
    map.set(key, current ? pickLatestRecord(current, record) : record);
  }
  return map;
}

function pickLatestRecord<T extends Record<string, any>>(left: T, right: T): T {
  return readRecordTime(right) >= readRecordTime(left) ? right : left;
}

function readRecordTime(record: Record<string, any>): number {
  const source = record?.value && typeof record.value === 'object' ? record.value : record;
  // deletedAt 优先级最高：软删除操作视为最新状态
  // 确保恢复时保留"已删除"状态，避免被旧的正常记录覆盖
  const deletedAt = Number(source?.deletedAt ?? 0);
  if (deletedAt > 0) return deletedAt;
  const value = Number(source?.updatedAt ?? source?.createdAt ?? source?.timestampMs ?? source?.timestamp ?? source?.discoveredAt ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getMagnetRecordKey(record: Record<string, any>): string {
  return String(record?.key || record?.magnet || [record?.videoId, record?.source, record?.name].filter(Boolean).join('|') || stableRecordFingerprint(record));
}

function getLogRecordKey(record: Record<string, any>): string {
  const message = String(record?.message || '');
  return [
    record?.timestampMs ?? record?.timestamp,
    record?.level,
    record?.source || deriveLogSource(message),
    record?.category || deriveLogCategory(message),
    message,
    stableRecordFingerprint(record?.data),
  ].map(value => String(value ?? '')).join('|');
}

function getMagnetPushLogRecordKey(record: Record<string, any>): string {
  return [
    record?.timestampMs ?? record?.timestamp,
    record?.type,
    record?.videoId,
    record?.message,
    stableRecordFingerprint(record?.data),
  ].map(value => String(value ?? '')).join('|');
}

function stripAutoIncrementId<T extends Record<string, any>>(record: T): T {
  const { id, ...rest } = record || {};
  return rest as T;
}

function stableRecordFingerprint(value: any): string {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableRecordFingerprint).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${key}:${stableRecordFingerprint(value[key])}`).join(',')}}`;
}

function mergeObjectMaps(localMap: any, cloudMap: any): { map: Record<string, any> } {
  const localRecords = Object.entries(localMap || {}).map(([id, value]) => ({ __key: id, value }));
  const cloudRecords = Object.entries(cloudMap || {}).map(([id, value]) => ({ __key: id, value }));
  const merged = mergeRecordsByKey(localRecords, cloudRecords, { key: '__key' }).records;
  return {
    map: Object.fromEntries(merged.map((record: any) => [record.__key, record.value])),
  };
}
