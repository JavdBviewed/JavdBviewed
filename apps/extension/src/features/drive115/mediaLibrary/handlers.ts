/**
 * @file handlers.ts
 * @description 115 媒体库索引 background / 消息处理
 * @module features/drive115/mediaLibrary
 */
import { STORAGE_KEYS } from '../../../utils/config';
import { getSettings, getValue, saveSettings, setValue } from '../../../utils/storage';
import { mediaLog } from '../../embyLibrary/mediaLibraryLogger';
import { getDrive115V2Service, type Drive115V2FileListResponse } from '../v2';
import type { ExtensionSettings } from '../../../types';
import { indexDrive115Roots } from './indexer';
import { NFO_SUMMARY_SCHEMA_VERSION, parseNfoSummary } from './parseEntryMeta';
import {
  clearDrive115IndexCheckpoint,
  loadDrive115IndexCheckpoint,
  loadDrive115LibraryState,
  saveDrive115IndexCheckpoint,
  saveDrive115LibraryState,
} from './store';
import { createLatestValueWriter, type LatestValueWriter } from './latestValueWriter';
import type {
  Drive115IndexCheckpoint,
  Drive115IndexReport,
  Drive115IndexProgressSnapshot,
  Drive115IndexResult,
  Drive115LibraryIndexState,
  Drive115MediaLibraryRoot,
} from './types';

type SendResponse = (response: unknown) => void;

type Drive115SettingsRecord = Record<string, unknown> & {
  mediaLibraryRoots?: unknown;
  mediaLibraryScanDepth?: unknown;
};

type Drive115IndexOptions = {
  rootCids?: string[];
};

export const DRIVE115_LIBRARY_INDEX_RESUME_ALARM = 'drive115-library-index-resume';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(error);
}

function readRawCode(raw: Drive115V2FileListResponse | undefined): number | undefined {
  const code = Number(raw?.code);
  return Number.isFinite(code) && code > 0 ? code : undefined;
}

let indexingPromise: Promise<Drive115IndexResult> | null = null;
let cancelIndexRequested = false;
let indexAbortController: AbortController | null = null;
const INDEX_HISTORY_LIMIT = 20;
const PARTIAL_STATE_PERSIST_INTERVAL_MS = 2_000;
const INDEX_PROGRESS_PERSIST_INTERVAL_MS = 500;

function log115(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown): void {
  const text = `[115] ${message}`;
  if (level === 'error') mediaLog.error(text, data);
  else if (level === 'warn') mediaLog.warn(text, data);
  else if (level === 'debug') mediaLog.debug(text, data);
  else mediaLog.info(text, data);
}

const indexProgressWriter = createLatestValueWriter<Drive115IndexProgressSnapshot | null>(
  (snapshot) => setValue(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS, snapshot),
  (error) => log115('debug', '写入索引进度失败', error),
);
let lastIndexProgressPersistAt = 0;

function enqueueIndexProgress(
  snapshot: Drive115IndexProgressSnapshot | null,
  options: { force?: boolean } = {},
): void {
  const now = Date.now();
  if (!options.force
    && lastIndexProgressPersistAt > 0
    && now - lastIndexProgressPersistAt < INDEX_PROGRESS_PERSIST_INTERVAL_MS) {
    return;
  }
  lastIndexProgressPersistAt = now;
  indexProgressWriter.enqueue(snapshot);
}

async function flushIndexProgress(): Promise<void> {
  await indexProgressWriter.flush();
}

async function stopPersistedIndexProgress(message: string): Promise<void> {
  const previous = await getValue<Drive115IndexProgressSnapshot | null>(
    STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS,
    null,
  );
  const base = previous && typeof previous === 'object' ? previous : null;
  enqueueIndexProgress({
    phase: 'error',
    rootsTotal: base?.rootsTotal,
    rootsDone: base?.rootsDone,
    foldersSeen: base?.foldersSeen,
    indexed: base?.indexed,
    skipped: base?.skipped,
    apiCalls: base?.apiCalls,
    message,
    running: false,
    updatedAt: Date.now(),
  }, { force: true });
  await flushIndexProgress();
}

