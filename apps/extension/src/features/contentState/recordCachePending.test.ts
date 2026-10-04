/**
 * @file recordCachePending.test.ts
 * @description 09-29-liststatus-recompute-fix：'untracked' 占位摘要的 pending 契约。
 *
 * 占位摘要只是查询去重手段，不是终态：真实摘要落地前它不得被用于定型卡片显隐
 * （否则滚动补卡批次的 hideViewed/hideBrowsed/hideWant 会永久漏网）。
 * @module features/contentState
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewedStatusSummary } from '../../types';
import { STATE } from './index';
import {
  isContentRecordSummaryPending,
  loadContentRecordSummaries,
  pickPendingContentRecordIds,
  waitForContentRecordSummaries,
} from './recordCache';
import { dbViewedGet, dbViewedStatusGetMany, dbViewedStatusGetManyFolded } from '../../platform/storage/dbRuntimeClient';

vi.mock('../../platform/storage/dbRuntimeClient', () => ({
  dbViewedGet: vi.fn(),
  dbViewedStatusGetMany: vi.fn(),
  dbViewedStatusGetManyFolded: vi.fn(),
}));

describe('内容页记录摘要占位（pending）契约', () => {
  let resolveDb: ((summaries: ViewedStatusSummary[]) => void) | null = null;

  beforeEach(() => {
    STATE.records = {};
    STATE.recordSummaries = {};
    resolveDb = null;
    vi.mocked(dbViewedGet).mockReset();
    vi.mocked(dbViewedStatusGetMany).mockReset();
    vi.mocked(dbViewedStatusGetManyFolded).mockResolvedValue([]);
  });

  it('占位写入即登记 pending，真实摘要落地后解除且等待方被放行', async () => {
    vi.mocked(dbViewedStatusGetMany).mockImplementation(
      () => new Promise<ViewedStatusSummary[]>((resolve) => { resolveDb = resolve; }),
    );

    const loading = loadContentRecordSummaries(['PEND-001', 'PEND-002']);

    // 同步段（await IDB 之前）：占位已写、pending 已登记 —— 这正是竞态窗口的起点
    expect(STATE.recordSummaries['PEND-001']).toMatchObject({ status: 'untracked' });
    expect(isContentRecordSummaryPending('PEND-001')).toBe(true);
    expect(pickPendingContentRecordIds(['PEND-001', 'PEND-002', 'OTHER-003']))
      .toEqual(['PEND-001', 'PEND-002']);

    let waited = false;
    const waiting = waitForContentRecordSummaries(['PEND-001']).then(() => { waited = true; });
    await Promise.resolve();
    expect(waited).toBe(false);

    resolveDb?.([{ id: 'PEND-001', status: 'want', isFavorite: false }]);
    await loading;
    await waiting;

    expect(waited).toBe(true);
    expect(isContentRecordSummaryPending('PEND-001')).toBe(false);
    expect(isContentRecordSummaryPending('PEND-002')).toBe(false);
    expect(STATE.recordSummaries['PEND-001']).toMatchObject({ status: 'want' });
    // 库中无记录者保留占位（查询去重语义不变），但已不是 pending
    expect(STATE.recordSummaries['PEND-002']).toMatchObject({ status: 'untracked' });
  });

  it('加载失败也解除 pending：等待方不会永久挂起', async () => {
    vi.mocked(dbViewedStatusGetMany).mockRejectedValueOnce(new Error('idb unavailable'));

    await expect(loadContentRecordSummaries(['ERR-001'])).rejects.toThrow('idb unavailable');

    expect(isContentRecordSummaryPending('ERR-001')).toBe(false);
    await waitForContentRecordSummaries(['ERR-001']);
  });

  it('已缓存番号不触发加载也不登记 pending（不放大查询）', async () => {
    STATE.recordSummaries['CACHED-1'] = { id: 'CACHED-1', status: 'viewed', isFavorite: false };

    await loadContentRecordSummaries(['CACHED-1']);

    expect(dbViewedStatusGetMany).not.toHaveBeenCalled();
    expect(isContentRecordSummaryPending('CACHED-1')).toBe(false);
    await waitForContentRecordSummaries(['CACHED-1']);
  });
});
