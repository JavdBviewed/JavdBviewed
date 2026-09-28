/**
 * @file query.test.ts
 * @description entryKey/parseEntryKey 往返 + 非法输入。
 * @module @javdb/video-category-dict
 */
import { describe, expect, it } from 'vitest';
import { entryKey, isDimKey, parseEntryKey } from './query';

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
