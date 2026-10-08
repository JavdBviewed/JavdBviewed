/**
 * @file migrations.viewedBatch.test.ts
 * @description 10-08 兜底补迁移：migrateViewedBatch 抽取后的单元锁
 *   - IDB 空 + 老键非空场景的写入主体（分批 500 / 置旗标 / 返回条数）
 *   - 启动路径 ensureMigrationsStart 旗标短路语义保持不变
 * @module platform/storage
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
// 注意：本文件不得静态 import 会触及 utils/storage import 图的模块（vi.mock 工厂提升 + 顶层 const 初始化时序）
// 键值与 utils/config.ts 锁死：VIEWED_RECORDS='viewed' / IDB_MIGRATED='idb_migrated'
const KEY_VIEWED = 'viewed';
const KEY_FLAG = 'idb_migrated';

const initDB = vi.fn(async () => ({}));
const viewedBulkPut = vi.fn(async () => undefined);
const viewedCount = vi.fn(async () => 0);

vi.mock('./indexedDb', () => ({
  initDB,
  viewedBulkPut,
  viewedCount,
  magnetsClearExpired: vi.fn(async () => undefined),
  logsBulkAdd: vi.fn(async () => undefined),
  magnetPushLogsBulkAdd: vi.fn(async () => undefined),
  actorsBulkPut: vi.fn(async () => undefined),
}));

const getValue = vi.fn();
const setValue = vi.fn(async () => undefined);
vi.mock('../../utils/storage', () => ({
  getValue,
  setValue,
}));

function makeRecords(n: number) {
  const records: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    records.push({
      id: `ID${String(i).padStart(4, '0')}`,
      title: `title-${i}`,
      status: 'viewed',
      createdAt: i,
      updatedAt: i,
    });
  }
  return records;
}

describe('migrateViewedBatch（10-08 兜底补迁移主体）', () => {
  beforeEach(() => {
    vi.resetModules();
    initDB.mockReset().mockResolvedValue({});
    viewedBulkPut.mockReset().mockResolvedValue(undefined);
    viewedCount.mockReset().mockResolvedValue(0);
    getValue.mockReset();
    setValue.mockReset().mockResolvedValue(undefined);
  });

  it('按 500 分批写入 IDB，置 idb_migrated 旗标，返回迁移条数', async () => {
    const { migrateViewedBatch } = await import('./migrations');
    const records = makeRecords(600);

    const migrated = await migrateViewedBatch(records);

    expect(migrated).toBe(600);
    expect(viewedBulkPut).toHaveBeenCalledTimes(2);
    expect(viewedBulkPut).toHaveBeenNthCalledWith(1, records.slice(0, 500));
    expect(viewedBulkPut).toHaveBeenNthCalledWith(2, records.slice(500));
    expect(setValue).toHaveBeenCalledWith(KEY_FLAG, true);
  });

  it('空数组：不写 IDB 但置旗标（保持启动路径「首次 0 条也置旗标」语义）', async () => {
    const { migrateViewedBatch } = await import('./migrations');

    const migrated = await migrateViewedBatch([]);

    expect(migrated).toBe(0);
    expect(viewedBulkPut).not.toHaveBeenCalled();
    expect(setValue).toHaveBeenCalledWith(KEY_FLAG, true);
  });

  it('bulkPut 失败：异常向上抛（由调用方决定响应/吞掉），不置旗标', async () => {
    viewedBulkPut.mockRejectedValueOnce(new Error('idb boom'));
    const { migrateViewedBatch } = await import('./migrations');

    await expect(migrateViewedBatch(makeRecords(1))).rejects.toThrow('idb boom');
    expect(setValue).not.toHaveBeenCalled();
  });

  it('ensureMigrationsStart：旗标已置时启动路径不读 viewed 老键、不迁移（重构后短路语义不变）', async () => {
    getValue.mockImplementation(async (key: string) => {
      if (key === KEY_FLAG) return true;
      return {}; // 其余旗标一律 truthy 短路
    });
    const { ensureMigrationsStart } = await import('./migrations');

    ensureMigrationsStart();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getValue).toHaveBeenCalledWith(KEY_FLAG, false);
    expect(getValue).not.toHaveBeenCalledWith(KEY_VIEWED, {});
    expect(viewedBulkPut).not.toHaveBeenCalled();
    expect(setValue).not.toHaveBeenCalled();
  });
});
