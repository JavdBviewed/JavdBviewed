import { describe, expect, it } from 'vitest';
import { GlobalTaskCenter } from './globalTaskCenter';
import type { GlobalTaskDescriptor } from '../../shared/taskCenterTypes';

function descriptor(label: string, retryLimit = 0): GlobalTaskDescriptor {
  return {
    taskId: `task-${label}`,
    label,
    tabId: 0,
    pageUrl: 'https://javdb.com/v/test',
    pageType: 'detail',
    mainId: 'test',
    pageInstanceId: 'page-test',
    phase: 'high',
    priority: 5,
    cost: 'light',
    visibilityPolicy: 'foreground_first',
    timeoutMs: 10_000,
    retryLimit,
    resumePolicy: 'restart',
    createdAt: Date.now(),
  };
}

function statusOf(center: GlobalTaskCenter, taskId: string): string | undefined {
  return center.queryState().tasks.find((task) => task.taskId === taskId)?.status;
}

describe('GlobalTaskCenter terminal state guards', () => {
  it('requestLease rejects a done task and keeps it done', () => {
    const center = new GlobalTaskCenter();
    const { taskId } = center.registerTask(descriptor('done'));
    center.completeTask(taskId);

    const lease = center.requestLease(taskId);
    expect(lease.granted).toBe(false);
    expect(lease.waitReason).toBe('task-done');
    expect(statusOf(center, taskId)).toBe('done');
  });

  it('requestLease rejects an error task and keeps it error', () => {
    const center = new GlobalTaskCenter();
    const { taskId } = center.registerTask(descriptor('error', 0));
    center.failTask(taskId, 'boom');
    expect(statusOf(center, taskId)).toBe('error');

    const lease = center.requestLease(taskId);
    expect(lease.granted).toBe(false);
    expect(lease.waitReason).toBe('task-error');
    expect(statusOf(center, taskId)).toBe('error');
  });

  it('requestLease rejects a canceled task and keeps it canceled', () => {
    const center = new GlobalTaskCenter();
    const { taskId } = center.registerTask(descriptor('canceled'));
    center.cancelTask(taskId, 'user-stop');

    const lease = center.requestLease(taskId);
    expect(lease.granted).toBe(false);
    expect(lease.waitReason).toBe('task-canceled');
    expect(statusOf(center, taskId)).toBe('canceled');
  });

  it('a done task is not resurrected by the hidden-tab limit<=0 branch', () => {
    const center = new GlobalTaskCenter();
    const { taskId } = center.registerTask(descriptor('done-hidden'));
    center.completeTask(taskId);

    // tabId=0 默认不可见 → foreground_first 的 limit 为 0；终态守卫必须先于该分支生效
    const lease = center.requestLease(taskId);
    expect(lease.granted).toBe(false);
    expect(lease.waitReason).toBe('task-done');
    expect(statusOf(center, taskId)).toBe('done');
  });

  it('a stale FAIL does not requeue a done task even with retry budget', () => {
    const center = new GlobalTaskCenter();
    const { taskId } = center.registerTask(descriptor('done-stale', 2));
    center.completeTask(taskId);

    const response = center.failTask(taskId, 'stale-failure');
    expect(response.retryable).toBe(false);
    expect(response.status).toBe('done');
    expect(statusOf(center, taskId)).toBe('done');
  });

  it('a stale FAIL does not mutate an exhausted error task', () => {
    const center = new GlobalTaskCenter();
    const { taskId } = center.registerTask(descriptor('error-stale', 1));
    center.failTask(taskId, 'first');
    expect(statusOf(center, taskId)).toBe('queued');
    center.failTask(taskId, 'second');
    expect(statusOf(center, taskId)).toBe('error');

    const response = center.failTask(taskId, 'stale');
    expect(response.retryable).toBe(false);
    expect(response.status).toBe('error');
    expect(statusOf(center, taskId)).toBe('error');
  });
});
