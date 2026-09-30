/**
 * @file entryKeyResolution.ts
 * @description 影片页「类别」栏链接 → 类别 entryKey 的逐链接解析（09-30-video-category-quick-actions）。
 *
 * 口径来源：packages/video-category-dict/src/parse.ts 的私有 extractDimPair + parseDetailCategories
 * 规则（同一套判定，per-link 粒度复用）。该函数为模块私有未导出，本文件按仓内既有实现复刻，
 * **不外扩字典包导出**（红线：packages/ 零改动）。
 *
 * 规则（与 parseDetailCategories 逐条对齐）：
 *  1. href 以 base 解析为 URL，按 searchParams 原顺序取**首个** cN= 参数（N 为单个数字 1-9 且是字典维度）；
 *     c10/c11 等原站保留位被忽略（与字典口径一致）；value 为空跳过；
 *  2. 得到的 (dim, id) 必须在字典内存在该条目，否则该链接「不可用」→ 返回 null；
 *  3. 非 /tags 形态、解析抛错、无 cN= 参数 → null；
 *  4. 多个链接命中同一 entryKey 时按页面顺序去重（保留首个）。
 *
 * 不可用链接的 UI 处置（coord 裁决 3）= 面板与按钮完全不出现，不置灰。
 * @module features/categoryQuickActions/domain
 */
import {
  BUILTIN_CATEGORY_DICTIONARY,
  entryKey,
  findEntry,
  isDimKey,
  isCategoryPanelLabel,
  type CategoryDictionary,
  type CategorySiteId,
  type DimKey,
} from '@javdb/video-category-dict';

/** 内置字典与活动站点（与列表侧穿透 / 新作品黑名单同一口径）。 */
export const CATEGORY_DICT: CategoryDictionary = BUILTIN_CATEGORY_DICTIONARY;
export const CATEGORY_SITE: CategorySiteId = CATEGORY_DICT.activeSite;

/** 无可用页面基址时的回退基址（与 parseDetailCategories 的字典站点基址一致）。 */
export const FALLBACK_BASE: string = CATEGORY_DICT.sources[CATEGORY_SITE]?.base || 'https://javdb.com';

/** 单个类别链接的解析结果。 */
export interface CategoryLinkCandidate {
  /** 字典内 entryKey，形如 'c4=17'（存储值原样） */
  entryKey: string;
  /** 维度 key（c1..c7 / c9） */
  dim: DimKey;
  /** 原站数字 id 或 c9 区间码 */
  id: string;
  /** 链接显示文本（trim 后；面板标题与 toast 用） */
  label: string;
  /** 链接 href 属性原文 */
  href: string;
}

/** 纯数据形态的链接（无 DOM 环境可直接喂，与 RawCategoryPanel.tagHrefs 同形）。 */
export interface RawCategoryLink {
  href: string;
  text?: string;
}

/**
 * 选取 URL 解析基址：页面 location.href 为绝对 http(s) 时优先，否则回退字典站点基址。
 * 与 parse.ts 的 isUsableBaseUrl 同口径（'about:blank' 等真值但不可用的基址必须回退，
 * 否则 new URL 全抛错 → 解析恒空）。
 */
export function resolveBaseHref(candidate?: string | null): string {
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return candidate as string;
    } catch {
      // 非绝对地址 → 回退
    }
  }
  return FALLBACK_BASE;
}

/** 当前文档可用的解析基址（无 window 环境回退字典基址）。 */
export function currentBaseHref(): string {
  try {
    return resolveBaseHref(typeof window !== 'undefined' ? window.location?.href : null);
  } catch {
    return FALLBACK_BASE;
  }
}

/**
 * 从 href 抽取 (dim, id)：只认 cN=（N 为单数字且是字典维度），忽略 c10/c11 等保留位。
 * 与 parse.ts 私有 extractDimPair 逐行等价（首个命中即返回）。
 */
