export type RecordsViewMode = 'list' | 'card';

export interface CreateRecordsViewToolbarControllerOptions {
  toggleCoversBtn?: HTMLButtonElement | null;
  toggleViewModeBtn?: HTMLButtonElement | null;
  favoritesButton?: HTMLButtonElement | null;
  videoList: HTMLElement;
  getCoversEnabled: () => boolean;
  setCoversEnabled: (enabled: boolean) => void;
  getViewMode: () => RecordsViewMode;
  setViewMode: (mode: RecordsViewMode) => void;
  getFavoritesActive: () => boolean;
  setFavoritesActive: (active: boolean) => void;
  persistSettings: () => void;
  onFilterChanged: () => void;
  onRender: () => void;
  /**
   * 媒体库状态筛选 chip（10-24，可选）：server 分页模式下 disabled + 降级 tooltip。
   * 降级态点击不生效；激活态切换后回调 onMediaStateFilterToggled（触发索引懒载）+ onFilterChanged。
   */
  mediaLibraryButton?: HTMLButtonElement | null;
  realWatchedButton?: HTMLButtonElement | null;
  getInLibraryActive?: () => boolean;
  setInLibraryActive?: (active: boolean) => void;
  getRealWatchedActive?: () => boolean;
  setRealWatchedActive?: (active: boolean) => void;
  /** false = server 分页模式（chip 禁用）。缺省视为可用。 */
  getMediaStateFilterEnabled?: () => boolean;
  onMediaStateFilterToggled?: () => void;
}

export interface RecordsViewToolbarController {
  bind: () => void;
  update: () => void;
}

function updateCoverButton(button: HTMLButtonElement | null | undefined, enabled: boolean): void {
  if (!button) return;
  button.innerHTML = enabled
    ? '<i class="fas fa-image"></i> 隐藏封面'
    : '<i class="fas fa-image"></i> 显示封面';
  button.classList.toggle('toggle-on', enabled);
  button.classList.toggle('toggle-off', !enabled);
  button.title = enabled ? '隐藏封面' : '显示封面';
}

function updateViewModeButton(
  button: HTMLButtonElement | null | undefined,
  videoList: HTMLElement,
  viewMode: RecordsViewMode,
): void {
  if (!button) return;

  const icon = button.querySelector('.view-icon') as HTMLElement | null;
  const text = button.querySelector('.view-text') as HTMLElement | null;
  const isListMode = viewMode === 'list';

  button.classList.toggle('list-mode', isListMode);
  button.classList.toggle('card-mode', !isListMode);

  if (icon) {
    icon.className = isListMode ? 'fas fa-list view-icon' : 'fas fa-th-large view-icon';
  }
  if (text) {
    text.textContent = isListMode ? '列表视图' : '卡片视图';
  }

  button.title = isListMode ? '切换到卡片视图' : '切换到列表视图';
  videoList.classList.toggle('card-view', !isListMode);
}

function updateFavoritesButton(button: HTMLButtonElement | null | undefined, active: boolean): void {
  if (!button) return;
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  button.title = active ? '取消收藏筛选' : '只看收藏番号';
}

function updateMediaStateButton(
  button: HTMLButtonElement | null | undefined,
  active: boolean,
  enabled: boolean,
  idleTitle: string,
  activeTitle: string,
): void {
  if (!button) return;
  const shownActive = active && enabled;
  button.classList.toggle('active', shownActive);
  button.disabled = !enabled;
  button.setAttribute('aria-pressed', String(shownActive));
  button.title = !enabled ? '媒体库状态筛选仅本地模式可用' : (shownActive ? activeTitle : idleTitle);
}

export function createRecordsViewToolbarController(
  options: CreateRecordsViewToolbarControllerOptions,
): RecordsViewToolbarController {
  const mediaStateEnabled = (): boolean => options.getMediaStateFilterEnabled?.() ?? true;

  const update = () => {
    updateCoverButton(options.toggleCoversBtn, options.getCoversEnabled());
    updateViewModeButton(options.toggleViewModeBtn, options.videoList, options.getViewMode());
    updateFavoritesButton(options.favoritesButton, options.getFavoritesActive());
    const enabled = mediaStateEnabled();
    updateMediaStateButton(
      options.mediaLibraryButton,
      options.getInLibraryActive?.() ?? false,
      enabled,
      '仅看媒体库已入库',
      '取消「已入库」筛选',
    );
    updateMediaStateButton(
      options.realWatchedButton,
      options.getRealWatchedActive?.() ?? false,
      enabled,
      '仅看媒体库真实已看',
      '取消「真实已看」筛选',
    );
  };

  const bind = () => {
    options.toggleCoversBtn?.addEventListener('click', () => {
      options.setCoversEnabled(!options.getCoversEnabled());
      options.persistSettings();
      update();
      options.onRender();
    });

    options.toggleViewModeBtn?.addEventListener('click', () => {
      options.toggleViewModeBtn?.classList.add('switching');
      window.setTimeout(() => {
        options.toggleViewModeBtn?.classList.remove('switching');
      }, 500);

      options.setViewMode(options.getViewMode() === 'list' ? 'card' : 'list');
      options.persistSettings();
      update();
      options.onRender();
    });

    options.favoritesButton?.addEventListener('click', () => {
      options.setFavoritesActive(!options.getFavoritesActive());
      update();
      options.onFilterChanged();
    });

    const bindMediaStateButton = (
      button: HTMLButtonElement | null | undefined,
      isActive: () => boolean,
      setActive: (active: boolean) => void,
    ): void => {
      if (!button) return;
      button.addEventListener('click', () => {
        if (!mediaStateEnabled()) return;
        const next = !isActive();
        setActive(next);
        update();
        options.onFilterChanged();
        options.onMediaStateFilterToggled?.();
      });
    };
    bindMediaStateButton(
      options.mediaLibraryButton,
      () => options.getInLibraryActive?.() ?? false,
      (active) => options.setInLibraryActive?.(active),
    );
    bindMediaStateButton(
      options.realWatchedButton,
      () => options.getRealWatchedActive?.() ?? false,
      (active) => options.setRealWatchedActive?.(active),
    );
  };

  return { bind, update };
}
