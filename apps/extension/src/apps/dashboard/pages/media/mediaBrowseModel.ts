/**
 * @file mediaBrowseModel.ts
 * @description 媒体库浏览页的目录模型、筛选与轮播位置计算
 * @module apps/dashboard/pages/media
 */
import type { EmbyWatchUserData } from '../../../../features/embyLibrary/types';
import type { MediaWatchState } from '../../../../features/embyLibrary/domain/watchState';
import type { ParsedNfoSummary as Drive115ParsedNfoSummary } from '../../../../features/drive115/mediaLibrary/parseEntryMeta';

export type MediaBrowseSource = 'all' | 'emby' | 'jellyfin' | '115';

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
  { id: 'thumb', label: '略缩图', hint: '横版 Thumb · 完整显示不裁切' },
  { id: 'poster', label: '海报', hint: '竖版 Primary · 完整显示不裁切' },
  { id: 'backdrop', label: '背景图', hint: '横版 Backdrop · 铺满裁边' },
];

export type MediaBrowseItem = {
  code: string;
  title: string;
  source: Exclude<MediaBrowseSource, 'all'>;
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
};

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

  // thumb（略缩图）：必须优先真 Thumb，禁止默默用 Primary 冒充
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

export function filterMediaItems(
  items: MediaBrowseItem[],
  filter: MediaBrowseSource,
  query: string,
  watchFilter: MediaWatchFilter = 'all',
): MediaBrowseItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter !== 'all' && item.source !== filter) return false;
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
  });
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

export function subPathToFilter(subPath?: string): MediaBrowseSource {
  if (subPath === 'emby') return 'emby';
  if (subPath === 'jellyfin') return 'jellyfin';
  if (subPath === '115') return '115';
  return 'all';
}

const COVER_VIEW_STORAGE_KEY = 'ml_cover_view_mode';

export function readCoverViewMode(): MediaCoverViewMode {
  try {
    const v = localStorage.getItem(COVER_VIEW_STORAGE_KEY);
    if (v === 'poster' || v === 'thumb' || v === 'backdrop') return v;
  } catch { /* ignore */ }
  return 'thumb';
}

export function writeCoverViewMode(mode: MediaCoverViewMode): void {
  try {
    localStorage.setItem(COVER_VIEW_STORAGE_KEY, mode);
  } catch { /* ignore */ }
}

