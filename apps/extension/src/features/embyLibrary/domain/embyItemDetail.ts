/**
 * @file embyItemDetail.ts
 * @description 将 Emby Item API 映射为扩展内详情视图（含章节 / 相似 / 合集）
 * @module features/embyLibrary
 */
import type {
  EmbyItemChapterView,
  EmbyItemDetailView,
  EmbyMediaItem,
  EmbyMediaServer,
  EmbyMediaStreamLine,
  EmbyRelatedItemView,
  EmbyWatchUserData,
} from '../types';
import { buildMediaItemImageUrl, normalizeServerUrl } from './libraryIndex';
import { parseEmbyUserData } from './watchState';
import { buildEmbyAuthHeaders } from './embyUserAuth';
import { embyLog } from '../mediaLibraryLogger';

const DETAIL_FIELDS = [
  'Overview',
  'Taglines',
  'Genres',
  'Studios',
  'Tags',
  'People',
  'Path',
  'MediaSources',
  'MediaStreams',
  'CommunityRating',
  'CriticRating',
  'OfficialRating',
  'ProductionYear',
  'PremiereDate',
  'RunTimeTicks',
  'UserData',
  'ImageTags',
  'PrimaryImageTag',
  'BackdropImageTags',
  'Chapters',
].join(',');

const RELATED_FIELDS = 'PrimaryImageAspectRatio,Overview,ProductionYear,ImageTags,PrimaryImageTag';

type ServerAuth = Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken' | 'userId' | 'type'>;

/**
 * 从服务器拉取单条影片详情（含章节 + 相似 + 合集，并行）
 */
