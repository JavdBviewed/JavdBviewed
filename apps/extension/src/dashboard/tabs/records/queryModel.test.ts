import { describe, expect, it } from 'vitest';
import {
  buildRecordsViewedPageParams,
  buildRecordsViewedQueryParams,
  parseRecordsSortValue,
  resolveRecordsListFilterIds,
  shouldUseRecordsQueryMode,
} from './queryModel';
import type { RecordsAdvancedCondition } from './advancedConditionModel';
import type { RecordsSearchTokens } from './searchQueryModel';

const emptyTokens: RecordsSearchTokens = {
  text: '',
  tags: [],
  listIds: [],
  listNames: [],
  seriesIds: [],
  labelPrefixes: [],
};

describe('records query model', () => {
  it('parses supported records sort values', () => {
    expect(parseRecordsSortValue('updatedAt_asc')).toEqual({ orderBy: 'updatedAt', order: 'asc' });
    expect(parseRecordsSortValue('createdAt_desc')).toEqual({ orderBy: 'createdAt', order: 'desc' });
    expect(parseRecordsSortValue('id_desc')).toEqual({ orderBy: 'id', order: 'desc' });
    expect(parseRecordsSortValue('title_asc')).toEqual({ orderBy: 'title', order: 'asc' });
    expect(parseRecordsSortValue('unknown')).toBeNull();
  });

  it('resolves selected list ids, token ids, and case-insensitive list names', () => {
    const listIds = resolveRecordsListFilterIds({
      selectedListIds: new Set(['list-a']),
      parsedListIds: ['list-b', 'list-a'],
      parsedListNames: ['收藏'],
      listNameById: new Map([
        ['list-c', '我的收藏'],
        ['list-d', '其他清单'],
      ]),
    });

    expect(listIds).toEqual(['list-a', 'list-b', 'list-c']);
  });

  it('detects when server query mode is required', () => {
    expect(shouldUseRecordsQueryMode({
      searchTerm: '',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      parsedTokens: emptyTokens,
      advancedConditions: [],
      sort: { orderBy: 'updatedAt', order: 'desc' },
      favoritesFilterActive: false,
    })).toBe(false);

    expect(shouldUseRecordsQueryMode({
      searchTerm: 'abc',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      parsedTokens: emptyTokens,
      advancedConditions: [],
      sort: { orderBy: 'updatedAt', order: 'desc' },
      favoritesFilterActive: false,
    })).toBe(true);

    expect(shouldUseRecordsQueryMode({
      searchTerm: '',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      parsedTokens: emptyTokens,
      advancedConditions: [],
      sort: { orderBy: 'title', order: 'asc' },
      favoritesFilterActive: false,
    })).toBe(true);
  });

  it('builds viewed query params with deduplicated tags, list ids, advanced conditions, and favorite state', () => {
    const advancedConditions: RecordsAdvancedCondition[] = [
      { id: 'cond-1', field: 'createdAt', op: 'gte', value: '1000' },
    ];

    const params = buildRecordsViewedQueryParams({
      parsedTokens: {
        ...emptyTokens,
        text: 'MKMP',
        tags: ['字幕', '高清'],
        listIds: ['list-b'],
        listNames: ['收藏'],
      },
      selectedTags: new Set(['字幕']),
      selectedListIds: new Set(['list-a']),
      listNameById: new Map([['list-c', '我的收藏']]),
      status: 'viewed',
      sort: { orderBy: 'title', order: 'asc' },
      offset: 20,
      limit: 10,
      advancedConditions,
      favoritesFilterActive: true,
    });

    expect(params).toEqual({
      search: 'MKMP',
      status: 'viewed',
      tags: ['字幕', '高清'],
      listIds: ['list-a', 'list-b', 'list-c'],
      orderBy: 'title',
      order: 'asc',
      offset: 20,
      limit: 10,
      adv: [{ field: 'createdAt', op: 'gte', value: '1000' }],
      isFavorite: true,
    });
  });

  it('passes rating advanced conditions through query mode', () => {
    const params = buildRecordsViewedQueryParams({
      parsedTokens: emptyTokens,
      selectedTags: new Set(),
      selectedListIds: new Set(),
      listNameById: new Map(),
      status: 'all',
      sort: { orderBy: 'updatedAt', order: 'desc' },
      offset: 0,
      limit: 20,
      advancedConditions: [{ id: 'rating', field: 'rating', op: 'gte', value: '8' }],
      favoritesFilterActive: false,
    });

    expect(shouldUseRecordsQueryMode({
      searchTerm: '',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      parsedTokens: emptyTokens,
      advancedConditions: [{ id: 'rating', field: 'rating', op: 'gte', value: '8' }],
      sort: { orderBy: 'updatedAt', order: 'desc' },
      favoritesFilterActive: false,
    })).toBe(true);
    expect(params.adv).toEqual([{ field: 'rating', op: 'gte', value: '8' }]);
  });

  it('builds page params only for page-safe sort fields', () => {
    expect(buildRecordsViewedPageParams({
      status: 'all',
      sort: { orderBy: 'updatedAt', order: 'desc' },
      offset: 0,
      limit: 20,
    })).toEqual({
      offset: 0,
      limit: 20,
      orderBy: 'updatedAt',
      order: 'desc',
    });

    expect(buildRecordsViewedPageParams({
      status: 'want',
      sort: { orderBy: 'createdAt', order: 'asc' },
      offset: 20,
      limit: 20,
    })).toEqual({
      offset: 20,
      limit: 20,
      orderBy: 'createdAt',
      order: 'asc',
      status: 'want',
    });
  });
});
