/**
 * @file backgroundMessages.scanState.test.ts
 * @description 手动扫描状态机 × 消息路由集成单测：真实 store 实例（createManualScanStateStore +
 *              内存 fake storage）经 vi.mock 替换单例绑定，走真实 handleNewWorksRuntimeMessage 入口。
 *              覆盖：双扫描守卫（claim 拒绝 → manual-check-running，不读配置）；全链路
 *              begin→progress→finish 终态落盘 + finished 终态广播（resultSummary 同口径）；
 *              new-works-manual-scan-status 三态（idle / running 不消费 / terminal 查询即消费 /
 *              跨 session running → interrupted 消费）；new-works-manual-scan-ack 只清 terminal；
 *              错误路径 release 清占位清盘 + error 终态广播；取消路径 finish(cancelled)。
 * @module features/newWorks
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fns, storageState, fakeStorage } = vi.hoisted(() => {
  const fns = {
    getGlobalConfig: vi.fn(),
    getSubscriptions: vi.fn(),
    addNewWorks: vi.fn(),
    markSubscriptionChecked: vi.fn(),
    updateGlobalConfig: vi.fn(),
    checkActorNewWorksDetailed: vi.fn(),
    sendMessage: vi.fn(),
  };
  const storageState = new Map<string, unknown>();
  const fakeStorage = {
    get: vi.fn(async (key: string) => (storageState.has(key) ? storageState.get(key) : null)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) storageState.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      storageState.delete(key);
    }),
  };
  return { fns, storageState, fakeStorage };
});

vi.mock('./index', () => ({
  newWorksManager: {
    getGlobalConfig: fns.getGlobalConfig,
    getSubscriptions: fns.getSubscriptions,
    addNewWorks: fns.addNewWorks,
    markSubscriptionChecked: fns.markSubscriptionChecked,
    updateGlobalConfig: fns.updateGlobalConfig,
  },
  newWorksCollector: { checkActorNewWorksDetailed: fns.checkActorNewWorksDetailed },
  newWorksScheduler: { restart: vi.fn(), getStatus: vi.fn() },
}));

vi.mock('./newWorksScanState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./newWorksScanState')>();
  return {
    ...actual,
    // 测试实例：真实工厂 + 内存 storage，与 backgroundMessages 持有的绑定同实例
    manualScanStore: actual.createManualScanStateStore({
      sessionId: 'sess-test',
      storage: fakeStorage,
      progressThrottleMs: 0,
    }),
  };
});

import { handleNewWorksRuntimeMessage } from './backgroundMessages';
import { MANUAL_SCAN_STATE_KEY, manualScanStore } from './newWorksScanState';

const BASE_CONFIG = {
  checkInterval: 86400000,
  requestInterval: 0,
  concurrency: 1,
  maxWorksPerCheck: 100,
  filters: {},
};

const SUMMARY = {
  discovered: 2,
  identifiedTotal: 8,
  pendingCount: 2,
  existingCount: 2,
  cancelled: false,
  errorCount: 0,
};

function makeSub(actorId: string, actorName: string) {
  return { actorId, actorName, enabled: true, subscribedAt: 1 };
}

function makeWork(id: string, actorId = 'st1', actorName = 'Alice') {
  return {
    id,
    actorId,
    actorName,
    title: `title-${id}`,
    releaseDate: '2026-09-01',
    javdbUrl: `https://example.invalid/v/${id}`,
    coverImage: `https://example.invalid/c/${id}.jpg`,
    tags: [],
    discoveredAt: 1700000000000,
    isRead: false,
    status: 'new',
  };
}

function makeDetailed(over: Record<string, unknown> = {}) {
  return {
    works: [],
    identified: 0,
    effective: 0,
    filteredOut: 0,
    existingCount: 0,
    filterBreakdown: { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 },
    ...over,
  };
}

function makeStoredState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'running',
    startedAt: 1000,
    swSessionId: 'sess-test',
    processed: 1,
    total: 5,
    identifiedTotal: 2,
    pendingTotal: 1,
    activeActorNames: ['A'],
    concurrency: 1,
    ...overrides,
  };
}

/** 走真实消息入口，等 sendResponse */
function send(message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    const handled = handleNewWorksRuntimeMessage(message as any, resolve as any);
    if (handled === false) resolve({ __unhandled: true });
  });
}

async function flush(times = 16): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise(r => setTimeout(r, 0));
}

function progressBroadcasts(): any[] {
  return fns.sendMessage.mock.calls
    .map(call => call[0])
    .filter((msg: any) => msg?.type === 'new-works-progress');
}

