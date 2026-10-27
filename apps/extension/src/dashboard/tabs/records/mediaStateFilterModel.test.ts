/**
 * @file mediaStateFilterModel.test.ts
 * @description records 媒体库状态筛选（10-24）：命中映射纯函数 + filterAndSortRecords 新维度
 * @module apps/extension/src/dashboard/tabs/records
 */
import { describe, expect, it } from 'vitest';
import {
  buildMediaStateHitMap,
  getMediaStateRecordKey,
  normalizeMediaStateOverrides,
} from './mediaStateFilterModel';
import { filterAndSortRecords, type FilterAndSortRecordsInput } from './filterModel';
import type { VideoRecord } from '../../../types';
import type { EmbyLibraryIndex, EmbyLibraryIndexEntry } from '../../../features/embyLibrary/types';
import type { Drive115LibraryIndexState } from '../../../features/drive115/mediaLibrary';

function record(partial: Partial<VideoRecord>): VideoRecord {
  return {
    id: partial.id || 'ABC-001',
    title: partial.title || '测试标题',
    status: partial.status || 'browsed',
    tags: partial.tags || [],
    userTags: partial.userTags,
    rating: partial.rating,
    userRating: partial.userRating,
    listIds: partial.listIds,
    series: partial.series,
    seriesUrl: partial.seriesUrl,
    maker: partial.maker,
    makerUrl: partial.makerUrl,
    director: partial.director,
    directorUrl: partial.directorUrl,
    isFavorite: partial.isFavorite,
    videoCode: partial.videoCode,
    mediaStateOverrides: partial.mediaStateOverrides,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
  };
}

function makeEntry(overrides: Partial<EmbyLibraryIndexEntry> = {}): EmbyLibraryIndexEntry {
  return {
    serverType: 'emby',
    serverName: 'S1',
    serverUrl: 'http://e1.local',
    itemId: 'item-1',
    itemName: 'ABC-001',
    updatedAt: 1,
    ...overrides,
  };
}

const SERVERS = [{ type: 'emby', url: 'http://e1.local', enabled: true }];

function makeEmbyIndex(entries: Record<string, EmbyLibraryIndexEntry[]>): EmbyLibraryIndex {
  return { entries, updatedAt: 1 };
}

function make115State(codes: string[]): Drive115LibraryIndexState {
  return {
    version: 1,
    updatedAt: 2,
    entries: codes.map(code => ({
      key: code,
      code,
      title: code,
      folderCid: 'c',
      folderName: 'f',
      rootCid: 'r',
      videoFileId: `f-${code}`,
      pickCode: 'p',
      fileName: `${code}.mp4`,
      fileSize: 1,
      updatedAt: 2,
    })),
    stats: { roots: 0, foldersSeen: 0, indexed: codes.length, skipped: 0, unrecognized: 0, apiCalls: 0, truncatedFolders: 0 },
  };
}

