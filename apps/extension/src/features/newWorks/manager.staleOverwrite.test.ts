/**
 * @file manager.staleOverwrite.test.ts
 * @description 回归：SW / dashboard 各持独立 NewWorksManager 实例且 initialize 幂等只读一次，
 *              全量回写前必须与存储双向同步，防止陈旧内存快照复活他处已删的订阅/作品。
 * @module features/newWorks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- 依赖 mock（与 manager.newWorksPersist.test.ts 同构） ----------

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
import { newWorksPut, newWorksBulkPut } from '../../platform/storage/indexedDb';
import { getValue, setValue } from '../../utils/storage';
import { dbNewWorksGet } from '../../dashboard/dbClient';
import { actorManager } from '../actors';
import type { ActorSubscription, NewWorkRecord } from './types';

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

function makeWork(id: string): NewWorkRecord {
  return {
    id,
    code: id,
    title: `作品 ${id}`,
    actorId: 'actor-1',
    actorName: '测试演员',
    discoveredAt: Date.now(),
    isRead: false,
  } as NewWorkRecord;
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

/** 取最后一次 setValue(key, value) 的 value */
function lastSetValue(key: string): any {
  const calls = vi.mocked(setValue).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i][0] === key) return calls[i][1];
  }
  return undefined;
}

/**
 * 构造一个已完成 initialize 的实例：
 * 先设定 storageData，再 initialize（模拟 SW 启动时读到的基线快照）
 */
async function initManager(): Promise<any> {
  const manager = new NewWorksManager() as any;
  await manager.initialize();
  return manager;
}

describe('NewWorksManager 跨上下文陈旧快照防复活（S1.1-F1）', () => {
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

  it('他处删除订阅 A 后，本实例 markSubscriptionChecked(B) 的全量回写不含 A', async () => {
    storageData = {
      new_works_subscriptions: { A: makeSub('A'), B: makeSub('B') },
      new_works_records: {},
    };
    const manager = await initManager();
    expect(manager.subscriptions.size).toBe(2);

    // dashboard 侧删除订阅 A（存储中已无 A，SW 内存仍陈旧持有）
    storageData = {
      new_works_subscriptions: { B: makeSub('B') },
      new_works_records: {},
    };

    await manager.markSubscriptionChecked('B');

    const written = lastSetValue('new_works_subscriptions');
    expect(Object.keys(written).sort()).toEqual(['B']);
    expect(written.B.lastCheckTime).toBeTypeOf('number');
    // 内存同步移除他处已删项
    expect(manager.subscriptions.has('A')).toBe(false);
  });

  it('他处删除订阅 A 后，本实例新增订阅 C 不回写 A（脏白名单保护 C）', async () => {
    storageData = {
      new_works_subscriptions: { A: makeSub('A'), B: makeSub('B') },
      new_works_records: {},
    };
    const manager = await initManager();

    // dashboard 侧删除 A
    storageData = {
      new_works_subscriptions: { B: makeSub('B') },
      new_works_records: {},
    };

    await manager.addSubscription('C');

    const written = lastSetValue('new_works_subscriptions');
    expect(Object.keys(written).sort()).toEqual(['B', 'C']);
  });

  it('他处新增订阅 C 后，本实例保存时并入 C（不误删他处新增）', async () => {
    storageData = {
      new_works_subscriptions: { A: makeSub('A') },
      new_works_records: {},
    };
    const manager = await initManager();

    // dashboard 侧新增 C
    storageData = {
      new_works_subscriptions: { A: makeSub('A'), C: makeSub('C') },
      new_works_records: {},
    };

    await manager.markSubscriptionChecked('A');

    const written = lastSetValue('new_works_subscriptions');
    expect(Object.keys(written).sort()).toEqual(['A', 'C']);
  });

  it('本实例 removeSubscription 不被存储旧值重新合并（本地删除墓碑）', async () => {
    storageData = {
      new_works_subscriptions: { A: makeSub('A'), B: makeSub('B') },
      new_works_records: {},
    };
    const manager = await initManager();

    await manager.removeSubscription('A');

    const written = lastSetValue('new_works_subscriptions');
    expect(Object.keys(written).sort()).toEqual(['B']);
  });

  it('他处删除作品 W1 后，本实例 addNewWork(W3) 的兼容键与 IDB 批量写均不含 W1', async () => {
    storageData = {
      new_works_subscriptions: {},
      new_works_records: { W1: makeWork('W1'), W2: makeWork('W2') },
    };
    const manager = await initManager();
    expect(manager.newWorks.size).toBe(2);

    // dashboard 侧删除 W1（兼容键 + IDB 均已删，SW 内存仍陈旧持有）
    storageData = {
      new_works_subscriptions: {},
      new_works_records: { W2: makeWork('W2') },
    };

    await manager.addNewWork(makeWork('W3'));

    const written = lastSetValue('new_works_records');
    expect(Object.keys(written).sort()).toEqual(['W2', 'W3']);
    // saveNewWorks 的全量 IDB 批量写同样不含 W1
    const bulkArgs = vi.mocked(newWorksBulkPut).mock.calls.map((c) => c[0] as NewWorkRecord[]);
    const allBulkIds = new Set(bulkArgs.flat().map((w) => w.id));
    expect(allBulkIds.has('W1')).toBe(false);
    expect(allBulkIds.has('W3')).toBe(true);
  });

  it('本实例 deleteWorks 不被存储旧值重新合并（本地删除墓碑）', async () => {
    storageData = {
      new_works_subscriptions: {},
      new_works_records: { W1: makeWork('W1'), W2: makeWork('W2') },
    };
    const manager = await initManager();

    await manager.deleteWorks(['W1']);

    const written = lastSetValue('new_works_records');
    expect(Object.keys(written).sort()).toEqual(['W2']);
  });

  it('markAsRead 对 IDB 已删作品零回写（不复活）', async () => {
    storageData = {
      new_works_subscriptions: {},
      new_works_records: { W1: makeWork('W1') },
    };
    const manager = await initManager();

    // IDB 中 W1 已被删除（dbNewWorksGet 返回 null）
    vi.mocked(dbNewWorksGet).mockResolvedValue(null as any);

    await manager.markAsRead(['W1']);

    // 不得用内存副本回写 IDB，也不得触发全量保存
    expect(vi.mocked(newWorksBulkPut)).not.toHaveBeenCalled();
    expect(vi.mocked(newWorksPut)).not.toHaveBeenCalled();
    expect(lastSetValue('new_works_records')).toBeUndefined();
  });

  it('markAsRead 正常路径仍直写 IDB 并持久化', async () => {
    const work = makeWork('W1');
    storageData = {
      new_works_subscriptions: {},
      new_works_records: { W1: work },
    };
    const manager = await initManager();

    vi.mocked(dbNewWorksGet).mockImplementation(async () => ({ ...work }));

    await manager.markAsRead(['W1']);

    const bulkArgs = vi.mocked(newWorksBulkPut).mock.calls.map((c) => c[0] as NewWorkRecord[]);
    const putIds = bulkArgs.flat().map((w) => w.id);
    expect(putIds).toContain('W1');
    expect(lastSetValue('new_works_records')?.W1?.isRead).toBe(true);
  });
});
