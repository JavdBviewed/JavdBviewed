/**
 * @file contentFilterManager.test.ts
 * @description 内容过滤器首次初始化、动态增量处理和节点清理回归测试。
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentFilterManager } from '../../apps/extension/src/features/contentFilter/contentFilterManager';
import { STATE } from '../../apps/extension/src/features/contentState';

type ContentFilterManagerInternals = {
  findVideoItems: (root?: ParentNode) => HTMLElement[];
  filteredElements: Map<HTMLElement, unknown>;
};

function createMovieCard(code: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'item';
  card.innerHTML = `<a href="/v/${code}"><span class="video-title">${code} title</span></a>`;
  return card;
}

async function waitForFilterDebounce(): Promise<void> {
  await new Promise<void>(resolve => window.setTimeout(resolve, 650));
}

describe('ContentFilterManager 生命周期与增量扫描', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    STATE.settings = null;
    vi.restoreAllMocks();
  });

  it('initialize 应等待首次过滤完成后再返回', async () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    const cards = Array.from({ length: 16 }, (_, index) => createMovieCard(`INIT-${index + 1}`));
    cards.forEach(card => list.appendChild(card));
    document.body.appendChild(list);

    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();

    expect(cards.every(card => card.hasAttribute('data-filter-processed'))).toBe(true);
    manager.destroy();
  });

  it('动态追加卡片时只从追加节点增量发现，不再重新扫描整个文档', async () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    const initialCard = createMovieCard('BASE-001');
    list.appendChild(initialCard);
    document.body.appendChild(list);

    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();
    const internals = manager as unknown as ContentFilterManagerInternals;
    const findVideoItemsSpy = vi.spyOn(internals, 'findVideoItems');

    const appendedCard = createMovieCard('APPENDED-001');
    list.appendChild(appendedCard);
    await waitForFilterDebounce();

    expect(findVideoItemsSpy).toHaveBeenCalledWith(appendedCard);
    expect(appendedCard.hasAttribute('data-filter-processed')).toBe(true);
    manager.destroy();
  });

  it('动态移除卡片后应从过滤结果引用中清理脱离 DOM 的节点', async () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    const card = createMovieCard('REMOVED-001');
    list.appendChild(card);
    document.body.appendChild(list);

    const rule = {
        id: 'rule-1',
        name: '匹配标题',
        keyword: 'REMOVED-001',
        isRegex: false,
        caseSensitive: false,
        action: 'highlight',
        enabled: true,
        fields: ['title'],
      };
    STATE.settings = {
      display: { hideVR: false, hideViewed: false, hideBrowsed: false },
      contentFilter: { keywordRules: [rule] },
      records: {},
    };
    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();
    const internals = manager as unknown as ContentFilterManagerInternals;
    expect(internals.filteredElements.has(card)).toBe(true);

    card.remove();
    await waitForFilterDebounce();

    expect(internals.filteredElements.has(card)).toBe(false);
    manager.destroy();
  });
});