export function extractDimPairFromHref(
  href: string,
  base: string = FALLBACK_BASE,
): { dim: DimKey; id: string } | null {
  try {
    const url = new URL(href, base);
    for (const [key, value] of url.searchParams) {
      const matched = /^c([1-9])$/.exec(key);
      if (!matched) continue;
      const dim = `c${matched[1]}` as DimKey;
      if (!isDimKey(dim)) continue;
      if (!value) continue;
      return { dim, id: value };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 单个链接 href → 字典内 entryKey；不可用返回 null。
 */
export function resolveCategoryEntryKeyFromHref(
  href: string,
  base: string = FALLBACK_BASE,
  dict: CategoryDictionary = CATEGORY_DICT,
  site: CategorySiteId = CATEGORY_SITE,
): string | null {
  const pair = extractDimPairFromHref(href, base);
  if (!pair) return null;
  if (!findEntry(dict, site, pair.dim, pair.id)) return null;
  return entryKey(pair.dim, pair.id);
}

/**
 * 纯函数：链接列表 → 可用候选列表（字典存在性校验 + 按 entryKey 页面顺序去重）。
 * 不可用（解析失败 / cN 非法 / id 不在字典）链接直接丢弃，不出现在结果里。
 */
export function collectCategoryLinkCandidates(
  links: readonly RawCategoryLink[],
  base: string = FALLBACK_BASE,
  dict: CategoryDictionary = CATEGORY_DICT,
  site: CategorySiteId = CATEGORY_SITE,
): CategoryLinkCandidate[] {
  const out: CategoryLinkCandidate[] = [];
  const seen = new Set<string>();
  for (const link of links ?? []) {
    const href = typeof link?.href === 'string' ? link.href : '';
    if (!href) continue;
    const pair = extractDimPairFromHref(href, base);
    if (!pair) continue;
    if (!findEntry(dict, site, pair.dim, pair.id)) continue;
    const key = entryKey(pair.dim, pair.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      entryKey: key,
      dim: pair.dim,
      id: pair.id,
      label: (typeof link.text === 'string' ? link.text : '').trim(),
      href,
    });
  }
  return out;
}

/** 面板标题文本是否为类别面板（直接用字典包导出的单一事实源判定）。 */
export function isCategoryPanelTitle(text: string | null | undefined): boolean {
  return isCategoryPanelLabel(text);
}

/**
 * DOM 侧：在给定根（document 或面板容器）内收集「类别」面板里的可用类别链接。
 * 结构口径照 parseDetailCategories：.panel-block → strong 文本为类别面板标题 → 面板内 a[href*="/tags?c"]。
 * 返回元素与候选一一对应（同一链接只保留一次）。
 */
export function findCategoryLinkElements(
  root: Document | HTMLElement,
  base: string = currentBaseHref(),
  dict: CategoryDictionary = CATEGORY_DICT,
  site: CategorySiteId = CATEGORY_SITE,
): Array<{ element: HTMLAnchorElement; candidate: CategoryLinkCandidate }> {
  const result: Array<{ element: HTMLAnchorElement; candidate: CategoryLinkCandidate }> = [];
  const seen = new Set<string>();
  const panels = root.querySelectorAll?.('.panel-block') ?? [];
  panels.forEach(panel => {
    const title = (panel.querySelector('strong')?.textContent || '').trim();
    if (!isCategoryPanelTitle(title)) return;
    panel.querySelectorAll<HTMLAnchorElement>('a[href*="/tags?c"]').forEach(anchor => {
      const href = anchor.getAttribute('href') || '';
      const pair = extractDimPairFromHref(href, base);
      if (!pair) return;
      if (!findEntry(dict, site, pair.dim, pair.id)) return;
      const key = entryKey(pair.dim, pair.id);
      if (seen.has(key)) return;
      seen.add(key);
      result.push({
        element: anchor,
        candidate: {
          entryKey: key,
          dim: pair.dim,
          id: pair.id,
          label: (anchor.textContent || '').trim(),
          href,
        },
      });
    });
  });
  return result;
}