beforeEach(async () => {
  fns.getGlobalConfig.mockResolvedValue({ ...BASE_CONFIG });
  fns.getSubscriptions.mockResolvedValue([]);
  fns.addNewWorks.mockResolvedValue({ total: 0, saved: 0, failed: 0 });
  fns.markSubscriptionChecked.mockResolvedValue(undefined);
  fns.updateGlobalConfig.mockResolvedValue(undefined);
  fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed());
  fns.sendMessage.mockImplementation(() => undefined);
  storageState.clear();
  await manualScanStore.release();
  vi.stubGlobal('chrome', { runtime: { sendMessage: fns.sendMessage } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('双扫描守卫', () => {
  it('运行中再发 manual-check → manual-check-running 拒绝，不读配置不启动', async () => {
    await manualScanStore.reconcile();
    expect(manualScanStore.claim()).toBe(true); // 模拟在途扫描已占位

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response).toEqual({ success: false, error: 'manual-check-running' });
    expect(fns.getGlobalConfig).not.toHaveBeenCalled();
    expect(fns.getSubscriptions).not.toHaveBeenCalled();
    expect(storageState.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });
});

describe('manual-check 状态机接线', () => {
  it('全链路：begin 落盘 → finish done 终态+摘要，终态广播 finished+resultSummary', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice'), makeSub('st2', 'Bob')]);
    fns.checkActorNewWorksDetailed.mockImplementation(async (sub: any) => makeDetailed({
      works: [makeWork(`W-${sub.actorId}`, sub.actorId, sub.actorName)],
      identified: 4,
      effective: 2,
      existingCount: 1,
    }));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response.success).toBe(true);
    expect(response.result).toMatchObject({ discovered: 2, identifiedTotal: 8, cancelled: false, errors: [] });

    const state = storageState.get(MANUAL_SCAN_STATE_KEY) as any;
    expect(state).toMatchObject({
      status: 'done',
      swSessionId: 'sess-test',
      total: 2,
      concurrency: 1,
      processed: 2,
      identifiedTotal: 8,
      pendingTotal: 2,
    });
    expect(state.result).toEqual(SUMMARY);

    const broadcasts = progressBroadcasts();
    expect(broadcasts.length).toBeGreaterThan(1);
    expect(broadcasts.some((m) => !m.payload.finished)).toBe(true); // 进度广播不带终态标记
    expect(broadcasts[broadcasts.length - 1].payload).toMatchObject({ finished: true, cancelled: false });
    expect(broadcasts[broadcasts.length - 1].payload.resultSummary).toEqual(SUMMARY);
  });

  it('取消路径：finish 写 cancelled 终态（result.cancelled=true）', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice'), makeSub('st2', 'Bob')]);
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    fns.checkActorNewWorksDetailed.mockImplementation(async (sub: any) => {
      if (sub.actorId === 'st1') await firstGate;
      return makeDetailed({ works: [makeWork(`W-${sub.actorId}`, sub.actorId, sub.actorName)], identified: 1, effective: 1 });
    });

    const checkPromise = send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush(); // 首个演员进入采集（门控挂起）
    await send({ type: 'new-works-manual-cancel' });
    releaseFirst();
    const response = await checkPromise;
    await flush();

    expect(response.success).toBe(true);
    expect(response.result.cancelled).toBe(true);
    const state = storageState.get(MANUAL_SCAN_STATE_KEY) as any;
    expect(state.status).toBe('cancelled');
    expect(state.result).toMatchObject({ cancelled: true, pendingCount: 1 });
    expect(progressBroadcasts().at(-1)?.payload).toMatchObject({ finished: true, cancelled: true });
  });

  it('错误路径：release 清占位+清盘，发 error 终态广播', async () => {
    fns.getGlobalConfig.mockRejectedValue(new Error('config boom'));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response).toEqual({ success: false, error: 'config boom' });
    expect(manualScanStore.claim()).toBe(true); // 占位已释放，可再次发起
    expect(storageState.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
    expect(progressBroadcasts().at(-1)?.payload).toMatchObject({ finished: true, error: true });
  });
});

describe('new-works-manual-scan-status 查询通道', () => {
  it('无扫描 → idle', async () => {
    const response = await send({ type: 'new-works-manual-scan-status' });
    expect(response).toEqual({ success: true, status: { status: 'idle' } });
  });

  it('running（本 session）→ 原样返回不消费', async () => {
    storageState.set(MANUAL_SCAN_STATE_KEY, makeStoredState({ status: 'running', swSessionId: 'sess-test' }));

    const response = await send({ type: 'new-works-manual-scan-status' });

    expect(response.success).toBe(true);
    expect(response.status).toMatchObject({ status: 'running', processed: 1, total: 5 });
    expect(response.status.consumed).toBeUndefined();
    expect(storageState.has(MANUAL_SCAN_STATE_KEY)).toBe(true);
  });

  it('terminal → 查询即消费（consumed=true + 清盘）', async () => {
    storageState.set(MANUAL_SCAN_STATE_KEY, makeStoredState({ status: 'done', result: SUMMARY }));

    const response = await send({ type: 'new-works-manual-scan-status' });

    expect(response.status).toMatchObject({ status: 'done', consumed: true, result: SUMMARY });
    expect(storageState.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });

  it('上一 session 的 running → reconcile 为 interrupted 后消费返回', async () => {
    storageState.set(MANUAL_SCAN_STATE_KEY, makeStoredState({ status: 'running', swSessionId: 'sess-prev' }));

    const response = await send({ type: 'new-works-manual-scan-status' });

    expect(response.status).toMatchObject({ status: 'interrupted', consumed: true, processed: 1 });
    expect(storageState.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });
});

describe('new-works-manual-scan-ack 消费确认', () => {
  it('清 terminal 状态', async () => {
    storageState.set(MANUAL_SCAN_STATE_KEY, makeStoredState({ status: 'cancelled', result: SUMMARY }));

    const response = await send({ type: 'new-works-manual-scan-ack' });

    expect(response).toEqual({ success: true });
    expect(storageState.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });

  it('不动 running（防误清在途扫描）', async () => {
    storageState.set(MANUAL_SCAN_STATE_KEY, makeStoredState({ status: 'running', swSessionId: 'sess-test' }));

    const response = await send({ type: 'new-works-manual-scan-ack' });

    expect(response).toEqual({ success: true });
    expect(storageState.has(MANUAL_SCAN_STATE_KEY)).toBe(true);
  });
});
