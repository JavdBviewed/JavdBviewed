import { describe, expect, it, vi } from 'vitest';
import { updateRecordsLocalFilterState } from './localFilterUpdater';
import type { VideoRecord } from '../../../types';

function record(partial: Partial<VideoRecord>): VideoRecord {
  return {
    id: partial.id || 'ABC-001',
    title: partial.title || '测试标题',
    status: partial.status || 'viewed',
    tags: partial.tags || [],
    listIds: partial.listIds,
    isFavorite: partial.isFavorite,
    createdAt: partial.createdAt || 1,
    updatedAt: partial.updatedAt || 2,
  };
}

describe('records local filter updater', () => {
  it('syncs token selections, refreshes filter controllers, and returns filtered records', () => {
    const selectedTags = new Set(['手动标签', '旧标签']);
    const selectedListIds = new Set(['manual-list']);
    const refreshTags = vi.fn();
    const refreshLists = vi.fn();
    const refreshSeries = vi.fn();
    const refreshLabels = vi.fn();
    const refreshMakers = vi.fn();
    const refreshDirectors = vi.fn();

    const result = updateRecordsLocalFilterState({
      searchText: 'ABC tag:新标签 list:收藏',
      filterValue: 'viewed',
      sortValue: 'updatedAt_desc',
      records: [
        record({ id: 'ABC-001', tags: ['新标签', '手动标签'], listIds: ['list-1'], updatedAt: 3 }),
        record({ id: 'XYZ-001', tags: ['新标签'], listIds: ['list-1'], updatedAt: 2 }),
      ],
      selectedTags,
      tokenSelectedTags: new Set(['旧标签']),
      selectedListIds,
      tokenSelectedListIds: new Set(),
      selectedSeriesIds: new Set(),
      tokenSelectedSeriesIds: new Set(),
      selectedLabelIds: new Set(),
      tokenSelectedLabelIds: new Set(),
      selectedMakerIds: new Set(),
      tokenSelectedMakerIds: new Set(),
      selectedDirectorIds: new Set(),
      tokenSelectedDirectorIds: new Set(),
      listNameById: new Map([['list-1', '我的收藏']]),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      makerIdToRecord: new Map(),
      directorIdToRecord: new Map(),
      advancedConditions: [],
      favoritesFilterActive: false,
      refreshTags,
      refreshLists,
      refreshSeries,
      refreshLabels,
      refreshMakers,
      refreshDirectors,
      onError: vi.fn(),
    });

    expect(result.filteredRecords.map(item => item.id)).toEqual(['ABC-001']);
    expect([...result.tokenSelectedTags]).toEqual(['新标签']);
    expect([...selectedTags].sort()).toEqual(['手动标签', '新标签']);
    expect([...selectedListIds].sort()).toEqual(['list-1', 'manual-list']);
    expect(refreshTags).toHaveBeenCalledTimes(1);
    expect(refreshLists).toHaveBeenCalledTimes(1);
    expect(refreshSeries).toHaveBeenCalledTimes(1);
    expect(refreshLabels).toHaveBeenCalledTimes(1);
    expect(refreshMakers).toHaveBeenCalledTimes(1);
    expect(refreshDirectors).toHaveBeenCalledTimes(1);
  });

  it('returns empty records and reports error when filtering fails', () => {
    const onError = vi.fn();

    const result = updateRecordsLocalFilterState({
      searchText: '',
      filterValue: 'all',
      sortValue: 'updatedAt_desc',
      records: null as unknown as VideoRecord[],
      selectedTags: new Set(),
      tokenSelectedTags: new Set(),
      selectedListIds: new Set(),
      tokenSelectedListIds: new Set(),
      selectedSeriesIds: new Set(),
      tokenSelectedSeriesIds: new Set(),
      selectedLabelIds: new Set(),
      tokenSelectedLabelIds: new Set(),
      selectedMakerIds: new Set(),
      tokenSelectedMakerIds: new Set(),
      selectedDirectorIds: new Set(),
      tokenSelectedDirectorIds: new Set(),
      listNameById: new Map(),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      makerIdToRecord: new Map(),
      directorIdToRecord: new Map(),
      advancedConditions: [],
      favoritesFilterActive: false,
      refreshTags: () => {},
      refreshLists: () => {},
      refreshSeries: () => {},
      refreshLabels: () => {},
      refreshMakers: () => {},
      refreshDirectors: () => {},
      onError,
    });

    expect(result.filteredRecords).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
