/**
 * @file indexer.ts
 * @description 115 片库浅层限频索引器
 * @module features/drive115/mediaLibrary
 */
import {
  classifyFolderEntries,
  pickPrimaryCover,
  pickPrimaryNfo,
  pickPrimaryVideo,
} from './classifyFolderEntries';
import { resolveEntryCode, resolveEntryTitle } from './parseEntryMeta';
import { createRateLimitController, isLikelyRateLimitError } from './rateLimit';
import {
  DEFAULT_DRIVE115_LIBRARY_STATS,
  DRIVE115_INDEX_LIMITS,
  type Drive115IndexProgress,
  type Drive115IndexResult,
  type Drive115LibraryEntry,
  type Drive115LibraryIndexState,
  type Drive115MediaLibraryRoot,
} from './types';

export type ListFilesFn = (params: {
  cid: string;
  limit?: number;
  offset?: number;
}) => Promise<{
  success: boolean;
  message?: string;
  data?: Array<Record<string, unknown>>;
  code?: number;
}>;

export type IndexDrive115RootsDeps = {
  listFiles: ListFilesFn;
  roots: Drive115MediaLibraryRoot[];
  previous?: Drive115LibraryIndexState | null;
  maxFolders?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (p: Drive115IndexProgress) => void;
  /** 测试用：跳过真实等待时可注入 rateLimit 参数 */
  rootIntervalMs?: number;
  folderIntervalMs?: number;
  circuitBreakerThreshold?: number;
};

function isFolderItem(raw: Record<string, unknown>): boolean {
  return String(raw.fc ?? raw.file_category ?? '').trim() === '0';
}

function folderId(raw: Record<string, unknown>): string {
  return String(raw.cid ?? raw.fid ?? raw.file_id ?? '').trim();
}

function folderName(raw: Record<string, unknown>): string {
  return String(raw.fn ?? raw.file_name ?? raw.n ?? raw.name ?? '').trim();
}

function buildEntry(params: {
  rootCid: string;
  folderCid: string;
  folderName: string;
  files: Array<Record<string, unknown>>;
  now: number;
}): { entry: Drive115LibraryEntry | null; skipReason?: string } {
  const classified = classifyFolderEntries(params.files);
  const video = pickPrimaryVideo(classified.videos);
  if (!video || !video.pickCode) {
    return { entry: null, skipReason: 'no_video' };
  }
  const nfo = pickPrimaryNfo(classified.nfos, video.fileName);
  const codeInfo = resolveEntryCode({
    folderName: params.folderName,
    videoFileName: video.fileName,
    nfoFileName: nfo?.fileName,
  });
  const cover = pickPrimaryCover(classified.covers, codeInfo.code);
  const title = resolveEntryTitle({
    code: codeInfo.code,
    folderName: params.folderName,
    videoFileName: video.fileName,
  });

  return {
    entry: {
      key: `${params.folderCid}:${video.fileId}`,
      code: codeInfo.code,
      title,
      folderCid: params.folderCid,
      folderName: params.folderName,
      rootCid: params.rootCid,
      videoFileId: video.fileId,
      pickCode: video.pickCode,
      fileName: video.fileName,
      fileSize: video.fileSize,
      coverFileId: cover?.fileId,
      coverFileName: cover?.fileName,
      nfoFileId: nfo?.fileId,
      nfoFileName: nfo?.fileName,
      updatedAt: params.now,
    },
  };
}

/**
 * 索引配置的片库根目录（浅层：根下每个影片文件夹一层）
 */
