/**
 * @file manager.newWorksPersist.test.ts
 * @description #42 回归：addNewWorks 必须直接写 IndexedDB 并返回真实持久化统计，
 *              不再走 SW 内无接收端的 runtime 消息路径（历史上导致 0/N 全部失败）。
 * @module features/newWorks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- 依赖 mock（切断真实存储 / 消息传递 / 外部服务） ----------

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
  actorManager: {},
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
import {
  dbNewWorksBulkPut,
  dbNewWorksPut,
} from '../../dashboard/dbClient';
import { recordNewWorksDiagnosticError } from './newWorksDiagnostics';

// 说明：dbNewWorksPut / dbNewWorksBulkPut 仅用于断言"消息路径已死"
// （mock 模块中它们存在但 manager 不应再调用）

function makeWork(id: string): any {
  return {
    id,
    code: id,
    title: `作品 ${id}`,
    actorId: 'actor-1',
    actorName: '测试演员',
    discoveredAt: Date.now(),
    isRead: false,
  };
}

describe('NewWorksManager.addNewWorks 持久化（#42）', () => {
  beforeEach(() => {
    vi.mocked(newWorksPut).mockResolvedValue(undefined);
    vi.mocked(newWorksBulkPut).mockResolvedValue(undefined);
  });

  it('逐条直写 IndexedDB，并返回 { total, saved, failed } 统计', async () => {
    const manager = new NewWorksManager();
    const works = [makeWork('AAA-001'), makeWork('AAA-002'), makeWork('AAA-003')];

    const stats = await manager.addNewWorks(works);

    expect(stats).toEqual({ total: 3, saved: 3, failed: 0 });
    expect(vi.mocked(newWorksPut)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(newWorksPut)).toHaveBeenNthCalledWith(1, works[0]);
    expect(vi.mocked(newWorksPut)).toHaveBeenNthCalledWith(2, works[1]);
    expect(vi.mocked(newWorksPut)).toHaveBeenNthCalledWith(3, works[2]);
    // chrome.storage 兼容写入仍然存在
    expect(vi.mocked(setValue)).toHaveBeenCalled();
  });

  it('部分写入失败时如实统计 failed，且不抛出异常', async () => {
    const manager = new NewWorksManager();
    vi.mocked(newWorksPut).mockImplementation(async (work: any) => {
      if (work.id === 'AAA-002') throw new Error('QuotaExceededError');
    });

    const stats = await manager.addNewWorks([makeWork('AAA-001'), makeWork('AAA-002'), makeWork('AAA-003')]);

    expect(stats).toEqual({ total: 3, saved: 2, failed: 1 });
    expect(vi.mocked(recordNewWorksDiagnosticError)).toHaveBeenCalledWith(
      'newworks_add_persist_failed',
      expect.any(Error),
    );
  });

  it('不再调用消息传递 API（DB:NEWWORKS_PUT 路径已移除）', async () => {
    const manager = new NewWorksManager();

    await manager.addNewWorks([makeWork('BBB-001')]);
    await manager.addNewWork(makeWork('BBB-002'));

    expect(vi.mocked(dbNewWorksPut)).not.toHaveBeenCalled();
    expect(vi.mocked(dbNewWorksBulkPut)).not.toHaveBeenCalled();
    expect(vi.mocked(newWorksPut)).toHaveBeenCalledTimes(2);
  });

  it('空列表直接返回零统计，不产生任何写入', async () => {
    const manager = new NewWorksManager();

    const stats = await manager.addNewWorks([]);

    expect(stats).toEqual({ total: 0, saved: 0, failed: 0 });
    expect(vi.mocked(newWorksPut)).not.toHaveBeenCalled();
    expect(vi.mocked(newWorksBulkPut)).not.toHaveBeenCalled();
  });
});

describe('NewWorksManager.markSubscriptionChecked（#42 最后检查时间）', () => {
  it('存在订阅时更新 lastCheckTime 并持久化', async () => {
    const manager = new NewWorksManager() as any;
    // 先完成 initialize（其后 initialize 幂等跳过，不会再清空内存订阅）
    await manager.initialize();
    manager.subscriptions.set('actor-1', {
      actorId: 'actor-1',
      actorName: '测试演员',
      enabled: true,
      subscribedAt: Date.now(),
    });

    await manager.markSubscriptionChecked('actor-1');

    expect(manager.subscriptions.get('actor-1').lastCheckTime).toBeTypeOf('number');
    expect(vi.mocked(setValue)).toHaveBeenCalledWith(
      'new_works_subscriptions',
      expect.objectContaining({
        'actor-1': expect.objectContaining({ lastCheckTime: expect.any(Number) }),
      }),
    );
  });

  it('不存在的订阅静默跳过', async () => {
    const manager = new NewWorksManager();

    await expect(manager.markSubscriptionChecked('no-such-actor')).resolves.toBeUndefined();
    expect(vi.mocked(setValue)).not.toHaveBeenCalled();
  });

  it('内存订阅表陈旧时（SW 先于订阅创建启动）从存储合并并更新 lastCheckTime', async () => {
    const manager = new NewWorksManager() as any;
    // 先以空订阅表完成 initialize（其后 initialize 幂等跳过，模拟 SW 早期启动）
    await manager.initialize();
    expect(manager.subscriptions.size).toBe(0);

    // 存储中已由 dashboard 侧写入订阅（SW 内存中不存在）
    const storedSub = {
      actorId: 'actor-2',
      actorName: '存储演员',
      enabled: true,
      subscribedAt: Date.now(),
    };
    vi.mocked(getValue).mockImplementation(async (key: string, fallback?: unknown) => {
      if (key === 'new_works_subscriptions') return { 'actor-2': storedSub };
      return fallback;
    });

    await manager.markSubscriptionChecked('actor-2');

    expect(manager.subscriptions.get('actor-2')?.lastCheckTime).toBeTypeOf('number');
    expect(vi.mocked(setValue)).toHaveBeenCalledWith(
      'new_works_subscriptions',
      expect.objectContaining({
        'actor-2': expect.objectContaining({ lastCheckTime: expect.any(Number) }),
      }),
    );
  });
});
