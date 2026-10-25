/**
 * @vitest-environment jsdom
 * @file scrollPaging.test.ts
 * @description 滚动翻页 super-ranking 分支：onItemsAppended 事件 items 透传追加节点
 * （修复前恒空数组，manager 无从对超排新卡做增强）
 * @module features/listEnhancement
 */
import { describe, expect, it, vi } from 'vitest';
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
