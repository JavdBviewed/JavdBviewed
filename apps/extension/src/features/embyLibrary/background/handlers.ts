/**
 * @file handlers.ts
 * @description handlers
 * @module features/embyLibrary
 */
import { STORAGE_KEYS } from '../../../utils/config';
import { getSettings, getValue, saveSettings, setValue } from '../../../utils/storage';
import { authenticateEmbyUser, buildEmbyAuthHeaders, hasEmbyUserSession } from '../domain/embyUserAuth';
import {
  buildLibraryIndex,
  extractCodeFromMediaItem,
  generateVideoCodeSearchTerms,
  mergeLibraryIndexes,
  normalizeServerUrl,
  normalizeVideoCode,
} from '../domain/libraryIndex';
import { resolveEmbyStreamUrl } from '../domain/embyPlayback';
import { reportEmbyPlaybackProgress } from '../domain/embyPlaystate';
import { fetchEmbyItemDetail } from '../domain/embyItemDetail';
import { embyLog, mediaLog, playerLog } from '../mediaLibraryLogger';
import { reportWatchProgress } from '../../media/mediaWatchEvidence';
import { processPersistedEmbySyncCleanup } from '../../mediaCleanup/mediaCleanupStorage';
import type {
  EmbyLibraryFolderOption,
  EmbyLibraryIndexEntry,
  EmbyLibraryServerResult,
  EmbyLibraryState,
  EmbyMediaItem,
  EmbyMediaServer,
} from '../types';

type SendResponse = (response: any) => void;

export interface EmbyLibraryHandlerDeps {
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  getState: () => Promise<EmbyLibraryState>;
  saveState: (state: EmbyLibraryState) => Promise<void>;
  fetchImpl: typeof fetch;
  now: () => number;
  processCleanupSync?: (input: {
    previous: EmbyLibraryState;
    next: EmbyLibraryState;
    successfulServerKeys: ReadonlySet<string>;
    now: number;
  }) => Promise<{ enqueuedCount: number; baselineCount: number }>;
}

const DEFAULT_STATE: EmbyLibraryState = { entries: {}, updatedAt: 0 };
/** 大库 / 穿透代理时 15s 偏紧；同步失败常见于超时被当成泛化「连接失败」 */
const DEFAULT_LIBRARY_REQUEST_TIMEOUT_MS = 45000;
const TICKS_PER_SECOND = 10_000_000;

function defaultDeps(): EmbyLibraryHandlerDeps {
  return {
    getSettings,
    saveSettings,
    getState: () => getValue<EmbyLibraryState>(STORAGE_KEYS.EMBY_LIBRARY_STATE, DEFAULT_STATE),
    saveState: (state) => setValue(STORAGE_KEYS.EMBY_LIBRARY_STATE, state),
    fetchImpl: fetch,
    now: () => Date.now(),
    processCleanupSync: processPersistedEmbySyncCleanup,
  };
}

function getEnabledServers(settings: any): EmbyMediaServer[] {
  const servers = settings?.emby?.mediaServers;
  if (!Array.isArray(servers)) return [];

  return servers
    .filter((server) => server && server.enabled !== false)
    .map((server) => {
      const type: EmbyMediaServer['type'] = server.type === 'jellyfin' ? 'jellyfin' : 'emby';
      const libraryIds = Array.isArray(server.libraryIds)
        ? server.libraryIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [];
      const libraryOptions = Array.isArray(server.libraryOptions)
        ? server.libraryOptions
            .map((opt: any) => ({
              id: String(opt?.id || '').trim(),
              name: String(opt?.name || opt?.id || '').trim(),
              collectionType: opt?.collectionType ? String(opt.collectionType) : undefined,
            }))
            .filter((opt: EmbyLibraryFolderOption) => opt.id)
        : undefined;
      return {
        id: String(server.id || `${type}:${server.url || server.name || ''}`),
        type,
        name: String(server.name || (type === 'jellyfin' ? 'Jellyfin' : 'Emby')),
        url: normalizeServerUrl(String(server.url || '')),
        apiKey: String(server.apiKey || ''),
        enabled: true,
        libraryIds,
        ...(libraryOptions && libraryOptions.length ? { libraryOptions } : {}),
        username: server.username ? String(server.username) : undefined,
        accessToken: server.accessToken ? String(server.accessToken) : undefined,
        userId: server.userId ? String(server.userId) : undefined,
        userDisplayName: server.userDisplayName ? String(server.userDisplayName) : undefined,
        tokenObtainedAt: Number(server.tokenObtainedAt) || undefined,
      };
    })
    .filter((server) => server.url && (server.apiKey || server.accessToken));
}

