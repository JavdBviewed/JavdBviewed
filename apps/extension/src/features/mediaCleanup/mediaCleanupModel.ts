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
  /** 删除成功时的返回信息（用于操作记录展示），失败用 error 字段。 */
  message?: string;
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

/** 去除 copyId 的 ::rev{ts} 派生后缀，得到同一来源文件的基座 copyId。 */
export function baseCopyId(copyId: string): string {
  const index = copyId.indexOf('::rev');
  return index === -1 ? copyId : copyId.slice(0, index);
}

/**
 * 合并历史重复记录（旧假成功 bug 遗留的脏数据）。
 * 同一基座来源文件在队列中存在多份副本（≥2）时收敛：
 * - 文件仍在库里（activeBaseCopyIds 命中）：只保留一份可处理副本——
 *   组内有 pending → 保留 updatedAt 最新的一份；无 pending → 将最新一份提升为 pending 重新入队。
 * - 文件已不在库里（可能已被外部删除）：无可执行目标，组内除 deleted 终态外的记录全部
 *   标记 skipped，避免过期记录永久滞留「待处理」。
 * - 单份记录不收敛（保留用户仍可手动删除、由删除幂等逻辑兜底的兜底路径）。
 * - 组内有 deleting（在途删除）副本时整组不碰。
 * - deleted 终态始终保持原样（删除历史可追溯，不参与折叠）。
 */
export function convergeStaleDuplicateCopies(
  input: MediaCleanupState,
  activeBaseCopyIds: ReadonlySet<string>,
  now = Date.now(),
): { state: MediaCleanupState; convergedCount: number } {
  let convergedCount = 0;
  let changed = false;
  const items: Record<string, MediaCleanupItem> = {};
  for (const [itemId, item] of Object.entries(input.items)) {
    // 以对象键为权威分组：历史脏数据的 entry.copyId 字段可能仍是基座 ID（旧版 enqueueTitle 的 bug），
    // 每次写回都规范化 copyId=键，从而自愈存量脏数据。
    const groups = new Map<string, { key: string; copy: MediaCleanupCopyEntry }[]>();
    for (const [key, copy] of Object.entries(item.copies)) {
      const base = baseCopyId(key);
      const list = groups.get(base);
      if (list) list.push({ key, copy });
      else groups.set(base, [{ key, copy }]);
    }
    let itemChanged = false;
    const copies = { ...item.copies };
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const base = baseCopyId(list[0].key);
      const fileStillPresent = activeBaseCopyIds.has(base);
      if (list.some(({ copy }) => copy.status === 'deleting')) continue;
      const sorted = [...list].sort(
        (a, b) => (b.copy.updatedAt - a.copy.updatedAt) || (a.key < b.key ? 1 : -1),
      );
      // 文件仍在库里：保留/提升一份可处理副本；文件已不在库里：全部折叠为 skipped。
      const keep = fileStillPresent
        ? sorted.find(({ copy }) => copy.status === 'pending') || sorted[0]
        : undefined;
      let groupChanged = false;
      if (keep && keep.copy.status !== 'pending') {
        copies[keep.key] = {
          ...keep.copy,
          copyId: keep.key,
          status: 'pending',
          error: undefined,
          message: '重新扫描发现文件仍在媒体库中，已重新入队',
          updatedAt: now,
        };
        groupChanged = true;
      } else if (keep) {
        // 规范化 copyId=键（自愈旧版派生副本的脏字段）。
        copies[keep.key] = { ...keep.copy, copyId: keep.key };
        groupChanged = true;
      }
      for (const { key, copy } of sorted) {
        if (keep && key === keep.key) continue;
        // deleted 终态是删除历史的一部分，保持原样；只折叠 failed/skipped/多余 pending。
        if (copy.status === 'deleted') continue;
        const message = fileStillPresent
          ? '历史重复记录，已随重新扫描合并'
          : '重新扫描时该文件已不在媒体库中，记录已合并';
        copies[key] = {
          ...copy,
          copyId: key,
          status: 'skipped',
          error: undefined,
          message,
          updatedAt: now,
        };
        convergedCount += 1;
        groupChanged = true;
      }
      itemChanged = itemChanged || groupChanged;
    }
    if (itemChanged) {
      changed = true;
      items[itemId] = { ...item, copies, updatedAt: now };
    } else {
      items[itemId] = item;
    }
  }
  if (!changed) return { state: input, convergedCount: 0 };
  return {
    state: { ...input, items, updatedAt: Math.max(input.updatedAt, now) },
    convergedCount,
  };
}

