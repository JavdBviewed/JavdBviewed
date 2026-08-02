import { describe, expect, it } from 'vitest';
import { filterAndSortRecords } from './filterModel';
import type { VideoRecord } from '../../../types';
import type { RecordsAdvancedCondition } from './advancedConditionModel';

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
    isFavorite: partial.isFavorite,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
  };
}

describe('records filter model', () => {
  it('filters by text, status, selected tags, lists, and favorite state', () => {
    const records = [
      record({ id: 'ABC-001', title: '标题 A', status: 'viewed', tags: ['中文字幕'], listIds: ['list-1'], isFavorite: true, updatedAt: 3 }),
      record({ id: 'ABC-002', title: '标题 B', status: 'viewed', tags: ['无码'], listIds: ['list-2'], isFavorite: true, updatedAt: 2 }),
      record({ id: 'XYZ-001', title: '标题 C', status: 'want', tags: ['中文字幕'], listIds: ['list-1'], isFavorite: false, updatedAt: 1 }),
    ];

    const result = filterAndSortRecords({
      records,
      searchTerm: 'abc',
      status: 'viewed',
      selectedTags: new Set(['中文']),
      selectedListIds: new Set(['list-1']),
      selectedSeriesIds: new Set(),
      selectedLabelIds: new Set(),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      advancedConditions: [],
      favoritesFilterActive: true,
      sortValue: 'updatedAt_desc',
    });

    expect(result.map(item => item.id)).toEqual(['ABC-001']);
  });

  it('matches series and label filters with fallback rules', () => {
    const records = [
      record({ id: 'FC2-123', series: 'My Series', seriesUrl: 'https://javdb.com/series/s1' }),
      record({ id: 'HEYZO-123', series: 'Other', seriesUrl: 'https://javdb.com/series/s2' }),
    ];

    const result = filterAndSortRecords({
      records,
      searchTerm: '',
      status: 'all',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      selectedSeriesIds: new Set(['s1']),
      selectedLabelIds: new Set(['fc2']),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      advancedConditions: [],
      favoritesFilterActive: false,
      sortValue: 'updatedAt_desc',
    });

    expect(result.map(item => item.id)).toEqual(['FC2-123']);
  });

  it('matches search text and selected tags against local user tags', () => {
    const result = filterAndSortRecords({
      records: [
        record({ id: 'ABC-001', userTags: ['精选'] }),
        record({ id: 'ABC-002', userTags: ['待整理'] }),
      ],
      searchTerm: '精选',
      status: 'all',
      selectedTags: new Set(['精选']),
      selectedListIds: new Set(),
      selectedSeriesIds: new Set(),
      selectedLabelIds: new Set(),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      advancedConditions: [],
      favoritesFilterActive: false,
      sortValue: 'id_asc',
    });

    expect(result.map(item => item.id)).toEqual(['ABC-001']);
  });

  it('applies advanced conditions and sort order', () => {
    const advancedConditions: RecordsAdvancedCondition[] = [
      { id: 'cond-1', field: 'tags', op: 'includes_all', value: '字幕' },
    ];
    const records = [
      record({ id: 'B-001', tags: ['字幕'], createdAt: 2 }),
      record({ id: 'A-001', tags: ['字幕'], createdAt: 1 }),
      record({ id: 'C-001', tags: ['高清'], createdAt: 3 }),
    ];

    const result = filterAndSortRecords({
      records,
      searchTerm: '',
      status: 'all',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      selectedSeriesIds: new Set(),
      selectedLabelIds: new Set(),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      advancedConditions,
      favoritesFilterActive: false,
      sortValue: 'id_asc',
    });

    expect(result.map(item => item.id)).toEqual(['A-001', 'B-001']);
  });

  it('filters records by official and personal ratings', () => {
    const result = filterAndSortRecords({
      records: [
        record({ id: 'R-8', rating: 8.5, userRating: 4 }),
        record({ id: 'R-0', rating: 0, userRating: 0 }),
        record({ id: 'R-7', rating: 7, userRating: undefined }),
      ],
      searchTerm: '',
      status: 'all',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      selectedSeriesIds: new Set(),
      selectedLabelIds: new Set(),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      advancedConditions: [
        { id: 'rating', field: 'rating', op: 'gte', value: '8' },
        { id: 'user-rating', field: 'userRating', op: 'not_empty' },
      ],
      favoritesFilterActive: false,
      sortValue: 'id_asc',
    });

    expect(result.map(item => item.id)).toEqual(['R-8']);
  });
});
