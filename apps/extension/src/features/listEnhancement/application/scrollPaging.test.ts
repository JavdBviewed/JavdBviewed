/**
 * @vitest-environment jsdom
 * @file scrollPaging.test.ts
 * @description 滚动翻页 super-ranking 分支：onItemsAppended 事件 items 透传追加节点
 * （修复前恒空数组，manager 无从对超排新卡做增强）
 * @module features/listEnhancement
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createListScrollPagingController, type ListScrollPagingAppendEvent } from './scrollPaging';

describe('listScrollPaging super-ranking 分支 items 透传', () => {
  it('onItemsAppended 事件 items = appendSuperRankingPage 返回的节点（不再恒空）', async () => {
    const card = document.createElement('a');
    card.className = 'box item jdb-super-ranking-movie';
    card.href = '/v/9';
    document.body.appendChild(card);

    const events: ListScrollPagingAppendEvent[] = [];
    const controller = createListScrollPagingController({
      document,
      window,
      threshold: 200,
      getSuperRankingPageInfo: () => ({ page: 1, maxPage: 5 }),
      appendSuperRankingPage: vi.fn(async () => ({
        handled: true,
        appended: 1,
        page: 2,
        maxPage: 5,
        items: [card],
      })),
      fetchText: vi.fn(async () => ''),
      processVisibleItems: vi.fn(),
      clearActorCaches: vi.fn(),
      onItemsAppended: event => events.push(event),
    });
    controller.init();
    await controller.loadNextPage();
    expect(events.length).toBe(1);
    expect(events[0].source).toBe('super-ranking');
    expect(events[0].appended).toBe(1);
    expect(events[0].items).toEqual([card]);
  });

  it('fetched 分支 items 透传不变（回归锁）', async () => {
    const movieList = document.createElement('div');
    movieList.className = 'movie-list';
    document.body.appendChild(movieList);

    const events: ListScrollPagingAppendEvent[] = [];
    const controller = createListScrollPagingController({
      document,
      window,
      threshold: 200,
      getSuperRankingPageInfo: () => null,
      appendSuperRankingPage: vi.fn(async () => ({ handled: false, appended: 0, page: 1, maxPage: 5 })),
      fetchText: vi.fn(async () => '<div class="movie-list"><div class="item"><div class="video-title"><strong>F-1</strong> t</div></div></div>'),
      processVisibleItems: vi.fn(),
      clearActorCaches: vi.fn(),
      onItemsAppended: event => events.push(event),
    });
    controller.init();
    await controller.loadNextPage();
    expect(events.length).toBe(1);
    expect(events[0].source).toBe('fetched');
    expect(events[0].items.length).toBe(1);
    expect(events[0].items[0].matches('.item')).toBe(true);
  });
});

/**
 * F1（10-30-ext-actor-penetration-paging RC-A）：首页分页 nav 是窗口化的（真机仅显示
 * 1-6 窗口），maxPage 被一次性解析锁死在窗口边 → 滚动翻页在窗口边硬停。
 * 修复：每次 fetched 分支追加后，从同份已解析的 fetched html 里再解析 nav 合并 maxPage
 * （只升不降）；真实末页 nav 无前进链接 → 自然停。
 * F4（RC-C 同机制防御）：fetched 请求非 2xx / appended=0 时显式日志 + 冷却，防静默重发。
 */
