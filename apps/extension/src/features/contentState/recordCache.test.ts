import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE } from './index';
import { loadContentRecordSummaries } from './recordCache';
import { dbViewedGet, dbViewedStatusGetMany } from '../../platform/storage/dbRuntimeClient';

vi.mock('../../platform/storage/dbRuntimeClient', () => ({
  dbViewedGet: vi.fn(),
  dbViewedStatusGetMany: vi.fn(),
}));

describe('内容页记录缓存', () => {
  beforeEach(() => {
    STATE.records = {};
    STATE.recordSummaries = {};
    vi.mocked(dbViewedGet).mockReset();
    vi.mocked(dbViewedStatusGetMany).mockReset();
  });

  it('只批量读取当前页面番号的轻量摘要，不读取完整 viewed 对象', async () => {
    vi.mocked(dbViewedStatusGetMany).mockResolvedValue([
      { id: 'ABC-001', status: 'viewed', isFavorite: true },
    ]);

    await loadContentRecordSummaries(['ABC-001', 'XYZ-002']);

    expect(dbViewedStatusGetMany).toHaveBeenCalledWith(['ABC-001', 'XYZ-002']);
    expect(dbViewedGet).not.toHaveBeenCalled();
    expect(STATE.recordSummaries).toMatchObject({
      'ABC-001': { id: 'ABC-001', status: 'viewed', isFavorite: true },
      'XYZ-002': { id: 'XYZ-002', status: 'untracked', isFavorite: false },
    });
    expect(STATE.records).toEqual({});
  });

  it('对已缓存番号不重复请求，避免 MutationObserver/设置刷新放大查询', async () => {
    STATE.recordSummaries['ABC-001'] = { id: 'ABC-001', status: 'viewed', isFavorite: false };

    await loadContentRecordSummaries(['ABC-001']);

    expect(dbViewedStatusGetMany).not.toHaveBeenCalled();
  });
});

