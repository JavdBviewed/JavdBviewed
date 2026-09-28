/**
 * @file validate.test.ts
 * @description 结构校验：空结果/结构异常不通过（后台刷新拒绝写入的依据）。
 * @module @javdb/video-category-dict
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_CATEGORY_DICTIONARY } from './builtin';
import { validateCategoryDictionary } from './validate';
import type { CategoryDictionary } from './types';

const B = BUILTIN_CATEGORY_DICTIONARY;

function clone(dict: CategoryDictionary): CategoryDictionary {
  return JSON.parse(JSON.stringify(dict)) as CategoryDictionary;
}

describe('validateCategoryDictionary', () => {
  it('内置字典通过', () => {
    expect(validateCategoryDictionary(B).ok).toBe(true);
  });

  it('sources 缺失 → 拒绝', () => {
    expect(validateCategoryDictionary({ version: 1, sources: {} as Record<string, never>, activeSite: 'javdb' }).ok).toBe(false);
  });

  it('activeSite 不存在于 sources → 拒绝', () => {
    const d = clone(B);
    d.activeSite = 'missav';
    expect(validateCategoryDictionary(d).ok).toBe(false);
  });

  it('dimensionOrder 为空 → 拒绝', () => {
    const d = clone(B);
    d.sources.javdb.dimensionOrder = [];
    expect(validateCategoryDictionary(d).ok).toBe(false);
  });

  it('维度 entries 为空 → 拒绝', () => {
    const d = clone(B);
    d.sources.javdb.dimensionOrder = ['c1'];
    d.sources.javdb.dimensions = { c1: { label: '主題', entries: [] } };
    const v = validateCategoryDictionary(d);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.includes('c1'))).toBe(true);
  });

  it('dimensionOrder 引用未定义维度 → 拒绝', () => {
    const d = clone(B);
    d.sources.javdb.dimensionOrder = ['c1'];
    d.sources.javdb.dimensions = {};
    expect(validateCategoryDictionary(d).ok).toBe(false);
  });

  it('非法维度 key（c8/c10）→ 拒绝', () => {
    const d = clone(B);
    d.sources.javdb.dimensionOrder = ['c8' as never];
    d.sources.javdb.dimensions = { c8: { label: 'x', entries: [{ id: '1', label: 'x' }] } } as never;
    expect(validateCategoryDictionary(d).ok).toBe(false);
  });

  it('条目 id 含 "=" 或空 → 拒绝', () => {
    const d = clone(B);
    d.sources.javdb.dimensionOrder = ['c1'];
    d.sources.javdb.dimensions = { c1: { label: '主題', entries: [{ id: '1=2', label: 'x' }] } };
    expect(validateCategoryDictionary(d).ok).toBe(false);
    const d2 = clone(B);
    d2.sources.javdb.dimensionOrder = ['c1'];
    d2.sources.javdb.dimensions = { c1: { label: '主題', entries: [{ id: '', label: 'x' }] } };
    expect(validateCategoryDictionary(d2).ok).toBe(false);
  });

  it('维度内 id 重复 → 拒绝', () => {
    const d = clone(B);
    d.sources.javdb.dimensionOrder = ['c1'];
    d.sources.javdb.dimensions = {
      c1: { label: '主題', entries: [{ id: '23', label: 'a' }, { id: '23', label: 'b' }] },
    };
    const v = validateCategoryDictionary(d);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.includes('重复'))).toBe(true);
  });
});