/** 规范化片库根目录（不依赖 dashboard model，避免 features→apps） */
function normalizeRoots(raw: unknown): Drive115MediaLibraryRoot[] {
  if (!Array.isArray(raw)) return [];
  const byCid = new Map<string, Drive115MediaLibraryRoot>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const cid = String(row.cid ?? '').trim();
    if (!cid) continue;
    byCid.set(cid, {
      cid,
      name: typeof row.name === 'string' ? row.name : undefined,
      path: typeof row.path === 'string' ? row.path : undefined,
      enabled: row.enabled !== false,
    });
  }
  return Array.from(byCid.values());
}

function readRootsFromSettings(settings: ExtensionSettings): Drive115MediaLibraryRoot[] {
  const drive115 = asRecord(settings.drive115) as Drive115SettingsRecord;
  return normalizeRoots(drive115.mediaLibraryRoots);
}

function readScanDepthFromSettings(settings: ExtensionSettings): number | undefined {
  const drive115 = asRecord(settings.drive115) as Drive115SettingsRecord;
  const depth = Number(drive115.mediaLibraryScanDepth);
  return Number.isFinite(depth) ? depth : undefined;
}

function normalizeRequestedRootCids(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(value.map((cid) => String(cid || '').trim()).filter(Boolean)));
}

function matchesIndexCheckpoint(
  checkpoint: Drive115IndexCheckpoint | null,
  roots: Drive115MediaLibraryRoot[],
  scanDepth: number | undefined,
): checkpoint is Drive115IndexCheckpoint {
  if (!checkpoint || checkpoint.scanDepth !== scanDepth) return false;
  const configured = roots.map((root) => root.cid).sort();
  const saved = [...checkpoint.rootCids].sort();
  return configured.length === saved.length && configured.every((cid, index) => cid === saved[index]);
}

function scheduleIndexResume(checkpoint: Drive115IndexCheckpoint): void {
  try {
    if (!chrome?.alarms?.create) return;
    chrome.alarms.create(DRIVE115_LIBRARY_INDEX_RESUME_ALARM, {
      when: Math.max(Date.now() + 60_000, checkpoint.resumeAt),
    });
  } catch (error) {
    log115('warn', '注册索引继续任务失败', error);
  }
}

/** 冷启动或浏览器重启后，根据持久检查点恢复一次性继续闹钟。 */
export async function ensureDrive115MediaLibraryResumeAlarm(): Promise<void> {
  const checkpoint = await loadDrive115IndexCheckpoint();
  if (!checkpoint) return;
  scheduleIndexResume(checkpoint);
}

async function clearScheduledIndexResume(): Promise<void> {
  try {
    await chrome?.alarms?.clear?.(DRIVE115_LIBRARY_INDEX_RESUME_ALARM);
  } catch {
    // alarm 不可用时仅清除持久化检查点
  }
}

/** 仅保留最近 20 次本机索引记录，错误不再长期占据设置主面板。 */
async function appendDrive115IndexHistory(report: Drive115IndexReport): Promise<void> {
  try {
    const previous = await getValue<unknown>(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_HISTORY, []);
    const existing = Array.isArray(previous)
      ? previous.filter((item): item is Drive115IndexReport => !!item && typeof item === 'object')
      : [];
    const history = [report, ...existing.filter((item) => (
      item.startedAt !== report.startedAt || item.finishedAt !== report.finishedAt
    ))].slice(0, INDEX_HISTORY_LIMIT);
    await setValue(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_HISTORY, history);
  } catch (error) {
    log115('debug', '写入索引记录失败', error);
  }
}

function mergeUnselectedRootEntries(
  state: Drive115LibraryIndexState,
  preservedEntries: Drive115LibraryIndexState['entries'],
  configuredRootCount: number,
): Drive115LibraryIndexState {
  if (preservedEntries.length === 0) return state;
  const byKey = new Map(preservedEntries.map((entry) => [entry.key, entry]));
  for (const entry of state.entries) byKey.set(entry.key, entry);
  const entries = Array.from(byKey.values());
  return {
    ...state,
    entries,
    stats: {
      ...state.stats,
      roots: configuredRootCount,
      indexed: entries.length,
    },
  };
}

