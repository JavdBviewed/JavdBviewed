import type { VideoRecord } from '../../types';
import type { NewWorkRecord } from './types';

export type ViewedStatusRecord = Pick<VideoRecord, 'id' | 'status'>;

export function getNewWorkMatchId(work: Pick<NewWorkRecord, 'id' | 'title'>): string {
  const codeMatch = work.title?.match(/^([A-Z]+-\d+)/);
  return codeMatch?.[1] ?? work.id;
}

export function collectNewWorkMatchIds(
  works: readonly Pick<NewWorkRecord, 'id' | 'title'>[],
): Map<string, string> {
  return new Map(works.map((work) => [work.id, getNewWorkMatchId(work)]));
}

export function buildViewedStatusMap(
  records: readonly ViewedStatusRecord[],
): Map<string, VideoRecord['status']> {
  return new Map(records
    .filter((record) => Boolean(record?.id))
    .map((record) => [record.id, record.status]));
}
