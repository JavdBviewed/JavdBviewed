/** @description 跨来源媒体清理队列与删除历史的纯领域模型。 */

export type MediaCleanupSource = 'emby' | 'jellyfin' | '115';
export type MediaCleanupCopyStatus = 'pending' | 'deleting' | 'deleted' | 'failed' | 'skipped';

export type MediaCleanupCopySnapshot = {
  copyId: string;
  source: MediaCleanupSource;
  serverName?: string;
  serverUrl?: string;
  serverId?: string;
  itemId?: string;
  fileId?: string;
  pickCode?: string;
  fileName?: string;
  folderPath?: string;
  /** Emby/Jellyfin 可直接加载的封面地址。 */
  coverImageUrl?: string;
  /** 115 封面文件名，仅作展示与诊断。 */
  coverFileName?: string;
  /** 115 封面 pick_code，由界面按需解析短时下载地址。 */
  coverPickCode?: string;
  watchedAt?: number;
  lastFoundAt: number;
};

export type WatchedMediaTitleSnapshot = {
  titleId: string;
  code: string;
  title: string;
  copies: MediaCleanupCopySnapshot[];
};

export type MediaCleanupCopyEntry = MediaCleanupCopySnapshot & {
  status: MediaCleanupCopyStatus;
  error?: string;
  updatedAt: number;
};

export type MediaCleanupItem = {
  id: string;
  titleId: string;
  code: string;
  title: string;
  reason: 'watched' | 'manual';
  addedAt: number;
  updatedAt: number;
  copies: Record<string, MediaCleanupCopyEntry>;
};

export type MediaCleanupState = {
  version: 1;
  items: Record<string, MediaCleanupItem>;
  observedWatchedCopyIds: string[];
  baseline?: {
    capturedAt: number;
    candidateCount: number;
    importedAt?: number;
  };
  updatedAt: number;
};

export type MediaDeletionHistoryRecord = MediaCleanupCopySnapshot & {
  id: string;
  titleId: string;
  code: string;
  title: string;
  reason: 'external_missing' | 'extension_cleanup';
  deletedAt: number;
};

export type MediaDeletionHistoryState = {
  version: 1;
  records: Record<string, MediaDeletionHistoryRecord>;
  updatedAt: number;
};

export type Legacy115CleanupItem = {
  id: string;
  code: string;
  title: string;
  fileId?: string;
  pickCode?: string;
  fileName?: string;
  reason: 'watched' | 'manual';
  addedAt: number;
  status: 'pending' | 'deleted' | 'failed' | 'skipped';
  error?: string;
};

export type Legacy115CleanupState = {
  items: Legacy115CleanupItem[];
  updatedAt: number;
};

export const EMPTY_MEDIA_CLEANUP_STATE: MediaCleanupState = {
  version: 1,
  items: {},
  observedWatchedCopyIds: [],
  updatedAt: 0,
};

export const EMPTY_MEDIA_DELETION_HISTORY: MediaDeletionHistoryState = {
  version: 1,
  records: {},
  updatedAt: 0,
};

function legacy115Identity(item: Legacy115CleanupItem): {
  titleId: string;
  code: string;
  copyId: string;
} {
  const code = String(item.code || '').trim().toUpperCase();
  const titleId = code || `legacy115:${item.id}`;
  const stableFileId = String(item.fileId || item.pickCode || '').trim();
  return {
    titleId,
    code: code || titleId,
    copyId: stableFileId ? `115:${stableFileId}` : `115:legacy:${item.id}`,
  };
}

