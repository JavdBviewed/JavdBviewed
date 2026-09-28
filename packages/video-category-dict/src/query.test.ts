/**
 * @file query.test.ts
 * @description entryKey/parseEntryKey 往返 + 非法输入。
 * @module @javdb/video-category-dict
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_CATEGORY_DICTIONARY } from './builtin';
import { entryKey, isDimKey, parseEntryKey, resolveEntryKey } from './query';

describe('entryKey / parseEntryKey', () => {
  it('往返：数字 id', () => {
    expect(entryKey('c4', '17')).toBe('c4=17');
    expect(parseEntryKey('c4=17')).toEqual({ dim: 'c4', id: '17' });
    expect(parseEntryKey(entryKey('c7', '330'))).toEqual({ dim: 'c7', id: '330' });
  });

  it('往返：c9 区间码 id（含 - 与 .）', () => {
    expect(parseEntryKey(entryKey('c9', 'lt-45'))).toEqual({ dim: 'c9', id: 'lt-45' });
    expect(parseEntryKey('c9=45-90')).toEqual({ dim: 'c9', id: '45-90' });
  });

  it('非法输入返回 null', () => {
    expect(parseEntryKey('')).toBeNull();
    expect(parseEntryKey('c4')).toBeNull();
    expect(parseEntryKey('c4=')).toBeNull();
    expect(parseEntryKey('=17')).toBeNull();
    expect(parseEntryKey('c10=1')).toBeNull(); // 保留位维度
    expect(parseEntryKey('c8=5')).toBeNull();
    expect(parseEntryKey('c1x=5')).toBeNull();
    expect(parseEntryKey('c1=5=c2')).toBeNull(); // 多等号 → id 含 '=' 仍返回? 断言语义
  });

  it('isDimKey 边界', () => {
    expect(isDimKey('c1')).toBe(true);
    expect(isDimKey('c9')).toBe(true);
    expect(isDimKey('c8')).toBe(false);
    expect(isDimKey('c10')).toBe(false);
    expect(isDimKey('d1')).toBe(false);
  });
});


describe('resolveEntryKey', () => {
  const DICT = BUILTIN_CATEGORY_DICTIONARY;
  const SITE = DICT.activeSite;

  it('entryKey 原样归一（字典内）', () => {
    expect(resolveEntryKey(DICT, SITE, 'c4=17')).toBe('c4=17');
    expect(resolveEntryKey(DICT, SITE, 'c7=330')).toBe('c7=330');
  });

  it('裸数字 id 跨维度反查归一', () => {
    expect(resolveEntryKey(DICT, SITE, '17')).toBe('c4=17');
    expect(resolveEntryKey(DICT, SITE, '28')).toBe('c7=28');
    expect(resolveEntryKey(DICT, SITE, '157')).toBe('c1=157');
  });

  it('空白/未知/非法 → null', () => {
    expect(resolveEntryKey(DICT, SITE, '')).toBeNull();
    expect(resolveEntryKey(DICT, SITE, '   ')).toBeNull();
    expect(resolveEntryKey(DICT, SITE, '999999')).toBeNull(); // 字典外数字
    expect(resolveEntryKey(DICT, SITE, 'c4=999999')).toBeNull(); // 字典内维度、字典外 id
    expect(resolveEntryKey(DICT, SITE, 's')).toBeNull(); // t 码不是类别
    expect(resolveEntryKey(DICT, SITE, 'c10=1')).toBeNull(); // 保留位维度
  });
});
