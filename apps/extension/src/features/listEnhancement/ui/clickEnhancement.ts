/**
 * @file clickEnhancement.ts
 * @description clickEnhancement
 * @module features/listEnhancement
 */
import type { ListPreviewVideoInfo } from '../../previews';

export interface ListClickEnhancementOptions {
  videoInfo: ListPreviewVideoInfo;
  enableRightClickBackground: boolean;
  navigateTo: (url: string) => void;
  openFc2Dialog: (movieId: string, code: string, url: string) => Promise<void>;
  sendRuntimeMessage: (message: { type: string; url: string }) => Promise<unknown>;
  showToast: (message: string, type: 'success' | 'error') => void;
  openWindow: (url: string) => void;
  logger?: (...args: any[]) => void;
  now?: () => number;
  setTimeout?: (handler: () => void, timeout: number) => number;
}

export interface ListClickEnhancementDelegator {
  attach: (item: HTMLElement, options: ListClickEnhancementOptions) => void;
}

export function attachListClickEnhancement(item: HTMLElement, options: ListClickEnhancementOptions): void {
  const linkElement = item.querySelector('a[href*="/v/"]') as HTMLAnchorElement | null;
  if (!linkElement) return;

  linkElement.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleListItemClick(options);
  });

  if (options.enableRightClickBackground) {
    attachRightClickBackgroundOpen(linkElement, options);
  }
}

/**
 * Delegate card interactions to the list container. A large result page can
 * contain thousands of links; keeping three closures per link is unnecessary
 * and makes dynamic list updates expensive.
 */
export function createListClickEnhancementDelegator(): ListClickEnhancementDelegator {
  const linkStates = new WeakMap<HTMLAnchorElement, DelegatedLinkState>();
  const roots = new WeakSet<EventTarget>();

  const findLink = (root: EventTarget, target: EventTarget | null): HTMLAnchorElement | null => {
    if (!(target instanceof Element)) return null;
    const link = target.closest<HTMLAnchorElement>('a[href*="/v/"]');
    if (!link || !linkStates.has(link)) return null;
    if (root instanceof Element && !root.contains(link)) return null;
    if (root instanceof Document && !root.documentElement.contains(link)) return null;
    return link;
  };

  const installRootListeners = (root: EventTarget): void => {
    if (roots.has(root)) return;

    root.addEventListener('click', event => {
      const link = findLink(root, event.target);
      if (!link) return;
      const state = linkStates.get(link);
      if (!state) return;
      event.preventDefault();
      event.stopPropagation();
      void handleListItemClick(state.options);
    });
    root.addEventListener('mousedown', event => {
      const link = findLink(root, event.target);
      const state = link ? linkStates.get(link) : null;
      if (state) handleRightClick(state, event as MouseEvent, true);
    });
    root.addEventListener('contextmenu', event => {
      const link = findLink(root, event.target);
      const state = link ? linkStates.get(link) : null;
      if (state) handleRightClick(state, event as MouseEvent, false);
    });
    roots.add(root);
  };

  return {
    attach(item, options): void {
      const link = item.querySelector('a[href*="/v/"]') as HTMLAnchorElement | null;
      if (!link) return;
      linkStates.set(link, { options, rightClickHandled: false });
      const root = item.closest('.movie-list') || item.ownerDocument;
      installRootListeners(root);
    },
  };
}

export async function handleListItemClick(options: ListClickEnhancementOptions): Promise<void> {
  const { videoInfo } = options;

  if (!isFc2ListVideoCode(videoInfo.code)) {
    options.navigateTo(videoInfo.url);
    return;
  }

  options.logger?.(`[ListEnhancement] FC2 video detected: ${videoInfo.code}, opening FC2 dialog instead of navigating`);
  const movieId = extractMovieIdFromJavdbVideoUrl(videoInfo.url);
  if (!movieId) {
    options.logger?.('[ListEnhancement] Failed to extract movieId from URL:', videoInfo.url);
    options.showToast('无法解析FC2视频ID', 'error');
    return;
  }

  try {
    await options.openFc2Dialog(movieId, videoInfo.code, videoInfo.url);
  } catch (error) {
    options.logger?.('[ListEnhancement] Failed to open FC2 dialog:', error);
    options.showToast('FC2视频加载失败', 'error');
  }
}

export function isFc2ListVideoCode(code: string): boolean {
  return code.toUpperCase().includes('FC2') || code.toUpperCase().includes('FC2PPV');
}

export function extractMovieIdFromJavdbVideoUrl(url: string): string | null {
  return url.match(/\/v\/([^/?#]+)/)?.[1] || null;
}

interface DelegatedLinkState {
  options: ListClickEnhancementOptions;
  rightClickHandled: boolean;
}

function openRightClickTargetInBackground(state: DelegatedLinkState): void {
  const { options } = state;

  const openInBackground = () => {
    const startedAt = options.now?.() ?? performance.now();
    options.showToast('已在后台打开', 'success');

    void options.sendRuntimeMessage({
      type: 'OPEN_TAB_BACKGROUND',
      url: options.videoInfo.url,
    }).then(() => {
      const finishedAt = options.now?.() ?? performance.now();
      options.logger?.(`[ListEnhancement] Background tab opened in ${Math.round(finishedAt - startedAt)}ms`);
    }).catch(error => {
      options.logger?.('Failed to open background tab:', error);
      options.openWindow(options.videoInfo.url);
    });
  };

  openInBackground();
}

function handleRightClick(state: DelegatedLinkState, event: MouseEvent, shouldCheckButton: boolean): void {
  const { options } = state;
  if (!options.enableRightClickBackground) return;
  if (shouldCheckButton && event.button !== 2) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.rightClickHandled) return;

  state.rightClickHandled = true;
  openRightClickTargetInBackground(state);
  const setTimeout = options.setTimeout || window.setTimeout.bind(window);
  setTimeout(() => {
    state.rightClickHandled = false;
  }, 800);
}

function attachRightClickBackgroundOpen(linkElement: HTMLAnchorElement, options: ListClickEnhancementOptions): void {
  const state: DelegatedLinkState = { options, rightClickHandled: false };

  linkElement.addEventListener('mousedown', event => handleRightClick(state, event, true));
  linkElement.addEventListener('contextmenu', event => handleRightClick(state, event, false));
}
