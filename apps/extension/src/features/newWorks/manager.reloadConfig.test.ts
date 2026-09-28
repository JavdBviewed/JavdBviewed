/**
 * @file manager.reloadConfig.test.ts
 * @description 批 3a：SW 实例跨配置变更存活时 NewWorksManager 内存全局配置刷新
 *              （reloadGlobalConfig）——new_works_config 被外部更新（dashboard 页写入 /
 *              storage.onChanged / 'new-works-scheduler-restart' 消息）后，存活 SW 必须重读
 *              存储，后续检查按新配置执行（P3 验收「配置后立即生效」）。
 * @module features/newWorks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- 依赖 mock（与 manager.staleOverwrite.test.ts 同构） ----------

vi.mock('../../platform/storage/indexedDb', () => ({
  newWorksPut: vi.fn(),
  newWorksBulkPut: vi.fn(),
}));

vi.mock('../../utils/storage', () => ({
  getValue: vi.fn(async (_key: string, fallback?: unknown) => fallback),
  setValue: vi.fn(async () => undefined),
}));

vi.mock('../../utils/logController', () => ({
  log: {
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    privacy: vi.fn(),
    storage: vi.fn(),
    debug: vi.fn(),
  },
  logController: { initialize: vi.fn(), updateConfig: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  STORAGE_KEYS: {
    NEW_WORKS_SUBSCRIPTIONS: 'new_works_subscriptions',
    NEW_WORKS_RECORDS: 'new_works_records',
    NEW_WORKS_CONFIG: 'new_works_config',
  },
  DEFAULT_NEW_WORKS_CONFIG: {
    checkInterval: 86400000,
    requestInterval: 3,
    filters: {},
    autoCheckEnabled: false,
    showActorPageScanButton: true,
  },
}));

vi.mock('../actors', () => ({
  actorManager: { getActorById: vi.fn() },
}));

vi.mock('../../dashboard/dbClient', () => ({
  dbNewWorksQuery: vi.fn(),
  dbNewWorksStats: vi.fn(),
  dbNewWorksGet: vi.fn(),
  dbNewWorksPut: vi.fn(),
  dbNewWorksBulkPut: vi.fn(),
  dbNewWorksDelete: vi.fn(),
  dbNewWorksGetAll: vi.fn(),
  dbViewedStatusGetMany: vi.fn(),
  dbViewedPage: vi.fn(),
}));

vi.mock('./newWorksDiagnostics', () => ({
  recordNewWorksDiagnosticCounter: vi.fn(),
  recordNewWorksDiagnosticError: vi.fn(),
  recordNewWorksDiagnosticValue: vi.fn(),
  beginNewWorksDiagnosticSpan: vi.fn(() => vi.fn()),
}));

import { NewWorksManager } from './manager';
import { getValue, setValue } from '../../utils/storage';
import { newWorksPut, newWorksBulkPut } from '../../platform/storage/indexedDb';
import { dbNewWorksGet } from '../../dashboard/dbClient';
import { actorManager } from '../actors';
import type { ActorSubscription } from './types';

// ---------- 测试辅助 ----------

function makeSub(id: string): ActorSubscription {
  return {
    actorId: id,
    actorName: `演员 ${id}`,
    avatarUrl: '',
    subscribedAt: 1,
    enabled: true,
  };
}

/** 内存"chrome.storage"：按 key 返回最新快照（每次返回副本，模拟真实读取） */
let storageData: Record<string, unknown> = {};

/** 注册 getValue 实现（需在 beforeEach 中调用：restoreMocks 会逐测试恢复工厂默认实现） */
function registerStorageMock(): void {
  vi.mocked(getValue).mockImplementation(async (key: string, fallback?: unknown) => {
    const v = (storageData as Record<string, unknown>)[key];
    if (v && typeof v === 'object') return JSON.parse(JSON.stringify(v));
    return fallback;
  });
}

/** 构造一个已完成 initialize 的实例（模拟 SW 启动读到的基线快照） */
async function initManager(): Promise<any> {
  const manager = new NewWorksManager() as any;
  await manager.initialize();
  return manager;
}

/** 四套集合快照（reload 不得触碰） */
function snapshotSets(m: any): Record<string, string[]> {
  return {
    subscriptionBaseline: [...m.subscriptionBaseline].sort(),
    workBaseline: [...m.workBaseline].sort(),
    dirtySubscriptionIds: [...m.dirtySubscriptionIds].sort(),
    dirtyWorkIds: [...m.dirtyWorkIds].sort(),
    localDeletedSubscriptionIds: [...m.localDeletedSubscriptionIds].sort(),
    localDeletedWorkIds: [...m.localDeletedWorkIds].sort(),
  };
}

