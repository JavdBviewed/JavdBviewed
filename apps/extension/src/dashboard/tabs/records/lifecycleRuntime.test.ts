import { describe, expect, it, vi } from 'vitest';
import { createRecordsLifecycleRuntime } from './lifecycleRuntime';
import type { RecordsPageElements } from './pageElements';

function element<T extends HTMLElement>(id: string): T {
  return { id } as T;
}

function pageElements(): RecordsPageElements {
  return {
    required: {
      searchInput: element<HTMLInputElement>('searchInput'),
      filterSelect: element<HTMLSelectElement>('filterSelect'),
      sortSelect: element<HTMLSelectElement>('sortSelect'),
      videoList: element<HTMLUListElement>('videoList'),
      paginationContainer: element<HTMLElement>('paginationContainer'),
      recordsPerPageSelect: element<HTMLSelectElement>('recordsPerPageSelect'),
      searchResultCount: element<HTMLDivElement>('searchResultCount'),
    },
    filters: {
      tags: {
        filterInput: element<HTMLInputElement>('tagsFilterInput'),
        dropdown: element<HTMLElement>('tagsFilterDropdown'),
        searchInput: element<HTMLInputElement>('tagsSearchInput'),
        optionList: element<HTMLElement>('tagsFilterList'),
        selectedContainer: element<HTMLElement>('selectedTagsContainer'),
      },
      lists: {
        filterInput: element<HTMLInputElement>('listsFilterInput'),
        dropdown: element<HTMLElement>('listsFilterDropdown'),
        searchInput: element<HTMLInputElement>('listsSearchInput'),
        optionList: element<HTMLElement>('listsFilterList'),
        selectedContainer: element<HTMLElement>('selectedListsContainer'),
      },
      series: {
        filterInput: element<HTMLInputElement>('seriesFilterInput'),
        dropdown: element<HTMLElement>('seriesFilterDropdown'),
        searchInput: element<HTMLInputElement>('seriesSearchInput'),
        optionList: element<HTMLElement>('seriesFilterList'),
        selectedContainer: element<HTMLElement>('selectedSeriesContainer'),
      },
      labels: {
        filterInput: element<HTMLInputElement>('labelsFilterInput'),
        dropdown: element<HTMLElement>('labelsFilterDropdown'),
        searchInput: element<HTMLInputElement>('labelsSearchInput'),
        optionList: element<HTMLElement>('labelsFilterList'),
        selectedContainer: element<HTMLElement>('selectedLabelsContainer'),
      },
      makers: {
        filterInput: element<HTMLInputElement>('makersFilterInput'),
        dropdown: element<HTMLElement>('makersFilterDropdown'),
        searchInput: element<HTMLInputElement>('makersSearchInput'),
        optionList: element<HTMLElement>('makersFilterList'),
        selectedContainer: element<HTMLElement>('selectedMakersContainer'),
      },
      directors: {
        filterInput: element<HTMLInputElement>('directorsFilterInput'),
        dropdown: element<HTMLElement>('directorsFilterDropdown'),
        searchInput: element<HTMLInputElement>('directorsSearchInput'),
        optionList: element<HTMLElement>('directorsFilterList'),
        selectedContainer: element<HTMLElement>('selectedDirectorsContainer'),
      },
    },
    advanced: {
      advAddBtn: element<HTMLButtonElement>('advAddBtn'),
      advApplyBtn: element<HTMLButtonElement>('advApplyBtn'),
      advResetBtn: element<HTMLButtonElement>('advResetBtn'),
      advConditionsEl: element<HTMLDivElement>('advConditionsEl'),
      quickTimeField: element<HTMLSelectElement>('quickTimeField'),
      quickTimeValue: element<HTMLInputElement>('quickTimeValue'),
      quickTimeUnit: element<HTMLSelectElement>('quickTimeUnit'),
      addQuickTimeBtn: element<HTMLButtonElement>('addQuickTimeBtn'),
    },
    searchSuggest: element<HTMLDivElement>('searchSuggest'),
    batch: {
      batchOperations: element<HTMLDivElement>('batchOperations'),
      selectAllCheckbox: element<HTMLInputElement>('selectAllCheckbox'),
      selectedCount: element<HTMLSpanElement>('selectedCount'),
      batchActionsBtn: element<HTMLButtonElement>('batchActionsBtn'),
      batchActionsDropdown: element<HTMLDivElement>('batchActionsDropdown'),
      batchModifyListBtn: element<HTMLButtonElement>('batchModifyListBtn'),
      batchAddTagBtn: element<HTMLButtonElement>('batchAddTagBtn'),
      batchRefreshBtn: element<HTMLButtonElement>('batchRefreshBtn'),
      batchDeleteBtn: element<HTMLButtonElement>('batchDeleteBtn'),
      cancelBatchBtn: element<HTMLButtonElement>('cancelBatchBtn'),
    },
    toolbar: {
      toggleCoversBtn: element<HTMLButtonElement>('toggleCoversBtn'),
      toggleViewModeBtn: element<HTMLButtonElement>('toggleViewModeBtn'),
      myFavoritesBtn: element<HTMLButtonElement>('myFavoritesBtn'),
    },
  };
}