export async function fetchEmbyItemDetail(params: {
  server: ServerAuth;
  itemId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ success: boolean; detail?: EmbyItemDetailView; error?: string }> {
  const base = normalizeServerUrl(params.server.url);
  const itemId = String(params.itemId || '').trim();
  const fetchImpl = params.fetchImpl || fetch;
  if (!base || !itemId) return { success: false, error: '缺少服务器或 itemId' };

  try {
    const [itemRes, similarRes, collectionsRes] = await Promise.all([
      fetchItemJson(params.server, itemId, fetchImpl),
      fetchSimilarItems(params.server, itemId, fetchImpl),
      fetchCollectionsContainingItem(params.server, itemId, fetchImpl),
    ]);

    if (!itemRes.ok) {
      if (itemRes.status === 401 || itemRes.status === 403) {
        embyLog.warn('详情鉴权失败', { itemId, status: itemRes.status });
        return { success: false, error: '鉴权失败：请重新登录媒体服务器账号' };
      }
      const triedHint = itemRes.tried?.length
        ? ` 已尝试 ${itemRes.tried.length} 条路径`
        : '';
      embyLog.warn('拉取详情失败', {
        itemId,
        status: itemRes.status || 404,
        tried: itemRes.tried,
      });
      return {
        success: false,
        error: `拉取详情失败 (${itemRes.status || 404})${triedHint}`,
      };
    }

    const raw = itemRes.json as EmbyMediaItem;
    if (!raw || !raw.Id) {
      embyLog.warn('详情响应为空', { itemId });
      return { success: false, error: '详情响应为空' };
    }

    const detail = mapEmbyItemToDetailView(params.server, raw, {
      similar: similarRes,
      collections: collectionsRes,
    });
    embyLog.info('详情拉取成功', {
      itemId,
      name: detail.name,
      chapters: detail.chapters?.length || 0,
      similar: detail.similar?.length || 0,
      collections: detail.collections?.length || 0,
    });
    return { success: true, detail };
  } catch (e: any) {
    embyLog.error('拉取详情异常', { itemId, error: e?.message || String(e) });
    return { success: false, error: e?.message || '拉取详情失败' };
  }
}

async function fetchItemJson(
  server: ServerAuth,
  itemId: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; json: unknown; tried: string[] }> {
  const base = normalizeServerUrl(server.url);
  const headers = buildEmbyAuthHeaders(server);
  const tried: string[] = [];
  const userId = String(server.userId || '').trim();

  // Emby 4.9 用户库权限：优先 /Users/{UserId}/Items/{Id}，再回退 /Items/{Id}
  const candidates: string[] = [];
  if (userId) {
    const uq = new URLSearchParams({ Fields: DETAIL_FIELDS });
    appendApiKeyQuery(uq, server);
    candidates.push(`${base}/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}?${uq.toString()}`);
  }
  {
    const qs = new URLSearchParams({ Fields: DETAIL_FIELDS });
    if (userId) qs.set('UserId', userId);
    appendApiKeyQuery(qs, server);
    candidates.push(`${base}/Items/${encodeURIComponent(itemId)}?${qs.toString()}`);
  }
  // 部分网关对单 Id 路径 404：用列表 Ids= 再取
  {
    const qs = new URLSearchParams({
      Ids: itemId,
      Fields: DETAIL_FIELDS,
      Limit: '1',
    });
    if (userId) qs.set('UserId', userId);
    appendApiKeyQuery(qs, server);
    candidates.push(`${base}/Items?${qs.toString()}`);
  }

  let lastStatus = 0;
  let lastJson: unknown = {};
  for (const url of candidates) {
    tried.push(url.replace(/api_key=[^&]+/gi, 'api_key=***'));
    try {
      const res = await fetchImpl(url, { method: 'GET', headers });
      lastStatus = res.status;
      const json = await res.json().catch(() => ({}));
      lastJson = json;
      if (!res.ok) continue;

      // /Items?Ids= 返回 { Items: [...] }
      if (json && typeof json === 'object' && Array.isArray((json as any).Items)) {
        const first = (json as any).Items[0];
        if (first?.Id) return { ok: true, status: res.status, json: first, tried };
        continue;
      }
      if (json && typeof json === 'object' && (json as any).Id) {
        return { ok: true, status: res.status, json, tried };
      }
    } catch {
      // try next
    }
  }
  return { ok: false, status: lastStatus || 404, json: lastJson, tried };
}

/**
 * GET /Items/{Id}/Similar
 */
export async function fetchSimilarItems(
  server: ServerAuth,
  itemId: string,
  fetchImpl: typeof fetch = fetch,
  limit = 24,
): Promise<EmbyRelatedItemView[]> {
  const base = normalizeServerUrl(server.url);
  if (!base || !itemId) return [];
  try {
    const qs = new URLSearchParams({
      Limit: String(limit),
      Fields: RELATED_FIELDS,
    });
    if (server.userId) qs.set('UserId', server.userId);
    appendApiKeyQuery(qs, server);

    const res = await fetchImpl(
      `${base}/Items/${encodeURIComponent(itemId)}/Similar?${qs.toString()}`,
      { method: 'GET', headers: buildEmbyAuthHeaders(server) },
    );
    if (!res.ok) return [];
    const raw = (await res.json().catch(() => ({}))) as any;
    const items: EmbyMediaItem[] = Array.isArray(raw?.Items)
      ? raw.Items
      : Array.isArray(raw)
        ? raw
        : [];
    return items
      .map((it) => mapRelatedItem(server, it))
      .filter((it): it is EmbyRelatedItemView => Boolean(it));
  } catch {
    return [];
  }
}

/**
 * 查询包含该条目的合集（BoxSet）。无 userId 时跳过。
 * GET /Users/{UserId}/Items?Recursive=true&IncludeItemTypes=BoxSet&ListItemIds={itemId}
 */
export async function fetchCollectionsContainingItem(
  server: ServerAuth,
  itemId: string,
  fetchImpl: typeof fetch = fetch,
  limit = 24,
): Promise<EmbyRelatedItemView[]> {
  const base = normalizeServerUrl(server.url);
  const userId = String(server.userId || '').trim();
  if (!base || !itemId || !userId) return [];
  try {
    const qs = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: 'BoxSet',
      ListItemIds: itemId,
      Limit: String(limit),
      Fields: RELATED_FIELDS,
    });
    appendApiKeyQuery(qs, server);

    const res = await fetchImpl(
      `${base}/Users/${encodeURIComponent(userId)}/Items?${qs.toString()}`,
      { method: 'GET', headers: buildEmbyAuthHeaders(server) },
    );
    if (!res.ok) return [];
    const raw = (await res.json().catch(() => ({}))) as any;
    const items: EmbyMediaItem[] = Array.isArray(raw?.Items) ? raw.Items : [];
    return items
      .map((it) => mapRelatedItem(server, it))
      .filter((it): it is EmbyRelatedItemView => Boolean(it));
  } catch {
    return [];
  }
}

