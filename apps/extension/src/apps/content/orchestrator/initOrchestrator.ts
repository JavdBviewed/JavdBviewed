/**
 * @file initOrchestrator.ts
 * @description initOrchestrator
 * @module apps/content
 */
// src/apps/content/orchestrator/initOrchestrator.ts

// removed unused import: performanceOptimizer
import {
  CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS,
  createManagedTaskDescriptor,
  ensureManagedTaskRegistered,
  ensureManagedTasksRegistered,
  isGlobalTaskLabelCompleted,
  isRetryBudgetExhausted,
  incrementTaskRetryCount,
  notifyGlobalTaskCompleted,
  recordContentPerformanceDuration,
  resolveTaskBucket,
  runManagedTask,
  runRegisteredManagedTask,
  clearTaskRetryBudget,
  startContentPerformanceSpan,
} from '../../../platform/tasks';
import type { GlobalTaskDescriptor, GlobalTaskVisibilityPolicy } from '../../../shared/taskCenterTypes';
import { getPageContext } from '../../../platform/browser';
import { installOrchestratorDashboardMetricsMessages } from './dashboardMetricsMessages';
import { resolveBrowserHighTaskConcurrency } from './hardwareConcurrency';
import { runHighPhaseTasks } from './highPhaseScheduler';
import { OrchestratorMetricsState } from './metrics';
import { installOrchestratorPageLifecycleBindings } from './pageLifecycleBindings';
import { OrchestratorRetryTimers } from './retryTimers';
import { countContentPerformanceEvent } from '../../../platform/tasks';
import {
  createTaskKey,
  getDeferredRetryDelayMs,
  getDependencyWaitLimitMs,
  getHiddenIdleDelayMs,
  getPhaseTaskCost,
  isLeaseAvailabilityWaitReason,
  isDeferredWaitReason,
} from './schedulingRules';
import {
  getDefaultVisibilityPolicy,
  type InitPhase,
  type InitTask,
  type InitTaskOptions,
  type ManagedScheduledTask,
  type ScheduledTask,
  type TaskBlueprint,
  type TaskDeferredError,
  type TaskDependencyDeferredError,
} from './types';

class InitOrchestrator {
  private phases: { [K in InitPhase]: ManagedScheduledTask[] } = { critical: [], high: [], deferred: [], idle: [] };
  private started = false;
  private timeline: Array<{ phase: InitPhase; label: string; status: 'scheduled' | 'running' | 'done' | 'error'; ts: number; detail?: any; durationMs?: number }>= [];
  private t0: number | null = null; // run() 开始时刻，用于相对时间
  private verbose = true; // 统一开关，控制是否打印详细日志
  private listeners: Record<string, Array<(payload: any) => void>> = {};
  private blueprintDescriptors = new Map<string, GlobalTaskDescriptor>();
  private registeredBlueprintTaskKeys = new Set<string>();
  private taskIndex = new Map<string, ManagedScheduledTask>();

  // 并发控制
  private runningHighTasks = 0;
  private maxConcurrentHighTasks = 3; // 限制high阶段并发数

  // P0 FIX: 本地并发门控（限制 deferred/idle 每页同时起跑数，避免 25 个标签页同时爆发）
  private runningDeferred = 0;
  private runningIdle = 0;
  private readonly maxConcurrentDeferred = 3;  // 每页最多同时跑 3 个 deferred 任务
  private readonly maxConcurrentIdle = 2;      // 每页最多同时跑 2 个 idle 任务

  // P0 FIX: 任务老化检测（防止"已注册但长期卡住"的任务饿死）
  private pendingRegistrationTimes = new Map<string, number>(); // taskKey -> registeredAt
  private readonly stallThresholdMs = 8000;  // 注册后 8s 未起跑则强制触发

  // P0 FIX: hidden 页 lease 泄漏保护
  private hiddenLeaseTasks = new Map<string, number>(); // taskId -> hiddenAt timestamp
  private readonly hiddenLeaseReleaseMs = 60_000;  // hidden 超过 60s 记录诊断信息

  private readonly metrics = new OrchestratorMetricsState();

  // 任务依赖管理
  private completedTasks = new Set<string>(); // 已完成的任务标签
  private taskDependencies = new Map<string, string[]>(); // 任务依赖关系
  private retryTimers = new OrchestratorRetryTimers();
  private foregroundDeferredTaskKeys = new Set<string>();
  private stallDetectionTimer?: number;
  private hiddenLeaseProtectionTimer?: number;
  private removeVisibilityListener?: () => void;

  /**
   * 允许用「其它页已完成」满足 dependsOn 的 label 白名单（仅网络/数据类，禁止 DOM per-page）。
   * @see P2 R6
   */
  private static readonly GLOBAL_DEPENDENCY_LABELS = new Set([
    'videoEnhancement:runRelatedLists',
    'videoEnhancement:runFC2Breaker',
    'videoEnhancement:runReviewBreaker',
    'onlineAvailability:check',
    'ux:magnet:autoSearch',
  ]);

