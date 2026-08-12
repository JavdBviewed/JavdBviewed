import { describe, expect, it, vi } from 'vitest';
import { createRecordsFilterRuntime } from './filterRuntime';
import type { VideoRecord } from '../../../types';

function filterElements() {
  return {
    filterInput: { style: {} } as HTMLInputElement,
    dropdown: { style: { display: 'block' } } as HTMLElement,
    searchInput: {} as HTMLInputElement,
    optionList: {} as HTMLElement,
    selectedContainer: {} as HTMLElement,
  };
}

function record(id: string): VideoRecord {
  return {
    id,
    title: id,
    status: 'viewed',
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('records filter runtime', () => {
  it('wires filter controllers, backdrop sync, and local filtering state', () => {
    const selectedTags = new Set<string>();
    let tokenSelectedTags = new Set<string>();
    let tokenSelectedListIds = new Set<string>();
    let tokenSelectedSeriesIds = new Set<string>();
    let tokenSelectedLabelIds = new Set<string>();
    let filteredRecords: VideoRecord[] = [];

    const controllers = {
      tags: { refresh: vi.fn(), clearRenderedOptions: vi.fn() },
      lists: { refresh: vi.fn(), clearRenderedOptions: vi.fn() },
      series: { refresh: vi.fn(), clearRenderedOptions: vi.fn() },
      labels: { refresh: vi.fn(), clearRenderedOptions: vi.fn() },
    };
    const backdropController = {
      sync: vi.fn(),
      getBackdrop: vi.fn(),
    };
    const localFilterRuntime = {
      updateFilteredRecords: vi.fn(),
    };
    const createFilterControllers = vi.fn(() => controllers);
    const createDropdownBackdropController = vi.fn(() => backdropController);
    const createLocalFilterRuntime = vi.fn(() => localFilterRuntime);
    const onFilterChanged = vi.fn();
    const tagsElements = filterElements();
    const listsElements = filterElements();
    const seriesElements = filterElements();
    const labelsElements = filterElements();

    const runtime = createRecordsFilterRuntime({
      elements: {
        searchInput: { value: '' } as HTMLInputElement,
        filterSelect: { value: 'all' } as HTMLSelectElement,
        sortSelect: { value: 'updatedAt_desc' } as HTMLSelectElement,
        filters: {
          tags: tagsElements,
          lists: listsElements,
          series: seriesElements,
          labels: labelsElements,
        },
      },
      getRecords: () => [record('AAA-001')],
      selectedTags,
      selectedListIds: new Set<string>(),
      selectedSeriesIds: new Set<string>(),
      selectedLabelIds: new Set<string>(),
      getTokenSelectedTags: () => tokenSelectedTags,
      setTokenSelectedTags: (value) => {
        tokenSelectedTags = value;
      },
      getTokenSelectedListIds: () => tokenSelectedListIds,
      setTokenSelectedListIds: (value) => {
        tokenSelectedListIds = value;
      },
      getTokenSelectedSeriesIds: () => tokenSelectedSeriesIds,
      setTokenSelectedSeriesIds: (value) => {
        tokenSelectedSeriesIds = value;
      },
      getTokenSelectedLabelIds: () => tokenSelectedLabelIds,
      setTokenSelectedLabelIds: (value) => {
        tokenSelectedLabelIds = value;
      },
      getAllTags: () => ['字幕'],
      listNameById: new Map([['list-1', '清单']]),
      listSourceById: new Map([['list-1', 'local']]),
      seriesNameById: new Map([['series-1', '系列']]),
      labelNameById: new Map([['label-1', '番号']]),
      seriesIdToRecord: new Map(),
      labelIdToRecord: new Map(),
      ensureListMetaLoaded: vi.fn(),
      getAdvancedConditions: () => [],
      isFavoritesFilterActive: () => false,
      setFilteredRecords: (records) => {
        filteredRecords = records;
      },
      onFilterChanged,
      escapeHtml: (value) => value,
      createFilterControllers,
      createDropdownBackdropController,
      createLocalFilterRuntime,
    });

    runtime.syncDropdownBackdrop();
    runtime.updateFilteredRecords();
    runtime.clearRenderedOptions();

    const filterOptions = createFilterControllers.mock.calls[0][0];
    const backdropOptions = createDropdownBackdropController.mock.calls[0][0];
    const localOptions = createLocalFilterRuntime.mock.calls[0][0];
    filterOptions.onChange();
    filterOptions.syncDropdownBackdrop();
    filterOptions.tokenSelectedListIds().add('list-1');
    backdropOptions.closeDropdowns();
    localOptions.setTokenSelectedTags(new Set(['字幕']));
    localOptions.setTokenSelectedListIds(new Set(['list-1']));
    localOptions.setFilteredRecords([record('BBB-002')]);
    localOptions.refreshTags();
    localOptions.refreshLists();
    localOptions.refreshSeries();
    localOptions.refreshLabels();

    expect(runtime.filterControllers).toBe(controllers);
    expect(runtime.localFilterRuntime).toBe(localFilterRuntime);
    expect(runtime.dropdownBackdropController).toBe(backdropController);
    expect(createFilterControllers).toHaveBeenCalledWith(expect.objectContaining({
      selectedTags,
      tokenSelectedListIds: expect.any(Function),
      syncDropdownBackdrop: expect.any(Function),
      onChange: onFilterChanged,
    }));
    expect(createDropdownBackdropController).toHaveBeenCalledWith(expect.objectContaining({
      dropdowns: expect.arrayContaining([
        tagsElements.dropdown,
        listsElements.dropdown,
      ]),
      closeDropdowns: expect.any(Function),
    }));
    expect(createLocalFilterRuntime).toHaveBeenCalledWith(expect.objectContaining({
      refreshTags: expect.any(Function),
      refreshLists: expect.any(Function),
      refreshSeries: expect.any(Function),
      refreshLabels: expect.any(Function),
    }));
    expect(backdropController.sync).toHaveBeenCalledTimes(2);
    expect(tagsElements.dropdown.style.display).toBe('none');
    expect(listsElements.dropdown.style.display).toBe('none');
    expect(seriesElements.dropdown.style.display).toBe('block');
    expect(labelsElements.dropdown.style.display).toBe('block');
    expect(localFilterRuntime.updateFilteredRecords).toHaveBeenCalledTimes(1);
    expect(onFilterChanged).toHaveBeenCalledTimes(1);
    expect(tokenSelectedTags).toEqual(new Set(['字幕']));
    expect(tokenSelectedListIds).toEqual(new Set(['list-1']));
    expect(filteredRecords).toEqual([record('BBB-002')]);
    expect(controllers.tags.refresh).toHaveBeenCalledTimes(1);
    expect(controllers.lists.refresh).toHaveBeenCalledTimes(1);
    expect(controllers.series.refresh).toHaveBeenCalledTimes(1);
    expect(controllers.labels.refresh).toHaveBeenCalledTimes(1);
    expect(controllers.tags.clearRenderedOptions).toHaveBeenCalledTimes(1);
    expect(controllers.lists.clearRenderedOptions).toHaveBeenCalledTimes(1);
    expect(controllers.series.clearRenderedOptions).toHaveBeenCalledTimes(1);
    expect(controllers.labels.clearRenderedOptions).toHaveBeenCalledTimes(1);
  });
});