function enqueueTitle(
  state: MediaCleanupState,
  title: WatchedMediaTitleSnapshot,
  now: number,
): { state: MediaCleanupState; added: boolean; requeuedCount: number } {
  const existing = state.items[title.titleId];
  const copies = { ...(existing?.copies || {}) };
  let requeuedCount = 0;
  for (const copy of title.copies) {
    const current = copies[copy.copyId];
    if (current && current.status === 'failed') {
      // 失败副本保持终态，走操作记录里的「重试删除」，不静默重置。
      copies[copy.copyId] = { ...current, ...copy, status: current.status, updatedAt: now };
      continue;
    }
    if (current && current.status === 'deleted') {
      // 已删除副本默认保持终态；但若扫描时该文件仍出现在本地索引中，
      // 说明此前的"删除成功"不可信（典型为旧版删除接口假成功），
      // 按新的 copyId 重新入队，让文件可以再次被处理。
      // 关键：若同一基座已经存在任意 ::rev 派生副本（pending/deleting/failed/deleted），
      // 说明该文件已经处于"重新处理"流程中，不再重复生成，避免每次查找都叠加一份。
      const hasRequeueDerivative = Object.keys(copies).some(
        (id) => id !== copy.copyId && id.startsWith(copy.copyId + '::rev'),
      );
      if (!hasRequeueDerivative) {
        // 派生副本的 copyId 字段必须与键一致：删除/重试链路按键取 entry，
        // 若字段仍是基座 ID，操作会命中基座条目，导致派生行永远不更新。
        const revCopyId = `${copy.copyId}::rev${now}`;
        copies[revCopyId] = { ...copy, copyId: revCopyId, status: 'pending', updatedAt: now };
        requeuedCount += 1;
      }
      copies[copy.copyId] = { ...current, ...copy, status: current.status, updatedAt: now };
      continue;
    }
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
    requeuedCount,
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
): { state: MediaCleanupState; added: boolean; requeuedCount: number } {
  const result = enqueueTitle(input, title, now);
  const observed = new Set(result.state.observedWatchedCopyIds || []);
  title.copies.forEach((copy) => {
    if (copy.watchedAt) observed.add(copy.copyId);
  });
  return {
    added: result.added,
    requeuedCount: result.requeuedCount,
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
): { state: MediaCleanupState; baselineCount: number; enqueuedCount: number; convergedCount: number } {
  const currentWatchedIds = watchedCopyIds(titles);
  const baselineCount = titles.filter((title) => title.copies.some((copy) => currentWatchedIds.has(copy.copyId))).length;
  if (!input.baseline?.capturedAt) {
    return {
      baselineCount,
      enqueuedCount: 0,
      convergedCount: 0,
      state: {
        ...input,
        observedWatchedCopyIds: Array.from(currentWatchedIds).sort(),
        baseline: { capturedAt: now, candidateCount: baselineCount },
        updatedAt: now,
      },
    };
  }

  const observed = new Set(input.observedWatchedCopyIds || []);
  // 已入队且非终态（pending/deleting）的副本也视为“已知”，避免重复入队；
  // 终态（failed/deleted/skipped）副本的已看副本 id 需重新参与匹配，
  // 从而把同影片的新来源副本补入队列（原副本本身由 enqueueTitle 保持终态）。
  const actionableCopyIds = new Set(Object.values(input.items)
    .flatMap((item) => Object.values(item.copies))
    .filter((copy) => copy.status === 'pending' || copy.status === 'deleting')
    .map((copy) => copy.copyId));
  const knownWatchedCopyIds = new Set([...observed, ...actionableCopyIds]);
  const newlyWatchedTitles = titles.filter((title) => title.copies.some((copy) => (
    currentWatchedIds.has(copy.copyId) && !knownWatchedCopyIds.has(copy.copyId)
  )));
  let state = input;
  let enqueuedCount = 0;
  for (const title of newlyWatchedTitles) {
    const result = enqueueTitle(state, title, now);
    state = result.state;
    if (result.added) enqueuedCount += 1;
    enqueuedCount += result.requeuedCount;
  }
  // 合并历史重复记录：同一来源文件至多保留一份可处理副本，避免脏数据滞留「待处理」。
  const activeBaseCopyIds = new Set(titles.flatMap((title) => title.copies.map((copy) => baseCopyId(copy.copyId))));
  const converged = convergeStaleDuplicateCopies(state, activeBaseCopyIds, now);
  state = converged.state;
  return {
    baselineCount: input.baseline.candidateCount,
    enqueuedCount,
    convergedCount: converged.convergedCount,
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
): { state: MediaCleanupState; enqueuedCount: number; convergedCount: number } {
  // 每次查找用独立的入队纪元：既避免同毫秒多次查找生成相同 ::rev 副本 ID，
  // 也保证同一扫描周期内不会重复生成新的待处理副本。
  const batch = (input.baseline?.importedAt || 0) + 1;
  let state = input;
  let enqueuedCount = 0;
  for (const title of titles) {
    if (!title.copies.some((copy) => Number(copy.watchedAt) > 0)) continue;
    const result = enqueueTitle(state, title, batch);
    state = result.state;
    if (result.added) enqueuedCount += 1;
    enqueuedCount += result.requeuedCount;
  }
  // 合并历史重复记录（旧假成功 bug 遗留脏数据）：同一来源文件至多保留一份可处理副本。
  const activeBaseCopyIds = new Set(titles.flatMap((title) => title.copies.map((copy) => baseCopyId(copy.copyId))));
  const converged = convergeStaleDuplicateCopies(state, activeBaseCopyIds, batch);
  state = converged.state;
  const baseline = state.baseline || {
    capturedAt: now,
    candidateCount: titles.length,
  };
  return {
    enqueuedCount,
    convergedCount: converged.convergedCount,
    state: {
      ...state,
      baseline: { ...baseline, importedAt: batch },
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
  shouldSkipCopy?: (
    title: WatchedMediaTitleSnapshot,
    copy: MediaCleanupCopySnapshot,
  ) => boolean,
): MediaDeletionHistoryState {
  const records = { ...input.records };
  for (const title of previousTitles) {
    for (const copy of title.copies) {
      if (!copy.watchedAt || nextCopyIds.has(copy.copyId)) continue;
      if (shouldSkipCopy?.(title, copy)) continue;
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

export function resetFailedCleanupCopyToPending(input: {
  cleanup: MediaCleanupState;
  titleId: string;
  copyId: string;
  now?: number;
}): { cleanup: MediaCleanupState; changed: boolean } {
  const now = input.now ?? Date.now();
  const item = input.cleanup.items[input.titleId];
  const copy = item?.copies[input.copyId];
  if (!item || !copy || copy.status !== 'failed') return { cleanup: input.cleanup, changed: false };
  const nextCopy: MediaCleanupCopyEntry = {
    ...copy,
    status: 'pending',
    error: undefined,
    updatedAt: now,
  };
  return {
    cleanup: {
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
    },
    changed: true,
  };
}

export function markCleanupCopyResult(input: {
  cleanup: MediaCleanupState;
  history: MediaDeletionHistoryState;
  titleId: string;
  copyId: string;
  success: boolean;
  error?: string;
  message?: string;
  now?: number;
}): { cleanup: MediaCleanupState; history: MediaDeletionHistoryState } {
  const now = input.now ?? Date.now();
  const item = input.cleanup.items[input.titleId];
  const copy = item?.copies[input.copyId];
  if (!item || !copy) return { cleanup: input.cleanup, history: input.history };
  // 重试场景：只有 pending/deleting 状态的副本可以被结果覆盖，
  // 避免并发/重复消息把已删除的终态副本误改。
  if (copy.status !== 'pending' && copy.status !== 'deleting') {
    return { cleanup: input.cleanup, history: input.history };
  }
  const nextCopy: MediaCleanupCopyEntry = {
    ...copy,
    status: input.success ? 'deleted' : 'failed',
    message: input.success ? (input.message || '删除成功') : copy.message,
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
