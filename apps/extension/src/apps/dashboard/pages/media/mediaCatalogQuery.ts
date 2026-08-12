import {
  normalizeMediaServerUrl,
  type MediaBrowseItem,
  type MediaBrowseSource,
  type MediaItemSource,
  type MediaSourceChannel,
  type MediaWatchFilter,
} from './mediaBrowseModel';

export type MediaCatalogQueryOptions = {
  filter: MediaBrowseSource;
  query: string;
  watchFilter: MediaWatchFilter;
  channels: MediaSourceChannel[];
  resumeLimit: number;
};

export type MediaCatalogQuerySnapshot = {
  items: MediaBrowseItem[];
  resumeItems: MediaBrowseItem[];
};

type MediaCatalogQueryEntry = {
  item: MediaBrowseItem;
  searchText: string;
  sources: readonly MediaItemSource[];
  sourceServerKeys: readonly string[];
};

export type MediaCatalogQueryIndex = readonly MediaCatalogQueryEntry[];

function isResumeCandidate(item: MediaBrowseItem): boolean {
  return item.watchState === 'in_progress'
    || Boolean(item.userData && item.userData.percent > 0 && item.watchState !== 'watched');
}

function buildQueryEntry(item: MediaBrowseItem): MediaCatalogQueryEntry {
  const copies = item.copies?.length
    ? item.copies
    : [{ source: item.source, serverUrl: item.serverUrl }];
  const sources = Array.from(new Set(copies.map((copy) => copy.source)));
  const sourceServerKeys = Array.from(new Set(
    copies
      .map((copy) => {
        const serverUrl = normalizeMediaServerUrl(copy.serverUrl);
        return serverUrl ? `${copy.source}\u0000${serverUrl}` : '';
      })
      .filter(Boolean),
  ));
  return {
    item,
    searchText: [item.code, item.title, item.serverName]
      .map((value) => String(value || '').toLowerCase())
      .join('\u0000'),
    sources,
    sourceServerKeys,
  };
}

/**
 * 为目录建立一次轻量查询索引。索引不复制影片对象，只预计算重复使用的匹配字段。
 */
export function buildMediaCatalogQueryIndex(catalog: MediaBrowseItem[]): MediaCatalogQueryIndex {
  return catalog.map(buildQueryEntry);
}

function matchesIndexedEntry(
  entry: MediaCatalogQueryEntry,
  filter: MediaBrowseSource,
  query: string,
  watchFilter: MediaWatchFilter,
  channel: MediaSourceChannel | undefined,
): boolean {
  if (filter !== 'all') {
    if (channel?.serverUrl) {
      const key = `${channel.source}\u0000${channel.serverUrl}`;
      if (!entry.sourceServerKeys.includes(key)) return false;
    } else if (filter.startsWith('server:') || !entry.sources.includes(filter as MediaItemSource)) {
      return false;
    }
  }
  if (watchFilter !== 'all') {
    const state = entry.item.watchState || 'none';
    if (watchFilter === 'watched' && state !== 'watched') return false;
    if (watchFilter === 'in_progress' && state !== 'in_progress') return false;
    if (watchFilter === 'not_watched' && (state === 'watched' || state === 'in_progress')) return false;
  }
  return !query || entry.searchText.includes(query);
}

/** 使用已建立的轻量索引查询，结果仍引用原始影片对象。 */
export function queryMediaCatalogIndex(
  index: MediaCatalogQueryIndex,
  options: MediaCatalogQueryOptions,
): MediaCatalogQuerySnapshot {
  const query = options.query.trim().toLowerCase();
  const channel = options.filter !== 'all'
    ? options.channels.find((candidate) => candidate.id === options.filter)
    : undefined;
  const items: MediaBrowseItem[] = [];
  const resumeItems: MediaBrowseItem[] = [];
  for (const entry of index) {
    if (matchesIndexedEntry(entry, options.filter, query, options.watchFilter, channel)) {
      items.push(entry.item);
    }
    if (isResumeCandidate(entry.item)) resumeItems.push(entry.item);
  }
  resumeItems.sort((a, b) => (
    (b.userData?.lastPlayedAt || 0) - (a.userData?.lastPlayedAt || 0)
  ));
  return { items, resumeItems: resumeItems.slice(0, options.resumeLimit) };
}

/**
 * 一次遍历同时生成网格筛选结果与继续观看候选，保留两者各自的既有语义。
 * 结果只引用 catalog 中的条目，不复制影片对象。
 */
export function buildMediaCatalogQuerySnapshot(
  catalog: MediaBrowseItem[],
  options: MediaCatalogQueryOptions,
): MediaCatalogQuerySnapshot {
  // 保留旧入口供非 React 调用方使用；页面在多次查询时复用 index。
  return queryMediaCatalogIndex(buildMediaCatalogQueryIndex(catalog), options);
}
