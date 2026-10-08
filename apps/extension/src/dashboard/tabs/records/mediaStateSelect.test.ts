/**
 * @file mediaStateSelect.test.ts
 * @description records 媒体库状态筛选并入 #filterSelect（10-08）：
 * 值域映射纯函数 parseMediaStateSelectValue / 自保复位 applyServerModeMediaStateReset /
 * 经 filterAndSortRecords 的过滤行为（单选互斥、复位、与 tags AND 叠加）。
 * @module apps/extension/src/dashboard/tabs/records
 */
import { describe, expect, it } from 'vitest';
import type { VideoRecord } from '../../../types';
import {
  MEDIA_STATE_SELECT_VALUES,
  isMediaStateSelectValue,
  parseMediaStateSelectValue,
} from './filterModel';
import { applyServerModeMediaStateReset } from './viewToolbarController';
import { filterAndSortRecords } from './filterModel';
import { getMediaStateRecordKey } from './mediaStateFilterModel';
import type { MediaStateHit } from './mediaStateFilterModel';

function record(partial: Partial<VideoRecord>): VideoRecord {
  return {
    id: partial.id || 'ABC-001',
    title: partial.title || '测试标题',
    status: partial.status || 'browsed',
    tags: partial.tags || [],
    userTags: partial.userTags,
    listIds: partial.listIds,
    isFavorite: partial.isFavorite,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
  };
}

function hitMap(entries: Array<[string, MediaStateHit]>): Map<string, MediaStateHit> {
  return new Map(entries);
}

const EMPTY_INPUTS = {
  searchTerm: '',
  selectedTags: new Set<string>(),
  selectedListIds: new Set<string>(),
  selectedSeriesIds: new Set<string>(),
  selectedLabelIds: new Set<string>(),
  selectedMakerIds: new Set<string>(),
  selectedDirectorIds: new Set<string>(),
  seriesIdToRecord: new Map(),
  labelIdToRecord: new Map(),
  makerIdToRecord: new Map(),
  directorIdToRecord: new Map(),
  advancedConditions: [] as never[],
  favoritesFilterActive: false,
  sortValue: 'updatedAt_desc',
};

describe('parseMediaStateSelectValue（#filterSelect 值域映射，10-08）', () => {
  it('值域常量=两媒体项', () => {
    expect(MEDIA_STATE_SELECT_VALUES).toEqual(['inLibrary', 'realWatched']);
  });

  it('all/空值/未知值 → status 透传、双开关皆 false', () => {
    for (const value of ['all', '', undefined, 'viewed', 'untracked', 'browsed', 'want']) {
      const parsed = parseMediaStateSelectValue(value);
      expect(parsed.inLibraryFilterActive).toBe(false);
      expect(parsed.realWatchedFilterActive).toBe(false);
      expect(parsed.status).toBe(value || 'all');
    }
  });

  it('inLibrary → status 复位 all + 仅 inLibrary 开关', () => {
    const parsed = parseMediaStateSelectValue('inLibrary');
    expect(parsed).toEqual({ status: 'all', inLibraryFilterActive: true, realWatchedFilterActive: false });
  });

  it('realWatched → status 复位 all + 仅 realWatched 开关（单选互斥）', () => {
    const parsed = parseMediaStateSelectValue('realWatched');
    expect(parsed).toEqual({ status: 'all', inLibraryFilterActive: false, realWatchedFilterActive: true });
  });

  it('isMediaStateSelectValue 判定', () => {
    expect(isMediaStateSelectValue('inLibrary')).toBe(true);
    expect(isMediaStateSelectValue('realWatched')).toBe(true);
    expect(isMediaStateSelectValue('all')).toBe(false);
    expect(isMediaStateSelectValue('viewed')).toBe(false);
    expect(isMediaStateSelectValue('')).toBe(false);
    expect(isMediaStateSelectValue(undefined)).toBe(false);
  });
});