async function patchDrive115IndexMeta(patch: {
  mediaLibraryLastIndexAt?: number | null;
  mediaLibraryLastIndexError?: string | null;
}): Promise<void> {
  try {
    const settings = await getSettings();
    const prev = asRecord(settings.drive115);
    const nextDrive115 = { ...prev };
    if ('mediaLibraryLastIndexAt' in patch) {
      nextDrive115.mediaLibraryLastIndexAt = patch.mediaLibraryLastIndexAt ?? null;
    }
    if ('mediaLibraryLastIndexError' in patch) {
      const err = patch.mediaLibraryLastIndexError;
      if (err == null || err === '') delete nextDrive115.mediaLibraryLastIndexError;
      else nextDrive115.mediaLibraryLastIndexError = err;
    }
    await saveSettings({ ...settings, drive115: nextDrive115 });
  } catch (e) {
    log115('warn', '写入索引元数据失败', e);
  }
}

/**
 * 执行一次手动索引（串行；并发请求复用同一 promise）
 */
export async function runDrive115MediaLibraryIndex(
  options: Drive115IndexOptions = {},
): Promise<Drive115IndexResult> {
  if (indexingPromise) return indexingPromise;

  cancelIndexRequested = false;
  indexAbortController = new AbortController();
  let stateSaveQueue: LatestValueWriter<Drive115LibraryIndexState> | undefined;
  indexingPromise = (async () => {
    const previous = await loadDrive115LibraryState();
    try {
      const settings = await getSettings();
      const roots = readRootsFromSettings(settings);
      const scanDepth = readScanDepthFromSettings(settings);
      const allEnabled = roots.filter((r) => r.enabled !== false);
      const requestedRootCids = normalizeRequestedRootCids(options.rootCids);
      const requestedSet = requestedRootCids ? new Set(requestedRootCids) : null;
      const enabled = requestedSet
        ? allEnabled.filter((root) => requestedSet.has(root.cid))
        : allEnabled;
      if (!enabled.length) {
        const message = requestedSet
          ? '所选 115 片库目录不存在或已停用'
          : '未配置启用的片库根目录';
        const result: Drive115IndexResult = {
          success: false,
          keptPrevious: previous.entries.length > 0,
          state: { ...previous, lastError: message },
          message,
        };
        await patchDrive115IndexMeta({
          mediaLibraryLastIndexError: result.message || null,
        });
        enqueueIndexProgress({
          phase: 'error',
          message: result.message || message,
          running: false,
          updatedAt: Date.now(),
        }, { force: true });
        await flushIndexProgress();
        return result;
      }

      const isPartial = requestedSet !== null && enabled.length < allEnabled.length;
      const selectedSet = new Set(enabled.map((root) => root.cid));
      const selectedPrevious: Drive115LibraryIndexState = isPartial
        ? {
          ...previous,
          entries: previous.entries.filter((entry) => selectedSet.has(entry.rootCid)),
        }
        : previous;
      const preservedEntries = isPartial
        ? previous.entries.filter((entry) => !selectedSet.has(entry.rootCid))
        : [];
      const mergePartialState = (state: Drive115LibraryIndexState): Drive115LibraryIndexState => (
        isPartial
          ? mergeUnselectedRootEntries(state, preservedEntries, allEnabled.length)
          : state
      );
      const storedCheckpoint = await loadDrive115IndexCheckpoint();
      const checkpoint = matchesIndexCheckpoint(storedCheckpoint, enabled, scanDepth)
        ? storedCheckpoint
        : null;
      if (storedCheckpoint && !checkpoint) {
        await clearDrive115IndexCheckpoint();
        await clearScheduledIndexResume();
      }

      const svc = getDrive115V2Service();
      const tokenRet = await svc.getValidAccessToken({ forceAutoRefresh: true });
      if (!tokenRet.success) {
        const msg = tokenRet.message || '无法获取 115 授权';
        const result: Drive115IndexResult = {
          success: false,
          keptPrevious: previous.entries.length > 0,
          state: { ...previous, lastError: msg },
          message: msg,
        };
        await patchDrive115IndexMeta({ mediaLibraryLastIndexError: msg });
        enqueueIndexProgress({
          phase: 'error',
          message: msg,
          running: false,
          updatedAt: Date.now(),
        }, { force: true });
        await flushIndexProgress();
        return result;
      }
      if (!tokenRet.accessToken) {
        const msg = '无法获取 115 授权';
        const result: Drive115IndexResult = {
          success: false,
          keptPrevious: previous.entries.length > 0,
          state: { ...previous, lastError: msg },
          message: msg,
        };
        await patchDrive115IndexMeta({ mediaLibraryLastIndexError: msg });
        enqueueIndexProgress({
          phase: 'error',
          message: msg,
          running: false,
          updatedAt: Date.now(),
        }, { force: true });
        await flushIndexProgress();
        return result;
      }
      const accessToken = tokenRet.accessToken;

      log115('info', `开始索引，根目录 ${enabled.length} 个`, {
        roots: enabled.map((r) => r.cid),
        scanDepth,
        checkpoint,
      });
      enqueueIndexProgress({
        phase: 'start',
        message: `开始索引 ${enabled.length} 个片库根目录${scanDepth ? `，深度 ${scanDepth} 层` : ''}`,
        rootsTotal: enabled.length,
        rootsDone: 0,
        foldersSeen: 0,
        indexed: 0,
        skipped: 0,
        apiCalls: 0,
        running: true,
        updatedAt: Date.now(),
      }, { force: true });
      await flushIndexProgress();

      // 只保留正在写入的快照和最新待写快照，避免 storage 慢时积压完整索引副本。
      stateSaveQueue = createLatestValueWriter(
        saveDrive115LibraryState,
        (error) => log115('debug', '媒体库索引增量落盘失败', error),
      );
      const enqueueSave = (state: Drive115LibraryIndexState): void => {
        stateSaveQueue?.enqueue(state);
      };
      const flushSave = async (): Promise<void> => {
        await stateSaveQueue?.flush();
      };
      let lastPartialStatePersistAt = 0;
      const enqueuePartialSave = (state: Drive115LibraryIndexState): void => {
        const now = Date.now();
        if (lastPartialStatePersistAt > 0
          && now - lastPartialStatePersistAt < PARTIAL_STATE_PERSIST_INTERVAL_MS) {
          return;
        }
        lastPartialStatePersistAt = now;
        enqueueSave(state);
      };
      // 报告同样只需保留最新快照，避免高频进度报告形成 Promise 长链。
      const reportWriter = createLatestValueWriter(
        (report: unknown) => setValue(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT, report),
        (error) => log115('debug', '媒体库索引报告落盘失败', error),
      );
      const enqueueReport = (report: unknown): void => {
        reportWriter.enqueue(report);
      };

      const indexedResult = await indexDrive115Roots({
        roots: enabled,
        previous: selectedPrevious,
        scanDepth,
        shouldCancel: () => cancelIndexRequested || !!indexAbortController?.signal.aborted,
        signal: indexAbortController.signal,
        onPartialState: (state) => {
          enqueuePartialSave(mergePartialState(state));
        },
        onReport: (rep) => {
          enqueueReport(rep);
        },
        listFiles: async ({ cid, limit, offset, signal }) => {
          const ret = await svc.listFiles({
            accessToken,
            cid,
            limit,
            offset,
            show_dir: 1,
            stdir: 1,
            cur: 1,
            signal,
            skipBackgroundProxy: true,
          });
          return {
            success: !!ret.success,
            message: ret.message,
            data: (ret.data || []) as Array<Record<string, unknown>>,
            code: readRawCode(ret.raw) ?? ret.statusCode,
          };
        },
        onProgress: (p) => {
          const running = p.phase !== 'done' && p.phase !== 'error';
          enqueueIndexProgress({
            ...p,
            running,
            updatedAt: Date.now(),
          }, { force: p.phase === 'start' || p.phase === 'root' || p.phase === 'done' || p.phase === 'error' });
          if (
            p.phase === 'start' ||
            p.phase === 'root' ||
            p.phase === 'done' ||
            p.phase === 'error' ||
            (p.phase === 'folder' && (p.foldersSeen || 0) % 10 === 0)
          ) {
            log115(p.phase === 'error' ? 'warn' : 'debug', p.message, {
              phase: p.phase,
              indexed: p.indexed,
              foldersSeen: p.foldersSeen,
              apiCalls: p.apiCalls,
            });
          }
        },
      });
      const result: Drive115IndexResult = {
        ...indexedResult,
        state: mergePartialState(indexedResult.state),
      };
      await flushIndexProgress();

      if (result.cancelled) {
        enqueueSave(result.state);
        await flushSave();
        await patchDrive115IndexMeta({
          mediaLibraryLastIndexError: result.message || '索引已取消',
          ...(result.partialMerged
            ? { mediaLibraryLastIndexAt: result.state.updatedAt }
            : {}),
        });
        log115('info', result.message || '索引已取消', {
          keptPrevious: result.keptPrevious,
          partialMerged: result.partialMerged,
          partialIndexed: result.partialIndexed,
          stats: result.state.stats,
        });
      } else if (result.success) {
        enqueueSave(result.state);
        await flushSave();
        await patchDrive115IndexMeta({
          mediaLibraryLastIndexAt: result.state.updatedAt,
          mediaLibraryLastIndexError: null,
        });
        log115('info', result.message || '索引完成', result.state.stats);
      } else {
        enqueueSave(result.state);
        await flushSave();
        await patchDrive115IndexMeta({
          mediaLibraryLastIndexError: result.message || '索引失败',
          // 部分合并时也刷新 lastIndexAt，表示有可用索引更新
          ...(result.partialMerged
            ? { mediaLibraryLastIndexAt: result.state.updatedAt }
            : {}),
        });
        log115('warn', result.message || '索引失败', {
          keptPrevious: result.keptPrevious,
          partialMerged: result.partialMerged,
          partialIndexed: result.partialIndexed,
          stats: result.state.stats,
        });
      }
      if (result.checkpoint && result.resumable && !result.cancelled) {
        await saveDrive115IndexCheckpoint(result.checkpoint);
        scheduleIndexResume(result.checkpoint);
      } else {
        await clearDrive115IndexCheckpoint();
        await clearScheduledIndexResume();
      }
      // 落盘本轮结果明细报告，供设置页详情窗口下钻。
      if (result.report) {
        enqueueReport(result.report);
        await reportWriter.flush();
        await appendDrive115IndexHistory(result.report);
      }
      return result;
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      log115('error', `索引异常：${msg}`);
      const result: Drive115IndexResult = {
        success: false,
        keptPrevious: previous.entries.length > 0,
        state: { ...previous, lastError: msg },
        message: msg,
      };
      try {
        if (stateSaveQueue) {
          stateSaveQueue.enqueue(result.state);
          await stateSaveQueue.flush();
        } else {
          await saveDrive115LibraryState(result.state);
        }
        await patchDrive115IndexMeta({ mediaLibraryLastIndexError: msg });
        enqueueIndexProgress({
          phase: 'error',
          message: msg,
          running: false,
          updatedAt: Date.now(),
        }, { force: true });
        await flushIndexProgress();
      } catch {
        /* ignore */
      }
      return result;
    } finally {
      indexingPromise = null;
      cancelIndexRequested = false;
      indexAbortController = null;
    }
  })();

  return indexingPromise;
}

