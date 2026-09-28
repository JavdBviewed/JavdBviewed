/**
 * @file parse.ts
 * @description 原站页面类别解析纯函数（输入 DOM Document，无网络/存储副作用）：
 *  - parseDetailCategories：影片详情页「類別」面板 → entryKey 列表（列表穿透用）
 *  - parseTagsPageCategories：/tags 页全量维度表 → CategoryDictionary（后台刷新用）
 * @module @javdb/video-category-dict
 */
import { BUILTIN_CATEGORY_DICTIONARY } from './builtin';
import { entryKey, isDimKey, parseEntryKey } from './query';
import type {
  CategoryDictionary,
  CategoryDimension,
  CategoryEntry,
  CategorySiteId,
  CategorySource,
  DimKey,
} from './types';

/**
 * 详情页类别面板标题（多 locale 精确标签集）。
 * 镜像按 Accept-Language 返回英文/繁体/简体详情页（2026-09-28 真机 javdb575 实证：
 * 英文页 strong 为 "Tags:"，漏匹配会导致 parseDetailCategories 恒空、类别过滤失效）。
 * 采用「trim + 去尾冒号 + 大小写不敏感」的整词匹配（统筹 09-28 裁决）：
 * 避免松散子串正则的误判面（如 "Tagged"/"Tagline" 之类含 tag 子串的标签），
 * 也确保顶部导航「Tags」下拉、年龄验证面板的 c10 快速链接不会被当作类别面板。
 */
const DETAIL_CATEGORY_PANEL_LABELS = new Set(['類別', '类别', 'tag', 'tags', 'category', 'categories']);

/** 详情页 strong 文本是否为类别面板标题（整词匹配，locale 无关）。 */
function isDetailCategoryPanelLabel(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const label = raw.replace(/[\s:：]+$/u, '').trim().toLowerCase();
  return DETAIL_CATEGORY_PANEL_LABELS.has(label);
}

/** 从 href 中抽取 (dim, id)：只认 cN=（N 为单数字且是字典维度），忽略 c10/c11 等保留位。 */
function extractDimPair(href: string, base: string): { dim: DimKey; id: string } | null {
  try {
    const url = new URL(href, base);
    for (const [key, value] of url.searchParams) {
      const m = /^c([1-9])$/.exec(key);
      if (!m) continue;
      const dim = `c${m[1]}` as DimKey;
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
 * 解析影片详情页文档，返回该片命中的类别 entryKey 列表（如 ['c4=17', 'c7=28']）。
 * 规则：
 *  - 定位 strong 文本为类别面板标题（類別/类别/Tags/Category，整词匹配）的 .panel-block；
 *  - 取面板内所有带 /tags?cN=ID 链接；
 *  - 只保留字典内存在的条目（未知 id 丢弃，不触发隐藏）；
 *  - 保持页面顺序、去重。
 *
 * @param dict 用于校验条目存在性的字典；缺省内置字典（刷新后的自定义字典可由调用方传入）。
 */
export function parseDetailCategories(
  doc: Document,
  site: CategorySiteId,
  dict: CategoryDictionary = BUILTIN_CATEGORY_DICTIONARY,
): string[] {
  const panels = doc.querySelectorAll('.panel-block');
  const base = doc.baseURI || dict.sources[site]?.base || 'https://javdb.com';
  const found = new Map<string, { dim: DimKey; id: string }>();

  panels.forEach(panel => {
    const strong = panel.querySelector('strong');
    if (!isDetailCategoryPanelLabel(strong?.textContent)) return;

    panel.querySelectorAll('a[href*="/tags?c"]').forEach(link => {
      const href = link.getAttribute('href') || '';
      const pair = extractDimPair(href, base);
      if (!pair) return;
      if (found.has(entryKey(pair.dim, pair.id))) return;
      // 只保留字典内存在的条目；未知条目丢弃
      const exists =
        dict.sources[site]?.dimensions[pair.dim]?.entries.some(entry => entry.id === pair.id) ??
        false;
      if (!exists) return;
      found.set(entryKey(pair.dim, pair.id), pair);
    });
  });

  return [...found.keys()];
}

/**
 * 解析 /tags 页文档（如 /tags?c10=1），产出全量字典数据。
 * 结构：<div id="tags"><dl><dt data-cid="N"><strong>维度名</strong>…<a class="tag" href="/tags?cN=ID…">名</a>
 * 仅收录字典维度（c1..c7/c9）；c10 基本 / c11 年份等保留位跳过。
 * 条目顺序保持页面顺序；appliesToUrl 按维度保守默认（c1/c4/c7 = true）。
 * 返回 version 取内置字典版本（刷新计数器在存储层，见 videoCategoryDictionary 记录）。
 */
export function parseTagsPageCategories(doc: Document, site: CategorySiteId): CategoryDictionary {
  const base = doc.baseURI || BUILTIN_CATEGORY_DICTIONARY.sources[site]?.base || 'https://javdb.com';
  const container = doc.querySelector('#tags') ?? doc;
  const dimensions: Partial<Record<DimKey, { label: string; entries: CategoryEntry[] }>> = {};
  const order: DimKey[] = [];

  container.querySelectorAll('dt[data-cid]').forEach(dt => {
    const cid = dt.getAttribute('data-cid') || '';
    const dim = `c${cid}` as DimKey;
    if (!isDimKey(dim)) return; // 跳过 c10/c11 等
    const label = (dt.querySelector('strong')?.textContent || '').trim();
    const seen = new Set<string>();
    const entries: CategoryEntry[] = [];
    dt.querySelectorAll('a[href*="/tags?c"]').forEach(link => {
      const href = link.getAttribute('href') || '';
      const pair = extractDimPair(href, base);
      if (!pair || pair.dim !== dim) return;
      if (seen.has(pair.id)) return;
      const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      seen.add(pair.id);
      entries.push({ id: pair.id, label: text, appliesToUrl: appliesToUrlDefault(dim) });
    });
    if (entries.length === 0) return; // 空维度不收（校验层据此识别异常）
    dimensions[dim] = { label, entries };
    order.push(dim);
  });

  // 展示顺序对齐内置字典的 dimensionOrder（缺失维度跳过）
  const builtinOrder = BUILTIN_CATEGORY_DICTIONARY.sources[site]?.dimensionOrder ?? [];
  const dimensionOrder = builtinOrder.filter(dim => dimensions[dim]);
  const rest = order.filter(dim => !dimensionOrder.includes(dim));
  dimensionOrder.push(...rest);

  return {
    version: BUILTIN_CATEGORY_DICTIONARY.version,
    sources: {
      [site]: { base, dimensions, dimensionOrder },
    } as Record<CategorySiteId, CategorySource>,
    activeSite: site,
  };
}

/** appliesToUrl 保守默认：c1/c4/c7 已实测可用于演员作品列表 URL。 */
function appliesToUrlDefault(dim: DimKey): boolean {
  return dim === 'c1' || dim === 'c4' || dim === 'c7';
}

/** 解析入口键工具再导出（供消费方统一从本包取）。 */
export { entryKey, parseEntryKey };