function appendApiKeyQuery(qs: URLSearchParams, server: ServerAuth): void {
  if (!server.accessToken && server.apiKey) {
    qs.set('api_key', server.apiKey);
  }
}

function authQueryToken(server: Pick<EmbyMediaServer, 'apiKey' | 'accessToken'>): string {
  return String(server.accessToken || server.apiKey || '').trim();
}

/**
 * 章节缩略图：/Items/{id}/Images/Chapter/{index}?tag=&maxWidth=&mediaSourceId=&api_key=
 */
export function buildChapterImageUrl(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken'>,
  itemId: string,
  chapterIndex: number,
  imageTag?: string,
  mediaSourceId?: string,
  maxWidth = 300,
): string | undefined {
  const base = normalizeServerUrl(server.url);
  const id = String(itemId || '').trim();
  if (!base || !id) return undefined;
  const qs = new URLSearchParams();
  qs.set('maxWidth', String(maxWidth));
  if (imageTag) qs.set('tag', imageTag);
  if (mediaSourceId) qs.set('mediaSourceId', mediaSourceId);
  const token = authQueryToken(server);
  if (token) qs.set('api_key', token);
  return `${base}/Items/${encodeURIComponent(id)}/Images/Chapter/${chapterIndex}?${qs.toString()}`;
}

export function mapChapters(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken'>,
  item: EmbyMediaItem,
): EmbyItemChapterView[] {
  const itemId = String(item.Id || '').trim();
  const mediaSourceId = item.MediaSources?.[0]?.Id
    ? String(item.MediaSources[0].Id)
    : undefined;
  const chapters = Array.isArray(item.Chapters) ? item.Chapters : [];
  return chapters.map((ch, i) => {
    const index = Number.isFinite(Number(ch.ChapterIndex)) ? Number(ch.ChapterIndex) : i;
    const ticks = Number(ch.StartPositionTicks) || 0;
    const name = String(ch.Name || `章节 ${index + 1}`).trim() || `章节 ${index + 1}`;
    const imageTag = ch.ImageTag ? String(ch.ImageTag) : undefined;
    return {
      index,
      name,
      startPositionTicks: ticks,
      startTimeSeconds: ticks > 0 ? ticks / 10_000_000 : 0,
      imageUrl: imageTag
        ? buildChapterImageUrl(server, itemId, index, imageTag, mediaSourceId)
        : undefined,
    };
  });
}

