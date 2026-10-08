/**
 * @file videoRecordSourceRoundTrip.test.ts
 * @description 10-08：同步下行 applyRemote 段 —— 新字段过远端回写整记录替换后存活（零回补）
 *  上行整包（toSyncEntity）见 videoRecordSource.test.ts round-trip 段；
 *  IDB 存储侧为整对象（keyPath:'id'，无 schema 列）见 normalizeViewedRecord 全 spread 锁。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  viewedBulkPut: vi.fn(async () => undefined),
  actorsBulkPut: vi.fn(async () => undefined),
  listsBulkPut: vi.fn(async () => undefined),
  newWorksBulkPut: vi.fn(async () => undefined),
  viewedGet: vi.fn(async () => undefined),
  actorsGet: vi.fn(async () => undefined),
  listsGet: vi.fn(async () => undefined),
  newWorksGet: vi.fn(async () => undefined),
  listsDelete: vi.fn(async () => undefined),
  newWorksDelete: vi.fn(async () => undefined),
  initDB: vi.fn(async () => {
    throw new Error('initDB should not be called');
  }),
}));

vi.mock('../../platform/storage/indexedDb', () => spies);

describe('applyRemote video 分支：sourceType/sourceId 整记录替换存活', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('远端 payload 携带新字段 → 落盘记录逐字保留（含 115 wire 原文）', async () => {
    const { createExtensionEntityStore } = await import('../cloudSync/extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      {
        type: 'video',
        id: 'abc123',
        updatedAt: 1,
        payload: {
          id: 'abc123',
          title: 'T',
          status: 'viewed',
          videoCode: 'ABC-123',
          createdAt: 1,
          updatedAt: 1,
          sourceType: 'm115drive',
          sourceId: 'f9',
        },
      },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    const [records, opts] = spies.viewedBulkPut.mock.calls[0];
    expect(opts).toEqual({ skipCloudEnqueue: true });
    expect(records).toHaveLength(1);
    expect(records[0].sourceType).toBe('m115drive');
    expect(records[0].sourceId).toBe('f9');
    expect(records[0].id).toBe('abc123');
  });

  it('零回补：远端 payload 无新字段（存量旧记录）→ 落盘记录无此二键', async () => {
    const { createExtensionEntityStore } = await import('../cloudSync/extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      {
        type: 'video',
        id: 'old-1',
        updatedAt: 1,
        payload: {
          id: 'old-1',
          title: 'OLD',
          status: 'viewed',
          videoCode: 'OLD-1',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    const [records] = spies.viewedBulkPut.mock.calls[0];
    expect(records).toHaveLength(1);
    expect('sourceType' in records[0]).toBe(false);
    expect('sourceId' in records[0]).toBe(false);
  });
  it('追加派单：progress 三字段与 source 字段同链零剥离（下行整替换 + 零回补同 it 双锁）', async () => {
    const { createExtensionEntityStore } = await import('../cloudSync/extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      {
        type: 'video',
        id: 'prog-1',
        updatedAt: 1,
        payload: {
          id: 'prog-1',
          title: 'P',
          status: 'viewed',
          videoCode: 'PROG-1',
          createdAt: 1,
          updatedAt: 1,
          sourceType: 'jellyfin',
          sourceId: 'jf-7',
          positionMs: 456789,
          durationMs: 888000,
          completed: true,
        },
      },
      {
        type: 'video',
        id: 'prog-old',
        updatedAt: 1,
        payload: {
          id: 'prog-old',
          title: 'PO',
          status: 'viewed',
          videoCode: 'PROG-OLD',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    const recs = spies.viewedBulkPut.mock.calls[0][0];
    const withProg = recs.find((r) => r.id === 'prog-1')!;
    const oldRec = recs.find((r) => r.id === 'prog-old')!;
    expect(withProg.positionMs).toBe(456789);
    expect(withProg.durationMs).toBe(888000);
    expect(withProg.completed).toBe(true);
    expect(withProg.sourceType).toBe('jellyfin');
    expect('positionMs' in oldRec).toBe(false);
    expect('durationMs' in oldRec).toBe(false);
    expect('completed' in oldRec).toBe(false);
  });
});
