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
import { loadDrive115LibraryState, saveDrive115LibraryState } from './store';
import type {
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

function log115(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown): void {
  const text = `[115] ${message}`;
  if (level === 'error') mediaLog.error(text, data);
  else if (level === 'warn') mediaLog.warn(text, data);
  else if (level === 'debug') mediaLog.debug(text, data);
  else mediaLog.info(text, data);
}

async function writeIndexProgress(
  snapshot: Drive115IndexProgressSnapshot | null,
): Promise<void> {
  try {
    await setValue(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS, snapshot);
  } catch (e) {
    log115('debug', '写入索引进度失败', e);
  }
}

async function stopPersistedIndexProgress(message: string): Promise<void> {
  const previous = await getValue<Drive115IndexProgressSnapshot | null>(
    STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS,
    null,
  );
  const base = previous && typeof previous === 'object' ? previous : null;
  await writeIndexProgress({
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
  });
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
export async function runDrive115MediaLibraryIndex(): Promise<Drive115IndexResult> {
  if (indexingPromise) return indexingPromise;

  cancelIndexRequested = false;
  indexAbortController = new AbortController();
  indexingPromise = (async () => {
    const previous = await loadDrive115LibraryState();
    try {
      const settings = await getSettings();
      const roots = readRootsFromSettings(settings);
      const scanDepth = readScanDepthFromSettings(settings);
      const enabled = roots.filter((r) => r.enabled !== false);
      if (!enabled.length) {
        const result: Drive115IndexResult = {
          success: false,
          keptPrevious: previous.entries.length > 0,
          state: { ...previous, lastError: '未配置启用的片库根目录' },
          message: '未配置启用的片库根目录',
        };
        await patchDrive115IndexMeta({
          mediaLibraryLastIndexError: result.message || null,
        });
        await writeIndexProgress({
          phase: 'error',
          message: result.message || '未配置启用的片库根目录',
          running: false,
          updatedAt: Date.now(),
        });
        return result;
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
        await writeIndexProgress({
          phase: 'error',
          message: msg,
          running: false,
          updatedAt: Date.now(),
        });
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
        await writeIndexProgress({
          phase: 'error',
          message: msg,
          running: false,
          updatedAt: Date.now(),
        });
        return result;
      }
      const accessToken = tokenRet.accessToken;

      log115('info', `开始索引，根目录 ${enabled.length} 个`, {
        roots: enabled.map((r) => r.cid),
        scanDepth,
      });
      await writeIndexProgress({
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
      });

      // 串行落盘链：增量快照与最终态按入队顺序依次写，最终态最后入队 → 覆盖增量态。
      let saveChain: Promise<void> = Promise.resolve();
      const enqueueSave = (state: Drive115LibraryIndexState): Promise<void> => {
        saveChain = saveChain
          .then(() => saveDrive115LibraryState(state))
          .catch((err) => log115('debug', '媒体库索引增量落盘失败', err));
        return saveChain;
      };
      // 结果报告串行写链：进行中实时更新 + 收尾最终写，最终态最后入队。
      let reportChain: Promise<void> = Promise.resolve();
      const enqueueReport = (rep: unknown): Promise<void> => {
        reportChain = reportChain
          .then(() => setValue(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT, rep))
          .catch((err) => log115('debug', '媒体库索引报告落盘失败', err));
        return reportChain;
      };

      const result = await indexDrive115Roots({
        roots: enabled,
        previous,
        scanDepth,
        shouldCancel: () => cancelIndexRequested || !!indexAbortController?.signal.aborted,
        signal: indexAbortController.signal,
        onPartialState: (state) => {
          void enqueueSave(state);
        },
        onReport: (rep) => {
          void enqueueReport(rep);
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
            code: readRawCode(ret.raw),
          };
        },
        onProgress: (p) => {
          const running = p.phase !== 'done' && p.phase !== 'error';
          void writeIndexProgress({
            ...p,
            running,
            updatedAt: Date.now(),
          });
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

      if (result.cancelled) {
        await enqueueSave(result.state);
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
        await enqueueSave(result.state);
        await patchDrive115IndexMeta({
          mediaLibraryLastIndexAt: result.state.updatedAt,
          mediaLibraryLastIndexError: null,
        });
        log115('info', result.message || '索引完成', result.state.stats);
      } else {
        await enqueueSave(result.state);
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
      // 落盘本轮结果明细报告（走同一条链，最终态覆盖进行中快照），供设置页详情窗口下钻
      if (result.report) {
        await enqueueReport(result.report);
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
        await saveDrive115LibraryState(result.state);
        await patchDrive115IndexMeta({ mediaLibraryLastIndexError: msg });
        await writeIndexProgress({
          phase: 'error',
          message: msg,
          running: false,
          updatedAt: Date.now(),
        });
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
  _message: unknown,
  sendResponse: SendResponse,
): boolean {
  void (async () => {
    try {
      const result = await runDrive115MediaLibraryIndex();
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
      try {
        indexAbortController?.abort();
      } catch {
        /* ignore */
      }
      await writeIndexProgress({
        phase: 'folder',
        message: '正在取消索引…',
        running: true,
        updatedAt: Date.now(),
      });
      sendResponse({ success: true, running: true, message: '正在取消索引…' });
    } catch (e: unknown) {
      sendResponse({ success: false, message: getErrorMessage(e) });
    }
  })();
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
      if (!entry.nfoPickCode) {
        sendResponse({ success: false, message: '该条目没有可解析的 NFO' });
        return;
      }

      const svc = getDrive115V2Service();
      const tokenRet = await svc.getValidAccessToken({ forceAutoRefresh: true });
      if (!tokenRet.success || !tokenRet.accessToken) {
        sendResponse({ success: false, message: tokenRet.success ? '无法获取 115 授权' : tokenRet.message });
        return;
      }
      const urlRet = await svc.getFileDownloadUrl({
        accessToken: tokenRet.accessToken,
        pickCode: entry.nfoPickCode,
      });
      if (!urlRet.success || !urlRet.url) {
        sendResponse({ success: false, message: urlRet.message || '获取 NFO 下载地址失败' });
        return;
      }

      const res = await fetch(urlRet.url);
      if (!res.ok) {
        sendResponse({ success: false, message: `下载 NFO 失败 (${res.status})` });
        return;
      }
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('utf-8').decode(buf.slice(0, NFO_MAX_BYTES));
      const summary = parseNfoSummary(text);
      if (!summary) {
        sendResponse({ success: false, message: 'NFO 无可解析信息' });
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
