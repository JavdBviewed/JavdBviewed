import { describe, expect, it } from 'vitest';
import { GlobalTaskCenter } from './globalTaskCenter';
import type { GlobalTaskDescriptor } from '../../shared/taskCenterTypes';

function descriptor(label: string): GlobalTaskDescriptor {
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
    retryLimit: 2,
    resumePolicy: 'restart',
    createdAt: Date.now(),
  };
}

describe('GlobalTaskCenter.registerTasks', () => {
  it('preserves input order and the sender tab when registering a batch', () => {
    const center = new GlobalTaskCenter();

    const results = center.registerTasks([descriptor('first'), descriptor('second')], {
      tab: { id: 42 },
    } as chrome.runtime.MessageSender);

    expect(results.map((result) => result.taskId)).toEqual(['task-first', 'task-second']);
    expect(results.map((result) => result.tabId)).toEqual([42, 42]);
    expect(center.queryState().tasks.map((task) => task.label)).toEqual(['first', 'second']);
  });
});
