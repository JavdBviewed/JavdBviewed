/**
 * @file types.ts
 * @description 影片类别字典类型定义（按站点分组，可扩展多原站）。
 * @module @javdb/video-category-dict
 */

/** 站点 id；已知站点 'javdb'，未来加站点只加数据。 */
export type CategorySiteId = 'javdb' | (string & {});

/** 类别维度 key（JavDB c1..c7 + c9 时长；c8/c10/c11 等为原站保留位，不入字典）。 */
export type DimKey = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c9';

/** 单个类别条目。 */
export interface CategoryEntry {
  /** 原站数字 id（c1..c7）或时长区间码（c9：lt-45 / 45-90 / 90-120 / gt-120）。 */
  id: string;
  /** 原站显示名称（繁体快照）。 */
  label: string;
  /**
   * 该维度的 ?cN= 参数是否经实测可用于演员作品列表 URL（保守默认）。
   * c1/c4/c7 = true（现状演员页/新作品已用）；其余未实测 = false（UI 标注“仅供列表过滤”）。
   */
  appliesToUrl?: boolean;
}

/** 一个维度（如 c1 主題）及其全部条目。 */
export interface CategoryDimension {
  label: string;
  entries: CategoryEntry[];
}

/** 一个站点的字典源（基础域名 + 维度表 + 展示顺序）。 */
export interface CategorySource {
  base: string;
  dimensions: Partial<Record<DimKey, CategoryDimension>>;
  dimensionOrder: DimKey[];
}

/** 顶层字典（按站点分组 + 当前活动站点）。 */
export interface CategoryDictionary {
  /** 字典数据版本（内置 = 1；后台刷新产出同版本数据，存储层另有刷新计数器）。 */
  version: number;
  sources: Record<CategorySiteId, CategorySource>;
  activeSite: CategorySiteId;
}
