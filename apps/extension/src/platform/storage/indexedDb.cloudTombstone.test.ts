/**
 * @file indexedDb.cloudTombstone.test.ts
 * @description C1-1（10-16-cloud-nonsettings-merge-fix）：viewed/actors 软删墓碑必须
 *  ① 抬 updatedAt=now（服务端 updatedAt 毫秒戳 LWW 下确定性最新，防旧活记录覆写墓碑）
 *  ② 入 cloud pending 队列（照 listsDelete 先例：scheduleEnqueue + 对应 enqueue*Change）
 *  ③ 恢复=解除 deletedAt 且抬 updatedAt（S2：恢复需新于 deletedAt）并入队复活实体
 *  既有零行为：record 不存在时零写入零入队。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { initDB, enqueueVideoChange, enqueueVideoChanges, enqueueActorChange, enqueueActorChanges, scheduleEnqueue } = vi.hoisted(() => ({
  initDB: vi.fn(),
  enqueueVideoChange: vi.fn(),
  enqueueVideoChanges: vi.fn(),
  enqueueActorChange: vi.fn(),
  enqueueActorChanges: vi.fn(),
  scheduleEnqueue: vi.fn((task?: () => void) => {
    if (typeof task === 'function') task();
  }),
}));

vi.mock('./indexedDbConnection', () => ({
  initDB,
  resetDBConnection: vi.fn(),
}));

vi.mock('../../features/cloudSync/enqueueLocalChange', () => ({
  enqueueVideoChange,
  enqueueVideoChanges,
  enqueueActorChange,
  enqueueActorChanges,
  scheduleEnqueue,
}));

const T = 1_757_000_000_500;

function makeFakeDb(initial: Record<string, Record<string, unknown>>) {
  const db = { ...initial };
  return {
    get: vi.fn(async (store: string, key: string) => db[store]?.[key]),
    put: vi.fn(async (store: string, value: { id: string }) => {
      db[store] = db[store] || {};
      db[store][value.id] = value;
    }),
  };
}

describe('C1-1 viewed/actors 软删墓碑抬戳+入队（listsDelete 先例对齐）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(T);
  });

  it('viewedDelete: 墓碑 deletedAt=now 且 updatedAt=now，scheduleEnqueue→enqueueVideoChange', async () => {
    const { viewedDelete } = await import('./indexedDb');
    const db = makeFakeDb({
      viewedRecords: { 'ABC-1': { id: 'ABC-1', title: 't', status: 'viewed', createdAt: 1, updatedAt: 100 } },
    });
    initDB.mockResolvedValue(db);

    await viewedDelete('ABC-1');

    expect(db.put).toHaveBeenCalledTimes(1);
    const putArg = db.put.mock.calls[0][1] as Record<string, unknown>;
    expect(putArg).toMatchObject({ id: 'ABC-1', deletedAt: T, updatedAt: T });
    expect(scheduleEnqueue).toHaveBeenCalledTimes(1);
    expect(enqueueVideoChange).toHaveBeenCalledTimes(1);
    expect(enqueueVideoChange.mock.calls[0][0]).toMatchObject({ id: 'ABC-1', deletedAt: T, updatedAt: T });
  });

  it('viewedBulkDelete: 多条墓碑各自抬戳，单次 enqueueVideoChanges 全量入队', async () => {
    const { viewedBulkDelete } = await import('./indexedDb');
    const db = makeFakeDb({
      viewedRecords: {
        'A-1': { id: 'A-1', title: 'a', status: 'viewed', createdAt: 1, updatedAt: 10 },
        'B-2': { id: 'B-2', title: 'b', status: 'browsed', createdAt: 2, updatedAt: 20 },
      },
    });
    initDB.mockResolvedValue(db);

    await viewedBulkDelete(['A-1', 'B-2']);

    expect(db.put).toHaveBeenCalledTimes(2);
    for (const [, value] of db.put.mock.calls) {
      expect(value).toMatchObject({ deletedAt: T, updatedAt: T });
    }
    expect(enqueueVideoChanges).toHaveBeenCalledTimes(1);
    const batch = enqueueVideoChanges.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    expect(batch.map((r) => r.id).sort()).toEqual(['A-1', 'B-2']);
    for (const r of batch) expect(r).toMatchObject({ deletedAt: T, updatedAt: T });
  });

  it('viewedRestore: 解除 deletedAt 且抬 updatedAt=now（S2 恢复需新于 deletedAt），复活实体入队', async () => {
    const { viewedRestore } = await import('./indexedDb');
    const db = makeFakeDb({
      viewedRecords: { 'ABC-1': { id: 'ABC-1', title: 't', status: 'viewed', createdAt: 1, updatedAt: 100, deletedAt: 150 } },
    });
    initDB.mockResolvedValue(db);

    await viewedRestore('ABC-1');

    expect(db.put).toHaveBeenCalledTimes(1);
    const putArg = db.put.mock.calls[0][1] as Record<string, unknown>;
    expect(putArg).toMatchObject({ id: 'ABC-1', updatedAt: T });
    expect(putArg).not.toHaveProperty('deletedAt');
    expect(enqueueVideoChange).toHaveBeenCalledTimes(1);
    expect(enqueueVideoChange.mock.calls[0][0]).toMatchObject({ id: 'ABC-1', updatedAt: T });
    expect(enqueueVideoChange.mock.calls[0][0]).not.toHaveProperty('deletedAt');
  });

  it('viewedBulkRestore: 批量恢复各自抬戳，单次 enqueueVideoChanges 入队', async () => {
    const { viewedBulkRestore } = await import('./indexedDb');
    const db = makeFakeDb({
      viewedRecords: {
        'A-1': { id: 'A-1', title: 'a', status: 'viewed', createdAt: 1, updatedAt: 10, deletedAt: 11 },
        'B-2': { id: 'B-2', title: 'b', status: 'viewed', createdAt: 2, updatedAt: 20, deletedAt: 21 },
      },
    });
    initDB.mockResolvedValue(db);

    await viewedBulkRestore(['A-1', 'B-2']);

    expect(db.put).toHaveBeenCalledTimes(2);
    for (const [, value] of db.put.mock.calls) {
      expect(value).toMatchObject({ updatedAt: T });
      expect(value).not.toHaveProperty('deletedAt');
    }
    expect(enqueueVideoChanges).toHaveBeenCalledTimes(1);
    const batch = enqueueVideoChanges.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    for (const r of batch) {
      expect(r).toMatchObject({ updatedAt: T });
      expect(r).not.toHaveProperty('deletedAt');
    }
  });

  it('actorsDelete / actorsRestore: 同 viewed 语义（enqueueActorChange 入队）', async () => {
    const { actorsDelete, actorsRestore } = await import('./indexedDb');

    const dbDel = makeFakeDb({
      actors: { 'act-1': { id: 'act-1', name: 'n', createdAt: 1, updatedAt: 100 } },
    });
    initDB.mockResolvedValue(dbDel);
    await actorsDelete('act-1');
    expect(dbDel.put).toHaveBeenCalledTimes(1);
    expect(dbDel.put.mock.calls[0][1]).toMatchObject({ id: 'act-1', deletedAt: T, updatedAt: T });
    expect(enqueueActorChange).toHaveBeenCalledTimes(1);
    expect(enqueueActorChange.mock.calls[0][0]).toMatchObject({ id: 'act-1', deletedAt: T, updatedAt: T });

    const dbRes = makeFakeDb({
      actors: { 'act-1': { id: 'act-1', name: 'n', createdAt: 1, updatedAt: 100, deletedAt: 150 } },
    });
    initDB.mockResolvedValue(dbRes);
    await actorsRestore('act-1');
    expect(dbRes.put).toHaveBeenCalledTimes(1);
    expect(dbRes.put.mock.calls[0][1]).toMatchObject({ id: 'act-1', updatedAt: T });
    expect(dbRes.put.mock.calls[0][1]).not.toHaveProperty('deletedAt');
    expect(enqueueActorChange).toHaveBeenCalledTimes(2);
    expect(enqueueActorChange.mock.calls[1][0]).toMatchObject({ id: 'act-1', updatedAt: T });
    expect(enqueueActorChange.mock.calls[1][0]).not.toHaveProperty('deletedAt');
  });

  it('actorsBulkRestore: 批量恢复各自抬戳，单次 enqueueActorChanges 入队', async () => {
    const { actorsBulkRestore } = await import('./indexedDb');
    const db = makeFakeDb({
      actors: {
        'a-1': { id: 'a-1', name: 'x', createdAt: 1, updatedAt: 10, deletedAt: 11 },
        'a-2': { id: 'a-2', name: 'y', createdAt: 2, updatedAt: 20, deletedAt: 21 },
      },
    });
    initDB.mockResolvedValue(db);

    await actorsBulkRestore(['a-1', 'a-2']);

    expect(db.put).toHaveBeenCalledTimes(2);
    for (const [, value] of db.put.mock.calls) {
      expect(value).toMatchObject({ updatedAt: T });
      expect(value).not.toHaveProperty('deletedAt');
    }
    expect(enqueueActorChanges).toHaveBeenCalledTimes(1);
    const batch = enqueueActorChanges.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    for (const r of batch) {
      expect(r).toMatchObject({ updatedAt: T });
      expect(r).not.toHaveProperty('deletedAt');
    }
  });

  it('记录不存在: 零写入零入队（既有守卫保留）', async () => {
    const { viewedDelete, viewedRestore, actorsDelete } = await import('./indexedDb');
    const db = makeFakeDb({ viewedRecords: {}, actors: {} });
    initDB.mockResolvedValue(db);

    await viewedDelete('NOPE');
    await viewedRestore('NOPE');
    await actorsDelete('NOPE');

    expect(db.put).not.toHaveBeenCalled();
    expect(scheduleEnqueue).not.toHaveBeenCalled();
    expect(enqueueVideoChange).not.toHaveBeenCalled();
    expect(enqueueActorChange).not.toHaveBeenCalled();
  });
});
