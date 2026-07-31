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
  resolveWatchProgressPercent,
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

  it('preserves every physical copy when the same code exists on multiple sources', () => {
    const emby = mapLibraryStateToBrowseItems({
      updatedAt: 1,
      entries: {
        'ABC-123': [
          {
            serverType: 'emby',
            serverName: '客厅 Emby',
            serverUrl: 'http://emby.local/',
            itemId: 'emby-1',
            itemName: 'ABC-123',
            path: 'D:\\Movies\\ABC-123.mp4',
            updatedAt: 1,
          },
          {
            serverType: 'jellyfin',
            serverName: '书房 Jellyfin',
            serverUrl: 'http://jellyfin.local',
            itemId: 'jf-1',
            itemName: 'ABC-123',
            path: '/media/ABC-123.mkv',
            updatedAt: 1,
          },
        ],
      },
    });
    const drive115 = mapDrive115LibraryStateToBrowseItems({
      entries: [{
        code: 'abc-123',
        title: 'ABC-123',
        videoFileId: '115-file-1',
        pickCode: '115-pick-1',
        fileName: 'ABC-123.mp4',
      }],
    });

    expect(emby).toHaveLength(2);
    const [title] = mergeBrowseCatalogs(emby, drive115);

    expect(title.code).toBe('ABC-123');
    expect(title.copies).toHaveLength(3);
    expect(title.copies?.map((copy) => copy.copyId)).toEqual([
      'emby:http://emby.local:emby-1',
      'jellyfin:http://jellyfin.local:jf-1',
      '115:115-file-1',
    ]);
    expect(title.copies?.map((copy) => copy.serverName)).toEqual([
      '客厅 Emby',
      '书房 Jellyfin',
      '115 片库',
    ]);
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
        positionSec: 60,
        durationSec: 100,
      },
    });
    expect(merged[0].watchState).toBe('watched');
    expect(merged[0].userData?.percent).toBe(95);
    expect(merged[0].userData?.positionTicks).toBe(600_000_000);
    expect(merged[0].userData?.runtimeTicks).toBe(1_000_000_000);
  });

  it('merges watch evidence into matching copies and aggregates the title state', () => {
    const titles = mergeBrowseCatalogs(
      mapLibraryStateToBrowseItems({
        updatedAt: 1,
        entries: {
          'ABC-222': [{
            serverType: 'emby',
            serverName: 'Home',
            serverUrl: 'http://emby.local',
            itemId: 'emby-2',
            itemName: 'ABC-222',
            updatedAt: 1,
          }],
        },
      }),
      mapDrive115LibraryStateToBrowseItems({
        entries: [{
          code: 'ABC-222',
          videoFileId: 'file-2',
          pickCode: 'pick-2',
          fileName: 'ABC-222.mp4',
        }],
      }),
    );

    const [title] = mergeLocalWatchEvidence(titles, {
      'ABC-222::emby:http://emby.local:emby-2': {
        source: 'emby',
        sourceItemId: 'emby-2',
        copyId: 'emby:http://emby.local:emby-2',
        percent: 25,
        watched: false,
        lastPlayedAt: 10,
      },
      'ABC-222::115:file-2': {
        source: 'drive115',
        sourceItemId: 'pick-2',
        copyId: '115:file-2',
        percent: 95,
        watched: true,
        lastPlayedAt: 20,
      },
    });

    expect(title.copies?.find((copy) => copy.source === 'emby')?.userData?.percent).toBe(25);
    expect(title.copies?.find((copy) => copy.source === '115')?.userData?.percent).toBe(95);
    expect(title.watchState).toBe('watched');
    expect(title.userData?.percent).toBe(95);
  });

  it('merges local Emby evidence by source item id so external resume survives reload', () => {
    const items = mapLibraryStateToBrowseItems({
      updatedAt: 1,
      entries: {
        'ABC-EMBY': [
          {
            serverType: 'emby',
            serverName: 'H',
            serverUrl: 'http://e',
            itemId: 'emby-item-1',
            itemName: 'ABC-EMBY 本地续看',
            updatedAt: 1,
          },
        ],
      },
    });

    const merged = mergeLocalWatchEvidence(items, {
      'OLD-CODE': {
        source: 'emby',
        sourceItemId: 'emby-item-1',
        percent: 50,
        watched: false,
        lastPlayedAt: 99,
        positionSec: 600,
        durationSec: 1200,
      },
    });

    expect(merged[0].source).toBe('emby');
    expect(merged[0].watchState).toBe('in_progress');
    expect(merged[0].userData?.percent).toBe(50);
    expect(merged[0].userData?.lastPlayedAt).toBe(99);
  });

  it('merges local 115 evidence into 115-only catalog items so they appear in continue watching', () => {
    const items = mapDrive115LibraryStateToBrowseItems({
      entries: [
        {
          code: 'D115-88',
          title: 'D115-88',
          videoFileId: 'file-88',
          pickCode: 'pick-88',
          fileName: 'D115-88.mp4',
          folderName: 'D115-88',
        },
      ],
    });

    const merged = mergeLocalWatchEvidence(items, {
      'D115-88': {
        source: 'drive115',
        percent: 50,
        watched: false,
        lastPlayedAt: 88,
        positionSec: 600,
        durationSec: 1200,
        pickCode: 'pick-88',
        fileId: 'file-88',
      },
    });

    expect(merged[0].source).toBe('115');
    expect(merged[0].watchState).toBe('in_progress');
    expect(merged[0].userData?.percent).toBe(50);
    expect(merged[0].userData?.positionTicks).toBe(6_000_000_000);
    expect(merged[0].userData?.runtimeTicks).toBe(12_000_000_000);
  });

  it('matches legacy 115 watch evidence by file name and pick code aliases', () => {
    const items = mapDrive115LibraryStateToBrowseItems({
      entries: [
        {
          code: 'D115-99',
          title: 'D115-99',
          videoFileId: 'file-99',
          pickCode: 'pick-99',
          fileName: 'D115-99.mp4',
          folderName: 'D115-99',
        },
      ],
    });

    const byFileName = mergeLocalWatchEvidence(items, {
      'D115-99.MP4': {
        source: 'drive115',
        percent: 25,
        watched: false,
        lastPlayedAt: 99,
        positionSec: 300,
        durationSec: 1200,
        pickCode: 'pick-99',
        fileId: 'file-99',
        fileName: 'D115-99.mp4',
      },
    });
    expect(byFileName[0].watchState).toBe('in_progress');
    expect(byFileName[0].userData?.percent).toBe(25);

    const byPickCode = mergeLocalWatchEvidence(items, {
      'PICK-99': {
        source: 'drive115',
        percent: 50,
        watched: false,
        lastPlayedAt: 100,
        positionSec: 600,
        durationSec: 1200,
        pickCode: 'pick-99',
      },
    });
    expect(byPickCode[0].watchState).toBe('in_progress');
    expect(byPickCode[0].userData?.percent).toBe(50);
  });

  it('keeps 115 items in progress when only resume position is known', () => {
    const items = mapDrive115LibraryStateToBrowseItems({
      entries: [
        {
          code: 'D115-100',
          title: 'D115-100',
          videoFileId: 'file-100',
          pickCode: 'pick-100',
          fileName: 'D115-100.mp4',
          folderName: 'D115-100',
        },
      ],
    });

    const merged = mergeLocalWatchEvidence(items, {
      'D115-100': {
        source: 'drive115',
        percent: 0,
        watched: false,
        lastPlayedAt: 100,
        positionSec: 180,
        pickCode: 'pick-100',
      },
    });

    expect(merged[0].watchState).toBe('in_progress');
    expect(merged[0].userData?.percent).toBe(0);
    expect(merged[0].userData?.positionTicks).toBe(1_800_000_000);
    expect(resolveWatchProgressPercent(merged[0].userData)).toBe(5);
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

