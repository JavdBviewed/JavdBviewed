/**
 * @file relatedListsEnhancement.test.ts
 * @description VideoDetailEnhancer related lists enhancement 测试
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoDetailEnhancer } from '../../apps/extension/src/features/videoDetail';
import { relatedListsService } from '../../apps/extension/src/features/relatedLists';

describe('VideoDetailEnhancer related lists enhancement', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    (window as any).__JDB_VERBOSE = false;

    const oldThemeObserver = (window as any).__jdb_related_lists_theme_observer__ as MutationObserver | undefined;
    oldThemeObserver?.disconnect();
    delete (window as any).__jdb_related_lists_theme_observer__;
  });

  it('syncs related lists panel theme from JavDB data-theme', async () => {
    const enhancer = new VideoDetailEnhancer() as any;
    const panel = document.createElement('div');

    expect(enhancer.applyRelatedListsTheme(panel)).toBe('light');
    expect(panel.dataset.jdbTheme).toBe('light');

    enhancer.bindRelatedListsThemeObserver(panel);
    document.documentElement.setAttribute('data-theme', 'dark');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panel.dataset.jdbTheme).toBe('dark');
  });

  it('renders previous and next pagination controls', () => {
    const enhancer = new VideoDetailEnhancer() as any;
    const panel = document.createElement('div');
    const loadRelatedLists = vi.spyOn(enhancer, 'loadRelatedLists').mockResolvedValue(undefined);

    enhancer.renderRelatedListsFooter(panel, 'NQ6pPb', 2, true, 20, 5);

    const pageInfo = panel.querySelector('.jdb-related-lists-page-info')?.textContent || '';
    expect(pageInfo).toContain('2 / 5');
    expect(pageInfo).toContain('20');

    panel.querySelector<HTMLButtonElement>('[data-jdb-related-page-prev]')?.click();
    panel.querySelector<HTMLButtonElement>('[data-jdb-related-page-next]')?.click();

    expect(loadRelatedLists).toHaveBeenCalledWith(panel, 'NQ6pPb', 1);
    expect(loadRelatedLists).toHaveBeenCalledWith(panel, 'NQ6pPb', 3);
  });

  it('disables pagination at the first and last page', () => {
    const enhancer = new VideoDetailEnhancer() as any;
    const panel = document.createElement('div');

    enhancer.renderRelatedListsFooter(panel, 'NQ6pPb', 1, false, 8);

    expect(panel.querySelector<HTMLButtonElement>('[data-jdb-related-page-prev]')?.disabled).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('[data-jdb-related-page-next]')?.disabled).toBe(true);
    const pageInfo = panel.querySelector('.jdb-related-lists-page-info')?.textContent || '';
    expect(pageInfo).toContain('1');
    expect(pageInfo).toContain('8');
  });

  it('loads related lists with 10 items per page and renders matching indexes', async () => {
    const enhancer = new VideoDetailEnhancer() as any;
    const panel = document.createElement('div');
    const items = Array.from({ length: 12 }, (_, index) => ({
      relatedId: `list-${index + 1}`,
      name: `清单 ${index + 1}`,
      movieCount: index + 1,
      collectionCount: index + 2,
      viewCount: index + 3,
      createTime: '2026-05-24',
    }));
    const getRelatedLists = vi.spyOn(relatedListsService, 'getRelatedLists').mockResolvedValue({
      success: true,
      data: items,
      page: 2,
      totalPages: 3,
      hasMore: true,
    });

    await enhancer.loadRelatedLists(panel, 'NQ6pPb', 2);

    expect(getRelatedLists).toHaveBeenCalledWith('NQ6pPb', 2, 10);
    expect(panel.querySelector('.jdb-related-lists-banner')?.textContent).toContain('已为您解锁全部相关清单');
    expect(panel.querySelector('.jdb-related-lists-banner')?.textContent).toContain('本页显示 10 条');
    expect(panel.querySelectorAll('.jdb-related-list-card')).toHaveLength(10);
    expect(panel.querySelector('.jdb-related-list-index')?.textContent).toBe('#11');
    expect(Array.from(panel.querySelectorAll('.jdb-related-list-index')).at(-1)?.textContent).toBe('#20');
    expect(panel.textContent).not.toContain('清单 11');
  });

  it('intercepts plans related-list tab immediately after core init without preloading data', async () => {
    window.history.pushState({}, '', '/v/NQ6pPb');
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-001</strong></h2>
      <div class="movie-panel-info">
        <div class="tabs">
          <ul>
            <li><a href="/plans/ypay">Related lists</a></li>
          </ul>
        </div>
      </div>
      <div id="tabs-container">
        <div id="reviews"></div>
      </div>
    `;
    const enhancer = new VideoDetailEnhancer({ enableRelatedLists: true }) as any;
    const getRelatedLists = vi.spyOn(relatedListsService, 'getRelatedLists').mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      totalPages: 0,
      hasMore: false,
    });

    await enhancer.initCore();

    expect(getRelatedLists).not.toHaveBeenCalled();

    const relatedTab = document.querySelector<HTMLAnchorElement>('a[data-jdb-related-lists-original-href="/plans/ypay"]');
    expect(relatedTab).not.toBeNull();
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    relatedTab?.dispatchEvent(clickEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(getRelatedLists).toHaveBeenCalledWith('NQ6pPb', 1, 10);
    expect(document.getElementById('jdb-related-lists-panel')?.getAttribute('aria-hidden')).toBe('false');
  });

  it('does not rewrite an already neutralized related-lists tab', () => {
    document.body.innerHTML = '<div class="tabs"><a href="/plans/ypay">Related lists</a></div>';
    const enhancer = new VideoDetailEnhancer({ enableRelatedLists: true }) as any;
    const tab = document.querySelector<HTMLElement>('.tabs a')!;
    const observer = new MutationObserver(() => undefined);
    observer.observe(tab, { attributes: true });

    enhancer.neutralizeRelatedListsTab(tab);
    observer.takeRecords();
    enhancer.neutralizeRelatedListsTab(tab);

    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });
});
describe('isBulmaModalTrigger excludes modal buttons from interception', () => {
  /**
   * Helper: sets up the enhancer with the interception active,
   * returns a function that fires a click on the given element
   * and returns whether the event was defaultPrevented (= intercepted).
   */
  async function setupInterception() {
    window.history.pushState({}, '', '/v/NQ6pPb');
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-001</strong></h2>
      <div class="movie-panel-info">
        <div class="tabs">
          <ul id="tab-list">
            <li><a href="/plans/ypay">Related lists</a></li>
          </ul>
        </div>
      </div>
      <div id="tabs-container"><div id="reviews"></div></div>
    `;
    const enhancer = new VideoDetailEnhancer({ enableRelatedLists: true }) as any;
    vi.spyOn(relatedListsService, 'getRelatedLists').mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      totalPages: 0,
      hasMore: false,
    });
    await enhancer.initCore();
    return enhancer;
  }

  function fireClick(el: HTMLElement): MouseEvent {
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
    return evt;
  }

  it('does NOT intercept a button with data-target^="modal-" (存入清單 modal trigger)', async () => {
    await setupInterception();

    const modalBtn = document.createElement('button');
    modalBtn.className = 'button is-info';
    modalBtn.setAttribute('data-target', 'modal-save-list');
    modalBtn.textContent = '存入清單';
    document.querySelector('.movie-panel-info')!.appendChild(modalBtn);

    const evt = fireClick(modalBtn);
    expect(evt.defaultPrevented).toBe(false);
  });

  it('does NOT intercept a button with data-haspopup="true"', async () => {
    await setupInterception();

    const btn = document.createElement('button');
    btn.setAttribute('data-haspopup', 'true');
    btn.textContent = '清單選項';
    document.querySelector('.movie-panel-info')!.appendChild(btn);

    const evt = fireClick(btn);
    expect(evt.defaultPrevented).toBe(false);
  });

  it('does NOT intercept a button with data-auth="true"', async () => {
    await setupInterception();

    const btn = document.createElement('button');
    btn.setAttribute('data-auth', 'true');
    btn.textContent = '需要登入';
    document.querySelector('.movie-panel-info')!.appendChild(btn);

    const evt = fireClick(btn);
    expect(evt.defaultPrevented).toBe(false);
  });

  it('does NOT intercept a li whose child has data-target^="modal-"', async () => {
    await setupInterception();

    const li = document.createElement('li');
    const childBtn = document.createElement('button');
    childBtn.setAttribute('data-target', 'modal-auth');
    childBtn.textContent = '看清單';
    li.appendChild(childBtn);
    document.querySelector('#tab-list')!.appendChild(li);

    const evt = fireClick(childBtn);
    expect(evt.defaultPrevented).toBe(false);
  });

  it('still intercepts the Related lists tab (no modal attributes)', async () => {
    await setupInterception();

    const relatedTab = document.querySelector<HTMLAnchorElement>(
      'a[data-jdb-related-lists-original-href="/plans/ypay"]',
    );
    expect(relatedTab).not.toBeNull();

    const evt = fireClick(relatedTab!);
    expect(evt.defaultPrevented).toBe(true);
  });
});

describe('VideoDetailEnhancer related lists enhancement (JavDB new DOM, 2026-08+)', () => {
  /**
   * 2026-08 起 JavDB 影片页新 DOM（/v/ZNzGYP 实测）：
   * tab 为 li[data-movie-tab-target="listTab"] > a.list-tab[data-url="/v/<id>/lists/related"]，
   * 原生空面板为 div[data-movie-tab-target="lists"]#lists（此前会被旧通配选择器误命中）。
   */
  const NEW_DOM = `
    <div class="columns" data-controller="movie-tab">
      <div class="column">
        <div class="tabs no-bottom">
          <ul>
            <li class="is-active" data-movie-tab-target="magnetTab">
              <a name="magnet-links" data-action="click-&gt;movie-tab#magnets" href="javascript:void(0);"><span>磁鏈</span></a>
            </li>
            <li data-movie-tab-target="reviewTab" data-loaded="false">
              <a class="review-tab" data-url="/v/NQ6pPb/reviews/lastest" data-action="click-&gt;movie-tab#latestReviews" href="javascript:;"><span>短評(7)</span></a>
            </li>
            <li data-movie-tab-target="listTab" data-loaded="false">
              <a class="list-tab" data-url="/v/NQ6pPb/lists/related" data-action="click-&gt;movie-tab#relatedLists" data-plans-url="/plans" href="javascript:;"><span>相關清單</span></a>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <div id="tabs-container" data-movie-tab-target="tabsContainer">
      <div data-movie-tab-target="magnets" id="magnets"></div>
      <div data-movie-tab-target="reviews" id="reviews"></div>
      <div data-movie-tab-target="lists" id="lists" style="display: none;"></div>
    </div>
  `;

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    (window as any).__JDB_VERBOSE = false;
  });

  it('finds the listTab tab instead of the native #lists panel', () => {
    document.body.innerHTML = NEW_DOM;
    const enhancer = new VideoDetailEnhancer({ enableRelatedLists: true }) as any;

    const tab = enhancer.findRelatedListsTab();

    expect(tab).not.toBeNull();
    expect(tab!.id).not.toBe('lists');
    // 新 DOM 命中的是 li 下的 a.list-tab 锚点本身
    expect(tab!.matches('a.list-tab')).toBe(true);
    expect(tab!.textContent).toContain('相關清單');
  });

  it('neutralizes the new-DOM tab, keeps #lists intact, and intercepts click', async () => {
    window.history.pushState({}, '', '/v/NQ6pPb');
    document.body.innerHTML = NEW_DOM;
    const enhancer = new VideoDetailEnhancer({ enableRelatedLists: true }) as any;
    const getRelatedLists = vi.spyOn(relatedListsService, 'getRelatedLists').mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      totalPages: 0,
      hasMore: false,
    });

    await enhancer.initCore();

    // 原生空面板结构必须保留
    const nativePanel = document.getElementById('lists');
    expect(nativePanel?.getAttribute('data-movie-tab-target')).toBe('lists');
    expect(nativePanel?.getAttribute('data-action')).toBeNull();

    // tab 锚点被中和：href 改写、data-action 剥离、原 href 记录
    const tab = document.querySelector<HTMLAnchorElement>('li[data-movie-tab-target="listTab"] a.list-tab');
    expect(tab).not.toBeNull();
    expect(tab!.getAttribute('data-jdb-related-lists-original-href')).toBe('javascript:;');
    expect(tab!.getAttribute('data-action')).toBeNull();
    expect(tab!.getAttribute('href')).toBe('#jdb-related-lists-panel');

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    tab?.dispatchEvent(clickEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(getRelatedLists).toHaveBeenCalledWith('NQ6pPb', 1, 10);
    expect(document.getElementById('jdb-related-lists-panel')?.getAttribute('aria-hidden')).toBe('false');
  });

  it('intercepts click even before neutralization (data-url fallback)', async () => {
    window.history.pushState({}, '', '/v/NQ6pPb');
    document.body.innerHTML = NEW_DOM;
    const enhancer = new VideoDetailEnhancer({ enableRelatedLists: true }) as any;
    vi.spyOn(relatedListsService, 'getRelatedLists').mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      totalPages: 0,
      hasMore: false,
    });

    // 绕过 initCore 的中和逻辑，直接安装点击拦截后点击未中和的 tab
    enhancer.bindRelatedListsTabInterception(null, 'NQ6pPb');

    const tab = document.querySelector<HTMLAnchorElement>('li[data-movie-tab-target="listTab"] a.list-tab')!;
    expect(tab.getAttribute('href')).toBe('javascript:;'); // 尚未中和

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    tab.dispatchEvent(clickEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('still intercepts old-DOM /plans/ tab alongside native #lists panel', async () => {
    window.history.pushState({}, '', '/v/NQ6pPb');
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-001</strong></h2>
      <div class="movie-panel-info">
        <div class="tabs">
          <ul>
            <li><a href="/plans/ypay">Related lists</a></li>
          </ul>
        </div>
      </div>
      <div id="tabs-container">
        <div id="reviews"></div>
        <div data-movie-tab-target="lists" id="lists" style="display: none;"></div>
      </div>
    `;
    const enhancer = new VideoDetailEnhancer({ enableRelatedLists: true }) as any;
    const getRelatedLists = vi.spyOn(relatedListsService, 'getRelatedLists').mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      totalPages: 0,
      hasMore: false,
    });

    await enhancer.initCore();

    const tab = enhancer.findRelatedListsTab();
    expect(tab).not.toBeNull();
    expect(tab!.id).not.toBe('lists');

    const relatedTab = document.querySelector<HTMLAnchorElement>('a[data-jdb-related-lists-original-href="/plans/ypay"]');
    expect(relatedTab).not.toBeNull();
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    relatedTab?.dispatchEvent(clickEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(getRelatedLists).toHaveBeenCalledWith('NQ6pPb', 1, 10);
    expect(document.getElementById('lists')?.getAttribute('data-movie-tab-target')).toBe('lists');
  });
});
