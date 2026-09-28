/**
 * @file index.ts
 * @description @javdb/video-category-dict 公共出口：类型 / 内置字典 / 查询 / 解析 / 校验。
 * 纯数据 + 纯函数，无 chrome 运行时依赖（Document 由调用方传入）。
 * @module @javdb/video-category-dict
 */
export type {
  CategoryDictionary,
  CategoryDimension,
  CategoryEntry,
  CategorySiteId,
  CategorySource,
  DimKey,
} from './types';

export { BUILTIN_CATEGORY_DICTIONARY } from './builtin';

export {
  allEntryKeys,
  CATEGORY_DIM_KEYS,
  entryKey,
  findDimensionById,
  findEntry,
  getDimension,
  isDimKey,
  parseEntryKey,
} from './query';

export { parseDetailCategories, parseTagsPageCategories } from './parse';

export { validateCategoryDictionary, type DictionaryValidation } from './validate';
