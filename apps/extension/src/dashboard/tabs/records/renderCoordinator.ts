export interface CreateRecordsRenderCoordinatorOptions {
  videoList: HTMLElement;
  shouldUseIDB: () => boolean;
  setServerModeActive: (active: boolean) => void;
  renderServerPage: () => Promise<void>;
  updateFilteredRecords: () => void;
  renderVideoList: () => void;
  renderPagination: () => void;
  updateStats: () => void | Promise<void>;
  isActive?: () => boolean;
  showLoading?: () => void;
  scheduleStats?: (callback: () => void) => void;
}

export interface RecordsRenderCoordinator {
  render: () => void;
}

function defaultShowLoading(videoList: HTMLElement): void {
  try {
    videoList.innerHTML = '<li class="empty-list">加载中...</li>';
  } catch {}
}

function defaultScheduleStats(callback: () => void): void {
  const scheduler = globalThis as typeof globalThis & {
    requestIdleCallback?: (idleCallback: () => void, options?: { timeout: number }) => number;
  };
  if (typeof scheduler.requestIdleCallback === 'function') {
    scheduler.requestIdleCallback(callback, { timeout: 500 });
    return;
  }
  setTimeout(callback, 0);
}

export function createRecordsRenderCoordinator(
  options: CreateRecordsRenderCoordinatorOptions,
): RecordsRenderCoordinator {
  const scheduleStats = options.scheduleStats || defaultScheduleStats;
  const render = () => {
    const useIDB = options.shouldUseIDB();
    options.setServerModeActive(useIDB);

    if (useIDB) {
      if (options.showLoading) options.showLoading();
      else defaultShowLoading(options.videoList);
      options.renderServerPage().finally(() => {
        if (options.isActive && !options.isActive()) return;
        scheduleStats(() => {
          if (options.isActive && !options.isActive()) return;
          void options.updateStats();
        });
      });
      return;
    }

    options.updateFilteredRecords();
    options.renderVideoList();
    options.renderPagination();
    void options.updateStats();
  };

  return { render };
}
