/**
 * @vitest-environment jsdom
 * @file contentFilterManager.fields.test.ts
 * @description 内容过滤作用字段缺陷修复（10-05-contentfilter-fields-fix）：
 *   - genre 选择器不再含 .tag 徽章（徽章文本不入 genre，语义污染修复）；
 *   - checkDateRange 静默失效语义锁（before/after 无日期依据恒 false —— 根因 A 语义，
 *     锁住「不得悄悄改成 true」，修复面在设置页 save 校验而非此处）；
 *   - matchKeyword 空 keyword 恒命中（纯日期规则可命中的前提）；
 *   - 日期门控：日期规则启用 + 卡上无日期 → 不命中；纯日期规则范围内命中；
 *   - applyFilters 末尾一行 date-missing 诊断汇总日志（无 toast、不改 stats 格式）。
 * @module features/contentFilter
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/tasks', () => ({
  countContentPerformanceEvent: vi.fn(),
  recordContentPerformanceDuration: vi.fn(),
  // 真执行 onItem（applyFilters 汇总日志用例需要逐卡处理）
  runChunkedWork: vi.fn(async (items: unknown[], opts?: { onItem?: (item: unknown) => unknown }) => {
    for (const item of items) {
      await opts?.onItem?.(item);
    }
    return {};
  }),
  saveSubtaskDetail: vi.fn(),
  yieldToMainThread: vi.fn(async () => undefined),
}));
vi.mock('../contentState', () => ({
  STATE: {},
  log: vi.fn(),
}));
vi.mock('../../platform/browser/toast', () => ({
  showToast: vi.fn(),
}));

import { ContentFilterManager } from './contentFilterManager';
import { log } from '../contentState';
import type { KeywordFilterRule } from '../../types';

/** 构造列表卡（可选 .meta 日期 / .genre / .tag 徽章） */
function makeCard(opts: {
  title?: string;
  code?: string;
  slug?: string;
  metaDate?: string;
  genre?: string;
  badge?: string;
} = {}): HTMLElement {
  const title = opts.title ?? '测试标题文本足够长的影片标题';
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <div class="video-title">
      <strong>${opts.code ?? 'ABC-123'}</strong>
      <a title="${title}">${title}</a>
    </div>
    <a class="video-link" href="/v/${opts.slug ?? '598497'}"></a>
    ${opts.metaDate ? `<div class="meta">${opts.metaDate}</div>` : ''}
    ${opts.genre ? `<span class="genre">${opts.genre}</span>` : ''}
    ${opts.badge ? `<span class="tag is-success">${opts.badge}</span>` : ''}
  `;
  return item;
}

function extract(item: HTMLElement): Record<string, string> {
  const manager = new ContentFilterManager({ enabled: false });
  return (manager as unknown as { extractItemData(el: HTMLElement): Record<string, string> }).extractItemData(item);
}

function makeRule(overrides: Partial<KeywordFilterRule>): KeywordFilterRule {
  return {
    id: 'r1',
    name: 'test',
    keyword: 'ABC-123',
    isRegex: false,
    caseSensitive: false,
    action: 'hide',
    enabled: true,
    fields: ['title'],
    ...overrides,
  };
}

function evaluate(manager: ContentFilterManager, rule: KeywordFilterRule, item: HTMLElement): boolean {
  const itemData = (manager as unknown as { extractItemData(el: HTMLElement): Record<string, string> }).extractItemData(item);
  return (manager as unknown as { evaluateKeywordRule(r: KeywordFilterRule, d: Record<string, string>): boolean })
    .evaluateKeywordRule(rule, itemData);
}

describe('genre 选择器：徽章（.tag）不再入 genre（10-05-contentfilter-fields-fix）', () => {
  it('卡含 .genre + .tag 徽章 → genre 只取 genre 文本（徽章不入）', () => {
    const item = makeCard({ genre: 'OL', badge: '含磁鏈' });
    const data = extract(item);
    expect(data.genre).toBe('OL');
    expect(data.genre ?? '').not.toContain('含磁鏈');
  });

  it('卡只有 .tag 徽章（无 .genre/.category）→ 不写 genre 键', () => {
    const item = makeCard({ badge: '今日新種' });
    const data = extract(item);
    expect(data.genre).toBeUndefined();
  });
});

describe('checkDateRange：静默失效语义锁（根因 A，修复面在 save 校验，此处行为零改）', () => {
  const manager = new ContentFilterManager({ enabled: false });
  const check = (dateStr: string, range: NonNullable<KeywordFilterRule['releaseDateRange']>): boolean =>
    (manager as unknown as {
      checkDateRange(d: string, r: NonNullable<KeywordFilterRule['releaseDateRange']>): boolean;
    }).checkDateRange(dateStr, range);

  it('before + exactDate：早于目标 true / 晚于 false', () => {
    expect(check('2024-05-01', { enabled: true, comparison: 'before', exactDate: '2025-01-01' })).toBe(true);
    expect(check('2025-06-01', { enabled: true, comparison: 'before', exactDate: '2025-01-01' })).toBe(false);
  });

  it('before + 无 exactDate 且无 endDate → 恒 false（静默失效语义，不得悄悄改 true）', () => {
    for (const dateStr of ['2020-01-01', '2025-06-01', '2030-01-01']) {
      expect(check(dateStr, { enabled: true, comparison: 'before' })).toBe(false);
    }
  });

  it('after + 无 exactDate 且无 startDate → 恒 false', () => {
    for (const dateStr of ['2020-01-01', '2025-06-01', '2030-01-01']) {
      expect(check(dateStr, { enabled: true, comparison: 'after' })).toBe(false);
    }
  });

  it('between 双端均空 → true（无日期约束，关键词仍有效）', () => {
    expect(check('2024-05-01', { enabled: true, comparison: 'between' })).toBe(true);
    expect(check('2024-05-01', { enabled: true, comparison: 'between', startDate: '', endDate: '' })).toBe(true);
  });

  it('exact + exactDate：同日 true / 异日 false', () => {
    expect(check('2024-05-01', { enabled: true, comparison: 'exact', exactDate: '2024-05-01' })).toBe(true);
    expect(check('2024-05-02', { enabled: true, comparison: 'exact', exactDate: '2024-05-01' })).toBe(false);
  });
});

describe('matchKeyword：空 keyword 恒命中（纯日期规则可命中的前提）', () => {
  const manager = new ContentFilterManager({ enabled: false });
  const match = (keyword: string, text: string, isRegex: boolean): boolean =>
    (manager as unknown as { matchKeyword(k: string, t: string, r: boolean, c: boolean): boolean })
      .matchKeyword(keyword, text, isRegex, false);

  it('非正则空 keyword → true（任意文本）', () => {
    expect(match('', '任意文本', false)).toBe(true);
    expect(match('', '', false)).toBe(true);
  });

  it('正则空 keyword → true', () => {
    expect(match('', '任意文本', true)).toBe(true);
  });
});

describe('日期门控：日期规则启用 + 卡上无日期（10-05-contentfilter-fields-fix）', () => {
  const dateRule = makeRule({
    fields: ['release-date'],
    keyword: '',
    releaseDateRange: { enabled: true, comparison: 'before', exactDate: '2025-01-01' },
  });

  it('日期规则启用 + 卡上无日期 → 不命中（return false，既有行为锁）', () => {
    const manager = new ContentFilterManager({ enabled: true });
    expect(evaluate(manager, dateRule, makeCard())).toBe(false);
  });

  it('纯日期规则（keyword 空）+ 日期在范围内 → 命中', () => {
    const manager = new ContentFilterManager({ enabled: true });
    expect(evaluate(manager, dateRule, makeCard({ metaDate: '2024-05-01' }))).toBe(true);
  });

  it('纯日期规则 + 日期出范围 → 不命中', () => {
    const manager = new ContentFilterManager({ enabled: true });
    expect(evaluate(manager, dateRule, makeCard({ metaDate: '2026-01-01' }))).toBe(false);
  });

  it('applyFilters：日期规则 + 两卡（一有日期一无日期）→ 末尾一行 date-missing 汇总日志（active=1 missing=1/2）', async () => {
    const withDate = makeCard({ metaDate: '2024-05-01' });
    const noDate = makeCard();
    document.body.append(withDate, noDate);
    try {
      const manager = new ContentFilterManager({
        enabled: true,
        keywordRules: [dateRule],
      });
      await (manager as unknown as { applyFilters(items?: readonly HTMLElement[]): Promise<void> })
        .applyFilters([withDate, noDate]);
      const calls = (log as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((args) => String(args[0])).join('\n');
      expect(calls).toContain('[ContentFilter] date rules: active=1 missing=1/2');
      // 附带锁：有日期卡被规则隐藏、无日期卡不被隐藏
      expect(withDate.getAttribute('data-filter-applied')).toBe('hide');
      expect(noDate.getAttribute('data-filter-applied')).toBeNull();
    } finally {
      withDate.remove();
      noDate.remove();
    }
  });
});
