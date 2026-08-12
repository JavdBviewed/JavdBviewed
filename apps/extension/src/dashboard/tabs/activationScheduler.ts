type ActivationRunner<T> = (value: T, isLatest: () => boolean) => Promise<void>;
type ActivationPreparer<T> = (value: T) => void;

type Waiter = {
  resolve: () => void;
  reject: (reason: unknown) => void;
};

/** 共享并发初始化，失败后允许下一次调用重试。 */
export function createSingleFlightAsyncTask<T>(run: () => Promise<T>): () => Promise<T> {
  let active: Promise<T> | null = null;
  return () => {
    if (active) return active;
    const task = run();
    active = task.finally(() => {
      active = null;
    });
    return active;
  };
}

/** 保留当前执行项与最新待处理项，避免快速切换时并发初始化多个页面。 */
export function createLatestActivationScheduler<T>(
  run: ActivationRunner<T>,
  prepare?: ActivationPreparer<T>,
) {
  let generation = 0;
  let pending: { value: T; generation: number } | null = null;
  let draining: Promise<void> | null = null;
  let waiters: Waiter[] = [];

  const drain = async (): Promise<void> => {
    try {
      while (pending) {
        const next = pending;
        pending = null;
        await run(next.value, () => next.generation === generation);
      }
      const completed = waiters;
      waiters = [];
      completed.forEach(waiter => waiter.resolve());
    } catch (error) {
      const failed = waiters;
      waiters = [];
      failed.forEach(waiter => waiter.reject(error));
    } finally {
      draining = null;
      if (pending) {
        draining = drain();
      }
    }
  };

  return {
    schedule(value: T): Promise<void> {
      generation += 1;
      prepare?.(value);
      pending = { value, generation };
      const promise = new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
      if (!draining) {
        draining = drain();
      }
      return promise;
    },
  };
}