export function handleDrive115MediaLibraryIndex(
  message: unknown,
  sendResponse: SendResponse,
): boolean {
  void (async () => {
    try {
      const result = await runDrive115MediaLibraryIndex({
        rootCids: normalizeRequestedRootCids(asRecord(message).rootCids),
      });
      sendResponse({
        success: result.success,
        keptPrevious: result.keptPrevious,
        partialMerged: result.partialMerged,
        partialIndexed: result.partialIndexed,
        cancelled: result.cancelled,
        message: result.message,
        state: result.state,
        stats: result.state.stats,
        report: result.report,
      });
    } catch (e: unknown) {
      sendResponse({ success: false, message: getErrorMessage(e) });
    }
  })();
  return true;
}


export function handleDrive115MediaLibraryCancelIndex(
  _message: unknown,
  sendResponse: SendResponse,
): boolean {
  void (async () => {
    try {
      if (!indexingPromise) {
        const message = '当前没有正在运行的索引任务，已清理卡住的索引状态';
        await stopPersistedIndexProgress(message);
        sendResponse({ success: true, running: false, message });
        return;
      }
      cancelIndexRequested = true;
      await clearDrive115IndexCheckpoint();
      await clearScheduledIndexResume();
      try {
        indexAbortController?.abort();
      } catch {
        /* ignore */
      }
      enqueueIndexProgress({
        phase: 'folder',
        message: '正在取消索引…',
        running: true,
        updatedAt: Date.now(),
      }, { force: true });
      sendResponse({ success: true, running: true, message: '正在取消索引…' });
    } catch (e: unknown) {
      sendResponse({ success: false, message: getErrorMessage(e) });
    }
  })();
  return true;
}

