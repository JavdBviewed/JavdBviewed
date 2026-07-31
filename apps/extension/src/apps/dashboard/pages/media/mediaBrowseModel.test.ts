/**
 * @file mediaBrowseModel.test.ts
 * @description 媒体库浏览模型纯函数测试
 * @module apps/dashboard/pages/media
 */
import { describe, expect, it } from 'vitest';
import {
  buildCarouselWindow,
  buildMediaSyncTargets,
  buildMediaSourceChannels,
  filterMediaItems,
  formatMediaSourceCopyLabel,
  getMediaSourceCopyPlaybackStatus,
  getMediaSourceLabels,
  getPreferredDetailSourceCopy,
  resolvePlaybackChoice,
  heroItems,
  MEDIA_PREVIEW_ITEMS,
  DEFAULT_MEDIA_VIEW_SETTINGS,
  partitionMediaSyncTargets,
  readCoverViewMode,
  readMediaViewSettings,
  relativeCarouselPos,
  resolveCarouselDotStep,
  resolveCoverImage,
  resolveCoverImageUrl,
  resumeMediaItems,
  subPathToFilter,
  writeCoverViewMode,
  writeMediaViewSettings,
  type MediaBrowseItem,
} from './mediaBrowseModel';

describe('mediaBrowseModel', () => {
  it('builds one sync target for every configured server and enabled 115 root', () => {
    const targets = buildMediaSyncTargets({
      emby: {
        mediaServers: [
          { id: 'emby-main', type: 'emby', name: '主服务器', url: 'http://emby.local', apiKey: 'key', enabled: true },
          { id: 'jf-home', type: 'jellyfin', name: '家庭影音', url: 'http://jf.local', accessToken: 'token', enabled: true },
          { id: 'off', type: 'emby', name: '停用', url: 'http://off.local', apiKey: 'key', enabled: false },
        ],
      },
      drive115: {
        enabled: true,
        mediaLibraryRoots: [
          { cid: 'root-a', name: '整理片库', path: '/影片/整理片库', enabled: true },
          { cid: 'root-b', name: '收藏片库', path: '/影片/收藏片库', enabled: true },
          { cid: 'root-off', name: '停用目录', enabled: false },
        ],
      },
    });

    expect(targets.map((target) => [target.key, target.label])).toEqual([
      ['server:emby-main', 'Emby · 主服务器'],
      ['server:jf-home', 'Jellyfin · 家庭影音'],
      ['drive115:root-a', '115 · 整理片库'],
      ['drive115:root-b', '115 · 收藏片库'],
    ]);
  });

  it('partitions any multi-selection into media server ids and 115 root cids', () => {
    const targets = buildMediaSyncTargets({
      emby: {
        mediaServers: [
          { id: 'emby-main', type: 'emby', name: '主服务器', url: 'http://emby.local', apiKey: 'key', enabled: true },
          { id: 'jf-home', type: 'jellyfin', name: '家庭影音', url: 'http://jf.local', apiKey: 'key', enabled: true },
        ],
      },
      drive115: {
        enabled: true,
        mediaLibraryRoots: [{ cid: 'root-a', name: '整理片库', enabled: true }],
      },
    });

    expect(partitionMediaSyncTargets(targets, new Set(['server:jf-home', 'drive115:root-a']))).toEqual({
      serverIds: ['jf-home'],
      rootCids: ['root-a'],
    });
  });

  it('builds source channels from enabled user settings', () => {
    const channels = buildMediaSourceChannels({
      emby: {
        enabled: true,
        mediaServers: [
          { id: 'main', type: 'emby', name: '主服务器', url: 'http://emby.local:8096/', enabled: true },
          { id: 'jf', type: 'jellyfin', name: '家庭影音', url: 'http://jellyfin.local:8096', enabled: true },
          { id: 'off', type: 'emby', name: '已停用', url: 'http://off.local:8096', enabled: false },
        ],
      },
      drive115: {
        enabled: true,
        mediaLibraryRoots: [{ cid: 'root', name: '片库', enabled: true }],
      },
    });

    expect(channels.map((channel) => channel.label)).toEqual([
      'Emby · 主服务器',
      'Jellyfin · 家庭影音',
      '115 片库',
    ]);
    expect(channels.some((channel) => channel.label.includes('已停用'))).toBe(false);
  });

  it('hides 115 channel unless drive and at least one library root are enabled', () => {
    expect(buildMediaSourceChannels({ drive115: { enabled: false, mediaLibraryRoots: [{ cid: '1', enabled: true }] } })).toEqual([]);
    expect(buildMediaSourceChannels({ drive115: { enabled: true, mediaLibraryRoots: [] } })).toEqual([]);
    expect(buildMediaSourceChannels({ drive115: { enabled: true, mediaLibraryRoots: [{ cid: '1', enabled: false }] } })).toEqual([]);
  });

  it('filters one configured server channel instead of the whole server type', () => {
    const channels = buildMediaSourceChannels({
      emby: {
        enabled: true,
        mediaServers: [
          { id: 'first', type: 'emby', name: '一号', url: 'http://one.local:8096/', enabled: true },
          { id: 'second', type: 'emby', name: '二号', url: 'http://two.local:8096', enabled: true },
        ],
      },
    });
    const items: MediaBrowseItem[] = [
      { ...MEDIA_PREVIEW_ITEMS[0], serverUrl: 'http://one.local:8096' },
      { ...MEDIA_PREVIEW_ITEMS[2], serverUrl: 'http://two.local:8096/' },
    ];

    const filtered = filterMediaItems(items, channels[1].id, '', 'all', channels);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].serverUrl).toBe('http://two.local:8096/');
  });

  it('filters by source and query', () => {
    const emby = filterMediaItems(MEDIA_PREVIEW_ITEMS, 'emby', '');
    expect(emby.every((i) => i.source === 'emby')).toBe(true);
    const q = filterMediaItems(MEDIA_PREVIEW_ITEMS, 'all', 'ssis');
    expect(q.some((i) => i.code.startsWith('SSIS'))).toBe(true);
  });

  it('keeps an aggregated title visible for every source copy it contains', () => {
    const item: MediaBrowseItem = {
      ...MEDIA_PREVIEW_ITEMS[0],
      source: 'emby',
      copies: [
        { copyId: 'emby:http://one.local:item-1', source: 'emby', serverUrl: 'http://one.local', itemId: 'item-1' },
        { copyId: '115:file-1', source: '115', itemId: 'file-1', fileId: 'file-1', pickCode: 'pick-1' },
      ],
    };

    expect(filterMediaItems([item], 'emby', '')).toHaveLength(1);
    expect(filterMediaItems([item], '115', '')).toHaveLength(1);
  });

  it('plays a single copy directly and requires a choice for multiple copies', () => {
    const single: MediaBrowseItem = {
      ...MEDIA_PREVIEW_ITEMS[0],
      itemId: 'emby-1',
      serverUrl: 'http://emby.local',
      copies: [{
        copyId: 'emby:http://emby.local:emby-1',
        source: 'emby',
        itemId: 'emby-1',
        serverUrl: 'http://emby.local',
        serverName: 'Home',
      }],
    };
    const multiple: MediaBrowseItem = {
      ...single,
      copies: [
        ...(single.copies || []),
        {
          copyId: '115:file-1',
          source: '115',
          itemId: 'file-1',
          fileId: 'file-1',
          pickCode: 'pick-1',
          serverName: '115 片库',
        },
      ],
    };

    const direct = resolvePlaybackChoice(single);
    const choose = resolvePlaybackChoice(multiple);

    expect(direct.kind).toBe('direct');
    expect(direct.items[0]).toMatchObject({ source: 'emby', itemId: 'emby-1' });
    expect(choose.kind).toBe('choose');
    expect(choose.items.map((item) => item.source)).toEqual(['emby', '115']);
  });

  it('keeps every source visible and marks an unavailable copy without removing it from playback choice', () => {
    const item: MediaBrowseItem = {
      ...MEDIA_PREVIEW_ITEMS[0],
      copies: [
        {
          copyId: 'emby:http://emby-134.local:item-1',
          source: 'emby',
          serverName: 'Emby-134',
          serverUrl: 'http://emby-134.local',
          itemId: 'item-1',
        },
        {
          copyId: '115:file-1',
          source: '115',
          serverName: '115 片库',
          fileId: 'file-1',
          fileName: 'TEST-001.mp4',
        },
      ],
    };

    expect(getMediaSourceLabels(item)).toEqual(['Emby · Emby-134', '115 · 115 片库']);
    expect(formatMediaSourceCopyLabel(item.copies?.[0])).toBe('Emby · Emby-134');
    expect(getMediaSourceCopyPlaybackStatus(item.copies?.[1])).toEqual({
      playable: false,
      reason: '115 索引缺少播放标识',
    });

    const choice = resolvePlaybackChoice(item);
    expect(choice.kind).toBe('choose');
    expect(choice.items).toHaveLength(2);
    expect(choice.items[1]).toMatchObject({ source: '115', itemId: 'file-1' });
  });

  it('prefers a configured self-hosted media server for aggregated detail metadata', () => {
    const item: MediaBrowseItem = {
      ...MEDIA_PREVIEW_ITEMS[0],
      source: '115',
      copies: [
        { copyId: '115:file-1', source: '115', fileId: 'file-1', pickCode: 'pick-1' },
        {
          copyId: 'emby:http://emby.local:item-1',
          source: 'emby',
          serverName: '家庭 Emby',
          serverUrl: 'http://emby.local',
          itemId: 'item-1',
        },
      ],
    };

    expect(getPreferredDetailSourceCopy(item)).toMatchObject({
      source: 'emby',
      serverName: '家庭 Emby',
      itemId: 'item-1',
    });
  });

  it('filters by watch state', () => {
    const items: MediaBrowseItem[] = [
      { ...MEDIA_PREVIEW_ITEMS[0], watchState: 'watched' },
      { ...MEDIA_PREVIEW_ITEMS[1], watchState: 'in_progress' },
      { ...MEDIA_PREVIEW_ITEMS[2], watchState: 'in_library' },
    ];
    expect(filterMediaItems(items, 'all', '', 'watched')).toHaveLength(1);
    expect(filterMediaItems(items, 'all', '', 'in_progress')).toHaveLength(1);
    expect(filterMediaItems(items, 'all', '', 'not_watched')).toHaveLength(1);
  });

  it('orders resume items by lastPlayedAt', () => {
    const items: MediaBrowseItem[] = [
      {
        ...MEDIA_PREVIEW_ITEMS[0],
        watchState: 'in_progress',
        userData: { played: false, positionTicks: 1, runtimeTicks: 10, percent: 20, lastPlayedAt: 100 },
      },
      {
        ...MEDIA_PREVIEW_ITEMS[1],
        watchState: 'in_progress',
        userData: { played: false, positionTicks: 1, runtimeTicks: 10, percent: 40, lastPlayedAt: 200 },
      },
    ];
    const resume = resumeMediaItems(items, 8);
    expect(resume[0].code).toBe(MEDIA_PREVIEW_ITEMS[1].code);
  });

  it('maps hash subpath to page filter', () => {
    expect(subPathToFilter('emby')).toBe('emby');
    expect(subPathToFilter(undefined)).toBe('all');
  });

  it('maps legacy source routes to an available configured channel', () => {
    const channels = buildMediaSourceChannels({
      emby: {
        enabled: true,
        mediaServers: [
          { type: 'emby', name: '主服务器', url: 'http://emby.local:8096', enabled: true },
        ],
      },
    });

    expect(subPathToFilter('emby', channels)).toBe(channels[0].id);
    expect(subPathToFilter('jellyfin', channels)).toBe('all');
    expect(subPathToFilter('115', channels)).toBe('all');
  });

  it('computes wrapped carousel positions', () => {
    expect(relativeCarouselPos(0, 0, 5)).toBe(0);
    expect(relativeCarouselPos(4, 0, 5)).toBe(-1);
    expect(relativeCarouselPos(1, 0, 5)).toBe(1);
    // 7 卡：相对 active=0，两侧最外为 ±3
    expect(relativeCarouselPos(3, 0, 7)).toBe(3);
    expect(relativeCarouselPos(4, 0, 7)).toBe(-3);
  });

  it('exposes a non-empty hero strip from a catalog', () => {
    expect(heroItems(MEDIA_PREVIEW_ITEMS).length).toBeGreaterThan(0);
    expect(heroItems(MEDIA_PREVIEW_ITEMS).length).toBeLessThanOrEqual(7);
    expect(MEDIA_PREVIEW_ITEMS.length).toBeGreaterThanOrEqual(8);
  });

  it('samples hero items randomly instead of always taking the catalog head', () => {
    // random→1：尽量换到靠后的元素，使结果偏离 slice(0,7)
    const random = () => 0.999;
    const picked = heroItems(MEDIA_PREVIEW_ITEMS, {
      limit: 7,
      candidateLimit: 15,
      random,
    });
    expect(picked).toHaveLength(Math.min(7, MEDIA_PREVIEW_ITEMS.length));
    const headCodes = MEDIA_PREVIEW_ITEMS.slice(0, 7).map((i) => i.code);
    const pickedCodes = picked.map((i) => i.code);
    if (MEDIA_PREVIEW_ITEMS.length > 7) {
      expect(pickedCodes.join('|')).not.toBe(headCodes.join('|'));
    }
    for (const code of pickedCodes) {
      expect(MEDIA_PREVIEW_ITEMS.some((i) => i.code === code)).toBe(true);
    }
  });

  it('respects hero candidate and display limits', () => {
    const seq = Array.from({ length: 20 }, (_, i) => ({
      ...MEDIA_PREVIEW_ITEMS[i % MEDIA_PREVIEW_ITEMS.length],
      code: `CODE-${i}`,
    }));
    // random=0 → 每次 j=i，等价于保持原序，便于断言截断
    const picked = heroItems(seq, {
      limit: 7,
      candidateLimit: 15,
      random: () => 0,
    });
    expect(picked).toHaveLength(7);
    expect(picked.map((i) => i.code)).toEqual(
      seq.slice(0, 7).map((i) => i.code),
    );
  });

  it('resolves cover image by view mode with fallbacks', () => {
    const item: MediaBrowseItem = {
      ...MEDIA_PREVIEW_ITEMS[0],
      coverImageUrl: 'http://x/primary-fallback',
      imageUrls: {
        Primary: 'http://x/primary',
        Thumb: 'http://x/thumb',
        Backdrop: 'http://x/backdrop',
      },
    };
    expect(resolveCoverImageUrl(item, 'poster')).toBe('http://x/primary');
    expect(resolveCoverImageUrl(item, 'thumb')).toBe('http://x/thumb');
    expect(resolveCoverImageUrl(item, 'backdrop')).toBe('http://x/backdrop');
    // 缺某种类型时回退
    const thumbFallback = resolveCoverImage(
      { ...item, imageUrls: { Primary: 'http://x/primary' } },
      'thumb',
    );
    expect(thumbFallback.url).toBe('http://x/primary');
    expect(thumbFallback.fellBack).toBe(true);
    expect(thumbFallback.usedType).toBe('Primary');
    expect(resolveCoverImageUrl({ ...item, imageUrls: undefined }, 'poster')).toBe(
      'http://x/primary-fallback',
    );
    // 有 Thumb 时绝不误用 Primary
    const strictThumb = resolveCoverImage(item, 'thumb');
    expect(strictThumb.url).toBe('http://x/thumb');
    expect(strictThumb.fellBack).toBe(false);
  });

  it('persists cover view mode in localStorage', () => {
    const store: Record<string, string> = {};
    const ls = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    const original = (globalThis as any).localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
    try {
      writeCoverViewMode('poster');
      expect(readCoverViewMode()).toBe('poster');
      writeCoverViewMode('thumb');
      expect(readCoverViewMode()).toBe('thumb');
      writeCoverViewMode('backdrop');
      expect(readCoverViewMode()).toBe('backdrop');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
    }
  });

  it('builds adjacent cycle clones whose positions move one step across the last-to-first boundary', () => {
    const before = buildCarouselWindow(6, 7, 3);
    const after = buildCarouselWindow(7, 7, 3);
    const afterByVirtualIndex = new Map(after.map((entry) => [entry.virtualIndex, entry.position]));
    const shared = before.filter((entry) => afterByVirtualIndex.has(entry.virtualIndex));

    expect(before.map((entry) => entry.position)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(after.map((entry) => entry.itemIndex)).toEqual([4, 5, 6, 0, 1, 2, 3]);
    expect(shared.every((entry) => afterByVirtualIndex.get(entry.virtualIndex) === entry.position - 1)).toBe(true);
  });

  it('resolves dot navigation through the shortest circular distance', () => {
    expect(resolveCarouselDotStep(6, 0, 7)).toBe(7);
    expect(resolveCarouselDotStep(7, 6, 7)).toBe(6);
    expect(resolveCarouselDotStep(8, 5, 7)).toBe(5);
    expect(resolveCarouselDotStep(-1, 1, 7)).toBe(1);
  });

  it('persists media view settings with safe defaults', () => {
    const store: Record<string, string> = {};
    const ls = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
    try {
      expect(readMediaViewSettings()).toEqual(DEFAULT_MEDIA_VIEW_SETTINGS);
      writeMediaViewSettings({
        coverView: 'poster',
        cardSize: 'large',
        visibleFields: {
          ...DEFAULT_MEDIA_VIEW_SETTINGS.visibleFields,
          tags: false,
          fileName: true,
        },
      });

      expect(readMediaViewSettings()).toMatchObject({
        coverView: 'poster',
        cardSize: 'large',
        visibleFields: expect.objectContaining({
          title: true,
          fileName: true,
          tags: false,
        }),
      });

      store.ml_media_view_settings = JSON.stringify({
        coverView: 'bad',
        cardSize: 'huge',
        visibleFields: { title: false, unknown: true },
      });
      expect(readMediaViewSettings()).toMatchObject({
        coverView: 'thumb',
        cardSize: 'normal',
        visibleFields: expect.objectContaining({
          title: false,
          year: true,
        }),
      });
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
    }
  });
});
