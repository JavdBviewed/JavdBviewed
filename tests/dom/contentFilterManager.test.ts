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

describe('ContentFilterManager 隐藏动作（action=hide 由规则启用状态驱动）', () => {
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

  /** 防抖 + 分片是异步的，轮询等待显隐落到目标状态，避免靠固定 sleep 猜时序 */
  async function waitForDisplay(card: HTMLElement, hidden: boolean): Promise<void> {
    const deadline = Date.now() + 4_000;
    for (;;) {
      const isHidden = card.style.display === 'none' && card.classList.contains('content-filter-hidden');
      if (isHidden === hidden) return;
      if (Date.now() > deadline) {
        throw new Error('waitForDisplay timeout: expect hidden=' + hidden + ', display=' + card.style.display);
      }
      await new Promise<void>(resolve => window.setTimeout(resolve, 50));
    }
  }

  afterEach(() => {
    document.body.innerHTML = '';
    STATE.settings = null;
    vi.restoreAllMocks();
  });

  it('hide 规则启用时应隐藏匹配卡片（09-30 起无独立隐藏子开关）', async () => {
    const card = setupCard('HIDEME-001');
    STATE.settings = {
      contentFilter: { keywordRules: [hideRule] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();
    expect(card.style.display).toBe('none');
    expect(card.classList.contains('content-filter-hidden')).toBe(true);
    expect(card.getAttribute('data-filter-applied')).toBe('hide');
    manager.destroy();
  });

  it('规则 enabled=false 时 hide 规则匹配但不隐藏', async () => {
    const card = setupCard('HIDEME-001');
    STATE.settings = {
      contentFilter: { keywordRules: [{ ...hideRule, enabled: false }] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();
    await waitForFilterDebounce();
    expect(card.style.display).not.toBe('none');
    expect(card.classList.contains('content-filter-hidden')).toBe(false);
    manager.destroy();
  });

  it('运行中关掉规则「启用」即时恢复卡片；重新启用需 rescan 才重判已处理卡片', async () => {
    const card = setupCard('HIDEME-001');
    STATE.settings = {
      contentFilter: { keywordRules: [hideRule] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true });
    await manager.initialize();
    expect(card.style.display).toBe('none');

    // 等价于设置页关掉该规则「启用」后广播 settings-updated（router 走 updateKeywordRules）
    manager.updateKeywordRules([{ ...hideRule, enabled: false }]);
    await waitForDisplay(card, false);

    // 已处理卡片不会被 applyFilters 重判（09-30 起唯一残留的重判入口是 rescan）：
    // 重新打开「启用」后需 rescan 清除 data-filter-processed 才会再次隐藏。
    manager.updateKeywordRules([hideRule]);
    await waitForFilterDebounce();
    expect(card.style.display).not.toBe('none');

    manager.rescan();
    await waitForDisplay(card, true);
    manager.destroy();
  });

  it('页面级 shouldSkipHideActions（想看/已看汇总页）命中也不隐藏', async () => {
    const card = setupCard('HIDEME-001');
    STATE.settings = {
      contentFilter: { keywordRules: [hideRule] },
      records: {},
    } as any;
    const manager = new ContentFilterManager({ enabled: true });
    const internals = manager as unknown as { shouldSkipHideActionsOnCurrentPage(): boolean };
    const skip = vi.spyOn(internals, 'shouldSkipHideActionsOnCurrentPage').mockReturnValue(true);
    await manager.initialize();
    await waitForFilterDebounce();
    expect(skip).toHaveBeenCalled();
    expect(card.style.display).not.toBe('none');
    expect(card.classList.contains('content-filter-hidden')).toBe(false);
    manager.destroy();
  });
});
