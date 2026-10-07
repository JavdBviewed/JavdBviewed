/**
 * @file mediaStateFilterModel.test.ts
 * @description records 媒体库状态筛选（10-24）：命中映射纯函数 + filterAndSortRecords 新维度
 * @module apps/extension/src/dashboard/tabs/records
 */
import { describe, expect, it } from 'vitest';
import {
  buildMediaStateHitMap,
  getMediaStateRecordKey,
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
