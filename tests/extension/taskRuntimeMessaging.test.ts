/**
 * @file taskRuntimeMessaging.test.ts
 * @description task runtime messaging 测试
 * @module tests/extension
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createManagedTaskDescriptor } from '../../apps/extension/src/content/taskRuntime';
import {
  completeManagedTask,
  failManagedTask,
  getActiveManagedTaskIds,
  progressManagedTask,
  registerManagedTask,
  requestTaskLease,
  runRegisteredManagedTask,
} from '../../apps/extension/src/platform/tasks/runtimeMessaging';
import { TASK_CENTER_MESSAGE } from '../../apps/extension/src/shared/taskCenterProtocol';
import type { GlobalTaskDescriptor } from '../../apps/extension/src/shared/taskCenterTypes';
import { getRuntimeMessages, resetChromeMock, setRuntimeMessageHandler } from '../setup/chrome';

function makeDescriptor(overrides: Partial<GlobalTaskDescriptor> = {}): GlobalTaskDescriptor {
  return {
    taskId: 'task-1',
    label: 'collect-video',
    tabId: 0,
    pageUrl: 'https://javdb.com/v/abc123',
    pageType: 'video',
    mainId: 'abc123',
    pageInstanceId: 'page-1',
    phase: 'collect',
    priority: 10,
    cost: 'medium',
    visibilityPolicy: 'foreground_first',
    timeoutMs: 1000,
    retryLimit: 3,
    resumePolicy: 'restart',
    createdAt: 1,
    ...overrides,
  };
}

describe('task runtime messaging', () => {
  beforeEach(() => {
    resetChromeMock();
    window.history.replaceState({}, '', 'https://javdb.com/v/abc123');
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
  });

  it('creates task descriptors from the current page context', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);

    const descriptor = createManagedTaskDescriptor({
      label: 'collect-video',
      phase: 'collect',
      priority: 10,
      cost: 'medium',
      visibilityPolicy: 'foreground_first',
      timeoutMs: 1000,
      retryLimit: 3,
      resumePolicy: 'restart',
    });

    expect(descriptor).toMatchObject({
      label: 'collect-video',
      taskId: expect.stringMatching(/^collect-video:/),
      pageUrl: 'https://javdb.com/v/abc123',
      pageType: 'video',
      mainId: 'abc123',
      registrationSource: 'runtime',
      dedupeKey: expect.stringMatching(/^collect-video:page:/),
    });
  });

  it('forwards optional executionClass and shareScope from createManagedTaskDescriptor', () => {
    const descriptor = createManagedTaskDescriptor({
      label: 'drive115:push',
      phase: 'critical',
      priority: 20,
      cost: 'medium',
      visibilityPolicy: 'foreground_first',
      timeoutMs: 15000,
      retryLimit: 1,
      resumePolicy: 'restart',
      dedupeKey: 'drive115:push:vid:magnet',
      executionClass: 'on-demand',
      shareScope: 'dedupe-by-action',
    });

    expect(descriptor.executionClass).toBe('on-demand');
    expect(descriptor.shareScope).toBe('dedupe-by-action');
    expect(descriptor.dedupeKey).toBe('drive115:push:vid:magnet');
  });

  it('registers a managed task and applies background task id and tab id', async () => {
    setRuntimeMessageHandler((message) => {
      expect(message.type).toBe(TASK_CENTER_MESSAGE.REGISTER);
      return { taskId: 'registered-task', tabId: 77 };
    });

    await expect(registerManagedTask(makeDescriptor())).resolves.toMatchObject({
      taskId: 'registered-task',
      tabId: 77,
    });
    expect(getRuntimeMessages()[0]).toMatchObject({
      type: TASK_CENTER_MESSAGE.REGISTER,
      payload: { taskId: 'task-1' },
    });
  });

  it('propagates reused and status from register response for shared actions', async () => {
    setRuntimeMessageHandler((message) => {
      expect(message.type).toBe(TASK_CENTER_MESSAGE.REGISTER);
      return { taskId: 'shared-push', tabId: 12, reused: true, status: 'done' };
    });

    await expect(registerManagedTask(makeDescriptor({
      label: 'drive115:push',
      taskId: 'local-push',
      shareScope: 'dedupe-by-action',
      executionClass: 'on-demand',
      dedupeKey: 'drive115:push:vid:magnet',
    }))).resolves.toMatchObject({
      taskId: 'shared-push',
      tabId: 12,
      reused: true,
      status: 'done',
      shareScope: 'dedupe-by-action',
      executionClass: 'on-demand',
    });
  });

  it('defaults reused to false when background omits it', async () => {
    setRuntimeMessageHandler(() => ({ taskId: 'new-task', tabId: 3 }));

    await expect(registerManagedTask(makeDescriptor())).resolves.toMatchObject({
      taskId: 'new-task',
      tabId: 3,
      reused: false,
      status: undefined,
    });
  });

  it('returns the original descriptor when background response lacks tabId', async () => {
    setRuntimeMessageHandler(() => ({ ok: false }));

    const descriptor = makeDescriptor({ taskId: 'fallback-task' });
    await expect(registerManagedTask(descriptor)).resolves.toEqual(descriptor);
  });

  it('sends lease, progress, completion, and failure messages with the protocol constants', async () => {
    setRuntimeMessageHandler((message) => {
      if (message.type === TASK_CENTER_MESSAGE.REQUEST_LEASE) {
        return { granted: true };
      }
      return { ok: true };
    });

    await expect(requestTaskLease('task-1')).resolves.toEqual({ granted: true });
    await progressManagedTask('task-1', { stage: 'fetch', progressPct: 50, detail: 'half' });
    await completeManagedTask('task-1');
    await failManagedTask('task-2', 'boom');

    expect(getRuntimeMessages()).toEqual([
      { type: TASK_CENTER_MESSAGE.REQUEST_LEASE, payload: { taskId: 'task-1' } },
      {
        type: TASK_CENTER_MESSAGE.PROGRESS,
        payload: { taskId: 'task-1', stage: 'fetch', progressPct: 50, detail: 'half' },
      },
      { type: TASK_CENTER_MESSAGE.COMPLETE, payload: { taskId: 'task-1' } },
      { type: TASK_CENTER_MESSAGE.FAIL, payload: { taskId: 'task-2', error: 'boom' } },
    ]);
  });

  it('returns the background retry response when failing a managed task', async () => {
    const retryResponse = {
      ok: true,
      retryable: true,
      retryCount: 1,
      retryLimit: 2,
      status: 'queued',
      waitReason: 'retryable-error',
    };
    setRuntimeMessageHandler((message) => {
      expect(message).toEqual({
        type: TASK_CENTER_MESSAGE.FAIL,
        payload: { taskId: 'task-retry', error: 'temporary-network-error' },
      });
      return retryResponse;
    });

    await expect(failManagedTask('task-retry', 'temporary-network-error')).resolves.toEqual(retryResponse);
  });

  it('returns a foreground-first task to the queue when its page becomes hidden after receiving a lease', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const runner = vi.fn(async () => 'should-not-run');
    setRuntimeMessageHandler((message) => {
      if (message.type === TASK_CENTER_MESSAGE.REQUEST_LEASE) {
        return { granted: true };
      }
      if (message.type === TASK_CENTER_MESSAGE.DEFER) {
        return { ok: true, status: 'queued', waitReason: 'tab-hidden' };
      }
      return { ok: true };
    });

    await expect(runRegisteredManagedTask(makeDescriptor(), runner)).resolves.toEqual({
      executed: false,
      waitReason: 'tab-hidden',
    });
    expect(runner).not.toHaveBeenCalled();
    expect(getRuntimeMessages()).toEqual([
      { type: TASK_CENTER_MESSAGE.REQUEST_LEASE, payload: { taskId: 'task-1' } },
      { type: TASK_CENTER_MESSAGE.DEFER, payload: { taskId: 'task-1', reason: 'tab-hidden' } },
    ]);
  });

  it('keeps background-allowed work runnable when its page is hidden', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const runner = vi.fn(async () => 'ran-in-background');
    setRuntimeMessageHandler((message) => {
      if (message.type === TASK_CENTER_MESSAGE.REQUEST_LEASE) {
        return { granted: true };
      }
      return { ok: true };
    });

    await expect(runRegisteredManagedTask(makeDescriptor({ visibilityPolicy: 'background_allowed' }), runner)).resolves.toEqual({
      executed: true,
      result: 'ran-in-background',
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(getRuntimeMessages().map((message) => message.type)).toEqual([
      TASK_CENTER_MESSAGE.REQUEST_LEASE,
      TASK_CENTER_MESSAGE.COMPLETE,
    ]);
  });

  it('does not leave a local task active when hidden-task deferral cannot reach the background', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const runner = vi.fn(async () => 'should-not-run');
    setRuntimeMessageHandler((message) => {
      if (message.type === TASK_CENTER_MESSAGE.REQUEST_LEASE) {
        return { granted: true };
      }
      if (message.type === TASK_CENTER_MESSAGE.DEFER) {
        throw new Error('background-unavailable');
      }
      return { ok: true };
    });

    await expect(runRegisteredManagedTask(makeDescriptor(), runner)).resolves.toEqual({
      executed: false,
      waitReason: 'tab-hidden',
    });
    expect(runner).not.toHaveBeenCalled();
    expect(getActiveManagedTaskIds()).toEqual([]);
  });

});
