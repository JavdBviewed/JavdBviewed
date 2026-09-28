/**
 * @file backgroundMessages.restartReload.test.ts
 * @description 批 3a：'new-works-scheduler-restart' 消息路径——dashboard 保存新作品配置后
 *              发此消息给 SW；SW 必须先 reloadGlobalConfig()（刷新内存全局配置）再
 *              scheduler.restart()，使 start() 按新配置定 alarm 周期。
 *              run10 真机实证缺陷：未先 reload 时 restart/start 拿到陈旧配置，
 *              保存类别白/黑名单后单演员检查仍按旧配置执行（P3 验收阻塞）。
 *              与 storage.onChanged('new_works_config') 路径的 reload 为有意冗余（幂等）。
 * @module features/newWorks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { schedulerRestart } = vi.hoisted(() => ({
  schedulerRestart: vi.fn(async () => undefined),
}));

// ---------- 依赖 mock（与 manager.reloadConfig.test.ts 同构） ----------

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

// barrel 单例：manager 用真实类（验证 reload 真实读取路径），scheduler 仅留 restart 副作用桩
vi.mock('./index', async () => {
  const { NewWorksManager } = await import('./manager');
  return {
    newWorksManager: new NewWorksManager(),
    newWorksCollector: {},
    newWorksScheduler: { restart: schedulerRestart },
  };
});

import { handleNewWorksRuntimeMessage } from './backgroundMessages';
import { newWorksManager } from './index';
import { getValue } from '../../utils/storage';

// ---------- 测试辅助 ----------

let storageData: Record<string, unknown> = {};

/** 注册 getValue 实现（需在 beforeEach 中调用：restoreMocks 会逐测试恢复工厂默认实现） */
function registerStorageMock(): void {
  vi.mocked(getValue).mockImplementation(async (key: string, fallback?: unknown) => {
    const v = (storageData as Record<string, unknown>)[key];
    if (v && typeof v === 'object') return JSON.parse(JSON.stringify(v));
    return fallback;
  });
}

/** 冲刷微/宏任务链（reload → restart → sendResponse 均为异步 then 链） */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
}

const CFG_V1 = {
  checkInterval: 24,
  requestInterval: 3,
  autoCheckEnabled: true,
  showActorPageScanButton: false,
  maxWorksPerCheck: 100,
  filters: {
    excludeViewed: true,
    categoryFilters: [] as string[],
    categoryBlackFilters: [] as string[],
  },
};

describe("'new-works-scheduler-restart' 消息路径（批 3a：先 reload 再 restart）", () => {
  beforeEach(() => {
    storageData = {};
    registerStorageMock();
    schedulerRestart.mockClear();
    schedulerRestart.mockResolvedValue(undefined);
  });

  it('保存新配置后发 restart 消息：先刷新内存配置再重启，响应 success，后续 getGlobalConfig=新值', async () => {
    // 1) SW 启动：读旧配置（白/黑均空）
    storageData = {
      new_works_config: CFG_V1,
      new_works_subscriptions: {},
      new_works_records: {},
    };
    await newWorksManager.initialize();
    const before = (await newWorksManager.getGlobalConfig()) as any;
    expect(before.filters.categoryFilters).toEqual([]);
    expect(before.filters.categoryBlackFilters).toEqual([]);

    // 2) dashboard 页保存新配置（写存储后发 restart 消息）
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

    // 3) 发送 restart 消息
    const responses: unknown[] = [];
    const spy = vi.fn((r: unknown) => responses.push(r));
    const handled = handleNewWorksRuntimeMessage({ type: 'new-works-scheduler-restart' }, spy);
    expect(handled).toBe(true); // 异步应答

    // 4) 等待 reload → restart → sendResponse 异步链完成
    await flush();

    expect(responses).toEqual([{ success: true }]);
    expect(schedulerRestart).toHaveBeenCalledTimes(1);
    // 内存配置已刷新：restart() 的 start() 将按新配置定 alarm 周期
    const after = (await newWorksManager.getGlobalConfig()) as any;
    expect(after.filters.categoryFilters).toEqual(['c1=200']);
    expect(after.filters.categoryBlackFilters).toEqual(['c6=93']);
  });

  it('reload 失败时不 restart，响应 success:false 带错误信息', async () => {
    storageData = {
      new_works_config: CFG_V1,
      new_works_subscriptions: {},
      new_works_records: {},
    };
    await newWorksManager.initialize();

    // 让 reload 的读存储抛错（simulate storage 故障）
    vi.mocked(getValue).mockRejectedValueOnce(new Error('storage boom'));
    // 注意：reloadGlobalConfig 内先 await this.initialize()（isLoaded 直接返回，不读存储），
    // 随后 readMigratedGlobalConfig 读 NEW_WORKS_CONFIG 时命中本次 reject
    const responses: unknown[] = [];
    const spy = vi.fn((r: unknown) => responses.push(r));
    handleNewWorksRuntimeMessage({ type: 'new-works-scheduler-restart' }, spy);
    await flush();

    expect(responses).toEqual([{ success: false, error: 'storage boom' }]);
    expect(schedulerRestart).not.toHaveBeenCalled();
  });
});
