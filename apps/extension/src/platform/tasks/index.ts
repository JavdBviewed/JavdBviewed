/**
 * @file index.ts
 * @description 任务中心子系统统一导出（全局任务中心、心跳、超时守卫、性能优化）
 */
export {
  runChunkedWork,
  yieldToMainThread,
  type ChunkedWorkOptions,
  type ChunkedWorkResult,
} from './chunking';

export {
  clearTaskRetryBudget,
  completeManagedTask,
  createManagedTaskDescriptor,
  ensureManagedTaskRegistered,
  ensureManagedTasksRegistered,
  failManagedTask,
  getActiveManagedTaskIds,
  getTaskRetryCount,
  heartbeatManagedTask,
  incrementTaskRetryCount,
  isGlobalTaskLabelCompleted,
  isRetryBudgetExhausted,
  notifyGlobalTaskCompleted,
  pauseManagedTask,
  progressManagedTask,
  registerManagedTask,
  requestTaskLease,
  resumeManagedTask,
  runManagedTask,
  runRegisteredManagedTask,
  trackActiveManagedTask,
  untrackActiveManagedTask,
  waitForTaskLease,
  type ManagedTaskRunResult,
  type FailManagedTaskResponse,
  type RegisteredManagedTask,
} from './contentRuntime';

export {
  saveSubtaskDetail,
  type ContentTaskDetailReporterOptions,
  type SubtaskDetailPayload,
} from './contentTaskDetailReporter';

export { installTaskHeartbeatReporter } from './taskHeartbeatReporter';
export { installTaskVisibilityReporter } from './taskVisibilityReporter';
export {
  CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS,
  countContentPerformanceEvent,
  getContentPerformanceDiagnosticSnapshot,
  installContentPerformanceDiagnostics,
  recordContentPerformanceDuration,
  startContentPerformanceSpan,
  CONTENT_PERFORMANCE_DIAGNOSTIC_MESSAGES,
  type ContentPerformanceDiagnosticSnapshot,
} from './contentPerformanceDiagnostics';
export { createTaskTimeoutGuard, isTaskTimeoutError } from './taskTimeoutGuard';
export { PerformanceOptimizer, performanceOptimizer, type PerformanceConfig } from './performanceOptimizer';

export { GlobalTaskCenter, globalTaskCenter } from './globalTaskCenter';
export { TASK_BUCKET_LIMITS, resolveTaskBucket } from './taskPolicy';
export { TaskStateStore } from './taskStateStore';
export { computeTaskDisposition, getEffectiveBucketLimit } from './taskCenterPolicyRuntime';
