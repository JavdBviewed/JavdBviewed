import type { RecordsAdvancedCondition } from './advancedConditionModel';
import {
  bindRecordsPageLifecycle,
  type RecordsPageLifecycleOptions,
} from './pageLifecycleController';
import type { RecordsPageElements } from './pageElements';

type BindRecordsPageLifecycle = typeof bindRecordsPageLifecycle;

export interface CreateRecordsLifecycleRuntimeOptions
  extends Omit<RecordsPageLifecycleOptions, 'elements'> {
  pageElements: RecordsPageElements;
  documentRef?: Document;
  bindPageLifecycle?: BindRecordsPageLifecycle;
}

export interface RecordsLifecycleRuntime {
  bind: () => void;
}

export function createRecordsLifecycleRuntime(
  options: CreateRecordsLifecycleRuntimeOptions,
): RecordsLifecycleRuntime {
  const bindPageLifecycle = options.bindPageLifecycle || bindRecordsPageLifecycle;
  const documentRef = options.documentRef || document;

  const bind = (): void => {
    const { pageElements } = options;

    bindPageLifecycle({
      elements: {
        searchInput: pageElements.required.searchInput,
        filterSelect: pageElements.required.filterSelect,
        sortSelect: pageElements.required.sortSelect,
        recordsPerPageSelect: pageElements.required.recordsPerPageSelect,
        exportRecordsBtn: documentRef.getElementById('exportRecordsBtn') as HTMLButtonElement,
        advAddBtn: pageElements.advanced.advAddBtn,
        advApplyBtn: pageElements.advanced.advApplyBtn,
        advResetBtn: pageElements.advanced.advResetBtn,
        addQuickTimeBtn: pageElements.advanced.addQuickTimeBtn,
        tagsFilterInput: pageElements.filters.tags.filterInput,
        tagsFilterDropdown: pageElements.filters.tags.dropdown,
        listsFilterInput: pageElements.filters.lists.filterInput,
        listsFilterDropdown: pageElements.filters.lists.dropdown,
        seriesFilterInput: pageElements.filters.series.filterInput,
        seriesFilterDropdown: pageElements.filters.series.dropdown,
        labelsFilterInput: pageElements.filters.labels.filterInput,
        labelsFilterDropdown: pageElements.filters.labels.dropdown,
        makersFilterInput: pageElements.filters.makers.filterInput,
        makersFilterDropdown: pageElements.filters.makers.dropdown,
        directorsFilterInput: pageElements.filters.directors.filterInput,
        directorsFilterDropdown: pageElements.filters.directors.dropdown,
      },
      getRecordsPerPage: options.getRecordsPerPage,
      setRecordsPerPage: options.setRecordsPerPage,
      persistRecordsPerPage: options.persistRecordsPerPage,
      resetCurrentPage: options.resetCurrentPage,
      updateFilteredRecords: options.updateFilteredRecords,
      render: options.render,
      syncDropdownBackdrop: options.syncDropdownBackdrop,
      triggerSuggest: options.triggerSuggest,
      triggerFilter: options.triggerFilter,
      viewToolbar: options.viewToolbar,
      batchToolbar: options.batchToolbar,
      searchSuggest: options.searchSuggest,
      filters: options.filters,
      advancedConditions: options.advancedConditions,
      addAdvancedCondition: (condition: RecordsAdvancedCondition) => {
        options.addAdvancedCondition(condition);
      },
      setAdvancedConditions: options.setAdvancedConditions,
      listPickerRuntime: options.listPickerRuntime,
      coverRuntime: options.coverRuntime,
      handleExportRecords: options.handleExportRecords,
      updateBatchUI: options.updateBatchUI,
      debounce: options.debounce,
    });
  };

  return { bind };
}