/** 后台冷却完成后续扫；检查点失效或不存在时无操作。 */
export async function handleDrive115MediaLibraryResumeAlarm(alarmName: string): Promise<boolean> {
  if (alarmName !== DRIVE115_LIBRARY_INDEX_RESUME_ALARM) return false;
  const checkpoint = await loadDrive115IndexCheckpoint();
  if (!checkpoint) return true;
  if (checkpoint.resumeAt > Date.now()) {
    scheduleIndexResume(checkpoint);
    return true;
  }
  await runDrive115MediaLibraryIndex({ rootCids: checkpoint.rootCids });
  return true;
}

/**
 * 按 coverPickCode 解析封面下载直链（短时有效，不持久化）。
 * 前端在可视区懒加载时调用，配合内存短 TTL 缓存复用。
 */
export function handleDrive115MediaLibraryResolveCoverUrl(
  message: unknown,
  sendResponse: SendResponse,
): boolean {
  void (async () => {
    try {
      const pickCode = String(asRecord(message).pickCode ?? '').trim();
      if (!pickCode) {
        sendResponse({ success: false, message: '缺少 pick_code' });
        return;
      }
      const svc = getDrive115V2Service();
      const tokenRet = await svc.getValidAccessToken({ forceAutoRefresh: true });
      if (!tokenRet.success || !tokenRet.accessToken) {
        sendResponse({ success: false, message: tokenRet.success ? '无法获取 115 授权' : tokenRet.message });
        return;
      }
      const urlRet = await svc.getFileDownloadUrl({ accessToken: tokenRet.accessToken, pickCode });
      if (!urlRet.success || !urlRet.url) {
        sendResponse({ success: false, message: urlRet.message || '获取封面地址失败' });
        return;
      }
      sendResponse({ success: true, url: urlRet.url });
    } catch (e: unknown) {
      sendResponse({ success: false, message: getErrorMessage(e) });
    }
  })();
  return true;
}

