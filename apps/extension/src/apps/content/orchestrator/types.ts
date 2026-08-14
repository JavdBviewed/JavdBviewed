/**
 * @file types.ts
 * @description types
 * @module apps/content
 */
import type { GlobalTaskDescriptor, GlobalTaskVisibilityPolicy } from '../../../shared/taskCenterTypes';

export type InitPhase = 'critical' | 'high' | 'deferred' | 'idle';
export type InitTask = () => Promise<void> | void;

export interface InitTaskOptions {
  label?: string;
  delayMs?: number;
  idle?: boolean;
  idleTimeout?: number;
  priority?: number;
  timeout?: number;
  timeoutBehavior?: 'hard' | 'diagnostic';
  dependsOn?: string[];
  visibilityPolicy?: GlobalTaskVisibilityPolicy;
}

export interface ScheduledTask {
  task: InitTask;
  options: InitTaskOptions;
  queued?: boolean;
  running?: boolean;
  completed?: boolean;
  startedAt?: number;
}

export interface TaskDeferredError extends Error {
  waitReason?: string;
}

export interface TaskDependencyDeferredError extends Error {
  unmetDeps?: string[];
}

export type ManagedScheduledTask = ScheduledTask & {
  managedDescriptor?: GlobalTaskDescriptor;
  managedDescriptorRegistered?: boolean;
};

export interface TaskBlueprint {
  phase: InitPhase;
  label: string;
  priority?: number;
  timeout?: number;
  visibilityPolicy?: GlobalTaskVisibilityPolicy;
  dependsOn?: string[];
}

export function getDefaultVisibilityPolicy(phase: InitPhase): GlobalTaskVisibilityPolicy {
  if (phase === 'critical') return 'foreground_first';
  return 'background_allowed';
}
