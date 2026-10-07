/**
 * @file extensionEntityStore.test.ts
 * @description applyRemote 远端回写必须跳过 cloud pending 入队（防拉取回声重推）
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
    throw new Error('initDB should not be called by applyRemote for bulk entity types');
  }),
}));

vi.mock('../../platform/storage/indexedDb', () => spies);

describe('createExtensionEntityStore().applyRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies pulled entities without re-enqueueing them into the cloud pending queue', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      { type: 'video', id: 'ABP-100', payload: { code: 'ABP-100' }, updatedAt: 1 },
      { type: 'actor', id: 'actor-1', payload: { name: 'A' }, updatedAt: 1 },
      { type: 'list', id: 'list-1', payload: { title: 'L' }, updatedAt: 1 },
      { type: 'new_work', id: 'nw-1', payload: { title: 'W' }, updatedAt: 1 },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.viewedBulkPut).toHaveBeenCalledWith(
      [{ code: 'ABP-100', id: 'ABP-100' }],
      { skipCloudEnqueue: true },
    );
    expect(spies.actorsBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.actorsBulkPut).toHaveBeenCalledWith(
      [{ name: 'A', id: 'actor-1' }],
      { skipCloudEnqueue: true },
    );
    expect(spies.listsBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.listsBulkPut).toHaveBeenCalledWith(
      [{ title: 'L', id: 'list-1' }],
      { skipCloudEnqueue: true },
    );
    expect(spies.newWorksBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.newWorksBulkPut).toHaveBeenCalledWith(
      [{ title: 'W', id: 'nw-1' }],
      { skipCloudEnqueue: true },
    );
  });

  it('applies remote tombstones (deletedAt) without enqueuing either', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      { type: 'video', id: 'ABP-200', payload: { code: 'ABP-200' }, updatedAt: 1, deletedAt: 2 },
    ]);

    expect(spies.viewedBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.viewedBulkPut).toHaveBeenCalledWith(
      [{ code: 'ABP-200', id: 'ABP-200', deletedAt: 2 }],
      { skipCloudEnqueue: true },
    );
  });

  it('soft-writes-back list tombstones, hard-deletes new_work tombstones (10-25: list 对齐 viewed/actor 软删)', async () => {
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    const store = createExtensionEntityStore();

    await store.applyRemote([
      { type: 'list', id: 'list-del-1', payload: { title: 'L' }, updatedAt: 1, deletedAt: 2 },
      { type: 'new_work', id: 'nw-del-1', payload: { title: 'W' }, updatedAt: 1, deletedAt: 2 },
    ]);

    // list：远端墓碑软写回（保留墓碑实体），listsDelete 零调用
    expect(spies.listsBulkPut).toHaveBeenCalledTimes(1);
    expect(spies.listsBulkPut).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'list-del-1', title: 'L', deletedAt: 2 })],
      { skipCloudEnqueue: true },
    );
    expect(spies.listsDelete).not.toHaveBeenCalled();
    // new_work：本地硬删除语义不变
    expect(spies.newWorksBulkPut).not.toHaveBeenCalled();
    expect(spies.newWorksDelete).toHaveBeenCalledWith('nw-del-1');
  });
});