describe('applyServerModeMediaStateReset（server 分页自保，10-24 语义换绑 select）', () => {
  it('进入 server 且当前值=inLibrary → 复位 all + 返回 true', () => {
    const select = { value: 'inLibrary' };
    expect(applyServerModeMediaStateReset(select, true)).toBe(true);
    expect(select.value).toBe('all');
  });

  it('进入 server 且当前值=realWatched → 复位 all + 返回 true', () => {
    const select = { value: 'realWatched' };
    expect(applyServerModeMediaStateReset(select, true)).toBe(true);
    expect(select.value).toBe('all');
  });

  it('进入 server 但当前值=状态项 → 不动 + 返回 false', () => {
    const select = { value: 'viewed' };
    expect(applyServerModeMediaStateReset(select, true)).toBe(false);
    expect(select.value).toBe('viewed');
  });

  it('非进入 server（切回本地/初始） → 不动 + 返回 false', () => {
    const select = { value: 'inLibrary' };
    expect(applyServerModeMediaStateReset(select, false)).toBe(false);
    expect(select.value).toBe('inLibrary');
  });

  it('select 缺失 → false 不抛', () => {
    expect(applyServerModeMediaStateReset(null, true)).toBe(false);
    expect(applyServerModeMediaStateReset(undefined, true)).toBe(false);
  });
});

describe('filterAndSelect 值映射后的媒体库过滤行为（经 filterAndSortRecords）', () => {
  const records = [
    record({ id: 'ABC-001', status: 'viewed', tags: ['中文字幕'], updatedAt: 3 }),
    record({ id: 'ABC-002', status: 'viewed', tags: ['无码'], updatedAt: 2 }),
    record({ id: 'XYZ-001', status: 'want', tags: ['中文字幕'], updatedAt: 1 }),
  ];
  const hits = hitMap([
    [getMediaStateRecordKey(records[0]), { inLibrary: true, realWatched: false }],
    [getMediaStateRecordKey(records[1]), { inLibrary: true, realWatched: true }],
    [getMediaStateRecordKey(records[2]), { inLibrary: false, realWatched: true }],
  ]);

  it('inLibrary 单选 → 只留 inLibrary 命中', () => {
    const parsed = parseMediaStateSelectValue('inLibrary');
    const result = filterAndSortRecords({
      records,
      ...EMPTY_INPUTS,
      status: parsed.status,
      mediaStateHits: hits,
      inLibraryFilterActive: parsed.inLibraryFilterActive,
      realWatchedFilterActive: parsed.realWatchedFilterActive,
    });
    expect(result.map(item => item.id).sort()).toEqual(['ABC-001', 'ABC-002']);
  });

  it('realWatched 单选 → 只留 realWatched 命中', () => {
    const parsed = parseMediaStateSelectValue('realWatched');
    const result = filterAndSortRecords({
      records,
      ...EMPTY_INPUTS,
      status: parsed.status,
      mediaStateHits: hits,
      inLibraryFilterActive: parsed.inLibraryFilterActive,
      realWatchedFilterActive: parsed.realWatchedFilterActive,
    });
    expect(result.map(item => item.id).sort()).toEqual(['ABC-002', 'XYZ-001']);
  });

  it('复位 all → 全量恢复（谓词零命中不抑制）', () => {
    const parsed = parseMediaStateSelectValue('all');
    const result = filterAndSortRecords({
      records,
      ...EMPTY_INPUTS,
      status: parsed.status,
      mediaStateHits: hits,
      inLibraryFilterActive: parsed.inLibraryFilterActive,
      realWatchedFilterActive: parsed.realWatchedFilterActive,
    });
    expect(result.map(item => item.id)).toHaveLength(3);
  });

  it('媒体项 status 复位 all：状态过滤不参与（原 viewed 语义不被媒体项吞掉）', () => {
    const parsed = parseMediaStateSelectValue('inLibrary');
    expect(parsed.status).toBe('all');
    const result = filterAndSortRecords({
      records,
      ...EMPTY_INPUTS,
      status: parsed.status,
      mediaStateHits: hits,
      inLibraryFilterActive: parsed.inLibraryFilterActive,
      realWatchedFilterActive: parsed.realWatchedFilterActive,
    });
    // want 状态的 XYZ-001 不在 inLibrary 命中 → 排除由媒体谓词完成而非状态谓词
    expect(result.some(item => item.id === 'XYZ-001')).toBe(false);
  });

  it('与 tags 多选 AND 叠加（既有语义不动）', () => {
    const parsed = parseMediaStateSelectValue('inLibrary');
    const result = filterAndSortRecords({
      records,
      ...EMPTY_INPUTS,
      status: parsed.status,
      selectedTags: new Set(['中文']),
      mediaStateHits: hits,
      inLibraryFilterActive: parsed.inLibraryFilterActive,
      realWatchedFilterActive: parsed.realWatchedFilterActive,
    });
    expect(result.map(item => item.id)).toEqual(['ABC-001']);
  });
});