  private isGlobalDependencyLabel(label: string): boolean {
    return InitOrchestrator.GLOBAL_DEPENDENCY_LABELS.has(label);
  }

  /** 本地未满足的依赖中，过滤掉 global 已完成的项 */
  private async filterUnmetDependencies(dependsOn: string[] | undefined): Promise<string[]> {
    const deps = dependsOn || [];
    const localUnmet = deps.filter((dep) => !this.completedTasks.has(dep));
    if (localUnmet.length === 0) return [];

    const stillUnmet: string[] = [];
    for (const dep of localUnmet) {
      if (!this.isGlobalDependencyLabel(dep)) {
        stillUnmet.push(dep);
        continue;
      }
      try {
        const done = await isGlobalTaskLabelCompleted(dep);
        if (done) {
          this.completedTasks.add(dep);
          this.log('dependency satisfied via global', { dep });
          continue;
        }
      } catch {}
      stillUnmet.push(dep);
    }
    return stillUnmet;
  }

  private markLocalAndMaybeGlobalComplete(label: string): void {
    if (!label || label === 'anonymous') return;
    this.completedTasks.add(label);
    if (this.isGlobalDependencyLabel(label)) {
      void notifyGlobalTaskCompleted(label);
    }
  }

  constructor() {
    // 根据设备性能动态调整并发数
    this.adjustConcurrencyByHardware();
    // P0 FIX: 启动老化检测（每 2s 检查一次卡住的任务）
    this.startStallDetection();
    // P0 FIX: 启动 hidden lease 泄漏保护
    this.startHiddenLeaseProtection();
  }

  // ── P0 FIX: 任务老化检测 ────────────────────────────────────────────────
  private startStallDetection(): void {
    this.stallDetectionTimer = window.setInterval(() => {
      countContentPerformanceEvent('interval.orchestrator.stallDetection');
      const now = Date.now();
      for (const [taskKey, registeredAt] of this.pendingRegistrationTimes.entries()) {
        if (now - registeredAt > this.stallThresholdMs) {
          this.pendingRegistrationTimes.delete(taskKey);
          const [phase, label] = taskKey.split('|', 2);
          const st = (this.phases[phase as InitPhase] || []).find(s => (s.options.label || '') === label);
          if (st) {
            this.log('stall: forcing lease retry', { phase, label, waitMs: now - registeredAt });
            this.runTask(phase as InitPhase, st).catch(() => {});
          }
        }
      }
    }, 2000);
  }

