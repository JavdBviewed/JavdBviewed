/**
 * @file listsDeleteCloudTombstone.test.ts
 * @description 清单软删除（deletedAt）+ 云端墓碑 enqueue + 读面过滤（10-25 线）
 * @module tests/extension
 *
 * 10-25：收藏中心删除不传播到云（list 实体无软删/tombstone）修复锁：
 * - listsDelete = 软删（保留记录、补 deletedAt、抬 updatedAt 供服务端 LWW 确定性），零硬删
 * - 入队带顶层 deletedAt 的墓碑实体（storage_item 墓碑先例形态）
 * - listsClear 逐条软删 + 批量入队
 * - normalized 读面（GetAllNormalized/GetNormalized/GetBySource）过滤软删记录；raw 读面（listsGetAll）保留
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListRecord } from '../../apps/extension/src/types';

const CONN = '../../apps/extension/src/platform/storage/indexedDbConnection';
const PENDING = '../../apps/extension/src/features/cloudSync/chromePendingStore';
const INDEXED_DB = '../../apps/extension/src/platform/storage/indexedDb';

/** 极简 IDBKeyRange 垫片（node 环境无全局）：only(v) 形态足够 listsGetBySource 使用 */
class FakeIDBKeyRange {
  constructor(
    public lower: unknown,
    public upper: unknown,
  ) {}
  static only(v: unknown): FakeIDBKeyRange {
    return new FakeIDBKeyRange(v, v);
  }
}

function makeFakeDb(records: Array<Partial<ListRecord>>) {
  const state: Array<Record<string, unknown>> = records.map((r) => ({ ...r }));
  const fakeDb = {
    get: vi.fn(async (_store: string, id: string) => state.find((r) => r.id === id) as any),
    put: vi.fn(async (_store: string, value: Record<string, unknown>) => {
      const i = state.findIndex((r) => r.id === value.id);
      if (i >= 0) state[i] = { ...value };
      else state.push({ ...value });
    }),
    delete: vi.fn(async (_store: string, id: string) => {
      const i = state.findIndex((r) => r.id === id);
      if (i >= 0) state.splice(i, 1);
    }),
    clear: vi.fn(async () => {
      state.length = 0;
    }),
    getAll: vi.fn(async () => [...state]),
    transaction: vi.fn(() => ({
      store: {
        index: vi.fn((name: string) => {
          expect(name).toBe('by_source');
          return {
            getAll: vi.fn(async (range: FakeIDBKeyRange) =>
              state.filter((r) => r.source === range.lower),
            ),
          };
        }),
      },
    })),
  };
  return { fakeDb, state };
}

async function loadWithMocks(fakeDb: unknown) {
  const captured: Array<Record<string, unknown>> = [];
  vi.doMock(CONN, () => ({ initDB: vi.fn(async () => fakeDb) }));
  vi.doMock(PENDING, () => ({
    upsertCloudPending: vi.fn(async (entities: unknown[]) => {
      captured.push(...(entities as Array<Record<string, unknown>>));
    }),
  }));
  const mod = await import(INDEXED_DB);
  return { mod, captured };
}

