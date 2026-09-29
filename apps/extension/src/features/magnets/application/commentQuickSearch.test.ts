/**
 * @file commentQuickSearch.test.ts
 * @description 磁力区评论区选文快速搜索纯逻辑单测（作用域/长度门控、镜像域名 URL、浮标定位）
 * @module features/magnets
 */
import { describe, expect, it } from 'vitest';
import {
  COMMENT_QUICK_SEARCH_MAX_LENGTH,
  COMMENT_QUICK_SEARCH_SCOPE_SELECTOR,
  COMMENT_QUICK_SEARCH_SCOPE_SELECTORS,
  buildCommentQuickSearchUrl,
  computeCommentQuickSearchPosition,
  countCommentQuickSearchChars,
  decideCommentQuickSearch,
  isCommentQuickSearchActive,
  isCommentQuickSearchLengthAllowed,
  normalizeCommentQuickSearchQuery,
} from './commentQuickSearch';

const MIRROR_ORIGIN = 'https://javdb575.com';

describe('normalizeCommentQuickSearchQuery', () => {
  it('collapses cross-paragraph whitespace into single spaces and trims', () => {
    expect(normalizeCommentQuickSearchQuery('  三上悠亜 \n\t SSNI-409  ')).toBe('三上悠亜 SSNI-409');
  });

  it('tolerates null / undefined / non-string input', () => {
    expect(normalizeCommentQuickSearchQuery(null)).toBe('');
    expect(normalizeCommentQuickSearchQuery(undefined)).toBe('');
    expect(normalizeCommentQuickSearchQuery(123 as unknown as string)).toBe('');
  });
});

describe('countCommentQuickSearchChars', () => {
  it('counts code points so CJK and surrogate pairs are not over-counted', () => {
    expect(countCommentQuickSearchChars('三上悠亜')).toBe(4);
    expect(countCommentQuickSearchChars('🔎🔎')).toBe(2);
    expect('🔎🔎'.length).toBe(4);
  });
});

