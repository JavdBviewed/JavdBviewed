/**
 * @file builtin.test.ts
 * @description 内置字典完整性：311 项计数 / 数字 id 跨维度唯一 / 结构校验。
 * @module @javdb/video-category-dict
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_CATEGORY_DICTIONARY } from './builtin';
import { allEntryKeys, findDimensionById, getDimension } from './query';
import { validateCategoryDictionary } from './validate';

const DICT = BUILTIN_CATEGORY_DICTIONARY;
const SITE = 'javdb' as const;

const EXPECTED_COUNTS: Record<string, number> = {
  c1: 60,
  c2: 53,
  c3: 39,
  c4: 20,
  c5: 40,
  c6: 37,
  c7: 58,
  c9: 4,
};

describe('BUILTIN_CATEGORY_DICTIONARY', () => {
  it('JavDB 全量 311 项（c1..c7 + c9）按维度计数', () => {
    const source = DICT.sources[SITE];
    expect(source).toBeDefined();
    expect(DICT.activeSite).toBe(SITE);
    let total = 0;
    for (const [dim, expected] of Object.entries(EXPECTED_COUNTS)) {
      const def = getDimension(DICT, SITE, dim as never);
      expect(def, `维度 ${dim} 缺失`).toBeDefined();
      expect(def!.entries.length, `${dim} 项数`).toBe(expected);
      total += expected;
    }
    expect(total).toBe(311);
    expect(source.dimensionOrder).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c9']);
    expect(allEntryKeys(DICT, SITE).size).toBe(311);
  });

  it('数字 id 跨维度唯一（c1..c7 共 307 个）', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const dim of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'] as const) {
      for (const entry of getDimension(DICT, SITE, dim)!.entries) {
        expect(/^[0-9]+$/.test(entry.id), `${dim}/${entry.id} 应为数字 id`).toBe(true);
        const prev = seen.get(entry.id);
        if (prev) dups.push(`${entry.id}(${prev} vs ${dim})`);
        else seen.set(entry.id, dim);
      }
    }
    expect(dups).toEqual([]);
    expect(seen.size).toBe(307);
  });

  it('c9 为时长区间码（非数字）', () => {
    const c9 = getDimension(DICT, SITE, 'c9')!;
    expect(c9.entries.map(e => e.id)).toEqual(['lt-45', '45-90', '90-120', 'gt-120']);
  });

  it('appliesToUrl：c1/c4/c7 全 true，其余全 false', () => {
    for (const dim of ['c1', 'c4', 'c7'] as const) {
      for (const entry of getDimension(DICT, SITE, dim)!.entries) {
        expect(entry.appliesToUrl).toBe(true);
      }
    }
    for (const dim of ['c2', 'c3', 'c5', 'c6', 'c9'] as const) {
      for (const entry of getDimension(DICT, SITE, dim)!.entries) {
        expect(entry.appliesToUrl).toBe(false);
      }
    }
  });

  it('数字 id 可反查维度（旧数据迁移依赖）', () => {
    expect(findDimensionById(DICT, SITE, '28')).toBe('c7'); // 單體作品
    expect(findDimensionById(DICT, SITE, '17')).toBe('c4'); // 巨乳
    expect(findDimensionById(DICT, SITE, '157')).toBe('c1'); // 白天出軌
    expect(findDimensionById(DICT, SITE, '999999')).toBeNull();
    expect(findDimensionById(DICT, SITE, 's')).toBeNull();
  });

  it('通过结构校验（ok=true）', () => {
    expect(validateCategoryDictionary(DICT).ok).toBe(true);
  });

  it('旧 24 项字典全部 id 均在新字典中', () => {
    const legacyIds = [
      '28', '17', '18', '37', '72', '14', '45', '68', '80', '110', '160', '190', '312', '330',
      '32', '26', '47', '48', '71', '135', '157', '200', '23',
    ];
    for (const id of legacyIds) {
      expect(findDimensionById(DICT, SITE, id), `旧 id ${id} 未命中`).not.toBeNull();
    }
  });
});
