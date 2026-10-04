/**
 * @file newWorksScanState.test.ts
 * @description 手动扫描状态机单测（纯 DI，无 chrome 依赖）：
 *              reconcile（SW 重启把上一 session 的持久化 running 改写为 interrupted / terminal 保留待消费 /
 *              同 session running 原样并同步 claim 标记）；claim 同步占位堵双消息竞态；begin 初值落盘；
 *              progress 前沿立即写+尾沿节流合并写；finish 终态+摘要+清标记；status 三态
 *              （running 不消费 / terminal 查询即消费 / 无状态=idle）；ack 只清 terminal；release 错误路径。
 * @module features/newWorks
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createManualScanStateStore,
  MANUAL_SCAN_STATE_KEY,
  type ManualScanState,
  type ManualScanStateStore,
} from './newWorksScanState';

function makeStorage() {
  const map = new Map<string, unknown>();
  return {
    map,
    get: vi.fn(async (key: string) => (map.has(key) ? map.get(key) : null)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) map.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      map.delete(key);
    }),
  };
}

function makeStore(overrides: { sessionId?: string; progressThrottleMs?: number } = {}) {
  const storage = makeStorage();
  const store = createManualScanStateStore({
    sessionId: 'sess-1',
    storage,
    progressThrottleMs: 0,
    ...overrides,
  });
  return { storage, store };
}

function makeState(overrides: Partial<ManualScanState> = {}): ManualScanState {
  return {
    status: 'running',
    startedAt: 1000,
    swSessionId: 'sess-0',
    processed: 1,
    total: 5,
    identifiedTotal: 2,
    pendingTotal: 1,
    activeActorNames: ['A', 'B'],
    concurrency: 2,
    ...overrides,
  };
}

const SUMMARY = {
  discovered: 2,
  identifiedTotal: 3,
  pendingCount: 2,
  existingCount: 1,
  cancelled: false,
  errorCount: 0,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('reconcile', () => {
  it('上一 session 的持久化 running 改写为 interrupted 并落盘，其余字段保留', async () => {
    const { storage, store } = makeStore();
    storage.map.set(MANUAL_SCAN_STATE_KEY, makeState({ status: 'running', swSessionId: 'sess-0' }));

    const state = await store.reconcile();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('interrupted');
    expect(state?.swSessionId).toBe('sess-0');
    expect(state?.processed).toBe(1);
    expect(state?.total).toBe(5);
    expect(storage.map.get(MANUAL_SCAN_STATE_KEY)).toMatchObject({ status: 'interrupted', swSessionId: 'sess-0' });
  });

  it('同 session 的 running 原样保留，并同步 claim 标记（防御性）', async () => {
    const { storage, store } = makeStore();
    storage.map.set(MANUAL_SCAN_STATE_KEY, makeState({ status: 'running', swSessionId: 'sess-1' }));

    const state = await store.reconcile();

    expect(state?.status).toBe('running');
    expect(store.claim()).toBe(false);
  });

  it('terminal 状态（上一 session 的 done）原样保留待消费，不重写', async () => {
    const { storage, store } = makeStore();
    const done = makeState({ status: 'done', swSessionId: 'sess-0', result: SUMMARY });
    storage.map.set(MANUAL_SCAN_STATE_KEY, done);

    const state = await store.reconcile();

    expect(state?.status).toBe('done');
    expect(state?.result).toEqual(SUMMARY);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('无状态时返回 null', async () => {
    const { store } = makeStore();
    expect(await store.reconcile()).toBeNull();
  });
});

describe('claim', () => {
  it('首次占用成功，重复占用拒绝（双消息竞态守卫）', async () => {
    const { store } = makeStore();
    expect(store.claim()).toBe(true);
    expect(store.claim()).toBe(false);
  });

  it('finish 后标记释放，可再次占用', async () => {
    const { store } = makeStore();
    expect(store.claim()).toBe(true);
    await store.begin({ total: 1, concurrency: 1, activeActorNames: ['A'] });
    await store.finish(SUMMARY);
    expect(store.claim()).toBe(true);
  });
});

describe('begin / progress / finish', () => {
  it('begin 写 running 初值：processed=0、当前 session、调用方字段', async () => {
    const { storage, store } = makeStore();
    await store.begin({ total: 4, concurrency: 2, activeActorNames: ['A', 'B'] });

    expect(storage.map.get(MANUAL_SCAN_STATE_KEY)).toMatchObject({
      status: 'running',
      swSessionId: 'sess-1',
      processed: 0,
      total: 4,
      identifiedTotal: 0,
      pendingTotal: 0,
      concurrency: 2,
      activeActorNames: ['A', 'B'],
    });
  });

  it('progress 合并写入进度字段（throttleMs=0 时每次立即落盘）', async () => {
    const { storage, store } = makeStore();
    await store.begin({ total: 5, concurrency: 1, activeActorNames: [] });
    store.progress({ processed: 3, identifiedTotal: 4, pendingTotal: 2, actorName: 'C', activeActorNames: ['D'] });

    expect(storage.map.get(MANUAL_SCAN_STATE_KEY)).toMatchObject({
      status: 'running',
      processed: 3,
      identifiedTotal: 4,
      pendingTotal: 2,
      actorName: 'C',
      activeActorNames: ['D'],
    });
  });

  it('progress 节流：前沿立即写，窗口内合并为一次尾沿写', async () => {
    vi.useFakeTimers();
    const { storage, store } = makeStore({ progressThrottleMs: 500 });
    await store.begin({ total: 5, concurrency: 1, activeActorNames: [] });
    const setsAfterBegin = storage.set.mock.calls.length;

    store.progress({ processed: 1, identifiedTotal: 0, pendingTotal: 0, activeActorNames: ['A'] });
    expect(storage.set.mock.calls.length).toBe(setsAfterBegin + 1);
    expect((storage.map.get(MANUAL_SCAN_STATE_KEY) as ManualScanState).processed).toBe(1);

    vi.advanceTimersByTime(100);
    store.progress({ processed: 2, identifiedTotal: 1, pendingTotal: 1, activeActorNames: ['B'] });
    expect(storage.set.mock.calls.length).toBe(setsAfterBegin + 1);

    vi.advanceTimersByTime(400);
    expect(storage.set.mock.calls.length).toBe(setsAfterBegin + 2);
    expect((storage.map.get(MANUAL_SCAN_STATE_KEY) as ManualScanState).processed).toBe(2);
  });

  it('finish(done) 写终态+摘要并清 claim 标记', async () => {
    const { storage, store } = makeStore();
    expect(store.claim()).toBe(true);
    await store.begin({ total: 2, concurrency: 1, activeActorNames: ['A'] });
    await store.finish(SUMMARY);

    expect(storage.map.get(MANUAL_SCAN_STATE_KEY)).toMatchObject({ status: 'done', result: SUMMARY });
    expect(store.claim()).toBe(true);
  });

  it('finish(cancelled=true) 写 cancelled 终态', async () => {
    const { storage, store } = makeStore();
    await store.begin({ total: 2, concurrency: 1, activeActorNames: ['A'] });
    await store.finish({ ...SUMMARY, cancelled: true });

    expect((storage.map.get(MANUAL_SCAN_STATE_KEY) as ManualScanState).status).toBe('cancelled');
  });

  it('finish 合并未冲刷的节流进度，终态计数不丢最后一批', async () => {
    vi.useFakeTimers();
    const { storage, store } = makeStore({ progressThrottleMs: 500 });
    await store.begin({ total: 5, concurrency: 1, activeActorNames: [] });
    store.progress({ processed: 5, identifiedTotal: 7, pendingTotal: 3, activeActorNames: [] });
    vi.advanceTimersByTime(100);
    store.progress({ processed: 6, identifiedTotal: 8, pendingTotal: 4, activeActorNames: [] });

    await store.finish(SUMMARY);

    const state = storage.map.get(MANUAL_SCAN_STATE_KEY) as ManualScanState;
    expect(state.status).toBe('done');
    expect(state.processed).toBe(6);
    expect(state.identifiedTotal).toBe(8);
    expect(state.pendingTotal).toBe(4);
    expect(state.result).toEqual(SUMMARY);
  });

  it('begin 之前的 progress 不落盘（无状态可合并）', async () => {
    const { storage, store } = makeStore();
    store.progress({ processed: 1, identifiedTotal: 0, pendingTotal: 0, activeActorNames: [] });
    expect(storage.map.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });
});

describe('status', () => {
  it('running（本 session）原样返回，不落盘不清除（不消费）', async () => {
    const { storage, store } = makeStore();
    storage.map.set(MANUAL_SCAN_STATE_KEY, makeState({ status: 'running', swSessionId: 'sess-1' }));

    const result = await store.status();

    expect(result.status).toBe('running');
    expect((result as ManualScanState).processed).toBe(1);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.map.has(MANUAL_SCAN_STATE_KEY)).toBe(true);
  });

  it('terminal 查询即消费：返回 consumed=true 并清盘', async () => {
    const { storage, store } = makeStore();
    storage.map.set(MANUAL_SCAN_STATE_KEY, makeState({ status: 'done', swSessionId: 'sess-0', result: SUMMARY }));

    const result = await store.status();

    expect(result.status).toBe('done');
    expect('consumed' in result && result.consumed).toBe(true);
    expect(storage.map.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });

  it('上一 session 的 running：reconcile 为 interrupted 后消费返回', async () => {
    const { storage, store } = makeStore();
    storage.map.set(MANUAL_SCAN_STATE_KEY, makeState({ status: 'running', swSessionId: 'sess-0' }));

    const result = await store.status();

    expect(result.status).toBe('interrupted');
    expect('consumed' in result && result.consumed).toBe(true);
    expect(storage.map.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });

  it('无状态 → idle', async () => {
    const { store } = makeStore();
    expect(await store.status()).toEqual({ status: 'idle' });
  });
});

describe('ack / release', () => {
  it('ack 清除 terminal 状态', async () => {
    const { storage, store } = makeStore();
    storage.map.set(MANUAL_SCAN_STATE_KEY, makeState({ status: 'cancelled', swSessionId: 'sess-0', result: SUMMARY }));

    await store.ack();

    expect(storage.map.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
  });

  it('ack 不动 running（防误清在途扫描）', async () => {
    const { storage, store } = makeStore();
    storage.map.set(MANUAL_SCAN_STATE_KEY, makeState({ status: 'running', swSessionId: 'sess-1' }));

    await store.ack();

    expect(storage.map.has(MANUAL_SCAN_STATE_KEY)).toBe(true);
  });

  it('release 清 claim 标记 + 清盘（错误路径）', async () => {
    const { storage, store } = makeStore();
    expect(store.claim()).toBe(true);
    await store.begin({ total: 2, concurrency: 1, activeActorNames: ['A'] });

    await store.release();

    expect(storage.map.has(MANUAL_SCAN_STATE_KEY)).toBe(false);
    expect(store.claim()).toBe(true);
  });
});

describe('chrome 装配单例（node 环境无 chrome 时防御性可用）', () => {
  it('manualScanStore 可创建且 reconcile 无状态返回 null，不抛', async () => {
    const store: ManualScanStateStore = await import('./newWorksScanState')
      .then((m) => m.manualScanStore);
    expect(store).toBeDefined();
    expect(await store.reconcile()).toBeNull();
  });
});
