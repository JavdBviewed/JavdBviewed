import type { VideoRecord } from '../../../types';
import type { RecordsAdvancedCondition } from './advancedConditionModel';
import { filterAndSortRecords } from './filterModel';
import type { RecordsSearchTokens } from './searchQueryModel';
import { parseRecordsSearchTokens } from './searchQueryModel';
import { syncRecordsTokenSelections } from './tokenSelectionModel';

export interface UpdateRecordsLocalFilterStateInput {
  searchText: string;
  filterValue: VideoRecord['status'] | 'all';
  sortValue: string;
  records: VideoRecord[];
  selectedTags: Set<string>;
  tokenSelectedTags: Set<string>;
  selectedListIds: Set<string>;
  tokenSelectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  tokenSelectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  tokenSelectedLabelIds: Set<string>;
  selectedMakerIds: Set<string>;
  tokenSelectedMakerIds: Set<string>;
  selectedDirectorIds: Set<string>;
  tokenSelectedDirectorIds: Set<string>;
  listNameById: Map<string, string>;
  seriesIdToRecord: Map<string, any>;
  labelIdToRecord: Map<string, any>;
  makerIdToRecord: Map<string, any>;
  directorIdToRecord: Map<string, any>;
  advancedConditions: RecordsAdvancedCondition[];
  favoritesFilterActive: boolean;
  refreshTags: () => void;
  refreshLists: () => void;
  refreshSeries: () => void;
  refreshLabels: () => void;
  refreshMakers: () => void;
  refreshDirectors: () => void;
  onError: (error: unknown) => void;
}

export interface UpdateRecordsLocalFilterStateResult {
  filteredRecords: VideoRecord[];
  parsedTokens: RecordsSearchTokens | null;
  tokenSelectedTags: Set<string>;
  tokenSelectedListIds: Set<string>;
  tokenSelectedSeriesIds: Set<string>;
  tokenSelectedLabelIds: Set<string>;
  tokenSelectedMakerIds: Set<string>;
  tokenSelectedDirectorIds: Set<string>;
}

function safeRefresh(callback: () => void): void {
  try {
    callback();
  } catch {}
}

export function updateRecordsLocalFilterState(
  input: UpdateRecordsLocalFilterStateInput,
): UpdateRecordsLocalFilterStateResult {
  try {
    const parsed = parseRecordsSearchTokens(input.searchText);
    const tokenSelectionResult = syncRecordsTokenSelections({
      parsedTokens: parsed,
      selectedTags: input.selectedTags,
      tokenSelectedTags: input.tokenSelectedTags,
      selectedListIds: input.selectedListIds,
      tokenSelectedListIds: input.tokenSelectedListIds,
      selectedSeriesIds: input.selectedSeriesIds,
      tokenSelectedSeriesIds: input.tokenSelectedSeriesIds,
      selectedLabelIds: input.selectedLabelIds,
      tokenSelectedLabelIds: input.tokenSelectedLabelIds,
      selectedMakerIds: input.selectedMakerIds,
      tokenSelectedMakerIds: input.tokenSelectedMakerIds,
      selectedDirectorIds: input.selectedDirectorIds,
      tokenSelectedDirectorIds: input.tokenSelectedDirectorIds,
      listNameById: input.listNameById,
    });

    safeRefresh(input.refreshTags);
    safeRefresh(input.refreshLists);
    safeRefresh(input.refreshSeries);
    safeRefresh(input.refreshLabels);
    safeRefresh(input.refreshMakers);
    safeRefresh(input.refreshDirectors);

    const filteredRecords = filterAndSortRecords({
      records: Array.isArray(input.records) ? input.records : (() => { throw new Error('records must be an array'); })(),
      searchTerm: parsed.text.toLowerCase(),
      status: input.filterValue,
      selectedTags: input.selectedTags,
      selectedListIds: input.selectedListIds,
      selectedSeriesIds: input.selectedSeriesIds,
      selectedLabelIds: input.selectedLabelIds,
      selectedMakerIds: input.selectedMakerIds,
      selectedDirectorIds: input.selectedDirectorIds,
      seriesIdToRecord: input.seriesIdToRecord,
      labelIdToRecord: input.labelIdToRecord,
      makerIdToRecord: input.makerIdToRecord,
      directorIdToRecord: input.directorIdToRecord,
      advancedConditions: input.advancedConditions,
      favoritesFilterActive: input.favoritesFilterActive,
      sortValue: input.sortValue,
    });

    return {
      filteredRecords,
      parsedTokens: parsed,
      ...tokenSelectionResult,
    };
  } catch (error) {
    input.onError(error);
    return {
      filteredRecords: [],
      parsedTokens: null,
      tokenSelectedTags: input.tokenSelectedTags,
      tokenSelectedListIds: input.tokenSelectedListIds,
      tokenSelectedSeriesIds: input.tokenSelectedSeriesIds,
      tokenSelectedLabelIds: input.tokenSelectedLabelIds,
      tokenSelectedMakerIds: input.tokenSelectedMakerIds,
      tokenSelectedDirectorIds: input.tokenSelectedDirectorIds,
    };
  }
}
