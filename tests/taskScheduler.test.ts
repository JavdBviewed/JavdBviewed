/**
 * @file taskScheduler.test.ts
 * @description GlobalTaskCenter scheduling 测试
 * @module tests/tests
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { GlobalTaskDescriptor } from '../apps/extension/src/shared/taskCenterTypes.ts';
import { GlobalTaskCenter } from '../apps/extension/src/platform/tasks/globalTaskCenter.ts';
import { TASK_CENTER_MESSAGE } from '../apps/extension/src/shared/taskCenterProtocol.ts';

const originalWindow = (globalThis as any).window;
const originalDocument = (globalThis as any).document;
const originalChrome = (globalThis as any).chrome;

(globalThis as any).window = {
  location: { href: 'https://example.com/v/test', pathname: '/v/test' },
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval: () => undefined,
  addEventListener: () => undefined,
};
(globalThis as any).document = {
  visibilityState: 'visible',
  hidden: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
(globalThis as any).chrome = {
  runtime: {
    sendMessage: async () => ({ ok: true }),
    onMessage: { addListener: () => undefined },
  },
  storage: {
    local: {
      get: (_keys: any, callback?: (result: any) => void) => {
        if (typeof callback === 'function') callback({});
        return Promise.resolve({});
      },
      set: async () => undefined,
      remove: async () => undefined,
    },
  },
};

const orchestratorModulePromise = import('../apps/extension/src/apps/content/orchestrator/initOrchestrator.ts');

afterAll(() => {
  (globalThis as any).window = originalWindow;
  (globalThis as any).document = originalDocument;
  (globalThis as any).chrome = originalChrome;
});

function createDescriptor(overrides: Partial<GlobalTaskDescriptor> & Pick<GlobalTaskDescriptor, 'taskId' | 'label'>): GlobalTaskDescriptor {
  const now = Date.now();
  return {
    taskId: overrides.taskId,
    label: overrides.label,
    tabId: overrides.tabId ?? 1,
    pageUrl: overrides.pageUrl ?? '/v/test',
    pageType: overrides.pageType ?? 'video',
    mainId: overrides.mainId ?? 'test',
    pageInstanceId: overrides.pageInstanceId ?? 'page-1',
    phase: overrides.phase ?? 'idle',
    priority: overrides.priority ?? 5,
    cost: overrides.cost ?? 'light',
    visibilityPolicy: overrides.visibilityPolicy ?? 'background_allowed',
    timeoutMs: overrides.timeoutMs ?? 10_000,
    retryLimit: overrides.retryLimit ?? 2,
    dedupeKey: overrides.dedupeKey,
    resumePolicy: overrides.resumePolicy ?? 'restart',
    executionClass: overrides.executionClass,
    shareScope: overrides.shareScope,
    createdAt: overrides.createdAt ?? now,
  };
}

function handle(center: GlobalTaskCenter, message: any, sender: chrome.runtime.MessageSender = {} as chrome.runtime.MessageSender) {
  let response: any;
  center.handleMessage(message, sender, (value) => {
    response = value;
  });
  return response;
}

describe('GlobalTaskCenter scheduling', () => {
  it('does not reply to a granted lease before its snapshot is persisted', async () => {
    const previousSet = (globalThis as any).chrome.storage.local.set;
    const finishWrites: Array<() => void> = [];
    (globalThis as any).chrome.storage.local.set = () => new Promise<void>((resolve) => {
      finishWrites.push(resolve);
    });

    try {
      const center = new GlobalTaskCenter();
      center.updateVisibility(1, true);
      center.registerTask(createDescriptor({
        taskId: 'durable-lease-reply',
        label: 'videoStatus:fullRefresh',
        dedupeKey: 'durable-lease-reply',
      }));
      let resolveResponse: ((value: unknown) => void) | undefined;
      const responsePromise = new Promise<unknown>((resolve) => {
        resolveResponse = resolve;
      });

      center.handleMessage(
        { type: TASK_CENTER_MESSAGE.REQUEST_LEASE, payload: { taskId: 'durable-lease-reply' } },
        {} as chrome.runtime.MessageSender,
        (value) => { resolveResponse?.(value); },
      );

      let settled = false;
      void responsePromise.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      finishWrites.splice(0).forEach((finishWrite) => finishWrite());
      await expect(responsePromise).resolves.toEqual({ granted: true });
    } finally {
      (globalThis as any).chrome.storage.local.set = previousSet;
    }
  });

  it('persists a granted source-page lease before the service worker can stop', () => {
    const previousSet = (globalThis as any).chrome.storage.local.set;
    const snapshots: Array<Record<string, unknown>> = [];
    (globalThis as any).chrome.storage.local.set = async (value: Record<string, unknown>) => {
      snapshots.push(value);
    };

    try {
      const center = new GlobalTaskCenter();
      center.updateVisibility(1, true);
      center.registerTask(createDescriptor({
        taskId: 'durable-source-lease',
        label: 'videoStatus:fullRefresh',
        dedupeKey: 'durable-source-lease',
      }));

      expect(center.requestLease('durable-source-lease')).toEqual({ granted: true });
      const persistedTasks = snapshots
        .flatMap((snapshot) => ((snapshot['taskCenter:snapshot'] as any)?.tasks ?? []));
      expect(persistedTasks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          descriptor: expect.objectContaining({ taskId: 'durable-source-lease' }),
          runtime: expect.objectContaining({ status: 'leased' }),
        }),
      ]));
    } finally {
      (globalThis as any).chrome.storage.local.set = previousSet;
    }
  });

  it('keeps a live lease when asynchronous startup restoration completes', async () => {
    let resolveSnapshot: ((value: Record<string, unknown>) => void) | undefined;
    (globalThis as any).chrome.storage.local.get = (_keys: unknown, callback?: (value: Record<string, unknown>) => void) => {
      const pending = new Promise<Record<string, unknown>>((resolve) => {
        resolveSnapshot = (value) => {
          callback?.(value);
          resolve(value);
        };
      });
      return pending;
    };

    const center = new GlobalTaskCenter();
    const restore = center.restoreFromStorage();
    center.updateVisibility(1, true);
    center.registerTask(createDescriptor({
      taskId: 'live-full-refresh',
      label: 'videoStatus:fullRefresh',
      pageInstanceId: 'live-page',
      dedupeKey: 'live-full-refresh',
    }));

    expect(center.requestLease('live-full-refresh')).toEqual({ granted: true });

    resolveSnapshot?.({
      'taskCenter:snapshot': {
        tasks: [],
        completedLabels: [],
      },
      'taskCenter:dedupeIndex': {},
    });
    await restore;

    expect(center.queryState().tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'live-full-refresh', status: 'leased' }),
    ]));
  });

  it('requestLease ignores preregistered tasks that have not queued yet', () => {
    const center = new GlobalTaskCenter();
    center.updateVisibility(1, true);

    center.registerTask(createDescriptor({
      taskId: 'registered-a',
      label: 'videoEnhancement:runTitle',
      priority: 9,
      createdAt: Date.now() - 5_000,
    }));

    center.registerTask(createDescriptor({
      taskId: 'ready-b',
      label: 'videoEnhancement:runFC2Breaker',
      priority: 5,
      createdAt: Date.now(),
    }));

    const lease = center.requestLease('ready-b');

    expect(lease.granted).toBe(true);
  });

  it('requestLease still respects queued higher-priority peers', () => {
    const center = new GlobalTaskCenter();
    center.updateVisibility(1, true);

    center.registerTask(createDescriptor({
      taskId: 'queued-a',
      label: 'videoEnhancement:runTitle',
      priority: 9,
    }));
    center.registerTask(createDescriptor({
      taskId: 'ready-b',
      label: 'videoEnhancement:runFC2Breaker',
      priority: 5,
    }));

    const firstAttempt = center.requestLease('queued-a');
    expect(firstAttempt.granted).toBe(true);
    center.pauseTask('queued-a', 'test-release');
    center.resumeTask('queued-a');

    const competing = center.requestLease('ready-b');

    expect(competing.granted).toBe(false);
    expect(competing.waitReason).toBe('higher-priority-wait');
  });

  it('runs queued high-priority detail work before aged idle work in the same bucket', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      for (let index = 0; index < 7; index += 1) {
        center.updateVisibility(index + 1, true);
        center.registerTask(createDescriptor({
          taskId: `fresh-high-work-${index}`,
          label: 'videoEnhancement:initCore',
          tabId: index + 1,
          pageInstanceId: `high-page-${index}`,
          phase: 'high',
          priority: 8,
          createdAt: startedAt + index,
          dedupeKey: `fresh-high-work:${index}`,
        }));
      }
      center.updateVisibility(20, true);
      center.registerTask(createDescriptor({
        taskId: 'idle-detail-finish',
        label: 'videoEnhancement:runTitle',
        tabId: 20,
        pageInstanceId: 'idle-detail-page',
        phase: 'idle',
        priority: 5,
        createdAt: startedAt,
        dedupeKey: 'idle-detail-finish',
      }));

      for (let index = 0; index < 6; index += 1) {
        expect(center.requestLease(`fresh-high-work-${index}`)).toEqual({ granted: true });
      }
      expect(center.requestLease('fresh-high-work-6')).toEqual({
        granted: false,
        waitReason: 'global-budget',
      });

      expect(center.requestLease('idle-detail-finish')).toEqual({
        granted: false,
        waitReason: 'higher-priority-wait',
      });

      center.completeTask('fresh-high-work-0');
      center.completeTask('fresh-high-work-1');
      vi.setSystemTime(startedAt + 15_000);

      expect(center.requestLease('fresh-high-work-6')).toEqual({ granted: true });
      center.completeTask('fresh-high-work-6');

      expect(center.requestLease('idle-detail-finish')).toEqual({ granted: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets aged deferred metadata loading claim the next video-light lease after high work has run', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      center.updateVisibility(1, true);
      center.updateVisibility(2, true);
      center.registerTask(createDescriptor({
        taskId: 'aged-load-data',
        label: 'videoEnhancement:loadData',
        tabId: 1,
        pageInstanceId: 'deferred-page',
        phase: 'deferred',
        priority: 5,
        createdAt: startedAt,
        dedupeKey: 'aged-load-data',
      }));
      center.registerTask(createDescriptor({
        taskId: 'fresh-high-work',
        label: 'videoEnhancement:initCore',
        tabId: 2,
        pageInstanceId: 'high-page',
        phase: 'high',
        priority: 8,
        createdAt: startedAt + 1,
        dedupeKey: 'fresh-high-work',
      }));

      expect(center.requestLease('fresh-high-work')).toEqual({ granted: true });
      center.pauseTask('fresh-high-work', 'test-release');
      center.resumeTask('fresh-high-work');
      vi.setSystemTime(startedAt + 15_000);

      expect(center.requestLease('aged-load-data')).toEqual({ granted: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never lets an aged deferred task outrank critical work', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      center.updateVisibility(1, true);
      center.updateVisibility(2, true);
      center.registerTask(createDescriptor({
        taskId: 'aged-deferred-work',
        label: 'videoEnhancement:loadData',
        tabId: 1,
        pageInstanceId: 'deferred-page',
        phase: 'deferred',
        priority: 5,
        createdAt: startedAt,
        dedupeKey: 'aged-deferred-work',
      }));
      center.registerTask(createDescriptor({
        taskId: 'critical-work',
        label: 'videoEnhancement:critical-stage',
        tabId: 2,
        pageInstanceId: 'critical-page',
        phase: 'critical',
        priority: 5,
        createdAt: startedAt + 1,
        dedupeKey: 'critical-work',
      }));

      expect(center.requestLease('critical-work')).toEqual({ granted: true });
      center.pauseTask('critical-work', 'test-release');
      center.resumeTask('critical-work');
      vi.setSystemTime(startedAt + 15_000);

      expect(center.requestLease('aged-deferred-work')).toEqual({
        granted: false,
        waitReason: 'higher-priority-wait',
      });
      expect(center.requestLease('critical-work')).toEqual({ granted: true });
      expect(center.queryState().tasks.find((task: any) => task.taskId === 'aged-deferred-work')).toMatchObject({
        status: 'queued',
        waitReason: 'higher-priority-wait',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an aged idle task outrank a waiting high task in the same bucket', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      center.updateVisibility(1, true);
      center.updateVisibility(2, true);
      center.registerTask(createDescriptor({
        taskId: 'aged-idle-title',
        label: 'videoEnhancement:runTitle',
        tabId: 1,
        pageInstanceId: 'idle-page',
        phase: 'idle',
        priority: 5,
        createdAt: startedAt,
        dedupeKey: 'aged-idle-title',
      }));
      center.registerTask(createDescriptor({
        taskId: 'waiting-high-core',
        label: 'videoEnhancement:initCore',
        tabId: 2,
        pageInstanceId: 'high-page',
        phase: 'high',
        priority: 8,
        createdAt: startedAt + 1,
        dedupeKey: 'waiting-high-core',
      }));

      expect(center.requestLease('aged-idle-title')).toEqual({ granted: true });
      center.pauseTask('aged-idle-title', 'test-release');
      center.resumeTask('aged-idle-title');

      vi.setSystemTime(startedAt + 20_000);

      expect(center.requestLease('waiting-high-core')).toEqual({ granted: true });
      expect(center.queryState().tasks.find((task: any) => task.taskId === 'aged-idle-title')).toMatchObject({
        status: 'queued',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an aged idle task outrank a waiting deferred task in the same bucket', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      center.updateVisibility(1, true);
      center.updateVisibility(2, true);
      center.registerTask(createDescriptor({
        taskId: 'aged-idle-cover',
        label: 'videoEnhancement:runCover',
        tabId: 1,
        pageInstanceId: 'idle-page',
        phase: 'idle',
        priority: 5,
        createdAt: startedAt,
        dedupeKey: 'aged-idle-cover',
      }));
      center.registerTask(createDescriptor({
        taskId: 'waiting-deferred-load',
        label: 'videoEnhancement:loadData',
        tabId: 2,
        pageInstanceId: 'deferred-page',
        phase: 'deferred',
        priority: 5,
        createdAt: startedAt + 1,
        dedupeKey: 'waiting-deferred-load',
      }));

      expect(center.requestLease('aged-idle-cover')).toEqual({ granted: true });
      center.pauseTask('aged-idle-cover', 'test-release');
      center.resumeTask('aged-idle-cover');

      vi.setSystemTime(startedAt + 20_000);

      expect(center.requestLease('waiting-deferred-load')).toEqual({ granted: true });
      expect(center.queryState().tasks.find((task: any) => task.taskId === 'aged-idle-cover')).toMatchObject({
        status: 'queued',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cancel a hidden queued task that is still waiting for foreground visibility', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      center.updateVisibility(1, false);
      center.registerTask(createDescriptor({
        taskId: 'hidden-pending-90s',
        label: 'videoEnhancement:runTitle',
        visibilityPolicy: 'foreground_only',
      }));

      const lease = center.requestLease('hidden-pending-90s');
      expect(lease.granted).toBe(false);
      expect(lease.waitReason).toBe('tab-hidden');

      vi.setSystemTime(startedAt + 90_000);
      const task = center.queryState().tasks.find((item: any) => item.taskId === 'hidden-pending-90s');

      expect(task?.status).toBe('queued');
      expect(task?.waitReason).toBe('tab-hidden');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not apply the hidden running timeout to background_allowed tasks', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      center.updateVisibility(1, false);
      center.registerTask(createDescriptor({
        taskId: 'hidden-background-running',
        label: 'videoEnhancement:runTitle',
        visibilityPolicy: 'background_allowed',
      }));

      expect(center.requestLease('hidden-background-running').granted).toBe(true);
      center.heartbeatTask('hidden-background-running');

      vi.setSystemTime(startedAt + 46_000);
      const task = center.queryState().tasks.find((item: any) => item.taskId === 'hidden-background-running');

      expect(task?.status).toBe('running');
      expect(task?.waitReason).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requeues retryable failures and can complete on a later lease', () => {
    const center = new GlobalTaskCenter();
    center.updateVisibility(1, true);
    center.registerTask(createDescriptor({
      taskId: 'retry-then-success',
      label: 'videoEnhancement:runTitle',
      retryLimit: 2,
    }));

    expect(center.requestLease('retry-then-success').granted).toBe(true);
    const firstFail = center.failTask('retry-then-success', 'network-1');
    expect(firstFail).toMatchObject({
      ok: true,
      retryable: true,
      retryCount: 1,
      retryLimit: 2,
      status: 'queued',
      waitReason: 'retryable-error',
    });

    expect(center.requestLease('retry-then-success').granted).toBe(true);
    const secondFail = center.failTask('retry-then-success', 'network-2');
    expect(secondFail).toMatchObject({
      retryable: true,
      retryCount: 2,
      retryLimit: 2,
      status: 'queued',
      waitReason: 'retryable-error',
    });

    expect(center.requestLease('retry-then-success').granted).toBe(true);
    center.completeTask('retry-then-success');

    const task = center.queryState().tasks.find((item: any) => item.taskId === 'retry-then-success');
    expect(task?.status).toBe('done');
    expect(task?.retryCount).toBe(2);
  });

  it('marks failed tasks as terminal error after retryLimit is exhausted', () => {
    const center = new GlobalTaskCenter();
    center.updateVisibility(1, true);
    center.registerTask(createDescriptor({
      taskId: 'retry-exhausted',
      label: 'videoEnhancement:runTitle',
      retryLimit: 2,
    }));

    expect(center.requestLease('retry-exhausted').granted).toBe(true);
    expect(center.failTask('retry-exhausted', 'network-1').retryable).toBe(true);
    expect(center.requestLease('retry-exhausted').granted).toBe(true);
    expect(center.failTask('retry-exhausted', 'network-2').retryable).toBe(true);
    expect(center.requestLease('retry-exhausted').granted).toBe(true);

    const exhausted = center.failTask('retry-exhausted', 'network-3');
    expect(exhausted).toMatchObject({
      ok: true,
      retryable: false,
      retryCount: 3,
      retryLimit: 2,
      status: 'error',
      waitReason: 'retry-limit-exhausted',
    });

    const task = center.queryState().tasks.find((item: any) => item.taskId === 'retry-exhausted');
    expect(task?.status).toBe('error');
    expect(task?.waitReason).toBe('retry-limit-exhausted');
    expect(task?.detail).toBe('network-3');
  });

  it('orphan-cleans a queued retry after its owner tab is no longer known', () => {
    const center = new GlobalTaskCenter();
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);

    try {
      center.registerTask(createDescriptor({
        taskId: 'retry-pending-90s',
        label: 'videoEnhancement:runTitle',
        retryLimit: 2,
      }));
      const fail = center.failTask('retry-pending-90s', 'temporary-api-error');
      expect(fail.retryable).toBe(true);

      vi.setSystemTime(startedAt + 90_000);
      const task = center.queryState().tasks.find((item: any) => item.taskId === 'retry-pending-90s');

      expect(task?.status).toBe('canceled');
      expect(task?.waitReason).toBe('page-instance-orphaned');
      expect(task?.retryCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels restored queued tasks whose tabs no longer exist', async () => {
    const previousChrome = (globalThis as any).chrome;
    const descriptor = createDescriptor({
      taskId: 'restored-closed-tab-task',
      label: 'videoEnhancement:runTitle',
      tabId: 9876,
      pageInstanceId: 'restored-closed-page',
    });
    (globalThis as any).chrome = {
      ...previousChrome,
      tabs: {
        query: async () => [{ id: 1 }],
      },
      storage: {
        local: {
          get: (_keys: any, callback?: (result: any) => void) => {
            const snapshot = {
              'taskCenter:snapshot': {
                tasks: [{
                  descriptor,
                  runtime: { status: 'queued', retryCount: 0, pauseCount: 0, resumeCount: 0 },
                }],
                completedLabels: [],
              },
            };
            if (typeof callback === 'function') callback(snapshot);
            return Promise.resolve(snapshot);
          },
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
    };

    try {
      const center = new GlobalTaskCenter();
      await center.restoreFromStorage();

      const task = center.queryState().tasks.find((item: any) => item.taskId === descriptor.taskId);
      expect(task).toMatchObject({
        status: 'canceled',
        waitReason: 'page-closed-by-user',
      });
    } finally {
      (globalThis as any).chrome = previousChrome;
    }
  });

  it('dependency retries do not leak deferred concurrency slots', async () => {
    const sentMessages: Array<{ type: string; payload?: any }> = [];

    const previousChrome = (globalThis as any).chrome;

    vi.useFakeTimers();
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: { type: string; payload?: any }) => {
          sentMessages.push(message);
          if (message.type === 'task-center:register') {
            return { taskId: message.payload.taskId, tabId: 1 };
          }
          if (message.type === 'task-center:request-lease') {
            return { granted: true };
          }
          return { ok: true };
        },
        onMessage: { addListener: () => undefined },
      },
      storage: {
        local: {
          get: (_keys: any, callback?: (result: any) => void) => {
            if (typeof callback === 'function') callback({});
            return Promise.resolve({});
          },
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
    };

    try {
      const mod = await orchestratorModulePromise;
      const orchestrator: any = mod.initOrchestrator;

      orchestrator['completedTasks'].clear();
      orchestrator['retryTimers'].clearAll();
      orchestrator['runningDeferred'] = 0;

      orchestrator['scheduleTask']('deferred', {
        task: async () => undefined,
        options: { label: 'dep-task', dependsOn: ['ready-dep'] },
      });

      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(250);
      expect(orchestrator['runningDeferred']).toBe(0);
      expect(sentMessages.some((message) => message.type === 'task-center:request-lease')).toBe(false);

      orchestrator['completedTasks'].add('ready-dep');
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTicks();

      expect(orchestrator['runningDeferred']).toBe(0);
      expect(sentMessages.some((message) => message.type === 'task-center:request-lease')).toBe(true);
    } finally {
      vi.useRealTimers();
      (globalThis as any).chrome = previousChrome;
    }
  }, 20_000);

  it.each([
    ['deferred', 'runningDeferred', 'maxConcurrentDeferred', 500],
    ['idle', 'runningIdle', 'maxConcurrentIdle', 800],
  ] as const)('retries a %s task after the local concurrency gate opens', async (phase, runningKey, limitKey, retryDelayMs) => {
    const sentMessages: Array<{ type: string; payload?: any }> = [];
    const previousChrome = (globalThis as any).chrome;

    vi.useFakeTimers();
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: { type: string; payload?: any }) => {
          sentMessages.push(message);
          if (message.type === 'task-center:register') {
            return { taskId: message.payload.taskId, tabId: 1 };
          }
          if (message.type === 'task-center:request-lease') {
            return { granted: true };
          }
          return { ok: true };
        },
        onMessage: { addListener: () => undefined },
      },
      storage: {
        local: {
          get: (_keys: any, callback?: (result: any) => void) => {
            if (typeof callback === 'function') callback({});
            return Promise.resolve({});
          },
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
    };

    try {
      const mod = await orchestratorModulePromise;
      const orchestrator: any = mod.initOrchestrator;
      orchestrator['retryTimers'].clearAll();
      orchestrator[runningKey] = orchestrator[limitKey];
      (globalThis as any).window.setTimeout = setTimeout;
      (globalThis as any).window.clearTimeout = clearTimeout;

      const scheduledTask = {
        task: async () => undefined,
        options: { label: `${phase}-retry-after-local-capacity`, idle: false },
      };
      orchestrator['scheduleTask'](phase, scheduledTask);

      expect(sentMessages.some((message) => message.type === 'task-center:request-lease')).toBe(false);

      orchestrator[runningKey] = 0;
      await vi.advanceTimersByTimeAsync(retryDelayMs);
      await vi.runAllTicks();

      expect(sentMessages.some((message) => message.type === 'task-center:request-lease')).toBe(true);
    } finally {
      vi.useRealTimers();
      (globalThis as any).chrome = previousChrome;
    }
  }, 20_000);
});

describe('GlobalTaskCenter page-lifecycle (P0-1)', () => {
  it('handleMessage page-lifecycle cancels only matching pageInstance tasks', () => {
    const center = new GlobalTaskCenter();
    center.registerTask(createDescriptor({
      taskId: 'page-a-task',
      label: 'videoEnhancement:runTitle',
      pageInstanceId: 'page-a',
      dedupeKey: 'runTitle:page-a',
    }));
    center.registerTask(createDescriptor({
      taskId: 'page-b-task',
      label: 'videoEnhancement:runTitle',
      pageInstanceId: 'page-b',
      dedupeKey: 'runTitle:page-b',
    }));

    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.PAGE_LIFECYCLE,
      payload: { pageInstanceId: 'page-a', reason: 'page-refresh-replaced' },
    });

    expect(response).toEqual({ ok: true, canceled: 1 });
    const state = center.queryState();
    const pageA = state.tasks.find((task: any) => task.taskId === 'page-a-task');
    const pageB = state.tasks.find((task: any) => task.taskId === 'page-b-task');
    expect(pageA?.status).toBe('canceled');
    expect(pageA?.waitReason).toBe('page-refresh-replaced');
    expect(pageB?.status).toBe('registered');
  });

  it('cancels all non-terminal tasks under the same pageInstance', () => {
    const center = new GlobalTaskCenter();
    center.registerTask(createDescriptor({
      taskId: 'a1',
      label: 'videoEnhancement:runTitle',
      pageInstanceId: 'page-a',
      dedupeKey: 'a1',
    }));
    center.registerTask(createDescriptor({
      taskId: 'a2',
      label: 'videoEnhancement:runCover',
      pageInstanceId: 'page-a',
      dedupeKey: 'a2',
    }));
    center.registerTask(createDescriptor({
      taskId: 'a3-done',
      label: 'videoEnhancement:finish',
      pageInstanceId: 'page-a',
      dedupeKey: 'a3',
    }));
    center.completeTask('a3-done');

    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.PAGE_LIFECYCLE,
      payload: { pageInstanceId: 'page-a', reason: 'page-refresh-replaced' },
    });

    expect(response).toEqual({ ok: true, canceled: 2 });
    const state = center.queryState();
    expect(state.tasks.find((t: any) => t.taskId === 'a1')?.status).toBe('canceled');
    expect(state.tasks.find((t: any) => t.taskId === 'a2')?.status).toBe('canceled');
    expect(state.tasks.find((t: any) => t.taskId === 'a3-done')?.status).toBe('done');
  });

  it('does not cancel shared dedupe-by-action tasks owned by other page instances', () => {
    const center = new GlobalTaskCenter();
    const sharedKey = 'drive115:push:ABC-123:magnet:xyz';

    center.registerTask(createDescriptor({
      taskId: 'push-owner',
      label: 'drive115:push',
      pageInstanceId: 'page-owner',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
      executionClass: 'on-demand',
    }));
    center.updateVisibility(1, true);
    center.requestLease('push-owner');

    center.registerTask(createDescriptor({
      taskId: 'local-task',
      label: 'videoEnhancement:runTitle',
      pageInstanceId: 'page-other',
      dedupeKey: 'runTitle:page-other',
    }));

    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.PAGE_LIFECYCLE,
      payload: { pageInstanceId: 'page-other', reason: 'page-refresh-replaced' },
    });

    expect(response).toEqual({ ok: true, canceled: 1 });
    const state = center.queryState();
    expect(state.tasks.find((t: any) => t.taskId === 'local-task')?.status).toBe('canceled');
    expect(['registered', 'queued', 'leased', 'running']).toContain(
      state.tasks.find((t: any) => t.taskId === 'push-owner')?.status,
    );
  });

  it('cancels shared tasks when the owning pageInstance itself is closed', () => {
    const center = new GlobalTaskCenter();
    const sharedKey = 'drive115:push:ABC-123:magnet:owner-close';

    center.registerTask(createDescriptor({
      taskId: 'push-owner',
      label: 'drive115:push',
      pageInstanceId: 'page-owner',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
    }));
    center.updateVisibility(1, true);
    center.requestLease('push-owner');

    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.PAGE_LIFECYCLE,
      payload: { pageInstanceId: 'page-owner', reason: 'page-refresh-replaced' },
    });

    expect(response).toEqual({ ok: true, canceled: 1 });
    expect(center.queryState().tasks.find((t: any) => t.taskId === 'push-owner')?.status).toBe('canceled');
  });

  it('cancel-page-instance is an alias of page-lifecycle', () => {
    const center = new GlobalTaskCenter();
    center.registerTask(createDescriptor({
      taskId: 'alias-task',
      label: 'listEnhancement:init',
      pageInstanceId: 'page-x',
      dedupeKey: 'list:page-x',
    }));

    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.CANCEL_PAGE_INSTANCE,
      payload: { pageInstanceId: 'page-x', reason: 'page-closed-by-user' },
    });

    expect(response).toEqual({ ok: true, canceled: 1 });
    expect(center.queryState().tasks.find((t: any) => t.taskId === 'alias-task')?.waitReason).toBe('page-closed-by-user');
  });

  it('rejects page-lifecycle without pageInstanceId', () => {
    const center = new GlobalTaskCenter();
    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.PAGE_LIFECYCLE,
      payload: { reason: 'page-refresh-replaced' },
    });
    expect(response).toEqual({ ok: false, error: 'missing-page-instance-id' });
  });

  it('is a no-op when pageInstance has no active tasks', () => {
    const center = new GlobalTaskCenter();
    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.PAGE_LIFECYCLE,
      payload: { pageInstanceId: 'ghost', reason: 'page-refresh-replaced' },
    });
    expect(response).toEqual({ ok: true, canceled: 0 });
  });

  it('leaves already terminal tasks untouched', () => {
    const center = new GlobalTaskCenter();
    center.registerTask(createDescriptor({
      taskId: 'done-task',
      label: 'videoEnhancement:runTitle',
      pageInstanceId: 'page-term',
      dedupeKey: 'done-key',
    }));
    center.completeTask('done-task');
    center.registerTask(createDescriptor({
      taskId: 'error-task',
      label: 'videoEnhancement:runCover',
      pageInstanceId: 'page-term',
      dedupeKey: 'error-key',
      retryLimit: 0,
    }));
    center.failTask('error-task', 'boom');
    center.registerTask(createDescriptor({
      taskId: 'canceled-task',
      label: 'videoEnhancement:runFC2Breaker',
      pageInstanceId: 'page-term',
      dedupeKey: 'canceled-key',
    }));
    center.cancelTask('canceled-task', 'manual');

    const response = handle(center, {
      type: TASK_CENTER_MESSAGE.PAGE_LIFECYCLE,
      payload: { pageInstanceId: 'page-term', reason: 'page-refresh-replaced' },
    });

    expect(response).toEqual({ ok: true, canceled: 0 });
    const state = center.queryState();
    expect(state.tasks.find((t: any) => t.taskId === 'done-task')?.status).toBe('done');
    expect(state.tasks.find((t: any) => t.taskId === 'error-task')?.status).toBe('error');
    expect(state.tasks.find((t: any) => t.taskId === 'canceled-task')?.status).toBe('canceled');
  });
});

describe('GlobalTaskCenter shareScope / dedupe (P0-3/4/5)', () => {
  it('reuses terminal done for dedupe-by-action and force key creates a new execution', () => {
    const center = new GlobalTaskCenter();
    const sharedKey = 'drive115:push:ABC-123:magnet:xyz';

    const first = center.registerTask(createDescriptor({
      taskId: 'push-1',
      label: 'drive115:push',
      pageInstanceId: 'page-1',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
      executionClass: 'on-demand',
    }));
    expect(first.reused).toBe(false);
    center.completeTask('push-1');

    const second = center.registerTask(createDescriptor({
      taskId: 'push-2',
      label: 'drive115:push',
      pageInstanceId: 'page-2',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
      executionClass: 'on-demand',
    }));
    expect(second.reused).toBe(true);
    expect(second.taskId).toBe('push-1');
    expect(second.status).toBe('done');

    const force = center.registerTask(createDescriptor({
      taskId: 'push-3',
      label: 'drive115:push',
      pageInstanceId: 'page-2',
      dedupeKey: `${sharedKey}:force:1`,
      shareScope: 'dedupe-by-action',
      executionClass: 'on-demand',
    }));
    expect(force.reused).toBe(false);
    expect(force.taskId).toBe('push-3');

    const state = center.queryState();
    expect(state.tasks.find((task: any) => task.taskId === 'push-1')?.executionClass).toBe('on-demand');
    expect(state.tasks.find((task: any) => task.taskId === 'push-1')?.shareScope).toBe('dedupe-by-action');
  });

  it('reuses terminal error for dedupe-by-action without re-registering', () => {
    const center = new GlobalTaskCenter();
    const sharedKey = 'drive115:push:ABC-123:magnet:err';

    center.registerTask(createDescriptor({
      taskId: 'push-err-1',
      label: 'drive115:push',
      pageInstanceId: 'page-1',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
      retryLimit: 0,
    }));
    center.failTask('push-err-1', 'api-failed');

    const second = center.registerTask(createDescriptor({
      taskId: 'push-err-2',
      label: 'drive115:push',
      pageInstanceId: 'page-2',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
    }));

    expect(second.reused).toBe(true);
    expect(second.taskId).toBe('push-err-1');
    expect(second.status).toBe('error');
  });

  it('reuses in-flight dedupe-by-action tasks across pages', () => {
    const center = new GlobalTaskCenter();
    const sharedKey = 'drive115:push:ABC-123:magnet:run';

    center.registerTask(createDescriptor({
      taskId: 'push-run-1',
      label: 'drive115:push',
      pageInstanceId: 'page-1',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
    }));
    center.updateVisibility(1, true);
    const lease = center.requestLease('push-run-1');
    expect(lease.granted).toBe(true);

    const second = center.registerTask(createDescriptor({
      taskId: 'push-run-2',
      label: 'drive115:push',
      pageInstanceId: 'page-2',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
    }));

    expect(second.reused).toBe(true);
    expect(second.taskId).toBe('push-run-1');
    expect(['leased', 'running', 'queued', 'registered']).toContain(second.status);
  });

  it('allows re-register after canceled even for dedupe-by-action', () => {
    const center = new GlobalTaskCenter();
    const sharedKey = 'drive115:push:ABC-123:magnet:cancel';

    center.registerTask(createDescriptor({
      taskId: 'push-c1',
      label: 'drive115:push',
      pageInstanceId: 'page-1',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
    }));
    center.cancelTask('push-c1', 'page-refresh-replaced');

    const next = center.registerTask(createDescriptor({
      taskId: 'push-c2',
      label: 'drive115:push',
      pageInstanceId: 'page-2',
      dedupeKey: sharedKey,
      shareScope: 'dedupe-by-action',
    }));

    expect(next.reused).toBe(false);
    expect(next.taskId).toBe('push-c2');
    expect(next.status).toBe('registered');
  });

  it('does not merge different magnets under the same video', () => {
    const center = new GlobalTaskCenter();
    const first = center.registerTask(createDescriptor({
      taskId: 'push-m1',
      label: 'drive115:push',
      dedupeKey: 'drive115:push:ABC:magnet-a',
      shareScope: 'dedupe-by-action',
    }));
    const second = center.registerTask(createDescriptor({
      taskId: 'push-m2',
      label: 'drive115:push',
      dedupeKey: 'drive115:push:ABC:magnet-b',
      shareScope: 'dedupe-by-action',
    }));
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(false);
    expect(second.taskId).toBe('push-m2');
  });

  it('keeps default terminal dedupe behavior when shareScope is absent (done/error/canceled)', () => {
    const center = new GlobalTaskCenter();
    const key = 'videoEnhancement:runTitle:page-1';

    center.registerTask(createDescriptor({
      taskId: 'title-1',
      label: 'videoEnhancement:runTitle',
      dedupeKey: key,
    }));
    center.completeTask('title-1');
    const afterDone = center.registerTask(createDescriptor({
      taskId: 'title-2',
      label: 'videoEnhancement:runTitle',
      dedupeKey: key,
      retryLimit: 0,
    }));
    expect(afterDone.reused).toBe(false);
    expect(afterDone.taskId).toBe('title-2');

    center.failTask('title-2', 'boom');
    const afterError = center.registerTask(createDescriptor({
      taskId: 'title-3',
      label: 'videoEnhancement:runTitle',
      dedupeKey: key,
    }));
    expect(afterError.reused).toBe(false);
    expect(afterError.taskId).toBe('title-3');

    center.cancelTask('title-3', 'manual');
    const afterCancel = center.registerTask(createDescriptor({
      taskId: 'title-4',
      label: 'videoEnhancement:runTitle',
      dedupeKey: key,
    }));
    expect(afterCancel.reused).toBe(false);
    expect(afterCancel.taskId).toBe('title-4');
  });

  it('still reuses in-flight non-shareScope tasks with same dedupeKey', () => {
    const center = new GlobalTaskCenter();
    const key = 'videoEnhancement:runTitle:page-1';
    center.registerTask(createDescriptor({
      taskId: 'title-live-1',
      label: 'videoEnhancement:runTitle',
      dedupeKey: key,
    }));
    const second = center.registerTask(createDescriptor({
      taskId: 'title-live-2',
      label: 'videoEnhancement:runTitle',
      dedupeKey: key,
    }));
    expect(second.reused).toBe(true);
    expect(second.taskId).toBe('title-live-1');
  });

  it('reuses exact same taskId without creating a second record', () => {
    const center = new GlobalTaskCenter();
    const first = center.registerTask(createDescriptor({
      taskId: 'same-id',
      label: 'videoEnhancement:runTitle',
      dedupeKey: 'same-id-key',
    }));
    const second = center.registerTask(createDescriptor({
      taskId: 'same-id',
      label: 'videoEnhancement:runTitle',
      dedupeKey: 'same-id-key',
    }));
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.taskId).toBe('same-id');
    expect(center.queryState().tasks.filter((t: any) => t.taskId === 'same-id')).toHaveLength(1);
  });

  it('queryState exposes optional executionClass and shareScope only when set', () => {
    const center = new GlobalTaskCenter();
    center.registerTask(createDescriptor({
      taskId: 'meta-1',
      label: 'privacy:init',
      dedupeKey: 'privacy:page-1',
      executionClass: 'system-only',
      shareScope: 'per-page',
    }));
    center.registerTask(createDescriptor({
      taskId: 'meta-2',
      label: 'videoEnhancement:runTitle',
      dedupeKey: 'title:page-1',
    }));

    const state = center.queryState();
    const withMeta = state.tasks.find((t: any) => t.taskId === 'meta-1');
    const withoutMeta = state.tasks.find((t: any) => t.taskId === 'meta-2');
    expect(withMeta?.executionClass).toBe('system-only');
    expect(withMeta?.shareScope).toBe('per-page');
    expect(withoutMeta?.executionClass).toBeUndefined();
    expect(withoutMeta?.shareScope).toBeUndefined();
  });

  it('falls back to label:pageUrl dedupeKey when omitted', () => {
    const center = new GlobalTaskCenter();
    const first = center.registerTask(createDescriptor({
      taskId: 'fallback-1',
      label: 'videoEnhancement:runTitle',
      pageUrl: '/v/same',
    }));
    const second = center.registerTask(createDescriptor({
      taskId: 'fallback-2',
      label: 'videoEnhancement:runTitle',
      pageUrl: '/v/same',
    }));
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.taskId).toBe('fallback-1');
  });
});


describe('GlobalTaskCenter multi pageInstance pressure (P2 R3)', () => {
  it('serializes source-page-heavy work across independent page instances', () => {
    const center = new GlobalTaskCenter();
    center.updateVisibility(1, true);
    center.updateVisibility(2, true);

    center.registerTask(createDescriptor({
      taskId: 'source-heavy-status',
      label: 'videoStatus:initialSync',
      tabId: 1,
      pageInstanceId: 'source-heavy-page-1',
      phase: 'critical',
      priority: 12,
      dedupeKey: 'source-heavy:status',
    }));
    center.registerTask(createDescriptor({
      taskId: 'source-heavy-actors',
      label: 'actorMarks:page',
      tabId: 2,
      pageInstanceId: 'source-heavy-page-2',
      phase: 'idle',
      visibilityPolicy: 'foreground_first',
      dedupeKey: 'source-heavy:actors',
    }));
    center.registerTask(createDescriptor({
      taskId: 'source-light-refresh',
      label: 'videoStatus:fullRefresh',
      tabId: 3,
      pageInstanceId: 'source-heavy-page-3',
      phase: 'deferred',
      dedupeKey: 'source-heavy:refresh',
    }));

    expect(center.requestLease('source-heavy-status')).toEqual({ granted: true });
    expect(center.requestLease('source-light-refresh')).toEqual({
      granted: false,
      waitReason: 'source-page-heavy-budget',
    });
    expect(center.requestLease('source-heavy-actors')).toEqual({
      granted: false,
      waitReason: 'source-page-heavy-budget',
    });

    center.completeTask('source-heavy-status');

    expect(center.requestLease('source-heavy-actors')).toEqual({ granted: true });
  });

  it('caps visible leases across independent buckets', () => {
    const center = new GlobalTaskCenter();
    const labels = [
      'videoStatus:query',
      'videoEnhancement:runTitle',
      'actorMarks:load',
      'actorRemarks:load',
      'drive115:sync',
      'insights:generate',
      'videoFavoriteRating:load',
    ];

    labels.forEach((label, index) => {
      const tabId = index + 1;
      center.updateVisibility(tabId, true);
      center.registerTask(createDescriptor({
        taskId: `visible-${index}`,
        label,
        tabId,
        pageInstanceId: `visible-page-${index}`,
        phase: 'high',
        dedupeKey: `visible:${index}`,
      }));
    });

    const granted = labels.filter((_, index) => center.requestLease(`visible-${index}`).granted);

    expect(granted).toHaveLength(6);
  });

  it('caps visible leases from one page instance across independent buckets', () => {
    const center = new GlobalTaskCenter();
    const labels = [
      'videoStatus:query',
      'videoEnhancement:runTitle',
      'actorMarks:load',
      'actorRemarks:load',
      'insights:generate',
    ];
    center.updateVisibility(1, true);

    labels.forEach((label, index) => {
      center.registerTask(createDescriptor({
        taskId: `same-page-${index}`,
        label,
        dedupeKey: `same-page:${index}`,
      }));
    });

    const granted = labels.filter((_, index) => center.requestLease(`same-page-${index}`).granted);

    expect(granted).toHaveLength(4);
  });

  it('reserves one visible global lease for critical or high phase work', () => {
    const center = new GlobalTaskCenter();
    const idleLabels = [
      'videoStatus:query',
      'videoEnhancement:runTitle',
      'actorMarks:load',
      'actorRemarks:load',
      'drive115:sync',
      'insights:generate',
    ];

    idleLabels.forEach((label, index) => {
      const tabId = index + 1;
      center.updateVisibility(tabId, true);
      center.registerTask(createDescriptor({
        taskId: `idle-${index}`,
        label,
        tabId,
        pageInstanceId: `idle-page-${index}`,
        phase: 'idle',
        dedupeKey: `idle:${index}`,
      }));
    });
    center.updateVisibility(99, true);
    center.registerTask(createDescriptor({
      taskId: 'critical-later',
      label: 'contentFilter:critical',
      tabId: 99,
      pageInstanceId: 'critical-page',
      phase: 'critical',
      dedupeKey: 'critical:later',
    }));

    const idleGranted = idleLabels.filter((_, index) => center.requestLease(`idle-${index}`).granted);

    expect(idleGranted).toHaveLength(5);
    expect(center.requestLease('critical-later')).toEqual({ granted: true });
  });

  it('caps background leases globally and per page instance', () => {
    const center = new GlobalTaskCenter();
    const labels = [
      'videoStatus:query',
      'videoEnhancement:runTitle',
      'actorMarks:load',
      'actorRemarks:load',
    ];

    labels.forEach((label, index) => {
      center.updateVisibility(index < 2 ? 1 : index + 1, false);
      center.registerTask(createDescriptor({
        taskId: `background-${index}`,
        label,
        tabId: index < 2 ? 1 : index + 1,
        pageInstanceId: index < 2 ? 'background-page-one' : `background-page-${index}`,
        dedupeKey: `background:${index}`,
      }));
    });

    const granted = labels.filter((_, index) => center.requestLease(`background-${index}`).granted);

    expect(granted).toHaveLength(2);
    expect(center.queryState().tasks.find((task: any) => task.taskId === 'background-1')?.waitReason)
      .toBe('background-page-budget');
  });

  it('reserves one hidden global lease for critical or high phase work', () => {
    const center = new GlobalTaskCenter();
    const idleLabels = [
      'videoEnhancement:runTitle',
      'actorRemarks:load',
      'insights:generate',
    ];

    idleLabels.forEach((label, index) => {
      const tabId = index + 1;
      center.updateVisibility(tabId, false);
      center.registerTask(createDescriptor({
        taskId: `hidden-idle-${index}`,
        label,
        tabId,
        pageInstanceId: `hidden-idle-page-${index}`,
        phase: 'idle',
        dedupeKey: `hidden-idle:${index}`,
      }));
    });
    center.updateVisibility(99, false);
    center.registerTask(createDescriptor({
      taskId: 'hidden-high',
      label: 'videoEnhancement:initCore',
      tabId: 99,
      pageInstanceId: 'hidden-high-page',
      phase: 'high',
      priority: 8,
      dedupeKey: 'hidden-high',
    }));

    const idleGranted = idleLabels.filter((_, index) => center.requestLease(`hidden-idle-${index}`).granted);

    expect(idleGranted).toHaveLength(2);
    expect(center.requestLease('hidden-high')).toEqual({ granted: true });
  });

  it('prewarms smart hidden pages with at most two concurrent tasks across fifteen tabs', () => {
    const center = new GlobalTaskCenter();

    for (let index = 0; index < 15; index += 1) {
      const tabId = index + 1;
      center.updateVisibility(tabId, false);
      center.registerTask(createDescriptor({
        taskId: `smart-prewarm-${index}`,
        label: 'videoEnhancement:runTitle',
        tabId,
        pageInstanceId: `smart-prewarm-page-${index}`,
        cost: 'heavy',
        visibilityPolicy: 'background_throttled',
        dedupeKey: `smart-prewarm:${index}`,
      }));
    }

    const granted = Array.from({ length: 15 }, (_, index) => (
      center.requestLease(`smart-prewarm-${index}`).granted
    ));

    expect(granted.filter(Boolean)).toHaveLength(2);
    expect(center.queryState().tasks.filter((task: any) => task.status === 'leased')).toHaveLength(2);
    expect(center.queryState().tasks.find((task: any) => task.taskId === 'smart-prewarm-2')?.waitReason)
      .toBe('smart-background-global-budget');
  });

  it('keeps the smart prewarm budget during the initial visibility-report race', () => {
    const center = new GlobalTaskCenter();

    for (let index = 0; index < 15; index += 1) {
      const tabId = index + 1;
      center.updateVisibility(tabId, true);
      center.registerTask(createDescriptor({
        taskId: `smart-visible-startup-${index}`,
        label: 'videoEnhancement:runTitle',
        tabId,
        pageInstanceId: `smart-visible-startup-page-${index}`,
        cost: 'heavy',
        visibilityPolicy: 'background_throttled',
        dedupeKey: `smart-visible-startup:${index}`,
      }));
    }

    const granted = Array.from({ length: 15 }, (_, index) => (
      center.requestLease(`smart-visible-startup-${index}`).granted
    ));

    expect(granted.filter(Boolean)).toHaveLength(2);
    expect(center.queryState().tasks.find((task: any) => task.taskId === 'smart-visible-startup-2')?.waitReason)
      .toBe('smart-background-global-budget');
  });

  it('limits smart background prewarming to one task per hidden page without reducing immediate background work', () => {
    const center = new GlobalTaskCenter();
    center.updateVisibility(1, false);
    center.updateVisibility(2, false);
    center.updateVisibility(3, false);

    center.registerTask(createDescriptor({
      taskId: 'smart-prewarm-page-one-first',
      label: 'videoEnhancement:runTitle',
      tabId: 1,
      pageInstanceId: 'smart-prewarm-page-one',
      cost: 'heavy',
      visibilityPolicy: 'background_throttled',
      dedupeKey: 'smart-prewarm-page-one:first',
    }));
    center.registerTask(createDescriptor({
      taskId: 'smart-prewarm-page-two',
      label: 'videoEnhancement:runFC2Breaker',
      tabId: 2,
      pageInstanceId: 'smart-prewarm-page-two',
      cost: 'heavy',
      phase: 'high',
      priority: 8,
      visibilityPolicy: 'background_throttled',
      dedupeKey: 'smart-prewarm-page-two',
    }));

    expect(center.requestLease('smart-prewarm-page-two')).toEqual({ granted: true });
    expect(center.requestLease('smart-prewarm-page-one-first')).toEqual({ granted: true });
    center.registerTask(createDescriptor({
      taskId: 'smart-prewarm-page-one-second',
      label: 'videoEnhancement:runFC2Breaker',
      tabId: 1,
      pageInstanceId: 'smart-prewarm-page-one',
      cost: 'heavy',
      visibilityPolicy: 'background_throttled',
      dedupeKey: 'smart-prewarm-page-one:second',
    }));
    expect(center.requestLease('smart-prewarm-page-one-second')).toEqual({
      granted: false,
      waitReason: 'smart-background-page-budget',
    });
    center.registerTask(createDescriptor({
      taskId: 'immediate-background-third',
      label: 'videoEnhancement:runMosaic',
      tabId: 3,
      pageInstanceId: 'immediate-background-page',
      cost: 'heavy',
      phase: 'high',
      priority: 8,
      visibilityPolicy: 'background_allowed',
      dedupeKey: 'immediate-background-third',
    }));
    expect(center.requestLease('immediate-background-third')).toEqual({ granted: true });
  });

  it('registers many pageInstances without exceeding translate bucket concurrency', () => {
    const center = new GlobalTaskCenter();
    const pageCount = 25;
    for (let i = 0; i < pageCount; i += 1) {
      center.registerTask(createDescriptor({
        taskId: `tr-${i}`,
        label: 'videoEnhancement:translateCurrentTitle:request',
        tabId: 100 + i,
        pageInstanceId: `page-${i}`,
        pageUrl: `/v/code-${i}`,
        dedupeKey: `translate:page-${i}`,
        phase: 'deferred',
        priority: 3,
      }));
      center.registerTask(createDescriptor({
        taskId: `list-${i}`,
        label: 'listEnhancement:init',
        tabId: 100 + i,
        pageInstanceId: `page-${i}`,
        pageUrl: `/lists/${i}`,
        dedupeKey: `list:page-${i}`,
        phase: 'high',
        priority: 8,
      }));
    }

    const state = center.queryState();
    expect(state.tasks.length).toBeGreaterThanOrEqual(pageCount * 2);

    // 申请 lease：translate 桶 limit=1，不应同时 grant 多个 translate request
    let translateGranted = 0;
    for (let i = 0; i < pageCount; i += 1) {
      const lease = center.requestLease(`tr-${i}`);
      if (lease?.granted) translateGranted += 1;
    }
    expect(translateGranted).toBeLessThanOrEqual(1);

    // 高优先级列表任务仍可在各自 bucket 下获得进展（不要求全部 grant，但不为零）
    let listGranted = 0;
    for (let i = 0; i < pageCount; i += 1) {
      const lease = center.requestLease(`list-${i}`);
      if (lease?.granted) listGranted += 1;
    }
    expect(listGranted).toBeGreaterThan(0);
  });

  it('mark/check completed labels support cross-page dependency signals', () => {
    const center = new GlobalTaskCenter();
    expect(center.isTaskLabelCompleted('videoEnhancement:loadData')).toBe(false);
    center.markTaskLabelCompleted('videoEnhancement:loadData');
    expect(center.isTaskLabelCompleted('videoEnhancement:loadData')).toBe(true);
  });

  it('batches task snapshot writes while completion state remains immediately available', async () => {
    vi.useFakeTimers();
    const storageSet = vi.spyOn((globalThis as any).chrome.storage.local, 'set');
    const center = new GlobalTaskCenter();

    try {
      center.markTaskLabelCompleted('videoStatus:initialSync');
      center.markTaskLabelCompleted('videoEnhancement:initCore');
      center.markTaskLabelCompleted('videoEnhancement:loadData');

      expect(center.isTaskLabelCompleted('videoEnhancement:loadData')).toBe(true);
      expect(storageSet).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);

      expect(storageSet).toHaveBeenCalledTimes(1);
      expect(storageSet).toHaveBeenCalledWith(expect.objectContaining({
        'taskCenter:snapshot': expect.objectContaining({
          completedLabels: expect.arrayContaining([
            'videoStatus:initialSync',
            'videoEnhancement:initCore',
            'videoEnhancement:loadData',
          ]),
        }),
      }));
    } finally {
      storageSet.mockRestore();
      vi.useRealTimers();
    }
  });
});