describe('listsDelete 软删 + 云墓碑（10-25）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock(CONN);
    vi.doUnmock(PENDING);
  });

  it('软删：保留记录补 deletedAt 并抬 updatedAt，零硬删，入队带顶层 deletedAt 的墓碑实体', async () => {
    const now = 1_760_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const record: Partial<ListRecord> = {
      id: 'series:abc123',
      name: '系列甲',
      type: 'series',
      source: 'javdb',
      createdAt: 100,
      updatedAt: 200,
    };
    const { fakeDb, state } = makeFakeDb([record]);
    const { mod, captured } = await loadWithMocks(fakeDb);

    await mod.listsDelete('series:abc123');

    // 本地软删：记录仍在、补 deletedAt、抬 updatedAt（服务端 LWW 确定性）
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({
      id: 'series:abc123',
      name: '系列甲',
      type: 'series',
      deletedAt: now,
      updatedAt: now,
    });
    expect(fakeDb.delete).not.toHaveBeenCalled();
    expect(fakeDb.clear).not.toHaveBeenCalled();

    // 云墓碑实体：顶层 deletedAt 一等公民（storage_item 先例形态），payload 为完整记录
    expect(captured).toHaveLength(1);
    const e = captured[0];
    expect(e.type).toBe('list');
    expect(e.id).toBe('series:abc123');
    expect(e.revision).toBe(1);
    expect(e.updatedAt).toBe(now);
    expect(e.deletedAt).toBe(now);
    expect(e.payload).toMatchObject({
      id: 'series:abc123',
      name: '系列甲',
      deletedAt: now,
      updatedAt: now,
    });
  });

  it('删除不存在的 id = no-op：零写入零入队', async () => {
    const { fakeDb, state } = makeFakeDb([]);
    const { mod, captured } = await loadWithMocks(fakeDb);

    await mod.listsDelete('label:NOT-EXIST');

    expect(state).toHaveLength(0);
    expect(fakeDb.put).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  it('重复删除已软删记录 = 幂等再墓碑（刷新时间戳、重推同键实体）', async () => {
    let t = 1_760_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => t);
    const { fakeDb, state } = makeFakeDb([
      { id: 'maker:m-1', name: 'M', type: 'maker', source: 'javdb', createdAt: 1, updatedAt: 10, deletedAt: 50 },
    ]);
    const { mod, captured } = await loadWithMocks(fakeDb);

    await mod.listsDelete('maker:m-1');

    t = 1_760_000_000_500;
    await mod.listsDelete('maker:m-1');

    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ id: 'maker:m-1', deletedAt: 1_760_000_000_500, updatedAt: 1_760_000_000_500 });
    expect(captured).toHaveLength(2);
    expect(captured[1]).toMatchObject({ id: 'maker:m-1', deletedAt: 1_760_000_000_500, updatedAt: 1_760_000_000_500 });
    void nowSpy;
  });

  it('listsClear 逐条软删 + 批量入队（含既有墓碑一并刷新），零 db.clear', async () => {
    const now = 1_760_000_010_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const { fakeDb, state } = makeFakeDb([
      { id: 'mine-1', name: 'L1', type: 'mine', source: 'javdb', createdAt: 1, updatedAt: 2 },
      { id: 'label:XXX', name: 'L2', type: 'label', source: 'javdb', createdAt: 3, updatedAt: 4, deletedAt: 40 },
      { id: 'local-9', name: 'L3', type: 'local', source: 'local', createdAt: 5, updatedAt: 6 },
    ]);
    const { mod, captured } = await loadWithMocks(fakeDb);

    await mod.listsClear();

    expect(fakeDb.clear).not.toHaveBeenCalled();
    expect(state).toHaveLength(3);
    for (const r of state) {
      expect(r.deletedAt).toBe(now);
      expect(r.updatedAt).toBe(now);
    }
    expect(captured).toHaveLength(3);
    expect(captured.map((e) => e.id).sort()).toEqual(['label:XXX', 'local-9', 'mine-1']);
    for (const e of captured) {
      expect(e.type).toBe('list');
      expect(e.deletedAt).toBe(now);
    }
  });

  it('listsClear 空 store = no-op 零入队', async () => {
    const { fakeDb } = makeFakeDb([]);
    const { mod, captured } = await loadWithMocks(fakeDb);

    await mod.listsClear();

    expect(fakeDb.put).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });
});

describe('lists 读面 deletedAt 过滤（10-25）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock(CONN);
    vi.doUnmock(PENDING);
  });

  const live = { id: 'mine-1', name: '活', type: 'mine' as const, source: 'javdb', createdAt: 1, updatedAt: 2 };
  const ghost = { id: 'mine-2', name: '鬼', type: 'favorite' as const, source: 'javdb', createdAt: 3, updatedAt: 4, deletedAt: 50 };

  it('listsGetAllNormalized 过滤软删记录；raw listsGetAll 保留（真相源不滤）', async () => {
    const { fakeDb } = makeFakeDb([live, ghost]);
    const { mod } = await loadWithMocks(fakeDb);

    const normalized = await mod.listsGetAllNormalized();
    expect(normalized.map((r) => r.id)).toEqual(['mine-1']);

    const raw = await mod.listsGetAll();
    expect(raw.map((r) => r.id).sort()).toEqual(['mine-1', 'mine-2']);
  });

  it('listsGetNormalized 墓碑 id 返回 undefined，活记录正常返回', async () => {
    const { fakeDb } = makeFakeDb([live, ghost]);
    const { mod } = await loadWithMocks(fakeDb);

    await expect(mod.listsGetNormalized('mine-2')).resolves.toBeUndefined();
    await expect(mod.listsGetNormalized('mine-1')).resolves.toMatchObject({ id: 'mine-1', source: 'javdb' });
    await expect(mod.listsGetNormalized('nope')).resolves.toBeUndefined();
  });

  it('listsGetBySource 过滤软删记录', async () => {
    (globalThis as Record<string, unknown>).IDBKeyRange = FakeIDBKeyRange;
    const { fakeDb } = makeFakeDb([live, ghost]);
    const { mod } = await loadWithMocks(fakeDb);

    const bySource = await mod.listsGetBySource('javdb');
    expect(bySource.map((r) => r.id)).toEqual(['mine-1']);
  });
});