  // ── P0 FIX: hidden 页 lease 泄漏保护 ────────────────────────────────────
  private startHiddenLeaseProtection(): void {
    // 当页面隐藏时，记录 lease 持有任务
    const onVisibilityChange = () => {
      if (document.hidden) {
        const now = Date.now();
        for (const [_phase, tasks] of Object.entries(this.phases)) {
          for (const st of tasks) {
            if (st.managedDescriptor?.taskId) {
              this.hiddenLeaseTasks.set(st.managedDescriptor.taskId, now);
            }
          }
        }
        return;
      }

      for (const [phase, tasks] of Object.entries(this.phases) as Array<[InitPhase, ManagedScheduledTask[]]>) {
        for (const st of tasks) {
          const label = st.options.label;
          if (!label || st.completed || st.running) continue;
          const taskKey = createTaskKey(phase, label);
          if (!this.foregroundDeferredTaskKeys.delete(taskKey)) continue;
          this.log('foreground task resumed after visibility restore', { phase, label });
          this.runTask(phase, st).catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    this.removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisibilityChange);

    // 每 30s 检查 hidden 超过阈值的任务，仅记录诊断；真正回收由 background 执行
    this.hiddenLeaseProtectionTimer = window.setInterval(() => {
      countContentPerformanceEvent('interval.orchestrator.hiddenLeaseProtection');
      const now = Date.now();
      if (!document.hidden) return;
      for (const [taskId, hiddenAt] of this.hiddenLeaseTasks.entries()) {
        if (now - hiddenAt > this.hiddenLeaseReleaseMs) {
          this.hiddenLeaseTasks.delete(taskId);
          this.log('hidden-leak: background cleanup expected', { taskId, hiddenMs: now - hiddenAt });
        }
      }
    }, 30_000);
  }

  private relTs(now?: number): number {
    const base = this.t0 ?? performance.now();
    const cur = typeof now === 'number' ? now : performance.now();
    return Math.max(0, cur - base);
  }

  private log(...args: any[]) {
    if (!this.verbose) return;
    try { console.log('[Orchestrator]', ...args); } catch {}
  }

  private clearDeferredRetry(phase: InitPhase, label: string): void {
    this.retryTimers.clear(phase, label);
  }

  private scheduleDeferredRetry(phase: InitPhase, st: ManagedScheduledTask, waitReason?: string): void {
    const label = st.options.label || 'anonymous';
    if (label === 'anonymous') return;
    const taskId = st.managedDescriptor?.taskId || '';

    const visibilityPolicy = st.managedDescriptor?.visibilityPolicy
      ?? st.options.visibilityPolicy
      ?? getDefaultVisibilityPolicy(phase);
    if (
      waitReason === 'tab-hidden'
      && visibilityPolicy === 'foreground_first'
      && typeof document !== 'undefined'
      && document.visibilityState !== 'visible'
    ) {
      this.foregroundDeferredTaskKeys.add(createTaskKey(phase, label));
      this.log('foreground task waiting for visibility restore', { phase, label });
      return;
    }

    const usesLocalRetryBudget = waitReason !== 'retryable-error'
      && !isLeaseAvailabilityWaitReason(waitReason);

    if (usesLocalRetryBudget && taskId && isRetryBudgetExhausted(taskId)) {
      this.log('retry: budget exhausted, giving up', { phase, label, taskId });
      clearTaskRetryBudget(taskId);
      return;
    }

    const retryDelayMs = getDeferredRetryDelayMs(waitReason);
    const scheduled = this.retryTimers.schedule(phase, label, retryDelayMs, () => {
      if (usesLocalRetryBudget && taskId) {
        const newCount = incrementTaskRetryCount(taskId);
        this.log('retry: incrementing budget', { phase, label, taskId, retryCount: newCount });
        if (isRetryBudgetExhausted(taskId)) {
          this.log('retry: budget will be exhausted after this attempt', { phase, label, taskId });
        }
      }
      this.runTask(phase, st).catch(() => {});
    });
    if (!scheduled) return;
    this.log('deferred retry scheduled', { phase, label, waitReason, retryDelayMs });
  }

  private scheduleDependencyRetry(phase: InitPhase, st: ManagedScheduledTask, unmetDeps: string[]): void {
    const label = st.options.label || 'anonymous';
    if (label === 'anonymous') return;
    const retryDelayMs = 400;
    const scheduled = this.retryTimers.schedule(phase, label, retryDelayMs, () => {
      this.runTask(phase, st).catch(() => {});
    });
    if (!scheduled) return;
    this.log('dependency retry scheduled', { phase, label, unmetDeps, retryDelayMs });
  }


  private buildManagedDescriptor(
    phase: InitPhase,
    label: string,
    options: { priority?: number; timeout?: number; visibilityPolicy?: GlobalTaskVisibilityPolicy } = {},
  ): GlobalTaskDescriptor {
    return createManagedTaskDescriptor({
      label,
      phase,
      priority: options.priority ?? 5,
      cost: getPhaseTaskCost(phase),
      visibilityPolicy: options.visibilityPolicy ?? getDefaultVisibilityPolicy(phase),
      timeoutMs: (options.timeout || 0) > 0 ? (options.timeout || 0) : 10000,
      retryLimit: 2,
      registrationSource: 'blueprint',
      resumePolicy: 'restart',
    });
  }

  async preregisterBlueprints(blueprints: TaskBlueprint[]): Promise<void> {
    const descriptors: Array<{ taskKey: string; label: string; descriptor: GlobalTaskDescriptor }> = [];
    for (const blueprint of blueprints) {
      if (!blueprint?.label) continue;
      const taskKey = createTaskKey(blueprint.phase, blueprint.label);
      let descriptor = this.blueprintDescriptors.get(taskKey);
      if (!descriptor) {
        descriptor = this.buildManagedDescriptor(blueprint.phase, blueprint.label, {
          priority: blueprint.priority,
          timeout: blueprint.timeout,
          visibilityPolicy: blueprint.visibilityPolicy,
        });
        this.blueprintDescriptors.set(taskKey, descriptor);
      }
      descriptors.push({ taskKey, label: blueprint.label, descriptor });
    }

    try {
      const registeredDescriptors = await ensureManagedTasksRegistered(descriptors.map((entry) => entry.descriptor));
      descriptors.forEach((entry, index) => {
        this.blueprintDescriptors.set(entry.taskKey, registeredDescriptors[index]);
        this.registeredBlueprintTaskKeys.add(entry.taskKey);
      });
    } catch (error) {
      this.log('blueprint batch pre-register failed', { error: String(error) });
      for (const entry of descriptors) {
        try {
          const registered = await ensureManagedTaskRegistered(entry.descriptor);
          this.blueprintDescriptors.set(entry.taskKey, registered);
          this.registeredBlueprintTaskKeys.add(entry.taskKey);
        } catch (registrationError) {
          this.log('blueprint pre-register task failed', { label: entry.label, error: String(registrationError) });
        }
      }
    }
  }

  private trackTask(st: ManagedScheduledTask): void {
    const label = st.options.label;
    if (label) {
      this.taskIndex.set(label, st);
    }
  }

  private markTaskStarted(label: string): void {
    const task = this.taskIndex.get(label);
    if (task && !task.startedAt) {
      task.startedAt = performance.now();
    }
  }

  /**
   * 根据设备硬件性能动态调整并发数
   */
  private adjustConcurrencyByHardware(): void {
    const decision = resolveBrowserHighTaskConcurrency();
    this.maxConcurrentHighTasks = decision.maxConcurrentHighTasks;
    this.log(decision.message);
  }

  /**
   * 更新性能指标
   */
  private updateMetrics(durationMs: number, success: boolean, isTimeout: boolean = false, taskLabel?: string): void {
    this.metrics.recordTask(durationMs, success, isTimeout, taskLabel);
    this.scheduleMetricsSave();
  }

  /**
   * 获取性能指标
   */
  getMetrics() {
    return this.metrics.getSnapshot();
  }

  /**
   * 重置内存中的性能指标（由后台广播触发，配合清空存储使用）
   */
  resetMetrics() {
    this.metrics.reset();
    if (this.metricsSaveTimeout) {
      clearTimeout(this.metricsSaveTimeout);
      this.metricsSaveTimeout = undefined;
    }
  }

  /**
   * 将性能指标保存到数据库
   */
  private async saveMetricsToDatabase(): Promise<void> {
    try {
      const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
      const metrics = {
        ...this.metrics.getSnapshot(),
        pageUrl,
        timestamp: Date.now(),
      };

      this.log('Saving metrics to database:', metrics);

      // 发送到后台保存
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'orchestrator:saveMetrics',
          metrics,
        }, (response) => {
          if (chrome.runtime.lastError) {
            this.log('metrics save callback closed', { error: chrome.runtime.lastError.message });
          } else {
            this.log('Metrics saved successfully:', response);
          }
        });
      }
    } catch (e) {
      console.warn('[Orchestrator] Failed to save metrics to database:', e);
    }
  }

  /**
   * 保存单个任务的详细信息
   */
  private async saveTaskDetail(phase: InitPhase, label: string, status: 'done' | 'error', durationMs: number | undefined, error?: string): Promise<void> {
    try {
      const pageContext = typeof window !== 'undefined' ? getPageContext() : { pageUrl: '', pageType: 'generic', mainId: '', pageInstanceId: '' };
      const trackedTask = this.taskIndex.get(label);
      const registeredAt = trackedTask?.managedDescriptor?.createdAt || 0;
      const startedAt = typeof trackedTask?.startedAt === 'number' ? Math.round(performance.timeOrigin + trackedTask.startedAt) : 0;
      const endedAt = status === 'done' || status === 'error' ? Date.now() : 0;
      const taskDetail = {
        label,
        phase,
        status,
        durationMs: durationMs || 0,
        registrationSource: trackedTask?.managedDescriptor?.registrationSource || 'runtime',
        registeredAt,
        startedAt,
        endedAt,
        queueAgeMs: registeredAt > 0 && startedAt > 0 ? Math.max(0, startedAt - registeredAt) : undefined,
        bucket: resolveTaskBucket(label),
        visibilityPolicy: trackedTask?.managedDescriptor?.visibilityPolicy,
        cost: trackedTask?.managedDescriptor?.cost,
        retryLimit: trackedTask?.managedDescriptor?.retryLimit,
        shareScope: trackedTask?.managedDescriptor?.shareScope,
        executionClass: trackedTask?.managedDescriptor?.executionClass,
        pageUrl: pageContext.pageUrl,
        pageType: pageContext.pageType,
        mainId: pageContext.mainId,
        pageInstanceId: pageContext.pageInstanceId,
        timestamp: Date.now(),
        error,
      };

      // 发送到后台保存
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'orchestrator:saveTaskDetail',
          taskDetail,
        }, () => {
          if (chrome.runtime.lastError) {
            // 静默失败，不影响主流程
          }
        });
      }
    } catch (e) {
      // 静默失败
    }
  }

  /**
   * 任务完成时保存性能指标
   */
  private scheduleMetricsSave(): void {
    // 防抖：避免频繁写入数据库
    if (this.metricsSaveTimeout) {
      clearTimeout(this.metricsSaveTimeout);
    }
    this.metricsSaveTimeout = window.setTimeout(() => {
      this.saveMetricsToDatabase();
    }, 1000); // 1秒后保存
  }

  private metricsSaveTimeout?: number;

  /** 页面卸载时释放编排器的常驻监控和延迟重试资源。 */
  dispose(): void {
    if (this.stallDetectionTimer !== undefined) {
      window.clearInterval(this.stallDetectionTimer);
      this.stallDetectionTimer = undefined;
    }
    if (this.hiddenLeaseProtectionTimer !== undefined) {
      window.clearInterval(this.hiddenLeaseProtectionTimer);
      this.hiddenLeaseProtectionTimer = undefined;
    }
    this.removeVisibilityListener?.();
    this.removeVisibilityListener = undefined;
    this.retryTimers.clearAll();
    this.foregroundDeferredTaskKeys.clear();
    if (this.metricsSaveTimeout !== undefined) {
      window.clearTimeout(this.metricsSaveTimeout);
      this.metricsSaveTimeout = undefined;
    }
  }

  async add(phase: InitPhase, task: InitTask, options: InitTaskOptions = {}): Promise<void> {
    if (options.label) {
      const existingTask = this.phases[phase].find((scheduledTask) => (scheduledTask.options.label || '') === options.label);
      if (existingTask) {
        this.log('skip duplicate add', { phase, label: options.label });
        return;
      }
    }

    // 记录任务依赖关系
    if (options.dependsOn && options.dependsOn.length > 0 && options.label) {
      this.taskDependencies.set(options.label, options.dependsOn);
    }

    const managedScheduledTask: ManagedScheduledTask = { task, options };
    this.trackTask(managedScheduledTask);
    if (options.label) {
      const taskKey = createTaskKey(phase, options.label);
      managedScheduledTask.managedDescriptor = this.blueprintDescriptors.get(taskKey)
        || this.buildManagedDescriptor(phase, options.label, {
          priority: options.priority,
          timeout: options.timeout,
          visibilityPolicy: options.visibilityPolicy,
        });
      managedScheduledTask.managedDescriptorRegistered = this.registeredBlueprintTaskKeys.has(taskKey);
      this.blueprintDescriptors.set(taskKey, managedScheduledTask.managedDescriptor);
      // P0 FIX: 记录任务注册时间，用于老化检测
      this.pendingRegistrationTimes.set(taskKey, Date.now());
    }
    this.phases[phase].push(managedScheduledTask);
    if (managedScheduledTask.managedDescriptor && !managedScheduledTask.managedDescriptorRegistered) {
      try {
        const registered = await ensureManagedTaskRegistered(managedScheduledTask.managedDescriptor);
        managedScheduledTask.managedDescriptor = registered;
        managedScheduledTask.managedDescriptorRegistered = true;
      } catch (error) {
        this.log(this.started ? 'post-start pre-register task failed' : 'add-time pre-register task failed', {
          label: options.label,
          error: String(error),
        });
      }
    }
    const abs = performance.now();
    const label = options.label || 'anonymous';
    this.timeline.push({ phase, label, status: 'scheduled', ts: abs });
    this.emit('task:scheduled', { phase, label, ts: abs, relativeTs: this.relTs(abs), options });
    this.log('scheduled', { phase, label, delayMs: options.delayMs, idle: options.idle, priority: options.priority, timeout: options.timeout, dependsOn: options.dependsOn, ts: Math.round(abs), relative: Math.round(this.relTs(abs)) });

    if (!this.started) return;
    if (phase === 'critical') {
      void this.runTask('critical', managedScheduledTask).catch((error) => {
        this.log('post-start critical task failed', { label, error: String(error) });
      });
      return;
    }
    if (phase === 'high') {
      void this.runHighTasksWithConcurrencyControl().catch((error) => {
        this.log('post-start high-phase-error', { label, error: String(error) });
      });
      return;
    }
    this.scheduleTask(phase, managedScheduledTask);
  }

  getState() {
    return {
      started: this.started,
      t0: this.t0,
      phases: Object.keys(this.phases).reduce((acc, k) => ({ ...acc, [k]: (this.phases as any)[k].map((t: ScheduledTask) => t.options.label || 'anonymous') }), {} as Record<string, string[]>),
      timeline: [...this.timeline],
    };
  }

  private async preregisterAllManagedTasks(): Promise<void> {
    const scheduledTasks = [
      ...this.phases.critical,
      ...this.phases.high,
      ...this.phases.deferred,
      ...this.phases.idle,
    ];

    for (const st of scheduledTasks) {
      if (!st.managedDescriptor || st.managedDescriptorRegistered) continue;
      try {
        const registered = await ensureManagedTaskRegistered(st.managedDescriptor);
        st.managedDescriptor = registered;
        st.managedDescriptorRegistered = true;
      } catch (error) {
        this.log('pre-register task failed', { label: st.options.label, error: String(error) });
      }
    }
  }

  private runTask(phase: InitPhase, st: ManagedScheduledTask): Promise<void> {
    if (st.completed) {
      return Promise.resolve();
    }

    const label = st.options.label || 'anonymous';
    this.clearDeferredRetry(phase, label);
    st.queued = false;
    if (st.running) {
      return Promise.resolve();
    }
    st.running = true;
    this.markTaskStarted(label);

    // P2 R6: 本地 completedTasks + 白名单 label 的 global completed 双查询
    return this.filterUnmetDependencies(st.options.dependsOn).then((localUnmetDeps) => {
      if (localUnmetDeps.length > 0) {
        st.running = false;
        const dependencyError = new Error(`Task waiting for dependencies: ${localUnmetDeps.join(',')}`) as TaskDependencyDeferredError;
        dependencyError.unmetDeps = localUnmetDeps;
        return Promise.reject(dependencyError);
      }

      const startMark = `orchestrator:${phase}:${label}:start`;
    const endMark = `orchestrator:${phase}:${label}:end`;
    try { performance.mark(startMark); } catch {}
    const startAbs = performance.now();
    this.timeline.push({ phase, label, status: 'running', ts: startAbs });
    this.emit('task:running', { phase, label, ts: startAbs, relativeTs: this.relTs(startAbs) });
    this.log('running', { phase, label, ts: Math.round(startAbs), relative: Math.round(this.relTs(startAbs)) });

    // 创建超时Promise
    const timeout = st.options.timeout || 0;
    const executeTask = async () => {
      if (timeout <= 0) return await st.task();
      if (st.options.timeoutBehavior !== 'diagnostic') {
        let timeoutId: number | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error(`Task timeout after ${timeout}ms`));
          }, timeout);
        });
        try {
          return await Promise.race([st.task(), timeoutPromise]);
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
      }
      let timeoutId: number | undefined;
      let timeoutReported = false;
      const execution = Promise.resolve().then(() => st.task());
      timeoutId = window.setTimeout(() => {
        timeoutReported = true;
        // Most content work (DOM/IndexedDB) has no cancellation primitive.
        // Releasing its lease here would allow a retry to overlap the still
        // running operation, multiplying page and storage pressure.
        console.warn(`[InitOrchestrator] task exceeded timeout: phase=${phase} label=${label} timeout=${timeout}ms`);
      }, timeout);
      try {
        return await execution;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (timeoutReported) {
          this.log('timeout-diagnostic-complete', { phase, label, timeout, durationMs: Math.round(performance.now() - startAbs) });
        }
      }
    };

    const taskPromise = Promise.resolve()
      .then(async () => {
        if (label === 'anonymous') {
          return executeTask();
        }

        const descriptor = st.managedDescriptor || createManagedTaskDescriptor({
          label,
          phase,
          priority: st.options.priority ?? 5,
          cost: getPhaseTaskCost(phase),
          visibilityPolicy: st.options.visibilityPolicy ?? getDefaultVisibilityPolicy(phase),
          timeoutMs: timeout > 0 ? timeout : 10000,
          retryLimit: 2,
          registrationSource: 'runtime',
          resumePolicy: 'restart',
        });
        st.managedDescriptor = descriptor;
        const runResult = st.managedDescriptorRegistered
          ? await runRegisteredManagedTask(st.managedDescriptor, async () => await executeTask())
          : await runManagedTask(descriptor, async () => await executeTask());
        if (!runResult.executed) {
          const deferredError = new Error(`Task deferred: ${runResult.waitReason}`) as TaskDeferredError;
          deferredError.waitReason = runResult.waitReason;
          throw deferredError;
        }
        return runResult.result;
      })
      .then(() => {
        try {
          performance.mark(endMark);
          performance.measure(`orchestrator:${phase}:${label}`, startMark, endMark);
        } catch {}
        let durationMs: number | undefined = undefined;
        try {
          const entries = performance.getEntriesByName(`orchestrator:${phase}:${label}`);
          const last = entries[entries.length - 1] as PerformanceMeasure | undefined;
          durationMs = last?.duration;
        } catch {}
        const endAbs = performance.now();
        this.timeline.push({ phase, label, status: 'done', ts: endAbs, durationMs });
        this.emit('task:done', { phase, label, ts: endAbs, relativeTs: this.relTs(endAbs), durationMs });
        this.log('done', { phase, label, ts: Math.round(endAbs), relative: Math.round(this.relTs(endAbs)), durationMs: durationMs && Math.round(durationMs) });
        // 更新性能指标
        if (durationMs !== undefined) {
          this.updateMetrics(durationMs, true, false, label);
          recordContentPerformanceDuration(
            `${CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.orchestratorTaskPrefix}${phase}.${label}`,
            durationMs,
          );
        }
        // P0 FIX: 任务完成后清理老化记录 + 更新本地并发计数
        if (st.options.label) {
          this.pendingRegistrationTimes.delete(createTaskKey(phase, st.options.label));
        }
        if (phase === 'deferred') this.runningDeferred = Math.max(0, this.runningDeferred - 1);
        if (phase === 'idle') this.runningIdle = Math.max(0, this.runningIdle - 1);
        st.running = false;
        st.completed = true;
        // P2 FIX: 任务成功后清理重试预算
        if (st.managedDescriptor?.taskId) {
          clearTaskRetryBudget(st.managedDescriptor.taskId);
        }
        // 标记任务为已完成（白名单 label 同步 global，供跨页 dependsOn）
        this.markLocalAndMaybeGlobalComplete(label);
        // A high task may depend on data from a later phase. Recheck pending
        // high work after that data completes instead of leaving it registered.
        if (phase !== 'high') {
          void this.runHighTasksWithConcurrencyControl().catch((error) => {
            this.log('high-phase-recheck-error', { label, error: String(error) });
          });
        }
        // 保存任务详细信息
        this.saveTaskDetail(phase, label, 'done', durationMs);
      })
      .catch((e) => {
        const deferredError = e as TaskDeferredError;
        const waitReason = deferredError?.waitReason;
        const isDeferred = isDeferredWaitReason(waitReason);
        if (isDeferred) {
          // P0 FIX: 重新入队时释放本地并发计数，让后续任务得以起跑
          if (phase === 'deferred') this.runningDeferred = Math.max(0, this.runningDeferred - 1);
          if (phase === 'idle') this.runningIdle = Math.max(0, this.runningIdle - 1);
          st.running = false;
          const deferredAbs = performance.now();
          this.timeline.push({ phase, label, status: 'scheduled', ts: deferredAbs, detail: waitReason, durationMs: 0 });
          this.emit('task:scheduled', { phase, label, ts: deferredAbs, relativeTs: this.relTs(deferredAbs), options: { ...st.options, waitReason } });
          this.log('deferred', { phase, label, ts: Math.round(deferredAbs), relative: Math.round(this.relTs(deferredAbs)), waitReason });
          this.scheduleDeferredRetry(phase, st, waitReason);
          return;
        }

        const dependencyError = e as TaskDependencyDeferredError;
        const unmetDeps = Array.isArray(dependencyError?.unmetDeps) ? dependencyError.unmetDeps : [];
        if (unmetDeps.length > 0) {
          st.running = false;
          const deferredAbs = performance.now();
          this.timeline.push({ phase, label, status: 'scheduled', ts: deferredAbs, detail: `deps:${unmetDeps.join(',')}`, durationMs: 0 });
          this.emit('task:scheduled', { phase, label, ts: deferredAbs, relativeTs: this.relTs(deferredAbs), options: { ...st.options, waitReason: 'dependency-wait', unmetDeps } });
          this.log('dependency-wait', { phase, label, ts: Math.round(deferredAbs), relative: Math.round(this.relTs(deferredAbs)), unmetDeps });
          this.scheduleDependencyRetry(phase, st, unmetDeps);
          return;
        }

        let durationMs: number | undefined = undefined;
        try {
          performance.mark(endMark);
          performance.measure(`orchestrator:${phase}:${label}`, startMark, endMark);
          const entries = performance.getEntriesByName(`orchestrator:${phase}:${label}`);
          const last = entries[entries.length - 1] as PerformanceMeasure | undefined;
          durationMs = last?.duration;
        } catch {}
        const errAbs = performance.now();
        const isTimeout = e.message && e.message.includes('timeout');
        st.running = false;
        this.timeline.push({ phase, label, status: 'error', ts: errAbs, detail: String(e), durationMs });
        console.warn(`[InitOrchestrator] task ${isTimeout ? 'timeout' : 'failed'}: phase=${phase} label=${label}`, e);
        this.emit('task:error', { phase, label, ts: errAbs, relativeTs: this.relTs(errAbs), error: String(e), durationMs, isTimeout });
        this.log('error', { phase, label, ts: Math.round(errAbs), relative: Math.round(this.relTs(errAbs)), error: String(e), durationMs: durationMs && Math.round(durationMs), isTimeout });
        // 更新性能指标
        if (durationMs !== undefined) {
          this.updateMetrics(durationMs, false, isTimeout, label);
          recordContentPerformanceDuration(
            `${CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.orchestratorTaskPrefix}${phase}.${label}`,
            durationMs,
          );
        }
        // 保存任务详细信息（包含错误）
        this.saveTaskDetail(phase, label, 'error', durationMs, String(e));
      })
      .finally(() => {
        // 释放并发计数
        if (phase === 'high') {
          this.runningHighTasks--;
        }
      });

    // 对high阶段任务进行并发控制
    if (phase === 'high') {
      this.runningHighTasks++;
    }

    return taskPromise;
    });
  }

  private scheduleTask(phase: InitPhase, st: ScheduledTask): void {
    if (st.completed || st.running || st.queued) {
      return;
    }

    st.queued = true;
    const { delayMs, idle, idleTimeout } = st.options || {};
    const label = st.options.label || 'anonymous';
    const scheduledAt = performance.now();
    const dependencyRetryDelay = 250;
    const dependencyWaitLimit = getDependencyWaitLimitMs(st.options.timeout);
    const taskKey = st.options.label ? createTaskKey(phase, st.options.label) : '';

    // P0 FIX: 本地并发门控 - 超过上限则延迟调度
    if (phase === 'deferred' && this.runningDeferred >= this.maxConcurrentDeferred) {
      this.log('deferred: blocked by local concurrency gate', { label, running: this.runningDeferred, max: this.maxConcurrentDeferred });
      st.queued = false;
      window.setTimeout(() => this.scheduleTask(phase, st), 500);
      return;
    }
    if (phase === 'idle' && this.runningIdle >= this.maxConcurrentIdle) {
      this.log('idle: blocked by local concurrency gate', { label, running: this.runningIdle, max: this.maxConcurrentIdle });
      st.queued = false;
      window.setTimeout(() => this.scheduleTask(phase, st), 800);
      return;
    }

    const exec = () => {
      if (st.completed || st.running) {
        st.queued = false;
        return;
      }

      // P2 R6: 本地 + 白名单 global 双查询
      void this.filterUnmetDependencies(st.options.dependsOn).then((unmetDeps) => {
        if (st.completed || st.running) {
          st.queued = false;
          return;
        }
        if (unmetDeps.length > 0) {
          const elapsed = performance.now() - scheduledAt;
          this.log(elapsed < dependencyWaitLimit ? 'schedule retry due to unmet dependencies' : 'dependency wait limit reached, keep waiting', {
            phase,
            label,
            unmetDeps,
            elapsed: Math.round(elapsed),
          });
          st.queued = false;
          setTimeout(exec, dependencyRetryDelay);
          return;
        }

        // 任务真正进入 runTask 前再占用本地并发槽，依赖等待期间不占槽
        if (taskKey) this.pendingRegistrationTimes.delete(taskKey);
        if (phase === 'deferred') this.runningDeferred++;
        if (phase === 'idle') this.runningIdle++;

        this.runTask(phase, st);
      });
    };
    if (idle) {
      const scheduleIdle = () => {
        try {
          if (document.visibilityState !== 'visible') {
            // P0 FIX: hidden 页 idle 延迟大幅缩短（原 250ms），避免等太久
            const hiddenDelay = getHiddenIdleDelayMs(st.options.visibilityPolicy);
            this.log('schedule hidden-tab fallback', { phase, label, delayMs: hiddenDelay });
            setTimeout(exec, hiddenDelay);
            return;
          }
          const ric = (window as any).requestIdleCallback as undefined | ((cb: Function, opts?: any) => number);
          if (typeof ric === 'function') {
            this.log('schedule idle', { phase, label, timeout: idleTimeout });
            ric(() => exec(), { timeout: typeof idleTimeout === 'number' ? idleTimeout : 5000 });
            return;
          }
        } catch {}
        const fallbackDelay = 2000; // P0 FIX: 原来 3000ms 降为 2000ms，加快起跑
        this.log('schedule idle-fallback(setTimeout)', { phase, label, delayMs: fallbackDelay });
        setTimeout(exec, fallbackDelay);
      };

      if (typeof delayMs === 'number' && delayMs > 0) {
        this.log('schedule idle(with pre-delay)', { phase, label, delayMs, timeout: idleTimeout });
        setTimeout(scheduleIdle, delayMs);
      } else {
        scheduleIdle();
      }
      return;
    }
    if (typeof delayMs === 'number' && delayMs > 0) {
      this.log('schedule delay', { phase, label, delayMs });
      setTimeout(exec, delayMs);
    } else {
      this.log('schedule microtask', { phase, label });
      Promise.resolve().then(exec);
    }
  }

  async run(): Promise<void> {
    if (this.started) return;
    const endDiagnosticSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.orchestratorRun);
    this.started = true;
    this.t0 = performance.now();
    await this.preregisterAllManagedTasks();
    this.emit('run:start', { ts: this.t0, relativeTs: 0 });
    this.log('run:start', { ts: Math.round(this.t0) });

    // critical: 串行，首屏必需
    for (const st of this.phases.critical) {
      await this.runTask('critical', st);
    }

    // P0 FIX: high 阶段改为后台并发跑，不再阻塞 deferred/idle
    // 用 fire-and-forget 启动，所有 high 任务进入任务中心竞争 lease
    this.runHighTasksWithConcurrencyControl().catch((e) => {
      this.log('high-phase-error', { error: String(e) });
    });

    // deferred / idle 立刻进入调度，不等 high 全部完成
    // 受本地并发门控 (maxConcurrentDeferred / maxConcurrentIdle) 限制，避免页面爆炸
    for (const st of this.phases.deferred) {
      this.scheduleTask('deferred', st);
    }
    for (const st of this.phases.idle) {
      this.scheduleTask('idle', st);
    }

    const afterSchedule = performance.now();
    this.emit('run:scheduledDeferred', { ts: afterSchedule, relativeTs: this.relTs(afterSchedule) });
    this.log('run:scheduledDeferred', { ts: Math.round(afterSchedule), relative: Math.round(this.relTs(afterSchedule)) });
    endDiagnosticSpan();
  }

  on(event: string, listener: (payload: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }

  off(event: string, listener: (payload: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== listener);
  }

  /**
   * 受控并发执行high阶段任务（支持优先级排序和依赖检查）
   */
  private async runHighTasksWithConcurrencyControl(): Promise<void> {
    await runHighPhaseTasks({
      tasks: this.phases.high.filter((task) => !task.completed),
      completedTasks: this.completedTasks,
      maxConcurrentTasks: this.maxConcurrentHighTasks,
      runTask: (task) => this.runTask('high', task),
      log: (message, detail) => this.log(message, detail),
    });
  }

  private emit(event: string, payload: any): void {
    const list = this.listeners[event];
    if (!list || list.length === 0) return;
    try {
      list.forEach(fn => {
        try { fn(payload); } catch {}
      });
    } catch {}
    // 同步广播到扩展后台/页面，方便仪表盘实时可视化订阅
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
        chrome.runtime.sendMessage({ type: 'orchestrator:event', event, payload, pageUrl });
      }
    } catch {}
  }
}

export { InitOrchestrator };

export const initOrchestrator = new InitOrchestrator();

installOrchestratorPageLifecycleBindings(initOrchestrator, {
  windowRef: typeof window !== 'undefined' ? window as any : undefined,
  chromeRuntime: typeof chrome !== 'undefined' ? chrome.runtime : undefined,
  getPageContextFn: getPageContext,
});

installOrchestratorDashboardMetricsMessages(initOrchestrator, {
  chromeRuntime: typeof chrome !== 'undefined' ? chrome.runtime : undefined,
});
