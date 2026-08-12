/**
 * @file mediaBrowseModel.ts
 * @description 媒体库浏览页的目录模型、筛选与轮播位置计算
 * @module apps/dashboard/pages/media
 */
import type { EmbyWatchUserData } from '../../../../features/embyLibrary/types';
import type { MediaWatchState } from '../../../../features/embyLibrary/domain/watchState';
import type { ParsedNfoSummary as Drive115ParsedNfoSummary } from '../../../../features/drive115/mediaLibrary/parseEntryMeta';

export type MediaItemSource = 'emby' | 'jellyfin' | '115';
export type MediaBrowseSource = 'all' | MediaItemSource | `server:${string}`;

export type MediaSourceChannel = {
  id: Exclude<MediaBrowseSource, 'all'>;
  label: string;
  source: MediaItemSource;
  serverUrl?: string;
};

export type MediaSyncTarget = {
  key: string;
  kind: 'media-server' | 'drive115-root';
  source: MediaItemSource;
  id: string;
  label: string;
  detail: string;
};

type MediaSourceSettings = {
  emby?: {
    enabled?: unknown;
    mediaServers?: unknown;
  };
  drive115?: {
    enabled?: unknown;
    mediaLibraryRoots?: unknown;
  };
};

/** 真实观看筛选（与来源筛选叠加） */
export type MediaWatchFilter = 'all' | 'in_progress' | 'watched' | 'not_watched';

/**
 * 封面视图模式（对应 Emby 图片类型）
 * - thumb: Thumb 横版框 16:9，object-fit:contain 完整显示（默认）
 * - poster: Primary 竖版框 2:3，object-fit:contain 完整显示
 * - backdrop: Backdrop 横版框 16:9，object-fit:cover 铺满（背景氛围）
 */
export type MediaCoverViewMode = 'poster' | 'thumb' | 'backdrop';

export const MEDIA_COVER_VIEW_MODES: { id: MediaCoverViewMode; label: string; hint: string }[] = [
  { id: 'thumb', label: '缩略图', hint: '横版 Thumb · 完整显示不裁切' },
  { id: 'poster', label: '海报', hint: '竖版 Primary · 完整显示不裁切' },
  { id: 'backdrop', label: '背景图', hint: '横版 Backdrop · 铺满裁边' },
];

export type MediaCardSize = 'small' | 'normal' | 'large' | 'xlarge';

export const MEDIA_CARD_SIZE_OPTIONS: { id: MediaCardSize; label: string }[] = [
  { id: 'small', label: '小' },
  { id: 'normal', label: '中' },
  { id: 'large', label: '大' },
  { id: 'xlarge', label: '超大' },
];

export type MediaViewField =
  | 'title'
  | 'fileName'
  | 'rating'
  | 'criticRating'
  | 'year'
  | 'runtime'
  | 'genres'
  | 'director'
  | 'tags'
  | 'studio';

export const DEFAULT_MEDIA_VIEW_FIELDS: { id: MediaViewField; label: string }[] = [
  { id: 'title', label: '标题' },
  { id: 'fileName', label: '文件名' },
  { id: 'rating', label: '评分' },
  { id: 'criticRating', label: '影评人评分' },
  { id: 'year', label: '年份' },
  { id: 'runtime', label: '时长' },
  { id: 'genres', label: '类型' },
  { id: 'director', label: '导演' },
  { id: 'tags', label: '标签' },
  { id: 'studio', label: '片商' },
];

export type MediaViewSettings = {
  coverView: MediaCoverViewMode;
  cardSize: MediaCardSize;
  visibleFields: Record<MediaViewField, boolean>;
};

export const DEFAULT_MEDIA_VIEW_SETTINGS: MediaViewSettings = {
  coverView: 'thumb',
  cardSize: 'normal',
  visibleFields: {
    title: true,
    fileName: false,
    rating: true,
    criticRating: true,
    year: true,
    runtime: true,
    genres: true,
    director: false,
    tags: true,
    studio: true,
  },
};

