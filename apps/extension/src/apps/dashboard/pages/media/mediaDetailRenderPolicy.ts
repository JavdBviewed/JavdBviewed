import type { MediaItemDetailPanelProps } from './MediaItemDetailPanel';

/**
 * 详情面板只依赖影片对象和交互回调；父页面目录刷新时保留稳定输入即可跳过整块详情重绘。
 */
export function areMediaDetailPanelPropsEqual(
  previous: MediaItemDetailPanelProps,
  next: MediaItemDetailPanelProps,
): boolean {
  return previous.item === next.item
    && previous.onPlay === next.onPlay
    && previous.onPlayCopy === next.onPlayCopy
    && previous.onClose === next.onClose
    && previous.onOpenItem === next.onOpenItem
    && previous.onWatchChanged === next.onWatchChanged;
}