describe('records lifecycle runtime', () => {
  it('assembles lifecycle elements and forwards current callbacks', () => {
    const page = pageElements();
    const exportRecordsBtn = element<HTMLButtonElement>('exportRecordsBtn');
    const bindPageLifecycle = vi.fn();
    const documentRef = {
      getElementById: vi.fn(() => exportRecordsBtn),
    } as unknown as Document;
    let recordsPerPage = 10;
    let advancedConditions: unknown[] = [];

    const runtime = createRecordsLifecycleRuntime({
      pageElements: page,
      getRecordsPerPage: () => recordsPerPage,
      setRecordsPerPage: (value) => {
        recordsPerPage = value;
      },
      persistRecordsPerPage: vi.fn(),
      resetCurrentPage: vi.fn(),
      updateFilteredRecords: vi.fn(),
      render: vi.fn(),
      syncDropdownBackdrop: vi.fn(),
      triggerSuggest: vi.fn(),
      triggerFilter: vi.fn(),
      viewToolbar: { bind: vi.fn(), update: vi.fn() },
      batchToolbar: { bind: vi.fn() },
      searchSuggest: { bind: vi.fn() },
      filters: {
        tags: { bind: vi.fn(), render: vi.fn() },
        lists: { bind: vi.fn(), render: vi.fn() },
        series: { bind: vi.fn() },
        labels: { bind: vi.fn() },
        makers: { bind: vi.fn() },
        directors: { bind: vi.fn() },
      },
      advancedConditions: {
        addCondition: vi.fn(),
        parseFromUI: vi.fn(() => []),
        clear: vi.fn(),
        bindQuickTimeControls: vi.fn(),
        addQuickTimeCondition: vi.fn(),
      },
      addAdvancedCondition: (condition) => {
        advancedConditions.push(condition);
      },
      setAdvancedConditions: (conditions) => {
        advancedConditions = conditions;
      },
      listPickerRuntime: { close: vi.fn() },
      coverRuntime: { ensureTooltipElement: vi.fn() },
      handleExportRecords: vi.fn(),
      updateBatchUI: vi.fn(),
      debounce: (fn) => fn,
      documentRef,
      bindPageLifecycle,
    });

    runtime.bind();
    const lifecycleOptions = bindPageLifecycle.mock.calls[0][0];
    lifecycleOptions.setRecordsPerPage(20);
    lifecycleOptions.addAdvancedCondition({ id: 'cond-1', field: 'id', op: 'contains', value: 'AAA' });

    expect(documentRef.getElementById).toHaveBeenCalledWith('exportRecordsBtn');
    expect(lifecycleOptions.elements).toEqual(expect.objectContaining({
      searchInput: page.required.searchInput,
      filterSelect: page.required.filterSelect,
      sortSelect: page.required.sortSelect,
      recordsPerPageSelect: page.required.recordsPerPageSelect,
      exportRecordsBtn,
      advAddBtn: page.advanced.advAddBtn,
      addQuickTimeBtn: page.advanced.addQuickTimeBtn,
      tagsFilterInput: page.filters.tags.filterInput,
      tagsFilterDropdown: page.filters.tags.dropdown,
      labelsFilterInput: page.filters.labels.filterInput,
      labelsFilterDropdown: page.filters.labels.dropdown,
      makersFilterInput: page.filters.makers.filterInput,
      makersFilterDropdown: page.filters.makers.dropdown,
      directorsFilterInput: page.filters.directors.filterInput,
      directorsFilterDropdown: page.filters.directors.dropdown,
    }));
    expect(lifecycleOptions.getRecordsPerPage()).toBe(20);
    expect(advancedConditions).toEqual([{ id: 'cond-1', field: 'id', op: 'contains', value: 'AAA' }]);
  });
});
