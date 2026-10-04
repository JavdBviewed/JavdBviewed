/**
 * @file backgroundMessages.pendingBatch.test.ts
 * @description 10-19：pending 批次持久化 × 消息路由集成单测（真实 store 实例经 vi.mock 替换单例绑定，
 *              走真实 handleNewWorksRuntimeMessage 入口）：
 *              confirm 终态 pending>0 → 批次落盘（works 逐字 + 元信息 + cancelled/done 映射）；
 *              pending=0 不持久化；超阈值跳过（响应零漂移）；非 confirm 直写模式不写；
 *              错误路径不写；新扫描覆盖旧批次；new-works-manual-pending-fetch 只读；
 *              new-works-manual-pending-consume 清盘（幂等）；live 响应 pendingWorks 零漂移。
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
    manualScanStore: actual.createManualScanStateStore({
      sessionId: 'sess-test',
      storage: fakeStorage,
      progressThrottleMs: 0,
    }),
  };
});

vi.mock('./newWorksManualPendingBatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./newWorksManualPendingBatch')>();
  return {
    ...actual,
    manualPendingBatchStore: actual.createManualPendingBatchStore({ storage: fakeStorage }),
  };
});

import { handleNewWorksRuntimeMessage } from './backgroundMessages';
import { manualScanStore } from './newWorksScanState';
import { MANUAL_PENDING_BATCH_KEY, manualPendingBatchStore, MAX_MANUAL_PENDING_BATCH_WORKS } from './newWorksManualPendingBatch';

const BASE_CONFIG = {
  checkInterval: 86400000,
  requestInterval: 0,
  concurrency: 1,
  maxWorksPerCheck: 100,
  filters: {},
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

function send(message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    const handled = handleNewWorksRuntimeMessage(message as any, resolve as any);
    if (handled === false) resolve({ __unhandled: true });
  });
}

async function flush(times = 16): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise(r => setTimeout(r, 0));
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
  await manualPendingBatchStore.consume().catch(() => undefined);
  await manualScanStore.release();
  vi.stubGlobal('chrome', { runtime: { sendMessage: fns.sendMessage } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});


describe('confirm 终态 → pending 批次持久化', () => {
  it('pending>0（done）→ 批次落盘：works 逐字 + 元信息 + 响应 pendingWorks 零漂移', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice'), makeSub('st2', 'Bob')]);
    const works = [makeWork('W1', 'st1', 'Alice'), makeWork('W2', 'st2', 'Bob')];
    fns.checkActorNewWorksDetailed.mockImplementation(async (sub: any) => makeDetailed({
      works: sub.actorId === 'st1' ? [works[0]] : [works[1]],
      identified: 4,
      effective: 2,
      existingCount: 1,
    }));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response.success).toBe(true);
    // 响应逐字零漂移：pendingWorks 仍是完整记录
    expect(response.result.pendingWorks).toEqual(works);

    const batch = storageState.get(MANUAL_PENDING_BATCH_KEY) as any;
    expect(batch).toMatchObject({
      status: 'done',
      pendingCount: 2,
      identifiedTotal: 8,
      existingCount: 2,
    });
    expect(batch.works).toEqual(works);
    expect(batch.breakdown).toMatchObject({ dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 });
    expect(typeof batch.startedAt).toBe('number');
    expect(typeof batch.terminalAt).toBe('number');
    expect(batch.terminalAt).toBeGreaterThanOrEqual(batch.startedAt);
  });

  it('pending>0（cancelled）→ 批次 status=cancelled（用户扫描中取消）', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice'), makeSub('st2', 'Bob')]);
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    fns.checkActorNewWorksDetailed.mockImplementation(async (sub: any) => {
      if (sub.actorId === 'st1') await firstGate;
      return makeDetailed({ works: [makeWork(`W-${sub.actorId}`, sub.actorId, sub.actorName)], identified: 1, effective: 1 });
    });

    const checkPromise = send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();
    await send({ type: 'new-works-manual-cancel' });
    releaseFirst();
    const response = await checkPromise;
    await flush();

    expect(response.result.cancelled).toBe(true);
    const batch = storageState.get(MANUAL_PENDING_BATCH_KEY) as any;
    expect(batch).toMatchObject({ status: 'cancelled', pendingCount: 1 });
    expect(batch.works).toHaveLength(1);
  });

  it('pending=0 → 不持久化（保持现状：无可入库，无批次）', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice')]);
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed({ identified: 3 }));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response.result.pendingWorks).toEqual([]);
    expect(storageState.has(MANUAL_PENDING_BATCH_KEY)).toBe(false);
  });

  it('超阈值 → 跳过持久化 + log，响应零漂移（现状：仅摘要 toast）', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice')]);
    const works = Array.from({ length: MAX_MANUAL_PENDING_BATCH_WORKS + 1 }, (_, i) => makeWork(`W${i}`, 'st1', 'Alice'));
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed({ works, identified: works.length }));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response.success).toBe(true);
    expect(response.result.pendingWorks).toHaveLength(MAX_MANUAL_PENDING_BATCH_WORKS + 1);
    expect(storageState.has(MANUAL_PENDING_BATCH_KEY)).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });

  it('非 confirm 直写模式 → 不写批次（作品已当场入库）', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice')]);
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed({ works: [makeWork('W1')], identified: 1 }));

    const response = await send({ type: 'new-works-manual-check' });
    await flush();

    expect(response.success).toBe(true);
    expect(response.result).not.toHaveProperty('pendingWorks');
    expect(fns.addNewWorks).toHaveBeenCalled();
    expect(storageState.has(MANUAL_PENDING_BATCH_KEY)).toBe(false);
  });

  it('错误路径（config 异常 → release）→ 不写批次 + error 终态广播', async () => {
    fns.getGlobalConfig.mockRejectedValue(new Error('config boom'));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response).toEqual({ success: false, error: 'config boom' });
    expect(storageState.has(MANUAL_PENDING_BATCH_KEY)).toBe(false);
  });

  it('新 confirm 扫描终态覆盖旧未确认批次（不合并 + log 登记）', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice')]);
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed({ works: [makeWork('W1')], identified: 1 }));

    const first = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();
    expect(first.result.pendingWorks).toHaveLength(1);

    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed({ works: [makeWork('W9')], identified: 9 }));
    const second = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    const batch = storageState.get(MANUAL_PENDING_BATCH_KEY) as any;
    expect(batch.works).toEqual(second.result.pendingWorks); // 仅新批次，不合并
    expect(batch.pendingCount).toBe(1);
    expect(logSpy).toHaveBeenCalled(); // 覆盖登记
  });
});

describe('new-works-manual-pending-fetch 只读通道', () => {
  it('有批次 → 回读（两次 fetch 结果一致，不消费）', async () => {
    const batch = {
      status: 'done', startedAt: 1, terminalAt: 2, pendingCount: 1,
      identifiedTotal: 1, existingCount: 0,
      breakdown: { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 },
      works: [makeWork('W1')],
    };
    storageState.set(MANUAL_PENDING_BATCH_KEY, batch);

    const first = await send({ type: 'new-works-manual-pending-fetch' });
    const second = await send({ type: 'new-works-manual-pending-fetch' });

    expect(first).toMatchObject({ success: true, batch: expect.objectContaining({ works: batch.works, status: 'done' }) });
    expect(second).toEqual(first);
    expect(storageState.has(MANUAL_PENDING_BATCH_KEY)).toBe(true); // 只读不消费
  });

  it('无批次 → batch=null', async () => {
    const response = await send({ type: 'new-works-manual-pending-fetch' });
    expect(response).toEqual({ success: true, batch: null });
  });
});

describe('new-works-manual-pending-consume 清盘通道', () => {
  it('清盘：consume 后 fetch=null', async () => {
    storageState.set(MANUAL_PENDING_BATCH_KEY, {
      status: 'cancelled', startedAt: 1, terminalAt: 2, pendingCount: 1,
      identifiedTotal: 1, existingCount: 0,
      breakdown: { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 },
      works: [makeWork('W1')],
    });

    const response = await send({ type: 'new-works-manual-pending-consume' });
    await flush(4);

    expect(response).toEqual({ success: true });
    expect(storageState.has(MANUAL_PENDING_BATCH_KEY)).toBe(false);
    const after = await send({ type: 'new-works-manual-pending-fetch' });
    expect(after).toEqual({ success: true, batch: null });
  });

  it('幂等：无批次时不报错', async () => {
    const response = await send({ type: 'new-works-manual-pending-consume' });
    await flush(4);
    expect(response).toEqual({ success: true });
  });

  it('ack 语义零漂移：ack 只清状态机 terminal，不动批次', async () => {
    storageState.set('new_works_manual_scan_state', {
      status: 'cancelled', startedAt: 1, swSessionId: 'sess-test',
      processed: 1, total: 1, identifiedTotal: 1, pendingTotal: 1,
      activeActorNames: [], concurrency: 1,
      result: { discovered: 1, identifiedTotal: 1, pendingCount: 1, existingCount: 0, cancelled: true, errorCount: 0 },
    });
    storageState.set(MANUAL_PENDING_BATCH_KEY, {
      status: 'cancelled', startedAt: 1, terminalAt: 2, pendingCount: 1,
      identifiedTotal: 1, existingCount: 0,
      breakdown: { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 },
      works: [makeWork('W1')],
    });

    const response = await send({ type: 'new-works-manual-scan-ack' });
    await flush(4);

    expect(response).toEqual({ success: true });
    expect(storageState.has('new_works_manual_scan_state')).toBe(false); // 状态机 terminal 照旧清
    expect(storageState.has(MANUAL_PENDING_BATCH_KEY)).toBe(true); // 批次不动（清盘走 consume）
  });
});