export type MediaBrowseItem = {
  code: string;
  title: string;
  source: MediaItemSource;
  year: string;
  hue: number;
  coverImageUrl?: string;
  imageUrls?: Partial<Record<'Primary' | 'Thumb' | 'Backdrop' | 'Logo' | 'Banner', string>>;
  serverName?: string;
  itemId?: string;
  serverUrl?: string;
  serverId?: string;
  userData?: EmbyWatchUserData;
  watchState?: MediaWatchState;
  /** 115 索引：pick_code，点播优先用 */
  pickCode?: string;
  /** 115 索引：文件名 */
  fileName?: string;
  /** 115 索引：文件夹路径/名 */
  folderPath?: string;
  /** 115 索引：条目稳定 key，供懒解析 NFO 定位 */
  libraryKey?: string;
  /** 115 索引：封面文件 pick_code，供按需取封面直链 */
  coverPickCode?: string;
  /** 115 索引：NFO 解析摘要（标题/简介/年份 + JAV 富字段），懒加载填充 */
  nfoSummary?: Drive115ParsedNfoSummary;
  /** 同一影片当前可用的全部物理来源副本。 */
  copies?: MediaSourceCopy[];
};

export type MediaSourceCopy = {
  copyId: string;
  source: MediaItemSource;
  serverName?: string;
  serverUrl?: string;
  serverId?: string;
  itemId?: string;
  fileId?: string;
  pickCode?: string;
  fileName?: string;
  folderPath?: string;
  libraryKey?: string;
  coverImageUrl?: string;
  imageUrls?: MediaBrowseItem['imageUrls'];
  coverPickCode?: string;
  nfoSummary?: Drive115ParsedNfoSummary;
  userData?: EmbyWatchUserData;
  watchState?: MediaWatchState;
};

export type MediaSourceCopyPlaybackStatus = {
  playable: boolean;
  reason?: string;
};

export type MediaPlaybackChoice = {
  kind: 'unavailable' | 'direct' | 'choose';
  items: MediaBrowseItem[];
};

export function mediaCopyToBrowseItem(title: MediaBrowseItem, copy: MediaSourceCopy): MediaBrowseItem {
  return {
    ...title,
    source: copy.source,
    serverName: copy.serverName,
    serverUrl: copy.serverUrl,
    serverId: copy.serverId,
    itemId: copy.itemId || copy.fileId,
    pickCode: copy.pickCode,
    fileName: copy.fileName,
    folderPath: copy.folderPath,
    libraryKey: copy.libraryKey,
    coverImageUrl: copy.coverImageUrl || title.coverImageUrl,
    imageUrls: copy.imageUrls || title.imageUrls,
    coverPickCode: copy.coverPickCode,
    nfoSummary: copy.nfoSummary || title.nfoSummary,
    userData: copy.userData,
    watchState: copy.watchState,
    copies: [copy],
  };
}

function fallbackMediaSourceCopy(item: MediaBrowseItem): MediaSourceCopy {
  const serverUrl = normalizeMediaServerUrl(item.serverUrl);
  return {
    copyId: item.source === '115'
      ? `115:${item.itemId || item.pickCode || item.code}`
      : `${item.source}:${serverUrl}:${item.itemId || item.code}`,
    source: item.source,
    serverName: item.serverName,
    serverUrl: item.serverUrl,
    serverId: item.serverId,
    itemId: item.itemId,
    fileId: item.source === '115' ? item.itemId : undefined,
    pickCode: item.pickCode,
    fileName: item.fileName,
    folderPath: item.folderPath,
    libraryKey: item.libraryKey,
    coverImageUrl: item.coverImageUrl,
    imageUrls: item.imageUrls,
    coverPickCode: item.coverPickCode,
    nfoSummary: item.nfoSummary,
    userData: item.userData,
    watchState: item.watchState,
  };
}

export function getMediaSourceCopies(item: MediaBrowseItem): MediaSourceCopy[] {
  return item.copies?.length ? item.copies : [fallbackMediaSourceCopy(item)];
}

