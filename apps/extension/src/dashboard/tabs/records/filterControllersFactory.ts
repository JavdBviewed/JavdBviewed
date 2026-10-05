import {
  removeDirectorTokenFromSearchInput,
  removeLabelTokenFromSearchInput,
  removeListIdTokenFromSearchInput,
  removeMakerTokenFromSearchInput,
  removeSeriesTokenFromSearchInput,
} from './searchQueryModel';
import {
  createRecordsMultiSelectFilterController,
  type RecordsMultiSelectFilterController,
  type RecordsMultiSelectFilterElements,
} from './multiSelectFilterController';

export interface RecordsFilterControllersElements {
  searchInput: HTMLInputElement;
  tags: RecordsMultiSelectFilterElements;
  lists: RecordsMultiSelectFilterElements;
  series: RecordsMultiSelectFilterElements;
  labels: RecordsMultiSelectFilterElements;
  makers: RecordsMultiSelectFilterElements;
  directors: RecordsMultiSelectFilterElements;
}

type TokenSelectionSetSource = Set<string> | (() => Set<string>);

export interface CreateRecordsFilterControllersOptions {
  elements: RecordsFilterControllersElements;
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  selectedMakerIds: Set<string>;
  selectedDirectorIds: Set<string>;
  tokenSelectedListIds: TokenSelectionSetSource;
  tokenSelectedSeriesIds: TokenSelectionSetSource;
  tokenSelectedLabelIds: TokenSelectionSetSource;
  tokenSelectedMakerIds: TokenSelectionSetSource;
  tokenSelectedDirectorIds: TokenSelectionSetSource;
  getAllTags: () => string[];
  listNameById: Map<string, string>;
  listSourceById: Map<string, string>;
  seriesNameById: Map<string, string>;
  labelNameById: Map<string, string>;
  makerNameById: Map<string, string>;
  directorNameById: Map<string, string>;
  ensureListMetaLoaded: () => void;
  syncDropdownBackdrop: () => void;
  onChange: () => void;
  escapeHtml?: (value: string) => string;
}

export interface RecordsFilterControllers {
  tags: RecordsMultiSelectFilterController;
  lists: RecordsMultiSelectFilterController;
  series: RecordsMultiSelectFilterController;
  labels: RecordsMultiSelectFilterController;
  makers: RecordsMultiSelectFilterController;
  directors: RecordsMultiSelectFilterController;
}

