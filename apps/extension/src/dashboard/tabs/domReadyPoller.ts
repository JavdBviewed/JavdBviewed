export type DomReadyPollerOptions = {
  signal?: AbortSignal;
  intervalMs?: number;
};

/** 等待页面宿主就绪；页面被隐藏或销毁时可取消轮询，避免遗留定时器。 */
export function waitForDomReady(
  isReady: () => boolean,
  options: DomReadyPollerOptions = {},
): Promise<boolean> {
  const { signal, intervalMs = 100 } = options;

  if (signal?.aborted) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>(resolve => {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let settled = false;

    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener('abort', onAbort);
      resolve(ready);
    };

    const onAbort = (): void => finish(false);
    const check = (): void => {
      if (signal?.aborted) {
        finish(false);
        return;
      }
      if (isReady()) {
        finish(true);
        return;
      }
      timer = globalThis.setTimeout(check, intervalMs);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    check();
  });
}
