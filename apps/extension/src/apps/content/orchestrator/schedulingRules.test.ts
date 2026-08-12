import { describe, expect, it } from 'vitest';
import {
  createDeferredRetryKey,
  createTaskKey,
  getDeferredRetryDelayMs,
  getDependencyWaitLimitMs,
  getHiddenIdleDelayMs,
  getPhaseTaskCost,
  isLeaseAvailabilityWaitReason,
  isDeferredWaitReason,
  partitionTasksByDependencyReadiness,
  sortTasksByPriority,
} from './schedulingRules';
import type { ScheduledTask } from './types';

function task(label: string, priority?: number, dependsOn?: string[]): ScheduledTask {
  return {
    task: () => undefined,
    options: { label, priority, dependsOn },
  };
}

describe('orchestrator scheduling rules', () => {
  it('creates stable retry and task keys', () => {
    expect(createDeferredRetryKey('idle', 'preview:init')).toBe('idle::preview:init');
    expect(createTaskKey('high', 'status:init')).toBe('high|status:init');
  });

  it('maps phases to global task costs', () => {
    expect(getPhaseTaskCost('critical')).toBe('heavy');
    expect(getPhaseTaskCost('high')).toBe('medium');
    expect(getPhaseTaskCost('deferred')).toBe('light');
    expect(getPhaseTaskCost('idle')).toBe('light');
  });

  it('resolves deferred retry and hidden idle delays', () => {
    expect(getDeferredRetryDelayMs('tab-hidden')).toBe(1200);
    expect(getDeferredRetryDelayMs('bucket:light')).toBe(400);
    expect(getHiddenIdleDelayMs('background_allowed')).toBe(300);
    expect(getHiddenIdleDelayMs('foreground_first')).toBe(150);
  });

  it('detects deferred wait reasons', () => {
    expect(isDeferredWaitReason('tab-hidden')).toBe(true);
    expect(isDeferredWaitReason('higher-priority-wait')).toBe(true);
    expect(isDeferredWaitReason('bucket:medium')).toBe(true);
    expect(isDeferredWaitReason('source-page-heavy-budget')).toBe(true);
    expect(isDeferredWaitReason('dependency-wait')).toBe(false);
  });

  it('separates scheduler availability waits from execution failures', () => {
    expect(isLeaseAvailabilityWaitReason('source-page-heavy-budget')).toBe(true);
    expect(isLeaseAvailabilityWaitReason('background-global-budget')).toBe(true);
    expect(isLeaseAvailabilityWaitReason('tab-hidden')).toBe(true);
    expect(isLeaseAvailabilityWaitReason('retryable-error')).toBe(false);
    expect(isLeaseAvailabilityWaitReason('lease-timeout')).toBe(false);
  });

  it('computes dependency wait limits from timeout', () => {
    expect(getDependencyWaitLimitMs()).toBe(5000);
    expect(getDependencyWaitLimitMs(2000)).toBe(5000);
    expect(getDependencyWaitLimitMs(8000)).toBe(10000);
  });

  it('sorts high tasks by descending priority', () => {
    const sorted = sortTasksByPriority([
      task('middle', 5),
      task('low', 1),
      task('high', 9),
    ]);

    expect(sorted.map((item) => item.options.label)).toEqual(['high', 'middle', 'low']);
  });

  it('partitions tasks by dependency readiness', () => {
    const completed = new Set(['records:load']);
    const result = partitionTasksByDependencyReadiness([
      task('ready-with-deps', 5, ['records:load']),
      task('ready-without-deps'),
      task('blocked', 5, ['missing']),
    ], completed);

    expect(result.readyTasks.map((item) => item.options.label)).toEqual(['ready-with-deps', 'ready-without-deps']);
    expect(result.notReadyTasks.map((item) => item.options.label)).toEqual(['blocked']);
  });
});