export function formatMediaSourceCopyLabel(copy: MediaSourceCopy | null | undefined): string {
  if (!copy) return '来源信息不可用';
  const label = sourceLabel(copy.source);
  const name = String(copy.serverName || '').trim();
  return name ? `${label} · ${name}` : label;
}

export function getMediaSourceLabels(item: MediaBrowseItem): string[] {
  return Array.from(new Set(getMediaSourceCopies(item).map(formatMediaSourceCopyLabel)));
}

/** 聚合影片详情优先走已配置的 Emby/Jellyfin，115 NFO 仅作为无服务器详情时的回退。 */
export function getPreferredDetailSourceCopy(item: MediaBrowseItem): MediaSourceCopy | null {
  return getMediaSourceCopies(item).find((copy) => (
    (copy.source === 'emby' || copy.source === 'jellyfin')
    && Boolean(copy.itemId && copy.serverUrl)
  )) || null;
}

export function getMediaSourceCopyPlaybackStatus(
  copy: MediaSourceCopy | null | undefined,
): MediaSourceCopyPlaybackStatus {
  if (!copy) return { playable: false, reason: '来源信息不可用' };
  if (copy.source === '115') {
    return copy.pickCode
      ? { playable: true }
      : { playable: false, reason: '115 索引缺少播放标识' };
  }
  if (!copy.serverUrl) return { playable: false, reason: '媒体服务器地址未配置' };
  if (!copy.itemId) return { playable: false, reason: '媒体条目尚未同步完成' };
  return { playable: true };
}

export function resolvePlaybackChoice(item: MediaBrowseItem): MediaPlaybackChoice {
  const copies = getMediaSourceCopies(item);
  const items = copies.map((copy) => mediaCopyToBrowseItem(item, copy));
  const playableCount = copies.filter((copy) => getMediaSourceCopyPlaybackStatus(copy).playable).length;
  return {
    kind: playableCount === 0 ? 'unavailable' : copies.length === 1 ? 'direct' : 'choose',
    items,
  };
}

export const MEDIA_PREVIEW_ITEMS: MediaBrowseItem[] = [
  { code: 'SSIS-458', title: '恋人未满的同居生活', source: 'emby', year: '2022', hue: 330 },
  { code: 'STARS-712', title: '第一次的温泉旅行', source: 'jellyfin', year: '2023', hue: 200 },
  { code: 'MIDV-401', title: '雨夜之后', source: 'emby', year: '2023', hue: 255 },
  { code: 'PRED-512', title: '都市夜行', source: 'jellyfin', year: '2024', hue: 170 },
  { code: 'IPX-987', title: '白衬衫与星期一', source: 'emby', year: '2021', hue: 20 },
  { code: 'CAWD-558', title: '海边的旧相机', source: '115', year: '2022', hue: 190 },
  { code: 'JUL-998', title: '隔壁的灯还亮着', source: 'emby', year: '2020', hue: 280 },
  { code: 'ABW-340', title: '夜间便利店', source: 'jellyfin', year: '2023', hue: 40 },
  { code: 'FSDSS-620', title: '玻璃温室', source: 'emby', year: '2024', hue: 145 },
  { code: 'ADN-480', title: '未寄出的信', source: 'jellyfin', year: '2022', hue: 300 },
  { code: 'HMN-445', title: '地铁末班车', source: '115', year: '2021', hue: 220 },
  { code: 'SSIS-790', title: '蓝色窗帘', source: 'emby', year: '2023', hue: 210 },
];

export function coverGradient(item: MediaBrowseItem): string {
  const h = item.hue;
  return `linear-gradient(125deg, hsl(${h} 48% 48%), hsl(${(h + 36) % 360} 42% 28%) 50%, hsl(${(h + 18) % 360} 28% 14%))`;
}

export type ResolvedCoverImage = {
  url?: string;
  /** 实际用到的 Emby 图类型（回退后可能与 mode 不一致） */
  usedType?: 'Primary' | 'Thumb' | 'Backdrop' | 'cover';
  /** 是否因缺图回退到了其它类型 */
  fellBack: boolean;
  /** img 加载失败时的次选 URL */
  fallbackUrl?: string;
};

