import type { VideoRecord } from '../../../types';
import type { RecordsAdvancedCondition } from './advancedConditionModel';
import {
  updateRecordsLocalFilterState,
  type UpdateRecordsLocalFilterStateResult,
} from './localFilterUpdater';
import type { MediaStateHit } from './mediaStateFilterModel';

type UpdateLocalFilterState = typeof updateRecordsLocalFilterState;

export interface CreateRecordsLocalFilterRuntimeOptions {
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  sortSelect: HTMLSelectElement;
  getRecords: () => VideoRecord[];
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  selectedMakerIds: Set<string>;
  selectedDirectorIds: Set<string>;
  getTokenSelectedTags: () => Set<string>;
  setTokenSelectedTags: (value: Set<string>) => void;
  getTokenSelectedListIds: () => Set<string>;
  setTokenSelectedListIds: (value: Set<string>) => void;
  getTokenSelectedSeriesIds: () => Set<string>;
  setTokenSelectedSeriesIds: (value: Set<string>) => void;
  getTokenSelectedLabelIds: () => Set<string>;
  setTokenSelectedLabelIds: (value: Set<string>) => void;
  getTokenSelectedMakerIds: () => Set<string>;
  setTokenSelectedMakerIds: (value: Set<string>) => void;
  getTokenSelectedDirectorIds: () => Set<string>;
  setTokenSelectedDirectorIds: (value: Set<string>) => void;
  listNameById: Map<string, string>;
  seriesIdToRecord: Map<string, any>;
  labelIdToRecord: Map<string, any>;
  makerIdToRecord: Map<string, any>;
  directorIdToRecord: Map<string, any>;
  getAdvancedConditions: () => RecordsAdvancedCondition[];
  isFavoritesFilterActive: () => boolean;
  /** 媒体库状态筛选（10-24，可选；缺省=零行为变化）。 */
  getMediaStateHits?: () => ReadonlyMap<string, MediaStateHit> | null;
  isInLibraryFilterActive?: () => boolean;
  isRealWatchedFilterActive?: () => boolean;
  refreshTags: () => void;
  refreshLists: () => void;
  refreshSeries: () => void;
  refreshLabels: () => void;
  refreshMakers: () => void;
  refreshDirectors: () => void;
  setFilteredRecords: (records: VideoRecord[]) => void;
  logError?: (message: string, error: unknown) => void;
  updateLocalFilterState?: UpdateLocalFilterState;
}

export interface RecordsLocalFilterRuntime {
  updateFilteredRecords: () => void;
}

export function createRecordsLocalFilterRuntime(
  options: CreateRecordsLocalFilterRuntimeOptions,
): RecordsLocalFilterRuntime {
  const updateLocalFilterState = options.updateLocalFilterState || updateRecordsLocalFilterState;
  const logError = options.logError || ((message: string, error: unknown) => {
    console.error(message, error);
  });

  const applyResult = (result: UpdateRecordsLocalFilterStateResult): void => {
    options.setFilteredRecords(result.filteredRecords);
    options.setTokenSelectedTags(result.tokenSelectedTags);
    options.setTokenSelectedListIds(result.tokenSelectedListIds);
    options.setTokenSelectedSeriesIds(result.tokenSelectedSeriesIds);
    options.setTokenSelectedLabelIds(result.tokenSelectedLabelIds);
    options.setTokenSelectedMakerIds(result.tokenSelectedMakerIds);
    options.setTokenSelectedDirectorIds(result.tokenSelectedDirectorIds);
  };

  const updateFilteredRecords = (): void => {
    try {
      const records = options.getRecords();
      const result = updateLocalFilterState({
        searchText: options.searchInput.value,
        filterValue: options.filterSelect.value as VideoRecord['status'] | 'all',
        sortValue: options.sortSelect.value,
        records: Array.isArray(records) ? records : [],
        selectedTags: options.selectedTags,
        tokenSelectedTags: options.getTokenSelectedTags(),
        selectedListIds: options.selectedListIds,
        tokenSelectedListIds: options.getTokenSelectedListIds(),
        selectedSeriesIds: options.selectedSeriesIds,
        tokenSelectedSeriesIds: options.getTokenSelectedSeriesIds(),
        selectedLabelIds: options.selectedLabelIds,
        tokenSelectedLabelIds: options.getTokenSelectedLabelIds(),
        selectedMakerIds: options.selectedMakerIds,
        tokenSelectedMakerIds: options.getTokenSelectedMakerIds(),
        selectedDirectorIds: options.selectedDirectorIds,
        tokenSelectedDirectorIds: options.getTokenSelectedDirectorIds(),
        listNameById: options.listNameById,
        seriesIdToRecord: options.seriesIdToRecord,
        labelIdToRecord: options.labelIdToRecord,
        makerIdToRecord: options.makerIdToRecord,
        directorIdToRecord: options.directorIdToRecord,
        advancedConditions: options.getAdvancedConditions(),
        favoritesFilterActive: options.isFavoritesFilterActive(),
        mediaStateHits: options.getMediaStateHits?.() ?? undefined,
        inLibraryFilterActive: options.isInLibraryFilterActive?.() ?? false,
        realWatchedFilterActive: options.isRealWatchedFilterActive?.() ?? false,
        refreshTags: options.refreshTags,
        refreshLists: options.refreshLists,
        refreshSeries: options.refreshSeries,
        refreshLabels: options.refreshLabels,
        refreshMakers: options.refreshMakers,
        refreshDirectors: options.refreshDirectors,
        onError: (error) => {
          logError('[Records] 更新过滤记录时出错:', error);
        },
      });

      applyResult(result);
    } catch (error) {
      logError('[Records] 更新过滤记录时出错:', error);
      options.setFilteredRecords([]);
    }
  };

  return { updateFilteredRecords };
}
