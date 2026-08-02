import type { VideoRecord } from '../../../types';

export interface ExecuteRecordsBatchAddTagsInput {
  videoIds: string[];
  newTags: string[];
  getVisibleRecords: () => VideoRecord[];
  getRecordById: (id: string) => Promise<VideoRecord | undefined>;
  putRecord: (record: VideoRecord) => Promise<unknown>;
  now?: () => number;
}

export interface ExecuteRecordsBatchAddTagsResult {
  successCount: number;
  failCount: number;
}

export async function executeRecordsBatchAddTags(
  input: ExecuteRecordsBatchAddTagsInput,
): Promise<ExecuteRecordsBatchAddTagsResult> {
  const now = input.now || Date.now;
  let successCount = 0;
  let failCount = 0;

  for (const id of input.videoIds) {
    try {
      const visibleRecords = input.getVisibleRecords();
      let record = visibleRecords.find(item => item.id === id);
      if (!record) {
        record = await input.getRecordById(id);
      }
      if (!record) {
        failCount++;
        continue;
      }

      const existingUserTags = new Set<string>(Array.isArray(record.userTags) ? record.userTags : []);
      input.newTags
        .map(tag => String(tag).trim())
        .filter(Boolean)
        .forEach(tag => existingUserTags.add(tag));

      const updated: VideoRecord = {
        ...record,
        userTags: Array.from(existingUserTags),
        updatedAt: now(),
      };

      await input.putRecord(updated);

      record.userTags = updated.userTags;
      record.updatedAt = updated.updatedAt;

      successCount++;
    } catch {
      failCount++;
    }
  }

  return { successCount, failCount };
}
