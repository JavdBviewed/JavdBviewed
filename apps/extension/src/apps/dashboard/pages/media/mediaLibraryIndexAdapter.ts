/**
 * @file mediaLibraryIndexAdapter.ts
 * @description 将 Emby/Jellyfin 本地索引状态适配为媒体库浏览条目
 * @module apps/dashboard/pages/media
 */
import { buildMediaItemUrl, normalizeServerUrl } from '../../../../features/embyLibrary/domain/libraryIndex';
import {
  computeWatchState,
  formatWatchPercent,
  resolveWatchProgressPercent,
  watchStateLabel,
  type MediaWatchState,
} from '../../../../features/embyLibrary/domain/watchState';
import type { EmbyLibraryIndexEntry, EmbyLibraryState, EmbyWatchUserData } from '../../../../features/embyLibrary/types';
import type { MediaWatchEvidenceMap } from '../../../../features/media/mediaWatchEvidence';
import type { ParsedNfoSummary } from '../../../../features/drive115/mediaLibrary/parseEntryMeta';
import { normalizeVideoCodeCandidate } from '../../../../shared/utils/videoCodeExtractor';
import {
  getMediaSourceCopies,
  type MediaBrowseItem,
  type MediaItemSource,
  type MediaSourceCopy,
} from './mediaBrowseModel';

/**
 * 从番号字符串生成稳定色相（预览渐变用）
 */
export function hueFromCode(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) {
    h = (h * 31 + code.charCodeAt(i)) % 360;
  }
  return h;
}

/**
 * 将索引条目映射为浏览用 source
 */
export function entryToSource(entry: EmbyLibraryIndexEntry): Extract<MediaItemSource, 'emby' | 'jellyfin'> {
  return entry.serverType === 'jellyfin' ? 'jellyfin' : 'emby';
}

/**
 * 生成服务器网页端详情链接；字段不全时返回 null
 */
export function buildServerOpenUrl(
  item: Pick<MediaBrowseItem, 'serverUrl' | 'itemId' | 'source' | 'serverId'>,
): string | null {
  if (!item.serverUrl || !item.itemId) return null;
  if (item.source !== 'emby' && item.source !== 'jellyfin') return null;
  return buildMediaItemUrl({
    serverUrl: item.serverUrl,
    itemId: item.itemId,
    serverType: item.source,
    serverId: item.serverId,
  });
}

/**
 * 兼容旧「播放外链」API：不再生成 `#!/video` 深链，统一回退详情页。
 * 真正播放请走 `EMBY_LIBRARY_RESOLVE_STREAM` + MediaPlayer。
 */
export function buildServerPlayUrl(
  item: Pick<MediaBrowseItem, 'serverUrl' | 'itemId' | 'source' | 'serverId'>,
): string | null {
  // 与详情相同；保留函数名以免旧测试/调用断裂
  return buildServerOpenUrl(item);
}

/**
 * 条目观看态（入库条目默认至少 in_library）
 */
export function resolveItemWatchState(entry: EmbyLibraryIndexEntry | null | undefined): MediaWatchState {
  if (!entry) return 'none';
  return computeWatchState(entry.userData);
}

export { formatWatchPercent, resolveWatchProgressPercent, watchStateLabel };
export type { MediaWatchState };

/**
 * 目录卡片只需要少量 NFO 字段；简介、演员和图片引用留到详情弹窗按需读取。
 * 不保留 schemaVersion，确保详情仍会通过现有 handler 命中缓存或解析完整摘要。
 */
function compactBrowseNfoSummary(summary: ParsedNfoSummary | undefined): ParsedNfoSummary | undefined {
  if (!summary) return undefined;
  const compact: ParsedNfoSummary = {
    title: summary.title,
    originalTitle: summary.originalTitle,
    year: summary.year,
    num: summary.num,
    studio: summary.studio,
    contentRating: summary.contentRating,
    rating: summary.rating,
    runtime: summary.runtime,
    genres: summary.genres,
    director: summary.director,
  };
  return Object.values(compact).some((value) => (
    typeof value === 'string'
      ? value.trim().length > 0
      : Array.isArray(value)
        ? value.length > 0
        : Boolean(value)
  )) ? compact : undefined;
}

function secondsToTicks(seconds: number | undefined): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 10_000_000);
}

export function makeMediaCopyId(input: Pick<MediaSourceCopy, 'source' | 'serverUrl' | 'itemId' | 'fileId' | 'pickCode'>): string {
  if (input.source === '115') {
    const resourceId = String(input.fileId || input.itemId || input.pickCode || '').trim();
    return resourceId ? `115:${resourceId}` : '';
  }
  const serverUrl = normalizeServerUrl(String(input.serverUrl || ''));
  const itemId = String(input.itemId || '').trim();
  return serverUrl && itemId ? `${input.source}:${serverUrl}:${itemId}` : '';
}

