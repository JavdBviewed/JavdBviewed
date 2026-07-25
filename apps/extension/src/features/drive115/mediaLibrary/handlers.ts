/**
 * @file handlers.ts
 * @description 115 媒体库索引 background / 消息处理
 * @module features/drive115/mediaLibrary
 */
import { STORAGE_KEYS } from '../../../utils/config';
import { getSettings, saveSettings, setValue } from '../../../utils/storage';
import { mediaLog } from '../../embyLibrary/mediaLibraryLogger';
import { getDrive115V2Service, type Drive115V2FileListResponse } from '../v2';
import type { ExtensionSettings } from '../../../types';
import { indexDrive115Roots } from './indexer';
import { loadDrive115LibraryState, saveDrive115LibraryState } from './store';
import type {
  Drive115IndexProgressSnapshot,
  Drive115IndexResult,
  Drive115MediaLibraryRoot,
} from './types';

type SendResponse = (response: unknown) => void;

type Drive115SettingsRecord = Record<string, unknown> & {
  mediaLibraryRoots?: unknown;
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

  indexingPromise = (async () => {
    const previous = await loadDrive115LibraryState();
    try {
      const settings = await getSettings();
      const roots = readRootsFromSettings(settings);
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
      });
      await writeIndexProgress({
        phase: 'start',
        message: `开始索引 ${enabled.length} 个片库根目录`,
        rootsTotal: enabled.length,
        rootsDone: 0,
        foldersSeen: 0,
        indexed: 0,
        skipped: 0,
        apiCalls: 0,
        running: true,
        updatedAt: Date.now(),
      });

      const result = await indexDrive115Roots({
        roots: enabled,
        previous,
        listFiles: async ({ cid, limit, offset }) => {
          const ret = await svc.listFiles({
            accessToken,
            cid,
            limit,
            offset,
            show_dir: 1,
            stdir: 1,
            cur: 1,
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

      if (result.success) {
        await saveDrive115LibraryState(result.state);
        await patchDrive115IndexMeta({
          mediaLibraryLastIndexAt: result.state.updatedAt,
          mediaLibraryLastIndexError: null,
        });
        log115('info', result.message || '索引完成', result.state.stats);
      } else {
        await saveDrive115LibraryState(result.state);
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
        message: result.message,
        state: result.state,
        stats: result.state.stats,
      });
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