export function mapMediaStreams(item: EmbyMediaItem): EmbyMediaStreamLine[] {
  const ms0 = Array.isArray(item.MediaSources) ? item.MediaSources[0] : undefined;
  const streams = ms0?.MediaStreams || [];
  return streams
    .map((s) => {
      const type = String(s.Type || 'Unknown');
      const title = [
        s.DisplayTitle,
        s.Codec,
        s.Language,
        s.Width && s.Height ? `${s.Width}x${s.Height}` : '',
        s.Channels ? `${s.Channels}ch` : '',
        s.BitRate ? `${Math.round(Number(s.BitRate) / 1000)}kbps` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return { type, title: title || type };
    })
    .filter((s) => s.title);
}

function mapRelatedItem(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken' | 'type'>,
  item: EmbyMediaItem,
): EmbyRelatedItemView | null {
  const itemId = String(item.Id || '').trim();
  if (!itemId) return null;
  return {
    itemId,
    name: String(item.Name || itemId),
    year: Number(item.ProductionYear) || undefined,
    overview: item.Overview ? String(item.Overview) : undefined,
    primaryImageUrl: buildMediaItemImageUrl(server, item, 'Primary', {
      maxHeight: 360,
      maxWidth: 240,
    }),
    type: item.Type ? String(item.Type) : undefined,
  };
}

export function mapEmbyItemToDetailView(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken' | 'type'>,
  item: EmbyMediaItem,
  extras?: {
    similar?: EmbyRelatedItemView[];
    collections?: EmbyRelatedItemView[];
  },
): EmbyItemDetailView {
  const itemId = String(item.Id || '').trim();
  const runtimeTicks = Number(item.RunTimeTicks) || 0;
  let userData: EmbyWatchUserData | undefined;
  try {
    userData = parseEmbyUserData(item.UserData as any, runtimeTicks) || undefined;
  } catch {
    userData = undefined;
  }

  const primaryImageUrl = buildMediaItemImageUrl(server, item, 'Primary', {
    maxHeight: 720,
    maxWidth: 480,
  });
  const backdropImageUrl = buildMediaItemImageUrl(server, item, 'Backdrop', {
    maxHeight: 720,
    maxWidth: 1280,
  });

  const people = (item.People || [])
    .map((p) => ({
      id: p.Id ? String(p.Id) : undefined,
      name: String(p.Name || '').trim(),
      role: p.Role ? String(p.Role) : undefined,
      type: p.Type ? String(p.Type) : undefined,
      imageUrl: p.Id
        ? buildMediaItemImageUrl(
            server,
            { Id: String(p.Id), PrimaryImageTag: p.PrimaryImageTag },
            'Primary',
            { maxHeight: 240, maxWidth: 160, quality: 90 },
          )
        : undefined,
    }))
    .filter((p) => p.name);

  const ms0 = Array.isArray(item.MediaSources) ? item.MediaSources[0] : undefined;
  const streams = ms0?.MediaStreams || [];
  const video = streams.find((s) => String(s.Type || '').toLowerCase() === 'video');
  const audio = streams.find((s) => String(s.Type || '').toLowerCase() === 'audio');
  const videoSummary = video
    ? [video.DisplayTitle, video.Codec, video.Width && video.Height ? `${video.Width}x${video.Height}` : '']
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const audioSummary = audio
    ? [audio.DisplayTitle || audio.Language, audio.Codec, audio.Channels ? `${audio.Channels}ch` : '']
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return {
    itemId,
    serverUrl: normalizeServerUrl(server.url),
    serverType: server.type === 'jellyfin' ? 'jellyfin' : 'emby',
    serverId: item.ServerId ? String(item.ServerId) : undefined,
    name: String(item.Name || itemId),
    overview: item.Overview ? String(item.Overview) : undefined,
    tagline: Array.isArray(item.Taglines) && item.Taglines[0] ? String(item.Taglines[0]) : undefined,
    year: Number(item.ProductionYear) || undefined,
    premiereDate: item.PremiereDate ? String(item.PremiereDate) : undefined,
    runtimeTicks,
    communityRating: Number(item.CommunityRating) || undefined,
    criticRating: Number(item.CriticRating) || undefined,
    officialRating: item.OfficialRating ? String(item.OfficialRating) : undefined,
    genres: Array.isArray(item.Genres) ? item.Genres.map(String).filter(Boolean) : [],
    studios: Array.isArray(item.Studios)
      ? item.Studios.map((s) => String(s?.Name || '')).filter(Boolean)
      : [],
    tags: Array.isArray(item.Tags) ? item.Tags.map(String).filter(Boolean) : [],
    people,
    primaryImageUrl,
    backdropImageUrl,
    path: item.Path ? String(item.Path) : undefined,
    container: ms0?.Container ? String(ms0.Container) : undefined,
    sizeBytes: Number(ms0?.Size) || undefined,
    mediaSourceId: ms0?.Id ? String(ms0.Id) : undefined,
    videoSummary,
    audioSummary,
    mediaStreams: mapMediaStreams(item),
    chapters: mapChapters(server, item),
    similar: extras?.similar || [],
    collections: extras?.collections || [],
    userData,
  };
}

export function formatRuntime(ticks?: number): string {
  const t = Number(ticks) || 0;
  if (t <= 0) return '';
  const totalSec = Math.floor(t / 10_000_000);
  const m = Math.floor(totalSec / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} 小时 ${mm} 分钟` : `${h} 小时`;
}

export function formatBytes(n?: number): string {
  const v = Number(n) || 0;
  if (v <= 0) return '';
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** ticks → 可读时间码 1:23:45 */
export function formatChapterTime(ticksOrSeconds: number, asSeconds = false): string {
  const totalSec = Math.floor(asSeconds ? ticksOrSeconds : ticksOrSeconds / 10_000_000);
  if (!Number.isFinite(totalSec) || totalSec < 0) return '0:00';
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
