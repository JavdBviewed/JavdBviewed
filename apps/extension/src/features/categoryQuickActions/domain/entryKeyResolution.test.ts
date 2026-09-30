/**
 * @file entryKeyResolution.test.ts
 * @description 影片页「類別」栏逐链接 entryKey 解析单测（09-30-video-category-quick-actions）。
 * 覆盖派单验收四项：真实形态 /tags?cN=ID 命中、未知 id 不可用、非类别链接跳过、同 entryKey 去重。
 */
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_BASE,
  collectCategoryLinkCandidates,
  extractDimPairFromHref,
  isCategoryPanelTitle,
  resolveBaseHref,
  resolveCategoryEntryKeyFromHref,
} from './entryKeyResolution';

const BASE = 'https://javdb.com';

describe('resolveBaseHref / currentBaseHref 基址回退', () => {
  it('绝对 http(s) 基址原样采用', () => {
    expect(resolveBaseHref('https://javdb570.com/v/abc123')).toBe('https://javdb570.com/v/abc123');
  });

  it('about:blank / file: / 空值 / 非法值回退字典站点基址', () => {
    expect(resolveBaseHref('about:blank')).toBe(FALLBACK_BASE);
    expect(resolveBaseHref('file:///tmp/x.html')).toBe(FALLBACK_BASE);
    expect(resolveBaseHref('')).toBe(FALLBACK_BASE);
    expect(resolveBaseHref(null)).toBe(FALLBACK_BASE);
    expect(resolveBaseHref(undefined)).toBe(FALLBACK_BASE);
    expect(resolveBaseHref('v/relative')).toBe(FALLBACK_BASE);
  });
});

describe('extractDimPairFromHref（复刻字典包私有 extractDimPair 口径）', () => {
  it('真实形态：相对 href + 基址 → (dim,id)', () => {
    expect(extractDimPairFromHref('/tags?c4=17', BASE)).toEqual({ dim: 'c4', id: '17' });
    expect(extractDimPairFromHref('https://javdb.com/tags?c7=28', BASE)).toEqual({ dim: 'c7', id: '28' });
  });

  it('c9 时长区间码（非纯数字 id）同样命中', () => {
    expect(extractDimPairFromHref('/tags?c9=lt-45', BASE)).toEqual({ dim: 'c9', id: 'lt-45' });
    expect(extractDimPairFromHref('/tags?c9=45-90', BASE)).toEqual({ dim: 'c9', id: '45-90' });
  });

  it('按 searchParams 原顺序取首个命中（不做维度优先级排序）', () => {
    expect(extractDimPairFromHref('/tags?c3=3&c4=15', BASE)).toEqual({ dim: 'c3', id: '3' });
  });

  it('c10/c11 等原站保留位忽略（与字典 DIM_KEYS 口径一致）', () => {
    expect(extractDimPairFromHref('/tags?c10=5', BASE)).toBeNull();
    expect(extractDimPairFromHref('/tags?c11=5&c4=17', BASE)).toEqual({ dim: 'c4', id: '17' });
    expect(extractDimPairFromHref('/tags?c0=1', BASE)).toBeNull();
  });

  it('value 为空跳过；无 cN= 参数与非 /tags 形态返回 null', () => {
    expect(extractDimPairFromHref('/tags?c4=', BASE)).toBeNull();
    expect(extractDimPairFromHref('/tags?a=1&c4=17', BASE)).toEqual({ dim: 'c4', id: '17' });
    expect(extractDimPairFromHref('/tags', BASE)).toBeNull();
    expect(extractDimPairFromHref('/actors/123', BASE)).toBeNull();
    expect(extractDimPairFromHref('/v/abc123', BASE)).toBeNull();
  });

  it('非法 URL 不抛错，返回 null', () => {
    expect(extractDimPairFromHref('::bad::', BASE)).toBeNull();
  });
});

