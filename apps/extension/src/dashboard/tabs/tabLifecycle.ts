/**
 * @file tabLifecycle.ts
 * @description Dashboard 标签页生命周期协调器
 * @module dashboard/tabs
 */

export type TabLifecycleEvent = 'initialize' | 'active' | 'hidden' | 'restore' | 'dispose';

export type TabLifecycleHandlers = {
  onActive?: () => void;
  onHidden?: () => void;
  onRestore?: () => void;
  onDispose?: () => void;
};

type Registration = {
  handlers: TabLifecycleHandlers;
  hidden: boolean;
};

function recordPerformanceLifecycle(tabId: string, event: TabLifecycleEvent): void {
  const globalObject = globalThis as typeof globalThis & {
    __JAVDB_PERF_PROBE__?: { lifecycleCounts?: Record<string, number> };
  };
  const probe = globalObject.__JAVDB_PERF_PROBE__;
  if (!probe) return;
  const counts = probe.lifecycleCounts ?? {};
  const key = `${tabId}:${event}`;
  counts[key] = (counts[key] ?? 0) + 1;
  probe.lifecycleCounts = counts;
}

export type TabLifecycleRegistry = {
  register(tabId: string, handlers: TabLifecycleHandlers): () => void;
  notify(event: TabLifecycleEvent, tabId: string): void;
  disposeAll(): void;
  getActiveTabId(): string | null;
};

/**
 * 只维护页面级生命周期，不持有页面数据；页面模块自行决定释放哪些资源。
 */
export function createTabLifecycleRegistry(): TabLifecycleRegistry {
  const registrations = new Map<string, Registration>();
  let activeTabId: string | null = null;

  const register = (tabId: string, handlers: TabLifecycleHandlers): (() => void) => {
    const previous = registrations.get(tabId);
    if (previous) {
      // 同一 Tab 重复注册时先释放旧资源，避免旧 root/listener 失去所有权后继续存活。
      recordPerformanceLifecycle(tabId, 'dispose');
      previous.handlers.onDispose?.();
      registrations.delete(tabId);
      if (activeTabId === tabId) activeTabId = null;
    }

    const registration: Registration = { handlers, hidden: false };
    registrations.set(tabId, registration);
    recordPerformanceLifecycle(tabId, 'initialize');

    if (activeTabId === tabId) {
      handlers.onActive?.();
    }

    return () => {
      if (registrations.get(tabId) !== registration) return;
      registrations.delete(tabId);
      if (activeTabId === tabId) activeTabId = null;
    };
  };

  const notify = (event: TabLifecycleEvent, tabId: string): void => {
    const registration = registrations.get(tabId);

    if (event === 'active' || event === 'restore') {
      const isAlreadyActive = activeTabId === tabId && registration?.hidden === false;
      if (event === 'active' && isAlreadyActive) {
        return;
      }

      if (activeTabId && activeTabId !== tabId) {
        const previous = registrations.get(activeTabId);
        recordPerformanceLifecycle(activeTabId, 'hidden');
        previous?.handlers.onHidden?.();
        if (previous) previous.hidden = true;
      }

      const wasHidden = registration?.hidden ?? false;
      activeTabId = tabId;
      if (registration) registration.hidden = false;
      if (event === 'restore' || wasHidden) {
        recordPerformanceLifecycle(tabId, 'restore');
        registration?.handlers.onRestore?.();
      } else {
        recordPerformanceLifecycle(tabId, 'active');
        registration?.handlers.onActive?.();
      }
      return;
    }

    if (event === 'hidden') {
      if (activeTabId === tabId) activeTabId = null;
      if (registration) registration.hidden = true;
      recordPerformanceLifecycle(tabId, 'hidden');
      registration?.handlers.onHidden?.();
      return;
    }

    if (activeTabId === tabId) activeTabId = null;
    recordPerformanceLifecycle(tabId, 'dispose');
    registration?.handlers.onDispose?.();
    registrations.delete(tabId);
  };

  const disposeAll = (): void => {
    for (const tabId of [...registrations.keys()]) {
      notify('dispose', tabId);
    }
    activeTabId = null;
  };

  return { register, notify, disposeAll, getActiveTabId: () => activeTabId };
}

export const dashboardTabLifecycle = createTabLifecycleRegistry();