function filterServersForSync(servers: EmbyMediaServer[], message: any): EmbyMediaServer[] {
  const serverIds = new Set<string>();
  const singleId = String(message?.serverId || '').trim();
  if (singleId) serverIds.add(singleId);
  if (Array.isArray(message?.serverIds)) {
    message.serverIds.forEach((id: unknown) => {
      const value = String(id || '').trim();
      if (value) serverIds.add(value);
    });
  }
  if (serverIds.size === 0) return servers;
  return servers.filter((server) => serverIds.has(server.id));
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '连接失败');
  return message
    .replace(/api_key=[^&\s]+/gi, 'api_key=***')
    .replace(/api[-_\s]?key[:=]\s*[^&\s]+/gi, 'API Key=***');
}

function getServerIndexKey(server: Pick<EmbyMediaServer, 'type' | 'url'>): string {
  return `${server.type}:${normalizeServerUrl(server.url)}`;
}

function getEntryServerIndexKey(entry: Pick<EmbyLibraryIndexEntry, 'serverType' | 'serverUrl'>): string {
  return `${entry.serverType}:${normalizeServerUrl(entry.serverUrl)}`;
}

function ticksToSeconds(ticks: unknown): number | undefined {
  const value = Number(ticks);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value / TICKS_PER_SECOND);
}

async function saveExternalWatchEvidenceForEntry(input: {
  code: string;
  entry: EmbyLibraryIndexEntry;
  positionSec?: number;
  durationSec?: number;
  percent: number;
  forceWatched?: boolean;
}): Promise<void> {
  try {
    await reportWatchProgress({
      code: input.code,
      source: input.entry.serverType,
      sourceItemId: input.entry.itemId,
      copyId: `${input.entry.serverType}:${normalizeServerUrl(input.entry.serverUrl)}:${input.entry.itemId}`,
      positionSec: input.positionSec,
      durationSec: input.durationSec,
      percent: input.percent,
      forceWatched: input.forceWatched === true,
      fileName: input.entry.itemName,
    });
  } catch (error) {
    playerLog.warn('本地观看证据写入失败', {
      itemId: input.entry.itemId,
      code: input.code,
      error: sanitizeError(error),
    });
  }
}

async function fetchAllMediaItems(
  server: EmbyMediaServer,
  fetchImpl: typeof fetch,
  searchTerm?: string,
  parentId?: string,
): Promise<EmbyMediaItem[]> {
  const params = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Movie',
    // 仅请求官方稳定 Fields；ParentThumb* 若服务端有会自带，不强制写入 Fields 以免部分版本 4xx
    Fields: 'Path,PrimaryImageAspectRatio,ImageTags,PrimaryImageTag,BackdropImageTags,UserData,RunTimeTicks',
  });
  if (searchTerm) {
    params.set('SearchTerm', searchTerm);
  }
  if (parentId) {
    params.set('ParentId', parentId);
  }
  // 无用户令牌时退回 api_key
  if (!server.accessToken && server.apiKey) {
    params.set('api_key', server.apiKey);
  }

  const itemPath = server.userId
    ? `/Users/${encodeURIComponent(server.userId)}/Items`
    : '/Items';
  const url = `${normalizeServerUrl(server.url)}${itemPath}?${params.toString()}`;
  const headers = buildEmbyAuthHeaders(server);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), DEFAULT_LIBRARY_REQUEST_TIMEOUT_MS)
    : null;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('连接超时');
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    throw new Error(server.accessToken ? '用户令牌无效，请重新登录' : 'API Key 错误');
  }

  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new Error(`媒体服务器暂时不可用 (${response.status})，请检查 Emby/JF 或反向代理`);
  }

  if (!response.ok) {
    throw new Error(`连接失败 (${response.status})`);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('数据解析失败');
  }

  return Array.isArray(data?.Items) ? data.Items : [];
}

