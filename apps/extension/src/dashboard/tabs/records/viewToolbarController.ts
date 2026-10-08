import {
  MEDIA_STATE_SELECT_VALUES,
  isMediaStateSelectValue,
} from './filterModel';

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
   * 媒体库状态筛选（10-08 换绑 #filterSelect）：server 分页模式下两媒体 option disabled。
   * false = server 分页模式（禁用）。缺省视为可用。
   */
  getMediaStateFilterEnabled?: () => boolean;
  /** #filterSelect（含 optgroup「媒体库」两 option）：server 模式置 disabled。 */
  filterSelect?: HTMLSelectElement | null;
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

function updateMediaStateOptions(
  filterSelect: HTMLSelectElement | null | undefined,
  enabled: boolean,
): void {
  if (!filterSelect) return;
  for (const value of MEDIA_STATE_SELECT_VALUES) {
    const option = Array.from(filterSelect.options).find(item => item.value === value) as HTMLOptionElement | undefined;
    if (option) option.disabled = !enabled;
  }
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
    updateMediaStateOptions(options.filterSelect, enabled);
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

  };

  return { bind, update };
}

/**
 * 10-24 自保语义（10-08 换绑 #filterSelect）：进入 server 分页模式时当前值为媒体库项
 * → 复位 'all'（媒体库状态筛选仅本地模式可用）。返回是否发生复位（调用方负责 toast）。
 * 结构化类型不绑 DOM：单测可喂 { value } 普通对象。
 */
export function applyServerModeMediaStateReset(
  filterSelect: { value: string } | null | undefined,
  enteringServer: boolean,
): boolean {
  if (!enteringServer || !filterSelect) return false;
  if (!isMediaStateSelectValue(filterSelect.value)) return false;
  filterSelect.value = 'all';
  return true;
}