describe('isCommentQuickSearchLengthAllowed', () => {
  it('accepts the 1..30 inclusive boundary', () => {
    expect(isCommentQuickSearchLengthAllowed('亜')).toBe(true);
    expect(isCommentQuickSearchLengthAllowed('a'.repeat(COMMENT_QUICK_SEARCH_MAX_LENGTH))).toBe(true);
  });

  it('rejects empty, whitespace-only and over-long selections', () => {
    expect(isCommentQuickSearchLengthAllowed('')).toBe(false);
    expect(isCommentQuickSearchLengthAllowed('   \n ')).toBe(false);
    expect(isCommentQuickSearchLengthAllowed('a'.repeat(COMMENT_QUICK_SEARCH_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('buildCommentQuickSearchUrl', () => {
  it('builds a site search URL on the CURRENT mirror origin (never a hardcoded domain)', () => {
    expect(buildCommentQuickSearchUrl(MIRROR_ORIGIN, '三上悠亜')).toBe(
      'https://javdb575.com/search?q=%E4%B8%89%E4%B8%8A%E6%82%A0%E4%BA%9C&f=all',
    );
    expect(buildCommentQuickSearchUrl('https://javdb570.com', 'SSNI-409')).toBe(
      'https://javdb570.com/search?q=SSNI-409&f=all',
    );
    expect(buildCommentQuickSearchUrl('https://javdb.com', 'abc')).toBe('https://javdb.com/search?q=abc&f=all');
  });

  it('keeps the origin port and drops any path from the origin input', () => {
    expect(buildCommentQuickSearchUrl('http://127.0.0.1:8080/v/4VBXZ', 'abc')).toBe(
      'http://127.0.0.1:8080/search?q=abc&f=all',
    );
  });

  it('encodes reserved characters so the query survives the address bar', () => {
    expect(buildCommentQuickSearchUrl(MIRROR_ORIGIN, 'a b&c=d?e#f')).toBe(
      `https://javdb575.com/search?q=${encodeURIComponent('a b&c=d?e#f')}&f=all`,
    );
  });

  it('returns null instead of falling back to any default host', () => {
    expect(buildCommentQuickSearchUrl('', 'abc')).toBeNull();
    expect(buildCommentQuickSearchUrl(null, 'abc')).toBeNull();
    expect(buildCommentQuickSearchUrl('javdb575.com', 'abc')).toBeNull();
    expect(buildCommentQuickSearchUrl('chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka', 'abc')).toBeNull();
    expect(buildCommentQuickSearchUrl(MIRROR_ORIGIN, '')).toBeNull();
    expect(buildCommentQuickSearchUrl(MIRROR_ORIGIN, '   ')).toBeNull();
  });

  it('does not embed a javdb.com literal anywhere in this module source', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./commentQuickSearch.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/javdb\.com/);
    expect(code).not.toMatch(/javdb\d+\.com/);
  });
});

describe('decideCommentQuickSearch', () => {
  const base = { inCommentArea: true, origin: MIRROR_ORIGIN };

  it('shows the float for an in-scope selection within the length window', () => {
    expect(decideCommentQuickSearch({ ...base, selectedText: '三上悠亜' })).toEqual({
      show: true,
      query: '三上悠亜',
      url: 'https://javdb575.com/search?q=%E4%B8%89%E4%B8%8A%E6%82%A0%E4%BA%9C&f=all',
    });
  });

  it('rejects selections outside the magnet-area comment pane first', () => {
    expect(decideCommentQuickSearch({ ...base, inCommentArea: false, selectedText: '三上悠亜' })).toEqual({
      show: false,
      reason: 'out-of-comment-area',
    });
  });

  it('rejects empty / collapsed selections', () => {
    expect(decideCommentQuickSearch({ ...base, selectedText: '' })).toEqual({ show: false, reason: 'empty-selection' });
    expect(decideCommentQuickSearch({ ...base, selectedText: null })).toEqual({ show: false, reason: 'empty-selection' });
    expect(decideCommentQuickSearch({ ...base, selectedText: '\n  ' })).toEqual({ show: false, reason: 'empty-selection' });
  });

  it('rejects over-long selections (whole paragraph grab)', () => {
    expect(decideCommentQuickSearch({ ...base, selectedText: 'a'.repeat(31) })).toEqual({
      show: false,
      reason: 'too-long',
    });
  });

  it('rejects when the page origin is unusable', () => {
    expect(decideCommentQuickSearch({ inCommentArea: true, origin: 'about:blank', selectedText: 'abc' })).toEqual({
      show: false,
      reason: 'unknown-origin',
    });
  });
});

describe('COMMENT_QUICK_SEARCH_SCOPE_SELECTOR', () => {
  it('targets the lazy reviews pane inside the magnet tab container, with an #reviews fallback', () => {
    expect(COMMENT_QUICK_SEARCH_SCOPE_SELECTORS).toEqual([
      '#tabs-container [data-movie-tab-target="reviews"] .review-item .content',
      '#reviews .review-item .content',
    ]);
    expect(COMMENT_QUICK_SEARCH_SCOPE_SELECTOR).toBe(COMMENT_QUICK_SEARCH_SCOPE_SELECTORS.join(', '));
  });

  it('does not scope to the magnet rows themselves (they carry no comment text)', () => {
    expect(COMMENT_QUICK_SEARCH_SCOPE_SELECTOR).not.toContain('#magnets-content');
    expect(COMMENT_QUICK_SEARCH_SCOPE_SELECTOR).not.toContain('.magnet-name');
  });
});

describe('computeCommentQuickSearchPosition', () => {
  const viewport = { width: 1440, height: 1000 };
  const metrics = { width: 28, height: 28, gap: 8, margin: 8 };

  it('places the float to the right of the selection end, vertically centred on it', () => {
    const rect = { top: 400, left: 100, right: 200, bottom: 420, width: 100, height: 20 };
    expect(computeCommentQuickSearchPosition(rect, viewport, metrics)).toEqual({
      top: 396,
      left: 208,
      visible: true,
      flipped: false,
    });
  });

  it('flips to the left when the right side would overflow the viewport', () => {
    const rect = { top: 400, left: 1300, right: 1435, bottom: 420, width: 135, height: 20 };
    const pos = computeCommentQuickSearchPosition(rect, viewport, metrics);
    expect(pos.flipped).toBe(true);
    expect(pos.left).toBe(1300 - 8 - 28);
    expect(pos.visible).toBe(true);
  });

  it('clamps vertically so the float never leaves the viewport', () => {
    const nearTop = { top: 0, left: 100, right: 200, bottom: 10, width: 100, height: 10 };
    expect(computeCommentQuickSearchPosition(nearTop, viewport, metrics).top).toBe(8);

    const nearBottom = { top: 990, left: 100, right: 200, bottom: 1000, width: 100, height: 10 };
    expect(computeCommentQuickSearchPosition(nearBottom, viewport, metrics).top).toBe(1000 - 8 - 28);
  });

  it('reports not visible when the selection end is off-screen (lazy comment pane below the fold)', () => {
    const belowFold = { top: 1362, left: 65, right: 155, bottom: 1381, width: 91, height: 19 };
    expect(computeCommentQuickSearchPosition(belowFold, viewport, metrics).visible).toBe(false);

    const aboveFold = { top: -200, left: 65, right: 155, bottom: -180, width: 91, height: 19 };
    expect(computeCommentQuickSearchPosition(aboveFold, viewport, metrics).visible).toBe(false);
  });

  it('reports not visible for a collapsed (zero-size) rect', () => {
    const collapsed = { top: 400, left: 100, right: 100, bottom: 400, width: 0, height: 0 };
    expect(computeCommentQuickSearchPosition(collapsed, viewport, metrics).visible).toBe(false);
  });
});

describe('isCommentQuickSearchActive（生效口径唯一真源：开关 × 页面类型）', () => {
  it('仅在「开关严格为 true 且影片详情页」时生效', () => {
    expect(isCommentQuickSearchActive({ enabled: true, isVideoPage: true })).toBe(true);
  });

  it('非影片页（列表页/演员页）一律不生效：保持零开销', () => {
    expect(isCommentQuickSearchActive({ enabled: true, isVideoPage: false })).toBe(false);
  });

  it('开关关闭时不生效（与页面类型无关）', () => {
    expect(isCommentQuickSearchActive({ enabled: false, isVideoPage: true })).toBe(false);
    expect(isCommentQuickSearchActive({ enabled: false, isVideoPage: false })).toBe(false);
  });

  it('容忍设置脏值：非严格 true 一律视为关闭（默认关，不误开）', () => {
    for (const dirty of [undefined, null, 'yes', 1, 0, {}, [], NaN]) {
      expect(isCommentQuickSearchActive({ enabled: dirty, isVideoPage: true }), String(typeof dirty)).toBe(false);
    }
  });
});
