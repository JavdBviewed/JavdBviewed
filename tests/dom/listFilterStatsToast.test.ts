/**
 * @file listFilterStatsToast.test.ts
 * @description 10-05-list-filter-toast：列表页过滤 toast 两行（内容过滤 + 显示过滤统一呈现）。
 * 断言面=行1 并集去重口径 / 行2 固定序仅非零明细 / 门控（全零不弹、showFilteredCount=false 不弹）/
 * 仅显示过滤场景必弹 / 行2 空时单行。toast 模块 mock 捕获精确文案（设计稿批复口径）。
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/extension/src/platform/browser/toast', () => ({
  showToast: vi.fn(),
}));

import { showToast } from '../../apps/extension/src/platform/browser/toast';
import { ContentFilterManager } from '../../apps/extension/src/features/contentFilter/contentFilterManager';
import { STATE } from '../../apps/extension/src/features/contentState';

function createMovieCard(title: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'item';
  card.innerHTML = `<a href="/v/ABC001"><span class="video-title">${title}</span></a>`;
  return card;
}

function makeList(): HTMLElement {
  const list = document.createElement('div');
  list.className = 'movie-list';
  document.body.appendChild(list);
  return list;
}

const HIDE_RULE = {
  id: 'rule-hide',
  name: '隐藏规则',
  keyword: 'DUP',
  isRegex: false,
  caseSensitive: false,
  action: 'hide' as const,
  enabled: true,
  fields: ['title'] as const,
};

const HL_RULE = {
  id: 'rule-hl',
  name: '高亮规则',
  keyword: 'HL-001',
  isRegex: false,
  caseSensitive: false,
  action: 'highlight' as const,
  enabled: true,
  fields: ['title'] as const,
  style: { backgroundColor: '#fff3cd' },
};

async function runManager(settings: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
  STATE.settings = settings as never;
  const manager = new ContentFilterManager({ enabled: true, ...extra });
  await manager.initialize();
  manager.destroy();
}

afterEach(() => {
  document.body.innerHTML = '';
  STATE.settings = null;
});

describe('列表页过滤 toast 两行（10-05-list-filter-toast）', () => {
  it('双机制并集去重 + 行2 固定序仅非零（关键字与行1 同源不双计）', async () => {
    const list = makeList();
    const a = createMovieCard('DUP-AAA title'); // 仅关键字隐藏
    const b = createMovieCard('KEEP-BBB title'); // 仅显示过滤（viewed）
    const c = createMovieCard('DUP-CCC title'); // 关键字 + 演员 双隐（并集计 1）
    b.setAttribute('data-hide-src-viewed', 'true');
    b.setAttribute('data-hidden-by-default', 'true');
    c.setAttribute('data-hide-src-actor', 'true');
    c.setAttribute('data-hidden-by-default', 'true');
    list.append(a, b, c);

    await runManager({
      contentFilter: { keywordRules: [HIDE_RULE] },
      display: { hideViewed: true },
      listEnhancement: { hideBlacklistedActorsInList: true },
      records: {},
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      '过滤: 隐藏3 高亮0 模糊0 标记0\n隐藏明细: 看过1 · 演员1 · 关键字2',
      'info',
    );
  });

  it('仅显示过滤命中：行1=隐藏N+三零、行2=媒体库明细，toast 必弹', async () => {
    const list = makeList();
    const a = createMovieCard('ML-001 title');
    a.setAttribute('data-hide-src-mediaLibrary', 'true');
    a.setAttribute('data-hidden-by-default', 'true');
    list.append(a);

    await runManager({
      contentFilter: { keywordRules: [] },
      display: { hideInMediaLibrary: true },
      records: {},
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('过滤: 隐藏1 高亮0 模糊0 标记0\n隐藏明细: 媒体库1', 'info');
  });

  it('行1 隐藏=0 且无高亮/模糊/标记 → 不弹（门控不变）', async () => {
    const list = makeList();
    list.append(createMovieCard('CLEAN-001 title'));

    await runManager({ contentFilter: { keywordRules: [] }, records: {} });

    expect(showToast).not.toHaveBeenCalled();
  });

  it('showFilteredCount=false → 有隐藏也不弹（开关门控保持）', async () => {
    const list = makeList();
    const a = createMovieCard('ML-002 title');
    a.setAttribute('data-hide-src-mediaLibrary', 'true');
    a.setAttribute('data-hidden-by-default', 'true');
    list.append(a);

    await runManager(
      {
        contentFilter: { keywordRules: [] },
        display: { hideInMediaLibrary: true },
        records: {},
      },
      { showFilteredCount: false },
    );

    expect(showToast).not.toHaveBeenCalled();
  });

  it('仅高亮无隐藏：单行文案（无明细行，门控经高亮通过）', async () => {
    const list = makeList();
    list.append(createMovieCard('HL-001 title'));

    await runManager({ contentFilter: { keywordRules: [HL_RULE] }, records: {} });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('过滤: 隐藏0 高亮1 模糊0 标记0', 'info');
  });

  it('行1 隐藏>0 但明细全零（来源开关关残留边）：单行文案', async () => {
    const list = makeList();
    const a = createMovieCard('STALE-001 title');
    a.setAttribute('data-hidden-by-default', 'true'); // 无 data-hide-src-*
    list.append(a);

    await runManager({ contentFilter: { keywordRules: [] }, records: {} });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('过滤: 隐藏1 高亮0 模糊0 标记0', 'info');
  });
});
