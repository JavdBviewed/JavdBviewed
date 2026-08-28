/**
 * @file libraryIndex.ts
 * @description libraryIndex
 * @module features/embyLibrary
 */
import type {
  EmbyLibraryIndex,
  EmbyLibraryIndexEntry,
  EmbyMediaItem,
  EmbyMediaServer,
} from '../types';
import { normalizeVideoCodeCandidate } from '../../../shared/utils/videoCodeExtractor';
import { parseEmbyUserData } from './watchState';

const GENERIC_FIRST_WORDS = new Set(['THE', 'THIS', 'WHAT', 'WITH', 'MOVIE', 'VIDEO', 'SAMPLE']);

export function normalizeServerUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

/**
 * 服务器索引键的归一化：统一大小写（协议/host），
 * 使「改地址大小写/尾斜杠」后的同一服务器仍能匹配到旧 entry。
 */
export function normalizeServerKey(value: string): string {
  return normalizeServerUrl(value).toLowerCase();
}

export function normalizeVideoCode(value: string): string | null {
  const text = String(value || '').trim();
  if (!text) return null;

  const extracted = normalizeVideoCodeCandidate(text);
  if (extracted) return extracted;

  const firstWord = text.match(/^([a-z0-9][a-z0-9_-]{2,24})/i)?.[1];
  if (
    firstWord
    && /\d/.test(firstWord)
    && !GENERIC_FIRST_WORDS.has(firstWord.toUpperCase())
  ) {
    return firstWord.replace(/_/g, '-').toUpperCase();
  }

  return null;
}

export function extractCodeFromMediaItem(item: EmbyMediaItem): string | null {
  return normalizeVideoCode(item.Name || '') || normalizeVideoCode(item.Path || '');
}

function addSearchTerm(terms: string[], canonicalCode: string, term: string): void {
  const normalizedTerm = normalizeVideoCode(term);
  if (normalizedTerm !== canonicalCode || terms.includes(term)) return;
  terms.push(term);
}

export function generateVideoCodeSearchTerms(videoCode: string): string[] {
  const canonicalCode = normalizeVideoCode(videoCode);
  if (!canonicalCode) return [];

  const terms: string[] = [];
  const fc2Match = canonicalCode.match(/^FC2-PPV-(\d+)$/);
  if (fc2Match) {
    const number = fc2Match[1];
    const upperTerms = [
      `FC2-PPV-${number}`,
      `FC2PPV${number}`,
      `FC2_PPV_${number}`,
    ];
    for (const term of upperTerms) {
      addSearchTerm(terms, canonicalCode, term);
    }
    for (const term of upperTerms) {
      addSearchTerm(terms, canonicalCode, term.toLowerCase());
    }
    return terms;
  }

  const codeMatch = canonicalCode.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
  if (!codeMatch) {
    addSearchTerm(terms, canonicalCode, canonicalCode);
    addSearchTerm(terms, canonicalCode, canonicalCode.toLowerCase());
    return terms;
  }

  const [, prefix, suffix] = codeMatch;
  const upperTerms = [
    `${prefix}-${suffix}`,
    `${prefix}${suffix}`,
    `${prefix}_${suffix}`,
  ];
  for (const term of upperTerms) {
    addSearchTerm(terms, canonicalCode, term);
  }
  for (const term of upperTerms) {
    addSearchTerm(terms, canonicalCode, term.toLowerCase());
  }

  return terms;
}

/**
 * Emby 图片类型（与 Images/{type} 路径一致）
 */
export type EmbyImageType = 'Primary' | 'Thumb' | 'Backdrop' | 'Logo' | 'Banner';

/**
 * 构建单种封面图 URL（CSS/img 无 Header，鉴权走 api_key query）
 */
export function buildMediaItemImageUrl(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken'>,
  item: Pick<
    EmbyMediaItem,
    | 'Id'
    | 'ImageTags'
    | 'PrimaryImageTag'
    | 'BackdropImageTags'
    | 'ParentThumbImageTag'
    | 'ParentThumbItemId'
  >,
  imageType: EmbyImageType = 'Primary',
  opts?: { maxWidth?: number; maxHeight?: number; quality?: number },
): string | undefined {
  let itemId = String(item.Id || '').trim();
  if (!itemId) return undefined;

  const serverUrl = normalizeServerUrl(server.url);
  if (!serverUrl) return undefined;

  const tags = item.ImageTags || {};
  let tag = '';
  if (imageType === 'Primary') {
    tag = String(tags.Primary || item.PrimaryImageTag || '').trim();
  } else if (imageType === 'Thumb') {
    // 本条目标题略缩图优先；没有则回退父级（剧集/文件夹）Thumb
    tag = String(tags.Thumb || '').trim();
    if (!tag) {
      const parentTag = String(item.ParentThumbImageTag || '').trim();
      const parentId = String(item.ParentThumbItemId || '').trim();
      if (parentTag && parentId) {
        tag = parentTag;
        itemId = parentId;
      }
    }
  } else if (imageType === 'Backdrop') {
    const bt = item.BackdropImageTags;
    tag = Array.isArray(bt) && bt[0] ? String(bt[0]).trim() : String(tags.Backdrop || '').trim();
  } else {
    tag = String((tags as any)[imageType] || '').trim();
  }

  // Primary 无 tag 仍可试默认图；其它类型无 tag 通常表示没有该图
  if (!tag && imageType !== 'Primary') return undefined;

  const params = new URLSearchParams();
  if (tag) params.set('tag', tag);

  const maxH = opts?.maxHeight ?? (imageType === 'Primary' ? 720 : 480);
  const maxW = opts?.maxWidth ?? (imageType === 'Primary' ? 480 : 720);
  const quality = opts?.quality ?? 90;
  params.set('maxHeight', String(maxH));
  params.set('maxWidth', String(maxW));
  params.set('quality', String(quality));

  const auth = String(server.apiKey || server.accessToken || '').trim();
  if (auth) params.set('api_key', auth);

  // Thumb 路径：若用了父级 Id，仍请求 Images/Thumb
  const pathType = imageType;
  return `${serverUrl}/Items/${encodeURIComponent(itemId)}/Images/${pathType}?${params.toString()}`;
}

