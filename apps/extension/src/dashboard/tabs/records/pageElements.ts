export interface RecordsPageRequiredElements {
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  sortSelect: HTMLSelectElement;
  videoList: HTMLUListElement;
  paginationContainer: HTMLElement;
  recordsPerPageSelect: HTMLSelectElement;
  searchResultCount: HTMLDivElement;
}

export interface RecordsFilterElements {
  filterInput: HTMLInputElement;
  dropdown: HTMLElement;
  searchInput: HTMLInputElement;
  optionList: HTMLElement;
  selectedContainer: HTMLElement;
}

export interface RecordsAdvancedElements {
  advAddBtn: HTMLButtonElement;
  advApplyBtn: HTMLButtonElement;
  advResetBtn: HTMLButtonElement;
  advConditionsEl: HTMLDivElement;
  quickTimeField: HTMLSelectElement;
  quickTimeValue: HTMLInputElement;
  quickTimeUnit: HTMLSelectElement;
  addQuickTimeBtn: HTMLButtonElement;
}

export interface RecordsBatchElements {
  batchOperations: HTMLDivElement;
  selectAllCheckbox: HTMLInputElement;
  selectedCount: HTMLSpanElement;
  batchActionsBtn: HTMLButtonElement;
  batchActionsDropdown: HTMLDivElement;
  batchModifyListBtn: HTMLButtonElement;
  batchAddTagBtn: HTMLButtonElement;
  batchRefreshBtn: HTMLButtonElement;
  batchDeleteBtn: HTMLButtonElement;
  cancelBatchBtn: HTMLButtonElement;
}

export interface RecordsToolbarElements {
  toggleCoversBtn: HTMLButtonElement;
  toggleViewModeBtn: HTMLButtonElement;
  myFavoritesBtn: HTMLButtonElement;
  batchImportBtn: HTMLButtonElement;
}

export interface RecordsPageElements {
  required: RecordsPageRequiredElements;
  filters: {
    tags: RecordsFilterElements;
    lists: RecordsFilterElements;
    series: RecordsFilterElements;
    labels: RecordsFilterElements;
  };
  advanced: RecordsAdvancedElements;
  searchSuggest: HTMLDivElement;
  batch: RecordsBatchElements;
  toolbar: RecordsToolbarElements;
}

export interface RecordsStatusOptionValues {
  untracked: string;
  viewed: string;
}

export function ensureUntrackedStatusOption(
  filterSelect: HTMLSelectElement | null,
  statusValues: RecordsStatusOptionValues,
): void {
  try {
    if (!filterSelect) return;
    if (Array.from(filterSelect.options || []).some(option => option.value === statusValues.untracked)) return;

    const option = document.createElement('option');
    option.value = statusValues.untracked;
    option.textContent = '未标记';
    const viewedOption = Array.from(filterSelect.options || []).find(item => item.value === statusValues.viewed);
    if (viewedOption) {
      filterSelect.insertBefore(option, viewedOption);
      return;
    }
    filterSelect.appendChild(option);
  } catch {}
}

export function collectRecordsPageElements(documentRef: Document = document): RecordsPageElements {
  const getById = <T extends HTMLElement>(id: string) => documentRef.getElementById(id) as T;

  return {
    required: {
      searchInput: getById<HTMLInputElement>('searchInput'),
      filterSelect: getById<HTMLSelectElement>('filterSelect'),
      sortSelect: getById<HTMLSelectElement>('sortSelect'),
      videoList: getById<HTMLUListElement>('videoList'),
      paginationContainer: documentRef.querySelector('.pagination-controls .pagination') as HTMLElement,
      recordsPerPageSelect: getById<HTMLSelectElement>('recordsPerPageSelect'),
      searchResultCount: getById<HTMLDivElement>('searchResultCount'),
    },
    filters: {
      tags: {
        filterInput: getById<HTMLInputElement>('tagsFilterInput'),
        dropdown: getById<HTMLElement>('tagsFilterDropdown'),
        searchInput: getById<HTMLInputElement>('tagsSearchInput'),
        optionList: getById<HTMLElement>('tagsFilterList'),
        selectedContainer: getById<HTMLElement>('selectedTagsContainer'),
      },
      lists: {
        filterInput: getById<HTMLInputElement>('listsFilterInput'),
        dropdown: getById<HTMLElement>('listsFilterDropdown'),
        searchInput: getById<HTMLInputElement>('listsSearchInput'),
        optionList: getById<HTMLElement>('listsFilterList'),
        selectedContainer: getById<HTMLElement>('selectedListsContainer'),
      },
      series: {
        filterInput: getById<HTMLInputElement>('seriesFilterInput'),
        dropdown: getById<HTMLElement>('seriesFilterDropdown'),
        searchInput: getById<HTMLInputElement>('seriesSearchInput'),
        optionList: getById<HTMLElement>('seriesFilterList'),
        selectedContainer: getById<HTMLElement>('selectedSeriesContainer'),
      },
      labels: {
        filterInput: getById<HTMLInputElement>('labelsFilterInput'),
        dropdown: getById<HTMLElement>('labelsFilterDropdown'),
        searchInput: getById<HTMLInputElement>('labelsSearchInput'),
        optionList: getById<HTMLElement>('labelsFilterList'),
        selectedContainer: getById<HTMLElement>('selectedLabelsContainer'),
      },
    },
    advanced: {
      advAddBtn: getById<HTMLButtonElement>('addConditionBtn'),
      advApplyBtn: getById<HTMLButtonElement>('applyConditionsBtn'),
      advResetBtn: getById<HTMLButtonElement>('resetConditionsBtn'),
      advConditionsEl: getById<HTMLDivElement>('advConditions'),
      quickTimeField: getById<HTMLSelectElement>('quickTimeField'),
      quickTimeValue: getById<HTMLInputElement>('quickTimeValue'),
      quickTimeUnit: getById<HTMLSelectElement>('quickTimeUnit'),
      addQuickTimeBtn: getById<HTMLButtonElement>('addQuickTimeBtn'),
    },
    searchSuggest: getById<HTMLDivElement>('searchSuggest'),
    batch: {
      batchOperations: getById<HTMLDivElement>('batchOperations'),
      selectAllCheckbox: getById<HTMLInputElement>('selectAllCheckbox'),
      selectedCount: getById<HTMLSpanElement>('selectedCount'),
      batchActionsBtn: getById<HTMLButtonElement>('batchActionsBtn'),
      batchActionsDropdown: getById<HTMLDivElement>('batchActionsDropdown'),
      batchModifyListBtn: getById<HTMLButtonElement>('batchModifyListBtn'),
      batchAddTagBtn: getById<HTMLButtonElement>('batchAddTagBtn'),
      batchRefreshBtn: getById<HTMLButtonElement>('batchRefreshBtn'),
      batchDeleteBtn: getById<HTMLButtonElement>('batchDeleteBtn'),
      cancelBatchBtn: getById<HTMLButtonElement>('cancelBatchBtn'),
    },
    toolbar: {
      toggleCoversBtn: getById<HTMLButtonElement>('toggleCoversBtn'),
      toggleViewModeBtn: getById<HTMLButtonElement>('toggleViewModeBtn'),
      myFavoritesBtn: getById<HTMLButtonElement>('myFavoritesBtn'),
      batchImportBtn: getById<HTMLButtonElement>('batchImportBtn'),
    },
  };
}
