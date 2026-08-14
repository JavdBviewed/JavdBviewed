/**
 * @file globalTaskCenter.ts
 * @description 全局任务中心 —— 管理所有异步任务的生命周期、排队、租约、超时和去重
 * @module platform/tasks
 *
 * 任务生命周期：registered → queued → leased → running → done/error/canceled
 * 核心机制：
 * - 优先级队列：priority 越大越优先
 * - 租约（lease）：前台页面先获得执行权，后台排队等待
 * - 去重：通过 dedupeKey 防止重复创建同类任务
 * - 超时守卫：running 超过 timeoutMs 自动标记 error
 */
import {
  TASK_BUCKET_LIMITS,
  TASK_GLOBAL_LEASE_LIMITS,
  TASK_LEASE_GROUP_LIMITS,
  TASK_PAGE_LEASE_LIMITS,
  TASK_SMART_BACKGROUND_PREWARM_LIMITS,
  resolveTaskBucket,
  resolveTaskLeaseGroup,
} from './taskPolicy';
import { TaskStateStore } from './taskStateStore';
import { TASK_CENTER_MESSAGE } from '../../shared/taskCenterProtocol';
import type { GlobalTaskDescriptor, GlobalTaskRuntimeState } from '../../shared/taskCenterTypes';
import { computeTaskDisposition, getEffectiveBucketLimit } from './taskCenterPolicyRuntime';

/** 租约响应：是否授予执行权，未授予时附带等待原因 */
type LeaseResponse = { granted: boolean; waitReason?: string };

type TaskRegistrationResult = {
  ok: true;
  taskId: string;
  tabId: number;
  reused?: boolean;
  status?: string;
};

/** 排队候选任务（附带优先级评分） */
type QueueCandidate = {
  record: ReturnType<TaskStateStore['listTasks']>[number];
  score: number;
};

export class GlobalTaskCenter {
  private store = new TaskStateStore();
  private dedupeIndex = new Map<string, string>();
  private readonly taskRetentionMs = 60 * 60 * 1000;
  private readonly pendingTaskMaxAgeMs = 60 * 1000;
  private readonly pausedTaskMaxAgeMs = 3 * 60 * 1000;
  private readonly hiddenRunningTaskMaxAgeMs = 45 * 1000;
  private readonly starvationThresholdMs = 15 * 1000;
  private readonly idleStarvationScore = 2500;
  private readonly deferredStarvationScore = 2500;
  // P1 FIX: 跨页面依赖同步 - 在 background 维护全局已完成任务集合
  private completedTaskLabels = new Set<string>();
  private readonly storageKey = 'taskCenter:snapshot';
  private readonly dedupeStorageKey = 'taskCenter:dedupeIndex'; // P2 FIX: dedupe 持久化
  private isRestored = false;
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly persistDebounceMs = 500;
  private lastGrantedLeasePersistence: Promise<void> = Promise.resolve();

  private getPhaseWeight(phase: string): number {
    if (phase === 'critical') return 4000;
    if (phase === 'high') return 3000;
    if (phase === 'deferred') return 2000;
    if (phase === 'idle') return 1000;
    return 0;
  }

  private getStarvationScore(record: QueueCandidate['record'], now: number): number {
    const maxScore = record.descriptor.phase === 'idle'
      ? this.idleStarvationScore
      : record.descriptor.phase === 'deferred'
        ? this.deferredStarvationScore
        : 0;
    if (maxScore === 0) return 0;
    const waitedMs = Math.max(0, now - record.descriptor.createdAt);
    return waitedMs >= this.starvationThresholdMs ? maxScore : 0;
  }

