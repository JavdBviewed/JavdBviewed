import type { VideoRecord } from '../../types';

export const MEDIA_METADATA_FIELDS = [
  'title', 'releaseDate', 'javdbUrl', 'javdbImage', 'coverImage', 'tags', 'actors', 'genres',
  'categories', 'duration', 'director', 'maker', 'publisher', 'series', 'rating', 'ratingCount',
] as const;
export type MediaRecordMetadata = Partial<Pick<VideoRecord, typeof MEDIA_METADATA_FIELDS[number]>>;

/** Merge against the latest transaction value, never an obsolete pre-fetch snapshot. */
export function mergeMediaRecordMetadata(current: VideoRecord, before: VideoRecord, metadata: MediaRecordMetadata, now: number): VideoRecord {
  if (current.deletedAt) throw new Error('影片已移入回收站，已停止补全');
  if (!current.id.startsWith('media:') || current.id !== before.id || current.videoCode !== before.videoCode) {
    throw new Error('影片番号已变更，请重新同步这条资料');
  }
  const next = { ...current };
  const locked = new Set(current.manuallyEditedFields || []);
  for (const field of MEDIA_METADATA_FIELDS) {
    const value = metadata[field];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (locked.has(field) || JSON.stringify(current[field]) !== JSON.stringify(before[field])) continue;
    Object.assign(next, { [field]: value });
  }
  next.updatedAt = now;
  return next;
}
