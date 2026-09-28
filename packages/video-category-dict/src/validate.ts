/**
 * @file validate.ts
 * @description 字典结构校验（后台刷新写入前 + 启动读取时兜底）。
 * 坏数据绝不写入存储：校验不过 → 保留内置/当前字典。
 * @module @javdb/video-category-dict
 */
import { isDimKey } from './query';
import type { CategoryDictionary, DimKey } from './types';

export interface DictionaryValidation {
  ok: boolean;
  issues: string[];
}

/** 校验字典结构（非空、维度/条目完整、id 格式）。 */
export function validateCategoryDictionary(dict: CategoryDictionary): DictionaryValidation {
  const issues: string[] = [];

  if (!dict || typeof dict !== 'object') {
    return { ok: false, issues: ['dictionary 不是对象'] };
  }
  if (!dict.sources || typeof dict.sources !== 'object') {
    return { ok: false, issues: ['sources 缺失'] };
  }
  const site = dict.activeSite;
  const source = dict.sources[site];
  if (!site || !source) {
    return { ok: false, issues: [`activeSite "${String(site)}" 在 sources 中不存在`] };
  }
  if (!Array.isArray(source.dimensionOrder) || source.dimensionOrder.length === 0) {
    return { ok: false, issues: ['dimensionOrder 为空'] };
  }

  for (const dim of source.dimensionOrder) {
    if (!isDimKey(dim)) {
      issues.push(`dimensionOrder 含非法维度 "${String(dim)}"`);
      continue;
    }
    const definition = source.dimensions[dim];
    if (!definition) {
      issues.push(`维度 ${dim} 无定义`);
      continue;
    }
    if (!definition.label || typeof definition.label !== 'string') {
      issues.push(`维度 ${dim} label 缺失`);
    }
    if (!Array.isArray(definition.entries) || definition.entries.length === 0) {
      issues.push(`维度 ${dim} entries 为空`);
      continue;
    }
    const ids = new Set<string>();
    for (const entry of definition.entries) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) {
        issues.push(`维度 ${dim} 存在空 id`);
        continue;
      }
      if (entry.id.includes('=')) {
        issues.push(`维度 ${dim} id 含 '=': ${entry.id}`);
        continue;
      }
      if (ids.has(entry.id)) {
        issues.push(`维度 ${dim} id 重复: ${entry.id}`);
      }
      ids.add(entry.id);
      if (!entry.label || typeof entry.label !== 'string') {
        issues.push(`维度 ${dim} id=${entry.id} label 缺失`);
      }
    }
  }

  if (issues.length === 0) {
    const total = source.dimensionOrder.reduce(
      (sum, dim) => sum + (source.dimensions[dim]?.entries.length ?? 0),
      0,
    );
    if (total === 0) issues.push('全部维度条目数为 0');
  }

  return { ok: issues.length === 0, issues };
}
