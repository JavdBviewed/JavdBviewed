export interface NewWorksAutoStatusSyncGateOptions<T> {
  ttlMs: number;
  createSkipped(): T;
  now?: () => number;
}

export interface NewWorksAutoStatusSyncRunOptions {
  force?: boolean;
}

export interface NewWorksAutoStatusSyncGate<T> {
  run(task: () => Promise<T>, options?: NewWorksAutoStatusSyncRunOptions): Promise<T>;
  reset(): void;
}

/**
 * 控制新作品页的静默状态同步：同一时间只允许一个任务，TTL 内不重复执行。
 * 手动同步通过 force 绕过 TTL，但仍复用正在执行的任务。
 */
export function createNewWorksAutoStatusSyncGate<T>(
  options: NewWorksAutoStatusSyncGateOptions<T>,
): NewWorksAutoStatusSyncGate<T> {
  const ttlMs = Math.max(0, options.ttlMs);
  const now = options.now ?? Date.now;
  let lastSuccessAt = 0;
  let inFlight: Promise<T> | null = null;

  return {
    run(task, runOptions = {}) {
      if (inFlight) return inFlight;

      const force = runOptions.force === true;
      if (!force && lastSuccessAt > 0 && now() - lastSuccessAt < ttlMs) {
        return Promise.resolve(options.createSkipped());
      }

      const promise = task().then((result) => {
        lastSuccessAt = now();
        return result;
      }).finally(() => {
        if (inFlight === promise) inFlight = null;
      });
      inFlight = promise;
      return promise;
    },

    reset() {
      lastSuccessAt = 0;
    },
  };
}
