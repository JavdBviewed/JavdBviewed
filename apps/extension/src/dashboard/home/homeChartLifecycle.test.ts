import { describe, expect, it, vi } from 'vitest';
import {
  createHomeChartLifecycle,
  disposeChartRegistry,
  getHomeChartHideAction,
  getHomeChartDisposeOptions,
} from './homeChartLifecycle';

describe('home chart lifecycle', () => {
  it('invalidates the previous session when a new render starts', () => {
    const lifecycle = createHomeChartLifecycle();
    const first = lifecycle.begin();
    const second = lifecycle.begin();

    expect(first.signal.aborted).toBe(true);
    expect(lifecycle.isCurrent(first)).toBe(false);
    expect(lifecycle.isCurrent(second)).toBe(true);
  });

  it('aborts the active session and runs cleanup callbacks once on dispose', () => {
    const lifecycle = createHomeChartLifecycle();
    const session = lifecycle.begin();
    const cleanup = vi.fn();
    lifecycle.addCleanup(cleanup);

    lifecycle.dispose();
    lifecycle.dispose();

    expect(session.signal.aborted).toBe(true);
    expect(lifecycle.isCurrent(session)).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('can cancel rendering without disposing completed chart resources', () => {
    const lifecycle = createHomeChartLifecycle();
    const session = lifecycle.begin();

    lifecycle.cancel();

    expect(session.signal.aborted).toBe(true);
    expect(lifecycle.isCurrent(session)).toBe(false);
  });

  it('disposes each chart instance once and clears the registry', () => {
    const destroy = vi.fn();
    const dispose = vi.fn();
    const registry: Record<string, unknown> = {
      first: { destroy },
      duplicate: { destroy },
      second: { dispose },
      pager: { page: 1 },
    };
    registry.duplicate = registry.first;

    disposeChartRegistry(registry);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(Object.keys(registry)).toHaveLength(0);
  });

  it('preserves the overview redraw request when a tab is hidden', () => {
    expect(getHomeChartDisposeOptions('tab-hide')).toEqual({
      preserveOverviewRender: true,
    });
    expect(getHomeChartDisposeOptions('pagehide')).toEqual({
      preserveOverviewRender: false,
    });
  });

  it('cancels in-flight work rather than disposing chart resources when Home is hidden', () => {
    expect(getHomeChartHideAction()).toBe('cancel');
  });
});