const CFG_V1 = {
  checkInterval: 24,
  requestInterval: 3,
  autoCheckEnabled: false,
  showActorPageScanButton: false,
  maxWorksPerCheck: 100,
  filters: {
    excludeViewed: true,
    categoryFilters: [] as string[],
    categoryBlackFilters: [] as string[],
  },
};

describe('NewWorksManager.reloadGlobalConfig（批 3a 配置刷新）', () => {
  beforeEach(() => {
    storageData = {};
    registerStorageMock();
    vi.mocked(setValue).mockReset();
    vi.mocked(setValue).mockImplementation(async () => undefined);
    vi.mocked(newWorksPut).mockReset();
    vi.mocked(newWorksPut).mockResolvedValue(undefined);
    vi.mocked(newWorksBulkPut).mockReset();
    vi.mocked(newWorksBulkPut).mockResolvedValue(undefined);
    vi.mocked(dbNewWorksGet).mockReset();
    vi.mocked(dbNewWorksGet).mockResolvedValue(null as any);
    vi.mocked(actorManager.getActorById).mockImplementation(
      async (id: string) => ({ name: `演员 ${id}`, avatarUrl: '' }),
    );
  });

  it('存储被外部更新后 reload 拿到新配置（含类别白/黑新字段）；reload 前返回旧值', async () => {
    storageData = { new_works_config: CFG_V1, new_works_subscriptions: {}, new_works_records: {} };
    const manager = await initManager();
    // SW 启动基线：白/黑均空
    expect(((await manager.getGlobalConfig()) as any).filters.categoryFilters).toEqual([]);

    // dashboard 页外部更新类别白/黑名单（本实例内存不自动变）
    storageData = {
      ...storageData,
      new_works_config: {
        ...CFG_V1,
        filters: {
          ...CFG_V1.filters,
          categoryFilters: ['c1=200'],
          categoryBlackFilters: ['c6=93'],
        },
      },
    };
    // 未 reload：内存仍是旧值（缺陷复现面）
    expect(((await manager.getGlobalConfig()) as any).filters.categoryFilters).toEqual([]);
    expect(((await manager.getGlobalConfig()) as any).filters.categoryBlackFilters).toEqual([]);

    await manager.reloadGlobalConfig();

    const cfg = (await manager.getGlobalConfig()) as any;
    expect(cfg.filters.categoryFilters).toEqual(['c1=200']);
    expect(cfg.filters.categoryBlackFilters).toEqual(['c6=93']);
    // 其余字段按存储值回填
    expect(cfg.checkInterval).toBe(24);
    expect(cfg.maxWorksPerCheck).toBe(100);
  });

  it('迁移逻辑在 reload 时仍生效（旧 enabled 映射 autoCheckEnabled，遗留字段清理）', async () => {
    storageData = {
      new_works_config: { enabled: true, checkInterval: 123 },
      new_works_subscriptions: {},
      new_works_records: {},
    };
    const manager = await initManager();
    expect(((await manager.getGlobalConfig()) as any).autoCheckEnabled).toBe(true);

    // 外部再改（仍是旧形 enabled）
    storageData = {
      ...storageData,
      new_works_config: { enabled: false, checkInterval: 456 },
    };
    await manager.reloadGlobalConfig();

    const cfg = (await manager.getGlobalConfig()) as any;
    expect(cfg.autoCheckEnabled).toBe(false);
    expect(cfg.checkInterval).toBe(456);
    expect(cfg.enabled).toBeUndefined(); // 遗留字段已清理
  });

  it('reload 不触碰 subscription/work baseline、dirty、localDeleted 四套集合', async () => {
    storageData = {
      new_works_config: CFG_V1,
      new_works_subscriptions: { A: makeSub('A'), B: makeSub('B') },
      new_works_records: {},
    };
    const manager = await initManager();
    // 白盒注入 dirty/localDeleted（不走 markSubscriptionChecked：其内部 saveSubscriptions
    // 会在写存储后 clear() 全部 dirty，无法留下可断言的非空集合）
    (manager as any).dirtySubscriptionIds.add('B');
    (manager as any).localDeletedSubscriptionIds.add('A');
    const before = snapshotSets(manager);
    expect(before.dirtySubscriptionIds).toContain('B');
    expect(before.localDeletedSubscriptionIds).toContain('A');

    // 外部改配置 → reload
    storageData = {
      ...storageData,
      new_works_config: { ...CFG_V1, checkInterval: 99 },
    };
    await manager.reloadGlobalConfig();

    expect(snapshotSets(manager)).toEqual(before);
    // 配置已刷新
    expect(((await manager.getGlobalConfig()) as any).checkInterval).toBe(99);
    // 订阅内存表不变
    expect(manager.subscriptions.size).toBe(2);
  });
});
