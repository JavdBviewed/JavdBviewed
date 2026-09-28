/**
 * @file query.ts
 * @description 字典查询纯函数（entryKey 编解码 / 维度与条目查找）。
 * @module @javdb/video-category-dict
 */
import type {
  CategoryDictionary,
  CategoryDimension,
  CategoryEntry,
  CategorySiteId,
  DimKey,
} from './types';

const DIM_KEYS: readonly DimKey[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c9'];

/** 全部合法维度 key。 */
export const CATEGORY_DIM_KEYS = DIM_KEYS;

/** 判断字符串是否为合法 DimKey。 */
export function isDimKey(value: string): value is DimKey {
  return (DIM_KEYS as readonly string[]).includes(value);
}

/** 取某站点某维度的定义（不存在返回 undefined）。 */
export function getDimension(
  dict: CategoryDictionary,
  site: CategorySiteId,
  dim: DimKey,
): CategoryDimension | undefined {
  return dict.sources[site]?.dimensions[dim];
}

/** 取某站点某维度某 id 的条目（不存在返回 undefined）。 */
export function findEntry(
  dict: CategoryDictionary,
  site: CategorySiteId,
  dim: DimKey,
  id: string,
): CategoryEntry | undefined {
  return getDimension(dict, site, dim)?.entries.find(entry => entry.id === id);
}

/** 条目键：`c4=17` 形式（存储/URL 通用）。 */
export function entryKey(dim: DimKey, id: string): string {
  return `${dim}=${id}`;
}

/** 解析条目键；非法输入返回 null。 */
export function parseEntryKey(key: string): { dim: DimKey; id: string } | null {
  const idx = key.indexOf('=');
  if (idx <= 0) return null;
  const dim = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (!isDimKey(dim)) return null;
  if (!id || id.includes('=')) return null;
  return { dim, id };
}

/**
 * 按数字/区间 id 反查所属维度（用于旧数据迁移：旧值只有数字 id 无维度前缀）。
 * 数字 id 跨维度唯一，命中即返回；未命中返回 null。
 */
export function findDimensionById(
  dict: CategoryDictionary,
  site: CategorySiteId,
  id: string,
): DimKey | null {
  const source = dict.sources[site];
  if (!source) return null;
  for (const dim of source.dimensionOrder) {
    const entries = source.dimensions[dim]?.entries;
    if (entries?.some(entry => entry.id === id)) return dim;
  }
  return null;
}

/**
 * 把存储/遗留值归一为字典内 entryKey：
 * - 已是 entryKey（`c4=17`）且条目存在 → 原样返回
 * - 裸数字 id 且跨维度唯一命中 → `维度=id`
 * - 其余（空串/未知 id/非法形式）→ null
 * 供演员默认值迁移与新作品黑白名单归一复用。
 */
export function resolveEntryKey(
  dict: CategoryDictionary,
  site: CategorySiteId,
  value: string,
): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return null;
  const parsed = parseEntryKey(v);
  if (parsed) {
    return findEntry(dict, site, parsed.dim, parsed.id) ? entryKey(parsed.dim, parsed.id) : null;
  }
  if (/^\d+$/.test(v)) {
    const dim = findDimensionById(dict, site, v);
    return dim ? entryKey(dim, v) : null;
  }
  return null;
}

/** 某站点全部条目的 entryKey 集合（供 UI 校验选中值合法性）。 */
export function allEntryKeys(dict: CategoryDictionary, site: CategorySiteId): Set<string> {
  const keys = new Set<string>();
  const source = dict.sources[site];
  if (!source) return keys;
  for (const dim of source.dimensionOrder) {
    for (const entry of source.dimensions[dim]?.entries ?? []) {
      keys.add(entryKey(dim, entry.id));
    }
  }
  return keys;
}
