/**
 * @file actorManager.crossContext.test.ts
 * @description S2.1 回归：chrome.storage `actor_records` 兼容键的跨上下文全量回写保护。
 *              actorManager 单例在 dashboard 各 tab / 内容脚本（actorEnhancement 自动打标签）
 *              各自独立持有，内存缓存 initialize 后永不刷新——若直接全量覆盖存储键，
 *              陈旧快照会抹掉其他上下文新写入的演员（与 #42 newWorks 同类缺陷）。
 * @module features/actors
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/storage', () => ({
  getValue: vi.fn(),
  setValue: vi.fn(),
}));

vi.mock('../../utils/config', () => ({
  STORAGE_KEYS: { ACTOR_RECORDS: 'actor_records' },
}));

vi.mock('../../dashboard/dbClient', () => ({
  dbActorsQuery: vi.fn(async () => ({ items: [], total: 0 })),
  dbActorsGet: vi.fn(async () => undefined),
  dbActorsPut: vi.fn(async () => undefined),
  dbActorsDelete: vi.fn(async () => undefined),
  dbActorsBulkPut: vi.fn(async () => undefined),
  dbActorsBulkPurge: vi.fn(async () => undefined),
  dbActorsStats: vi.fn(async () => ({})),
}));

import { ActorManager } from './actorManager';
import { getValue, setValue } from '../../utils/storage';
import {
  dbActorsBulkPurge,
  dbActorsDelete,
  dbActorsGet,
  dbActorsQuery,
} from '../../dashboard/dbClient';

const ACTOR_KEY = 'actor_records';

let storageMap: Record<string, unknown>;

/** 模拟「其他上下文」直接改写 chrome.storage 键 */
function setRemote(key: string, value: unknown): void {
  storageMap[key] = value;
}

function readRemote(key: string): Record<string, any> {
  return (storageMap[key] as Record<string, any>) || {};
}

function actor(id: string): any {
  return {
    id,
    name: `演员${id}`,
    aliases: [],
    gender: 'female',
    blacklisted: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function freshManagerWith(storage: Record<string, unknown>): Promise<ActorManager> {
  storageMap = storage;
  (getValue as any).mockImplementation(async (key: string, fallback?: unknown) => {
    return key in storageMap ? (storageMap[key] as unknown) : fallback;
  });
  (setValue as any).mockImplementation(async (key: string, value: unknown) => {
    storageMap[key] = value;
  });
  const manager = new ActorManager();
  await manager.initialize();
  return manager;
}

describe('ActorManager 跨上下文回写保护', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMap = {};
  });

  it('回写前合并存储键最新态，不抹掉其他上下文新写入的演员', async () => {
    const manager = await freshManagerWith({});
    // 本实例 initialize 之后，另一 dashboard tab 写入演员 Z
    setRemote(ACTOR_KEY, { Z: actor('Z') });

    await manager.saveActor(actor('Y'));

    const key = readRemote(ACTOR_KEY);
    expect(Object.keys(key).sort()).toEqual(['Y', 'Z']);
    expect(key.Z.name).toBe('演员Z');
  });

  it('陈旧缓存删除：缓存未命中回查 IDB，墓碑阻止合并复活，删除不静默失败', async () => {
    const manager = await freshManagerWith({});
    // 其他上下文把 X 写入存储键与 IDB（本实例缓存里没有 X）
    setRemote(ACTOR_KEY, { X: actor('X') });
    (dbActorsGet as any).mockImplementation(async (id: string) =>
      id === 'X' ? actor('X') : undefined,
    );

    const ok = await manager.deleteActor('X');

    expect(ok).toBe(true);
    expect(dbActorsDelete).toHaveBeenCalledWith('X');
    // X 不会被「回写前合并」从存储键复活
    expect(readRemote(ACTOR_KEY)).toEqual({});
  });

  it('缓存与 IDB 均无该演员时 deleteActor 返回 false 且不落库', async () => {
    const manager = await freshManagerWith({});
    const ok = await manager.deleteActor('MISSING');
    expect(ok).toBe(false);
    expect(dbActorsDelete).not.toHaveBeenCalled();
  });

  it('importActors replace：回写不合并远端，存储键恰为导入集', async () => {
    const manager = await freshManagerWith({});
    setRemote(ACTOR_KEY, { X: actor('X') }); // 其他上下文数据

    const result = await manager.importActors([actor('Y')], 'replace');

    expect(result.imported).toBe(1);
    expect(Object.keys(readRemote(ACTOR_KEY))).toEqual(['Y']);
  });

  it('importActors merge：合并远端，不抹掉其他上下文数据', async () => {
    const manager = await freshManagerWith({});
    setRemote(ACTOR_KEY, { X: actor('X') });

    await manager.importActors([actor('Y')], 'merge');

    expect(Object.keys(readRemote(ACTOR_KEY)).sort()).toEqual(['X', 'Y']);
  });

  it('clearAllActors：清空存储键并同步硬删 IDB', async () => {
    const manager = await freshManagerWith({ X: actor('X'), Y: actor('Y') });
    setRemote(ACTOR_KEY, { X: actor('X'), Y: actor('Y'), Z: actor('Z') });
    (dbActorsQuery as any).mockResolvedValue({ items: [actor('X'), actor('Y')], total: 2 });

    await manager.clearAllActors();

    expect(readRemote(ACTOR_KEY)).toEqual({});
    expect(dbActorsBulkPurge).toHaveBeenCalledWith(['X', 'Y']);
  });
});

describe('ActorManager 手动编辑锁记录（09-28-actor-favorited-field 合流小修）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMap = {};
  });

  it('setBlacklisted 记锁：拉黑写入 blacklisted=true 且 manuallyEditedFields 含 blacklisted；取消拉黑保留 false 且不重复记锁', async () => {
    const manager = await freshManagerWith({});
    await manager.saveActor(actor('B'));

    await manager.setBlacklisted('B', true);
    let rec = readRemote(ACTOR_KEY).B;
    expect(rec.blacklisted).toBe(true);
    expect(rec.manuallyEditedFields).toEqual(['blacklisted']);

    // 取消拉黑：本地 false 也记锁（JavDB 侧永不下发该字段，锁只防丢失不挡更新），且不重复
    await manager.setBlacklisted('B', false);
    rec = readRemote(ACTOR_KEY).B;
    expect(rec.blacklisted).toBe(false);
    expect(rec.manuallyEditedFields).toEqual(['blacklisted']);
  });
});