function dispatchSearchInput(searchInput: HTMLInputElement): void {
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function resolveTokenSelectionSet(source: TokenSelectionSetSource): Set<string> {
  return typeof source === 'function' ? source() : source;
}

export function createRecordsFilterControllers(options: CreateRecordsFilterControllersOptions): RecordsFilterControllers {
  const tags = createRecordsMultiSelectFilterController({
    elements: options.elements.tags,
    selected: options.selectedTags,
    emptyText: '点击选择标签',
    selectedText: (count) => `已选择 ${count} 个标签`,
    optionAttribute: 'data-tag',
    removeAttribute: 'data-tag',
    getItems: () => options.getAllTags().map(tag => ({ id: String(tag), name: String(tag) })),
    onAfterToggleDropdown: options.syncDropdownBackdrop,
    onChange: options.onChange,
  });

  const lists = createRecordsMultiSelectFilterController({
    elements: options.elements.lists,
    selected: options.selectedListIds,
    emptyText: '点击选择清单',
    selectedText: (count) => `已选择 ${count} 个清单`,
    optionAttribute: 'data-list-id',
    removeAttribute: 'data-list-id',
    getItems: () => Array.from(options.listNameById.entries()).map(([id, name]) => {
      const source = options.listSourceById.get(String(id)) || 'javdb';
      const badgeHtml = source === 'local'
        ? '<span class="list-source-badge list-source-local">本地</span>'
        : '<span class="list-source-badge list-source-javdb">JavDB</span>';
      return { id: String(id), name: String(name || id), badgeHtml };
    }),
    onBeforeOpen: options.ensureListMetaLoaded,
    onAfterToggleDropdown: options.syncDropdownBackdrop,
    onChange: options.onChange,
    escapeHtml: options.escapeHtml,
    isTokenBackedItem: (id) => resolveTokenSelectionSet(options.tokenSelectedListIds).has(String(id)),
    onRemoveTokenBackedItem: (id) => {
      options.elements.searchInput.value = removeListIdTokenFromSearchInput(options.elements.searchInput.value, String(id));
      dispatchSearchInput(options.elements.searchInput);
      return true;
    },
  });

  const series = createRecordsMultiSelectFilterController({
    elements: options.elements.series,
    selected: options.selectedSeriesIds,
    emptyText: '点击选择系列',
    selectedText: (count) => `已选择 ${count} 个系列`,
    optionAttribute: 'data-series-id',
    removeAttribute: 'data-series-id',
    getItems: () => Array.from(options.seriesNameById.entries()).map(([id, name]) => ({ id: String(id), name: String(name || id) })),
    onBeforeOpen: options.ensureListMetaLoaded,
    onAfterToggleDropdown: options.syncDropdownBackdrop,
    onChange: options.onChange,
    escapeHtml: options.escapeHtml,
    isTokenBackedItem: (id) => resolveTokenSelectionSet(options.tokenSelectedSeriesIds).has(String(id)),
    onRemoveTokenBackedItem: (id) => {
      options.elements.searchInput.value = removeSeriesTokenFromSearchInput(options.elements.searchInput.value, String(id));
      dispatchSearchInput(options.elements.searchInput);
      return true;
    },
  });

  const labels = createRecordsMultiSelectFilterController({
    elements: options.elements.labels,
    selected: options.selectedLabelIds,
    emptyText: '点击选择番号',
    selectedText: (count) => `已选择 ${count} 个番号`,
    optionAttribute: 'data-label-id',
    removeAttribute: 'data-label-id',
    getItems: () => Array.from(options.labelNameById.entries()).map(([id, name]) => ({ id: String(id), name: String(name || id) })),
    onBeforeOpen: options.ensureListMetaLoaded,
    onAfterToggleDropdown: options.syncDropdownBackdrop,
    onChange: options.onChange,
    escapeHtml: options.escapeHtml,
    isTokenBackedItem: (id) => resolveTokenSelectionSet(options.tokenSelectedLabelIds).has(String(id)),
    onRemoveTokenBackedItem: (id) => {
      options.elements.searchInput.value = removeLabelTokenFromSearchInput(options.elements.searchInput.value, String(id));
      dispatchSearchInput(options.elements.searchInput);
      return true;
    },
  });

  const makers = createRecordsMultiSelectFilterController({
    elements: options.elements.makers,
    selected: options.selectedMakerIds,
    emptyText: '点击选择片商',
    selectedText: (count) => `已选择 ${count} 个片商`,
    optionAttribute: 'data-maker-id',
    removeAttribute: 'data-maker-id',
    getItems: () => Array.from(options.makerNameById.entries()).map(([id, name]) => ({ id: String(id), name: String(name || id) })),
    onBeforeOpen: options.ensureListMetaLoaded,
    onAfterToggleDropdown: options.syncDropdownBackdrop,
    onChange: options.onChange,
    escapeHtml: options.escapeHtml,
    isTokenBackedItem: (id) => resolveTokenSelectionSet(options.tokenSelectedMakerIds).has(String(id)),
    onRemoveTokenBackedItem: (id) => {
      options.elements.searchInput.value = removeMakerTokenFromSearchInput(options.elements.searchInput.value, String(id));
      dispatchSearchInput(options.elements.searchInput);
      return true;
    },
  });

  const directors = createRecordsMultiSelectFilterController({
    elements: options.elements.directors,
    selected: options.selectedDirectorIds,
    emptyText: '点击选择導演',
    selectedText: (count) => `已选择 ${count} 个導演`,
    optionAttribute: 'data-director-id',
    removeAttribute: 'data-director-id',
    getItems: () => Array.from(options.directorNameById.entries()).map(([id, name]) => ({ id: String(id), name: String(name || id) })),
    onBeforeOpen: options.ensureListMetaLoaded,
    onAfterToggleDropdown: options.syncDropdownBackdrop,
    onChange: options.onChange,
    escapeHtml: options.escapeHtml,
    isTokenBackedItem: (id) => resolveTokenSelectionSet(options.tokenSelectedDirectorIds).has(String(id)),
    onRemoveTokenBackedItem: (id) => {
      options.elements.searchInput.value = removeDirectorTokenFromSearchInput(options.elements.searchInput.value, String(id));
      dispatchSearchInput(options.elements.searchInput);
      return true;
    },
  });

  return { tags, lists, series, labels, makers, directors };
}