describe('buildMediaStateHitMap', () => {
  it('Emby 命中且未观看 → 仅 inLibrary', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'ABC-001': [makeEntry({ userData: { played: false, positionTicks: 0, runtimeTicks: 0, percent: 40, lastPlayedAt: 0 } })] }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.get(getMediaStateRecordKey(records[0]))).toEqual({ inLibrary: true, realWatched: false });
  });

  it('Emby 命中且 played → 双真', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'ABC-001': [makeEntry({ userData: { played: true, positionTicks: 0, runtimeTicks: 0, percent: 0, lastPlayedAt: 0 } })] }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.get(getMediaStateRecordKey(records[0]))).toEqual({ inLibrary: true, realWatched: true });
  });

  it('Emby 命中且 percent≥90 → realWatched', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'ABC-001': [makeEntry({ userData: { played: false, positionTicks: 0, runtimeTicks: 0, percent: 95, lastPlayedAt: 0 } })] }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.get(getMediaStateRecordKey(records[0]))?.realWatched).toBe(true);
  });

  it('115 命中（无 Emby）→ 仅 inLibrary（115 无观看态）', () => {
    const records = [record({ id: 'XYZ-777', videoCode: 'xyz-777' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: null,
      drive115State: make115State(['XYZ-777']),
      servers: SERVERS,
    });
    expect(map.get(getMediaStateRecordKey(records[0]))).toEqual({ inLibrary: true, realWatched: false });
  });

  it('Emby ∨ 115 均命中 → inLibrary 仍为真', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'ABC-001': [makeEntry({ userData: { played: true, positionTicks: 0, runtimeTicks: 0, percent: 100, lastPlayedAt: 0 } })] }),
      drive115State: make115State(['abc-001']),
      servers: SERVERS,
    });
    expect(map.get(getMediaStateRecordKey(records[0]))).toEqual({ inLibrary: true, realWatched: true });
  });

  it('无已配置启用服务器 → 零命中', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'ABC-001': [makeEntry()] }),
      drive115State: null,
      servers: [],
    });
    expect(map.size).toBe(0);
  });

  it('空索引 / 空 115 → 零命中', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001' })];
    expect(buildMediaStateHitMap({ records, embyIndex: makeEmbyIndex({}), drive115State: make115State([]), servers: SERVERS }).size).toBe(0);
    expect(buildMediaStateHitMap({ records, embyIndex: null, drive115State: null, servers: SERVERS }).size).toBe(0);
  });

  it('无番号（videoCode 与 id 均非番号）→ 不入 map', () => {
    const records = [record({ id: 'my-note-1', videoCode: '' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'OTHER-999': [makeEntry()] }),
      drive115State: make115State(['other-999']),
      servers: SERVERS,
    });
    expect(map.size).toBe(0);
  });

  it('videoCode 大小写归一（predicates 各自归一，调用侧传原值）', () => {
    const records = [record({ id: 'abc-001', videoCode: 'abc-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'ABC-001': [makeEntry()] }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.get(getMediaStateRecordKey(records[0]))?.inLibrary).toBe(true);
  });

  it('截断 videoCode 无法归一时用完整 id 命中 Emby 真实已看', () => {
    const records = [record({ id: 'MIDA-354', videoCode: 'MIDA' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({
        'MIDA-354': [makeEntry({ itemName: 'MIDA-354', userData: { played: true } })],
      }),
      drive115State: null,
      servers: SERVERS,
    });

    expect(map.get('MIDA-354')).toEqual({ inLibrary: true, realWatched: true });
  });

  it('videoCode 候选命中后定案，不被 id 候选覆盖', () => {
    const records = [record({ id: 'XYZ-777', videoCode: 'ABC-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({
        'ABC-001': [makeEntry({ itemName: 'ABC-001', userData: { played: false } })],
        'XYZ-777': [makeEntry({ itemName: 'XYZ-777', userData: { played: true } })],
      }),
      drive115State: null,
      servers: SERVERS,
    });

    expect(map.get('XYZ-777')).toEqual({ inLibrary: true, realWatched: false });
  });

  it('截断 videoCode 与无效 id 均不能制造命中', () => {
    const records = [record({ id: 'jdb-record-alpha', videoCode: 'MIDA' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'MIDA-354': [makeEntry({ itemName: 'MIDA-354' })] }),
      drive115State: make115State(['MIDA-354']),
      servers: SERVERS,
    });

    expect(map.size).toBe(0);
  });

  it('截断 videoCode 走 id 兜底时命中 115 inLibrary', () => {
    const records = [record({ id: 'MIDA-354', videoCode: 'MIDA' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: null,
      drive115State: make115State(['MIDA-354']),
      servers: SERVERS,
    });

    expect(map.get('MIDA-354')).toEqual({ inLibrary: true, realWatched: false });
  });

  it('仅有 115 索引时完整 id 候选可命中 inLibrary', () => {
    const records = [record({ id: 'MIDA-354', videoCode: '' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: null,
      drive115State: make115State(['MIDA-354']),
      servers: SERVERS,
    });

    expect(map.get('MIDA-354')).toEqual({ inLibrary: true, realWatched: false });
  });
});

describe('getMediaStateRecordKey', () => {
  it('有 id 用 id；无 id 用 videoCode；皆无 → 空串', () => {
    expect(getMediaStateRecordKey(record({ id: 'ABC-001', videoCode: 'abc-001' }))).toBe('ABC-001');
    expect(getMediaStateRecordKey({ videoCode: 'xyz-777' } as VideoRecord)).toBe('xyz-777');
    expect(getMediaStateRecordKey({} as VideoRecord)).toBe('');
  });
});

function baseInput(overrides: Partial<FilterAndSortRecordsInput> = {}): FilterAndSortRecordsInput {
  return {
    records: [],
    searchTerm: '',
    status: 'all',
    selectedTags: new Set(),
    selectedListIds: new Set(),
    selectedSeriesIds: new Set(),
    selectedLabelIds: new Set(),
    selectedMakerIds: new Set(),
    selectedDirectorIds: new Set(),
    seriesIdToRecord: new Map(),
    labelIdToRecord: new Map(),
    makerIdToRecord: new Map(),
    directorIdToRecord: new Map(),
    advancedConditions: [],
    favoritesFilterActive: false,
    sortValue: 'updatedAt_desc',
    ...overrides,
  };
}

describe('filterAndSortRecords 媒体库状态维度', () => {
  const hitMap = new Map([
    ['ABC-001', { inLibrary: true, realWatched: true }],
    ['ABC-002', { inLibrary: true, realWatched: false }],
  ]);
  const records = [
    record({ id: 'ABC-001', videoCode: 'abc-001', isFavorite: true, updatedAt: 3 }),
    record({ id: 'ABC-002', videoCode: 'abc-002', isFavorite: true, updatedAt: 2 }),
    record({ id: 'XYZ-001', videoCode: 'xyz-001', isFavorite: true, updatedAt: 1 }),
  ];

  it('inLibraryFilterActive → 仅留已入库命中', () => {
    const result = filterAndSortRecords(baseInput({ records, mediaStateHits: hitMap, inLibraryFilterActive: true }));
    expect(result.map(item => item.id).sort()).toEqual(['ABC-001', 'ABC-002']);
  });

  it('realWatchedFilterActive → 仅留真实已看命中', () => {
    const result = filterAndSortRecords(baseInput({ records, mediaStateHits: hitMap, realWatchedFilterActive: true }));
    expect(result.map(item => item.id)).toEqual(['ABC-001']);
  });

  it('两维度 AND 叠加', () => {
    const result = filterAndSortRecords(baseInput({ records, mediaStateHits: hitMap, inLibraryFilterActive: true, realWatchedFilterActive: true }));
    expect(result.map(item => item.id)).toEqual(['ABC-001']);
  });

  it('与 favorites 维度叠加（AND）', () => {
    const nonFav = [record({ id: 'ABC-001', videoCode: 'abc-001', isFavorite: false, updatedAt: 3 })];
    const result = filterAndSortRecords(baseInput({ records: nonFav, mediaStateHits: hitMap, inLibraryFilterActive: true, favoritesFilterActive: true }));
    expect(result).toHaveLength(0);
  });

  it('命中 map 缺记录 → 视为不命中（激活时过滤掉）', () => {
    const result = filterAndSortRecords(baseInput({ records, mediaStateHits: hitMap, realWatchedFilterActive: true }));
    expect(result.map(item => item.id)).toEqual(['ABC-001']);
  });

  it('缺省入参（不传新字段）= 旧行为，命中数据不参与过滤', () => {
    const result = filterAndSortRecords(baseInput({ records, mediaStateHits: hitMap }));
    expect(result.map(item => item.id)).toEqual(['ABC-001', 'ABC-002', 'XYZ-001']);
  });
});

describe('normalizeMediaStateOverrides（10-27 pin 归一）', () => {
  it('null / undefined / 非对象 → null', () => {
    expect(normalizeMediaStateOverrides(null)).toBeNull();
    expect(normalizeMediaStateOverrides(undefined)).toBeNull();
    expect(normalizeMediaStateOverrides('pin')).toBeNull();
    expect(normalizeMediaStateOverrides([1, 0])).toBeNull();
  });

  it('脏值维度=未钉住；全脏 → null（等价旧数据无字段）', () => {
    expect(normalizeMediaStateOverrides({ inLibrary: 'yes', realWatched: 1 })).toBeNull();
    expect(normalizeMediaStateOverrides({ inLibrary: null, realWatched: undefined })).toBeNull();
    expect(normalizeMediaStateOverrides({})).toBeNull();
    expect(normalizeMediaStateOverrides({ inLibrary: 'yes', realWatched: false })).toEqual({ realWatched: false });
  });

  it('boolean 维度原样保留（含 false=强制关）', () => {
    expect(normalizeMediaStateOverrides({ inLibrary: true, realWatched: false }))
      .toEqual({ inLibrary: true, realWatched: false });
  });
});

describe('buildMediaStateHitMap × 人工钉住（10-27 pin）', () => {
  const NO_INDEX = { embyIndex: null, drive115State: null, servers: SERVERS };

  it('钉住 realWatched（无索引）→ 命中且带 pinned 标记', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001', mediaStateOverrides: { realWatched: true } })];
    const map = buildMediaStateHitMap({ records, ...NO_INDEX });
    expect(map.get('ABC-001')).toEqual({ inLibrary: false, realWatched: true, pinned: { realWatched: true } });
  });

  it('钉住 inLibrary（无索引）→ 仅 inLibrary 命中', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001', mediaStateOverrides: { inLibrary: true } })];
    const map = buildMediaStateHitMap({ records, ...NO_INDEX });
    expect(map.get('ABC-001')).toEqual({ inLibrary: true, realWatched: false, pinned: { inLibrary: true } });
  });

  it('override 优先于派生：索引 played 命中 realWatched，人工强制关 → realWatched 不计（inLibrary 仍走派生）', () => {
    const records = [
      record({ id: 'ABC-001', videoCode: 'abc-001', mediaStateOverrides: { realWatched: false } }),
    ];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({
        'ABC-001': [makeEntry({ userData: { played: true, positionTicks: 0, runtimeTicks: 0, percent: 100, lastPlayedAt: 0 } })],
      }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.get('ABC-001')).toEqual({ inLibrary: true, realWatched: false, pinned: { realWatched: false } });
  });

  it('强制关 inLibrary 且无其他命中 → 不入 map（无 chip 无筛选）', () => {
    const records = [
      record({ id: 'ABC-001', videoCode: 'abc-001', mediaStateOverrides: { inLibrary: false, realWatched: false } }),
    ];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({
        'ABC-001': [makeEntry({ userData: { played: true } })],
      }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.size).toBe(0);
  });

  it('旧数据零回补：无 mediaStateOverrides 字段 → 纯派生，hit 不带 pinned（行为零变化）', () => {
    const records = [record({ id: 'ABC-001', videoCode: 'abc-001' })];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({
        'ABC-001': [makeEntry({ userData: { played: true } })],
      }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.get('ABC-001')).toEqual({ inLibrary: true, realWatched: true });
    expect(map.get('ABC-001')?.pinned).toBeUndefined();
  });

  it('两维独立：钉住 inLibrary + 索引派生 realWatched → 双真，pinned 仅含钉住维', () => {
    const records = [
      record({ id: 'ABC-001', videoCode: 'abc-001', mediaStateOverrides: { inLibrary: true } }),
    ];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({
        'ABC-001': [makeEntry({ userData: { played: true } })],
      }),
      drive115State: null,
      servers: SERVERS,
    });
    expect(map.get('ABC-001')).toEqual({ inLibrary: true, realWatched: true, pinned: { inLibrary: true } });
  });

  it('钉住可命中非番号 id 记录（无 videoCode 归一候选也可入账）', () => {
    const records = [record({ id: 'my-note-1', videoCode: '', mediaStateOverrides: { inLibrary: true } })];
    const map = buildMediaStateHitMap({ records, ...NO_INDEX });
    expect(map.get('my-note-1')).toEqual({ inLibrary: true, realWatched: false, pinned: { inLibrary: true } });
  });

  it('脏值 override 不产生命中（回落派生；无索引 → 不入 map）', () => {
    const records = [
      record({ id: 'ABC-001', videoCode: 'abc-001', mediaStateOverrides: { inLibrary: 'yes', realWatched: 1 } }),
    ];
    expect(buildMediaStateHitMap({ records, ...NO_INDEX }).size).toBe(0);
  });
});