  // P1 FIX: Service Worker 重启后，从 chrome.storage 恢复任务状态
  async restoreFromStorage(): Promise<void> {
    if (this.isRestored) return;
    try {
      // P2 FIX: 一次性读取两个 key，避免多次 chrome.storage 调用
      const item = await new Promise<any>((resolve, reject) => {
        chrome.storage.local.get([this.storageKey, this.dedupeStorageKey], (result) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          resolve(result);
        });
      });
      const data = item[this.storageKey];
      if (data && typeof data === 'object') {
        if (data.tasks && Array.isArray(data.tasks)) {
          for (const record of data.tasks) {
            if (record?.descriptor?.taskId && record?.runtime?.status) {
              this.store.setTask(record.descriptor.taskId, record);
              if (record.descriptor.dedupeKey) {
                this.dedupeIndex.set(record.descriptor.dedupeKey, record.descriptor.taskId);
              }
            }
          }
        }
        if (data.completedLabels && Array.isArray(data.completedLabels)) {
          this.completedTaskLabels = new Set(data.completedLabels);
        }
        console.log('[TaskCenter] Restored', this.store.listTasks().length, 'tasks and', this.completedTaskLabels.size, 'completed labels from storage');
      }
      // P2 FIX: 同时恢复 dedupe index
      const dedupeData = item[this.dedupeStorageKey];
      if (dedupeData && typeof dedupeData === 'object') {
        this.dedupeIndex = new Map(Object.entries(dedupeData));
        console.log('[TaskCenter] Restored dedupe index:', this.dedupeIndex.size, 'entries');
      }
      await this.cancelRestoredTasksForClosedTabs();
      this.isRestored = true;
      // P1 FIX: 恢复后启动定期快照
      this.startPeriodicSnapshot();
    } catch (err) {
      console.warn('[TaskCenter] Failed to restore from storage:', err);
      this.isRestored = true;
    }
  }

  /**
   * Visibility is intentionally in-memory, so a service-worker restart cannot
   * prove that a restored task still owns a live tab. Reconcile persisted work
   * with Chrome before it is allowed to affect a new scheduling cycle.
   */
  private async cancelRestoredTasksForClosedTabs(): Promise<void> {
    if (!chrome.tabs?.query) return;
    try {
      const tabs = await chrome.tabs.query({});
      const openTabIds = new Set(tabs
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => typeof tabId === 'number'));
      let canceled = 0;
      for (const record of this.store.listTasks()) {
        if (['done', 'error', 'canceled'].includes(record.runtime.status)) continue;
        if (openTabIds.has(record.descriptor.tabId)) continue;
        record.runtime.status = 'canceled';
        record.runtime.waitReason = 'page-closed-by-user';
        record.runtime.endedAt = Date.now();
        this.store.setTask(record.descriptor.taskId, record);
        canceled += 1;
      }
      if (canceled > 0) {
        console.log('[TaskCenter] Canceled restored tasks for closed tabs', { canceled });
        this.persistToStorage();
      }
    } catch (error) {
      console.warn('[TaskCenter] Failed to reconcile restored tasks with tabs:', error);
    }
  }

  // P1 FIX: 定期快照到 chrome.storage，防止 Service Worker 重启丢失状态
  private persistToStorage(): Promise<void> {
    const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
    if (!storage) return Promise.resolve();
    const snapshot = {
      tasks: this.store.listTasks().map(record => ({
        descriptor: record.descriptor,
        runtime: record.runtime,
      })),
      completedLabels: Array.from(this.completedTaskLabels),
      savedAt: Date.now(),
    };
    const writes: Promise<unknown>[] = [
      Promise.resolve(storage.set({ [this.storageKey]: snapshot })).catch(() => undefined),
    ];
    // P2 FIX: 同时持久化 dedupe index，防止 SW 重启后 dedupe 失效导致重复任务
    if (this.dedupeIndex.size > 0) {
      const dedupeSnapshot = Object.fromEntries(this.dedupeIndex.entries());
      writes.push(Promise.resolve(storage.set({ [this.dedupeStorageKey]: dedupeSnapshot })).catch(() => undefined));
    }
    return Promise.all(writes).then(() => undefined);
  }

  /** Collapse bursty task completions into one full snapshot write. */
  private schedulePersistToStorage(): void {
    if (this.persistDebounceTimer !== null) return;
    this.persistDebounceTimer = setTimeout(() => {
      this.persistDebounceTimer = null;
      this.persistToStorage();
    }, this.persistDebounceMs);
  }

  // P1 FIX: 跨页面依赖同步 - 通知任务中心某个 label 的任务已完成
  markTaskLabelCompleted(label: string): void {
    this.completedTaskLabels.add(label);
    this.schedulePersistToStorage();
  }

  // P1 FIX: 查询某个 label 是否已在全局完成（供 content script 调用）
  isTaskLabelCompleted(label: string): boolean {
    return this.completedTaskLabels.has(label);
  }

  private getQueueScore(record: QueueCandidate['record'], now = Date.now()): number {
    const descriptor = record.descriptor;
    const runtime = record.runtime;
    const ageMs = Math.max(0, now - descriptor.createdAt);
    const ageScore = Math.min(600, Math.floor(ageMs / 1000));
    const visibilityScore = this.store.isTabVisible(descriptor.tabId) ? 80 : 0;
    const retryPenalty = runtime.retryCount * 100;
    const starvationScore = this.getStarvationScore(record, now);
    return this.getPhaseWeight(descriptor.phase) + (descriptor.priority * 100) + visibilityScore + ageScore + starvationScore - retryPenalty;
  }

  private isRunnableCandidate(record: QueueCandidate['record'], bucket: string, visible: boolean, now = Date.now()): boolean {
    const recordBucket = resolveTaskBucket(record.descriptor.label);
    if (recordBucket !== bucket) return false;
    if (this.store.isTabVisible(record.descriptor.tabId) !== visible) return false;
    const disposition = computeTaskDisposition({
      status: record.runtime.status,
      heartbeatTs: record.runtime.heartbeatTs,
      timeoutMs: record.descriptor.timeoutMs,
      now,
    });
    if (disposition !== 'active') return false;
    return record.runtime.status === 'queued';
  }

  private getBestQueuedCandidate(bucket: string, visible: boolean): QueueCandidate | null {
    const now = Date.now();
    const candidates = this.store.listTasks().filter((record) => this.isRunnableCandidate(record, bucket, visible, now));
    if (candidates.length === 0) return null;

    candidates.sort((left, right) => {
      const leftCritical = left.descriptor.phase === 'critical';
      const rightCritical = right.descriptor.phase === 'critical';
      if (leftCritical !== rightCritical) return leftCritical ? -1 : 1;

      const phaseRank = (phase: string) => phase === 'high' ? 2 : phase === 'deferred' ? 1 : 0;
      const leftRank = phaseRank(left.descriptor.phase);
      const rightRank = phaseRank(right.descriptor.phase);
      if (leftRank !== rightRank) {
        const higherPhaseCandidate = leftRank > rightRank ? left : right;
        // Fairness boosts may rotate work only after the higher phase has
        // received an execution turn. A never-started high or deferred task
        // must not be blocked by aged lower-phase work in the same bucket.
        if (!higherPhaseCandidate.runtime.startedAt) return leftRank > rightRank ? -1 : 1;
      }

      const scoreDiff = this.getQueueScore(right, now) - this.getQueueScore(left, now);
      if (scoreDiff !== 0) return scoreDiff;

      const ageDiff = left.descriptor.createdAt - right.descriptor.createdAt;
      if (ageDiff !== 0) return ageDiff;

      return left.descriptor.taskId.localeCompare(right.descriptor.taskId);
    });

    return { record: candidates[0], score: this.getQueueScore(candidates[0], now) };
  }

  private getRunningCount(bucket: string, visible: boolean): number {
    const now = Date.now();
    return this.store.listTasks().filter(record => {
      const recordBucket = resolveTaskBucket(record.descriptor.label);
      const recordVisible = this.store.isTabVisible(record.descriptor.tabId);
      const recordDisposition = computeTaskDisposition({
        status: record.runtime.status,
        heartbeatTs: record.runtime.heartbeatTs,
        timeoutMs: record.descriptor.timeoutMs,
        now,
      });
      return recordBucket === bucket
        && recordVisible === visible
        && recordDisposition === 'active'
        && (record.runtime.status === 'leased' || record.runtime.status === 'running');
    }).length;
  }

  private getActiveLeaseCount(
    visible: boolean,
    pageInstanceId?: string,
    visibilityPolicy?: GlobalTaskDescriptor['visibilityPolicy'],
  ): number {
    const now = Date.now();
    return this.store.listTasks().filter(record => {
      const disposition = computeTaskDisposition({
        status: record.runtime.status,
        heartbeatTs: record.runtime.heartbeatTs,
        timeoutMs: record.descriptor.timeoutMs,
        now,
      });
      return this.store.isTabVisible(record.descriptor.tabId) === visible
        && (!pageInstanceId || record.descriptor.pageInstanceId === pageInstanceId)
        && (!visibilityPolicy || record.descriptor.visibilityPolicy === visibilityPolicy)
        && disposition === 'active'
        && (record.runtime.status === 'leased' || record.runtime.status === 'running');
    }).length;
  }

  private getActiveLeaseGroupCount(group: string): number {
    const now = Date.now();
    return this.store.listTasks().filter((record) => {
      const disposition = computeTaskDisposition({
        status: record.runtime.status,
        heartbeatTs: record.runtime.heartbeatTs,
        timeoutMs: record.descriptor.timeoutMs,
        now,
      });
      return resolveTaskLeaseGroup(
        record.descriptor.label,
        record.descriptor.visibilityPolicy,
      ) === group
        && disposition === 'active'
        && (record.runtime.status === 'leased' || record.runtime.status === 'running');
    }).length;
  }

  private cleanupStaleTasks(now = Date.now()): void {
    for (const record of this.store.listTasks()) {
      const { descriptor, runtime } = record;
      const disposition = computeTaskDisposition({
        status: runtime.status,
        heartbeatTs: runtime.heartbeatTs,
        timeoutMs: descriptor.timeoutMs,
        now,
      });

      if (disposition === 'stale') {
        runtime.status = 'canceled';
        runtime.waitReason = 'lease-timeout';
        runtime.endedAt = now;
        this.store.setTask(descriptor.taskId, record);
        console.log('[TaskCenter] Canceled stale active task', {
          taskId: descriptor.taskId,
          label: descriptor.label,
          pageInstanceId: descriptor.pageInstanceId,
          reason: runtime.waitReason,
        });
      }

      const isHidden = !this.store.isTabVisible(descriptor.tabId);
      const isActiveRunningTask = runtime.status === 'leased' || runtime.status === 'running';
      const hiddenBaseTs = runtime.heartbeatTs || runtime.startedAt || descriptor.createdAt;
      const shouldApplyHiddenRunningTimeout = descriptor.visibilityPolicy !== 'background_allowed'
        && descriptor.visibilityPolicy !== 'background_throttled';
      if (
        shouldApplyHiddenRunningTimeout
        && isHidden
        && isActiveRunningTask
        && now - hiddenBaseTs > this.hiddenRunningTaskMaxAgeMs
      ) {
        runtime.status = 'canceled';
        runtime.waitReason = 'hidden-background-timeout';
        runtime.endedAt = now;
        this.store.setTask(descriptor.taskId, record);
        console.log('[TaskCenter] Canceled hidden running task', {
          taskId: descriptor.taskId,
          label: descriptor.label,
          pageInstanceId: descriptor.pageInstanceId,
          tabId: descriptor.tabId,
          hiddenMs: now - hiddenBaseTs,
        });
      }

      const isPendingTask = runtime.status === 'registered' || runtime.status === 'queued';
      const pendingBaseTs = runtime.lastProgressAt || runtime.heartbeatTs || descriptor.createdAt;
      const isKnownTabPendingTask = this.store.hasTabVisibility(descriptor.tabId);
      if (
        isPendingTask
        && !isKnownTabPendingTask
        && now - pendingBaseTs > this.pendingTaskMaxAgeMs
      ) {
        runtime.status = 'canceled';
        runtime.waitReason = 'page-instance-orphaned';
        runtime.endedAt = now;
        this.store.setTask(descriptor.taskId, record);
        console.log('[TaskCenter] Canceled orphan pending task', {
          taskId: descriptor.taskId,
          label: descriptor.label,
          pageInstanceId: descriptor.pageInstanceId,
          ageMs: now - pendingBaseTs,
        });
      }

      const pausedBaseTs = runtime.lastProgressAt || runtime.heartbeatTs || descriptor.createdAt;
      if (runtime.status === 'paused' && now - pausedBaseTs > this.pausedTaskMaxAgeMs) {
        runtime.status = 'canceled';
        runtime.waitReason = 'paused-timeout';
        runtime.endedAt = now;
        this.store.setTask(descriptor.taskId, record);
        console.log('[TaskCenter] Canceled stale paused task', {
          taskId: descriptor.taskId,
          label: descriptor.label,
          pageInstanceId: descriptor.pageInstanceId,
          ageMs: now - pausedBaseTs,
        });
      }

      const terminal = ['done', 'error', 'canceled'].includes(runtime.status);
      const terminalTs = runtime.endedAt || runtime.heartbeatTs || descriptor.createdAt;
      if (terminal && now - terminalTs > this.taskRetentionMs) {
        this.store.deleteTask(descriptor.taskId);
        if (descriptor.dedupeKey && this.dedupeIndex.get(descriptor.dedupeKey) === descriptor.taskId) {
          this.dedupeIndex.delete(descriptor.dedupeKey);
        }
      }
    }
  }

  registerTask(descriptor: GlobalTaskDescriptor, sender?: chrome.runtime.MessageSender): TaskRegistrationResult {
    this.cleanupStaleTasks();
    return this.registerTaskWithoutCleanup(descriptor, sender);
  }

  registerTasks(
    descriptors: readonly GlobalTaskDescriptor[],
    sender?: chrome.runtime.MessageSender,
  ): TaskRegistrationResult[] {
    this.cleanupStaleTasks();
    return descriptors.map((descriptor) => this.registerTaskWithoutCleanup(descriptor, sender));
  }

  private registerTaskWithoutCleanup(descriptor: GlobalTaskDescriptor, sender?: chrome.runtime.MessageSender): TaskRegistrationResult {
    const existing = this.store.getTask(descriptor.taskId);
    if (existing) {
      return {
        ok: true,
        taskId: descriptor.taskId,
        tabId: existing.descriptor.tabId,
        reused: true,
        status: existing.runtime.status,
      };
    }
    const dedupeKey = descriptor.dedupeKey || `${descriptor.label}:${descriptor.pageUrl}`;
    const dedupedTaskId = this.dedupeIndex.get(dedupeKey);
    if (dedupedTaskId) {
      const dedupedTask = this.store.getTask(dedupedTaskId);
      if (dedupedTask) {
        const status = dedupedTask.runtime.status;
        // 共享动作（如 115 推送）复用终态结果，避免多页重复真实执行
        if (['done', 'error'].includes(status) && dedupedTask.descriptor.shareScope === 'dedupe-by-action') {
          return {
            ok: true,
            taskId: dedupedTaskId,
            tabId: dedupedTask.descriptor.tabId,
            reused: true,
            status,
          };
        }
        if (['canceled', 'done', 'error'].includes(status)) {
          this.store.deleteTask(dedupedTaskId);
          if (this.dedupeIndex.get(dedupeKey) === dedupedTaskId) {
            this.dedupeIndex.delete(dedupeKey);
          }
        } else {
          return {
            ok: true,
            taskId: dedupedTaskId,
            tabId: dedupedTask.descriptor.tabId,
            reused: true,
            status,
          };
        }
      }
    }
    const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : descriptor.tabId;
    const runtime: GlobalTaskRuntimeState = {
      status: 'registered',
      retryCount: 0,
      pauseCount: 0,
      resumeCount: 0,
    };
    this.store.setTask(descriptor.taskId, { descriptor: { ...descriptor, tabId, dedupeKey }, runtime });
    this.dedupeIndex.set(dedupeKey, descriptor.taskId);
    return { ok: true, taskId: descriptor.taskId, tabId, reused: false, status: 'registered' };
  }

  requestLease(taskId: string): LeaseResponse {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (!task) return { granted: false, waitReason: 'task-not-found' };
    const bucket = resolveTaskBucket(task.descriptor.label);
    const baseLimit = TASK_BUCKET_LIMITS[bucket] ?? 1;
    const visible = this.store.isTabVisible(task.descriptor.tabId);
    const limit = getEffectiveBucketLimit({
      baseLimit,
      visible,
      policy: task.descriptor.visibilityPolicy,
    });
    if (limit <= 0) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = visible ? `bucket:${bucket}` : 'tab-hidden';
      this.store.setTask(taskId, task);
      return { granted: false, waitReason: task.runtime.waitReason };
    }
    if (task.runtime.status === 'leased' || task.runtime.status === 'running') {
      return { granted: true };
    }
    if (task.runtime.status === 'registered') {
      task.runtime.status = 'queued';
      task.runtime.waitReason = undefined;
      this.store.setTask(taskId, task);
    }

    const bestCandidate = this.getBestQueuedCandidate(bucket, visible);
    if (!bestCandidate) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = visible ? `bucket:${bucket}` : 'tab-hidden';
      this.store.setTask(taskId, task);
      return { granted: false, waitReason: task.runtime.waitReason };
    }

    const isInteractive115Push = task.descriptor.label === 'drive115:push' && visible;
    const samePageCandidate = bestCandidate.record.descriptor.pageInstanceId === task.descriptor.pageInstanceId;

    if (bestCandidate.record.descriptor.taskId !== taskId) {
      const runningCount = this.getRunningCount(bucket, visible);
      const currentPriority = Number(task.descriptor.priority || 0);
      const bestPriority = Number(bestCandidate.record.descriptor.priority || 0);
      const allowInteractiveSamePageFastLane = isInteractive115Push && samePageCandidate && runningCount < limit;
      const allowBackgroundParallel = !visible
        && task.descriptor.visibilityPolicy === 'background_allowed'
        && limit >= 3                               // P2 NOTE: limit<3 的 bucket（translate=1, drive115=2）永远无法触发此逃生口
        && runningCount < limit
        && (bestPriority - currentPriority) <= 3;   // P2 NOTE: 允许优先级差<=3 的任务绕过，差值太宽松可能导致 deferred 抢 high 的槽
      if (!allowInteractiveSamePageFastLane && !allowBackgroundParallel) {
        task.runtime.status = 'queued';
        task.runtime.waitReason = 'higher-priority-wait';
        this.store.setTask(taskId, task);
        return { granted: false, waitReason: task.runtime.waitReason };
      }
    }

    const runningCount = this.getRunningCount(bucket, visible);
    if (runningCount >= limit) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = visible ? `bucket:${bucket}` : 'tab-hidden';
      this.store.setTask(taskId, task);
      return { granted: false, waitReason: task.runtime.waitReason };
    }
    if (task.descriptor.visibilityPolicy === 'background_throttled') {
      const activePagePrewarmCount = this.getActiveLeaseCount(
        visible,
        task.descriptor.pageInstanceId,
        'background_throttled',
      );
      if (activePagePrewarmCount >= TASK_SMART_BACKGROUND_PREWARM_LIMITS.page) {
        task.runtime.status = 'queued';
        task.runtime.waitReason = 'smart-background-page-budget';
        this.store.setTask(taskId, task);
        return { granted: false, waitReason: task.runtime.waitReason };
      }
      const activePrewarmCount = this.store.listTasks().filter((record) => {
        const disposition = computeTaskDisposition({
          status: record.runtime.status,
          heartbeatTs: record.runtime.heartbeatTs,
          timeoutMs: record.descriptor.timeoutMs,
          now: Date.now(),
        });
        return record.descriptor.visibilityPolicy === 'background_throttled'
          && disposition === 'active'
          && (record.runtime.status === 'leased' || record.runtime.status === 'running');
      }).length;
      if (activePrewarmCount >= TASK_SMART_BACKGROUND_PREWARM_LIMITS.global) {
        task.runtime.status = 'queued';
        task.runtime.waitReason = 'smart-background-global-budget';
        this.store.setTask(taskId, task);
        return { granted: false, waitReason: task.runtime.waitReason };
      }
    }
    const globalLeaseLimit = visible ? TASK_GLOBAL_LEASE_LIMITS.visible : TASK_GLOBAL_LEASE_LIMITS.hidden;
    const activeLeaseCount = this.getActiveLeaseCount(visible);
    const isPriorityPhase = task.descriptor.phase === 'critical' || task.descriptor.phase === 'high';
    const reservedLeaseCount = !isPriorityPhase
      ? (visible ? TASK_GLOBAL_LEASE_LIMITS.visiblePriorityReserve : TASK_GLOBAL_LEASE_LIMITS.hiddenPriorityReserve)
      : 0;
    if (activeLeaseCount >= globalLeaseLimit - reservedLeaseCount) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = reservedLeaseCount > 0 ? 'global-priority-reserve' : (visible ? 'global-budget' : 'background-global-budget');
      this.store.setTask(taskId, task);
      return { granted: false, waitReason: task.runtime.waitReason };
    }
    const pageLeaseLimit = visible ? TASK_PAGE_LEASE_LIMITS.visible : TASK_PAGE_LEASE_LIMITS.hidden;
    if (this.getActiveLeaseCount(visible, task.descriptor.pageInstanceId) >= pageLeaseLimit) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = visible ? 'page-budget' : 'background-page-budget';
      this.store.setTask(taskId, task);
      return { granted: false, waitReason: task.runtime.waitReason };
    }
    const leaseGroup = resolveTaskLeaseGroup(
      task.descriptor.label,
      task.descriptor.visibilityPolicy,
    );
    const leaseGroupLimit = leaseGroup ? TASK_LEASE_GROUP_LIMITS[leaseGroup] : undefined;
    if (leaseGroup && leaseGroupLimit !== undefined && this.getActiveLeaseGroupCount(leaseGroup) >= leaseGroupLimit) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = `${leaseGroup}-budget`;
      this.store.setTask(taskId, task);
      return { granted: false, waitReason: task.runtime.waitReason };
    }
    task.runtime.status = 'leased';
    task.runtime.waitReason = undefined;
    task.runtime.startedAt = task.runtime.startedAt || Date.now();
    task.runtime.heartbeatTs = Date.now();
    this.store.setTask(taskId, task);
    // A granted lease is the cross-page concurrency boundary. Persist it now
    // so an MV3 worker restart cannot admit a competing heavy task first.
    this.lastGrantedLeasePersistence = this.persistToStorage();
    return { granted: true };
  }

  pauseTask(taskId: string, reason: string = 'paused'): { ok: true } {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (task && task.runtime.status !== 'done' && task.runtime.status !== 'canceled') {
      task.runtime.status = 'paused';
      task.runtime.waitReason = reason;
      task.runtime.pauseCount += 1;
      this.store.setTask(taskId, task);
    }
    return { ok: true };
  }

  resumeTask(taskId: string): { ok: true } {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (task && task.runtime.status === 'paused') {
      task.runtime.status = 'queued';
      task.runtime.waitReason = undefined;
      task.runtime.resumeCount += 1;
      this.store.setTask(taskId, task);
    }
    return { ok: true };
  }

  heartbeatTask(taskId: string): { ok: true } {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (task) {
      task.runtime.heartbeatTs = Date.now();
      if (task.runtime.status === 'leased') task.runtime.status = 'running';
      this.store.setTask(taskId, task);
    }
    return { ok: true };
  }

  completeTask(taskId: string): { ok: true } {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (task) {
      task.runtime.status = 'done';
      task.runtime.waitReason = undefined;
      task.runtime.endedAt = Date.now();
      this.store.setTask(taskId, task);
      // P1 FIX: 任务完成时同步到全局已完成标签集合（跨页面依赖）
      this.markTaskLabelCompleted(task.descriptor.label);
    }
    return { ok: true };
  }

  failTask(taskId: string, error: string): {
    ok: true;
    retryable: boolean;
    retryCount: number;
    retryLimit: number;
    status?: string;
    waitReason?: string;
  } {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (!task) {
      return { ok: true, retryable: false, retryCount: 0, retryLimit: 0, waitReason: 'task-not-found' };
    }

    const retryLimit = Math.max(0, task.descriptor.retryLimit || 0);
    task.runtime.retryCount += 1;
    task.runtime.detail = error || undefined;

    if (task.runtime.retryCount <= retryLimit) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = 'retryable-error';
      task.runtime.startedAt = undefined;
      task.runtime.endedAt = undefined;
      task.runtime.heartbeatTs = undefined;
      task.runtime.lastProgressAt = Date.now();
      this.store.setTask(taskId, task);
      return {
        ok: true,
        retryable: true,
        retryCount: task.runtime.retryCount,
        retryLimit,
        status: task.runtime.status,
        waitReason: task.runtime.waitReason,
      };
    }

    task.runtime.status = 'error';
    task.runtime.waitReason = 'retry-limit-exhausted';
    task.runtime.endedAt = Date.now();
    this.store.setTask(taskId, task);
    return {
      ok: true,
      retryable: false,
      retryCount: task.runtime.retryCount,
      retryLimit,
      status: task.runtime.status,
      waitReason: task.runtime.waitReason,
    };
  }

  deferTask(taskId: string, reason: string): { ok: true; status?: string; waitReason?: string } {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (!task) return { ok: true, waitReason: 'task-not-found' };

    if (!['done', 'error', 'canceled'].includes(task.runtime.status)) {
      task.runtime.status = 'queued';
      task.runtime.waitReason = reason || 'deferred';
      task.runtime.startedAt = undefined;
      task.runtime.endedAt = undefined;
      task.runtime.heartbeatTs = undefined;
      task.runtime.lastProgressAt = Date.now();
      this.store.setTask(taskId, task);
    }
    return { ok: true, status: task.runtime.status, waitReason: task.runtime.waitReason };
  }

  cancelTask(taskId: string, reason: string): { ok: true } {
    this.cleanupStaleTasks();
    const task = this.store.getTask(taskId);
    if (task) {
      task.runtime.status = 'canceled';
      task.runtime.waitReason = reason || 'manual-cancel';
      task.runtime.endedAt = Date.now();
      this.store.setTask(taskId, task);
    }
    return { ok: true };
  }

  cancelTasksByPageInstance(pageInstanceId: string, reason: string): { ok: true; canceled: number } {
    this.cleanupStaleTasks();
    let canceled = 0;
    for (const record of this.store.listTasks()) {
      if (record?.descriptor?.pageInstanceId !== pageInstanceId) continue;
      if (['done', 'error', 'canceled'].includes(record.runtime.status)) continue;
      record.runtime.status = 'canceled';
      record.runtime.waitReason = reason || 'page-closed-by-user';
      record.runtime.endedAt = Date.now();
      this.store.setTask(record.descriptor.taskId, record);
      canceled += 1;
    }
    return { ok: true, canceled };
  }

  cancelTasksByTabId(tabId: number, reason: string): { ok: true; canceled: number } {
    this.cleanupStaleTasks();
    let canceled = 0;
    for (const record of this.store.listTasks()) {
      if (record?.descriptor?.tabId !== tabId) continue;
      if (['done', 'error', 'canceled'].includes(record.runtime.status)) continue;
      record.runtime.status = 'canceled';
      record.runtime.waitReason = reason || 'page-closed-by-user';
      record.runtime.endedAt = Date.now();
      this.store.setTask(record.descriptor.taskId, record);
      canceled += 1;
    }
    return { ok: true, canceled };
  }

  updateVisibility(tabId: number, visible: boolean): { ok: true } {
    this.cleanupStaleTasks();
    this.store.setVisibility(tabId, visible);
    return { ok: true };
  }

  clearAll(): { ok: true } {
    this.store.clear();
    this.dedupeIndex.clear();
    this.completedTaskLabels.clear();
    chrome.storage.local.remove([this.storageKey, this.dedupeStorageKey]).catch(() => {});
    return { ok: true };
  }

  clearTerminalTasks(): { ok: true; cleared: number } {
    this.cleanupStaleTasks();
    let cleared = 0;
    for (const record of this.store.listTasks()) {
      if (!['done', 'error', 'canceled'].includes(record.runtime.status)) continue;
      this.store.deleteTask(record.descriptor.taskId);
      const dedupeKey = record.descriptor.dedupeKey;
      if (dedupeKey && this.dedupeIndex.get(dedupeKey) === record.descriptor.taskId) {
        this.dedupeIndex.delete(dedupeKey);
      }
      cleared += 1;
    }
    this.persistToStorage();
    return { ok: true, cleared };
  }

  stopAllActiveTasks(reason: string = 'manual-stop-all'): { ok: true; canceled: number } {
    this.cleanupStaleTasks();
    let canceled = 0;
    for (const record of this.store.listTasks()) {
      if (['done', 'error', 'canceled'].includes(record.runtime.status)) continue;
      record.runtime.status = 'canceled';
      record.runtime.waitReason = reason;
      record.runtime.endedAt = Date.now();
      this.store.setTask(record.descriptor.taskId, record);
      canceled += 1;
    }
    this.persistToStorage();
    return { ok: true, canceled };
  }

  // P1 FIX: 定期快照定时器（每 30s 持久化一次状态，防止 service worker 重启丢失）
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private startPeriodicSnapshot(): void {
    if (this.persistTimer) return;
    this.persistTimer = setInterval(() => {
      this.cleanupStaleTasks();
      this.persistToStorage();
    }, 30_000);
  }

  queryState() {
    this.cleanupStaleTasks();
    const tasks = this.store.listTasks().map(record => ({
      taskId: record.descriptor.taskId,
      label: record.descriptor.label,
      parentTaskId: record.descriptor.parentTaskId,
      rootTaskId: record.descriptor.rootTaskId,
      correlationId: record.descriptor.correlationId,
      tabId: record.descriptor.tabId,
      pageUrl: record.descriptor.pageUrl,
      pageType: record.descriptor.pageType,
      mainId: record.descriptor.mainId,
      pageInstanceId: record.descriptor.pageInstanceId,
      phase: record.descriptor.phase,
      priority: record.descriptor.priority,
      cost: record.descriptor.cost,
      visibilityPolicy: record.descriptor.visibilityPolicy,
      timeoutMs: record.descriptor.timeoutMs,
      retryLimit: record.descriptor.retryLimit,
      dedupeKey: record.descriptor.dedupeKey,
      resumePolicy: record.descriptor.resumePolicy,
      executionClass: record.descriptor.executionClass,
      shareScope: record.descriptor.shareScope,
      createdAt: record.descriptor.createdAt,
      status: record.runtime.status,
      waitReason: record.runtime.waitReason,
      startedAt: record.runtime.startedAt,
      endedAt: record.runtime.endedAt,
      lastProgressAt: record.runtime.lastProgressAt,
      progressPct: record.runtime.progressPct,
      stage: record.runtime.stage,
      stageStartedAt: record.runtime.stageStartedAt,
      stageDurationMs: record.runtime.stageDurationMs,
      detail: record.runtime.detail,
      retryCount: record.runtime.retryCount,
      pauseCount: record.runtime.pauseCount,
      resumeCount: record.runtime.resumeCount,
      heartbeatTs: record.runtime.heartbeatTs,
    }));
    return { tasks };
  }

  updateTaskProgress(taskId: string, payload: { stage?: string; progressPct?: number; detail?: string; stageStartedAt?: number; stageDurationMs?: number }) {
    const record = this.store.getTask(taskId);
    if (!record) return { ok: false, error: 'task-not-found' };
    record.runtime.lastProgressAt = Date.now();
    if (typeof payload.progressPct === 'number') record.runtime.progressPct = payload.progressPct;
    if (typeof payload.stage === 'string') record.runtime.stage = payload.stage;
    if (typeof payload.detail === 'string') record.runtime.detail = payload.detail;
    if (typeof payload.stageStartedAt === 'number') record.runtime.stageStartedAt = payload.stageStartedAt;
    if (typeof payload.stageDurationMs === 'number') record.runtime.stageDurationMs = payload.stageDurationMs;
    this.store.setTask(taskId, record);
    this.persistToStorage();
    return { ok: true };
  }

  handleMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): void {
    try {
      switch (message?.type) {
        case TASK_CENTER_MESSAGE.REGISTER:
          sendResponse(this.registerTask(message.payload, sender));
          return;
        case TASK_CENTER_MESSAGE.REGISTER_BATCH:
          sendResponse({ results: this.registerTasks(Array.isArray(message.payload?.descriptors) ? message.payload.descriptors : [], sender) });
          return;
        case TASK_CENTER_MESSAGE.REQUEST_LEASE:
          {
            const leaseResponse = this.requestLease(message.payload.taskId);
            if (!leaseResponse.granted) {
              sendResponse(leaseResponse);
              return;
            }
            void this.lastGrantedLeasePersistence.then(() => sendResponse(leaseResponse));
          }
          return;
        case TASK_CENTER_MESSAGE.HEARTBEAT:
          sendResponse(this.heartbeatTask(message.payload.taskId));
          return;
        case TASK_CENTER_MESSAGE.PROGRESS:
          sendResponse(this.updateTaskProgress(message.payload.taskId, message.payload || {}));
          return;
        case TASK_CENTER_MESSAGE.PAUSE:
          sendResponse(this.pauseTask(message.payload.taskId, String(message.payload.reason || 'paused')));
          return;
        case TASK_CENTER_MESSAGE.RESUME:
          sendResponse(this.resumeTask(message.payload.taskId));
          return;
        case TASK_CENTER_MESSAGE.COMPLETE:
          sendResponse(this.completeTask(message.payload.taskId));
          return;
        case TASK_CENTER_MESSAGE.FAIL:
          sendResponse(this.failTask(message.payload.taskId, String(message.payload.error || '')));
          return;
        case TASK_CENTER_MESSAGE.DEFER:
          sendResponse(this.deferTask(message.payload.taskId, String(message.payload.reason || 'deferred')));
          return;
        case TASK_CENTER_MESSAGE.CANCEL:
          sendResponse(this.cancelTask(message.payload.taskId, String(message.payload.reason || '')));
          return;
        case TASK_CENTER_MESSAGE.VISIBILITY:
          if (typeof sender.tab?.id === 'number') {
            sendResponse(this.updateVisibility(sender.tab.id, !!message.payload?.visible));
            return;
          }
          sendResponse({ ok: false, error: 'missing-tab-id' });
          return;
        case TASK_CENTER_MESSAGE.QUERY:
          sendResponse(this.queryState());
          return;
        case TASK_CENTER_MESSAGE.CLEAR:
          sendResponse(this.clearAll());
          return;
        case 'task-center:stop-all':
          sendResponse(this.stopAllActiveTasks(String(message.payload?.reason || 'manual-stop-all')));
          return;
        // P1 FIX: 跨页面依赖同步消息
        case 'task-center:mark-completed':
          this.markTaskLabelCompleted(String(message.payload?.label || ''));
          sendResponse({ ok: true });
          return;
        case 'task-center:check-completed':
          sendResponse({ ok: true, completed: this.isTaskLabelCompleted(String(message.payload?.label || '')) });
          return;
        case 'task-center:restore':
          this.restoreFromStorage().then(() => { sendResponse({ ok: true }); }).catch((e) => { sendResponse({ ok: false, error: String(e) }); });
          return; // async response via sendResponse
        case TASK_CENTER_MESSAGE.PAGE_LIFECYCLE:
        case TASK_CENTER_MESSAGE.CANCEL_PAGE_INSTANCE: {
          const pageInstanceId = String(message.payload?.pageInstanceId || '');
          const reason = String(message.payload?.reason || 'page-closed-by-user');
          if (!pageInstanceId) {
            sendResponse({ ok: false, error: 'missing-page-instance-id' });
            return;
          }
          sendResponse(this.cancelTasksByPageInstance(pageInstanceId, reason));
          return;
        }
        default:
          sendResponse({ ok: false, error: 'unknown-task-center-message' });
          return;
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
  }

  isAsyncMessage(messageType: string | undefined): boolean {
    return messageType === 'task-center:restore' || messageType === TASK_CENTER_MESSAGE.REQUEST_LEASE;
  }
}

export const globalTaskCenter = new GlobalTaskCenter();
