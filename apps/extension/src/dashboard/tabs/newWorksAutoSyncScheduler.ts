export type NewWorksAutoSyncTask = {
  cancel: () => void;
};

export function createNewWorksAutoSyncScheduler(input: {
  run: () => void;
  schedule: (callback: () => void) => NewWorksAutoSyncTask;
}): {
  request: () => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
} {
  let active = true;
  let pending = false;
  let task: NewWorksAutoSyncTask | null = null;

  const schedulePending = (): void => {
    if (!active || !pending || task) return;
    let scheduled: NewWorksAutoSyncTask | null = null;
    scheduled = input.schedule(() => {
      if (task !== scheduled) return;
      task = null;
      if (!active || !pending) return;
      pending = false;
      input.run();
    });
    task = scheduled;
  };

  return {
    request: (): void => {
      pending = true;
      schedulePending();
    },
    setActive: (nextActive: boolean): void => {
      active = nextActive;
      if (!active) {
        task?.cancel();
        task = null;
        return;
      }
      schedulePending();
    },
    dispose: (): void => {
      pending = false;
      task?.cancel();
      task = null;
    },
  };
}