describe('filterAndSortRecords × 人工钉住（10-27 pin）', () => {
  it('钉住 realWatched（无索引）→ realWatchedFilterActive 命中；inLibraryFilterActive 不命中', () => {
    const records = [
      record({ id: 'ABC-001', videoCode: 'abc-001', isFavorite: true, updatedAt: 3, mediaStateOverrides: { realWatched: true } }),
      record({ id: 'XYZ-001', videoCode: 'xyz-001', isFavorite: true, updatedAt: 2 }),
    ];
    const map = buildMediaStateHitMap({ records, ...{ embyIndex: null, drive115State: null, servers: SERVERS } });
    const rw = filterAndSortRecords(baseInput({ records, mediaStateHits: map, realWatchedFilterActive: true }));
    expect(rw.map(item => item.id)).toEqual(['ABC-001']);
    const il = filterAndSortRecords(baseInput({ records, mediaStateHits: map, inLibraryFilterActive: true }));
    expect(il).toHaveLength(0);
  });

  it('强制关 inLibrary → 索引命中也不进 inLibrary 筛选', () => {
    const records = [
      record({ id: 'ABC-001', videoCode: 'abc-001', isFavorite: true, updatedAt: 3, mediaStateOverrides: { inLibrary: false } }),
    ];
    const map = buildMediaStateHitMap({
      records,
      embyIndex: makeEmbyIndex({ 'ABC-001': [makeEntry({ userData: { played: true } })] }),
      drive115State: null,
      servers: SERVERS,
    });
    const result = filterAndSortRecords(baseInput({ records, mediaStateHits: map, inLibraryFilterActive: true }));
    expect(result).toHaveLength(0);
  });
});