export function handleDrive115MediaLibraryGetState(
  _message: unknown,
  sendResponse: SendResponse,
): boolean {
  void (async () => {
    try {
      const state = await loadDrive115LibraryState();
      sendResponse({ success: true, state });
    } catch (e: unknown) {
      sendResponse({ success: false, message: getErrorMessage(e) });
    }
  })();
  return true;
}

/** NFO 正文最大读取字节数，避免误拉大文件 */
const NFO_MAX_BYTES = 256 * 1024;

function getNfoCandidates(entry: Drive115LibraryIndexState['entries'][number]): Array<{
  fileName: string;
  pickCode: string;
}> {
  const candidates = (entry.nfoCandidates || [])
    .map((candidate) => ({
      fileName: String(candidate.fileName || '').trim(),
      pickCode: String(candidate.pickCode || '').trim(),
    }))
    .filter((candidate) => Boolean(candidate.pickCode));
  if (candidates.length) return candidates;
  if (!entry.nfoPickCode) return [];
  return [{ fileName: entry.nfoFileName || 'NFO', pickCode: entry.nfoPickCode }];
}

function scoreNfoSummary(summary: NonNullable<ReturnType<typeof parseNfoSummary>>): number {
  const scalarFields = [
    summary.title,
    summary.originalTitle,
    summary.tagline,
    summary.plot,
    summary.year,
    summary.num,
    summary.studio,
    summary.publisher,
    summary.countryCode,
    summary.contentRating,
    summary.website,
    summary.coverUrl,
    summary.fanartRef,
    summary.releaseDate,
    summary.rating,
    summary.runtime,
    summary.director,
    summary.series,
    summary.posterRef,
  ];
  return scalarFields.filter(Boolean).length
    + (summary.actors?.length ? 1 : 0)
    + (summary.genres?.length ? 1 : 0);
}

