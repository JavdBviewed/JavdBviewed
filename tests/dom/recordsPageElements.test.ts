/**
 * @file recordsPageElements.test.ts
 * @description records page elements 测试
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';
import { collectRecordsPageElements, ensureUntrackedStatusOption } from '../../apps/extension/src/dashboard/tabs/records/pageElements';

function setupRecordsDom() {
  document.body.innerHTML = `
    <input id="searchInput" />
    <select id="filterSelect">
      <option value="all">全部</option>
      <option value="viewed">已看</option>
    </select>
    <select id="sortSelect"></select>
    <ul id="videoList"></ul>
    <div class="pagination-controls"><div class="pagination"></div></div>
    <select id="recordsPerPageSelect"></select>
    <div id="searchResultCount"></div>
    <input id="tagsFilterInput" /><div id="tagsFilterDropdown"></div><input id="tagsSearchInput" /><div id="tagsFilterList"></div><div id="selectedTagsContainer"></div>
    <input id="listsFilterInput" /><div id="listsFilterDropdown"></div><input id="listsSearchInput" /><div id="listsFilterList"></div><div id="selectedListsContainer"></div>
    <input id="seriesFilterInput" /><div id="seriesFilterDropdown"></div><input id="seriesSearchInput" /><div id="seriesFilterList"></div><div id="selectedSeriesContainer"></div>
    <input id="labelsFilterInput" /><div id="labelsFilterDropdown"></div><input id="labelsSearchInput" /><div id="labelsFilterList"></div><div id="selectedLabelsContainer"></div>
    <input id="makersFilterInput" /><div id="makersFilterDropdown"></div><input id="makersSearchInput" /><div id="makersFilterList"></div><div id="selectedMakersContainer"></div>
    <input id="directorsFilterInput" /><div id="directorsFilterDropdown"></div><input id="directorsSearchInput" /><div id="directorsFilterList"></div><div id="selectedDirectorsContainer"></div>
    <button id="addConditionBtn"></button><button id="applyConditionsBtn"></button><button id="resetConditionsBtn"></button><div id="advConditions"></div>
    <select id="quickTimeField"></select><input id="quickTimeValue" /><select id="quickTimeUnit"></select><button id="addQuickTimeBtn"></button>
    <div id="searchSuggest"></div>
    <div id="batchOperations"></div><input id="selectAllCheckbox" /><span id="selectedCount"></span>
    <button id="batchActionsBtn"></button><div id="batchActionsDropdown"></div><button id="batchModifyListBtn"></button>
    <button id="batchAddTagBtn"></button><button id="batchRefreshBtn"></button><button id="batchDeleteBtn"></button><button id="cancelBatchBtn"></button>
    <button id="toggleCoversBtn"></button><button id="toggleViewModeBtn"></button><button id="myFavoritesBtn"></button>
  `;
}

describe('records page elements', () => {
  it('ensures the untracked status option before viewed', () => {
    setupRecordsDom();
    const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;

    ensureUntrackedStatusOption(filterSelect, { untracked: 'untracked', viewed: 'viewed' });
    ensureUntrackedStatusOption(filterSelect, { untracked: 'untracked', viewed: 'viewed' });

    expect(Array.from(filterSelect.options).map(option => option.value)).toEqual(['all', 'untracked', 'viewed']);
    expect(filterSelect.options[1].textContent).toBe('未标记');
  });

  it('collects the required page elements from the document', () => {
    setupRecordsDom();

    const elements = collectRecordsPageElements(document);

    expect(elements.required.searchInput.id).toBe('searchInput');
    expect(elements.required.videoList.id).toBe('videoList');
    expect(elements.required.paginationContainer.className).toBe('pagination');
    expect(elements.filters.tags.optionList.id).toBe('tagsFilterList');
    expect(elements.filters.makers.optionList.id).toBe('makersFilterList');
    expect(elements.filters.makers.selectedContainer.id).toBe('selectedMakersContainer');
    expect(elements.filters.directors.optionList.id).toBe('directorsFilterList');
    expect(elements.filters.directors.selectedContainer.id).toBe('selectedDirectorsContainer');
    expect(elements.advanced.quickTimeValue.id).toBe('quickTimeValue');
    expect(elements.batch.batchDeleteBtn.id).toBe('batchDeleteBtn');
    expect(elements.toolbar.myFavoritesBtn.id).toBe('myFavoritesBtn');
  });
});