/**
 * 按封面模式解析 URL。
 * - poster → Primary
 * - thumb → Thumb（无则 Backdrop，再无才 Primary，并标记 fellBack）
 * - backdrop → Backdrop（无则 Thumb → Primary）
 */
export function resolveCoverImage(
  item: MediaBrowseItem,
  mode: MediaCoverViewMode = 'thumb',
): ResolvedCoverImage {
  const map = item.imageUrls || {};
  const primary = map.Primary || item.coverImageUrl;
  const thumb = map.Thumb;
  const backdrop = map.Backdrop;

  if (mode === 'poster') {
    const url = primary || thumb || backdrop;
    const usedType: ResolvedCoverImage['usedType'] = primary
      ? 'Primary'
      : thumb
        ? 'Thumb'
        : backdrop
          ? 'Backdrop'
          : undefined;
    return {
      url,
      usedType,
      fellBack: Boolean(url && !primary),
      fallbackUrl: primary && url !== primary ? primary : thumb || backdrop,
    };
  }

  if (mode === 'backdrop') {
    const url = backdrop || thumb || primary;
    const usedType: ResolvedCoverImage['usedType'] = backdrop
      ? 'Backdrop'
      : thumb
        ? 'Thumb'
        : primary
          ? 'Primary'
          : undefined;
    return {
      url,
      usedType,
      fellBack: Boolean(url && !backdrop),
      fallbackUrl: backdrop && url !== backdrop ? backdrop : thumb || primary,
    };
  }

  // thumb（缩略图）：必须优先真 Thumb，禁止默默用 Primary 冒充
  if (thumb) {
    return {
      url: thumb,
      usedType: 'Thumb',
      fellBack: false,
      fallbackUrl: backdrop || primary,
    };
  }
  if (backdrop) {
    return {
      url: backdrop,
      usedType: 'Backdrop',
      fellBack: true,
      fallbackUrl: primary,
    };
  }
  if (primary) {
    return {
      url: primary,
      usedType: 'Primary',
      fellBack: true,
      fallbackUrl: undefined,
    };
  }
  return { fellBack: false };
}

/** @deprecated 优先用 resolveCoverImage；保留给兼容调用 */
export function resolveCoverImageUrl(
  item: MediaBrowseItem,
  mode: MediaCoverViewMode = 'thumb',
): string | undefined {
  return resolveCoverImage(item, mode).url;
}

export function coverArtStyle(
  item: MediaBrowseItem,
  mode: MediaCoverViewMode = 'thumb',
): { backgroundImage?: string; background: string } {
  const url = resolveCoverImage(item, mode).url;
  if (url) {
    const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      backgroundImage: `url("${safeUrl}")`,
      background: `${coverGradient(item)}`,
    };
  }
  return { background: coverGradient(item) };
}

export function sourceLabel(source: MediaBrowseItem['source']): string {
  if (source === 'emby') return 'Emby';
  if (source === 'jellyfin') return 'Jellyfin';
  return '115';
}

