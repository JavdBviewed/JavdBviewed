import { describe, expect, it, vi } from 'vitest';
import { bindRecordsPageLifecycle } from './pageLifecycleController';

function element<T extends HTMLElement>(): T {
  return {
    addEventListener: vi.fn(),
    contains: vi.fn(() => false),
    style: {},
    value: '',
  } as unknown as T;
}

describe('records page lifecycle', () => {
  it('does not eagerly render large filter option lists during initial binding', () => {
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
    });

    const filters = {
      tags: { bind: vi.fn(), render: vi.fn() },
      lists: { bind: vi.fn(), render: vi.fn() },
      series: { bind: vi.fn(), render: vi.fn() },
      labels: { bind: vi.fn(), render: vi.fn() },
    };

    bindRecordsPageLifecycle({
      elements: {
        searchInput: element<HTMLInputElement>(),
        filterSelect: element<HTMLSelectElement>(),
        sortSelect: element<HTMLSelectElement>(),
        recordsPerPageSelect: element<HTMLSelectElement>(),
        tagsFilterInput: element(),
        tagsFilterDropdown: element(),
        listsFilterInput: element(),
        listsFilterDropdown: element(),
        seriesFilterInput: element(),
        seriesFilterDropdown: element(),
        labelsFilterInput: element(),
        labelsFilterDropdown: element(),
      },
      getRecordsPerPage: () => 10,
      setRecordsPerPage: vi.fn(),
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
      filters,
      advancedConditions: {
        addCondition: vi.fn(),
        parseFromUI: vi.fn(() => []),
        clear: vi.fn(),
        bindQuickTimeControls: vi.fn(),
        addQuickTimeCondition: vi.fn(),
      },
      addAdvancedCondition: vi.fn(),
      setAdvancedConditions: vi.fn(),
      listPickerRuntime: { close: vi.fn() },
      coverRuntime: { ensureTooltipElement: vi.fn() },
      handleExportRecords: vi.fn(),
      updateBatchUI: vi.fn(),
      debounce: (callback) => callback,
    });

    expect(filters.tags.render).not.toHaveBeenCalled();
    expect(filters.lists.render).not.toHaveBeenCalled();
    expect(filters.series.render).not.toHaveBeenCalled();
    expect(filters.labels.render).not.toHaveBeenCalled();
  });
});
