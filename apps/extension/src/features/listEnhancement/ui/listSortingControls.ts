/**
 * @file listSortingControls.ts
 * @description 列表排序增强控件
 * @module features/listEnhancement
 */
import {
  detectNativeSortCapabilities,
  readSortableItems,
  sortSortableItems,
  type ListSortingConfig,
  type ListSortingPositionStrategy,
  type ListSortMode,
} from '../application/listSorting';
import { findPagedMovieList, type ListScrollPagingAppendEvent } from '../application/scrollPaging';

const TOOLBAR_CLASS = 'x-list-sort-toolbar';
const NOTICE_CLASS = 'x-list-sort-notice';
const PAGE_PROMPT_CLASS = 'x-list-sort-page-prompt';
const PRIMARY_ROW_CLASS = 'x-list-sort-primary-row';
const SORT_ROW_CLASS = 'x-list-sort-row';
const NATIVE_SORT_CONTAINER_ATTR = 'data-x-list-sort-native-container';
const NATIVE_SORT_BUTTONS_ATTR = 'data-x-list-sort-native-buttons';
const NATIVE_SORT_SELECTED_ATTR = 'data-x-list-sort-native-selected';
const SORT_SCOPE_HINT_TEXT = '全站排序会按站点结果重新加载；已加载排序只整理当前已显示的影片，自动翻页会扩大整理范围。';
const PLUGIN_SORT_MODES: Exclude<ListSortMode, 'original'>[] = ['rating-desc', 'rating-count-desc'];

export interface ListSortingControllerOptions {
  document: Document;
  window: Window;
  config: ListSortingConfig;
  logger?: (...args: unknown[]) => void;
}

export interface ListSortingController {
  init: () => void;
  cleanup: () => void;
  updateConfig: (config: ListSortingConfig) => void;
  applySort: (mode: ListSortMode, positionStrategy?: ListSortingPositionStrategy) => void;
  handleItemsAppended: (event: ListScrollPagingAppendEvent) => void;
  getActiveMode: () => ListSortMode;
}

function getPluginSortLabel(mode: Exclude<ListSortMode, 'original'>): string {
  return mode === 'rating-desc' ? '评分高优先' : '评价人数多优先';
}

function findNativeToolbar(documentRef: Document): HTMLElement | null {
  const nativeButtons = findNativeSortButtons(documentRef) || documentRef.querySelector('.toolbar .buttons.has-addons');
  if (nativeButtons) {
    return nativeButtons.closest('.toolbar') as HTMLElement | null;
  }
  return documentRef.querySelector('.buttons.has-addons') as HTMLElement | null;
}

function isNativeSortButtonGroup(buttons: HTMLElement): boolean {
  const text = buttons.textContent || '';
  const hrefs = Array.from(buttons.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .map(anchor => anchor.getAttribute('href') || '')
    .join(' ');
  return /排序|倒序|评分|評分|熱度|热度|想看|看過|看过|磁鏈更新|磁链更新|发布日期|發佈日期|发布日|發行日/i.test(text)
    || /sort_type=|vst=1|vst=2/i.test(hrefs);
}

function findNativeSortButtons(documentRef: Document): HTMLElement | null {
  const groups = Array.from(documentRef.querySelectorAll<HTMLElement>('.toolbar .buttons.has-addons'));
  return groups.find(isNativeSortButtonGroup) || groups[0] || null;
}

function findMovieList(documentRef: Document): HTMLElement | null {
  return findPagedMovieList(documentRef);
}

function rememberNativeSelectedButtons(buttons: HTMLElement): void {
  buttons.querySelectorAll<HTMLElement>('a.button').forEach((button) => {
    const isSelected = button.classList.contains('is-info') && button.classList.contains('is-selected');
    if (isSelected) {
      button.setAttribute(NATIVE_SORT_SELECTED_ATTR, '1');
    } else {
      button.removeAttribute(NATIVE_SORT_SELECTED_ATTR);
    }
  });
}

function restoreNativeSelectedButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`[${NATIVE_SORT_SELECTED_ATTR}="1"]`).forEach((button) => {
    button.classList.add('is-info', 'is-selected');
    button.removeAttribute(NATIVE_SORT_SELECTED_ATTR);
  });
}

function isVisibleSortableItem(item: HTMLElement, windowRef: Window): boolean {
  if (!item.isConnected) return false;
  if (item.hidden) return false;
  if (item.style.display === 'none') return false;
  if (item.hasAttribute('data-hidden-by-default') || item.hasAttribute('data-hidden-by-actor')) return false;

  const computedStyle = windowRef.getComputedStyle(item);
  if (computedStyle.display === 'none') return false;
  if (computedStyle.visibility === 'hidden' || computedStyle.visibility === 'collapse') return false;

  return true;
}

