import { describe, expect, it, vi } from 'vitest';

import {
  createTabLifecycleRegistry,
  type TabLifecycleEvent,
} from './tabLifecycle';

describe('tab lifecycle registry', () => {
  it('restores a tab after it has been hidden without duplicating activation', () => {
    const events: TabLifecycleEvent[] = [];
    const registry = createTabLifecycleRegistry();

    registry.register('tab-media', {
      onActive: () => events.push('active'),
      onHidden: () => events.push('hidden'),
      onRestore: () => events.push('restore'),
    });

    registry.notify('active', 'tab-media');
    registry.notify('hidden', 'tab-media');
    registry.notify('active', 'tab-media');

    expect(events).toEqual(['active', 'hidden', 'restore']);
  });

  it('ignores repeated active notifications so page resources stay single-flight', () => {
    const lifecycle = {
      active: 0,
      hidden: 0,
      restore: 0,
      dispose: 0,
      resources: 0,
    };
    const registry = createTabLifecycleRegistry();

    const mountResources = (): void => {
      lifecycle.active += 1;
      if (lifecycle.resources === 0) lifecycle.resources = 5;
    };
    const releaseResources = (): void => {
      lifecycle.hidden += 1;
      lifecycle.resources = 0;
    };

    registry.register('tab-media', {
      onActive: mountResources,
      onHidden: releaseResources,
      onRestore: () => {
        lifecycle.restore += 1;
        mountResources();
      },
      onDispose: () => {
        lifecycle.dispose += 1;
        lifecycle.resources = 0;
      },
    });

    registry.notify('active', 'tab-media');
    registry.notify('active', 'tab-media');
    registry.notify('hidden', 'tab-media');
    registry.notify('active', 'tab-media');
    registry.notify('dispose', 'tab-media');

    expect(lifecycle).toEqual({
      active: 2,
      hidden: 1,
      restore: 1,
      dispose: 1,
      resources: 0,
    });
  });

  it('only keeps the latest registration and unregisters its callbacks', () => {
    const events: string[] = [];
    const registry = createTabLifecycleRegistry();

    const unregisterFirst = registry.register('tab-records', {
      onHidden: () => events.push('first-hidden'),
    });
    registry.register('tab-records', {
      onHidden: () => events.push('second-hidden'),
    });
    unregisterFirst();

    registry.notify('active', 'tab-records');
    registry.notify('hidden', 'tab-records');

    expect(events).toEqual(['second-hidden']);
  });

  it('disposes a stale registration before replacing it and records initialization', () => {
    const firstDispose = vi.fn();
    const secondActive = vi.fn();
    const probe = { lifecycleCounts: {} as Record<string, number> };
    vi.stubGlobal('__JAVDB_PERF_PROBE__', probe);
    const registry = createTabLifecycleRegistry();

    registry.register('tab-media', { onDispose: firstDispose });
    registry.register('tab-media', { onActive: secondActive });
    registry.notify('active', 'tab-media');

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondActive).toHaveBeenCalledTimes(1);
    expect(probe.lifecycleCounts).toMatchObject({
      'tab-media:initialize': 2,
      'tab-media:dispose': 1,
      'tab-media:active': 1,
    });
    vi.unstubAllGlobals();
  });

  it('notifies dispose once and forgets the active tab', () => {
    const events: string[] = [];
    const registry = createTabLifecycleRegistry();
    registry.register('tab-settings', {
      onActive: () => events.push('active'),
      onDispose: () => events.push('dispose'),
    });

    registry.notify('active', 'tab-settings');
    registry.notify('dispose', 'tab-settings');
    registry.notify('dispose', 'tab-settings');

    expect(events).toEqual(['active', 'dispose']);
    expect(registry.getActiveTabId()).toBeNull();
  });

  it('disposes every registered tab exactly once when the dashboard closes', () => {
    const disposed: string[] = [];
    const registry = createTabLifecycleRegistry();

    registry.register('tab-home', { onDispose: () => disposed.push('tab-home') });
    registry.register('tab-media', { onDispose: () => disposed.push('tab-media') });
    registry.notify('active', 'tab-media');

    registry.disposeAll();
    registry.disposeAll();

    expect(disposed).toEqual(['tab-home', 'tab-media']);
    expect(registry.getActiveTabId()).toBeNull();
  });

  it('reports lifecycle transitions to the opt-in performance probe only', () => {
    const globalObject = globalThis as typeof globalThis & {
      __JAVDB_PERF_PROBE__?: { lifecycleCounts?: Record<string, number> };
    };
    globalObject.__JAVDB_PERF_PROBE__ = { lifecycleCounts: {} };

    try {
      const registry = createTabLifecycleRegistry();
      registry.register('tab-media', {});
      registry.notify('active', 'tab-media');
      registry.notify('hidden', 'tab-media');
      registry.notify('active', 'tab-media');
      registry.notify('dispose', 'tab-media');

      expect(globalObject.__JAVDB_PERF_PROBE__?.lifecycleCounts).toEqual({
        'tab-media:initialize': 1,
        'tab-media:active': 1,
        'tab-media:hidden': 1,
        'tab-media:restore': 1,
        'tab-media:dispose': 1,
      });
    } finally {
      delete globalObject.__JAVDB_PERF_PROBE__;
    }
  });
});