export function migrateLegacy115CleanupState(
  input: MediaCleanupState,
  legacy: Legacy115CleanupState,
  now = Date.now(),
): MediaCleanupState {
  let items = input.items;
  let changed = false;
  const observed = new Set(input.observedWatchedCopyIds || []);

  for (const legacyItem of legacy.items || []) {
    if (legacyItem.status === 'deleted') continue;
    const identity = legacy115Identity(legacyItem);
    const existingItem = items[identity.titleId];
    if (existingItem?.copies[identity.copyId]) continue;
    const lastFoundAt = legacy.updatedAt || legacyItem.addedAt || now;
    const copy: MediaCleanupCopyEntry = {
      copyId: identity.copyId,
      source: '115',
      serverName: '115 片库',
      fileId: legacyItem.fileId,
      pickCode: legacyItem.pickCode,
      fileName: legacyItem.fileName,
      watchedAt: legacyItem.reason === 'watched' ? legacyItem.addedAt : undefined,
      lastFoundAt,
      status: legacyItem.status,
      error: legacyItem.error,
      updatedAt: lastFoundAt,
    };
    const nextItem: MediaCleanupItem = existingItem
      ? {
        ...existingItem,
        copies: { ...existingItem.copies, [identity.copyId]: copy },
        updatedAt: Math.max(existingItem.updatedAt, lastFoundAt),
      }
      : {
        id: identity.titleId,
        titleId: identity.titleId,
        code: identity.code,
        title: String(legacyItem.title || identity.code).trim() || identity.code,
        reason: legacyItem.reason,
        addedAt: legacyItem.addedAt || lastFoundAt,
        updatedAt: lastFoundAt,
        copies: { [identity.copyId]: copy },
      };
    items = { ...items, [identity.titleId]: nextItem };
    if (legacyItem.reason === 'watched') observed.add(identity.copyId);
    changed = true;
  }

  if (!changed) return input;
  return {
    ...input,
    items,
    observedWatchedCopyIds: Array.from(observed).sort(),
    updatedAt: Math.max(input.updatedAt, legacy.updatedAt || 0, now),
  };
}

export function migrateLegacy115DeletionHistory(
  input: MediaDeletionHistoryState,
  legacy: Legacy115CleanupState,
  now = Date.now(),
): MediaDeletionHistoryState {
  let records = input.records;
  let changed = false;
  for (const legacyItem of legacy.items || []) {
    if (legacyItem.status !== 'deleted') continue;
    const historyId = `legacy115:${legacyItem.id}`;
    if (records[historyId]) continue;
    const identity = legacy115Identity(legacyItem);
    const deletedAt = legacy.updatedAt || now;
    records = {
      ...records,
      [historyId]: {
        id: historyId,
        titleId: identity.titleId,
        code: identity.code,
        title: String(legacyItem.title || identity.code).trim() || identity.code,
        copyId: identity.copyId,
        source: '115',
        serverName: '115 片库',
        fileId: legacyItem.fileId,
        pickCode: legacyItem.pickCode,
        fileName: legacyItem.fileName,
        watchedAt: legacyItem.reason === 'watched' ? legacyItem.addedAt : undefined,
        lastFoundAt: deletedAt,
        reason: 'extension_cleanup',
        deletedAt,
      },
    };
    changed = true;
  }
  if (!changed) return input;
  return {
    version: 1,
    records,
    updatedAt: Math.max(input.updatedAt, legacy.updatedAt || 0, now),
  };
}

