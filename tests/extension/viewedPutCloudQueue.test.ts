/**
 * @file viewedPutCloudQueue.test.ts
 * @description viewedPut 云同步待发队列不阻塞数据库写入响应
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('viewedPut cloud pending queue', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../apps/extension/src/platform/storage/indexedDbConnection');
    vi.doUnmock('../../apps/extension/src/features/cloudSync/enqueueLocalChange');
  });

  it('returns after the IndexedDB transaction while cloud enqueue continues in the background', async () => {
    let resolveEnqueue: (() => void) | undefined;
    const enqueueVideoChange = vi.fn(() => new Promise<void>((resolve) => {
      resolveEnqueue = resolve;
    }));
    const scheduleEnqueue = vi.fn((task: () => Promise<void>) => {
      void task().catch(() => undefined);
    });
    const viewedStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const tagStore = { delete: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const listStore = { delete: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const tx = {
      objectStore: vi.fn((name: string) => {
        if (name === 'viewedRecords') return viewedStore;
        if (name === 'viewedByTag') return tagStore;
        return listStore;
      }),
      done: Promise.resolve(),
    };

    vi.doMock('../../apps/extension/src/platform/storage/indexedDbConnection', () => ({
      initDB: vi.fn(async () => ({ transaction: vi.fn(() => tx) })),
    }));
    vi.doMock('../../apps/extension/src/features/cloudSync/enqueueLocalChange', () => ({
      enqueueVideoChange,
      scheduleEnqueue,
    }));

    const { viewedPut } = await import('../../apps/extension/src/platform/storage/indexedDb');
    const result = await viewedPut({
      id: 'PERF-001',
      title: 'Performance record',
      status: 'viewed',
      createdAt: 1,
      updatedAt: 2,
    } as any);

    expect(result).toEqual({ success: true });
    expect(scheduleEnqueue).toHaveBeenCalledTimes(1);
    expect(enqueueVideoChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'PERF-001' }));
    resolveEnqueue?.();
  });
});
