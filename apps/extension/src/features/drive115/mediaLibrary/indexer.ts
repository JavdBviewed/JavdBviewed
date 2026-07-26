/**
 * @file indexer.ts
 * @description 115 media library rate-limited indexer
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
  type Drive115IndexReport,
  type Drive115IndexResult,
  type Drive115IndexSkipReason,
  type Drive115LibraryEntry,
  type Drive115LibraryIndexState,
  type Drive115MediaLibraryRoot,
} from './types';

export type ListFilesFn = (params: {
  cid: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
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
  maxContainerFolders?: number;
  scanDepth?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (p: Drive115IndexProgress) => void;
  /** Check between API calls so a user cancel can stop the run quickly. */
  shouldCancel?: () => boolean;
  /** Abort signal used to cancel in-flight fetches where the Drive115 adapter supports it. */
  signal?: AbortSignal;
  /** 每入库多少条触发一次增量落盘（默认 5）。 */
  flushEveryN?: number;
  /**
   * 增量落盘回调：每 flushEveryN 条入库时收到「本轮已入库合并进旧索引」的完整快照。
   * 调用方（background）负责串行/防抖写盘；不传则退回「仅收尾落盘」旧行为。
   */
  onPartialState?: (state: Drive115LibraryIndexState) => void | Promise<void>;
  /** Test-only rate limit overrides. */
  rootIntervalMs?: number;
  folderIntervalMs?: number;
  circuitBreakerThreshold?: number;
};

const CANCELLED_MESSAGE = '索引已取消';
const DEFAULT_FLUSH_EVERY_N = 5;
const DEFAULT_SCAN_DEPTH = 2;
const MIN_SCAN_DEPTH = 1;
const MAX_SCAN_DEPTH = 8;

function clampScanDepth(raw: number | undefined): number {
  const parsed = Math.floor(Number(raw ?? DEFAULT_SCAN_DEPTH));
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_DEPTH;
  return Math.min(MAX_SCAN_DEPTH, Math.max(MIN_SCAN_DEPTH, parsed));
}

function isFolderItem(raw: Record<string, unknown>): boolean {
  return String(raw.fc ?? raw.file_category ?? '').trim() === '0';
}

function folderId(raw: Record<string, unknown>): string {
  return String(raw.cid ?? raw.fid ?? raw.file_id ?? '').trim();
}

function folderName(raw: Record<string, unknown>): string {
  return String(raw.fn ?? raw.file_name ?? raw.n ?? raw.name ?? '').trim();
}

function splitFolders(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return items.filter((item) => item && typeof item === 'object' && isFolderItem(item));
}

function splitFiles(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return items.filter((item) => item && typeof item === 'object' && !isFolderItem(item));
}

function buildEntry(params: {
  rootCid: string;
  folderCid: string;
  folderName: string;
  files: Array<Record<string, unknown>>;
  now: number;
}): { entry: Drive115LibraryEntry | null; skipReason?: 'no_video' | 'no_pickcode' } {
  const classified = classifyFolderEntries(params.files);
  const video = pickPrimaryVideo(classified.videos);
  if (!video) {
    return { entry: null, skipReason: 'no_video' };
  }
  if (!video.pickCode) {
    return { entry: null, skipReason: 'no_pickcode' };
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
      nfoPickCode: nfo?.pickCode,
      updatedAt: params.now,
    },
  };
}

type ListedFolder = {
  cid: string;
  name: string;
  data: Array<Record<string, unknown>>;
};

type FolderQueueItem = {
  cid: string;
  name: string;
  depth: number;
  rootCid: string;
};

