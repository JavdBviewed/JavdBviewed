type ActivationRunner<T> = (value: T) => Promise<void>;

type Waiter = {
  resolve: () => void;
  reject: (reason: unknown) => void;
};

/** 保留当前执行项与最新待处理项，避免快速切换时并发初始化多个页面。 */
export function createLatestActivationScheduler<T>(run: ActivationRunner<T>) {
  let pending: { value: T } | null = null;
  let draining: Promise<void> | null = null;
  let waiters: Waiter[] = [];

  const drain = async (): Promise<void> => {
    try {
      while (pending) {
        const next = pending;
        pending = null;
        await run(next.value);
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
      pending = { value };
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