function mergeCleanupItems(local: MediaCleanupItem, remote: MediaCleanupItem): MediaCleanupItem {
  const copies = { ...local.copies };
  for (const [copyId, remoteCopy] of Object.entries(remote.copies || {})) {
    const localCopy = copies[copyId];
    if (!localCopy || remoteCopy.updatedAt > localCopy.updatedAt) {
      copies[copyId] = remoteCopy;
    }
  }
  const base = remote.updatedAt > local.updatedAt ? remote : local;
  return {
    ...base,
    addedAt: Math.min(local.addedAt || remote.addedAt, remote.addedAt || local.addedAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    copies,
  };
}

export function mergeMediaCleanupStates(
  local: MediaCleanupState,
  remote: MediaCleanupState,
): MediaCleanupState {
  const items = { ...local.items };
  for (const [titleId, remoteItem] of Object.entries(remote.items || {})) {
    const localItem = items[titleId];
    items[titleId] = localItem ? mergeCleanupItems(localItem, remoteItem) : remoteItem;
  }
  const baselines = [local.baseline, remote.baseline].filter(
    (value): value is NonNullable<MediaCleanupState['baseline']> => Boolean(value?.capturedAt),
  );
  const importedAt = Math.max(0, ...baselines.map((value) => value.importedAt || 0));
  const baseline = baselines.length > 0 ? {
    capturedAt: Math.min(...baselines.map((value) => value.capturedAt)),
    candidateCount: Math.max(...baselines.map((value) => value.candidateCount)),
    ...(importedAt > 0 ? { importedAt } : {}),
  } : undefined;
  return {
    version: 1,
    items,
    observedWatchedCopyIds: Array.from(new Set([
      ...(local.observedWatchedCopyIds || []),
      ...(remote.observedWatchedCopyIds || []),
    ])).sort(),
    ...(baseline ? { baseline } : {}),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

export function mergeMediaDeletionHistories(
  local: MediaDeletionHistoryState,
  remote: MediaDeletionHistoryState,
): MediaDeletionHistoryState {
  const records = { ...local.records };
  for (const [id, remoteRecord] of Object.entries(remote.records || {})) {
    const localRecord = records[id];
    if (!localRecord || remoteRecord.deletedAt > localRecord.deletedAt) {
      records[id] = remoteRecord;
    }
  }
  return {
    version: 1,
    records,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

function watchedCopyIds(titles: WatchedMediaTitleSnapshot[]): Set<string> {
  return new Set(titles.flatMap((title) => title.copies
    .filter((copy) => Number(copy.watchedAt) > 0)
    .map((copy) => copy.copyId)));
}

function enqueueTitle(
  state: MediaCleanupState,
  title: WatchedMediaTitleSnapshot,
  now: number,
): { state: MediaCleanupState; added: boolean } {
  const existing = state.items[title.titleId];
  const copies = { ...(existing?.copies || {}) };
  for (const copy of title.copies) {
    const current = copies[copy.copyId];
    copies[copy.copyId] = current
      ? { ...current, ...copy, updatedAt: now }
      : { ...copy, status: 'pending', updatedAt: now };
  }
  const item: MediaCleanupItem = {
    id: title.titleId,
    titleId: title.titleId,
    code: title.code,
    title: title.title,
    reason: existing?.reason || 'watched',
    addedAt: existing?.addedAt || now,
    updatedAt: now,
    copies,
  };
  return {
    added: !existing,
    state: {
      ...state,
      items: { ...state.items, [title.titleId]: item },
      updatedAt: now,
    },
  };
}

export function enqueueWatchedTitle(
  input: MediaCleanupState,
  title: WatchedMediaTitleSnapshot,
  now = Date.now(),
): { state: MediaCleanupState; added: boolean } {
  const result = enqueueTitle(input, title, now);
  const observed = new Set(result.state.observedWatchedCopyIds || []);
  title.copies.forEach((copy) => {
    if (copy.watchedAt) observed.add(copy.copyId);
  });
  return {
    added: result.added,
    state: {
      ...result.state,
      observedWatchedCopyIds: Array.from(observed).sort(),
      updatedAt: now,
    },
  };
}

export function scanWatchedTitles(
  input: MediaCleanupState,
  titles: WatchedMediaTitleSnapshot[],
  now = Date.now(),
): { state: MediaCleanupState; baselineCount: number; enqueuedCount: number } {
  const currentWatchedIds = watchedCopyIds(titles);
  const baselineCount = titles.filter((title) => title.copies.some((copy) => currentWatchedIds.has(copy.copyId))).length;
  if (!input.baseline?.capturedAt) {
    return {
      baselineCount,
      enqueuedCount: 0,
      state: {
        ...input,
        observedWatchedCopyIds: Array.from(currentWatchedIds).sort(),
        baseline: { capturedAt: now, candidateCount: baselineCount },
        updatedAt: now,
      },
    };
  }

  const observed = new Set(input.observedWatchedCopyIds || []);
  const newlyWatchedTitles = titles.filter((title) => title.copies.some((copy) => (
    currentWatchedIds.has(copy.copyId) && !observed.has(copy.copyId)
  )));
  let state = input;
  let enqueuedCount = 0;
  for (const title of newlyWatchedTitles) {
    const result = enqueueTitle(state, title, now);
    state = result.state;
    if (result.added) enqueuedCount += 1;
  }
  return {
    baselineCount: input.baseline.candidateCount,
    enqueuedCount,
    state: {
      ...state,
      observedWatchedCopyIds: Array.from(new Set([...observed, ...currentWatchedIds])).sort(),
      updatedAt: now,
    },
  };
}

export function importHistoricalWatched(
  input: MediaCleanupState,
  titles: WatchedMediaTitleSnapshot[],
  now = Date.now(),
): { state: MediaCleanupState; enqueuedCount: number } {
  let state = input;
  let enqueuedCount = 0;
  for (const title of titles) {
    if (!title.copies.some((copy) => Number(copy.watchedAt) > 0)) continue;
    const result = enqueueTitle(state, title, now);
    state = result.state;
    if (result.added) enqueuedCount += 1;
  }
  const baseline = state.baseline || {
    capturedAt: now,
    candidateCount: titles.length,
  };
  return {
    enqueuedCount,
    state: {
      ...state,
      baseline: { ...baseline, importedAt: now },
      observedWatchedCopyIds: Array.from(new Set([
        ...(state.observedWatchedCopyIds || []),
        ...watchedCopyIds(titles),
      ])).sort(),
      updatedAt: now,
    },
  };
}

export function recordMissingWatchedCopies(
  input: MediaDeletionHistoryState,
  previousTitles: WatchedMediaTitleSnapshot[],
  nextCopyIds: ReadonlySet<string>,
  now = Date.now(),
): MediaDeletionHistoryState {
  const records = { ...input.records };
  for (const title of previousTitles) {
    for (const copy of title.copies) {
      if (!copy.watchedAt || nextCopyIds.has(copy.copyId)) continue;
      const id = `external_missing:${copy.copyId}:${copy.lastFoundAt}`;
      records[id] = records[id] || {
        ...copy,
        id,
        titleId: title.titleId,
        code: title.code,
        title: title.title,
        reason: 'external_missing',
        deletedAt: now,
      };
    }
  }
  return { version: 1, records, updatedAt: now };
}

export function markCleanupCopyResult(input: {
  cleanup: MediaCleanupState;
  history: MediaDeletionHistoryState;
  titleId: string;
  copyId: string;
  success: boolean;
  error?: string;
  now?: number;
}): { cleanup: MediaCleanupState; history: MediaDeletionHistoryState } {
  const now = input.now ?? Date.now();
  const item = input.cleanup.items[input.titleId];
  const copy = item?.copies[input.copyId];
  if (!item || !copy) return { cleanup: input.cleanup, history: input.history };
  const nextCopy: MediaCleanupCopyEntry = {
    ...copy,
    status: input.success ? 'deleted' : 'failed',
    error: input.success ? undefined : (input.error || '删除失败'),
    updatedAt: now,
  };
  const cleanup: MediaCleanupState = {
    ...input.cleanup,
    items: {
      ...input.cleanup.items,
      [input.titleId]: {
        ...item,
        copies: { ...item.copies, [input.copyId]: nextCopy },
        updatedAt: now,
      },
    },
    updatedAt: now,
  };
  if (!input.success) return { cleanup, history: input.history };
  const historyId = `extension_cleanup:${input.copyId}:${now}`;
  const history: MediaDeletionHistoryState = {
    version: 1,
    records: {
      ...input.history.records,
      [historyId]: {
        ...copy,
        id: historyId,
        titleId: item.titleId,
        code: item.code,
        title: item.title,
        reason: 'extension_cleanup',
        deletedAt: now,
      },
    },
    updatedAt: now,
  };
  return { cleanup, history };
}
