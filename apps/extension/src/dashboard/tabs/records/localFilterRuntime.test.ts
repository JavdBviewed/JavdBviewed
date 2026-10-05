import { describe, expect, it, vi } from 'vitest';
import { createRecordsLocalFilterRuntime } from './localFilterRuntime';
import type { VideoRecord } from '../../../types';
import type { UpdateRecordsLocalFilterStateResult } from './localFilterUpdater';

function record(id: string): VideoRecord {
  return {
    id,
    title: id,
    status: 'viewed',
    createdAt: 1,
    updatedAt: 2,
  };
}

function result(partial: Partial<UpdateRecordsLocalFilterStateResult> = {}): UpdateRecordsLocalFilterStateResult {
  return {
    filteredRecords: partial.filteredRecords || [record('AAA-001')],
    parsedTokens: null,
    tokenSelectedTags: partial.tokenSelectedTags || new Set(['字幕']),
    tokenSelectedListIds: partial.tokenSelectedListIds || new Set(['list-1']),
    tokenSelectedSeriesIds: partial.tokenSelectedSeriesIds || new Set(['series-1']),
    tokenSelectedLabelIds: partial.tokenSelectedLabelIds || new Set(['label-1']),
    tokenSelectedMakerIds: partial.tokenSelectedMakerIds || new Set(['maker-1']),
    tokenSelectedDirectorIds: partial.tokenSelectedDirectorIds || new Set(['director-1']),
  };
}

function createRuntime(overrides: Partial<Parameters<typeof createRecordsLocalFilterRuntime>[0]> = {}) {
  const state = {
    filteredRecords: [] as VideoRecord[],
    tokenSelectedTags: new Set<string>(['old-tag']),
    tokenSelectedListIds: new Set<string>(['old-list']),
    tokenSelectedSeriesIds: new Set<string>(['old-series']),
    tokenSelectedLabelIds: new Set<string>(['old-label']),
    tokenSelectedMakerIds: new Set<string>(['old-maker']),
    tokenSelectedDirectorIds: new Set<string>(['old-director']),
  };
  const refreshTags = vi.fn();
  const refreshLists = vi.fn();
  const refreshSeries = vi.fn();
  const refreshLabels = vi.fn();
  const refreshMakers = vi.fn();
  const refreshDirectors = vi.fn();
  const updateLocalFilterState = vi.fn(() => result());
  const logError = vi.fn();
  const records = [record('AAA-001')];

  const options = {
    searchInput: { value: 'AAA tag:字幕' } as HTMLInputElement,
    filterSelect: { value: 'viewed' } as HTMLSelectElement,
    sortSelect: { value: 'updatedAt_desc' } as HTMLSelectElement,
    getRecords: () => records,
    selectedTags: new Set<string>(),
    selectedListIds: new Set<string>(),
    selectedSeriesIds: new Set<string>(),
    selectedLabelIds: new Set<string>(),
    selectedMakerIds: new Set<string>(),
    selectedDirectorIds: new Set<string>(),
    getTokenSelectedTags: () => state.tokenSelectedTags,
    setTokenSelectedTags: (value: Set<string>) => {
      state.tokenSelectedTags = value;
    },
    getTokenSelectedListIds: () => state.tokenSelectedListIds,
    setTokenSelectedListIds: (value: Set<string>) => {
      state.tokenSelectedListIds = value;
    },
    getTokenSelectedSeriesIds: () => state.tokenSelectedSeriesIds,
    setTokenSelectedSeriesIds: (value: Set<string>) => {
      state.tokenSelectedSeriesIds = value;
    },
    getTokenSelectedLabelIds: () => state.tokenSelectedLabelIds,
    setTokenSelectedLabelIds: (value: Set<string>) => {
      state.tokenSelectedLabelIds = value;
    },
    getTokenSelectedMakerIds: () => state.tokenSelectedMakerIds,
    setTokenSelectedMakerIds: (value: Set<string>) => {
      state.tokenSelectedMakerIds = value;
    },
    getTokenSelectedDirectorIds: () => state.tokenSelectedDirectorIds,
    setTokenSelectedDirectorIds: (value: Set<string>) => {
      state.tokenSelectedDirectorIds = value;
    },
    listNameById: new Map<string, string>(),
    seriesIdToRecord: new Map<string, any>(),
    labelIdToRecord: new Map<string, any>(),
    makerIdToRecord: new Map<string, any>(),
    directorIdToRecord: new Map<string, any>(),
    getAdvancedConditions: () => [],
    isFavoritesFilterActive: () => false,
    refreshTags,
    refreshLists,
    refreshSeries,
    refreshLabels,
    refreshMakers,
    refreshDirectors,
    setFilteredRecords: (value: VideoRecord[]) => {
      state.filteredRecords = value;
    },
    logError,
    updateLocalFilterState,
    ...overrides,
  };

  return {
    runtime: createRecordsLocalFilterRuntime(options),
    options,
    state,
    records,
    updateLocalFilterState,
    refreshTags,
    refreshLists,
    refreshSeries,
    refreshLabels,
    refreshMakers,
    refreshDirectors,
    logError,
  };
}

