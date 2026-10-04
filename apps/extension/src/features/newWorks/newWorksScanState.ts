/**
 * @file newWorksScanState.ts
 * @description 手动扫描状态机（issue#52）：「立即检查」的扫描状态从 SW closure 内存持久化到
 *              chrome.storage.session，刷新后页面可查询回填（进度 UI + 取消按钮恢复），
 *              完成/取消/中断的终态补一次性提示（摘要计数，不落记录）。
 *
 * 设计要点：
 * - sessionId = SW 模块加载会话（SW 重启 = 新 session）；跨 session 的持久化 running → interrupted（SW 重启检测）。
 * - claim() 同步占位：堵双消息竞态——运行中再发 manual-check = 拒绝（manual-check-running），不并行扫描。
 * - 终态（done/cancelled/interrupted）首个查询（status）即消费（清盘 + consumed=true），防刷新重复提示；
 *   在线收到终态广播的页面用 ack 消费确认；running 永不被消费。
 * - storage.session 随浏览器会话结束自然清零——契合「扫描不可能跨浏览器重启」语义，零迁移。
 *
 * 范围外（登记不修）：check-single-actor 不入本状态机；SW 冷启动一次性缓存竞态（见线 10-14 收口报告）。
 * @module features/newWorks
 */

export type ManualScanStatus = 'running' | 'done' | 'cancelled' | 'interrupted';

export interface ManualScanResultSummary {
  discovered: number;
  identifiedTotal: number;
  /** 本次收集、尚未写入新作品库的条数（confirm 模式 = 确认弹窗「可入库」口径） */
  pendingCount: number;
  existingCount: number;
  cancelled: boolean;
  errorCount: number;
}

export interface ManualScanState {
  status: ManualScanStatus;
  startedAt: number;
  /** SW 模块加载会话：跨 session 的 running → interrupted */
  swSessionId: string;
  processed: number;
  total: number;
  identifiedTotal: number;
  pendingTotal: number;
  actorName?: string;
  activeActorNames: string[];
  concurrency: number;
  /** 完成摘要（计数，非记录） */
  result?: ManualScanResultSummary;
}

/** 查询结果：running 原样（不消费）；terminal 查询即消费（consumed=true）；无状态 = idle */
export type ManualScanStatusQueryResult =
  | { status: 'idle' }
  | (ManualScanState & { consumed?: true });