describe('listScrollPaging F1：fetched 页 nav 合并 maxPage', () => {
  const BASE = 'https://javdb.com/censored';

  function pageHtml(items: string[], navPages: number[]): string {
    const cards = items.map(t => `<div class="item"><div class="video-title"><strong>${t}</strong></div></div>`).join('');
    const nav = navPages.map(p => `<a class="pagination-link" href="${BASE}?page=${p}">${p}</a>`).join('');
    return `<html><body><div class="movie-list">${cards}</div><div class="pagination">${nav}</div></body></html>`;
  }

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', 'http://localhost:3000/');
    vi.restoreAllMocks();
  });

  it('追加后合并 fetched 页 nav 扩展 maxPage（不再在首页窗口边硬停）', async () => {
    window.history.pushState({}, '', 'http://localhost:3000/');
    document.body.innerHTML = `
      <div class="movie-list"><div class="item">p1</div></div>
      <a class="pagination-link" href="${BASE}?page=2">2</a>
      <a class="pagination-link" href="${BASE}?page=6">6</a>
    `;
    const fetchText = vi.fn(async () => pageHtml(['p2a', 'p2b'], [3, 8]));
    const controller = createListScrollPagingController({
      document,
      window,
      threshold: 200,
      logger: vi.fn(),
      getSuperRankingPageInfo: () => null,
      appendSuperRankingPage: async () => ({ handled: false, appended: 0, page: 1, maxPage: 0 }),
      fetchText: fetchText as unknown as (url: string) => Promise<string>,
      processVisibleItems: vi.fn(),
      clearActorCaches: vi.fn(),
    });
    controller.init();
    expect(controller.getState().maxPage).toBe(6);

    await controller.loadNextPage();
    expect(controller.getState().currentPage).toBe(2);
    expect(controller.getState().maxPage).toBe(8);

    // 可越过原窗口边（6）继续翻页
    await controller.loadNextPage();
    expect(controller.getState().currentPage).toBe(3);
    expect(controller.getState().maxPage).toBe(8);
  });

  it('fetched 页 nav 最大页码不大于当前 maxPage 时不收缩（合并只升不降）', async () => {
    window.history.pushState({}, '', 'http://localhost:3000/');
    document.body.innerHTML = `
      <div class="movie-list"><div class="item">p1</div></div>
      <a class="pagination-link" href="${BASE}?page=10">10</a>
    `;
    const fetchText = vi.fn(async () => pageHtml(['p2a'], [8]));
    const controller = createListScrollPagingController({
      document,
      window,
      threshold: 200,
      logger: vi.fn(),
      getSuperRankingPageInfo: () => null,
      appendSuperRankingPage: async () => ({ handled: false, appended: 0, page: 1, maxPage: 0 }),
      fetchText: fetchText as unknown as (url: string) => Promise<string>,
      processVisibleItems: vi.fn(),
      clearActorCaches: vi.fn(),
    });
    controller.init();
    expect(controller.getState().maxPage).toBe(10);
    await controller.loadNextPage();
    expect(controller.getState().currentPage).toBe(2);
    expect(controller.getState().maxPage).toBe(10);
  });
});

describe('listScrollPaging F4：非 2xx / 空追加冷却', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', 'http://localhost:3000/');
    vi.restoreAllMocks();
  });

  it('fetch 非 2xx：不追加，且立即重发被冷却挡住（不静默重试）', async () => {
    window.history.pushState({}, '', 'http://localhost:3000/');
    document.body.innerHTML = '<div class="movie-list"><div class="item">p1</div></div>';
    const fetchText = vi.fn(async () => ({
      html: '<div class="movie-list"><div class="item">bad</div></div>',
      status: 500,
    }));
    const controller = createListScrollPagingController({
      document,
      window,
      threshold: 200,
      logger: vi.fn(),
      getSuperRankingPageInfo: () => null,
      appendSuperRankingPage: async () => ({ handled: false, appended: 0, page: 1, maxPage: 0 }),
      fetchText: fetchText as unknown as (url: string) => Promise<string>,
      processVisibleItems: vi.fn(),
      clearActorCaches: vi.fn(),
      pageLoadCooldownMs: 60_000,
    });
    controller.init();
    await controller.loadNextPage();
    expect(document.querySelectorAll('.movie-list .item')).toHaveLength(1);
    expect(fetchText).toHaveBeenCalledTimes(1);

    await controller.loadNextPage();
    expect(fetchText).toHaveBeenCalledTimes(1); // 冷却未到期：不重发
  });

  it('appended=0：进入冷却，冷却到期后允许重试', async () => {
    window.history.pushState({}, '', 'http://localhost:3000/');
    document.body.innerHTML = '<div class="movie-list"><div class="item">p1</div></div>';
    const fetchText = vi.fn(async () => ({ html: '<html><body><p>no list</p></body></html>', status: 200 }));
    const controller = createListScrollPagingController({
      document,
      window,
      threshold: 200,
      logger: vi.fn(),
      getSuperRankingPageInfo: () => null,
      appendSuperRankingPage: async () => ({ handled: false, appended: 0, page: 1, maxPage: 0 }),
      fetchText: fetchText as unknown as (url: string) => Promise<string>,
      processVisibleItems: vi.fn(),
      clearActorCaches: vi.fn(),
      pageLoadCooldownMs: 30,
    });
    controller.init();
    await controller.loadNextPage();
    expect(fetchText).toHaveBeenCalledTimes(1);
    await controller.loadNextPage();
    expect(fetchText).toHaveBeenCalledTimes(1); // 冷却中
    await new Promise(r => setTimeout(r, 40));
    await controller.loadNextPage();
    expect(fetchText).toHaveBeenCalledTimes(2); // 冷却到期：允许重试
  });
});
