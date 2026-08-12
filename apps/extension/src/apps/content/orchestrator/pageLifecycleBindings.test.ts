import { describe, expect, it, vi } from 'vitest';
import { installOrchestratorPageLifecycleBindings } from './pageLifecycleBindings';

function createWindowStub() {
  const listeners = new Map<string, Array<() => void>>();
  const windowRef = {
    location: { href: 'https://javdb.com/v/abc123' },
    addEventListener: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) || []), listener]);
    }),
  } as any;

  return {
    windowRef,
    dispatch(event: string) {
      for (const listener of listeners.get(event) || []) {
        listener();
      }
    },
  };
}

describe('orchestrator page lifecycle bindings', () => {
  it('exposes the orchestrator on window and reports pagehide lifecycle cancel', () => {
    const { windowRef, dispatch } = createWindowStub();
    const sendMessage = vi.fn();
    const orchestrator = {
      getMetrics: vi.fn(() => ({})),
    };

    installOrchestratorPageLifecycleBindings(orchestrator, {
      windowRef,
      chromeRuntime: { sendMessage },
      getPageContextFn: () => ({
        pageUrl: 'https://javdb.com/v/abc123',
        pageType: 'detail',
        mainId: 'ABC-123',
        pageInstanceId: 'page-1',
      }),
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(windowRef.__initOrchestrator__).toBe(orchestrator);
    dispatch('pagehide');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'task-center:page-lifecycle',
      payload: {
        pageInstanceId: 'page-1',
        reason: 'page-refresh-replaced',
      },
    });
  });

  it('saves current metrics on beforeunload', () => {
    const { windowRef, dispatch } = createWindowStub();
    const sendMessage = vi.fn();
    const orchestrator = {
      getMetrics: vi.fn(() => ({
        totalTasks: 3,
        completedTasks: 2,
      })),
    };

    installOrchestratorPageLifecycleBindings(orchestrator, {
      windowRef,
      chromeRuntime: { sendMessage },
      getPageContextFn: () => ({
        pageUrl: 'https://javdb.com/v/abc123',
        pageType: 'detail',
        mainId: 'ABC-123',
        pageInstanceId: 'page-1',
      }),
      now: () => 123456,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    dispatch('beforeunload');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'orchestrator:saveMetrics',
      metrics: {
        totalTasks: 3,
        completedTasks: 2,
        pageUrl: 'https://javdb.com/v/abc123',
        timestamp: 123456,
      },
    });
  });

  it('disposes orchestrator monitors when the page is replaced', () => {
    const { windowRef, dispatch } = createWindowStub();
    const dispose = vi.fn();
    const orchestrator = {
      getMetrics: vi.fn(() => ({})),
      dispose,
    };

    installOrchestratorPageLifecycleBindings(orchestrator, {
      windowRef,
      chromeRuntime: { sendMessage: vi.fn() },
      getPageContextFn: () => ({
        pageUrl: 'https://javdb.com/v/abc123',
        pageType: 'detail',
        mainId: 'ABC-123',
        pageInstanceId: 'page-1',
      }),
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    dispatch('pagehide');

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