async function resolveConfiguredWatchUserId(
  server: EmbyMediaServer,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const configuredUserId = String(server.userId || '').trim();
  if (configuredUserId) return configuredUserId;

  const username = String(server.username || '').trim();
  const apiKey = String(server.apiKey || '').trim();
  if (!username || !apiKey) return undefined;

  const url = `${normalizeServerUrl(server.url)}/Users?api_key=${encodeURIComponent(apiKey)}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), DEFAULT_LIBRARY_REQUEST_TIMEOUT_MS)
    : null;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildEmbyAuthHeaders(server),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('读取媒体用户超时');
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (response.status === 401) throw new Error('API Key 无权读取媒体用户');
  if (!response.ok) throw new Error(`读取媒体用户失败 (${response.status})`);

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('媒体用户数据解析失败');
  }
  const users = Array.isArray(data) ? data : Array.isArray(data?.Items) ? data.Items : [];
  const normalizedUsername = username.toLocaleLowerCase();
  const matched = users.find((user: any) => (
    String(user?.Name || '').trim().toLocaleLowerCase() === normalizedUsername
    && user?.Policy?.IsDisabled !== true
  ));
  const resolvedUserId = String(matched?.Id || '').trim();
  if (!resolvedUserId) {
    throw new Error(`未找到观看数据用户「${username}」，请在媒体库来源中重新登录`);
  }
  return resolvedUserId;
}

async function persistResolvedWatchUserId(
  server: EmbyMediaServer,
  resolvedUserId: string,
  deps: Pick<EmbyLibraryHandlerDeps, 'getSettings' | 'saveSettings'>,
): Promise<void> {
  const latest = await deps.getSettings();
  const mediaServers = latest?.emby?.mediaServers;
  if (!Array.isArray(mediaServers)) return;

  let changed = false;
  const nextServers = mediaServers.map((candidate: any) => {
    const sameId = String(candidate?.id || '') === server.id;
    const sameUrl = normalizeServerUrl(String(candidate?.url || '')) === normalizeServerUrl(server.url);
    const matchesLegacySource = !candidate?.id && sameUrl;
    if (!sameId && !matchesLegacySource) return candidate;
    if (String(candidate?.userId || '').trim() === resolvedUserId) return candidate;
    changed = true;
    return { ...candidate, userId: resolvedUserId };
  });
  if (!changed) return;

  await deps.saveSettings({
    ...latest,
    emby: {
      ...latest.emby,
      mediaServers: nextServers,
    },
  });
}

async function resolveServerUserScope(
  server: EmbyMediaServer,
  deps: Pick<EmbyLibraryHandlerDeps, 'fetchImpl' | 'getSettings' | 'saveSettings'>,
): Promise<EmbyMediaServer> {
  const resolvedUserId = await resolveConfiguredWatchUserId(server, deps.fetchImpl);
  if (!resolvedUserId || resolvedUserId === server.userId) return server;

  await persistResolvedWatchUserId(server, resolvedUserId, deps);
  return { ...server, userId: resolvedUserId };
}

/**
 * 拉取服务器顶层媒体库/媒体文件夹列表（供设置页多选）
 * Emby: /Library/MediaFolders  Jellyfin: 同路径或 /Library/VirtualFolders
 */
export async function fetchServerLibraryFolders(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey'>,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbyLibraryFolderOption[]> {
  const base = normalizeServerUrl(server.url);
  const apiKey = String(server.apiKey || '');
  if (!base || !apiKey) return [];

  const endpoints = [
    `${base}/Library/MediaFolders?api_key=${encodeURIComponent(apiKey)}`,
    `${base}/Library/VirtualFolders?api_key=${encodeURIComponent(apiKey)}`,
  ];

  for (const url of endpoints) {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), DEFAULT_LIBRARY_REQUEST_TIMEOUT_MS)
        : null;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          ...(controller ? { signal: controller.signal } : {}),
        });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      if (!response.ok) continue;
      const data = await response.json();
      // MediaFolders: { Items: [...] }  VirtualFolders: 数组或 { Items }
      const rawItems: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.Items)
          ? data.Items
          : [];
      const options: EmbyLibraryFolderOption[] = [];
      for (const item of rawItems) {
        const id = String(item?.ItemId || item?.Guid || item?.Id || '').trim();
        const name = String(item?.Name || item?.LibraryOptions?.Name || id).trim();
        if (!id || !name) continue;
        options.push({
          id,
          name,
          collectionType: item?.CollectionType
            ? String(item.CollectionType)
            : item?.LibraryOptions?.CollectionType
              ? String(item.LibraryOptions.CollectionType)
              : undefined,
        });
      }
      if (options.length > 0) return options;
    } catch {
      // 尝试下一端点
    }
  }
  return [];
}

/**
 * 按服务器配置的媒体库多选拉取 Movie 列表；未选库时全量（兼容旧配置）
 */
async function fetchMoviesForServer(
  server: EmbyMediaServer,
  deps: Pick<EmbyLibraryHandlerDeps, 'fetchImpl' | 'getSettings' | 'saveSettings'>,
  searchTerm?: string,
): Promise<EmbyMediaItem[]> {
  const scopedServer = await resolveServerUserScope(server, deps);
  const libraryIds = (server.libraryIds || []).map((id) => String(id).trim()).filter(Boolean);
  if (libraryIds.length === 0) {
    return fetchAllMediaItems(scopedServer, deps.fetchImpl, searchTerm);
  }

  const buckets: EmbyMediaItem[] = [];
  for (const parentId of libraryIds) {
    const items = await fetchAllMediaItems(scopedServer, deps.fetchImpl, searchTerm, parentId);
    buckets.push(...items);
  }
  return deduplicateMediaItemsById(buckets);
}

function removeEntriesForSuccessfulServers(
  state: EmbyLibraryState,
  successfulServerIds: Set<string>,
  servers: EmbyMediaServer[],
): Record<string, EmbyLibraryIndexEntry[]> {
  if (successfulServerIds.size === 0) return { ...(state.entries || {}) };

  const successfulServers = new Set(
    servers
      .filter((server) => successfulServerIds.has(server.id))
      .map((server) => getServerIndexKey(server)),
  );
  const next: Record<string, EmbyLibraryIndexEntry[]> = {};

  for (const [code, entries] of Object.entries(state.entries || {})) {
    const kept = entries.filter((entry) => {
      return !successfulServers.has(getEntryServerIndexKey(entry));
    });
    if (kept.length > 0) next[code] = kept;
  }

  return next;
}

function deduplicateMediaItemsById(items: EmbyMediaItem[]): EmbyMediaItem[] {
  const seenIds = new Set<string>();
  const deduplicatedItems: EmbyMediaItem[] = [];

  for (const item of items) {
    const itemId = String(item.Id || '').trim();
    if (!itemId || seenIds.has(itemId)) continue;
    seenIds.add(itemId);
    deduplicatedItems.push(item);
  }

  return deduplicatedItems;
}

export async function handleEmbyLibrarySync(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const [settings, previousState] = await Promise.all([
      deps.getSettings(),
      deps.getState(),
    ]);

    const servers = filterServersForSync(getEnabledServers(settings), message);
    if (servers.length === 0) {
      sendResponse({ success: true, synced: 0, failed: 0, serverResults: [] });
      return;
    }

    mediaLog.info('开始媒体库同步', {
      manual: message?.manual === true,
      servers: servers.map((s) => ({ id: s.id, type: s.type, name: s.name })),
    });
    const now = deps.now();
    const syncIntervalMinutes = Number(settings?.emby?.syncIntervalMinutes ?? 60);
    const elapsedMs = now - Number(previousState.updatedAt || 0);
    const shouldSkip = message?.manual !== true
      && syncIntervalMinutes > 0
      && previousState.updatedAt
      && elapsedMs < syncIntervalMinutes * 60 * 1000;

    if (shouldSkip) {
      sendResponse({ success: true, synced: 0, failed: 0, skipped: true });
      return;
    }

    const indexes = [];
    const serverResults: EmbyLibraryServerResult[] = [];
    const successfulServerIds = new Set<string>();

    for (const server of servers) {
      try {
        const items = await fetchMoviesForServer(server, deps);
        const index = buildLibraryIndex(server, items, now);
        indexes.push(index);
        successfulServerIds.add(server.id);
        const indexedCount = Object.values(index.entries).reduce((sum, entries) => sum + entries.length, 0);
        serverResults.push({
          serverId: server.id,
          serverType: server.type,
          serverName: server.name,
          success: true,
          itemCount: items.length,
          indexedCount,
          checkedAt: now,
        });
      } catch (error) {
        serverResults.push({
          serverId: server.id,
          serverType: server.type,
          serverName: server.name,
          success: false,
          itemCount: 0,
          indexedCount: 0,
          error: sanitizeError(error),
          checkedAt: now,
        });
      }
    }

    const keptEntries = removeEntriesForSuccessfulServers(previousState, successfulServerIds, servers);
    const nextUpdatedAt = successfulServerIds.size > 0 ? now : Number(previousState.updatedAt || 0);
    const merged = mergeLibraryIndexes([{ entries: keptEntries, updatedAt: previousState.updatedAt || 0 }, ...indexes], nextUpdatedAt);
    const nextState: EmbyLibraryState = {
      ...merged,
      updatedAt: nextUpdatedAt,
      serverResults,
    };

    await deps.saveState(nextState);

    let cleanupSummary: { enqueuedCount: number; baselineCount: number } | undefined;
    if (successfulServerIds.size > 0 && deps.processCleanupSync) {
      try {
        const successfulServerKeys = new Set(
          servers
            .filter((server) => successfulServerIds.has(server.id))
            .map((server) => getServerIndexKey(server)),
        );
        cleanupSummary = await deps.processCleanupSync({
          previous: previousState,
          next: nextState,
          successfulServerKeys,
          now,
        });
      } catch (error) {
        mediaLog.warn('媒体库清理账本更新失败', { error: sanitizeError(error) });
      }
    }

    const synced = serverResults.filter((result) => result.success).length;
    const failed = serverResults.filter((result) => !result.success).length;
    const firstError = serverResults.find((result) => !result.success)?.error;
    mediaLog.info('媒体库同步结束', { synced, failed, firstError: firstError || null });
    sendResponse({
      success: synced > 0,
      synced,
      failed,
      serverResults,
      ...(cleanupSummary ? {
        newCleanupItems: cleanupSummary.enqueuedCount,
        historicalWatchedCandidates: cleanupSummary.baselineCount,
      } : {}),
      ...(synced === 0 && firstError ? { error: firstError } : {}),
    });
  } catch (error) {
    mediaLog.error('媒体库同步异常', { error: sanitizeError(error) });
    sendResponse({ success: false, error: sanitizeError(error) });
  }
}

export async function handleEmbyLibraryCheckCodes(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const rawCodes: unknown[] = Array.isArray(message?.codes) ? message.codes : [];
    const normalizedCodes: string[] = rawCodes
      .map((code: unknown) => normalizeVideoCode(String(code || '')))
      .filter((code): code is string => Boolean(code));
    const codes: string[] = Array.from(new Set<string>(normalizedCodes)).slice(0, 20);
    if (codes.length === 0) {
      sendResponse({ success: true, checked: 0, matches: {} });
      return;
    }

    const [settings, previousState] = await Promise.all([
      deps.getSettings(),
      deps.getState(),
    ]);
    const servers = getEnabledServers(settings);
    if (servers.length === 0) {
      sendResponse({ success: true, checked: 0, matches: {} });
      return;
    }

    const now = deps.now();
    const nextEntries: Record<string, EmbyLibraryIndexEntry[]> = { ...(previousState.entries || {}) };
    const matches: Record<string, EmbyLibraryIndexEntry[]> = {};

    for (const code of codes) {
      const foundForCode: EmbyLibraryIndexEntry[] = [];
      for (const server of servers) {
        try {
          const searchTerms = generateVideoCodeSearchTerms(code);
          const returnedItems: EmbyMediaItem[] = [];
          for (const searchTerm of searchTerms) {
            returnedItems.push(...await fetchMoviesForServer(server, deps, searchTerm));
          }
          const items = deduplicateMediaItemsById(returnedItems);
          const matchedItems = items.filter((item) => extractCodeFromMediaItem(item) === code);
          const index = buildLibraryIndex(server, matchedItems, now);
          const serverMatches = index.entries[code] || [];
          foundForCode.push(...serverMatches);

          const serverKey = getServerIndexKey(server);
          const existing = (nextEntries[code] || []).filter((entry) => {
            return getEntryServerIndexKey(entry) !== serverKey;
          });
          nextEntries[code] = [...existing, ...serverMatches];
          if (nextEntries[code].length === 0) delete nextEntries[code];
        } catch {
          // 实时校验失败保持旧状态，避免列表页闪烁。
        }
      }
      matches[code] = foundForCode;
    }

    const nextState: EmbyLibraryState = {
      ...previousState,
      entries: nextEntries,
      updatedAt: previousState.updatedAt || 0,
    };
    await deps.saveState(nextState);
    sendResponse({ success: true, checked: codes.length, matches, state: nextState });
  } catch (error) {
    sendResponse({ success: false, error: sanitizeError(error) });
  }
}

/**
 * 写回 Emby/JF 播放标记（Played）
 * 优先用户会话 PlayedItems；否则回退 ApiKey UserData
 */
export async function handleEmbyLibrarySetPlayed(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const itemId = String(message?.itemId || '').trim();
    const serverUrlRaw = String(message?.serverUrl || '').trim();
    const played = message?.played === true;
    if (!itemId || !serverUrlRaw) {
      sendResponse({ success: false, error: '缺少 itemId 或 serverUrl' });
      return;
    }

    const settings = await deps.getSettings();
    const servers = getEnabledServers(settings);
    const serverUrl = normalizeServerUrl(serverUrlRaw);
    const server = servers.find((s) => normalizeServerUrl(s.url) === serverUrl)
      || servers.find((s) => s.id === String(message?.serverId || ''));

    if (!server) {
      sendResponse({ success: false, error: '未找到匹配的已启用媒体服务器' });
      return;
    }

    const scopedServer = await resolveServerUserScope(server, deps);
    const base = normalizeServerUrl(scopedServer.url);
    let response: Response;

    if (hasEmbyUserSession(scopedServer) && scopedServer.userId && scopedServer.accessToken) {
      const path = `${base}/Users/${encodeURIComponent(scopedServer.userId)}/PlayedItems/${encodeURIComponent(itemId)}`;
      response = await deps.fetchImpl(path, {
        method: played ? 'POST' : 'DELETE',
        headers: {
          ...buildEmbyAuthHeaders(scopedServer),
          'Content-Type': 'application/json',
        },
      });
    } else {
      if (!scopedServer.apiKey) {
        sendResponse({
          success: false,
          error: '请先填写 API Key，或登录媒体服务器用户账号后再写回',
        });
        return;
      }
      if (!scopedServer.userId) {
        sendResponse({
          success: false,
          error: '请在媒体库来源中配置用户名或登录用户账号后再写回观看状态',
        });
        return;
      }
      const userDataUrl = `${base}/Users/${encodeURIComponent(scopedServer.userId)}/Items/${encodeURIComponent(itemId)}/UserData?api_key=${encodeURIComponent(scopedServer.apiKey)}`;
      response = await deps.fetchImpl(userDataUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          Played: played,
          PlaybackPositionTicks: played ? 0 : undefined,
        }),
      });
    }

    if (response.status === 401 || response.status === 403) {
      sendResponse({
        success: false,
        error: hasEmbyUserSession(scopedServer)
          ? '用户令牌无效或权限不足，请重新登录媒体服务器账号'
          : '服务器拒绝写回：请在设置中登录 Emby/Jellyfin 用户账号（仅 ApiKey 通常不能写 UserData）',
      });
      return;
    }
    if (!response.ok) {
      sendResponse({ success: false, error: `写回失败 (${response.status})` });
      return;
    }

    // 同步更新本地索引摘要
    const state = await deps.getState();
    const now = deps.now();
    let updated = false;
    const nextEntries: Record<string, EmbyLibraryIndexEntry[]> = {};
    const evidenceWrites: Promise<void>[] = [];
    for (const [code, entries] of Object.entries(state.entries || {})) {
      nextEntries[code] = entries.map((entry) => {
        const sameItem = entry.itemId === itemId
          && normalizeServerUrl(entry.serverUrl) === serverUrl;
        if (!sameItem) return entry;
        updated = true;
        if (played) {
          const durationSec = ticksToSeconds(entry.userData?.runtimeTicks);
          evidenceWrites.push(saveExternalWatchEvidenceForEntry({
            code,
            entry,
            positionSec: durationSec ?? 0,
            durationSec: durationSec ?? 0,
            percent: 100,
            forceWatched: true,
          }));
        }
        return {
          ...entry,
          userData: {
            played,
            positionTicks: played ? 0 : (entry.userData?.positionTicks || 0),
            runtimeTicks: entry.userData?.runtimeTicks || 0,
            percent: played ? 100 : 0,
            lastPlayedAt: played ? now : (entry.userData?.lastPlayedAt || 0),
          },
          updatedAt: now,
        };
      });
    }

    if (updated) {
      await deps.saveState({
        ...state,
        entries: nextEntries,
        updatedAt: state.updatedAt || now,
      });
    }
    if (evidenceWrites.length > 0) {
      await Promise.all(evidenceWrites);
    }

    sendResponse({
      success: true,
      played,
      itemId,
      localIndexUpdated: updated,
      usedUserSession: hasEmbyUserSession(scopedServer),
    });
  } catch (error) {
    sendResponse({ success: false, error: sanitizeError(error) });
  }
}

/**
 * 列出某服务器上的媒体库文件夹，供设置页多选
 * message: { serverUrl, apiKey?, serverId? }
 */
export async function handleEmbyLibraryListFolders(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const settings = await deps.getSettings();
    const servers = getEnabledServers(settings);
    const serverUrl = normalizeServerUrl(String(message?.serverUrl || ''));
    const apiKeyOverride = String(message?.apiKey || '').trim();

    let server = servers.find((s) => normalizeServerUrl(s.url) === serverUrl)
      || servers.find((s) => s.id === String(message?.serverId || ''));

    // 设置页新建未保存时允许直接传 url+apiKey
    if (!server && serverUrl && apiKeyOverride) {
      server = {
        id: `tmp:${serverUrl}`,
        type: 'emby',
        name: 'tmp',
        url: serverUrl,
        apiKey: apiKeyOverride,
        enabled: true,
        libraryIds: [],
      };
    }

    const target = server
      ? { url: server.url, apiKey: apiKeyOverride || server.apiKey }
      : serverUrl && apiKeyOverride
        ? { url: serverUrl, apiKey: apiKeyOverride }
        : null;

    if (!target) {
      sendResponse({ success: false, error: '缺少服务器地址或 API Key', libraries: [] });
      return;
    }

    const libraries = await fetchServerLibraryFolders(target, deps.fetchImpl);
    sendResponse({ success: true, libraries });
  } catch (error) {
    sendResponse({ success: false, error: sanitizeError(error), libraries: [] });
  }
}

/**
 * 拉取单条影片详情（扩展内详情弹窗，Emby 信息布局数据源）
 * message: { itemId, serverUrl, serverId? }
 */
export async function handleEmbyLibraryGetItemDetail(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const itemId = String(message?.itemId || '').trim();
    const serverUrlRaw = String(message?.serverUrl || '').trim();
    if (!itemId || !serverUrlRaw) {
      sendResponse({ success: false, error: '缺少 itemId 或 serverUrl' });
      return;
    }
    const settings = await deps.getSettings();
    const servers = getEnabledServers(settings);
    const serverUrl = normalizeServerUrl(serverUrlRaw);
    const server = servers.find((s) => normalizeServerUrl(s.url) === serverUrl)
      || servers.find((s) => s.id === String(message?.serverId || ''));
    if (!server) {
      sendResponse({ success: false, error: '未找到匹配的已启用媒体服务器' });
      return;
    }
    const scopedServer = await resolveServerUserScope(server, deps);
    embyLog.info('GET_ITEM_DETAIL', {
      itemId,
      serverUrl: scopedServer.url,
      userId: scopedServer.userId || null,
    });
    const ret = await fetchEmbyItemDetail({
      server: scopedServer,
      itemId,
      fetchImpl: deps.fetchImpl,
    });
    if (!ret.success || !ret.detail) {
      embyLog.warn('GET_ITEM_DETAIL 失败', { itemId, error: ret.error });
      sendResponse({ success: false, error: ret.error || '拉取详情失败' });
      return;
    }
    sendResponse({ success: true, detail: ret.detail });
  } catch (error) {
    embyLog.error('GET_ITEM_DETAIL 异常', { error: sanitizeError(error) });
    sendResponse({ success: false, error: sanitizeError(error) });
  }
}

/**
 * 解析 Emby/JF 扩展内可播直链（用设置里已存的 AccessToken/ApiKey，不依赖浏览器网页登录）
 * message: { itemId, serverUrl, serverId? }
 */
export async function handleEmbyLibraryResolveStream(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const itemId = String(message?.itemId || '').trim();
    const serverUrlRaw = String(message?.serverUrl || '').trim();
    if (!itemId || !serverUrlRaw) {
      sendResponse({ success: false, error: '缺少 itemId 或 serverUrl' });
      return;
    }

    const settings = await deps.getSettings();
    const servers = getEnabledServers(settings);
    const serverUrl = normalizeServerUrl(serverUrlRaw);
    const server = servers.find((s) => normalizeServerUrl(s.url) === serverUrl)
      || servers.find((s) => s.id === String(message?.serverId || ''));

    if (!server) {
      sendResponse({ success: false, error: '未找到匹配的已启用媒体服务器' });
      return;
    }

    const scopedServer = await resolveServerUserScope(server, deps);
    playerLog.info('解析播放流', { itemId, serverUrl: scopedServer.url });
    const resolved = await resolveEmbyStreamUrl({
      server: scopedServer,
      itemId,
      serverId: message?.serverId ? String(message.serverId) : server.id,
      fetchImpl: deps.fetchImpl,
    });

    if (!resolved.success || !resolved.streamUrl) {
      playerLog.warn('解析播放流失败', { itemId, error: resolved.message });
      sendResponse({
        success: false,
        error: resolved.message || '无法解析播放地址',
        detailUrl: resolved.detailUrl,
      });
      return;
    }

    playerLog.info('解析播放流成功', {
      itemId,
      container: resolved.container,
      static: resolved.static,
      streamType: resolved.streamType,
      subtitles: resolved.subtitles?.length || 0,
      qualities: resolved.qualities?.length || 0,
      usedUserSession: hasEmbyUserSession(scopedServer),
    });
    sendResponse({
      success: true,
      streamUrl: resolved.streamUrl,
      streamType: resolved.streamType || 'auto',
      detailUrl: resolved.detailUrl,
      mediaSourceId: resolved.mediaSourceId,
      playSessionId: resolved.playSessionId,
      container: resolved.container,
      static: resolved.static,
      message: resolved.message,
      subtitles: resolved.subtitles || [],
      qualities: resolved.qualities || [],
      usedUserSession: hasEmbyUserSession(scopedServer),
    });
  } catch (error) {
    playerLog.error('解析播放流异常', { error: sanitizeError(error) });
    sendResponse({ success: false, error: sanitizeError(error) });
  }
}

/**
 * 写回播放进度
 * message: { itemId, serverUrl, serverId?, positionSeconds, isCompleted?, mediaSourceId?, playSessionId? }
 */
export async function handleEmbyLibraryReportProgress(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const itemId = String(message?.itemId || '').trim();
    const serverUrlRaw = String(message?.serverUrl || '').trim();
    const positionSeconds = Number(message?.positionSeconds);
    const isCompleted = message?.isCompleted === true;
    if (!itemId || !serverUrlRaw) {
      sendResponse({ success: false, error: '缺少 itemId 或 serverUrl' });
      return;
    }
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
      sendResponse({ success: false, error: 'positionSeconds 无效' });
      return;
    }

    const settings = await deps.getSettings();
    const servers = getEnabledServers(settings);
    const serverUrl = normalizeServerUrl(serverUrlRaw);
    const server = servers.find((s) => normalizeServerUrl(s.url) === serverUrl)
      || servers.find((s) => s.id === String(message?.serverId || ''));
    if (!server) {
      sendResponse({ success: false, error: '未找到匹配的已启用媒体服务器' });
      return;
    }

    const scopedServer = await resolveServerUserScope(server, deps);
    const durationSeconds = Number(message?.durationSeconds);
    const isStopped = message?.isStopped === true || isCompleted;
    const ret = await reportEmbyPlaybackProgress({
      server: scopedServer,
      itemId,
      positionSeconds,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined,
      isCompleted,
      isStopped,
      mediaSourceId: message?.mediaSourceId ? String(message.mediaSourceId) : undefined,
      playSessionId: message?.playSessionId ? String(message.playSessionId) : undefined,
      fetchImpl: deps.fetchImpl,
    });

    // 无论远端是否成功，都尽量写本地索引，保证「继续观看」立刻可见
    const state = await deps.getState();
    const now = deps.now();
    let updated = false;
    const nextEntries: Record<string, EmbyLibraryIndexEntry[]> = {};
    const evidenceWrites: Promise<void>[] = [];
    const positionTicks = ret.positionTicks != null
      ? ret.positionTicks
      : Math.round(Math.max(0, positionSeconds) * TICKS_PER_SECOND);
    const durationTicks = ret.runtimeTicks
      || (Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.round(durationSeconds * TICKS_PER_SECOND)
        : 0);

    for (const [code, entries] of Object.entries(state.entries || {})) {
      nextEntries[code] = entries.map((entry) => {
        const sameItem = entry.itemId === itemId
          && normalizeServerUrl(entry.serverUrl) === serverUrl;
        if (!sameItem) return entry;
        updated = true;
        const runtimeTicks = durationTicks > 0
          ? durationTicks
          : (entry.userData?.runtimeTicks || 0);
        const percent = isCompleted
          ? 100
          : runtimeTicks > 0
            ? Math.min(99, Math.max(1, Math.round((positionTicks / runtimeTicks) * 100)))
            : (positionTicks > 0 ? Math.max(1, entry.userData?.percent || 5) : 0);
        evidenceWrites.push(saveExternalWatchEvidenceForEntry({
          code,
          entry,
          positionSec: isCompleted ? 0 : ticksToSeconds(positionTicks),
          durationSec: ticksToSeconds(runtimeTicks),
          percent,
          forceWatched: isCompleted,
        }));
        return {
          ...entry,
          userData: {
            played: isCompleted ? true : Boolean(entry.userData?.played),
            positionTicks: isCompleted ? 0 : positionTicks,
            runtimeTicks,
            percent,
            lastPlayedAt: now,
          },
          updatedAt: now,
        };
      });
    }
    if (updated) {
      await deps.saveState({
        ...state,
        entries: nextEntries,
        updatedAt: state.updatedAt || now,
      });
    }
    if (evidenceWrites.length > 0) {
      await Promise.all(evidenceWrites);
    }

    if (!ret.success && !updated) {
      playerLog.warn('进度写回失败', { itemId, error: ret.message, method: ret.method });
      sendResponse({ success: false, error: ret.message || '进度写回失败', method: ret.method });
      return;
    }

    if (!ret.success && updated) {
      playerLog.warn('远端进度写回失败，已更新本地续看', {
        itemId,
        error: ret.message,
        method: ret.method,
        positionTicks,
      });
      sendResponse({
        success: true,
        method: 'local_only',
        positionTicks,
        localIndexUpdated: true,
        remoteError: ret.message,
        usedUserSession: hasEmbyUserSession(scopedServer),
      });
      return;
    }

    playerLog.info('进度写回成功', {
      itemId,
      method: ret.method,
      positionTicks,
      isCompleted,
      localIndexUpdated: updated,
    });
    sendResponse({
      success: true,
      method: ret.method,
      positionTicks,
      localIndexUpdated: updated,
      usedUserSession: hasEmbyUserSession(scopedServer),
    });
  } catch (error) {
    playerLog.error('进度写回异常', { error: sanitizeError(error) });
    sendResponse({ success: false, error: sanitizeError(error) });
  }
}

/**
 * 用户登录媒体服务器：AuthenticateByName，返回 token 字段由前端写入 settings
 * message: { serverUrl, username, password, serverId? }
 */
export async function handleEmbyUserLogin(
  message: any,
  sendResponse: SendResponse,
  deps: EmbyLibraryHandlerDeps = defaultDeps(),
): Promise<void> {
  try {
    const serverUrl = normalizeServerUrl(String(message?.serverUrl || ''));
    const username = String(message?.username || '').trim();
    const password = String(message?.password || '');
    if (!serverUrl || !username) {
      sendResponse({ success: false, error: '请填写服务器地址与用户名' });
      return;
    }

    const result = await authenticateEmbyUser({
      url: serverUrl,
      username,
      password,
      fetchImpl: deps.fetchImpl,
    });

    if (!result.success) {
      sendResponse({ success: false, error: result.message || '登录失败' });
      return;
    }

    sendResponse({
      success: true,
      accessToken: result.accessToken,
      userId: result.userId,
      userName: result.userName,
      serverId: result.serverId,
      username,
      tokenObtainedAt: deps.now(),
    });
  } catch (error) {
    sendResponse({ success: false, error: sanitizeError(error) });
  }
}
