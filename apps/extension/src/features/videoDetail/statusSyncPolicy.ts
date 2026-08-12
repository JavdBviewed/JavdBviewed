/**
 * @file statusSyncPolicy.ts
 * @description Details-page status reconciliation and scoped mutation filtering.
 */
import { VIDEO_STATUS } from '../../utils/config';

type VideoStatus = typeof VIDEO_STATUS[keyof typeof VIDEO_STATUS];

/**
 * The source page only has authority when it explicitly exposes a watched or
 * want-to-watch state. A missing marker may be caused by a delayed page update
 * or by an extension-owned status update, so it cannot downgrade local data.
 */
export function resolveLibraryStatusFromPageStatus(
  currentLibraryStatus: VideoStatus | string | undefined,
  detectedPageStatus: VideoStatus | null,
  allowExplicitClear = false,
): VideoStatus | null {
  if (detectedPageStatus === VIDEO_STATUS.VIEWED || detectedPageStatus === VIDEO_STATUS.WANT) {
    return detectedPageStatus;
  }

  if (
    allowExplicitClear
    && !detectedPageStatus
    && (currentLibraryStatus === VIDEO_STATUS.VIEWED || currentLibraryStatus === VIDEO_STATUS.WANT)
  ) {
    return VIDEO_STATUS.BROWSED;
  }

  return null;
}

/** Only status-control DOM changes may schedule a status reconciliation. */
export function isRelevantStatusMutation(target: Node | null, statusControls: Element | null): boolean {
  return !!target && !!statusControls && (target === statusControls || statusControls.contains(target));
}