export function createListSortingController(options: ListSortingControllerOptions): ListSortingController {
  let config = options.config;
  let activeMode: ListSortMode = 'original';
  let toolbarElement: HTMLElement | null = null;
  let noticeElement: HTMLElement | null = null;
  let latestPromptElement: HTMLElement | null = null;
  let pendingAppendedCount = 0;

  const logger = (...args: unknown[]): void => {
    options.logger?.(...args);
  };

  const updateActiveButtons = (): void => {
    const shouldShowNativeSelection = activeMode === 'original';
    toolbarElement?.querySelectorAll<HTMLElement>(`[${NATIVE_SORT_SELECTED_ATTR}="1"]`).forEach((button) => {
      button.classList.toggle('is-info', shouldShowNativeSelection);
      button.classList.toggle('is-selected', shouldShowNativeSelection);
    });

    toolbarElement?.querySelectorAll<HTMLButtonElement>('[data-list-sort-mode]').forEach((button) => {
      const isActive = button.dataset.listSortMode === activeMode;
      button.classList.toggle('is-info', isActive);
      button.classList.toggle('is-selected', isActive);
    });
  };

  const clearNotice = (): void => {
    if (noticeElement) {
      noticeElement.textContent = '';
      noticeElement.hidden = true;
    }
  };

  const updateNotice = (): void => {
    if (!noticeElement) return;
    if (activeMode === 'original') {
      clearNotice();
      return;
    }

    const capabilities = detectNativeSortCapabilities(options.document);
    noticeElement.hidden = false;
    if (capabilities.activeLabel) {
      noticeElement.textContent = `当前列表先按原站「${capabilities.activeLabel}」加载，再整理已经加载的影片。`;
      return;
    }
    noticeElement.textContent = '只整理已经加载出来的影片；原站排序仍决定后续加载顺序。';
  };

  const clearPrompt = (): void => {
    latestPromptElement?.remove();
    latestPromptElement = null;
    pendingAppendedCount = 0;
  };

  const removeToolbar = (): void => {
    if (toolbarElement?.dataset.xListSortMerged === '1') {
      const nativeSortContainer = toolbarElement.querySelector<HTMLElement>(`[${NATIVE_SORT_CONTAINER_ATTR}="1"]`);
      const nativeSortButtons = toolbarElement.querySelector<HTMLElement>(`[${NATIVE_SORT_BUTTONS_ATTR}="1"]`);
      const sortRow = toolbarElement.querySelector<HTMLElement>(`.${SORT_ROW_CLASS}`);
      const nativeSegment = sortRow?.querySelector<HTMLElement>('.x-list-sort-native-segment');
      const mergedButtons = nativeSegment?.querySelector<HTMLElement>('.x-list-sort-buttons')
        || sortRow?.querySelector<HTMLElement>('.x-list-sort-buttons');
      restoreNativeSelectedButtons(toolbarElement);
      if (nativeSortButtons && mergedButtons) {
        Array.from(mergedButtons.children).forEach((child) => {
          if (child.tagName.toLowerCase() === 'a') {
            nativeSortButtons.appendChild(child);
          }
        });
      }
      if (nativeSortContainer) {
        nativeSortContainer.hidden = false;
        nativeSortContainer.removeAttribute(NATIVE_SORT_CONTAINER_ATTR);
      }
      nativeSortButtons?.removeAttribute(NATIVE_SORT_BUTTONS_ATTR);
      const primaryRow = toolbarElement.querySelector<HTMLElement>(`.${PRIMARY_ROW_CLASS}`);
      if (primaryRow) {
        Array.from(primaryRow.children).forEach(child => {
          primaryRow.insertAdjacentElement('beforebegin', child);
        });
        primaryRow.remove();
      }
      sortRow?.remove();
      toolbarElement.querySelectorAll('.x-list-sort-group').forEach(element => element.remove());
      toolbarElement.classList.remove(TOOLBAR_CLASS);
      toolbarElement.removeAttribute('data-x-list-sort-merged');
    } else {
      toolbarElement?.remove();
    }
    noticeElement?.remove();
    toolbarElement = null;
    noticeElement = null;
  };

  const renderToolbar = (): void => {
    removeToolbar();

    if (!config.enabled) return;

    const movieList = findMovieList(options.document);
    if (!movieList) return;

    const appendPluginSortButtons = (wrapper: HTMLElement): void => {
      appendScopeLabel(wrapper, '已加载', '整理当前已显示的影片，自动翻页会扩大整理范围', 'plugin');
      PLUGIN_SORT_MODES.forEach((mode) => {
        const button = options.document.createElement('button');
        button.type = 'button';
        button.className = 'button is-small x-list-sort-button';
        button.dataset.listSortMode = mode;
        button.textContent = getPluginSortLabel(mode);
        button.title = `按${getPluginSortLabel(mode)}整理已加载影片`;
        button.addEventListener('click', () => {
          applySort(mode);
        });
        wrapper.appendChild(button);
      });
    };

    const appendScopeLabel = (
      wrapper: HTMLElement,
      label: string,
      title: string,
      scope: 'native' | 'plugin',
    ): void => {
      const scopeLabel = options.document.createElement('span');
      scopeLabel.className = `x-list-sort-scope-label ${scope}`;
      scopeLabel.textContent = label;
      scopeLabel.title = title;
      wrapper.appendChild(scopeLabel);
    };

    const createSortSegment = (scope: 'native' | 'plugin'): { segment: HTMLElement; buttons: HTMLElement } => {
      const segment = options.document.createElement('div');
      segment.className = `x-list-sort-segment x-list-sort-${scope}-segment`;
      const buttons = options.document.createElement('div');
      buttons.className = 'buttons has-addons x-list-sort-buttons';
      segment.appendChild(buttons);
      return { segment, buttons };
    };

    const createMergedSortRow = (): {
      row: HTMLElement;
      segments: HTMLElement;
      nativeButtons: HTMLElement;
      pluginButtons: HTMLElement;
    } => {
      const row = options.document.createElement('div');
      row.className = `button-group ${SORT_ROW_CLASS}`;
      const segments = options.document.createElement('div');
      segments.className = 'x-list-sort-segments';
      const { segment: nativeSegment, buttons: nativeButtons } = createSortSegment('native');
      const { segment: pluginSegment, buttons: pluginButtons } = createSortSegment('plugin');
      const hint = options.document.createElement('div');
      hint.className = 'x-list-sort-scope-hint';
      hint.textContent = SORT_SCOPE_HINT_TEXT;
      segments.append(nativeSegment, pluginSegment);
      row.append(segments, hint);

      return { row, segments, nativeButtons, pluginButtons };
    };

    const appendStandalonePluginButtons = (wrapper: HTMLElement): void => {
      const { row, segments, pluginButtons } = createMergedSortRow();
      segments.querySelector('.x-list-sort-native-segment')?.remove();
      appendPluginSortButtons(pluginButtons);
      wrapper.append(row);
    };

    const nativeButtons = findNativeSortButtons(options.document);
    const nativeToolbar = nativeButtons?.closest('.toolbar') as HTMLElement | null;
    if (nativeButtons && nativeToolbar) {
      nativeToolbar.classList.add(TOOLBAR_CLASS);
      nativeToolbar.dataset.xListSortMerged = '1';

      const nativeSortGroup = nativeButtons.closest('.button-group') as HTMLElement | null;
      const nativeSortContainer = nativeSortGroup || nativeButtons;
      nativeSortContainer.hidden = true;
      nativeSortContainer.setAttribute(NATIVE_SORT_CONTAINER_ATTR, '1');
      nativeButtons.setAttribute(NATIVE_SORT_BUTTONS_ATTR, '1');
      rememberNativeSelectedButtons(nativeButtons);

      const directGroups = Array.from(nativeToolbar.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('button-group'));
      const shouldSplitRows = nativeSortGroup !== null
        && nativeSortGroup.parentElement === nativeToolbar
        && directGroups.filter(group => group !== nativeSortGroup).length > 0;

      let primaryRow: HTMLElement | null = null;
      if (shouldSplitRows && nativeSortGroup) {
        primaryRow = options.document.createElement('div');
        primaryRow.className = PRIMARY_ROW_CLASS;
        nativeToolbar.insertBefore(primaryRow, directGroups[0] || nativeSortGroup);
        directGroups
          .filter(group => group !== nativeSortGroup)
          .forEach(group => primaryRow?.appendChild(group));
      }

      const { row: sortRow, nativeButtons: nativeSortButtons, pluginButtons } = createMergedSortRow();
      appendScopeLabel(nativeSortButtons, '全站', '按站点结果重新加载', 'native');
      Array.from(nativeButtons.children).forEach(child => {
        nativeSortButtons.appendChild(child);
      });
      appendPluginSortButtons(pluginButtons);

      if (primaryRow) {
        primaryRow.insertAdjacentElement('afterend', sortRow);
      } else {
        nativeSortContainer.insertAdjacentElement('afterend', sortRow);
      }

      toolbarElement = nativeToolbar;
    } else {
      const wrapper = options.document.createElement('div');
      wrapper.className = `${TOOLBAR_CLASS} toolbar`;
      appendStandalonePluginButtons(wrapper);

      const nativeFallback = findNativeToolbar(options.document);
      if (nativeFallback?.parentElement) {
        nativeFallback.insertAdjacentElement('afterend', wrapper);
      } else {
        movieList.insertAdjacentElement('beforebegin', wrapper);
      }

      toolbarElement = wrapper;
    }

    if (toolbarElement?.querySelectorAll('.x-list-sort-button').length === 0) {
      removeToolbar();
      return;
    }

    const notice = options.document.createElement('div');
    notice.className = NOTICE_CLASS;
    notice.hidden = true;
    toolbarElement.insertAdjacentElement('afterend', notice);
    noticeElement = notice;

    updateActiveButtons();
    updateNotice();
  };

  const renderPagePrompt = (firstAppendedItem: HTMLElement | null): void => {
    latestPromptElement?.remove();

    const movieList = findMovieList(options.document);
    if (!movieList) return;

    const prompt = options.document.createElement('div');
    prompt.className = PAGE_PROMPT_CLASS;

    const message = options.document.createElement('span');
    message.textContent = `新加载的 ${pendingAppendedCount} 部影片还没参与当前排序。`;

    const resortButton = options.document.createElement('button');
    resortButton.type = 'button';
    resortButton.className = 'button is-small is-info';
    resortButton.textContent = '重新排序已加载影片';
    resortButton.addEventListener('click', () => {
      applySort(activeMode);
    });

    const keepButton = options.document.createElement('button');
    keepButton.type = 'button';
    keepButton.className = 'button is-small';
    keepButton.textContent = '保持追加浏览';
    keepButton.addEventListener('click', () => {
      clearPrompt();
    });

    prompt.append(message, resortButton, keepButton);

    if (firstAppendedItem?.parentElement === movieList) {
      movieList.insertBefore(prompt, firstAppendedItem);
    } else {
      movieList.appendChild(prompt);
    }

    latestPromptElement = prompt;
  };

  const applyDomOrder = (mode: ListSortMode): void => {
    const movieList = findMovieList(options.document);
    if (!movieList) return;
    const sorted = sortSortableItems(readSortableItems(movieList), mode);
    sorted.forEach(item => {
      movieList.appendChild(item.element);
    });
  };

  function applySort(mode: ListSortMode, positionStrategy: ListSortingPositionStrategy = config.autoResortPosition): void {
    if (!config.enabled) return;
    const previousScrollY = options.window.scrollY || options.window.pageYOffset || 0;
    activeMode = mode;
    clearPrompt();
    applyDomOrder(mode);
    updateActiveButtons();
    updateNotice();

    if (positionStrategy === 'top') {
      toolbarElement?.scrollIntoView({ block: 'start' });
    } else if (previousScrollY > 0) {
      options.window.scrollTo(0, previousScrollY);
    }
  }

  const handleItemsAppended = (event: ListScrollPagingAppendEvent): void => {
    if (!config.enabled) return;
    const movieList = findMovieList(options.document);
    if (movieList) readSortableItems(movieList);
    if (activeMode === 'original') return;

    if (config.appendStrategy === 'auto-resort') {
      logger('[ListSorting] auto resort after append', event);
      applySort(activeMode, config.autoResortPosition);
      return;
    }

    const visibleItems = event.items.filter(item => isVisibleSortableItem(item, options.window));
    const visibleAppendedCount = event.items.length > 0 ? visibleItems.length : event.appended;
    if (visibleAppendedCount <= 0) return;

    pendingAppendedCount += visibleAppendedCount;
    renderPagePrompt(visibleItems[0] || event.items[0] || null);
  };

  const cleanup = (): void => {
    removeToolbar();
    latestPromptElement?.remove();
    latestPromptElement = null;
    pendingAppendedCount = 0;
    activeMode = 'original';
  };

  return {
    init(): void {
      if (!config.enabled) {
        cleanup();
        return;
      }
      const movieList = findMovieList(options.document);
      if (movieList) readSortableItems(movieList);
      renderToolbar();
    },

    cleanup,

    updateConfig(nextConfig: ListSortingConfig): void {
      config = nextConfig;
      if (!config.enabled) {
        cleanup();
        return;
      }
      renderToolbar();
    },

    applySort,
    handleItemsAppended,

    getActiveMode(): ListSortMode {
      return activeMode;
    },
  };
}
