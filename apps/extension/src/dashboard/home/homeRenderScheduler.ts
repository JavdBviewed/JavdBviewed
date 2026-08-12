export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const afterFrame = () => {
      setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(afterFrame);
    } else {
      setTimeout(afterFrame, 0);
    }
  });
}

export interface HomeChartRenderTask {
  cancel: () => void;
}

export function createHomeChartRenderQueue(options: { timeoutMs?: number } = {}): {
  enqueue: (render: () => void) => void;
  cancel: () => void;
} {
  const pending: Array<() => void> = [];
  let active: HomeChartRenderTask | null = null;
  const scheduleNext = (): void => {
    if (active || pending.length === 0) return;
    active = scheduleHomeChartRender(() => {
      active = null;
      pending.shift()?.();
      scheduleNext();
    }, options);
  };
  return {
    enqueue: (render: () => void): void => {
      pending.push(render);
      scheduleNext();
    },
    cancel: (): void => {
      pending.length = 0;
      active?.cancel();
      active = null;
    },
  };
}

export function scheduleHomeChartRender(
  render: () => void,
  options: { timeoutMs?: number } = {},
): HomeChartRenderTask {
  let cancelled = false;
  let idleId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const run = (): void => {
    if (cancelled) return;
    cancelled = true;
    render();
  };
  const timeoutMs = options.timeoutMs ?? 1200;
  const scheduler = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof scheduler.requestIdleCallback === 'function') {
    idleId = scheduler.requestIdleCallback(run, { timeout: timeoutMs });
  } else {
    timeoutId = setTimeout(run, timeoutMs);
  }
  return {
    cancel: () => {
      cancelled = true;
      if (idleId !== null && typeof scheduler.cancelIdleCallback === 'function') {
        scheduler.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) clearTimeout(timeoutId);
    },
  };
}