describe('resolveCategoryEntryKeyFromHref（字典存在性校验）', () => {
  it('字典内条目 → entryKey 原文', () => {
    expect(resolveCategoryEntryKeyFromHref('/tags?c4=17', BASE)).toBe('c4=17');
    expect(resolveCategoryEntryKeyFromHref('/tags?c1=23', BASE)).toBe('c1=23');
    expect(resolveCategoryEntryKeyFromHref('/tags?c9=lt-45', BASE)).toBe('c9=lt-45');
  });

  it('字典外的 id → 不可用（null，UI 侧面板完全不出现）', () => {
    expect(resolveCategoryEntryKeyFromHref('/tags?c4=999999', BASE)).toBeNull();
    expect(resolveCategoryEntryKeyFromHref('/tags?c2=999999', BASE)).toBeNull();
  });

  it('非类别维度 / 保留位 → null', () => {
    expect(resolveCategoryEntryKeyFromHref('/search?q=abc', BASE)).toBeNull();
    expect(resolveCategoryEntryKeyFromHref('/tags?c10=17', BASE)).toBeNull();
  });
});

describe('collectCategoryLinkCandidates（纯函数：可用候选 + 页面顺序去重）', () => {
  it('真实形态链接批量解析，label 取 trim 后文本', () => {
    const out = collectCategoryLinkCandidates(
      [
        { href: '/tags?c4=17', text: ' 熟女 ' },
        { href: '/tags?c7=28', text: '單體作品' },
      ],
      BASE,
    );
    expect(out.map(c => c.entryKey)).toEqual(['c4=17', 'c7=28']);
    expect(out[0]).toMatchObject({ dim: 'c4', id: '17', label: '熟女', href: '/tags?c4=17' });
  });

  it('不可用链接直接丢弃（不出现在结果里，不置灰）', () => {
    const out = collectCategoryLinkCandidates(
      [
        { href: '/tags?c4=999999', text: '未知' },
        { href: '/tags?c4=17', text: '熟女' },
        { href: '/actors/123', text: '演员' },
        { href: '', text: '空 href' },
      ],
      BASE,
    );
    expect(out.map(c => c.entryKey)).toEqual(['c4=17']);
  });

  it('同一 entryKey 重复出现按页面顺序去重（保留首个）', () => {
    const out = collectCategoryLinkCandidates(
      [
        { href: '/tags?c4=15', text: '第一处' },
        { href: '/tags?c4=17', text: '熟女' },
        { href: 'https://javdb.com/tags?c4=15', text: '第二处（绝对地址同值）' },
      ],
      BASE,
    );
    expect(out.map(c => c.entryKey)).toEqual(['c4=15', 'c4=17']);
    expect(out[0].label).toBe('第一处');
  });

  it('空输入与脏输入不抛错', () => {
    expect(collectCategoryLinkCandidates([], BASE)).toEqual([]);
    expect(collectCategoryLinkCandidates(undefined as any, BASE)).toEqual([]);
    expect(collectCategoryLinkCandidates([{} as any, null as any], BASE)).toEqual([]);
  });

  it('缺省基址走字典站点基址（无 window 环境也可解析相对 href）', () => {
    const out = collectCategoryLinkCandidates([{ href: '/tags?c4=17', text: '熟女' }]);
    expect(out.map(c => c.entryKey)).toEqual(['c4=17']);
  });
});

describe('isCategoryPanelTitle（转调字典包单一事实源）', () => {
  it('类别面板标题命中（繁简 + 中英 + 冒号变体）', () => {
    expect(isCategoryPanelTitle('類別:')).toBe(true);
    expect(isCategoryPanelTitle('类别：')).toBe(true);
    expect(isCategoryPanelTitle('Tags:')).toBe(true);
    expect(isCategoryPanelTitle('  categories ')).toBe(true);
  });

  it('其他面板与年龄门文案不误判', () => {
    expect(isCategoryPanelTitle('Actor(s):')).toBe(false);
    expect(isCategoryPanelTitle('Tagged:')).toBe(false);
    expect(isCategoryPanelTitle('Are you at least 18 years old?')).toBe(false);
    expect(isCategoryPanelTitle('')).toBe(false);
    expect(isCategoryPanelTitle(null)).toBe(false);
    expect(isCategoryPanelTitle(undefined)).toBe(false);
  });
});