function normalizeEvidenceAlias(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function withoutCommonVideoExtension(value: unknown): string {
  return String(value || '').trim().replace(/\.(mp4|mkv|avi|mov|wmv|m4v|ts|webm)$/i, '');
}

function collectEvidenceAliases(item: MediaBrowseItem): string[] {
  const rawValues = [
    item.code,
    item.title,
    item.fileName,
    withoutCommonVideoExtension(item.fileName),
    item.folderPath,
    item.pickCode,
    item.itemId,
  ];
  const aliases = new Set<string>();
  for (const raw of rawValues) {
    const normalized = normalizeEvidenceAlias(raw);
    if (normalized) aliases.add(normalized);
    const videoCode = normalizeVideoCodeCandidate(String(raw || ''));
    if (videoCode) aliases.add(normalizeEvidenceAlias(videoCode));
  }
  return Array.from(aliases);
}

export type WatchEvidenceLookup = {
  byExactKey: Map<string, MediaWatchEvidenceMap[string]>;
  byCopyId: Map<string, MediaWatchEvidenceMap[string]>;
  bySourceId: Map<string, MediaWatchEvidenceMap[string]>;
  byAlias: Map<string, MediaWatchEvidenceMap[string]>;
};

function evidenceSourceKey(source: MediaWatchEvidenceMap[string]['source']): string {
  return source;
}

function setFirst<T>(map: Map<string, T>, key: string, value: T): void {
  if (key && !map.has(key)) map.set(key, value);
}

/**
 * 将观看证据一次性建立索引，避免每个媒体副本都扫描完整 evidenceMap。
 * 证据表可能包含数千个条目，媒体库刷新属于高频路径，不能在卡片循环中重复 Object.values。
 */
export function buildWatchEvidenceLookup(
  evidenceMap: MediaWatchEvidenceMap,
): WatchEvidenceLookup {
  const lookup: WatchEvidenceLookup = {
    byExactKey: new Map(),
    byCopyId: new Map(),
    bySourceId: new Map(),
    byAlias: new Map(),
  };

  for (const [rawKey, evidence] of Object.entries(evidenceMap)) {
    setFirst(lookup.byExactKey, rawKey, evidence);
    const aliases = [
      rawKey,
      evidence.sourceItemId,
      evidence.pickCode,
      evidence.fileId,
      evidence.fileName,
      withoutCommonVideoExtension(evidence.fileName),
    ].map(normalizeEvidenceAlias);
    for (const alias of aliases) setFirst(lookup.byAlias, alias, evidence);

    const copyId = String(evidence.copyId || '').trim();
    if (copyId) setFirst(lookup.byCopyId, copyId, evidence);

    const source = evidenceSourceKey(evidence.source);
    for (const sourceId of [evidence.sourceItemId, evidence.fileId, evidence.pickCode]) {
      const normalizedId = String(sourceId || '').trim();
      if (normalizedId) setFirst(lookup.bySourceId, `${source}|${normalizedId}`, evidence);
    }
  }
  return lookup;
}

function findLocalWatchEvidence(
  item: MediaBrowseItem,
  lookup: WatchEvidenceLookup,
): MediaWatchEvidenceMap[string] | undefined {
  const aliases = collectEvidenceAliases(item);
  for (const alias of aliases) {
    const direct = lookup.byExactKey.get(alias);
    if (direct) return direct;
  }
  return aliases.map((alias) => lookup.byAlias.get(alias)).find(Boolean);
}

function findCopyWatchEvidence(
  code: string,
  copy: MediaSourceCopy,
  lookup: WatchEvidenceLookup,
): MediaWatchEvidenceMap[string] | undefined {
  const direct = lookup.byExactKey.get(`${normalizeEvidenceAlias(code)}::${copy.copyId}`);
  if (direct) return direct;
  const byCopyId = lookup.byCopyId.get(copy.copyId);
  if (byCopyId) return byCopyId;

  const evidenceSource = copy.source === '115' ? 'drive115' : copy.source;
  const copyIds = [copy.itemId, copy.fileId, copy.pickCode]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return copyIds
    .map((copyId) => lookup.bySourceId.get(`${evidenceSource}|${copyId}`))
    .find((evidence) => !evidence?.copyId);
}

function mergeEvidenceIntoUserData(
  remote: EmbyWatchUserData | undefined,
  evidence: MediaWatchEvidenceMap[string] | undefined,
): EmbyWatchUserData | undefined {
  if (!evidence) return remote;
  const local: EmbyWatchUserData = {
    played: evidence.watched === true,
    positionTicks: secondsToTicks(evidence.positionSec),
    runtimeTicks: secondsToTicks(evidence.durationSec),
    percent: evidence.percent,
    lastPlayedAt: evidence.lastPlayedAt,
  };
  const remotePercent = remote?.percent || 0;
  const localPercent = local.percent || 0;
  const useLocalTicks = localPercent >= remotePercent;
  const percent = Math.max(remotePercent, localPercent);
  return {
    played: Boolean(remote?.played || local.played || percent >= 90),
    positionTicks: useLocalTicks
      ? (local.positionTicks || remote?.positionTicks || 0)
      : (remote?.positionTicks || local.positionTicks || 0),
    runtimeTicks: Math.max(remote?.runtimeTicks || 0, local.runtimeTicks || 0),
    percent,
    lastPlayedAt: Math.max(remote?.lastPlayedAt || 0, local.lastPlayedAt || 0),
  };
}

function watchDataEqual(
  left: EmbyWatchUserData | undefined,
  right: EmbyWatchUserData | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.played === right.played
    && left.positionTicks === right.positionTicks
    && left.runtimeTicks === right.runtimeTicks
    && left.percent === right.percent
    && left.lastPlayedAt === right.lastPlayedAt;
}

function aggregateCopyUserData(values: Array<EmbyWatchUserData | undefined>): EmbyWatchUserData | undefined {
  const available = values.filter((value): value is EmbyWatchUserData => Boolean(value));
  if (!available.length) return undefined;
  const representative = [...available].sort((a, b) => {
    if (a.played !== b.played) return a.played ? -1 : 1;
    if (a.percent !== b.percent) return b.percent - a.percent;
    return b.lastPlayedAt - a.lastPlayedAt;
  })[0];
  return {
    ...representative,
    played: available.some((value) => value.played || value.percent >= 90),
    runtimeTicks: Math.max(...available.map((value) => value.runtimeTicks || 0)),
    lastPlayedAt: Math.max(...available.map((value) => value.lastPlayedAt || 0)),
  };
}

/**
 * Emby 库状态 → 浏览列表（每个物理副本输出一条，稍后按影片聚合）
 */
export function mapLibraryStateToBrowseItems(state: EmbyLibraryState | null | undefined): MediaBrowseItem[] {
  if (!state?.entries) return [];
  const items: MediaBrowseItem[] = [];
  for (const [code, entries] of Object.entries(state.entries)) {
    if (!entries?.length) continue;
    for (const entry of entries) {
      const source = entryToSource(entry);
      const watchState = resolveItemWatchState(entry);
      const item: MediaBrowseItem = {
        code,
        title: entry.itemName || code,
        source,
        year: '',
        hue: hueFromCode(code),
        coverImageUrl: entry.coverImageUrl,
        imageUrls: entry.imageUrls,
        serverName: entry.serverName,
        itemId: entry.itemId,
        serverUrl: entry.serverUrl,
        serverId: entry.serverId,
        fileName: entry.path?.split(/[\\/]/).pop(),
        folderPath: entry.path,
        userData: entry.userData,
        watchState,
      };
      items.push(item);
    }
  }
  // 番号字典序，稳定展示
  items.sort((a, b) => a.code.localeCompare(b.code));
  return items;
}

/**
 * 是否存在可用索引数据
 */
export function hasLibraryIndex(state: EmbyLibraryState | null | undefined): boolean {
  return mapLibraryStateToBrowseItems(state).length > 0;
}

/**
 * 合并本地 115 等观看证据（升级进度，不降级）
 */
export function mergeLocalWatchEvidence(
  items: MediaBrowseItem[],
  evidenceMap: MediaWatchEvidenceMap | null | undefined,
): MediaBrowseItem[] {
  if (!evidenceMap || !Object.keys(evidenceMap).length) return items;
  const lookup = buildWatchEvidenceLookup(evidenceMap);
  let catalogChanged = false;
  const nextItems = items.map((item) => {
    if (!item.copies?.length) {
      const canonicalCopy = getMediaSourceCopies(item)[0];
      const evidence = canonicalCopy
        ? findCopyWatchEvidence(item.code, canonicalCopy, lookup)
          || findLocalWatchEvidence(item, lookup)
        : findLocalWatchEvidence(item, lookup);
      const userData = mergeEvidenceIntoUserData(item.userData, evidence);
      const nextWatchState = userData ? computeWatchState(userData) : item.watchState;
      if (
        !evidence
        || (watchDataEqual(userData, item.userData) && nextWatchState === item.watchState)
      ) {
        return item;
      }
      catalogChanged = true;
      return {
        ...item,
        userData,
        watchState: nextWatchState,
      };
    }

    let copiesChanged = false;
    const mappedCopies = item.copies?.map((copy) => {
      const evidence = findCopyWatchEvidence(item.code, copy, lookup);
      const mergedUserData = mergeEvidenceIntoUserData(copy.userData, evidence);
      const userData = watchDataEqual(mergedUserData, copy.userData)
        ? copy.userData
        : mergedUserData;
      const watchState = userData ? computeWatchState(userData) : copy.watchState;
      const changed = userData !== copy.userData || watchState !== copy.watchState;
      if (changed) copiesChanged = true;
      return changed ? { ...copy, userData, watchState } : copy;
    });
    const copies = copiesChanged ? mappedCopies : item.copies;
    const legacyEvidence = findLocalWatchEvidence(item, lookup);
    const legacyUserData = legacyEvidence?.copyId
      ? undefined
      : mergeEvidenceIntoUserData(item.userData, legacyEvidence);
    if (!copiesChanged && !legacyEvidence) return item;
    const userData = aggregateCopyUserData([
      ...(copies || []).map((copy) => copy.userData),
      legacyUserData,
    ]);
    const nextWatchState = userData ? computeWatchState(userData) : item.watchState;
    if (
      !copiesChanged
      && watchDataEqual(userData, item.userData)
      && nextWatchState === item.watchState
    ) {
      return item;
    }
    catalogChanged = true;
    return {
      ...item,
      copies,
      userData,
      watchState: nextWatchState,
    };
  });
  return catalogChanged ? nextItems : items;
}


/**
 * 115 本地索引 → 浏览列表
 */
export function mapDrive115LibraryStateToBrowseItems(
  state: { entries?: Array<{
    key?: string;
    code?: string;
    title?: string;
    videoFileId?: string;
    pickCode?: string;
    fileName?: string;
    folderName?: string;
    folderCid?: string;
    rootCid?: string;
    nfoPickCode?: string;
    coverPickCode?: string;
    nfoSummary?: ParsedNfoSummary;
    updatedAt?: number;
  }> } | null | undefined,
): MediaBrowseItem[] {
  if (!state?.entries?.length) return [];
  const items: MediaBrowseItem[] = [];
  for (const entry of state.entries) {
    if (!entry?.pickCode || !entry?.videoFileId) continue;
    const code =
      String(entry.code || '').trim() ||
      String(entry.folderName || '').trim() ||
      String(entry.fileName || '').trim() ||
      String(entry.videoFileId);
    const nfoSummary = compactBrowseNfoSummary(entry.nfoSummary);
    const title =
      String(nfoSummary?.title || entry.title || code).trim() || code;
    items.push({
      code,
      title,
      source: '115',
      year: String(nfoSummary?.year || '').trim(),
      hue: hueFromCode(code),
      itemId: entry.videoFileId,
      pickCode: entry.pickCode,
      fileName: entry.fileName,
      folderPath: entry.folderName,
      serverName: '115 片库',
      watchState: 'in_library',
      libraryKey: entry.key,
      coverPickCode: entry.coverPickCode,
      nfoSummary,
    });
  }
  items.sort((a, b) => a.code.localeCompare(b.code));
  return items;
}

/**
 * 合并媒体目录；同番号聚合为一个影片实体，并保留全部物理副本。
 */
export function mergeBrowseCatalogs(
  embyItems: MediaBrowseItem[],
  drive115Items: MediaBrowseItem[],
): MediaBrowseItem[] {
  const byCode = new Map<string, MediaBrowseItem>();
  for (const rawItem of [...embyItems, ...drive115Items]) {
    const item = rawItem;
    const normalizedCode = normalizeVideoCodeCandidate(String(item.code || ''));
    const ownCopy = getMediaSourceCopies(item)[0];
    const fallbackId = ownCopy?.copyId || `${item.source}:${item.itemId || item.pickCode || item.code}`;
    const mapKey = normalizedCode ? normalizedCode.toUpperCase() : `copy:${fallbackId}`;
    const existing = byCode.get(mapKey);
    if (!existing) {
      byCode.set(
        mapKey,
        normalizedCode && normalizedCode !== item.code
          ? { ...item, code: normalizedCode }
          : item,
      );
      continue;
    }

    const copies = [...getMediaSourceCopies(existing), ...getMediaSourceCopies(item)]
      .filter((copy, index, all) => Boolean(copy.copyId) && all.findIndex((candidate) => candidate.copyId === copy.copyId) === index);
    const userData = aggregateCopyUserData(copies.map((copy) => copy.userData));
    const next: MediaBrowseItem = {
      ...existing,
      copies,
      userData,
      watchState: userData ? computeWatchState(userData) : existing.watchState,
    };
    if (!next.pickCode && item.source === '115') {
      next.pickCode = item.pickCode;
      next.fileName = item.fileName || next.fileName;
    }
    byCode.set(mapKey, next);
  }
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export function hasDrive115LibraryIndex(
  state: { entries?: unknown[] } | null | undefined,
): boolean {
  return Array.isArray(state?.entries) && state.entries.length > 0;
}
