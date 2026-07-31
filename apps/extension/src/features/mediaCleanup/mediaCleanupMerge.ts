import { STORAGE_KEYS } from '../../utils/config';
import {
  mergeMediaCleanupStates,
  mergeMediaDeletionHistories,
  type MediaCleanupState,
  type MediaDeletionHistoryState,
} from './mediaCleanupModel';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMediaCleanupState(value: unknown): value is MediaCleanupState {
  if (!isRecord(value)) return false;
  return value.version === 1
    && isRecord(value.items)
    && Array.isArray(value.observedWatchedCopyIds)
    && typeof value.updatedAt === 'number';
}

function isMediaDeletionHistory(value: unknown): value is MediaDeletionHistoryState {
  if (!isRecord(value)) return false;
  return value.version === 1
    && isRecord(value.records)
    && typeof value.updatedAt === 'number';
}

export function mergeMediaCleanupStorageValue(
  key: string,
  localValue: unknown,
  remoteValue: unknown,
): unknown {
  if (key === STORAGE_KEYS.MEDIA_CLEANUP_STATE) {
    if (!isMediaCleanupState(remoteValue)) return localValue;
    return isMediaCleanupState(localValue)
      ? mergeMediaCleanupStates(localValue, remoteValue)
      : remoteValue;
  }
  if (key === STORAGE_KEYS.MEDIA_DELETION_HISTORY) {
    if (!isMediaDeletionHistory(remoteValue)) return localValue;
    return isMediaDeletionHistory(localValue)
      ? mergeMediaDeletionHistories(localValue, remoteValue)
      : remoteValue;
  }
  return remoteValue;
}
