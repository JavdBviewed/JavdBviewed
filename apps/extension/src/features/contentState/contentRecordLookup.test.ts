/**
 * @file contentRecordLookup.test.ts
 * @description getContentRecord 精确键优先 + 大小写折叠兜底（欧美混合大小写号，issue#51）
 * @module features/contentState
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { VideoRecord } from '../../types';
import { STATE, getContentRecord, setContentRecord, setContentRecordSummary } from './index';

function makeRecord(id: string, status: VideoRecord['status'] = 'browsed'): VideoRecord {
  return {
    id,
    url: `https://example.com/v/${id}`,
    videoCode: id,
    title: `title-${id}`,
    status,
    lastViewedAt: 1,
    viewedCount: 1,
    firstViewedAt: 1,
    isFavorite: false,
  };
}

describe('getContentRecord 大小写折叠兜底', () => {
  beforeEach(() => {
    STATE.records = {};
    STATE.recordSummaries = {};
  });

  it('精确键命中优先（大小写敏感直查不变）', () => {
    setContentRecord(makeRecord('SSIS-0123', 'viewed'));
    expect(getContentRecord('SSIS-0123')?.id).toBe('SSIS-0123');
    expect(getContentRecord('ssis-0123')?.id).toBe('SSIS-0123');
    expect(getContentRecord('NOPE-9999')).toBeUndefined();
  });

  it('混合大小写查询键折叠命中完整记录（详情页大写键 vs 列表原文键）', () => {
    setContentRecord(makeRecord('RKPRIME.26.10.01', 'browsed'));
    const hit = getContentRecord('RKPrime.26.10.01');
    expect(hit?.id).toBe('RKPRIME.26.10.01');
    expect(hit?.status).toBe('browsed');
  });

  it('仅轻量摘要时也折叠命中', () => {
    setContentRecordSummary({ id: 'RKPRIME.26.10.01', status: 'want', isFavorite: false });
    const hit = getContentRecord('rkprime.26.10.01');
    expect(hit?.id).toBe('RKPRIME.26.10.01');
    expect(hit?.status).toBe('want');
  });

  it('完整记录优先于折叠摘要', () => {
    setContentRecord(makeRecord('RKPRIME.26.10.01', 'browsed'));
    setContentRecordSummary({ id: 'RKPrime.26.10.01', status: 'want', isFavorite: true });
    // 查询键与摘要键完全一致 → 精确命中摘要（既有语义不变）
    expect(getContentRecord('RKPrime.26.10.01')?.status).toBe('want');
    // 查询键与记录键大小写差异 → 折叠命中记录
    expect(getContentRecord('RKprime.26.10.01')?.status).toBe('browsed');
  });

  it('无任何匹配时返回 undefined', () => {
    setContentRecord(makeRecord('SSIS-0123'));
    expect(getContentRecord('RKPrime.26.10.01')).toBeUndefined();
    expect(getContentRecord('')).toBeUndefined();
  });
});