/**
 * 懒解析单条 115 条目的 NFO：按 key 定位条目 → 取下载直链 → 读文本 → 解析 → 回写 nfoSummary。
 * 失败降级：返回 success:false，不抛错、不动索引主库。
 */
export function handleDrive115MediaLibraryResolveNfo(
  message: unknown,
  sendResponse: SendResponse,
): boolean {
  void (async () => {
    try {
      const key = String((asRecord(message).key ?? '')).trim();
      if (!key) {
        sendResponse({ success: false, message: '缺少条目 key' });
        return;
      }
      const state = await loadDrive115LibraryState();
      const entry = state.entries.find((e) => e.key === key);
      if (!entry) {
        sendResponse({ success: false, message: '未找到对应索引条目' });
        return;
      }
      if ((entry.nfoSummary?.schemaVersion || 0) >= NFO_SUMMARY_SCHEMA_VERSION) {
        sendResponse({ success: true, summary: entry.nfoSummary, cached: true });
        return;
      }
      const nfoCandidates = getNfoCandidates(entry);
      if (!nfoCandidates.length) {
        sendResponse({ success: false, message: '该条目没有可解析的 NFO' });
        return;
      }

      const svc = getDrive115V2Service();
      const tokenRet = await svc.getValidAccessToken({ forceAutoRefresh: true });
      if (!tokenRet.success || !tokenRet.accessToken) {
        sendResponse({ success: false, message: tokenRet.success ? '无法获取 115 授权' : tokenRet.message });
        return;
      }
      let summary: NonNullable<ReturnType<typeof parseNfoSummary>> | undefined;
      let bestScore = -1;
      let lastFailure = '';
      for (const candidate of nfoCandidates) {
        try {
          const urlRet = await svc.getFileDownloadUrl({
            accessToken: tokenRet.accessToken,
            pickCode: candidate.pickCode,
          });
          if (!urlRet.success || !urlRet.url) {
            lastFailure = urlRet.message || `获取 ${candidate.fileName} 下载地址失败`;
            continue;
          }
          const res = await fetch(urlRet.url);
          if (!res.ok) {
            lastFailure = `下载 ${candidate.fileName} 失败 (${res.status})`;
            continue;
          }
          const buf = await res.arrayBuffer();
          const parsed = parseNfoSummary(new TextDecoder('utf-8').decode(buf.slice(0, NFO_MAX_BYTES)));
          if (!parsed) {
            lastFailure = `${candidate.fileName} 没有可解析信息`;
            continue;
          }
          const score = scoreNfoSummary(parsed);
          if (score > bestScore) {
            summary = parsed;
            bestScore = score;
          }
        } catch (error) {
          lastFailure = `${candidate.fileName} 解析失败：${getErrorMessage(error)}`;
        }
      }
      if (!summary) {
        sendResponse({ success: false, message: lastFailure || '所有 NFO 均无可解析信息' });
        return;
      }

      // 回写 nfoSummary 到索引主库（触发 media 页实时刷新）
      const latest = await loadDrive115LibraryState();
      const idx = latest.entries.findIndex((e) => e.key === key);
      if (idx >= 0) {
        latest.entries[idx] = { ...latest.entries[idx], nfoSummary: summary };
        latest.updatedAt = Date.now();
        await saveDrive115LibraryState(latest);
      }
      sendResponse({ success: true, summary });
    } catch (e: unknown) {
      sendResponse({ success: false, message: getErrorMessage(e) });
    }
  })();
  return true;
}
