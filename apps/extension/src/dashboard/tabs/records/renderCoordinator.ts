export interface CreateRecordsRenderCoordinatorOptions {
  videoList: HTMLElement;
  shouldUseIDB: () => boolean;
  setServerModeActive: (active: boolean) => void;
  renderServerPage: () => Promise<void>;
  updateFilteredRecords: () => void;
  renderVideoList: () => void;
  renderPagination: () => void;
  /** 搜索结果横幅（本地/IDB 路径统一；未接线时 no-op）。 */
  updateSearchResultCount?: () => void;
  updateStats: () => void | Promise<void>;
  isActive?: () => boolean;
  showLoading?: () => void;
  scheduleStats?: (callback: () => void) => void;
  /**
   * 10-08 扩项（288）：全量滤数据源一次性回填（本地路径专用）。
   * 注入后：先「加载中」占位 → await 回填 → 再滤/渲染（回填后无条件 filter，其余动作 isActive 门控）。
   * 未注入：保持旧同步语义（占位不出现）。
   */
  ensureLocalRecordsLoaded?: () => Promise<void>;
  /**
   * 10-08 修复（288，A1a 竞态）：媒体库状态索引懒载（本地路径专用）。
   * 命中映射 recompute 依赖 STATE.records → 必须在回填完成后、updateFilteredRecords 之前 await，
   * 否则 gap 态（IDB 非空 bootstrap STATE.records=[]）首个媒体选择会把空命中映射钉死。
   * 未注入或媒体项未激活时调用方自判 no-op。
   */
  prepareMediaState?: () => void | Promise<void>;
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

    const finish = (gated: boolean): void => {
      // 回填后无条件重算过滤结果（数据源已变）；渲染动作在页签已切走时不再执行
      options.updateFilteredRecords();
      if (gated && options.isActive && !options.isActive()) return;
      options.renderVideoList();
      options.renderPagination();
      options.updateSearchResultCount?.();
      void options.updateStats();
    };

    if (options.ensureLocalRecordsLoaded) {
      // 10-08 扩项：IDB 非空主用户态 bootstrap STATE.records=[]（设计），
      // 本地全量滤数据源为空 → 占位等待一次性回填后再滤/渲染
      const ensureLoaded = options.ensureLocalRecordsLoaded;
      if (options.showLoading) options.showLoading();
      else defaultShowLoading(options.videoList);
      void (async () => {
        await ensureLoaded();
        try {
          // 10-08 修复：媒体索引 recompute 依赖回填后的数据源，回填后、过滤前就位
          await options.prepareMediaState?.();
        } catch {
          // 索引准备异常不阻断渲染（runtime 内部已按零命中容错）
        }
        finish(true);
      })();
      return;
    }

    finish(false);
  };

  return { render };
}
