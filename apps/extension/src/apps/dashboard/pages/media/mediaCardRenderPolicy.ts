import type { MediaBrowseItem, MediaCoverViewMode, MediaViewSettings } from './mediaBrowseModel';

export type MediaCardRenderProps = {
  item: MediaBrowseItem;
  usingPreview: boolean;
  coverView: MediaCoverViewMode;
  viewSettings: MediaViewSettings;
  onWatchChanged?: () => void;
  onEnqueuedCleanup?: () => void;
  onPlayItem?: (item: MediaBrowseItem) => void;
  onOpenDetail?: (item: MediaBrowseItem) => void;
};

export type ResumeMediaCardRenderProps = {
  item: MediaBrowseItem;
  onPlay: (item: MediaBrowseItem, resumeSec: number) => void;
};

export type MediaHeroCardRenderProps = {
  item: MediaBrowseItem;
  virtualIndex: number;
  itemIndex: number;
  position: number;
  coverView: MediaCoverViewMode;
  usingPreview: boolean;
  onSetHeroStep: (step: number) => void;
  onRequestPlayback: (item: MediaBrowseItem) => void;
  onOpenDetail: (item: MediaBrowseItem) => void;
};

/**
 * 父页面打开详情、播放器或工具面板时，卡片输入通常没有变化。
 * 只比较卡片真正依赖的引用，避免这些页面状态变化触发整批卡片重绘。
 */
export function areMediaCardPropsEqual(
  previous: MediaCardRenderProps,
  next: MediaCardRenderProps,
): boolean {
  return previous.item === next.item
    && previous.usingPreview === next.usingPreview
    && previous.coverView === next.coverView
    && previous.viewSettings === next.viewSettings
    && previous.onWatchChanged === next.onWatchChanged
    && previous.onEnqueuedCleanup === next.onEnqueuedCleanup
    && previous.onPlayItem === next.onPlayItem
    && previous.onOpenDetail === next.onOpenDetail;
}

export function areResumeMediaCardPropsEqual(
  previous: ResumeMediaCardRenderProps,
  next: ResumeMediaCardRenderProps,
): boolean {
  return previous.item === next.item && previous.onPlay === next.onPlay;
}

export function areMediaHeroCardPropsEqual(
  previous: MediaHeroCardRenderProps,
  next: MediaHeroCardRenderProps,
): boolean {
  return previous.item === next.item
    && previous.virtualIndex === next.virtualIndex
    && previous.itemIndex === next.itemIndex
    && previous.position === next.position
    && previous.coverView === next.coverView
    && previous.usingPreview === next.usingPreview
    && previous.onSetHeroStep === next.onSetHeroStep
    && previous.onRequestPlayback === next.onRequestPlayback
    && previous.onOpenDetail === next.onOpenDetail;
}
