/**
 * @vitest-environment jsdom
 * @file contentFilterManager.videoCode.test.ts
 * @description 关键字规则「番号」字段（video-code）提取与命中文案回归：
 *   - extractItemData 对全部列表卡写入 data['video-code']（.video-title strong 口径）；
 *   - fields 含 'video-code' 的规则按番号文本命中；
 *   - 红线：不含 video-code 的既有规则命中行为零变化（title/video-id 口径不变）。
 * @module features/contentFilter
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/tasks', () => ({
  countContentPerformanceEvent: vi.fn(),
  recordContentPerformanceDuration: vi.fn(),
  runChunkedWork: vi.fn(async () => ({})),
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
import type { KeywordFilterRule } from '../../types';

/** 构造一张 JavDB 列表卡（a[title] 纯标题 + .video-title strong 番号 + /v/ 链接） */
function makeCard(opts: { title: string; code: string; slug?: string } = { title: '测试标题文本足够长的影片标题', code: 'ABC-123', slug: '598497' }): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <div class="video-title">
      <strong>${opts.code}</strong>
      <a title="${opts.title}">${opts.title}</a>
    </div>
    <a class="video-link" href="/v/${opts.slug ?? '598497'}"></a>
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

describe('extractItemData：video-code 番号字段', () => {
  it('正常列表卡（有标题）也写入 video-code', () => {
    const item = makeCard({ title: '测试标题文本足够长的影片标题', code: 'ABC-123' });
    const data = extract(item);
    expect(data['video-code']).toBe('ABC-123');
    expect(data.title).toBe('测试标题文本足够长的影片标题');
  });

  it('番号文本不并入 title（title 保持 a[title] 原文）', () => {
    const item = makeCard({ title: '不含番号的完整影片标题', code: 'XYZ-77' });
    const data = extract(item);
    expect(data.title).toBe('不含番号的完整影片标题');
    expect(data.title).not.toContain('XYZ-77');
    expect(data['video-code']).toBe('XYZ-77');
  });

  it('video-id 仍取 /v/ 链接标识（语义不变）', () => {
    const item = makeCard({ title: '测试标题文本足够长', code: 'ABC-123', slug: '9001' });
    const data = extract(item);
    expect(data['video-id']).toBe('9001');
    expect(data['video-code']).toBe('ABC-123');
  });

  it('无标题兜底分支：video-code 写入且 title 标记不变', () => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = '<div class="video-title"><strong>ABC-123</strong></div>';
    const data = extract(item);
    expect(data['video-code']).toBe('ABC-123');
    expect(data.title).toContain('ABC-123');
    expect(data.title).toContain('标题提取失败');
  });

  it('无番号节点的卡片不写 video-code', () => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = '<a title="只有标题没有番号的卡片">只有标题没有番号的卡片</a>';
    const data = extract(item);
    expect(data['video-code']).toBeUndefined();
  });
});

describe('关键字规则：video-code 命中与红线回归', () => {
  it('fields 含 video-code：番号文本命中', () => {
    const manager = new ContentFilterManager({ enabled: false, keywordRules: [makeRule({ fields: ['video-code'] })] });
    expect(evaluate(manager, makeRule({ fields: ['video-code'] }), makeCard())).toBe(true);
  });

  it('fields=title+video-code（新 UI「番号」组合）：番号命中', () => {
    const manager = new ContentFilterManager({ enabled: false });
    expect(evaluate(manager, makeRule({ fields: ['title', 'video-code'] }), makeCard())).toBe(true);
  });

  it('红线：fields=title 规则不因番号字段新增而命中（title 不含关键字）', () => {
    const manager = new ContentFilterManager({ enabled: false });
    expect(evaluate(manager, makeRule({ fields: ['title'] }), makeCard())).toBe(false);
  });

  it('红线：fields=title+video-id 规则按号仍不命中（video-id=/v/ 标识语义不变）', () => {
    const manager = new ContentFilterManager({ enabled: false });
    expect(evaluate(manager, makeRule({ fields: ['title', 'video-id'] }), makeCard())).toBe(false);
  });

  it('video-code 正则规则：前缀匹配命中', () => {
    const manager = new ContentFilterManager({ enabled: false });
    const rule = makeRule({ keyword: '^ABC-\\d+$', isRegex: true, fields: ['video-code'] });
    expect(evaluate(manager, rule, makeCard())).toBe(true);
  });

  it('applyFiltersToItem：hide 规则命中 video-code 后卡片被隐藏', () => {
    const item = makeCard();
    const manager = new ContentFilterManager({
      enabled: false,
      hideEnabled: true,
      keywordRules: [makeRule({ fields: ['video-code'] })],
    });
    (manager as unknown as { applyFiltersToItem(el: HTMLElement): void }).applyFiltersToItem(item);
    expect(item.getAttribute('data-filter-applied')).toBe('hide');
    expect(item.classList.contains('content-filter-hidden')).toBe(true);
  });
});
