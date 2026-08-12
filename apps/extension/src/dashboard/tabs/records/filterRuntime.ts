import type { VideoRecord } from '../../../types';
import type { RecordsAdvancedCondition } from './advancedConditionModel';
import {
  createRecordsDropdownBackdropController,
  type RecordsDropdownBackdropController,
} from './dropdownBackdropController';
import {
  createRecordsFilterControllers,
  type RecordsFilterControllers,
  type RecordsFilterControllersElements,
} from './filterControllersFactory';
import {
  createRecordsLocalFilterRuntime,
  type RecordsLocalFilterRuntime,
} from './localFilterRuntime';
import type { RecordsFilterElements } from './pageElements';

export interface RecordsFilterRuntimeElements {
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  sortSelect: HTMLSelectElement;
  filters: {
    tags: RecordsFilterElements;
    lists: RecordsFilterElements;
    series: RecordsFilterElements;
    labels: RecordsFilterElements;
  };
}

export interface CreateRecordsFilterRuntimeOptions {
  elements: RecordsFilterRuntimeElements;
  getRecords: () => VideoRecord[];
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  getTokenSelectedTags: () => Set<string>;
  setTokenSelectedTags: (value: Set<string>) => void;
  getTokenSelectedListIds: () => Set<string>;
  setTokenSelectedListIds: (value: Set<string>) => void;
  getTokenSelectedSeriesIds: () => Set<string>;
  setTokenSelectedSeriesIds: (value: Set<string>) => void;
  getTokenSelectedLabelIds: () => Set<string>;
  setTokenSelectedLabelIds: (value: Set<string>) => void;
  getAllTags: () => string[];
  listNameById: Map<string, string>;
  listSourceById: Map<string, string>;
  seriesNameById: Map<string, string>;
  labelNameById: Map<string, string>;
  seriesIdToRecord: Map<string, any>;
  labelIdToRecord: Map<string, any>;
  ensureListMetaLoaded: () => void;
  getAdvancedConditions: () => RecordsAdvancedCondition[];
  isFavoritesFilterActive: () => boolean;
  setFilteredRecords: (records: VideoRecord[]) => void;
  onFilterChanged: () => void;
  escapeHtml?: (value: string) => string;
  createFilterControllers?: typeof createRecordsFilterControllers;
  createDropdownBackdropController?: typeof createRecordsDropdownBackdropController;
  createLocalFilterRuntime?: typeof createRecordsLocalFilterRuntime;
}

export interface RecordsFilterRuntime {
  filterControllers: RecordsFilterControllers;
  dropdownBackdropController: RecordsDropdownBackdropController;
  localFilterRuntime: RecordsLocalFilterRuntime;
  syncDropdownBackdrop: () => void;
  clearRenderedOptions: () => void;
  updateFilteredRecords: () => void;
}

export function createRecordsFilterRuntime(options: CreateRecordsFilterRuntimeOptions): RecordsFilterRuntime {
  const createFilterControllers = options.createFilterControllers || createRecordsFilterControllers;
  const createDropdownBackdrop = options.createDropdownBackdropController || createRecordsDropdownBackdropController;
  const createLocalFilter = options.createLocalFilterRuntime || createRecordsLocalFilterRuntime;
  const { elements } = options;

  const dropdownBackdropController = createDropdownBackdrop({
    dropdowns: [elements.filters.tags.dropdown, elements.filters.lists.dropdown],
    closeDropdowns: () => {
      try { elements.filters.tags.dropdown.style.display = 'none'; } catch {}
      try { elements.filters.lists.dropdown.style.display = 'none'; } catch {}
    },
  });
  const syncDropdownBackdrop = () => dropdownBackdropController.sync();

  const filterControllers = createFilterControllers({
    elements: {
      searchInput: elements.searchInput,
      tags: elements.filters.tags,
      lists: elements.filters.lists,
      series: elements.filters.series,
      labels: elements.filters.labels,
    } satisfies RecordsFilterControllersElements,
    selectedTags: options.selectedTags,
    selectedListIds: options.selectedListIds,
    selectedSeriesIds: options.selectedSeriesIds,
    selectedLabelIds: options.selectedLabelIds,
    tokenSelectedListIds: options.getTokenSelectedListIds,
    tokenSelectedSeriesIds: options.getTokenSelectedSeriesIds,
    tokenSelectedLabelIds: options.getTokenSelectedLabelIds,
    getAllTags: options.getAllTags,
    listNameById: options.listNameById,
    listSourceById: options.listSourceById,
    seriesNameById: options.seriesNameById,
    labelNameById: options.labelNameById,
    ensureListMetaLoaded: options.ensureListMetaLoaded,
    syncDropdownBackdrop,
    onChange: options.onFilterChanged,
    escapeHtml: options.escapeHtml,
  });
  const clearRenderedOptions = () => {
    filterControllers.tags.clearRenderedOptions();
    filterControllers.lists.clearRenderedOptions();
    filterControllers.series.clearRenderedOptions();
    filterControllers.labels.clearRenderedOptions();
  };

  const localFilterRuntime = createLocalFilter({
    searchInput: elements.searchInput,
    filterSelect: elements.filterSelect,
    sortSelect: elements.sortSelect,
    getRecords: options.getRecords,
    selectedTags: options.selectedTags,
    selectedListIds: options.selectedListIds,
    selectedSeriesIds: options.selectedSeriesIds,
    selectedLabelIds: options.selectedLabelIds,
    getTokenSelectedTags: options.getTokenSelectedTags,
    setTokenSelectedTags: options.setTokenSelectedTags,
    getTokenSelectedListIds: options.getTokenSelectedListIds,
    setTokenSelectedListIds: options.setTokenSelectedListIds,
    getTokenSelectedSeriesIds: options.getTokenSelectedSeriesIds,
    setTokenSelectedSeriesIds: options.setTokenSelectedSeriesIds,
    getTokenSelectedLabelIds: options.getTokenSelectedLabelIds,
    setTokenSelectedLabelIds: options.setTokenSelectedLabelIds,
    listNameById: options.listNameById,
    seriesIdToRecord: options.seriesIdToRecord,
    labelIdToRecord: options.labelIdToRecord,
    getAdvancedConditions: options.getAdvancedConditions,
    isFavoritesFilterActive: options.isFavoritesFilterActive,
    refreshTags: () => { try { filterControllers.tags.refresh(); } catch {} },
    refreshLists: () => { try { filterControllers.lists.refresh(); } catch {} },
    refreshSeries: () => { try { filterControllers.series.refresh(); } catch {} },
    refreshLabels: () => { try { filterControllers.labels.refresh(); } catch {} },
    setFilteredRecords: options.setFilteredRecords,
  });

  return {
    filterControllers,
    dropdownBackdropController,
    localFilterRuntime,
    syncDropdownBackdrop,
    clearRenderedOptions,
    updateFilteredRecords: localFilterRuntime.updateFilteredRecords,
  };
}
