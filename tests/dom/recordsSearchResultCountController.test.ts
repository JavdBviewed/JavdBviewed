/**
 * @file recordsSearchResultCountController.test.ts
 * @description records search result count controller 测试
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';
import { createRecordsSearchResultCountController } from '../../apps/extension/src/dashboard/tabs/records/searchResultCountController';

function setupDom() {
  document.body.innerHTML = `
    <div id="searchResultCount"></div>
    <input id="searchInput" value="ABC" />
    <select id="filterSelect">
      <option value="all">全部</option>
      <option value="viewed" selected>已看</option>
    </select>
  `;

  return {
    container: document.getElementById('searchResultCount') as HTMLDivElement,
    searchInput: document.getElementById('searchInput') as HTMLInputElement,
    filterSelect: document.getElementById('filterSelect') as HTMLSelectElement,
  };
}

describe('records search result count controller', () => {
  it('renders visible search summary from filters and selection counts', () => {
    const elements = setupDom();
    const controller = createRecordsSearchResultCountController({
      ...elements,
      getTotalCount: () => 12,
      getDurationMs: () => 8.5,
      getSelectedTagsCount: () => 2,
      getSelectedListIdsCount: () => 1,
      getSelectedSeriesIdsCount: () => 0,
      getSelectedLabelIdsCount: () => 0,
      getSelectedMakerIdsCount: () => 2,
      getSelectedDirectorIdsCount: () => 1,
      getAdvancedConditionsCount: () => 1,
    });

    controller.update();

    expect(elements.container.style.display).toBe('flex');
    expect(elements.container.textContent).toContain('找到 12 个结果');
    expect(elements.container.textContent).toContain('ABC');
    expect(elements.container.textContent).toContain('已看');
    expect(elements.container.textContent).toContain('2个片商');
    expect(elements.container.textContent).toContain('1个導演');
  });

  it('hides the summary when there is no active query or filter', () => {
    const elements = setupDom();
    elements.searchInput.value = '';
    elements.filterSelect.value = 'all';
    const controller = createRecordsSearchResultCountController({
      ...elements,
      getTotalCount: () => 0,
      getDurationMs: () => null,
      getSelectedTagsCount: () => 0,
      getSelectedListIdsCount: () => 0,
      getSelectedSeriesIdsCount: () => 0,
      getSelectedLabelIdsCount: () => 0,
      getSelectedMakerIdsCount: () => 0,
      getSelectedDirectorIdsCount: () => 0,
      getAdvancedConditionsCount: () => 0,
    });

    controller.update();

    expect(elements.container.style.display).toBe('none');
  });
});
