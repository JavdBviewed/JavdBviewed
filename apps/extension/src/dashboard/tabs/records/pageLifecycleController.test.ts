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
      makers: { bind: vi.fn(), render: vi.fn() },
      directors: { bind: vi.fn(), render: vi.fn() },
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
        makersFilterInput: element(),
        makersFilterDropdown: element(),
        directorsFilterInput: element(),
        directorsFilterDropdown: element(),
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
    expect(filters.makers.render).not.toHaveBeenCalled();
    expect(filters.directors.render).not.toHaveBeenCalled();
  });

  it('filterSelect change 触发既有刷新链 + onFilterSelectChanged（10-08 媒体项 ensureLoaded 触发接线）', () => {
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
      makers: { bind: vi.fn(), render: vi.fn() },
      directors: { bind: vi.fn(), render: vi.fn() },
    };
    const filterSelect = element<HTMLSelectElement>();
    const onFilterSelectChanged = vi.fn();
    const resetCurrentPage = vi.fn();
    const updateFilteredRecords = vi.fn();
    const render = vi.fn();

    bindRecordsPageLifecycle({
      elements: {
        searchInput: element<HTMLInputElement>(),
        filterSelect,
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
        makersFilterInput: element(),
        makersFilterDropdown: element(),
        directorsFilterInput: element(),
        directorsFilterDropdown: element(),
      },
      getRecordsPerPage: () => 10,
      setRecordsPerPage: vi.fn(),
      persistRecordsPerPage: vi.fn(),
      resetCurrentPage,
      updateFilteredRecords,
      render,
      syncDropdownBackdrop: vi.fn(),
      triggerSuggest: vi.fn(),
      triggerFilter: vi.fn(),
      onFilterSelectChanged,
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

    // 绑定末次初始刷新一次（既有行为），change 事件前基线
    expect(resetCurrentPage).toHaveBeenCalledTimes(0);
    expect(updateFilteredRecords).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(onFilterSelectChanged).toHaveBeenCalledTimes(0);

    const changeCall = filterSelect.addEventListener.mock.calls
      .find(call => call[0] === 'change') as [string, EventListener] | undefined;
    expect(changeCall).toBeDefined();
    changeCall?.[1]({} as Event);

    expect(resetCurrentPage).toHaveBeenCalledTimes(1);
    expect(updateFilteredRecords).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(2);
    expect(onFilterSelectChanged).toHaveBeenCalledTimes(1);
  });
});