function mergePartialEntries(
  previous: Drive115LibraryIndexState | null,
  entries: Drive115LibraryEntry[],
): { mergedEntries: Drive115LibraryEntry[]; partialMerged: boolean; keptPrevious: boolean } {
  const prevEntries = previous && Array.isArray(previous.entries) ? previous.entries : [];
  const partialMerged = entries.length > 0;
  if (!partialMerged) {
    return {
      mergedEntries: prevEntries,
      partialMerged: false,
      keptPrevious: prevEntries.length > 0,
    };
  }
  const byKey = new Map<string, Drive115LibraryEntry>();
  for (const entry of prevEntries) {
    if (entry?.key) byKey.set(entry.key, entry);
  }
  for (const entry of entries) {
    if (entry?.key) byKey.set(entry.key, entry);
  }
  return {
    mergedEntries: Array.from(byKey.values()),
    partialMerged: true,
    keptPrevious: false,
  };
}

export async function indexDrive115Roots(
  deps: IndexDrive115RootsDeps,
): Promise<Drive115IndexResult> {
  const now = deps.now || (() => Date.now());
  const maxFolders = deps.maxFolders ?? DRIVE115_INDEX_LIMITS.maxFolders;
  const maxContainerFolders = deps.maxContainerFolders ?? DRIVE115_INDEX_LIMITS.maxContainerFolders;
  const scanDepth = clampScanDepth(deps.scanDepth);
  const enabledRoots = (deps.roots || []).filter((r) => r && r.enabled !== false && String(r.cid || '').trim());
  const previous = deps.previous || null;
  const rate = createRateLimitController({
    rootIntervalMs: deps.rootIntervalMs,
    folderIntervalMs: deps.folderIntervalMs,
    circuitBreakerThreshold: deps.circuitBreakerThreshold,
    sleep: deps.sleep,
    now,
  });

  const flushEveryN = Math.max(1, Math.floor(deps.flushEveryN ?? DEFAULT_FLUSH_EVERY_N));
  const stats = { ...DEFAULT_DRIVE115_LIBRARY_STATS, roots: enabledRoots.length };
  const entries: Drive115LibraryEntry[] = [];
  let hardError: string | undefined;
  let cancelled = false;
  let rootsDone = 0;
  let containerFoldersSeen = 0;

  // 结果明细报告：入库/跳过明细 + 分原因计数（明细列表有上限，总数不受截断影响）
  const REPORT_LIST_CAP = 500;
  const report: Drive115IndexReport = {
    indexed: [],
    skipped: [],
    indexedTotal: 0,
    skippedTotal: 0,
    skipReasonCounts: {},
    truncatedList: false,
    rootsTotal: enabledRoots.length,
    rootsDone: 0,
    apiCalls: 0,
    truncatedFolders: 0,
    startedAt: now(),
    finishedAt: 0,
  };
  const bumpReason = (reason: Drive115IndexSkipReason, by = 1): void => {
    report.skipReasonCounts[reason] = (report.skipReasonCounts[reason] || 0) + by;
  };
  const recordIndexed = (entry: Drive115LibraryEntry): void => {
    report.indexedTotal += 1;
    if (report.indexed.length < REPORT_LIST_CAP) {
      report.indexed.push({ code: entry.code, title: entry.title, folderName: entry.folderName });
    } else {
      report.truncatedList = true;
    }
    if (!entry.code) bumpReason('unrecognized_code');
  };
  const recordSkip = (
    folderName: string,
    folderCid: string,
    reason: Drive115IndexSkipReason,
  ): void => {
    report.skippedTotal += 1;
    bumpReason(reason);
    if (report.skipped.length < REPORT_LIST_CAP) {
      report.skipped.push({ folderName, folderCid, reason });
    } else {
      report.truncatedList = true;
    }
  };
  /** 收尾：把运行态汇总进 report 并返回其引用。 */
  const finalizeReport = (): Drive115IndexReport => {
    report.rootsDone = rootsDone;
    report.apiCalls = stats.apiCalls;
    report.truncatedFolders = stats.truncatedFolders;
    report.finishedAt = now();
    report.cancelled = cancelled;
    report.error = hardError;
    return report;
  };

  /** 构建「本轮已入库合并进旧索引」的完整快照，供增量落盘。 */
  const buildPartialState = (): Drive115LibraryIndexState => {
    const { mergedEntries } = mergePartialEntries(previous, entries);
    return {
      version: 1,
      updatedAt: now(),
      entries: mergedEntries,
      stats: { ...stats, indexed: mergedEntries.length },
      lastError: undefined,
    };
  };

  /** 记录一条入库条目，并按 flushEveryN 触发增量落盘。 */
  const pushIndexedEntry = (entry: Drive115LibraryEntry): void => {
    entries.push(entry);
    stats.indexed += 1;
    if (!entry.code) stats.unrecognized += 1;
    recordIndexed(entry);
    emitProgress();
    if (deps.onPartialState && stats.indexed % flushEveryN === 0) {
      void deps.onPartialState(buildPartialState());
    }
  };

  const requestCancel = (): boolean => {
    if (!deps.signal?.aborted && !deps.shouldCancel?.()) return false;
    cancelled = true;
    hardError = CANCELLED_MESSAGE;
    return true;
  };

  const emitProgress = (message?: string) => {
    deps.onProgress?.({
      phase: 'folder',
      message: message || `已扫描 ${stats.foldersSeen} 个影片文件夹，入库 ${stats.indexed}`,
      rootsTotal: enabledRoots.length,
      rootsDone,
      foldersSeen: stats.foldersSeen,
      indexed: stats.indexed,
      skipped: stats.skipped,
      apiCalls: stats.apiCalls,
    });
  };

  const listRoot = async (cid: string): Promise<Array<Record<string, unknown>> | null> => {
    if (requestCancel()) return null;
    await rate.beforeRootCall();
    if (requestCancel()) return null;
    stats.apiCalls += 1;
    const rootList = await deps.listFiles({
      cid,
      limit: DRIVE115_INDEX_LIMITS.pageLimit,
      offset: 0,
      signal: deps.signal,
    });
    if (requestCancel()) return null;
    if (!rootList.success) {
      const msg = rootList.message || '列出根目录失败';
      const limited = isLikelyRateLimitError(msg, rootList.code);
      if (rate.markFailure(msg, limited)) {
        hardError = rate.getTripReason();
        return null;
      }
      stats.skipped += 1;
      recordSkip(cid, cid, 'list_failed');
      return null;
    }
    rate.markSuccess();
    return (rootList.data || []) as Array<Record<string, unknown>>;
  };

  const listFolder = async (cid: string, name: string): Promise<ListedFolder | null> => {
    if (requestCancel()) return null;
    await rate.beforeFolderCall();
    if (requestCancel()) return null;
    stats.apiCalls += 1;
    const fileList = await deps.listFiles({
      cid,
      limit: DRIVE115_INDEX_LIMITS.pageLimit,
      offset: 0,
      signal: deps.signal,
    });
    if (requestCancel()) return null;
    if (!fileList.success) {
      const msg = fileList.message || `列出文件夹失败：${name}`;
      const limited = isLikelyRateLimitError(msg, fileList.code);
      if (rate.markFailure(msg, limited)) {
        hardError = rate.getTripReason();
        return null;
      }
      stats.skipped += 1;
      recordSkip(name, cid, 'list_failed');
      return null;
    }
    rate.markSuccess();
    return {
      cid,
      name,
      data: (fileList.data || []) as Array<Record<string, unknown>>,
    };
  };

  deps.onProgress?.({
    phase: 'start',
    message: `开始索引 ${enabledRoots.length} 个片库根目录，深度 ${scanDepth} 层`,
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
      report: finalizeReport(),
      message: '未配置启用的片库根目录',
    };
  }

  outer: for (const root of enabledRoots) {
    const rootCid = String(root.cid).trim();
    try {
      const rootData = await listRoot(rootCid);
      if (hardError) break outer;
      if (!rootData) {
        rootsDone += 1;
        continue;
      }

      const queue: FolderQueueItem[] = splitFolders(rootData).map((folder) => {
        const cid = folderId(folder);
        return {
          cid,
          name: folderName(folder) || cid,
          depth: 1,
          rootCid,
        };
      }).filter((item) => item.cid);

      for (let index = 0; index < queue.length; index += 1) {
        if (rate.isTripped()) {
          hardError = rate.getTripReason();
          break outer;
        }
        if (requestCancel()) break outer;
        if (stats.foldersSeen >= maxFolders) {
          stats.truncatedFolders += queue.length - index;
          bumpReason('max_folders', queue.length - index);
          break outer;
        }
        const item = queue[index];
        if (!item || !item.cid) continue;
        const listed = await listFolder(item.cid, item.name);
        if (hardError) break outer;
        if (!listed) continue;

        const built = buildEntry({
          rootCid: item.rootCid,
          folderCid: listed.cid,
          folderName: listed.name,
          files: listed.data,
          now: now(),
        });
        if (built.entry) {
          stats.foldersSeen += 1;
          pushIndexedEntry(built.entry);
          continue;
        }

        const childFolders = splitFolders(listed.data);
        const childFiles = splitFiles(listed.data);
        if (item.depth < scanDepth && childFolders.length > 0) {
          if (containerFoldersSeen >= maxContainerFolders) {
            stats.truncatedFolders += queue.length - index;
            bumpReason('container_cap', queue.length - index);
            break outer;
          }
          containerFoldersSeen += 1;
          const nestedItems: FolderQueueItem[] = [];
          for (const child of childFolders) {
            const childCid = folderId(child);
            if (!childCid) continue;
            nestedItems.push({
              cid: childCid,
              name: folderName(child) || childCid,
              depth: item.depth + 1,
              rootCid: item.rootCid,
            });
          }
          // Prioritize the current branch so actor/category structures start producing entries
          // before a large root's remaining container folders are exhausted.
          if (nestedItems.length > 0) queue.splice(index + 1, 0, ...nestedItems);
          continue;
        }

        // 叶子目录：没有可入库视频。区分「像影片候选目录」(计入 foldersSeen) 与「纯空目录」
        const reason: Drive115IndexSkipReason = built.skipReason ?? 'no_video';
        if (childFiles.length > 0 || item.depth >= scanDepth) {
          stats.foldersSeen += 1;
        }
        stats.skipped += 1;
        recordSkip(listed.name, listed.cid, reason);
        emitProgress();
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (rate.isTripped() || isLikelyRateLimitError(msg)) {
        hardError = rate.getTripReason() || msg;
        break outer;
      }
      hardError = msg;
      break outer;
    }
  }

  if (hardError) {
    const partialIndexed = entries.length;
    const { mergedEntries, partialMerged, keptPrevious } = mergePartialEntries(previous, entries);
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
      cancelled,
      state,
      report: finalizeReport(),
      message: detail,
    };
  }

  const previousEntries = previous && Array.isArray(previous.entries) ? previous.entries : [];
  if (entries.length === 0 && previousEntries.length > 0 && previous) {
    const state: Drive115LibraryIndexState = {
      version: previous.version,
      updatedAt: previous.updatedAt,
      entries: previous.entries,
      stats: previous.stats,
      lastError: undefined,
    };
    deps.onProgress?.({
      phase: 'done',
      message: '未发现可入库影片，已保留上一份索引',
      rootsTotal: enabledRoots.length,
      rootsDone,
      foldersSeen: stats.foldersSeen,
      indexed: 0,
      skipped: stats.skipped,
      apiCalls: stats.apiCalls,
    });
    return {
      success: true,
      keptPrevious: true,
      state,
      report: finalizeReport(),
      message: '未发现可入库影片，已保留上一份索引',
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
    report: finalizeReport(),
    message: `索引完成：${stats.indexed} 条`,
  };
}
