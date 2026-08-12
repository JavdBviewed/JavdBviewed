export type HomeChartSession = {
  epoch: number;
  signal: AbortSignal;
};

type ChartLike = {
  destroy?: () => void;
  dispose?: () => void;
  cancel?: () => void;
};

export type HomeChartDisposeReason = 'tab-hide' | 'pagehide' | 'manual';

export function getHomeChartDisposeOptions(reason: HomeChartDisposeReason): {
  preserveOverviewRender: boolean;
} {
  return { preserveOverviewRender: reason === 'tab-hide' };
}

export function getHomeChartHideAction(): 'cancel' {
  return 'cancel';
}

export function createHomeChartLifecycle() {
  let epoch = 0;
  let controller: AbortController | null = null;
  const cleanups = new Set<() => void>();

  const begin = (): HomeChartSession => {
    controller?.abort();
    epoch += 1;
    controller = new AbortController();
    return { epoch, signal: controller.signal };
  };

  const isCurrent = (session: HomeChartSession): boolean => (
    session.epoch === epoch && !session.signal.aborted
  );

  const addCleanup = (cleanup: () => void): (() => void) => {
    cleanups.add(cleanup);
    return () => cleanups.delete(cleanup);
  };

  const cancel = (): void => {
    epoch += 1;
    controller?.abort();
    controller = null;
  };

  const dispose = (): void => {
    cancel();
    const pending = Array.from(cleanups);
    cleanups.clear();
    pending.forEach((cleanup) => {
      try { cleanup(); } catch {}
    });
  };

  return { begin, isCurrent, addCleanup, cancel, dispose };
}

export function disposeChartRegistry(registry: Record<string, unknown>): void {
  const disposed = new Set<unknown>();
  Object.keys(registry).forEach((key) => {
    const value = registry[key];
    if (value && (typeof value === 'object' || typeof value === 'function') && !disposed.has(value)) {
      disposed.add(value);
      const chart = value as ChartLike;
      try { chart.cancel?.(); } catch {}
      try {
        if (typeof chart.destroy === 'function') chart.destroy();
        else if (typeof chart.dispose === 'function') chart.dispose();
      } catch {}
    }
    delete registry[key];
  });
}