describe('records local filter runtime', () => {
  it('passes current page state to the local filter updater and writes back results', () => {
    const { runtime, options, state, records, updateLocalFilterState } = createRuntime();

    runtime.updateFilteredRecords();

    expect(updateLocalFilterState).toHaveBeenCalledWith(expect.objectContaining({
      searchText: 'AAA tag:字幕',
      filterValue: 'viewed',
      sortValue: 'updatedAt_desc',
      records,
      selectedTags: options.selectedTags,
      tokenSelectedTags: new Set(['old-tag']),
      selectedListIds: options.selectedListIds,
      tokenSelectedListIds: new Set(['old-list']),
      selectedSeriesIds: options.selectedSeriesIds,
      tokenSelectedSeriesIds: new Set(['old-series']),
      selectedLabelIds: options.selectedLabelIds,
      tokenSelectedLabelIds: new Set(['old-label']),
      tokenSelectedMakerIds: new Set(['old-maker']),
      tokenSelectedDirectorIds: new Set(['old-director']),
      listNameById: options.listNameById,
      seriesIdToRecord: options.seriesIdToRecord,
      labelIdToRecord: options.labelIdToRecord,
      makerIdToRecord: options.makerIdToRecord,
      directorIdToRecord: options.directorIdToRecord,
      advancedConditions: [],
      favoritesFilterActive: false,
      refreshTags: options.refreshTags,
      refreshLists: options.refreshLists,
      refreshSeries: options.refreshSeries,
      refreshLabels: options.refreshLabels,
      refreshMakers: options.refreshMakers,
      refreshDirectors: options.refreshDirectors,
      onError: expect.any(Function),
    }));
    expect(state.filteredRecords.map(item => item.id)).toEqual(['AAA-001']);
    expect([...state.tokenSelectedTags]).toEqual(['字幕']);
    expect([...state.tokenSelectedListIds]).toEqual(['list-1']);
    expect([...state.tokenSelectedSeriesIds]).toEqual(['series-1']);
    expect([...state.tokenSelectedLabelIds]).toEqual(['label-1']);
    expect([...state.tokenSelectedMakerIds]).toEqual(['maker-1']);
    expect([...state.tokenSelectedDirectorIds]).toEqual(['director-1']);
  });

  it('uses empty records when the global record list is unavailable', () => {
    const { runtime, updateLocalFilterState } = createRuntime({
      getRecords: () => null as unknown as VideoRecord[],
    });

    runtime.updateFilteredRecords();

    expect(updateLocalFilterState.mock.calls[0][0].records).toEqual([]);
  });

  it('logs nested updater errors through the runtime logger', () => {
    const nestedError = new Error('nested');
    const { runtime, updateLocalFilterState, logError } = createRuntime();
    updateLocalFilterState.mockImplementationOnce((input) => {
      input.onError(nestedError);
      return result({ filteredRecords: [] });
    });

    runtime.updateFilteredRecords();

    expect(logError).toHaveBeenCalledWith('[Records] 更新过滤记录时出错:', nestedError);
  });

  it('clears filtered records when updater throws', () => {
    const error = new Error('boom');
    const { runtime, state, updateLocalFilterState, logError } = createRuntime();
    state.filteredRecords = [record('OLD-001')];
    updateLocalFilterState.mockImplementationOnce(() => {
      throw error;
    });

    runtime.updateFilteredRecords();

    expect(state.filteredRecords).toEqual([]);
    expect(logError).toHaveBeenCalledWith('[Records] 更新过滤记录时出错:', error);
  });
});
