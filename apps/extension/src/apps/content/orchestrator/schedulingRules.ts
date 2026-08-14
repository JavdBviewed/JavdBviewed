/**
 * @file schedulingRules.ts
 * @description schedulingRules
 * @module apps/content
 */
import type { GlobalTaskCost } from '../../../shared/taskCenterTypes';
import { isDeferredTaskWaitReason } from '../../../platform/tasks/waitPolicy';
import type { InitPhase, ScheduledTask } from './types';

export function createDeferredRetryKey(phase: InitPhase, label: string): string {
  return `${phase}::${label}`;
}

export function createTaskKey(phase: InitPhase, label: string): string {
  return `${phase}|${label}`;
}

export function getPhaseTaskCost(phase: InitPhase): GlobalTaskCost {
  if (phase === 'critical') return 'heavy';
  if (phase === 'high') return 'medium';
  return 'light';
}

export function getDeferredRetryDelayMs(waitReason?: string): number {
  if (waitReason === 'smart-background-global-budget' || waitReason === 'smart-background-page-budget') {
    return 1200;
  }
  return waitReason === 'tab-hidden' ? 1200 : 400;
}

export function isDeferredWaitReason(waitReason?: string): boolean {
  return waitReason === 'retryable-error'
    || isDeferredTaskWaitReason(waitReason || '');
}

/** Scheduler capacity waits must remain queued; they are not execution failures. */
export function isLeaseAvailabilityWaitReason(waitReason?: string): boolean {
  return waitReason !== undefined
    && waitReason !== 'retryable-error'
    && isDeferredWaitReason(waitReason);
}

export function getDependencyWaitLimitMs(timeoutMs?: number): number {
  return Math.max(5000, (timeoutMs || 0) + 2000);
}

export function getHiddenIdleDelayMs(visibilityPolicy?: string): number {
  if (visibilityPolicy === 'background_throttled') return 1000;
  return visibilityPolicy === 'background_allowed' ? 300 : 150;
}

export function sortTasksByPriority<T extends ScheduledTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => (b.options.priority ?? 5) - (a.options.priority ?? 5));
}

export function partitionTasksByDependencyReadiness<T extends ScheduledTask>(
  tasks: T[],
  completedTasks: Set<string>,
): { readyTasks: T[]; notReadyTasks: T[] } {
  const readyTasks: T[] = [];
  const notReadyTasks: T[] = [];

  for (const task of tasks) {
    const deps = task.options.dependsOn || [];
    if (deps.length > 0 && !deps.every((dep) => completedTasks.has(dep))) {
      notReadyTasks.push(task);
    } else {
      readyTasks.push(task);
    }
  }

  return { readyTasks, notReadyTasks };
}
