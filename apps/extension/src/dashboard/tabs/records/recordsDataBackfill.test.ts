/**
 * @file recordsDataBackfill.test.ts
 * @description 10-08 扩项（288）：全量滤路径数据源一次性回填守卫。
 * IDB 非空（主用户态，285 补迁后）→ 全量读 IDB 整体覆写 STATE.records；
 * IDB 空 → no-op（legacy bootstrap 数组有效，防误伤）；一次性/并发共享/失败重试语义。
 * @module unit
 */
import { describe, expect, it, vi } from 'vitest';
import type { VideoRecord } from '../../../types';
import { createRecordsDataBackfill } from './recordsDataBackfill';

const rec = (id: string, extra: Partial<VideoRecord> = {}): VideoRecord => ({
  id,
  title: 'Probe ' + id,
  status: 'viewed',
  createdAt: 1000,
  updatedAt: 1000,
  ...extra,
});

function makeDeps(overrides: {
  count?: number | Promise<number>;
  pages?: Array<{ items: VideoRecord[]; total: number }>;
} = {}) {
  const all = [rec('R-001'), rec('R-002'), rec('R-003')];
  const dbViewedCount = vi.fn(async () => (typeof overrides.count === 'number' ? overrides.count : 3));
  let pageIdx = 0;
  const dbViewedQueryAll = vi.fn(async (limit: number) => {
    const scripted = overrides.pages && overrides.pages[pageIdx];
    pageIdx += 1;
    if (scripted) return scripted;
    return { items: all.slice(0, Math.min(limit, all.length)), total: all.length };
  });
  const setRecords = vi.fn();
  const onError = vi.fn();
  return { all, dbViewedCount, dbViewedQueryAll, setRecords, onError };
}

describe('createRecordsDataBackfill（10-08 扩项：全量滤数据源回填，288）', () => {
  it('IDB 空（count=0）→ no-op：不查询、不覆写（legacy bootstrap 数组保持有效）', async () => {
    const d = makeDeps({ count: 0 });
    const bf = createRecordsDataBackfill({ ...d, onError: d.onError });
    await bf.ensureLoaded();
    expect(d.dbViewedCount).toHaveBeenCalledTimes(1);
    expect(d.dbViewedQueryAll).not.toHaveBeenCalled();
    expect(d.setRecords).not.toHaveBeenCalled();
    expect(d.onError).not.toHaveBeenCalled();
    expect(bf.isLoaded()).toBe(true);
  });

  it('IDB 非空 → 全量读（limit=count）→ 整体覆写', async () => {
    const d = makeDeps({ count: 3 });
    const bf = createRecordsDataBackfill({ ...d, onError: d.onError });
    await bf.ensureLoaded();
    expect(d.dbViewedQueryAll).toHaveBeenCalledTimes(1);
    expect(d.dbViewedQueryAll).toHaveBeenCalledWith(3);
    expect(d.setRecords).toHaveBeenCalledTimes(1);
    expect(d.setRecords).toHaveBeenCalledWith(d.all);
    expect(bf.isLoaded()).toBe(true);
  });

  it('total > items.length（count 与查询间新增）→ 防御性二次读（limit=total）', async () => {
    const extra = rec('R-004');
    const d = makeDeps({
      count: 3,
      pages: [
        { items: [rec('R-001'), rec('R-002'), rec('R-003')], total: 4 },
        { items: [rec('R-001'), rec('R-002'), rec('R-003'), extra], total: 4 },
      ],
    });
    const bf = createRecordsDataBackfill({ ...d, onError: d.onError });
    await bf.ensureLoaded();
    expect(d.dbViewedQueryAll).toHaveBeenCalledTimes(2);
    expect(d.dbViewedQueryAll).toHaveBeenLastCalledWith(4);
    expect(d.setRecords).toHaveBeenCalledTimes(1);
    expect(d.setRecords.mock.calls[0][0]).toHaveLength(4);
  });

  it('一次性：二次进入零成本（count 总共只查一次、不覆写第二次）', async () => {
    const d = makeDeps({ count: 3 });
    const bf = createRecordsDataBackfill({ ...d, onError: d.onError });
    await bf.ensureLoaded();
    await bf.ensureLoaded();
    expect(d.dbViewedCount).toHaveBeenCalledTimes(1);
    expect(d.dbViewedQueryAll).toHaveBeenCalledTimes(1);
    expect(d.setRecords).toHaveBeenCalledTimes(1);
  });

  it('并发进入共享同一 in-flight（count/查询/覆写各一次）', async () => {
    let releaseCount: () => void;
    const d = makeDeps({
      count: new Promise<number>((resolve) => { releaseCount = () => resolve(3); }),
    });
    const bf = createRecordsDataBackfill({ ...d, onError: d.onError });
    const p1 = bf.ensureLoaded();
    const p2 = bf.ensureLoaded();
    releaseCount!();
    await Promise.all([p1, p2]);
    expect(d.dbViewedCount).toHaveBeenCalledTimes(1);
    expect(d.dbViewedQueryAll).toHaveBeenCalledTimes(1);
    expect(d.setRecords).toHaveBeenCalledTimes(1);
    expect(bf.isLoaded()).toBe(true);
  });

  it('查询失败 → 吞错（本次进入照常渲染）+ 下一次进入可重试（count 再查一次）', async () => {
    const d = makeDeps({ count: 3 });
    d.dbViewedQueryAll.mockImplementationOnce(async () => { throw new Error('idb down'); });
    const bf = createRecordsDataBackfill({ ...d, onError: d.onError });
    await expect(bf.ensureLoaded()).resolves.toBeUndefined();
    expect(d.onError).toHaveBeenCalledTimes(1);
    expect(d.setRecords).not.toHaveBeenCalled();
    expect(bf.isLoaded()).toBe(false);
    await bf.ensureLoaded();
    expect(d.dbViewedCount).toHaveBeenCalledTimes(2);
    expect(d.setRecords).toHaveBeenCalledTimes(1);
    expect(bf.isLoaded()).toBe(true);
  });

  it('count 调用失败 → 按空处理（no-op、不上抛、不置完成位以便重试）', async () => {
    const d = makeDeps({ count: 3 });
    d.dbViewedCount.mockImplementationOnce(async () => { throw new Error('sw offline'); });
    const bf = createRecordsDataBackfill({ ...d, onError: d.onError });
    await expect(bf.ensureLoaded()).resolves.toBeUndefined();
    expect(d.dbViewedQueryAll).not.toHaveBeenCalled();
    expect(d.setRecords).not.toHaveBeenCalled();
    expect(bf.isLoaded()).toBe(false);
  });
});
