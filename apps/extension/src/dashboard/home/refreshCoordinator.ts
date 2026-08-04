export function createRefreshCoordinator(
  refresh: () => void | Promise<void>,
): () => Promise<void> {
  let active: Promise<void> | null = null;

  return (): Promise<void> => {
    if (active) return active;

    let result: void | Promise<void>;
    try {
      result = refresh();
    } catch (error) {
      result = Promise.reject(error);
    }
    active = Promise.resolve(result).finally(() => {
      active = null;
    });
    return active;
  };
}
