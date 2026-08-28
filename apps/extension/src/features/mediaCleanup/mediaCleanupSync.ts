import type { EmbyLibraryIndexEntry, EmbyLibraryState } from '../embyLibrary/types';
import { normalizeServerKey, normalizeServerUrl } from '../embyLibrary/domain/libraryIndex';
import { normalizeVideoCodeCandidate } from '../../shared/utils/videoCodeExtractor';
import {
  recordMissingWatchedCopies,
  scanWatchedTitles,
  type MediaCleanupState,
  type MediaDeletionHistoryState,
  type WatchedMediaTitleSnapshot,
} from './mediaCleanupModel';

function entryServerKey(entry: EmbyLibraryIndexEntry): string {
  return `${entry.serverType}:${normalizeServerKey(entry.serverUrl)}`;
}

function entryCopyId(entry: EmbyLibraryIndexEntry): string {
  return `${entry.serverType}:${normalizeServerKey(entry.serverUrl)}:${entry.itemId}`;
}

export type Drive115CleanupLibraryState = {
  updatedAt?: number;
  entries?: Array<{
    code?: string;
    title?: string;
    videoFileId?: string;
    pickCode?: string;
    fileName?: string;
    folderName?: string;
    coverFileName?: string;
    coverPickCode?: string;
    updatedAt?: number;
  }>;
};

export type CleanupWatchEvidenceState = {
  version?: number;
  titles?: Record<string, {
    legacy?: CleanupWatchEvidence;
    copies?: Record<string, CleanupWatchEvidence>;
  }>;
};

type CleanupWatchEvidence = {
  percent?: number;
  watched?: boolean;
  lastPlayedAt?: number;
  copyId?: string;
  fileId?: string;
  pickCode?: string;
};

export function buildDrive115CleanupSnapshots(
  state: Drive115CleanupLibraryState | null | undefined,
): WatchedMediaTitleSnapshot[] {
  const titles = new Map<string, WatchedMediaTitleSnapshot>();
  for (const entry of state?.entries || []) {
    const normalizedCode = normalizeVideoCodeCandidate(String(entry.code || ''));
    const resourceId = String(entry.videoFileId || entry.pickCode || '').trim();
    if (!normalizedCode || !resourceId) continue;
    const titleId = normalizedCode.toUpperCase();
    const title = titles.get(titleId) || {
      titleId,
      code: titleId,
      title: String(entry.title || titleId).trim() || titleId,
      copies: [],
    };
    title.copies.push({
      copyId: `115:${resourceId}`,
      source: '115',
      serverName: '115 片库',
      fileId: entry.videoFileId,
      pickCode: entry.pickCode,
      fileName: entry.fileName,
      folderPath: entry.folderName,
      coverFileName: entry.coverFileName,
      coverPickCode: entry.coverPickCode,
      lastFoundAt: entry.updatedAt || state?.updatedAt || Date.now(),
    });
    titles.set(titleId, title);
  }
  return Array.from(titles.values());
}

export function attachMatchingCleanupCopies(
  titles: WatchedMediaTitleSnapshot[],
  additionalTitles: WatchedMediaTitleSnapshot[],
): WatchedMediaTitleSnapshot[] {
  const additionalByCode = new Map(additionalTitles.map((title) => [title.titleId, title]));
  return titles.map((title) => {
    const normalizedCode = normalizeVideoCodeCandidate(title.titleId)?.toUpperCase();
    const additional = normalizedCode ? additionalByCode.get(normalizedCode) : undefined;
    if (!additional) return title;
    const copies = [...title.copies, ...additional.copies]
      .filter((copy, index, all) => all.findIndex((candidate) => candidate.copyId === copy.copyId) === index);
    return { ...title, copies };
  });
}

export function mergeCleanupTitleSnapshots(
  groups: WatchedMediaTitleSnapshot[][],
): WatchedMediaTitleSnapshot[] {
  const merged = new Map<string, WatchedMediaTitleSnapshot>();
  for (const title of groups.flat()) {
    const current = merged.get(title.titleId);
    if (!current) {
      merged.set(title.titleId, { ...title, copies: [...title.copies] });
      continue;
    }
    const copies = [...current.copies, ...title.copies]
      .filter((copy, index, all) => all.findIndex((candidate) => candidate.copyId === copy.copyId) === index);
    merged.set(title.titleId, { ...current, copies });
  }
  return Array.from(merged.values());
}

