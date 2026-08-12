import { describe, expect, it } from 'vitest';
import {
  filterMediaItems,
  resumeMediaItems,
  type MediaBrowseItem,
} from './mediaBrowseModel';
import {
  buildMediaCatalogQueryIndex,
  buildMediaCatalogQuerySnapshot,
  queryMediaCatalogIndex,
} from './mediaCatalogQuery';

const items: MediaBrowseItem[] = [
  {
    code: 'ABC-001',
    title: '片库影片',
    source: 'emby',
    serverName: '客厅 Emby',
    year: '2024',
    hue: 1,
    watchState: 'in_progress',
    userData: { percent: 40, lastPlayedAt: 20 },
    copies: [
      {
        copyId: 'emby:http://emby.local:1',
        source: 'emby',
        serverName: '客厅 Emby',
        serverUrl: 'http://emby.local',
        itemId: '1',
        userData: { percent: 40, lastPlayedAt: 20 },
      },
      {
        copyId: '115:file-1',
        source: '115',
        serverName: '115 片库',
        fileName: 'ABC-001.mp4',
        userData: { percent: 30, lastPlayedAt: 10 },
      },
    ],
  },
  {
    code: 'XYZ-002',
    title: '已看影片',
    source: 'jellyfin',
    serverName: '卧室 Jellyfin',
    year: '2023',
    hue: 2,
    watchState: 'watched',
    userData: { percent: 100, played: true, lastPlayedAt: 30 },
  },
];

describe('mediaCatalogQuery', () => {
  it('keeps source, search, watch-state, and resume semantics identical', () => {
    const options = {
      filter: '115' as const,
      query: 'abc',
      watchFilter: 'in_progress' as const,
      channels: [],
      resumeLimit: 8,
    };

    const snapshot = buildMediaCatalogQuerySnapshot(items, options);

    expect(snapshot.items).toEqual(filterMediaItems(
      items,
      options.filter,
      options.query,
      options.watchFilter,
      options.channels,
    ));
    expect(snapshot.resumeItems).toEqual(resumeMediaItems(items, options.resumeLimit));
  });

  it('returns original item references and does not mutate the catalog', () => {
    const before = items.slice();
    const snapshot = buildMediaCatalogQuerySnapshot(items, {
      filter: 'all',
      query: '',
      watchFilter: 'all',
      channels: [],
      resumeLimit: 8,
    });

    expect(snapshot.items[0]).toBe(items[0]);
    expect(snapshot.resumeItems[0]).toBe(items[0]);
    expect(items).toEqual(before);
  });

  it('reuses a catalog index when the query changes without copying media items', () => {
    const index = buildMediaCatalogQueryIndex(items);
    const first = queryMediaCatalogIndex(index, {
      filter: 'all',
      query: 'abc',
      watchFilter: 'all',
      channels: [],
      resumeLimit: 8,
    });
    const second = queryMediaCatalogIndex(index, {
      filter: 'server:emby',
      query: '客厅',
      watchFilter: 'all',
      channels: [{
        id: 'server:emby',
        label: '客厅 Emby',
        source: 'emby',
        serverUrl: 'http://emby.local',
      }],
      resumeLimit: 8,
    });

    expect(first.items).toEqual([items[0]]);
    expect(second.items).toEqual([items[0]]);
    expect(second.items[0]).toBe(items[0]);
    expect(second.resumeItems[0]).toBe(items[0]);
  });
});
