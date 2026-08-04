export type LatestValueWriter<T> = {
  enqueue(value: T): void;
  flush(): Promise<void>;
};

export function createLatestValueWriter<T>(
  write: (value: T) => PromiseLike<void> | void,
  onError?: (error: unknown) => void,
): LatestValueWriter<T> {
  let pending: { value: T } | undefined;
  let running = false;
  let drainPromise: Promise<void> | undefined;

  const drain = async (): Promise<void> => {
    try {
      while (pending) {
        const next = pending;
        pending = undefined;
        try {
          await write(next.value);
        } catch (error) {
          onError?.(error);
        }
      }
    } finally {
      running = false;
      drainPromise = undefined;
      if (pending) startDrain();
    }
  };

  const startDrain = (): void => {
    if (running) return;
    running = true;
    drainPromise = drain();
  };

  return {
    enqueue(value: T): void {
      pending = { value };
      startDrain();
    },
    async flush(): Promise<void> {
      while (running) {
        const current = drainPromise;
        if (!current) break;
        await current;
      }
    },
  };
}
