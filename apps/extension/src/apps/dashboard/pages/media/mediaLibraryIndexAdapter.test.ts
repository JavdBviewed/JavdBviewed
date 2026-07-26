/**
 * @file mediaLibraryIndexAdapter.test.ts
 * @description 媒体库索引适配器测试
 * @module apps/dashboard/pages/media
 */
import { describe, expect, it } from 'vitest';
import type { EmbyLibraryState } from '../../../../features/embyLibrary/types';
import {
  buildServerOpenUrl,
  buildServerPlayUrl,
  hasLibraryIndex,
  hueFromCode,
  mapLibraryStateToBrowseItems,
  mergeLocalWatchEvidence,
  mapDrive115LibraryStateToBrowseItems,
  mergeBrowseCatalogs,
  hasDrive115LibraryIndex,
} from './mediaLibraryIndexAdapter';

describe('mediaLibraryIndexAdapter', () => {
  it('maps library state entries to browse items', () => {
    const state: EmbyLibraryState = {
      updatedAt: 1,
      entries: {
        'ABC-123': [
          {
            serverType: 'emby',
            serverName: 'Home',
            serverUrl: 'http://emby.local',
            itemId: '1',
            itemName: 'Sample Title',
            coverImageUrl: 'http://emby.local/Items/1/Images/Primary',
            serverId: 'srv1',
            userData: {
              played: false,
              positionTicks: 10,
              runtimeTicks: 100,
              percent: 37,
              lastPlayedAt: 0,
            },
            updatedAt: 1,
          },
        ],
        'XYZ-9': [
          {
            serverType: 'jellyfin',
            serverName: 'JF',
            serverUrl: 'http://jf.local',
            itemId: '2',
            itemName: 'Other',
            userData: {
              played: true,
              positionTicks: 0,
              runtimeTicks: 0,
              percent: 100,
              lastPlayedAt: 1,
            },
            updatedAt: 1,
          },
        ],
      },
    };

    const items = mapLibraryStateToBrowseItems(state);
    expect(items).toHaveLength(2);
    expect(items[0].code).toBe('ABC-123');
    expect(items[0].source).toBe('emby');
    expect(items[0].coverImageUrl).toContain('Primary');
    expect(items[0].serverId).toBe('srv1');
    expect(items[0].watchState).toBe('in_progress');
    expect(items[1].source).toBe('jellyfin');
    expect(items[1].watchState).toBe('watched');
    expect(hasLibraryIndex(state)).toBe(true);
    expect(hasLibraryIndex({ entries: {}, updatedAt: 0 })).toBe(false);
  });

  it('builds server web open url for indexed items', () => {
    const url = buildServerOpenUrl({
      source: 'emby',
      serverUrl: 'http://emby.local/',
      itemId: '42',
      serverId: 'abc',
    });
    expect(url).toContain('/web/index.html#!/item?id=42');
    expect(url).toContain('serverId=abc');
    expect(buildServerOpenUrl({ source: '115', serverUrl: 'x', itemId: '1' } as any)).toBeNull();

    const play = buildServerPlayUrl({
      source: 'emby',
      serverUrl: 'http://emby.local/',
      itemId: '42',
      serverId: 'abc',
    });
    // 外链回退为详情；真正播放由 EMBY_LIBRARY_RESOLVE_STREAM 取直链
    expect(play).toContain('#!/item?id=42');
    expect(play).toContain('serverId=abc');
  });

  it('produces stable hue for a code', () => {
    expect(hueFromCode('ABC-123')).toBe(hueFromCode('ABC-123'));
    expect(hueFromCode('ABC-123')).toBeGreaterThanOrEqual(0);
    expect(hueFromCode('ABC-123')).toBeLessThan(360);
  });

  it('merges local 115 evidence into watch state', () => {
    const items = mapLibraryStateToBrowseItems({
      updatedAt: 1,
      entries: {
        'ABC-1': [
          {
            serverType: 'emby',
            serverName: 'H',
            serverUrl: 'http://e',
            itemId: '1',
            itemName: 't',
            updatedAt: 1,
          },
        ],
      },
    });
    const merged = mergeLocalWatchEvidence(items, {
      'ABC-1': {
        source: 'drive115',
        percent: 95,
        watched: true,
        lastPlayedAt: 9,
      },
    });
    expect(merged[0].watchState).toBe('watched');
    expect(merged[0].userData?.percent).toBe(95);
  });


  it('maps drive115 library state to browse items', () => {
    const items = mapDrive115LibraryStateToBrowseItems({
      entries: [
        {
          key: 'f1:v1',
          code: 'SSIS-001',
          title: 'SSIS-001',
          videoFileId: 'v1',
          pickCode: 'pick1',
          fileName: 'SSIS-001.mp4',
          folderName: 'SSIS-001',
        },
        {
          // invalid without pickCode
          videoFileId: 'v2',
          pickCode: '',
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('115');
    expect(items[0].pickCode).toBe('pick1');
    expect(items[0].itemId).toBe('v1');
    expect(items[0].libraryKey).toBe('f1:v1');
    expect(hasDrive115LibraryIndex({ entries: items as any })).toBe(true);
  });

  it('prefers parsed NFO summary for 115 title and year', () => {
    const items = mapDrive115LibraryStateToBrowseItems({
      entries: [
        {
          key: 'f9:v9',
          code: 'ABP-999',
          title: 'ABP-999',
          videoFileId: 'v9',
          pickCode: 'pick9',
          fileName: 'ABP-999.mp4',
          folderName: 'ABP-999',
          nfoSummary: { title: '真实标题', year: '2021', plot: '简介文本' },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('真实标题');
    expect(items[0].year).toBe('2021');
    expect(items[0].nfoSummary?.plot).toBe('简介文本');
    expect(items[0].libraryKey).toBe('f9:v9');
  });

  it('merges emby and 115 catalogs without dropping 115-only', () => {
    const emby = mapLibraryStateToBrowseItems({
      updatedAt: 1,
      entries: {
        'ABC-123': [
          {
            serverType: 'emby',
            serverName: 'Home',
            serverUrl: 'http://emby.local',
            itemId: '1',
            itemName: 'Sample',
            userData: {
              played: false,
              positionTicks: 0,
              runtimeTicks: 0,
              percent: 0,
              lastPlayedAt: 0,
            },
            updatedAt: 1,
          },
        ],
      },
    } as EmbyLibraryState);
    const d115 = mapDrive115LibraryStateToBrowseItems({
      entries: [
        {
          code: 'ABC-123',
          title: 'ABC-123',
          videoFileId: 'v1',
          pickCode: 'p1',
          fileName: 'ABC-123.mp4',
          folderName: 'ABC-123',
        },
        {
          code: 'ONLY-115',
          title: 'ONLY-115',
          videoFileId: 'v2',
          pickCode: 'p2',
          fileName: 'ONLY-115.mp4',
          folderName: 'ONLY-115',
        },
      ],
    });
    const merged = mergeBrowseCatalogs(emby, d115);
    expect(merged.some((i) => i.code === 'ONLY-115' && i.source === '115')).toBe(true);
    const shared = merged.find((i) => i.code === 'ABC-123');
    expect(shared?.source).toBe('emby');
    expect(shared?.pickCode).toBe('p1');
  });
});

