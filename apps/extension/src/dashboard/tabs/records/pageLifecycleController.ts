import type { RecordsAdvancedCondition } from './advancedConditionModel';

type MaybePromise = void | Promise<void>;
type SimpleController = { bind: () => void };
type RenderableController = { bind: () => void; render?: () => void };

export interface RecordsPageLifecycleElements {
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  sortSelect: HTMLSelectElement;
  recordsPerPageSelect: HTMLSelectElement;
  exportRecordsBtn?: HTMLButtonElement | null;
  advAddBtn?: HTMLButtonElement | null;
  advApplyBtn?: HTMLButtonElement | null;
  advResetBtn?: HTMLButtonElement | null;
  addQuickTimeBtn?: HTMLButtonElement | null;
  tagsFilterInput: HTMLElement;
  tagsFilterDropdown: HTMLElement;
  listsFilterInput?: HTMLElement | null;
  listsFilterDropdown?: HTMLElement | null;
  seriesFilterInput?: HTMLElement | null;
  seriesFilterDropdown?: HTMLElement | null;
  labelsFilterInput?: HTMLElement | null;
  labelsFilterDropdown?: HTMLElement | null;
}

export interface RecordsPageLifecycleOptions {
  elements: RecordsPageLifecycleElements;
  getRecordsPerPage: () => number;
  setRecordsPerPage: (value: number) => void;
  persistRecordsPerPage: () => void;
  resetCurrentPage: () => void;
  updateFilteredRecords: () => void;
  render: () => void;
  syncDropdownBackdrop: () => void;
  triggerSuggest: () => void;
  triggerFilter: () => void;
  viewToolbar: { bind: () => void; update: () => void };
  batchToolbar: SimpleController;
  searchSuggest: SimpleController;
  filters: {
    tags: RenderableController;
    lists: RenderableController;
    series: RenderableController;
    labels: RenderableController;
  };
  advancedConditions: {
    addCondition: (condition: RecordsAdvancedCondition) => void;
    parseFromUI: () => RecordsAdvancedCondition[];
    clear: () => void;
    bindQuickTimeControls: () => void;
    addQuickTimeCondition: () => void;
  };
  addAdvancedCondition: (condition: RecordsAdvancedCondition) => void;
  setAdvancedConditions: (conditions: RecordsAdvancedCondition[]) => void;
  listPickerRuntime: { close: () => void };
  coverRuntime: { ensureTooltipElement: () => void };
  handleExportRecords: () => MaybePromise;
  updateBatchUI: () => void;
  debounce: <F extends (...args: any[]) => void>(fn: F, wait?: number) => (...args: Parameters<F>) => void;
}

function closeFilterDropdowns(options: RecordsPageLifecycleOptions, event: MouseEvent): void {
  const target = event.target as Node;
  const { elements } = options;
  if (!elements.tagsFilterInput.contains(target) && !elements.tagsFilterDropdown.contains(target)) {
    elements.tagsFilterDropdown.style.display = 'none';
  }
  if (elements.listsFilterInput && elements.listsFilterDropdown) {
    if (!elements.listsFilterInput.contains(target) && !elements.listsFilterDropdown.contains(target)) {
      elements.listsFilterDropdown.style.display = 'none';
    }
  }
  if (elements.seriesFilterInput && elements.seriesFilterDropdown) {
    if (!elements.seriesFilterInput.contains(target) && !elements.seriesFilterDropdown.contains(target)) {
      elements.seriesFilterDropdown.style.display = 'none';
    }
  }
  if (elements.labelsFilterInput && elements.labelsFilterDropdown) {
    if (!elements.labelsFilterInput.contains(target) && !elements.labelsFilterDropdown.contains(target)) {
      elements.labelsFilterDropdown.style.display = 'none';
    }
  }
  options.syncDropdownBackdrop();
}

export function bindRecordsPageLifecycle(options: RecordsPageLifecycleOptions): void {
  const { elements } = options;

  elements.recordsPerPageSelect.value = String(options.getRecordsPerPage());

  elements.searchInput.addEventListener('input', () => {
    options.triggerSuggest();
    options.triggerFilter();
  });
  elements.filterSelect.addEventListener('change', () => {
    options.resetCurrentPage();
    options.updateFilteredRecords();
    options.render();
  });
  elements.sortSelect.addEventListener('change', () => {
    options.resetCurrentPage();
    options.updateFilteredRecords();
    options.render();
  });

  options.viewToolbar.bind();

  elements.exportRecordsBtn?.addEventListener('click', async () => {
    await options.handleExportRecords();
  });

  elements.advAddBtn?.addEventListener('click', () => {
    const condition: RecordsAdvancedCondition = { id: `cond_${Date.now()}`, field: 'id', op: 'contains', value: '' };
    options.addAdvancedCondition(condition);
    options.advancedConditions.addCondition(condition);
  });

  if (elements.advApplyBtn) {
    const debouncedApply = options.debounce(() => {
      options.setAdvancedConditions(options.advancedConditions.parseFromUI());
      options.resetCurrentPage();
      options.updateFilteredRecords();
      options.render();
    }, 180);
    elements.advApplyBtn.addEventListener('click', () => debouncedApply());
  }

  elements.advResetBtn?.addEventListener('click', () => {
    options.advancedConditions.clear();
  });

  options.advancedConditions.bindQuickTimeControls();
  elements.addQuickTimeBtn?.addEventListener('click', () => options.advancedConditions.addQuickTimeCondition());

  options.searchSuggest.bind();
  options.filters.tags.bind();
  options.filters.lists.bind();
  options.filters.series.bind();
  options.filters.labels.bind();

  document.addEventListener('click', (event) => closeFilterDropdowns(options, event));

  elements.recordsPerPageSelect.addEventListener('change', () => {
    options.setRecordsPerPage(parseInt(elements.recordsPerPageSelect.value, 10));
    options.persistRecordsPerPage();
    options.resetCurrentPage();
    options.render();
  });

  options.batchToolbar.bind();

  document.getElementById('listPickerCloseBtn')?.addEventListener('click', () => options.listPickerRuntime.close());
  document.getElementById('listPickerDoneBtn')?.addEventListener('click', () => options.listPickerRuntime.close());
  document.querySelector('#listPickerPanel .list-picker-backdrop')?.addEventListener('click', () => options.listPickerRuntime.close());

  options.coverRuntime.ensureTooltipElement();
  options.viewToolbar.update();
  options.updateFilteredRecords();
  options.render();
  options.updateBatchUI();
}
