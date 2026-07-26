/**
 * @file videoCodeExtractor.test.ts
 * @description 页面文本番号提取测试 —— 验证多格式、噪声文本和误识别控制
 * @module shared/utils
 */
import { describe, expect, it } from 'vitest';
import {
  extractVideoCodesFromText,
  getFirstVideoCodeFromText,
  normalizeVideoCodeCandidate,
  type ExtractedVideoCode,
} from './videoCodeExtractor';

function values(items: ExtractedVideoCode[], key: keyof ExtractedVideoCode): string[] {
  return items.map(item => String(item[key]));
}

describe('videoCodeExtractor', () => {
  it('提取并标准化标准有码番号', () => {
    const result = extractVideoCodesFromText('推荐 SSIS-123，ssis123 其实是同一部，另有 SSIS-123C');

    expect(values(result, 'normalized')).toEqual(['SSIS-123', 'SSIS-123C']);
    expect(values(result, 'display')).toEqual(['SSIS-123', 'SSIS-123C']);
    expect(result[0]).toMatchObject({ raw: 'SSIS-123', kind: 'jav' });
  });

  it('提取 FC2 多种写法并归一到 FC2-PPV', () => {
    const result = extractVideoCodesFromText('fc2-4903984 / FC2PPV4903984 / FC2-PPV-4903985');

    expect(values(result, 'normalized')).toEqual(['FC2-PPV-4903984', 'FC2-PPV-4903985']);
    expect(values(result, 'kind')).toEqual(['fc2', 'fc2']);
  });

  it('提取数字-数字与无码下划线格式', () => {
    const result = extractVideoCodesFromText('经典 011015-780，还有 072625_01 和 1pondo-123456_01');

    expect(values(result, 'normalized')).toEqual(['011015-780', '072625_01', '1PONDO-123456_01']);
    expect(values(result, 'kind')).toEqual(['numeric-dash', 'uncensored', 'uncensored']);
  });

  it('从噪声评论中按首次出现顺序去重', () => {
    const result = extractVideoCodesFromText('看完 abc-001 后再看 ABC001，评论提到 IPX-456；ABC-001 不是第二次命中');

    expect(values(result, 'normalized')).toEqual(['ABC-001', 'IPX-456']);
    expect(result[0].index).toBeLessThan(result[1].index);
  });

  it('默认避免把普通数字、日期和体积误识别为番号', () => {
    const result = extractVideoCodesFromText('2026-07-05 评论 123 条，大小 4096MB，评分 4.9，编号 4903984 没写 FC2');

    expect(result).toEqual([]);
  });

  it('兼容入口可提取纯数字 FC2', () => {
    const result = extractVideoCodesFromText('4903984 FC2 title', { allowStandaloneFc2Number: true });

    expect(values(result, 'normalized')).toEqual(['FC2-PPV-4903984']);
    expect(getFirstVideoCodeFromText('4903984 FC2 title', { allowStandaloneFc2Number: true })?.display).toBe('4903984');
  });

  it('提供单个候选标准化工具', () => {
    expect(normalizeVideoCodeCandidate('abc_001')).toBe('ABC-001');
    expect(normalizeVideoCodeCandidate('390JNT-076')).toBe('390JNT-076');
    expect(normalizeVideoCodeCandidate('FC2PPV4903984')).toBe('FC2-PPV-4903984');
    expect(normalizeVideoCodeCandidate('no code title')).toBeNull();
  });
});
