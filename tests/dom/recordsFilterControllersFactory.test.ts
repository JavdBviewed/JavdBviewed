/**
 * @file recordsFilterControllersFactory.test.ts
 * @description records filter controllers factory 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsFilterControllers } from '../../apps/extension/src/dashboard/tabs/records/filterControllersFactory';

function setupDom() {
  document.body.innerHTML = `
    <input id="searchInput" />
    <input id="tagsFilterInput" /><div id="tagsFilterDropdown" style="display:none"><input id="tagsSearchInput" /><div id="tagsFilterList"></div></div><div id="selectedTagsContainer"></div>
    <input id="listsFilterInput" /><div id="listsFilterDropdown" style="display:none"><input id="listsSearchInput" /><div id="listsFilterList"></div></div><div id="selectedListsContainer"></div>
    <input id="seriesFilterInput" /><div id="seriesFilterDropdown" style="display:none"><input id="seriesSearchInput" /><div id="seriesFilterList"></div></div><div id="selectedSeriesContainer"></div>
    <input id="labelsFilterInput" /><div id="labelsFilterDropdown" style="display:none"><input id="labelsSearchInput" /><div id="labelsFilterList"></div></div><div id="selectedLabelsContainer"></div>
    <input id="makersFilterInput" /><div id="makersFilterDropdown" style="display:none"><input id="makersSearchInput" /><div id="makersFilterList"></div></div><div id="selectedMakersContainer"></div>
    <input id="directorsFilterInput" /><div id="directorsFilterDropdown" style="display:none"><input id="directorsSearchInput" /><div id="directorsFilterList"></div></div><div id="selectedDirectorsContainer"></div>
  `;

  return {
    searchInput: document.getElementById('searchInput') as HTMLInputElement,
    tags: {
      filterInput: document.getElementById('tagsFilterInput') as HTMLInputElement,
      dropdown: document.getElementById('tagsFilterDropdown') as HTMLElement,
      searchInput: document.getElementById('tagsSearchInput') as HTMLInputElement,
      optionList: document.getElementById('tagsFilterList') as HTMLElement,
      selectedContainer: document.getElementById('selectedTagsContainer') as HTMLElement,
    },
    lists: {
      filterInput: document.getElementById('listsFilterInput') as HTMLInputElement,
      dropdown: document.getElementById('listsFilterDropdown') as HTMLElement,
      searchInput: document.getElementById('listsSearchInput') as HTMLInputElement,
      optionList: document.getElementById('listsFilterList') as HTMLElement,
      selectedContainer: document.getElementById('selectedListsContainer') as HTMLElement,
    },
    series: {
      filterInput: document.getElementById('seriesFilterInput') as HTMLInputElement,
      dropdown: document.getElementById('seriesFilterDropdown') as HTMLElement,
      searchInput: document.getElementById('seriesSearchInput') as HTMLInputElement,
      optionList: document.getElementById('seriesFilterList') as HTMLElement,
      selectedContainer: document.getElementById('selectedSeriesContainer') as HTMLElement,
    },
    labels: {
      filterInput: document.getElementById('labelsFilterInput') as HTMLInputElement,
      dropdown: document.getElementById('labelsFilterDropdown') as HTMLElement,
      searchInput: document.getElementById('labelsSearchInput') as HTMLInputElement,
      optionList: document.getElementById('labelsFilterList') as HTMLElement,
      selectedContainer: document.getElementById('selectedLabelsContainer') as HTMLElement,
    },
    makers: {
      filterInput: document.getElementById('makersFilterInput') as HTMLInputElement,
      dropdown: document.getElementById('makersFilterDropdown') as HTMLElement,
      searchInput: document.getElementById('makersSearchInput') as HTMLInputElement,
      optionList: document.getElementById('makersFilterList') as HTMLElement,
      selectedContainer: document.getElementById('selectedMakersContainer') as HTMLElement,
    },
    directors: {
      filterInput: document.getElementById('directorsFilterInput') as HTMLInputElement,
      dropdown: document.getElementById('directorsFilterDropdown') as HTMLElement,
      searchInput: document.getElementById('directorsSearchInput') as HTMLInputElement,
      optionList: document.getElementById('directorsFilterList') as HTMLElement,
      selectedContainer: document.getElementById('selectedDirectorsContainer') as HTMLElement,
    },
  };
}

describe('records filter controllers factory', () => {
  it('creates renderable tag, list, series, and label filter controllers', () => {
    const dom = setupDom();
    const controllers = createRecordsFilterControllers({
      elements: dom,
      selectedTags: new Set(['中文字幕']),
      selectedListIds: new Set(['list-1']),
      selectedSeriesIds: new Set(['series-1']),
      selectedLabelIds: new Set(['ABC']),
      selectedMakerIds: new Set(['maker-1']),
      selectedDirectorIds: new Set(['director-1']),
      tokenSelectedListIds: new Set(),
      tokenSelectedSeriesIds: new Set(),
      tokenSelectedLabelIds: new Set(),
      tokenSelectedMakerIds: new Set(),
      tokenSelectedDirectorIds: new Set(),
      getAllTags: () => ['中文字幕'],
      listNameById: new Map([['list-1', '收藏']]),
      listSourceById: new Map([['list-1', 'local']]),
      seriesNameById: new Map([['series-1', '系列一']]),
      labelNameById: new Map([['ABC', 'ABC']]),
      makerNameById: new Map([['maker-1', '片商A']]),
      directorNameById: new Map([['director-1', '導演B']]),
      ensureListMetaLoaded: vi.fn(),
      syncDropdownBackdrop: vi.fn(),
      onChange: vi.fn(),
    });

    controllers.tags.render();
    controllers.lists.render();
    controllers.series.render();
    controllers.labels.render();
    controllers.makers.render();
    controllers.directors.render();

    expect(dom.tags.optionList.textContent).toContain('中文字幕');
    expect(dom.lists.optionList.textContent).toContain('收藏');
    expect(dom.series.optionList.textContent).toContain('系列一');
    expect(dom.labels.optionList.textContent).toContain('ABC');
    expect(dom.makers.optionList.textContent).toContain('片商A');
    expect(dom.directors.optionList.textContent).toContain('導演B');
    expect(dom.lists.optionList.innerHTML).toContain('本地');
  });

  it('removes token-backed list, series, and label tokens through the search input', () => {
    const dom = setupDom();
    dom.searchInput.value = 'listid:list-1 series:series-1 label:ABC';
    const inputEvents: string[] = [];
    dom.searchInput.addEventListener('input', () => inputEvents.push(dom.searchInput.value));

    const controllers = createRecordsFilterControllers({
      elements: dom,
      selectedTags: new Set(),
      selectedListIds: new Set(['list-1']),
      selectedSeriesIds: new Set(['series-1']),
      selectedLabelIds: new Set(['ABC']),
      selectedMakerIds: new Set(),
      selectedDirectorIds: new Set(),
      tokenSelectedListIds: new Set(['list-1']),
      tokenSelectedSeriesIds: new Set(['series-1']),
      tokenSelectedLabelIds: new Set(['ABC']),
      tokenSelectedMakerIds: new Set(),
      tokenSelectedDirectorIds: new Set(),
      getAllTags: () => [],
      listNameById: new Map([['list-1', '收藏']]),
      listSourceById: new Map(),
      seriesNameById: new Map([['series-1', '系列一']]),
      labelNameById: new Map([['ABC', 'ABC']]),
      makerNameById: new Map(),
      directorNameById: new Map(),
      ensureListMetaLoaded: vi.fn(),
      syncDropdownBackdrop: vi.fn(),
      onChange: vi.fn(),
    });

    controllers.lists.bind();
    controllers.series.bind();
    controllers.labels.bind();
    controllers.lists.render();
    controllers.series.render();
    controllers.labels.render();

    (dom.lists.selectedContainer.querySelector('.remove-tag') as HTMLElement).click();
    expect(dom.searchInput.value).toBe('series:series-1 label:ABC');

    (dom.series.selectedContainer.querySelector('.remove-tag') as HTMLElement).click();
    expect(dom.searchInput.value).toBe('label:ABC');

    (dom.labels.selectedContainer.querySelector('.remove-tag') as HTMLElement).click();
    expect(dom.searchInput.value).toBe('');
    expect(inputEvents).toHaveLength(3);
  });

  it('uses latest token-backed list set from a dynamic getter', () => {
    const dom = setupDom();
    dom.searchInput.value = 'listid:list-1';
    let tokenSelectedListIds = new Set<string>();
    const inputEvents: string[] = [];
    dom.searchInput.addEventListener('input', () => inputEvents.push(dom.searchInput.value));

    const controllers = createRecordsFilterControllers({
      elements: dom,
      selectedTags: new Set(),
      selectedListIds: new Set(['list-1']),
      selectedSeriesIds: new Set(),
      selectedLabelIds: new Set(),
      selectedMakerIds: new Set(),
      selectedDirectorIds: new Set(),
      tokenSelectedListIds: () => tokenSelectedListIds,
      tokenSelectedSeriesIds: new Set(),
      tokenSelectedLabelIds: new Set(),
      tokenSelectedMakerIds: new Set(),
      tokenSelectedDirectorIds: new Set(),
      getAllTags: () => [],
      listNameById: new Map([['list-1', '收藏']]),
      listSourceById: new Map(),
      seriesNameById: new Map(),
      labelNameById: new Map(),
      makerNameById: new Map(),
      directorNameById: new Map(),
      ensureListMetaLoaded: vi.fn(),
      syncDropdownBackdrop: vi.fn(),
      onChange: vi.fn(),
    });

    controllers.lists.bind();
    controllers.lists.render();

    tokenSelectedListIds = new Set(['list-1']);
    (dom.lists.selectedContainer.querySelector('.remove-tag') as HTMLElement).click();

    expect(dom.searchInput.value).toBe('');
    expect(inputEvents).toHaveLength(1);
  });
});
