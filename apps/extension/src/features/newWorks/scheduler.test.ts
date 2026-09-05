/**
 * @file scheduler.test.ts
 * @description 新作品调度器 chrome.alarms 路径单测
 * @module features/newWorks
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NEW_WORKS_CHECK_ALARM,
  NewWorksScheduler,
  resolveNewWorksPeriodInMinutes,
} from './scheduler';

function createManagerMock(config: {
  autoCheckEnabled?: boolean;
  checkInterval?: number;
  lastGlobalCheck?: number;
}) {
  const state = {
    autoCheckEnabled: config.autoCheckEnabled ?? true,
    checkInterval: config.checkInterval ?? 1,
    lastGlobalCheck: config.lastGlobalCheck,
  };

  return {
    initialize: vi.fn(async () => undefined),
    getGlobalConfig: vi.fn(async () => ({ ...state })),
    updateGlobalConfig: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(state, patch);
    }),
    getSubscriptions: vi.fn(async () => [
      { actorId: 'a1', actorName: 'Actor', enabled: true },
    ]),
    addNewWorks: vi.fn(async () => ({ total: 0, saved: 0, failed: 0 })),
  };
}

function createCollectorMock() {
  return {
    checkMultipleActors: vi.fn(async () => ({
      discovered: 0,
      errors: [],
      newWorks: [],
    })),
  };
}

describe('resolveNewWorksPeriodInMinutes', () => {
  it('converts hours to minutes with a minimum of 1', () => {
    expect(resolveNewWorksPeriodInMinutes(1)).toBe(60);
    expect(resolveNewWorksPeriodInMinutes(0.01)).toBe(1);
    expect(resolveNewWorksPeriodInMinutes(24)).toBe(1440);
  });
});

describe('NewWorksScheduler alarms', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  beforeEach(() => {
    vi.clearAllMocks();
    const clear = vi.fn((_name?: string, cb?: (wasCleared: boolean) => void) => {
      cb?.(true);
      return Promise.resolve(true);
    });
    const create = vi.fn((_name: string, _info: unknown) => Promise.resolve());
    (globalThis as any).chrome = {
      alarms: { create, clear, get: vi.fn() },
      notifications: {
        create: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
        onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      runtime: { getURL: (path: string) => path },
      tabs: { create: vi.fn() },
    };
  });

  afterEach(() => {
    if (originalChrome === undefined) delete (globalThis as any).chrome;
    else (globalThis as any).chrome = originalChrome;
  });

  it('creates periodic alarm when autoCheck is enabled', async () => {
    const scheduler = new NewWorksScheduler();
    const manager = createManagerMock({
      autoCheckEnabled: true,
      checkInterval: 2,
      lastGlobalCheck: Date.now(),
    });
    const collector = createCollectorMock();
    scheduler.setDependencies(manager as any, collector as any);

    await scheduler.start();

    expect(chrome.alarms.clear).toHaveBeenCalledWith(NEW_WORKS_CHECK_ALARM, expect.any(Function));
    expect(chrome.alarms.create).toHaveBeenCalledWith(NEW_WORKS_CHECK_ALARM, {
      delayInMinutes: 120,
      periodInMinutes: 120,
    });
    expect(scheduler.getStatus().isRunning).toBe(true);
  });

  it('clears alarm when stop is called', async () => {
    const scheduler = new NewWorksScheduler();
    const manager = createManagerMock({
      autoCheckEnabled: true,
      checkInterval: 1,
      lastGlobalCheck: Date.now(),
    });
    const collector = createCollectorMock();
    scheduler.setDependencies(manager as any, collector as any);

    await scheduler.start();
    await scheduler.stop();

    expect(chrome.alarms.clear).toHaveBeenCalledWith(NEW_WORKS_CHECK_ALARM, expect.any(Function));
    expect(scheduler.getStatus().isRunning).toBe(false);
  });

  it('initialize clears alarm when autoCheck is disabled', async () => {
    const scheduler = new NewWorksScheduler();
    const manager = createManagerMock({
      autoCheckEnabled: false,
      checkInterval: 6,
    });
    const collector = createCollectorMock();
    scheduler.setDependencies(manager as any, collector as any);

    await scheduler.initialize();

    expect(chrome.alarms.clear).toHaveBeenCalledWith(NEW_WORKS_CHECK_ALARM, expect.any(Function));
    expect(chrome.alarms.create).not.toHaveBeenCalled();
    expect(scheduler.getStatus().isRunning).toBe(false);
    expect(scheduler.getStatus().isInitialized).toBe(true);
  });

  it('handleAlarm records persistence failure when addNewWorks reports failed>0', async () => {
    const scheduler = new NewWorksScheduler();
    const manager = createManagerMock({
      autoCheckEnabled: true,
      checkInterval: 1,
      lastGlobalCheck: Date.now(),
    });
    // 模拟：发现 3 个新作品，其中 1 个持久化失败
    (manager.addNewWorks as any).mockImplementation(async (works: any[]) => ({
      total: works.length,
      saved: works.length - 1,
      failed: 1,
    }));
    const collector = createCollectorMock();
    (collector.checkMultipleActors as any).mockImplementation(async () => ({
      discovered: 3,
      errors: [],
      newWorks: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
    }));
    scheduler.setDependencies(manager as any, collector as any);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const handled = await scheduler.handleAlarm(NEW_WORKS_CHECK_ALARM);
      expect(handled).toBe(true);
      expect(manager.addNewWorks).toHaveBeenCalledTimes(1);
      // 持久化失败应被记录到错误通道（通过 console.warn 暴露）
      expect(warnSpy).toHaveBeenCalledWith(
        'NewWorksScheduler: 采集过程中遇到错误:',
        expect.arrayContaining([
          expect.stringContaining('持久化失败: 2/3 个新作品未写入 IndexedDB'),
        ]),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('handleAlarm runs collection for the periodic alarm name', async () => {
    const scheduler = new NewWorksScheduler();
    const manager = createManagerMock({
      autoCheckEnabled: true,
      checkInterval: 1,
      lastGlobalCheck: Date.now(),
    });
    const collector = createCollectorMock();
    scheduler.setDependencies(manager as any, collector as any);

    const handled = await scheduler.handleAlarm(NEW_WORKS_CHECK_ALARM);
    expect(handled).toBe(true);
    expect(collector.checkMultipleActors).toHaveBeenCalled();
    expect(manager.updateGlobalConfig).toHaveBeenCalledWith(
      expect.objectContaining({ lastGlobalCheck: expect.any(Number) }),
    );

    const ignored = await scheduler.handleAlarm('other.alarm');
    expect(ignored).toBe(false);
  });
});