export interface ManualScanStorage {
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ManualScanBeginInput {
  total: number;
  concurrency: number;
  activeActorNames: string[];
}

export interface ManualScanProgressInput {
  processed: number;
  identifiedTotal: number;
  pendingTotal: number;
  actorName?: string;
  activeActorNames: string[];
}

export interface ManualScanStateStoreOptions {
  sessionId: string;
  storage: ManualScanStorage;
  now?: () => number;
  /** 进度合并写节流窗口（ms）：前沿立即写 + 尾沿合并写；0 = 每次立即写 */
  progressThrottleMs?: number;
}

export interface ManualScanStateStore {
  /** SW 重启时把上一 session 的持久化 running 改写为 interrupted；返回当前盘上状态（无 = null） */
  reconcile(): Promise<ManualScanState | null>;
  /** 同步占位：true = 本 SW 当前无在途手动扫描。begin 前调用，堵双消息竞态 */
  claim(): boolean;
  begin(input: ManualScanBeginInput): Promise<void>;
  /** 进度合并写：前沿立即写 + 尾沿节流合并；begin 之前调用不落盘（无状态可合并） */
  progress(input: ManualScanProgressInput): void;
  finish(summary: ManualScanResultSummary): Promise<void>;
  /** running 原样返回（不消费）；terminal 查询即消费（清盘 + consumed=true）；无状态 = idle */
  status(): Promise<ManualScanStatusQueryResult>;
  /** 清 terminal 状态（不动 running，防误清在途扫描） */
  ack(): Promise<void>;
  /** 错误路径：清占位标记 + 清盘 */
  release(): Promise<void>;
}

export const MANUAL_SCAN_STATE_KEY = 'new_works_manual_scan_state';

const DEFAULT_PROGRESS_THROTTLE_MS = 500;

function normalizeActorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function createManualScanStateStore(options: ManualScanStateStoreOptions): ManualScanStateStore {
  const sessionId = options.sessionId;
  const storage = options.storage;
  const now = options.now ?? Date.now;
  const throttleMs = options.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS;

  let claimed = false;
  let current: ManualScanState | null = null;
  let pendingProgress: ManualScanProgressInput | null = null;
  let lastProgressWriteAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | undefined;

  async function readStored(): Promise<ManualScanState | null> {
    const stored = await storage.get(MANUAL_SCAN_STATE_KEY);
    if (stored == null || typeof stored !== 'object') return null;
    return stored as ManualScanState;
  }

  function writeState(state: ManualScanState): Promise<void> {
    return storage.set({ [MANUAL_SCAN_STATE_KEY]: state });
  }

  function applyProgressTo(state: ManualScanState, input: ManualScanProgressInput): ManualScanState {
    return {
      ...state,
      processed: input.processed,
      identifiedTotal: input.identifiedTotal,
      pendingTotal: input.pendingTotal,
      actorName: input.actorName,
      activeActorNames: normalizeActorNames(input.activeActorNames),
    };
  }

  function clearTrailingTimer(): void {
    if (trailingTimer !== undefined) {
      clearTimeout(trailingTimer);
      trailingTimer = undefined;
    }
  }

  function flushProgress(): void {
    clearTrailingTimer();
    if (!pendingProgress || !current) return;
    const progressInput = pendingProgress;
    pendingProgress = null;
    lastProgressWriteAt = now();
    const next = applyProgressTo(current, progressInput);
    current = next;
    writeState(next).catch((error) => {
      console.warn('[NewWorks] 扫描进度状态写入失败:', error);
    });
  }

  async function reconcile(): Promise<ManualScanState | null> {
    const stored = await readStored();
    if (!stored) {
      current = null;
      return null;
    }
    if (stored.status === 'running' && stored.swSessionId !== sessionId) {
      // SW 重启：上一 session 的在途扫描必已死亡 → interrupted（保留进度供一次性提示）
      const interrupted: ManualScanState = { ...stored, status: 'interrupted' };
      current = interrupted;
      await writeState(interrupted);
      return interrupted;
    }
    current = stored;
    if (stored.status === 'running') claimed = true; // 防御：同 session running 与内存标记失步
    return stored;
  }

  function claim(): boolean {
    if (claimed) return false;
    claimed = true;
    return true;
  }

  async function begin(input: ManualScanBeginInput): Promise<void> {
    const state: ManualScanState = {
      status: 'running',
      startedAt: now(),
      swSessionId: sessionId,
      processed: 0,
      total: input.total,
      identifiedTotal: 0,
      pendingTotal: 0,
      activeActorNames: normalizeActorNames(input.activeActorNames),
      concurrency: input.concurrency,
    };
    current = state;
    // 不更新 lastProgressWriteAt：begin 后首次进度立即写（初始 emitProgress 即时落盘）
    await writeState(state);
  }

  function progress(input: ManualScanProgressInput): void {
    pendingProgress = {
      ...input,
      actorName: input.actorName,
      activeActorNames: normalizeActorNames(input.activeActorNames),
    };
    const ts = now();
    if (ts - lastProgressWriteAt >= throttleMs) {
      flushProgress();
      return;
    }
    if (trailingTimer === undefined) {
      trailingTimer = setTimeout(() => {
        trailingTimer = undefined;
        flushProgress();
      }, Math.max(1, throttleMs - (ts - lastProgressWriteAt)));
    }
  }

  async function finish(summary: ManualScanResultSummary): Promise<void> {
    claimed = false;
    clearTrailingTimer();
    let base: ManualScanState = current ?? {
      status: 'running',
      startedAt: now(),
      swSessionId: sessionId,
      processed: 0,
      total: 0,
      identifiedTotal: 0,
      pendingTotal: 0,
      activeActorNames: [],
      concurrency: 1,
    };
    if (pendingProgress) {
      base = applyProgressTo(base, pendingProgress);
      pendingProgress = null;
    }
    const state: ManualScanState = {
      ...base,
      status: summary.cancelled ? 'cancelled' : 'done',
      result: summary,
    };
    current = state;
    await writeState(state);
  }

  async function status(): Promise<ManualScanStatusQueryResult> {
    const stored = await reconcile();
    if (!stored) return { status: 'idle' };
    if (stored.status === 'running') return stored;
    await storage.remove(MANUAL_SCAN_STATE_KEY);
    current = null;
    return { ...stored, consumed: true };
  }

  async function ack(): Promise<void> {
    const stored = await readStored();
    if (!stored || stored.status === 'running') return;
    await storage.remove(MANUAL_SCAN_STATE_KEY);
    current = null;
  }

  async function release(): Promise<void> {
    claimed = false;
    clearTrailingTimer();
    pendingProgress = null;
    current = null;
    try {
      await storage.remove(MANUAL_SCAN_STATE_KEY);
    } catch {
      // 清盘失败也须释放内存占位（避免状态机永久占用，SW 重启前所有 manual-check 被拒）
    }
  }

  return { reconcile, claim, begin, progress, finish, status, ack, release };
}

function createSessionId(): string {
  try {
    const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  } catch {
    // 非安全上下文等异常路径走随机串兜底
  }
  return `sw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveSessionStorage(): ManualScanStorage {
  const noop: ManualScanStorage = {
    get: async () => null,
    set: async () => undefined,
    remove: async () => undefined,
  };
  try {
    const session = (globalThis as { chrome?: { storage?: { session?: any } } }).chrome?.storage?.session;
    if (!session) return noop;
    return {
      get: async (key) => {
        const res = await session.get(key);
        return res ? res[key] ?? null : null;
      },
      set: async (items) => {
        await session.set(items);
      },
      remove: async (key) => {
        await session.remove(key);
      },
    };
  } catch {
    return noop;
  }
}

/**
 * SW 侧单例。模块加载即 reconcile：SW 重启后把上一 session 的持久化 running 改写为
 * interrupted（SW 重启检测点；页面侧下一次查询/扫描启动的 reconcile 为幂等兜底）。
 */
export const manualScanStore: ManualScanStateStore = createManualScanStateStore({
  sessionId: createSessionId(),
  storage: resolveSessionStorage(),
});

void manualScanStore.reconcile().catch((error) => {
  console.warn('[NewWorks] 手动扫描状态对账失败:', error);
});
