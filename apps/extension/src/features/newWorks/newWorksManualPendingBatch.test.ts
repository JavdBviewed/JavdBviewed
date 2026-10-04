/**
 * @file newWorksManualPendingBatch.test.ts
 * @description 10-19：手动扫描「收集-确认-入库」pending 批次持久化 store 单测（纯 DI，无 chrome 依赖）：
 *              终态持久化（fetch 回读逐字）/ 空 works 不落盘 / 超阈值跳过 + log /
 *              新批次覆盖旧批次（log 登记，不合并）/ consume 清盘（幂等）/ 损坏形状防御（fetch=null）。
 * @module features/newWorks
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createManualPendingBatchStore,
  MAX_MANUAL_PENDING_BATCH_WORKS,
  MANUAL_PENDING_BATCH_KEY,
  type ManualPendingBatch,
} from './newWorksManualPendingBatch';

function makeStorage() {
  const map = new Map<string, unknown>();
  return {
    map,
    get: vi.fn(async (key: string) => (map.has(key) ? map.get(key) : null)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) map.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      map.delete(key);
    }),
  };
}

function makeWork(index: number) {
  return {
    id: `CODE${index}`,
    actorId: 'A1',
    actorName: '演员一',
    title: `作品 ${index}`,
    javdbUrl: `https://example.com/v/CODE${index}`,
    tags: [],
    discoveredAt: 1700000000000 + index,
    isRead: false,
  };
}

function makeBatch(overrides: Partial<ManualPendingBatch> = {}): ManualPendingBatch {
  return {
    status: 'done',
    startedAt: 1000,
    terminalAt: 2000,
    pendingCount: 2,
    identifiedTotal: 3,
    existingCount: 1,
    breakdown: { dateRange: 0, viewed: 1, browsed: 0, want: 0, ar: 0, categoryBlack: 0 },
    works: [makeWork(1), makeWork(2)],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createManualPendingBatchStore', () => {
  it('终态持久化：fetch 回读 works 逐字 + 批次元信息完整', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    const batch = makeBatch();

    const result = await store.save(batch);

    expect(result).toBe('saved');
    expect(storage.set).toHaveBeenCalledWith({ [MANUAL_PENDING_BATCH_KEY]: expect.objectContaining({ works: batch.works }) });
    const fetched = await store.fetch();
    expect(fetched).not.toBeNull();
    expect(fetched!.works).toEqual(batch.works);
    expect(fetched!.status).toBe('done');
    expect(fetched!.startedAt).toBe(1000);
    expect(fetched!.terminalAt).toBe(2000);
    expect(fetched!.pendingCount).toBe(2);
    expect(fetched!.identifiedTotal).toBe(3);
    expect(fetched!.existingCount).toBe(1);
    expect(fetched!.breakdown).toEqual(batch.breakdown);
  });

  it('cancelled 终态形状同样落盘', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    await store.save(makeBatch({ status: 'cancelled' }));
    const fetched = await store.fetch();
    expect(fetched!.status).toBe('cancelled');
  });

  it('fetch 只读：连续两次 fetch 均返回批次（不消费）', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    await store.save(makeBatch());
    const first = await store.fetch();
    const second = await store.fetch();
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it('空 works：防御性不落盘（skipped-empty），fetch=null', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });

    const result = await store.save(makeBatch({ works: [], pendingCount: 0 }));

    expect(result).toBe('skipped-empty');
    expect(storage.set).not.toHaveBeenCalled();
    await expect(store.fetch()).resolves.toBeNull();
  });

  it('超阈值：跳过持久化 + log，fetch=null（保持现状：仅摘要 toast）', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const works = Array.from({ length: MAX_MANUAL_PENDING_BATCH_WORKS + 1 }, (_, i) => makeWork(i));

    const result = await store.save(makeBatch({ works, pendingCount: works.length }));

    expect(result).toBe('skipped-over-threshold');
    expect(storage.set).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    await expect(store.fetch()).resolves.toBeNull();
  });

  it('阈值边界：恰好 MAX 条正常落盘', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    const works = Array.from({ length: MAX_MANUAL_PENDING_BATCH_WORKS }, (_, i) => makeWork(i));

    const result = await store.save(makeBatch({ works, pendingCount: works.length }));

    expect(result).toBe('saved');
    expect((await store.fetch())!.works).toHaveLength(MAX_MANUAL_PENDING_BATCH_WORKS);
  });

  it('新批次覆盖旧批次：不合并、整体替换 + log 登记', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const oldBatch = makeBatch({ terminalAt: 2000, works: [makeWork(1)] });
    const newBatch = makeBatch({
      terminalAt: 3000,
      status: 'cancelled',
      works: [makeWork(9), makeWork(10), makeWork(11)],
      pendingCount: 3,
      identifiedTotal: 9,
    });

    await store.save(oldBatch);
    const result = await store.save(newBatch);

    expect(result).toBe('saved');
    expect(logSpy).toHaveBeenCalled(); // 覆盖登记
    const fetched = await store.fetch();
    expect(fetched!.terminalAt).toBe(3000);
    expect(fetched!.status).toBe('cancelled');
    expect(fetched!.works).toEqual(newBatch.works); // 不合并：旧 works 不残留
    expect(fetched!.pendingCount).toBe(3);
  });

  it('consume 清盘：清后 fetch=null', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    await store.save(makeBatch());

    await store.consume();

    await expect(store.fetch()).resolves.toBeNull();
    expect(storage.remove).toHaveBeenCalledWith(MANUAL_PENDING_BATCH_KEY);
  });

  it('consume 幂等：无批次时不抛', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    await expect(store.consume()).resolves.toBeUndefined();
    await expect(store.fetch()).resolves.toBeNull();
  });

  it('consume 后重新 save：新批次正常回读（清盘不留副作用）', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    await store.save(makeBatch());
    await store.consume();
    await store.save(makeBatch({ terminalAt: 9000 }));
    expect((await store.fetch())!.terminalAt).toBe(9000);
  });

  it('损坏形状防御：缺 works 数组 / 非法 status → fetch=null', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });

    storage.map.set(MANUAL_PENDING_BATCH_KEY, { status: 'done', works: 'not-array' });
    await expect(store.fetch()).resolves.toBeNull();

    storage.map.set(MANUAL_PENDING_BATCH_KEY, { status: 'weird', works: [makeWork(1)] });
    await expect(store.fetch()).resolves.toBeNull();

    storage.map.set(MANUAL_PENDING_BATCH_KEY, { works: [makeWork(1)] });
    await expect(store.fetch()).resolves.toBeNull();
  });

  it('works 内混入非法条目：过滤掉（无 id / 非对象），合法条目逐字保留', async () => {
    const storage = makeStorage();
    const store = createManualPendingBatchStore({ storage });
    const good = makeWork(1);

    const result = await store.save(makeBatch({ works: [{}, { id: '' }, null as any, good, 'x' as any] as any, pendingCount: 5 }));

    expect(result).toBe('saved');
    const fetched = await store.fetch();
    expect(fetched!.works).toEqual([good]);
    expect(fetched!.pendingCount).toBe(1); // 以过滤后实际条数为准
  });
});
