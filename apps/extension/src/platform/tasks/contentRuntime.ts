/**
 * @file contentRuntime.ts
 * @description Content 端任务运行时 —— 管理 content script 中的任务注册、重试、完成
 * @module platform/tasks
 *
 * 提供 ensureManagedTaskRegistered（确保任务已注册）、
 * completeManagedTask（标记完成）、failManagedTask（标记失败）等便捷方法。
 */
import type { GlobalTaskDescriptor } from '../../shared/taskCenterTypes';
import { getPageContext } from '../browser/pageContext';

export {
  clearTaskRetryBudget,
  completeManagedTask,
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
} from './runtimeMessaging';

export function createManagedTaskDescriptor(
  input: Omit<
    GlobalTaskDescriptor,
    'taskId' | 'tabId' | 'pageUrl' | 'pageType' | 'createdAt' | 'mainId' | 'pageInstanceId'
  >,
): GlobalTaskDescriptor {
  const pageContext = getPageContext();
  return {
    taskId: `${input.label}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    tabId: 0,
    pageUrl: pageContext.pageUrl,
    pageType: pageContext.pageType,
    mainId: pageContext.mainId,
    pageInstanceId: pageContext.pageInstanceId,
    createdAt: Date.now(),
    dedupeKey: input.dedupeKey || `${input.label}:${pageContext.pageInstanceId}`,
    registrationSource: input.registrationSource || 'runtime',
    ...input,
  };
}