/**
 * @deprecated 使用 buildMediaItemImageUrl(..., 'Primary')
 */
export function buildMediaItemCoverImageUrl(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken'>,
  item: Pick<EmbyMediaItem, 'Id' | 'ImageTags' | 'PrimaryImageTag'>,
): string | undefined {
  return buildMediaItemImageUrl(server, item, 'Primary');
}

/**
 * 收集条目可用的多视图封面 URL
 */
export function buildMediaItemImageUrlMap(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken'>,
  item: EmbyMediaItem,
): Partial<Record<EmbyImageType, string>> {
  const map: Partial<Record<EmbyImageType, string>> = {};
  const types: EmbyImageType[] = ['Primary', 'Thumb', 'Backdrop', 'Banner', 'Logo'];
  for (const t of types) {
    const url = buildMediaItemImageUrl(server, item, t);
    if (url) map[t] = url;
  }
  return map;
}

export function buildLibraryIndex(
  server: EmbyMediaServer,
  items: EmbyMediaItem[],
  now = Date.now(),
): EmbyLibraryIndex {
  const entries: Record<string, EmbyLibraryIndexEntry[]> = {};
  const serverUrl = normalizeServerUrl(server.url);

  for (const item of items) {
    const itemId = String(item.Id || '').trim();
    if (!itemId) continue;

    const code = extractCodeFromMediaItem(item);
    if (!code) continue;

    const imageUrls = buildMediaItemImageUrlMap(server, item);
    // 默认 cover：优先 Primary，其次 Thumb（略缩图），再 Backdrop
    const coverImageUrl = imageUrls.Primary || imageUrls.Thumb || imageUrls.Backdrop;
    const userData = parseEmbyUserData(item.UserData, Number(item.RunTimeTicks) || 0);
    const entry: EmbyLibraryIndexEntry = {
      serverType: server.type || 'emby',
      serverName: server.name || (server.type === 'jellyfin' ? 'Jellyfin' : 'Emby'),
      serverUrl,
      itemId,
      serverId: item.ServerId ? String(item.ServerId) : undefined,
      itemName: String(item.Name || code),
      path: item.Path,
      ...(coverImageUrl ? { coverImageUrl } : {}),
      ...(Object.keys(imageUrls).length ? { imageUrls } : {}),
      ...(userData ? { userData } : {}),
      updatedAt: now,
    };

    entries[code] = entries[code] || [];
    entries[code].push(entry);
  }

  return { entries, updatedAt: now };
}

export function mergeLibraryIndexes(indexes: EmbyLibraryIndex[], now = Date.now()): EmbyLibraryIndex {
  const entries: Record<string, EmbyLibraryIndexEntry[]> = {};

  for (const index of indexes) {
    for (const [code, matches] of Object.entries(index.entries || {})) {
      entries[code] = entries[code] || [];
      entries[code].push(...matches);
    }
  }

  for (const code of Object.keys(entries)) {
    entries[code].sort((a, b) => {
      const typeOrder = a.serverType.localeCompare(b.serverType);
      if (typeOrder !== 0) return typeOrder;
      return a.serverName.localeCompare(b.serverName);
    });
  }

  return { entries, updatedAt: now };
}

export function findLibraryMatches(index: EmbyLibraryIndex | null | undefined, videoCode: string): EmbyLibraryIndexEntry[] {
  const code = normalizeVideoCode(videoCode);
  if (!code || !index?.entries) return [];
  return [...(index.entries[code] || [])];
}

/**
 * 打开官方网页「条目详情」（可从页内点播放）。
 * Emby: #!/item?id=…  Jellyfin: #!/details?id=…
 */
export function buildMediaItemUrl(
  entry: Pick<EmbyLibraryIndexEntry, 'serverUrl' | 'itemId' | 'serverType'> & Partial<Pick<EmbyLibraryIndexEntry, 'serverId'>>,
): string {
  const route = entry.serverType === 'jellyfin' ? 'details' : 'item';
  const serverIdParam = entry.serverId ? `&serverId=${encodeURIComponent(entry.serverId)}` : '';
  return `${normalizeServerUrl(entry.serverUrl)}/web/index.html#!/${route}?id=${encodeURIComponent(entry.itemId)}${serverIdParam}`;
}

/**
 * 打开官方网页「尽量可播」的深链（仅作回退；真正播放优先走 resolveEmbyStreamUrl）。
 *
 * 重要：
 * - 设置页里的 AccessToken **不会**自动变成浏览器 Emby 网页登录态。
 * - `#!/video?id=` / 猜测的 `videoosd` 在多版本上不可靠；回退统一进 **详情页**，用户可在官方页点播放。
 * - 扩展内播放请用 API：PlaybackInfo + /Videos/{id}/stream（见 embyPlayback.ts）。
 */
export function buildMediaPlaybackUrl(
  entry: Pick<EmbyLibraryIndexEntry, 'serverUrl' | 'itemId' | 'serverType'> & Partial<Pick<EmbyLibraryIndexEntry, 'serverId'>>,
): string {
  // 与详情相同：可靠落地；真正起播走扩展内 token 取流
  return buildMediaItemUrl(entry);
}
