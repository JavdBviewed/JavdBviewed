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
  return new Promise<void>(resolve => window.setTimeout(resolve, 650));
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

describe('ContentFilterManager 隐藏开关（hideEnabled）', () => {
  const hideRule = {
    id: 'rule-hide',
    name: '隐藏规则',
    keyword: 'HIDEME-001',
    isRegex: false,
    caseSensitive: false,
    action: 'hide' as const,
    enabled: true,
    fields: ['title'] as const,
  };

  function setupCard(keyword: string) {
    const list = document.createElement('div');
    list.className = 'movie-list';
    const card = createMovieCard(keyword);
    list.appendChild(card);
    document.body.appendChild(list);
    return card;
  }

  afterEach(() => {
    document.body.innerHTML = '';
    STATE.settings = null;
    vi.restoreAllMocks();
  });

  it('默认（未提供 hideEnabled）时 hide 规则应隐藏匹配卡片', async () => {
    const card = setupCard('HIDEME-001');
    STATE.settings = {
      contentFilter: { keywordRules: [hideRule] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();
    expect(card.style.display).toBe('none');
    expect(card.classList.contains('content-filter-hidden')).toBe(true);
    manager.destroy();
  });

  it('config.hideEnabled=false 时 hide 规则匹配但不隐藏', async () => {
    const card = setupCard('HIDEME-001');
    STATE.settings = {
      contentFilter: { keywordRules: [hideRule] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true, hideEnabled: false });
    await manager.initialize();
    expect(card.style.display).not.toBe('none');
    expect(card.classList.contains('content-filter-hidden')).toBe(false);
    manager.destroy();
  });

  it('updateConfig({hideEnabled:true}) 后先前未隐藏的匹配卡片被隐藏', async () => {
    const card = setupCard('HIDEME-001');
    STATE.settings = {
      contentFilter: { keywordRules: [hideRule] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true, hideEnabled: false });
    await manager.initialize();
    expect(card.style.display).not.toBe('none');

    // 让出主线程，使 rescan 的 applyFilters 不被 50ms 重入保护跳过
    await new Promise<void>(r => setTimeout(r, 120));
    manager.updateConfig({ hideEnabled: true });
    await waitForFilterDebounce();
    // rescan 是异步的，多重等一个防抖窗口
    await waitForFilterDebounce();
    expect(card.style.display).toBe('none');
    expect(card.classList.contains('content-filter-hidden')).toBe(true);
    manager.destroy();
  });

  it('单规则 hideEnabled=false 时该规则不隐藏（其余 hide 规则不受影响）', async () => {
    const cardA = setupCard('HIDEME-001');
    const cardB = createMovieCard('HIDEME-002');
    cardA.parentElement!.appendChild(cardB);
    const perRuleOff = { ...hideRule, id: 'rule-a', keyword: 'HIDEME-001', hideEnabled: false };
    const perRuleOn = { ...hideRule, id: 'rule-b', keyword: 'HIDEME-002' };
    STATE.settings = {
      contentFilter: { keywordRules: [perRuleOff, perRuleOn] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();
    expect(cardA.style.display).not.toBe('none');
    expect(cardB.style.display).toBe('none');
    manager.destroy();
  });
});
