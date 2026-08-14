/**
 * @file recordsPageLifecycleController.test.ts
 * @description records page lifecycle controller 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { bindRecordsPageLifecycle } from '../../apps/extension/src/dashboard/tabs/records/pageLifecycleController';

function setupDom() {
  document.body.innerHTML = `
    <input id="searchInput" />
    <select id="filterSelect"><option value="all">全部</option><option value="viewed">已看</option></select>
    <select id="sortSelect"><option value="updatedAt_desc">更新时间</option></select>
    <select id="recordsPerPageSelect"><option value="10">10</option><option value="20">20</option></select>
    <button id="exportRecordsBtn"></button>
    <button id="advAddBtn"></button>
    <button id="advApplyBtn"></button>
    <button id="advResetBtn"></button>
    <button id="addQuickTimeBtn"></button>
    <input id="tagsFilterInput" /><div id="tagsFilterDropdown" style="display:none"></div>
    <input id="listsFilterInput" /><div id="listsFilterDropdown" style="display:none"></div>
    <input id="seriesFilterInput" /><div id="seriesFilterDropdown" style="display:none"></div>
    <input id="labelsFilterInput" /><div id="labelsFilterDropdown" style="display:none"></div>
    <button id="listPickerCloseBtn"></button>
    <button id="listPickerDoneBtn"></button>
    <div id="listPickerPanel"><div class="list-picker-backdrop"></div></div>
  `;

  return {
    searchInput: document.getElementById('searchInput') as HTMLInputElement,
    filterSelect: document.getElementById('filterSelect') as HTMLSelectElement,
    sortSelect: document.getElementById('sortSelect') as HTMLSelectElement,
    recordsPerPageSelect: document.getElementById('recordsPerPageSelect') as HTMLSelectElement,
    exportRecordsBtn: document.getElementById('exportRecordsBtn') as HTMLButtonElement,
    advAddBtn: document.getElementById('advAddBtn') as HTMLButtonElement,
    advApplyBtn: document.getElementById('advApplyBtn') as HTMLButtonElement,
    advResetBtn: document.getElementById('advResetBtn') as HTMLButtonElement,
    addQuickTimeBtn: document.getElementById('addQuickTimeBtn') as HTMLButtonElement,
    tagsFilterInput: document.getElementById('tagsFilterInput') as HTMLInputElement,
    tagsFilterDropdown: document.getElementById('tagsFilterDropdown') as HTMLElement,
    listsFilterInput: document.getElementById('listsFilterInput') as HTMLInputElement,
    listsFilterDropdown: document.getElementById('listsFilterDropdown') as HTMLElement,
    seriesFilterInput: document.getElementById('seriesFilterInput') as HTMLInputElement,
    seriesFilterDropdown: document.getElementById('seriesFilterDropdown') as HTMLElement,
    labelsFilterInput: document.getElementById('labelsFilterInput') as HTMLInputElement,
    labelsFilterDropdown: document.getElementById('labelsFilterDropdown') as HTMLElement,
  };
}

function createCalls() {
  const calls: string[] = [];
  const mark = (name: string) => vi.fn(() => calls.push(name));
  return { calls, mark };
}

describe('records page lifecycle controller', () => {
  it('preserves binding and initialization order', () => {
    const elements = setupDom();
    const { calls, mark } = createCalls();

    bindRecordsPageLifecycle({
      elements,
      getRecordsPerPage: () => 20,
      setRecordsPerPage: mark('setRecordsPerPage'),
      persistRecordsPerPage: mark('persistRecordsPerPage'),
      resetCurrentPage: mark('resetCurrentPage'),
      updateFilteredRecords: mark('updateFilteredRecords'),
      render: mark('render'),
      syncDropdownBackdrop: mark('syncDropdownBackdrop'),
      triggerSuggest: mark('triggerSuggest'),
      triggerFilter: mark('triggerFilter'),
      viewToolbar: { bind: mark('viewToolbar.bind'), update: mark('viewToolbar.update') },
      batchToolbar: { bind: mark('batchToolbar.bind') },
      searchSuggest: { bind: mark('searchSuggest.bind') },
      filters: {
        tags: { bind: mark('tags.bind'), render: mark('tags.render') },
        lists: { bind: mark('lists.bind'), render: mark('lists.render') },
        series: { bind: mark('series.bind') },
        labels: { bind: mark('labels.bind') },
      },
      advancedConditions: {
        addCondition: mark('advanced.addCondition'),
        parseFromUI: vi.fn(() => []),
        clear: mark('advanced.clear'),
        bindQuickTimeControls: mark('advanced.bindQuickTimeControls'),
        addQuickTimeCondition: mark('advanced.addQuickTimeCondition'),
      },
      addAdvancedCondition: mark('addAdvancedCondition'),
      setAdvancedConditions: mark('setAdvancedConditions'),
      listPickerRuntime: { close: mark('listPicker.close') },
      coverRuntime: { ensureTooltipElement: mark('cover.ensureTooltipElement') },
      handleExportRecords: mark('handleExportRecords'),
      updateBatchUI: mark('updateBatchUI'),
      debounce: (fn) => fn,
    });

    expect(elements.recordsPerPageSelect.value).toBe('20');
    expect(calls).toEqual([
      'viewToolbar.bind',
      'advanced.bindQuickTimeControls',
      'searchSuggest.bind',
      'tags.bind',
      'lists.bind',
      'series.bind',
      'labels.bind',
      'batchToolbar.bind',
      'cover.ensureTooltipElement',
      'viewToolbar.update',
      'updateFilteredRecords',
      'render',
      'updateBatchUI',
    ]);
  });

  it('keeps event callbacks wired to the current closures', () => {
    const elements = setupDom();
    const calls: string[] = [];
    const mark = (name: string) => vi.fn(() => calls.push(name));
    const resetCurrentPage = mark('resetCurrentPage');
    const triggerSuggest = mark('triggerSuggest');
    const triggerFilter = mark('triggerFilter');
    const render = mark('render');
    const handleExportRecords = mark('handleExportRecords');
    const setRecordsPerPage = vi.fn();
    const parsedCondition = { id: 'cond-1', field: 'id', op: 'contains', value: 'ABC' } as const;

    bindRecordsPageLifecycle({
      elements,
      getRecordsPerPage: () => 10,
      setRecordsPerPage,
      persistRecordsPerPage: mark('persistRecordsPerPage'),
      resetCurrentPage,
      updateFilteredRecords: mark('updateFilteredRecords'),
      render,
      syncDropdownBackdrop: mark('syncDropdownBackdrop'),
      triggerSuggest,
      triggerFilter,
      viewToolbar: { bind: mark('viewToolbar.bind'), update: mark('viewToolbar.update') },
      batchToolbar: { bind: mark('batchToolbar.bind') },
      searchSuggest: { bind: mark('searchSuggest.bind') },
      filters: {
        tags: { bind: mark('tags.bind'), render: mark('tags.render') },
        lists: { bind: mark('lists.bind'), render: mark('lists.render') },
        series: { bind: mark('series.bind') },
        labels: { bind: mark('labels.bind') },
      },
      advancedConditions: {
        addCondition: mark('advanced.addCondition'),
        parseFromUI: vi.fn(() => [parsedCondition]),
        clear: mark('advanced.clear'),
        bindQuickTimeControls: mark('advanced.bindQuickTimeControls'),
        addQuickTimeCondition: mark('advanced.addQuickTimeCondition'),
      },
      addAdvancedCondition: mark('addAdvancedCondition'),
      setAdvancedConditions: mark('setAdvancedConditions'),
      listPickerRuntime: { close: mark('listPicker.close') },
      coverRuntime: { ensureTooltipElement: mark('cover.ensureTooltipElement') },
      handleExportRecords,
      updateBatchUI: mark('updateBatchUI'),
      debounce: (fn) => fn,
    });

    elements.searchInput.dispatchEvent(new Event('input'));
    elements.filterSelect.dispatchEvent(new Event('change'));
    elements.sortSelect.dispatchEvent(new Event('change'));
    elements.recordsPerPageSelect.value = '20';
    elements.recordsPerPageSelect.dispatchEvent(new Event('change'));
    elements.exportRecordsBtn.click();
    elements.advApplyBtn.click();

    expect(triggerSuggest).toHaveBeenCalledTimes(1);
    expect(triggerFilter).toHaveBeenCalledTimes(1);
    expect(resetCurrentPage).toHaveBeenCalledTimes(4);
    expect(setRecordsPerPage).toHaveBeenCalledWith(20);
    expect(render).toHaveBeenCalled();
    expect(handleExportRecords).toHaveBeenCalledTimes(1);
    const applyIndex = calls.indexOf('setAdvancedConditions');
    expect(calls.slice(applyIndex, applyIndex + 4)).toEqual([
      'setAdvancedConditions',
      'resetCurrentPage',
      'updateFilteredRecords',
      'render',
    ]);
  });

  it('invokes list picker close through the runtime object', () => {
    const elements = setupDom();
    const { mark } = createCalls();
    const listPickerRuntime = {
      closed: 0,
      close() {
        this.closed += 1;
      },
    };

    bindRecordsPageLifecycle({
      elements,
      getRecordsPerPage: () => 10,
      setRecordsPerPage: mark('setRecordsPerPage'),
      persistRecordsPerPage: mark('persistRecordsPerPage'),
      resetCurrentPage: mark('resetCurrentPage'),
      updateFilteredRecords: mark('updateFilteredRecords'),
      render: mark('render'),
      syncDropdownBackdrop: mark('syncDropdownBackdrop'),
      triggerSuggest: mark('triggerSuggest'),
      triggerFilter: mark('triggerFilter'),
      viewToolbar: { bind: mark('viewToolbar.bind'), update: mark('viewToolbar.update') },
      batchToolbar: { bind: mark('batchToolbar.bind') },
      searchSuggest: { bind: mark('searchSuggest.bind') },
      filters: {
        tags: { bind: mark('tags.bind'), render: mark('tags.render') },
        lists: { bind: mark('lists.bind'), render: mark('lists.render') },
        series: { bind: mark('series.bind') },
        labels: { bind: mark('labels.bind') },
      },
      advancedConditions: {
        addCondition: mark('advanced.addCondition'),
        parseFromUI: vi.fn(() => []),
        clear: mark('advanced.clear'),
        bindQuickTimeControls: mark('advanced.bindQuickTimeControls'),
        addQuickTimeCondition: mark('advanced.addQuickTimeCondition'),
      },
      addAdvancedCondition: mark('addAdvancedCondition'),
      setAdvancedConditions: mark('setAdvancedConditions'),
      listPickerRuntime,
      coverRuntime: { ensureTooltipElement: mark('cover.ensureTooltipElement') },
      handleExportRecords: mark('handleExportRecords'),
      updateBatchUI: mark('updateBatchUI'),
      debounce: (fn) => fn,
    });

    document.getElementById('listPickerCloseBtn')?.click();
    document.getElementById('listPickerDoneBtn')?.click();
    document.querySelector<HTMLElement>('#listPickerPanel .list-picker-backdrop')?.click();

    expect(listPickerRuntime.closed).toBe(3);
  });
});