export function applyCleanupWatchEvidence(
  titles: WatchedMediaTitleSnapshot[],
  state: CleanupWatchEvidenceState | null | undefined,
): WatchedMediaTitleSnapshot[] {
  return titles.map((title) => {
    const bucket = state?.titles?.[title.titleId];
    return {
      ...title,
      copies: title.copies.map((copy) => {
        const evidence = bucket?.copies?.[copy.copyId] || bucket?.legacy;
        const watched = evidence?.watched === true || Number(evidence?.percent || 0) >= 90;
        if (!watched) return copy;
        return {
          ...copy,
          watchedAt: Number(evidence?.lastPlayedAt) || copy.watchedAt || copy.lastFoundAt,
        };
      }),
    };
  });
}

function relevantEntries(
  state: EmbyLibraryState,
  successfulServerKeys: ReadonlySet<string>,
): Array<{ code: string; entry: EmbyLibraryIndexEntry }> {
  return Object.entries(state.entries || {}).flatMap(([code, entries]) => entries
    .filter((entry) => successfulServerKeys.has(entryServerKey(entry)))
    .map((entry) => ({ code, entry })));
}

export function buildEmbyCleanupSnapshots(
  state: EmbyLibraryState,
  successfulServerKeys: ReadonlySet<string>,
): WatchedMediaTitleSnapshot[] {
  const titles = new Map<string, WatchedMediaTitleSnapshot>();
  for (const { code, entry } of relevantEntries(state, successfulServerKeys)) {
    const titleId = String(code || '').trim().toUpperCase();
    if (!titleId) continue;
    const title = titles.get(titleId) || {
      titleId,
      code: titleId,
      title: entry.itemName || titleId,
      copies: [],
    };
    title.copies.push({
      copyId: entryCopyId(entry),
      source: entry.serverType,
      serverName: entry.serverName,
      serverUrl: normalizeServerUrl(entry.serverUrl),
      serverId: entry.serverId,
      itemId: entry.itemId,
      fileName: entry.path?.split(/[\\/]/).pop(),
      folderPath: entry.path,
      coverImageUrl: entry.imageUrls?.Thumb || entry.coverImageUrl,
      watchedAt: entry.userData?.played
        ? (entry.userData.lastPlayedAt || entry.updatedAt)
        : undefined,
      lastFoundAt: entry.updatedAt,
    });
    titles.set(titleId, title);
  }
  return Array.from(titles.values());
}

export function collectEmbyServerKeys(state: EmbyLibraryState): Set<string> {
  return new Set(Object.values(state.entries || {})
    .flat()
    .map((entry) => entryServerKey(entry)));
}

export function processEmbySyncCleanupState(input: {
  cleanup: MediaCleanupState;
  history: MediaDeletionHistoryState;
  previous: EmbyLibraryState;
  next: EmbyLibraryState;
  successfulServerKeys: ReadonlySet<string>;
  removedServerKeys?: ReadonlySet<string>;
  additionalTitles?: WatchedMediaTitleSnapshot[];
  now?: number;
}): {
  cleanup: MediaCleanupState;
  history: MediaDeletionHistoryState;
  baselineCount: number;
  enqueuedCount: number;
} {
  const now = input.now ?? Date.now();
  const removedKeys = input.removedServerKeys || new Set<string>();
  const previousTitles = buildEmbyCleanupSnapshots(input.previous, input.successfulServerKeys);
  const nextTitles = attachMatchingCleanupCopies(
    buildEmbyCleanupSnapshots(input.next, input.successfulServerKeys),
    input.additionalTitles || [],
  );
  const nextCopyIds = new Set(nextTitles.flatMap((title) => title.copies.map((copy) => copy.copyId)));
  const scan = scanWatchedTitles(input.cleanup, nextTitles, now);
  // 副本因「服务器被删除 / 改地址」（key 移出配置白名单）而消失：不算「外部删除」，
  // 不写入删除历史（用户是主动移除服务器，不是文件被外部删掉）。
  // 注意：同 title 若仍有其它来源（如 115）副本，emby 副本的消失仍是外部删除，要记录。
  const history = recordMissingWatchedCopies(
    input.history,
    previousTitles,
    nextCopyIds,
    now,
    (_title, copy) => removedKeys.has(`${copy.source}:${normalizeServerKey(String(copy.serverUrl || ''))}`),
  );
  return {
    cleanup: scan.state,
    history,
    baselineCount: scan.baselineCount,
    enqueuedCount: scan.enqueuedCount,
  };
}
