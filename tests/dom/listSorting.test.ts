/**
 * @file listSorting.test.ts
 * @description 列表排序增强测试 —— 已加载影片排序、原站排序识别、页间提示
 * @module tests/dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectNativeSortCapabilities,
  readSortableItems,
  sortSortableItems,
} from '../../apps/extension/src/features/listEnhancement/application/listSorting';
import {
  createListSortingController,
} from '../../apps/extension/src/features/listEnhancement/ui/listSortingControls';
import { listEnhancementManager } from '../../apps/extension/src/features/listEnhancement/listEnhancementManager';
import { LIST_ENHANCEMENT_BASE_STYLES } from '../../apps/extension/src/features/listEnhancement/ui/styles';

function mountMovieList(): void {
  document.body.innerHTML = `
    <div class="movie-list">
      <div class="item" data-case="low-count">
        <div class="video-title"><strong>AAA-001</strong> Low Count</div>
        <div class="score"><span class="value">4.8 分，由 12 人评价</span></div>
      </div>
      <div class="item" data-case="high-count">
        <div class="video-title"><strong>BBB-002</strong> High Count</div>
        <div class="score"><span class="value">4.2 分，由 860 人评价</span></div>
      </div>
      <div class="item" data-case="missing-score">
        <div class="video-title"><strong>CCC-003</strong> Missing Score</div>
        <div class="score"><span class="value">暂无评分</span></div>
      </div>
      <div class="item" data-case="same-score">
        <div class="video-title"><strong>DDD-004</strong> Same Score</div>
        <div class="score"><span class="value">4.8 分，由 500 人评价</span></div>
      </div>
    </div>
  `;
}

function itemCases(items: ReturnType<typeof readSortableItems>): string[] {
  return items.map(item => item.element.dataset.case || '');
}

describe('list sorting helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads sortable stats and assigns stable original indexes', () => {
    mountMovieList();

    const items = readSortableItems(document);

    expect(items).toHaveLength(4);
    expect(items.map(item => item.originalIndex)).toEqual([0, 1, 2, 3]);
    expect(items[0]).toMatchObject({ score: 4.8, ratingCount: 12 });
    expect(items[2]).toMatchObject({ score: null, ratingCount: null });
    expect(items[3].element.getAttribute('data-x-list-sort-original-index')).toBe('3');
  });

  it('sorts loaded items by rating score and keeps same-score items stable', () => {
    mountMovieList();
    const sorted = sortSortableItems(readSortableItems(document), 'rating-desc');

    expect(itemCases(sorted)).toEqual([
      'low-count',
      'same-score',
      'high-count',
      'missing-score',
    ]);
  });

  it('sorts loaded items by rating count and sends missing counts to the end', () => {
    mountMovieList();
    const sorted = sortSortableItems(readSortableItems(document), 'rating-count-desc');

    expect(itemCases(sorted)).toEqual([
      'high-count',
      'same-score',
      'low-count',
      'missing-score',
    ]);
  });

  it('restores the native loaded order by original index', () => {
    mountMovieList();
    const items = readSortableItems(document);
    const reversed = [...items].reverse();

    expect(itemCases(sortSortableItems(reversed, 'original'))).toEqual([
      'low-count',
      'high-count',
      'missing-score',
      'same-score',
    ]);
  });

  it('detects native rating sort capabilities without treating loaded sorting as duplicate', () => {
    document.body.innerHTML = `
      <div class="toolbar">
        <div class="button-group">
          <div class="buttons has-addons">
            <a class="button is-small is-info is-selected" href="/actors/8VJya">发布日期倒序</a>
            <a class="button is-small" href="/actors/8VJya?sort_type=1">评分倒序</a>
            <a class="button is-small" href="/actors/8VJya?sort_type=2">热度倒序</a>
          </div>
        </div>
      </div>
    `;

    const capabilities = detectNativeSortCapabilities(document);

    expect(capabilities).toEqual({
      hasNativeToolbar: true,
      activeLabel: '发布日期倒序',
      hasRatingSort: true,
      hasRatingCountSort: false,
    });
  });
});

describe('list sorting controller', () => {
  it('多列表首页排序只整理分页主列表，不搬走每周推荐卡片', () => {
    document.body.innerHTML = `
      <section class="weekly"><div class="movie-list"><div class="item" data-case="weekly"><div class="score">5 分</div></div></div></section>
      <div class="toolbar"><div class="buttons has-addons"><a class="button is-selected is-info" href="/?vst=1">原站排序</a></div></div>
      <section class="latest"><div class="movie-list"><div class="item" data-case="low"><div class="score">2 分</div></div><div class="item" data-case="high"><div class="score">4 分</div></div></div></section>
      <nav class="pagination"><a class="pagination-link" href="/?page=2">2</a></nav>`;
    const controller = createListSortingController({
      document, window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();
    controller.applySort('rating-desc');
    expect([...document.querySelectorAll('.weekly .item')].map(item => (item as HTMLElement).dataset.case)).toEqual(['weekly']);
    expect([...document.querySelectorAll('.latest .item')].map(item => (item as HTMLElement).dataset.case)).toEqual(['high', 'low']);
    controller.cleanup();
  });
  afterEach(() => {
    listEnhancementManager.updateConfig({
      sorting: { enabled: false, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    document.body.innerHTML = '';
  });

  it('merges actor page plugin sort buttons into the native sort segmented control', () => {
    document.body.innerHTML = `
      <div class="toolbar" id="native-toolbar">
        <div class="button-group" id="native-sort-group">
          <div class="buttons has-addons">
            <a class="button is-small is-info is-selected" href="/actors/8VJya">发布日期倒序</a>
            <a class="button is-small" href="/actors/8VJya?sort_type=1">评分倒序</a>
          </div>
        </div>
      </div>
      <div class="movie-list"></div>
    `;

    const controller = createListSortingController({
      document,
      window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();

    const toolbar = document.querySelector<HTMLElement>('.x-list-sort-toolbar');
    const nativeSortGroup = document.getElementById('native-sort-group');
    const sortRow = document.querySelector<HTMLElement>('#native-toolbar .x-list-sort-row');
    const nativeSegment = sortRow?.querySelector<HTMLElement>('.x-list-sort-native-segment');
    const pluginSegment = sortRow?.querySelector<HTMLElement>('.x-list-sort-plugin-segment');
    expect(toolbar).not.toBeNull();
    expect(toolbar).toBe(document.getElementById('native-toolbar'));
    expect(document.getElementById('native-toolbar')?.nextElementSibling?.classList.contains('x-list-sort-toolbar')).toBe(false);
    expect(nativeSortGroup?.hidden).toBe(true);
    expect(sortRow).not.toBeNull();
    expect(nativeSegment).not.toBeNull();
    expect(pluginSegment).not.toBeNull();
    expect(nativeSegment?.querySelector<HTMLAnchorElement>('a[href="/actors/8VJya"]')?.textContent).toContain('发布日期倒序');
    expect(pluginSegment?.textContent).toContain('评分高优先');
    expect(pluginSegment?.textContent).toContain('评价人数多优先');
    expect(pluginSegment?.textContent).not.toContain('评分低优先');
    expect(pluginSegment?.textContent).not.toContain('评价人数少优先');
    expect(pluginSegment?.textContent).not.toContain('主');
    expect(pluginSegment?.textContent).not.toContain('次');
    expect(pluginSegment?.textContent).not.toContain('高到低');
    expect(pluginSegment?.textContent).not.toContain('低到高');
    expect(sortRow?.textContent).not.toContain('原站顺序');
    expect(sortRow?.textContent).not.toContain('增强排序');
    expect(pluginSegment?.querySelectorAll('.x-list-sort-button')).toHaveLength(2);
    expect(pluginSegment?.querySelector<HTMLButtonElement>('[data-list-sort-mode="rating-desc"]')).not.toBeNull();
    expect(pluginSegment?.querySelector<HTMLButtonElement>('[data-list-sort-mode="rating-count-desc"]')).not.toBeNull();
    expect(pluginSegment?.querySelector<HTMLButtonElement>('[data-list-sort-mode="original"]')).toBeNull();
    expect(nativeSegment?.querySelector('[data-list-sort-mode]')).toBeNull();
    expect(pluginSegment?.querySelector('a[href]')).toBeNull();
  });

  it('splits list page controls into a primary row and a merged sort row', () => {
    document.body.innerHTML = `
      <div class="toolbar" id="native-toolbar">
        <div class="button-group" id="cover-group">
          <div class="buttons has-addons">
            <a class="button is-small is-info is-selected" href="/?lm=h&vft=1">大封面</a>
            <a class="button is-small" href="/?lm=v&vft=1">小封面</a>
          </div>
        </div>
        <div class="button-group" id="filter-group">
          <div class="buttons has-addons">
            <a class="button is-small" href="/?vft=4&vst=3">可播放</a>
            <a class="button is-small is-info is-selected" href="javascript:;">含磁鏈</a>
            <a class="button is-small" href="/?vft=0">全部</a>
          </div>
        </div>
        <div class="button-group" id="native-sort-group">
          <div class="buttons has-addons">
            <a class="button is-small is-info is-selected" href="/?vft=1&vst=2">磁鏈更新排序</a>
            <a class="button is-small" href="/?vft=1&vst=1">发布日期排序</a>
          </div>
        </div>
      </div>
      <div class="movie-list"></div>
    `;

    const controller = createListSortingController({
      document,
      window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();

    const coverGroup = document.getElementById('cover-group');
    const filterGroup = document.getElementById('filter-group');
    const nativeSortGroup = document.getElementById('native-sort-group');
    const primaryRow = document.querySelector<HTMLElement>('#native-toolbar .x-list-sort-primary-row');
    const sortRow = document.querySelector<HTMLElement>('#native-toolbar .x-list-sort-row');

    expect(primaryRow).not.toBeNull();
    expect(primaryRow?.children[0]).toBe(coverGroup);
    expect(primaryRow?.children[1]).toBe(filterGroup);
    expect(primaryRow?.textContent).toContain('大封面');
    expect(primaryRow?.textContent).toContain('含磁鏈');
    expect(primaryRow?.textContent).not.toContain('发布日期排序');
    expect(nativeSortGroup?.hidden).toBe(true);
    expect(sortRow).not.toBeNull();
    const nativeSegment = sortRow?.querySelector<HTMLElement>('.x-list-sort-native-segment');
    const pluginSegment = sortRow?.querySelector<HTMLElement>('.x-list-sort-plugin-segment');
    expect(nativeSegment).not.toBeNull();
    expect(pluginSegment).not.toBeNull();
    expect(nativeSegment?.querySelector('.x-list-sort-scope-label.native')?.textContent).toBe('全站');
    expect(pluginSegment?.querySelector('.x-list-sort-scope-label.plugin')?.textContent).toBe('已加载');
    expect(nativeSegment?.querySelector('[data-list-sort-mode]')).toBeNull();
    expect(pluginSegment?.querySelector('a[href]')).toBeNull();
    expect(nativeSegment?.textContent).toContain('磁鏈更新排序');
    expect(nativeSegment?.textContent).toContain('发布日期排序');
    expect(pluginSegment?.textContent).toContain('评分高优先');
    expect(pluginSegment?.textContent).toContain('评价人数多优先');
    expect(pluginSegment?.textContent).not.toContain('评分低优先');
    expect(pluginSegment?.textContent).not.toContain('评价人数少优先');
    expect(pluginSegment?.textContent).not.toContain('主');
    expect(pluginSegment?.textContent).not.toContain('次');
    expect(pluginSegment?.textContent).not.toContain('高到低');
    expect(pluginSegment?.textContent).not.toContain('低到高');
    expect(sortRow?.textContent).not.toContain('原站顺序');
    expect(sortRow?.textContent).not.toContain('增强排序');
    expect(sortRow?.querySelector('.x-list-sort-scope-hint')?.textContent)
      .toBe('全站排序会按站点结果重新加载；已加载排序只整理当前已显示的影片，自动翻页会扩大整理范围。');

    controller.applySort('rating-desc');
    const selectedLabels = Array.from(sortRow?.querySelectorAll<HTMLElement>('.button.is-info.is-selected') || [])
      .map(button => button.textContent?.trim());
    expect(selectedLabels).toEqual(['评分高优先']);
  });

  it('sorts DOM items from the plugin toolbar and explains the loaded-scope result', () => {
    document.body.innerHTML = `
      <div class="toolbar">
        <div class="buttons has-addons">
          <a class="button is-small is-info is-selected" href="/?vft=1&vst=2">磁鏈更新排序</a>
          <a class="button is-small" href="/?vft=1&vst=1">发布日期排序</a>
        </div>
      </div>
    `;
    mountMovieList();

    const controller = createListSortingController({
      document,
      window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();

    document.querySelector<HTMLButtonElement>('[data-list-sort-mode="rating-count-desc"]')?.click();

    const orderedCases = Array.from(document.querySelectorAll<HTMLElement>('.movie-list .item'))
      .map(item => item.dataset.case || '');
    expect(orderedCases).toEqual([
      'high-count',
      'same-score',
      'low-count',
      'missing-score',
    ]);
    expect(document.querySelector('.x-list-sort-notice')?.textContent).toContain('已经加载');
    expect(document.querySelector('.x-list-sort-notice')?.textContent).toContain('原站');
  });

  it('switches between the two basic loaded sort modes without reverse or composite states', () => {
    document.body.innerHTML = `
      <div class="toolbar">
        <div class="buttons has-addons">
          <a class="button is-small is-info is-selected" href="/?vft=1&vst=2">磁鏈更新排序</a>
          <a class="button is-small" href="/?vft=1&vst=1">发布日期排序</a>
        </div>
      </div>
    `;
    mountMovieList();

    const controller = createListSortingController({
      document,
      window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();

    const ratingButton = document.querySelector<HTMLButtonElement>('[data-list-sort-mode="rating-desc"]');
    const ratingCountButton = document.querySelector<HTMLButtonElement>('[data-list-sort-mode="rating-count-desc"]');

    expect(ratingButton).not.toBeNull();
    expect(ratingCountButton).not.toBeNull();

    ratingButton?.click();
    expect(controller.getActiveMode()).toBe('rating-desc');
    expect(ratingButton?.textContent?.trim()).toBe('评分高优先');
    expect(ratingButton?.classList.contains('is-selected')).toBe(true);

    ratingButton?.click();
    expect(controller.getActiveMode()).toBe('rating-desc');
    expect(Array.from(document.querySelectorAll<HTMLElement>('.movie-list .item')).map(item => item.dataset.case || ''))
      .toEqual(['low-count', 'same-score', 'high-count', 'missing-score']);

    ratingCountButton?.click();
    expect(controller.getActiveMode()).toBe('rating-count-desc');
    expect(Array.from(document.querySelectorAll<HTMLElement>('.movie-list .item')).map(item => item.dataset.case || ''))
      .toEqual(['high-count', 'same-score', 'low-count', 'missing-score']);
    expect(ratingButton?.classList.contains('is-selected')).toBe(false);
    expect(ratingCountButton?.classList.contains('is-selected')).toBe(true);
    expect(ratingCountButton?.textContent?.trim()).toBe('评价人数多优先');

    ratingCountButton?.click();
    expect(controller.getActiveMode()).toBe('rating-count-desc');
    expect(Array.from(document.querySelectorAll<HTMLElement>('.movie-list .item')).map(item => item.dataset.case || ''))
      .toEqual(['high-count', 'same-score', 'low-count', 'missing-score']);
  });

  it('keeps one page prompt and accumulates appended items while plugin sorting is active', () => {
    mountMovieList();
    const controller = createListSortingController({
      document,
      window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();
    controller.applySort('rating-count-desc');

    const firstNewItem = document.createElement('div');
    firstNewItem.className = 'item';
    firstNewItem.dataset.case = 'new-a';
    firstNewItem.innerHTML = '<div class="score">5.0 分，由 1 人评价</div>';
    const secondNewItem = document.createElement('div');
    secondNewItem.className = 'item';
    secondNewItem.dataset.case = 'new-b';
    secondNewItem.innerHTML = '<div class="score">5.0 分，由 2 人评价</div>';
    const movieList = document.querySelector('.movie-list');
    movieList?.append(firstNewItem, secondNewItem);

    controller.handleItemsAppended({
      source: 'fetched',
      page: 2,
      appended: 2,
      items: [firstNewItem, secondNewItem],
    });

    expect(document.querySelectorAll('.x-list-sort-page-prompt')).toHaveLength(1);
    expect(document.querySelector('.x-list-sort-page-prompt')?.textContent).toContain('2');

    const thirdNewItem = document.createElement('div');
    thirdNewItem.className = 'item';
    thirdNewItem.dataset.case = 'new-c';
    thirdNewItem.innerHTML = '<div class="score">5.0 分，由 3 人评价</div>';
    movieList?.append(thirdNewItem);

    controller.handleItemsAppended({
      source: 'fetched',
      page: 3,
      appended: 1,
      items: [thirdNewItem],
    });

    expect(document.querySelectorAll('.x-list-sort-page-prompt')).toHaveLength(1);
    expect(document.querySelector('.x-list-sort-page-prompt')?.textContent).toContain('3');
  });

  it('counts only visible appended items in the page prompt', () => {
    mountMovieList();
    const controller = createListSortingController({
      document,
      window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();
    controller.applySort('rating-count-desc');

    const visibleNewItem = document.createElement('div');
    visibleNewItem.className = 'item';
    visibleNewItem.dataset.case = 'visible-new';
    visibleNewItem.innerHTML = '<div class="score">5.0 分，由 1 人评价</div>';
    const hiddenNewItem = document.createElement('div');
    hiddenNewItem.className = 'item';
    hiddenNewItem.dataset.case = 'hidden-new';
    hiddenNewItem.hidden = true;
    hiddenNewItem.innerHTML = '<div class="score">5.0 分，由 2 人评价</div>';
    const movieList = document.querySelector('.movie-list');
    movieList?.append(visibleNewItem, hiddenNewItem);

    controller.handleItemsAppended({
      source: 'fetched',
      page: 2,
      appended: 2,
      items: [visibleNewItem, hiddenNewItem],
    });

    expect(document.querySelectorAll('.x-list-sort-page-prompt')).toHaveLength(1);
    expect(document.querySelector('.x-list-sort-page-prompt')?.textContent).toContain('1 部影片');
  });

  it('does not render a page prompt when all appended items are hidden by filters', () => {
    mountMovieList();
    const controller = createListSortingController({
      document,
      window,
      config: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    controller.init();
    controller.applySort('rating-count-desc');

    const hiddenNewItem = document.createElement('div');
    hiddenNewItem.className = 'item';
    hiddenNewItem.dataset.case = 'hidden-new';
    hiddenNewItem.hidden = true;
    hiddenNewItem.innerHTML = '<div class="score">5.0 分，由 2 人评价</div>';
    const movieList = document.querySelector('.movie-list');
    movieList?.append(hiddenNewItem);

    controller.handleItemsAppended({
      source: 'fetched',
      page: 2,
      appended: 1,
      items: [hiddenNewItem],
    });

    expect(document.querySelectorAll('.x-list-sort-page-prompt')).toHaveLength(0);
  });

  it('does not render manager sorting controls before list enhancement initializes', () => {
    mountMovieList();

    listEnhancementManager.updateConfig({
      enabled: true,
      sorting: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });

    expect(document.querySelector('.x-list-sort-toolbar')).toBeNull();
  });

  it('renders manager sorting controls on first initialization when sorting was enabled before init', () => {
    document.body.innerHTML = `
      <div class="toolbar" id="native-toolbar">
        <div class="buttons has-addons">
          <a class="button is-small is-info is-selected" href="/?vft=1&vst=2">磁鏈更新排序</a>
          <a class="button is-small" href="/?vft=1&vst=1">发布日期排序</a>
        </div>
      </div>
      <div class="movie-list">
        <div class="item" data-case="one">
          <a class="box" href="/v/abc"><div class="video-title"><strong>ABC-001</strong></div></a>
          <div class="score"><span class="value">4.8 分，由 12 人评价</span></div>
        </div>
      </div>
    `;

    listEnhancementManager.updateConfig({
      enabled: true,
      sorting: { enabled: true, appendStrategy: 'prompt', autoResortPosition: 'preserve' },
    });
    listEnhancementManager.initialize();

    const toolbar = document.querySelector<HTMLElement>('.x-list-sort-toolbar');
    const sortRow = toolbar?.querySelector<HTMLElement>('.x-list-sort-row');
    expect(toolbar).not.toBeNull();
    expect(toolbar).toBe(document.getElementById('native-toolbar'));
    expect(sortRow?.textContent).toContain('磁鏈更新排序');
    expect(sortRow?.querySelectorAll('[data-list-sort-mode]')).toHaveLength(2);
    expect(sortRow?.textContent).toContain('评分高优先');
    expect(sortRow?.textContent).toContain('评价人数多优先');
    expect(sortRow?.textContent).not.toContain('评分低优先');
    expect(sortRow?.textContent).not.toContain('主');
    expect(sortRow?.textContent).not.toContain('增强排序');
  });

  it('styles merged sort controls as a rounded segmented row', () => {
    expect(LIST_ENHANCEMENT_BASE_STYLES).toContain('.x-list-sort-toolbar:not([data-x-list-sort-merged="1"])');
    expect(LIST_ENHANCEMENT_BASE_STYLES).toContain('.x-list-sort-toolbar[data-x-list-sort-merged="1"] .x-list-sort-row');
    expect(LIST_ENHANCEMENT_BASE_STYLES).toContain('.x-list-sort-segments');
    expect(LIST_ENHANCEMENT_BASE_STYLES).toContain('.x-list-sort-segment');
    expect(LIST_ENHANCEMENT_BASE_STYLES).toContain('.x-list-sort-scope-label');
    expect(LIST_ENHANCEMENT_BASE_STYLES).toContain('.x-list-sort-scope-hint');
    expect(LIST_ENHANCEMENT_BASE_STYLES).not.toContain('.x-list-sort-button-meta');
    expect(LIST_ENHANCEMENT_BASE_STYLES).toContain('border-radius: 999px');
    expect(LIST_ENHANCEMENT_BASE_STYLES).not.toContain('.x-list-sort-toolbar {\n      display: flex;');
  });
});
