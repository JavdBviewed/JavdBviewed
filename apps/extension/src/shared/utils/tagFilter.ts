/**
 * 通用标签过滤工具
 * 用于过滤掉没有价值的标签
 */

import type { VideoRecord } from '../../types';

// 无价值标签列表（可配置）
const MEANINGLESS_TAGS = [
  '是',
  '否',
  '我看過這部影片',
  '單體作品',
  '影片',
];

// 无价值标签的关键词（包含这些关键词的标签会被过滤）
const MEANINGLESS_KEYWORDS = [
  'import',
];

/**
 * 判断标签是否有价值
 * @param tagName 标签名称
 * @returns true 表示有价值，false 表示无价值
 */
export function isValueableTag(tagName: string): boolean {
  if (!tagName || typeof tagName !== 'string') return false;
  
  const name = tagName.trim();
  if (!name) return false;
  
  // 检查是否在无价值列表中
  if (MEANINGLESS_TAGS.includes(name)) return false;
  
  // 检查是否包含无价值关键词
  const nameLower = name.toLowerCase();
  for (const keyword of MEANINGLESS_KEYWORDS) {
    if (nameLower.includes(keyword.toLowerCase())) return false;
  }
  
  return true;
}

/**
 * 过滤标签数组
 * @param tags 标签数组
 * @returns 过滤后的标签数组
 */
export function filterValueableTags(tags: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter(isValueableTag);
}

/**
 * 过滤标签统计结果
 * @param tagStats 标签统计数组 { name: string, count: number }[]
 * @returns 过滤后的标签统计数组
 */
export function filterValueableTagStats<T extends { name: string }>(tagStats: T[]): T[] {
  if (!Array.isArray(tagStats)) return [];
  return tagStats.filter(item => isValueableTag(item.name));
}
/** 详情页增强来源入口曾被误写入标签，这里集中维护历史数据清理名单。 */
export const INJECTED_DETAIL_SOURCE_TAGS = ['Wiki', 'xslist', '98堂', '迅雷字幕'] as const;

export interface InjectedSourceTagCleanupResult {
  record: VideoRecord;
  changed: boolean;
  tagsRemoved: number;
  categoriesRemoved: number;
  removedTagNames: string[];
}

function normalizeCleanupTagName(tagName: string): string {
  return String(tagName || '').trim().toLowerCase();
}

function removeInjectedSourceNames(values: string[] | undefined, blockedNames: Set<string>): { values: string[] | undefined; removed: number; removedNames: string[] } {
  if (!Array.isArray(values)) {
    return { values, removed: 0, removedNames: [] };
  }

  const nextValues: string[] = [];
  const removedNames: string[] = [];
  let removed = 0;
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && blockedNames.has(normalizeCleanupTagName(text))) {
      removed += 1;
      removedNames.push(text);
      continue;
    }
    nextValues.push(value);
  }

  return { values: nextValues, removed, removedNames };
}

function uniqueRemovedTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const key = normalizeCleanupTagName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/**
 * 清理单条视频记录中由详情页增强入口误写入的来源标签。
 *
 * @param record - 待检查的视频记录
 * @param nowMs - 写入清理结果时使用的 Unix 毫秒时间戳
 * @param injectedSourceTags - 允许覆盖的来源污染标签名单，测试或未来迁移可传入
 * @returns 清理后的记录与移除统计；没有变化时返回原记录引用
 */
export function cleanVideoRecordInjectedSourceTags(
  record: VideoRecord,
  nowMs: number = Date.now(),
  injectedSourceTags: readonly string[] = INJECTED_DETAIL_SOURCE_TAGS,
): InjectedSourceTagCleanupResult {
  const blockedNames = new Set(injectedSourceTags.map(normalizeCleanupTagName).filter(Boolean));
  const tags = removeInjectedSourceNames(record.tags, blockedNames);
  const categories = removeInjectedSourceNames(record.categories, blockedNames);
  const changed = tags.removed > 0 || categories.removed > 0;

  if (!changed) {
    return {
      record,
      changed: false,
      tagsRemoved: 0,
      categoriesRemoved: 0,
      removedTagNames: [],
    };
  }

  return {
    record: {
      ...record,
      tags: tags.values,
      categories: categories.values,
      updatedAt: nowMs,
    },
    changed: true,
    tagsRemoved: tags.removed,
    categoriesRemoved: categories.removed,
    removedTagNames: uniqueRemovedTagNames([...tags.removedNames, ...categories.removedNames]),
  };
}