export function normalizeMediaServerUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}`;
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

export function buildMediaSyncTargets(settings: unknown): MediaSyncTarget[] {
  const input = isRecord(settings) ? settings as MediaSourceSettings : {};
  const targets: MediaSyncTarget[] = [];
  const emby = isRecord(input.emby) ? input.emby : undefined;
  const servers = Array.isArray(emby?.mediaServers) ? emby.mediaServers : [];

  for (const [index, value] of servers.entries()) {
    if (!isRecord(value) || value.enabled === false) continue;
    const source: Extract<MediaItemSource, 'emby' | 'jellyfin'> =
      value.type === 'jellyfin' ? 'jellyfin' : 'emby';
    const url = normalizeMediaServerUrl(value.url);
    const token = String(value.apiKey || value.accessToken || '').trim();
    if (!url || !token) continue;
    const id = String(value.id || `${source}:${url || value.name || index}`).trim();
    if (!id || targets.some((target) => target.key === `server:${id}`)) continue;
    const name = String(value.name || '').trim() || (source === 'jellyfin' ? 'Jellyfin' : 'Emby');
    targets.push({
      key: `server:${id}`,
      kind: 'media-server',
      source,
      id,
      label: `${source === 'jellyfin' ? 'Jellyfin' : 'Emby'} · ${name}`,
      detail: url,
    });
  }

  const drive115 = isRecord(input.drive115) ? input.drive115 : undefined;
  const roots = Array.isArray(drive115?.mediaLibraryRoots) ? drive115.mediaLibraryRoots : [];
  if (drive115?.enabled === true) {
    for (const value of roots) {
      if (!isRecord(value) || value.enabled === false) continue;
      const id = String(value.cid || '').trim();
      if (!id || targets.some((target) => target.key === `drive115:${id}`)) continue;
      const name = String(value.name || value.path || '').trim() || '片库目录';
      targets.push({
        key: `drive115:${id}`,
        kind: 'drive115-root',
        source: '115',
        id,
        label: `115 · ${name}`,
        detail: String(value.path || value.name || id).trim(),
      });
    }
  }

  return targets;
}

export function partitionMediaSyncTargets(
  targets: MediaSyncTarget[],
  selectedKeys: ReadonlySet<string>,
): { serverIds: string[]; rootCids: string[] } {
  const selected = targets.filter((target) => selectedKeys.has(target.key));
  return {
    serverIds: selected.filter((target) => target.kind === 'media-server').map((target) => target.id),
    rootCids: selected.filter((target) => target.kind === 'drive115-root').map((target) => target.id),
  };
}

export function buildMediaSourceChannels(settings: unknown): MediaSourceChannel[] {
  const input = isRecord(settings) ? settings as MediaSourceSettings : {};
  const channels: MediaSourceChannel[] = [];
  const emby = isRecord(input.emby) ? input.emby : undefined;

  if (emby?.enabled === true && Array.isArray(emby.mediaServers)) {
    for (const value of emby.mediaServers) {
      if (!isRecord(value) || value.enabled === false) continue;
      const serverUrl = normalizeMediaServerUrl(value.url);
      if (!serverUrl) continue;
      const source: Extract<MediaItemSource, 'emby' | 'jellyfin'> =
        value.type === 'jellyfin' ? 'jellyfin' : 'emby';
      const name = String(value.name || '').trim() || (source === 'jellyfin' ? 'Jellyfin' : 'Emby');
      const id = `server:${source}:${encodeURIComponent(serverUrl)}` as const;
      if (channels.some((channel) => channel.id === id)) continue;
      channels.push({
        id,
        label: `${source === 'jellyfin' ? 'Jellyfin' : 'Emby'} · ${name}`,
        source,
        serverUrl,
      });
    }
  }

  const drive115 = isRecord(input.drive115) ? input.drive115 : undefined;
  const roots = Array.isArray(drive115?.mediaLibraryRoots) ? drive115.mediaLibraryRoots : [];
  const hasEnabledRoot = roots.some((root) => isRecord(root) && root.enabled !== false);
  if (drive115?.enabled === true && hasEnabledRoot) {
    channels.push({ id: '115', label: '115 片库', source: '115' });
  }

  return channels;
}

export function createMediaItemMatcher(
  filter: MediaBrowseSource,
  query: string,
  watchFilter: MediaWatchFilter = 'all',
  channels: MediaSourceChannel[] = [],
): (item: MediaBrowseItem) => boolean {
  const q = query.trim().toLowerCase();
  const channel = filter !== 'all'
    ? channels.find((candidate) => candidate.id === filter)
    : undefined;

  return (item) => {
    if (filter !== 'all') {
      if (channel?.serverUrl) {
        const channelMatches = item.copies?.some((copy) => (
          copy.source === channel.source
          && normalizeMediaServerUrl(copy.serverUrl) === channel.serverUrl
        )) || (
          item.source === channel.source
          && normalizeMediaServerUrl(item.serverUrl) === channel.serverUrl
        );
        if (!channelMatches) return false;
      } else {
        const sourceMatches = item.copies?.some((copy) => copy.source === filter) || item.source === filter;
        if (filter.startsWith('server:') || !sourceMatches) return false;
      }
    }
    if (watchFilter !== 'all') {
      const ws = item.watchState || 'none';
      if (watchFilter === 'watched' && ws !== 'watched') return false;
      if (watchFilter === 'in_progress' && ws !== 'in_progress') return false;
      if (watchFilter === 'not_watched' && (ws === 'watched' || ws === 'in_progress')) return false;
    }
    if (!q) return true;
    return (
      item.code.toLowerCase().includes(q)
      || item.title.toLowerCase().includes(q)
      || (item.serverName || '').toLowerCase().includes(q)
    );
  };
}

export function filterMediaItems(
  items: MediaBrowseItem[],
  filter: MediaBrowseSource,
  query: string,
  watchFilter: MediaWatchFilter = 'all',
  channels: MediaSourceChannel[] = [],
): MediaBrowseItem[] {
  return items.filter(createMediaItemMatcher(filter, query, watchFilter, channels));
}

export function resumeMediaItems(items: MediaBrowseItem[], limit = 12): MediaBrowseItem[] {
  return items
    .filter((item) => item.watchState === 'in_progress' || (item.userData && item.userData.percent > 0 && item.watchState !== 'watched'))
    .sort((a, b) => (b.userData?.lastPlayedAt || 0) - (a.userData?.lastPlayedAt || 0))
    .slice(0, limit);
}

export function relativeCarouselPos(index: number, active: number, len: number): number {
  if (len <= 0) return 0;
  let d = index - active;
  if (d > len / 2) d -= len;
  if (d < -len / 2) d += len;
  return d;
}

/** 推荐轮播：随机候选池上限 */
export const MEDIA_HERO_CANDIDATE_LIMIT = 15;
/** 推荐轮播：实际滚动展示数量（圆点 / 自动轮播长度） */
export const MEDIA_HERO_LIMIT = 7;
/**
 * 堆叠可视半径：中心 ±N，共 2N+1 张同时露出。
 * N=3 → 同时露出 7 张，与 MEDIA_HERO_LIMIT 对齐。
 */
export const MEDIA_HERO_VISIBLE_RADIUS = 3;

/**
 * 从目录随机抽取轮播条目：先打乱后取候选池（默认 15），再截为滚动条（默认 7）。
 * 堆叠可视位 data-pos=±MEDIA_HERO_VISIBLE_RADIUS（默认同时露出 7 张）。
 * @param random 可注入 [0,1) 随机源，便于单测
 */
export function heroItems(
  items: MediaBrowseItem[],
  options?: {
    limit?: number;
    candidateLimit?: number;
    random?: () => number;
  },
): MediaBrowseItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const limit = Math.max(0, options?.limit ?? MEDIA_HERO_LIMIT);
  const candidateLimit = Math.max(
    limit,
    options?.candidateLimit ?? MEDIA_HERO_CANDIDATE_LIMIT,
  );
  const random = options?.random ?? Math.random;
  if (limit === 0) return [];

  const pool = items.slice();
  // 部分 Fisher–Yates：只保证前 candidateLimit 位置均匀随机
  const n = pool.length;
  const top = Math.min(candidateLimit, n);
  for (let i = 0; i < top; i += 1) {
    const j = i + Math.floor(random() * (n - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(limit, top));
}

export function subPathToFilter(
  subPath?: string,
  channels?: MediaSourceChannel[],
): MediaBrowseSource {
  if (subPath === 'emby' || subPath === 'jellyfin') {
    if (!channels) return subPath;
    return channels.find((channel) => channel.source === subPath)?.id || 'all';
  }
  if (subPath === '115') {
    if (!channels) return '115';
    return channels.find((channel) => channel.source === '115')?.id || 'all';
  }
  return 'all';
}

export type CarouselWindowEntry = {
  virtualIndex: number;
  itemIndex: number;
  position: number;
  cycle: number;
};

function positiveModulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

export function buildCarouselWindow(
  step: number,
  length: number,
  radius: number,
): CarouselWindowEntry[] {
  if (length <= 0 || radius < 0) return [];
  const center = Math.trunc(step);
  const safeRadius = Math.trunc(radius);
  const out: CarouselWindowEntry[] = [];
  for (let position = -safeRadius; position <= safeRadius; position += 1) {
    const virtualIndex = center + position;
    out.push({
      virtualIndex,
      itemIndex: positiveModulo(virtualIndex, length),
      position,
      cycle: Math.floor(virtualIndex / length),
    });
  }
  return out;
}

export function resolveCarouselDotStep(
  step: number,
  targetIndex: number,
  length: number,
): number {
  if (length <= 0) return 0;
  const currentIndex = positiveModulo(step, length);
  const target = positiveModulo(targetIndex, length);
  let delta = target - currentIndex;
  if (delta > length / 2) delta -= length;
  if (delta < -length / 2) delta += length;
  return step + delta;
}

const COVER_VIEW_STORAGE_KEY = 'ml_cover_view_mode';
const MEDIA_VIEW_SETTINGS_STORAGE_KEY = 'ml_media_view_settings';

export function readCoverViewMode(): MediaCoverViewMode {
  try {
    const mediaSettings = readMediaViewSettings();
    if (mediaSettings.coverView) return mediaSettings.coverView;
    const v = localStorage.getItem(COVER_VIEW_STORAGE_KEY);
    if (v === 'poster' || v === 'thumb' || v === 'backdrop') return v;
  } catch { /* ignore */ }
  return 'thumb';
}

export function writeCoverViewMode(mode: MediaCoverViewMode): void {
  try {
    localStorage.setItem(COVER_VIEW_STORAGE_KEY, mode);
    const settings = readMediaViewSettings();
    writeMediaViewSettings({ ...settings, coverView: mode });
  } catch { /* ignore */ }
}

export function readMediaViewSettings(): MediaViewSettings {
  try {
    const raw = localStorage.getItem(MEDIA_VIEW_SETTINGS_STORAGE_KEY);
    const legacyCover = localStorage.getItem(COVER_VIEW_STORAGE_KEY);
    if (!raw) {
      return normalizeMediaViewSettings({ coverView: legacyCover });
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeMediaViewSettings(parsed);
  } catch {
    return DEFAULT_MEDIA_VIEW_SETTINGS;
  }
}

export function writeMediaViewSettings(settings: MediaViewSettings): void {
  try {
    const normalized = normalizeMediaViewSettings(settings);
    localStorage.setItem(MEDIA_VIEW_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    localStorage.setItem(COVER_VIEW_STORAGE_KEY, normalized.coverView);
  } catch { /* ignore */ }
}

function normalizeMediaViewSettings(value: unknown): MediaViewSettings {
  const input = isRecord(value) ? value : {};
  const visibleInput = isRecord(input.visibleFields) ? input.visibleFields : {};
  const visibleFields = DEFAULT_MEDIA_VIEW_FIELDS.reduce<Record<MediaViewField, boolean>>(
    (acc, field) => {
      const raw = visibleInput[field.id];
      acc[field.id] = typeof raw === 'boolean'
        ? raw
        : DEFAULT_MEDIA_VIEW_SETTINGS.visibleFields[field.id];
      return acc;
    },
    { ...DEFAULT_MEDIA_VIEW_SETTINGS.visibleFields },
  );
  return {
    coverView: normalizeCoverView(input.coverView),
    cardSize: normalizeCardSize(input.cardSize),
    visibleFields,
  };
}

function normalizeCoverView(value: unknown): MediaCoverViewMode {
  return value === 'poster' || value === 'thumb' || value === 'backdrop'
    ? value
    : DEFAULT_MEDIA_VIEW_SETTINGS.coverView;
}

function normalizeCardSize(value: unknown): MediaCardSize {
  return value === 'small' || value === 'normal' || value === 'large' || value === 'xlarge'
    ? value
    : DEFAULT_MEDIA_VIEW_SETTINGS.cardSize;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

