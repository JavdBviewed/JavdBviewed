/**
 * @file previewHoverController.ts
 * @description previewHoverController
 * @module features/listEnhancement
 */
import type {
  ListPreviewLoadOptions,
  ListPreviewPreferredSource,
  ListPreviewRuntimeSendMessage,
  ListPreviewVideoInfo,
} from '../../previews';

export interface PreviewHoverControllerOptions {
  window: Window;
  getPreviewDelay: () => number;
  getPreferredPreviewSource: () => ListPreviewPreferredSource;
  isScrolling: () => boolean;
  loadPreviewVideo: (
    coverElement: HTMLElement,
    videoInfo: ListPreviewVideoInfo,
    options: ListPreviewLoadOptions,
  ) => Promise<void>;
  activatePreviewVideoPreload: (video: HTMLVideoElement) => void;
  releasePreviewVideoMedia: (video: HTMLVideoElement) => void;
  runtimeSendMessage: ListPreviewRuntimeSendMessage;
}

export interface PreviewHoverController {
  attach: (coverElement: HTMLElement, videoInfo: ListPreviewVideoInfo) => void;
  show: (coverElement: HTMLElement, videoInfo: ListPreviewVideoInfo) => void;
  hide: (coverElement: HTMLElement) => void;
  load: (coverElement: HTMLElement, videoInfo: ListPreviewVideoInfo) => Promise<void>;
  getCurrentPlayingVideo: () => HTMLVideoElement | null;
}

export function createPreviewHoverController(options: PreviewHoverControllerOptions): PreviewHoverController {
  let previewTimer: number | null = null;
  let pendingCover: HTMLElement | null = null;
  let currentPlayingVideo: HTMLVideoElement | null = null;
  let currentPlayingCover: HTMLElement | null = null;
  const coverVideoInfo = new WeakMap<HTMLElement, ListPreviewVideoInfo>();
  const delegatedRoots = new WeakSet<EventTarget>();

  const findAttachedCover = (root: EventTarget, target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) {
      return null;
    }

    const cover = target.closest<HTMLElement>('.cover.x-preview');
    if (!cover || !coverVideoInfo.has(cover)) {
      return null;
    }

    if (root instanceof Element && !root.contains(cover)) {
      return null;
    }
    if (root instanceof Document && !root.documentElement.contains(cover)) {
      return null;
    }
    return cover;
  };

  const handleMouseOver = (root: EventTarget, event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const cover = findAttachedCover(root, mouseEvent.target);
    if (!cover) return;

    const relatedTarget = mouseEvent.relatedTarget as Node | null;
    if (relatedTarget && cover.contains(relatedTarget)) return;
    if (options.isScrolling()) return;

    const videoInfo = coverVideoInfo.get(cover);
    if (videoInfo) show(cover, videoInfo);
  };

  const handleMouseOut = (root: EventTarget, event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const cover = findAttachedCover(root, mouseEvent.target);
    if (!cover) return;

    const relatedTarget = mouseEvent.relatedTarget as Node | null;
    if (relatedTarget && cover.contains(relatedTarget)) return;
    hide(cover);
  };

  const ensureDelegatedListeners = (root: EventTarget): void => {
    if (delegatedRoots.has(root)) return;
    root.addEventListener('mouseover', event => handleMouseOver(root, event));
    root.addEventListener('mouseout', event => handleMouseOut(root, event));
    delegatedRoots.add(root);
  };

  const showExistingVideo = (coverElement: HTMLElement): boolean => {
    const existingVideo = coverElement.querySelector('video');
    if (!existingVideo) {
      return false;
    }

    existingVideo.style.opacity = '1';
    options.activatePreviewVideoPreload(existingVideo);
    existingVideo.play().catch(() => {});
    currentPlayingVideo = existingVideo;
    currentPlayingCover = coverElement;
    return true;
  };

  const load = async (coverElement: HTMLElement, videoInfo: ListPreviewVideoInfo): Promise<void> => {
    if (!coverElement.classList.contains('x-holding')) {
      return;
    }

    if (showExistingVideo(coverElement)) {
      return;
    }

    await options.loadPreviewVideo(coverElement, videoInfo, {
      preferredPreviewSource: options.getPreferredPreviewSource(),
      runtimeSendMessage: options.runtimeSendMessage,
      onVideoCreated: (video) => {
        currentPlayingVideo = video;
        currentPlayingCover = coverElement;
      },
    });
  };

  const show = (coverElement: HTMLElement, videoInfo: ListPreviewVideoInfo): void => {
    coverElement.classList.add('x-holding');

    if (currentPlayingCover && currentPlayingCover !== coverElement) {
      hide(currentPlayingCover);
    }
    if (pendingCover && pendingCover !== coverElement) {
      hide(pendingCover);
    }

    const delay = Number(options.getPreviewDelay() || 0);
    if (delay <= 0) {
      coverElement.classList.remove('x-holding');
      return;
    }

    if (currentPlayingVideo?.parentElement) {
      currentPlayingVideo.pause();
      currentPlayingVideo.style.opacity = '0';
    }

    if (showExistingVideo(coverElement)) {
      return;
    }

    if (previewTimer) {
      options.window.clearTimeout(previewTimer);
      previewTimer = null;
    }
    pendingCover = coverElement;
    previewTimer = options.window.setTimeout(() => {
      previewTimer = null;
      if (pendingCover === coverElement) pendingCover = null;
      void load(coverElement, videoInfo);
    }, delay < 100 ? 100 : delay);
  };

  const hide = (coverElement: HTMLElement): void => {
    coverElement.classList.remove('x-holding');

    if (previewTimer) {
      options.window.clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (pendingCover === coverElement) pendingCover = null;

    const video = coverElement.querySelector('video');
    if (!video) return;

    video.style.opacity = '0';
    video.pause();
    options.releasePreviewVideoMedia(video);

    if (currentPlayingVideo === video) {
      currentPlayingVideo = null;
      currentPlayingCover = null;
    }
    video.remove();
  };

  const attach = (coverElement: HTMLElement, videoInfo: ListPreviewVideoInfo): void => {
    coverElement.classList.add('x-cover', 'x-preview');
    coverVideoInfo.set(coverElement, videoInfo);
    const root = coverElement.closest('.movie-list') || coverElement.ownerDocument;
    ensureDelegatedListeners(root);
  };

  return {
    attach,
    show,
    hide,
    load,
    getCurrentPlayingVideo: () => currentPlayingVideo,
  };
}