export async function indexDrive115Roots(
  deps: IndexDrive115RootsDeps,
): Promise<Drive115IndexResult> {
  const now = deps.now || (() => Date.now());
  const maxFolders = deps.maxFolders ?? DRIVE115_INDEX_LIMITS.maxFolders;
  const enabledRoots = (deps.roots || []).filter((r) => r && r.enabled !== false && String(r.cid || '').trim());
  const previous = deps.previous || null;
  const rate = createRateLimitController({
    rootIntervalMs: deps.rootIntervalMs,
    folderIntervalMs: deps.folderIntervalMs,
    circuitBreakerThreshold: deps.circuitBreakerThreshold,
    sleep: deps.sleep,
    now,
  });

  const stats = { ...DEFAULT_DRIVE115_LIBRARY_STATS, roots: enabledRoots.length };
  const entries: Drive115LibraryEntry[] = [];
  let hardError: string | undefined;

  deps.onProgress?.({
    phase: 'start',
    message: `开始索引 ${enabledRoots.length} 个片库根目录`,
    rootsTotal: enabledRoots.length,
    rootsDone: 0,
    foldersSeen: 0,
    indexed: 0,
    skipped: 0,
    apiCalls: 0,
  });

  if (!enabledRoots.length) {
    const emptyState: Drive115LibraryIndexState = {
      version: 1,
      updatedAt: now(),
      entries: [],
      stats,
      lastError: undefined,
    };
    deps.onProgress?.({
      phase: 'done',
      message: '未配置启用的片库根目录',
      rootsTotal: 0,
      rootsDone: 0,
      foldersSeen: 0,
      indexed: 0,
      skipped: 0,
      apiCalls: 0,
    });
    return {
      success: true,
      keptPrevious: false,
      state: emptyState,
      message: '未配置启用的片库根目录',
    };
  }

  let rootsDone = 0;
  outer: for (const root of enabledRoots) {
    const rootCid = String(root.cid).trim();
    try {
      await rate.beforeRootCall();
      stats.apiCalls += 1;
      const rootList = await deps.listFiles({
        cid: rootCid,
        limit: DRIVE115_INDEX_LIMITS.pageLimit,
        offset: 0,
      });
      if (!rootList.success) {
        const msg = rootList.message || '列出根目录失败';
        const limited = isLikelyRateLimitError(msg, rootList.code);
        if (rate.markFailure(msg, limited)) {
          hardError = rate.getTripReason();
          break outer;
        }
        // 非限流：跳过该根，继续
        stats.skipped += 1;
        rootsDone += 1;
        continue;
      }
      rate.markSuccess();

      const folders = (rootList.data || []).filter(
        (item) => item && typeof item === 'object' && isFolderItem(item as Record<string, unknown>),
      ) as Array<Record<string, unknown>>;

      let folderBudget = Math.max(0, maxFolders - stats.foldersSeen);
      const toScan = folders.slice(0, folderBudget);
      if (folders.length > toScan.length) {
        stats.truncatedFolders += folders.length - toScan.length;
      }

      for (const folder of toScan) {
        if (rate.isTripped()) {
          hardError = rate.getTripReason();
          break outer;
        }
        const fCid = folderId(folder);
        const fName = folderName(folder) || fCid;
        if (!fCid) {
          stats.skipped += 1;
          continue;
        }
        stats.foldersSeen += 1;

        try {
          await rate.beforeFolderCall();
          stats.apiCalls += 1;
          const fileList = await deps.listFiles({
            cid: fCid,
            limit: DRIVE115_INDEX_LIMITS.pageLimit,
            offset: 0,
          });
          if (!fileList.success) {
            const msg = fileList.message || `列出文件夹失败：${fName}`;
            const limited = isLikelyRateLimitError(msg, fileList.code);
            if (rate.markFailure(msg, limited)) {
              hardError = rate.getTripReason();
              break outer;
            }
            stats.skipped += 1;
            continue;
          }
          rate.markSuccess();

          const built = buildEntry({
            rootCid,
            folderCid: fCid,
            folderName: fName,
            files: (fileList.data || []) as Array<Record<string, unknown>>,
            now: now(),
          });
          if (!built.entry) {
            stats.skipped += 1;
          } else {
            entries.push(built.entry);
            stats.indexed += 1;
            if (!built.entry.code) stats.unrecognized += 1;
          }
        } catch (e: any) {
          const msg = e?.message || String(e);
          if (rate.isTripped() || isLikelyRateLimitError(msg)) {
            rate.markFailure(msg, true);
            hardError = rate.getTripReason() || msg;
            break outer;
          }
          stats.skipped += 1;
        }

        deps.onProgress?.({
          phase: 'folder',
          message: `已扫描 ${stats.foldersSeen} 个文件夹，入库 ${stats.indexed}`,
          rootsTotal: enabledRoots.length,
          rootsDone,
          foldersSeen: stats.foldersSeen,
          indexed: stats.indexed,
          skipped: stats.skipped,
          apiCalls: stats.apiCalls,
        });
      }

      rootsDone += 1;
      deps.onProgress?.({
        phase: 'root',
        message: `根目录完成：${root.path || root.name || rootCid}`,
        rootsTotal: enabledRoots.length,
        rootsDone,
        foldersSeen: stats.foldersSeen,
        indexed: stats.indexed,
        skipped: stats.skipped,
        apiCalls: stats.apiCalls,
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (rate.isTripped() || isLikelyRateLimitError(msg)) {
        hardError = rate.getTripReason() || msg;
        break outer;
      }
      hardError = msg;
      break outer;
    }
  }

  // 熔断或硬错误：本轮已扫到的条目按 key 合并进旧索引后落盘；若本轮 0 条则完全保留旧索引
  if (hardError) {
    const prevEntries = previous && Array.isArray(previous.entries) ? previous.entries : [];
    const partialIndexed = entries.length;
    const partialMerged = partialIndexed > 0;
    let mergedEntries = prevEntries;
    if (partialMerged) {
      const byKey = new Map<string, Drive115LibraryEntry>();
      for (const e of prevEntries) {
        if (e?.key) byKey.set(e.key, e);
      }
      for (const e of entries) {
        if (e?.key) byKey.set(e.key, e);
      }
      mergedEntries = Array.from(byKey.values());
    }
    const keptPrevious = !partialMerged && prevEntries.length > 0;
    const state: Drive115LibraryIndexState = {
      version: 1,
      updatedAt: partialMerged ? now() : previous?.updatedAt || 0,
      entries: mergedEntries,
      stats: partialMerged
        ? { ...stats, indexed: mergedEntries.length }
        : previous?.stats || { ...stats },
      lastError: hardError,
    };
    const detail = partialMerged
      ? `${hardError}（已合并保存本轮 ${partialIndexed} 条）`
      : hardError;
    deps.onProgress?.({
      phase: 'error',
      message: detail,
      rootsTotal: enabledRoots.length,
      rootsDone,
      foldersSeen: stats.foldersSeen,
      indexed: stats.indexed,
      skipped: stats.skipped,
      apiCalls: stats.apiCalls,
    });
    return {
      success: false,
      keptPrevious,
      partialMerged,
      partialIndexed,
      state,
      message: detail,
    };
  }

  const state: Drive115LibraryIndexState = {
    version: 1,
    updatedAt: now(),
    entries,
    stats,
    lastError: undefined,
  };
  deps.onProgress?.({
    phase: 'done',
    message: `索引完成：${stats.indexed} 条（跳过 ${stats.skipped}）`,
    rootsTotal: enabledRoots.length,
    rootsDone,
    foldersSeen: stats.foldersSeen,
    indexed: stats.indexed,
    skipped: stats.skipped,
    apiCalls: stats.apiCalls,
  });
  return {
    success: true,
    keptPrevious: false,
    state,
    message: `索引完成：${stats.indexed} 条`,
  };
}
