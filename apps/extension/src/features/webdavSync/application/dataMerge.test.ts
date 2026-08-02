import { describe, expect, it } from 'vitest';
import { mergeData } from './dataMerge';
import { analyzeDataDifferences, type DataDiffResult } from './dataDiff';
import type { VideoRecord } from '../../../types';

function createRecord(partial: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: 'ABC-001',
    title: '标题',
    status: 'browsed',
    createdAt: 1,
    updatedAt: 2,
    ...partial,
  };
}

function createDiff(local: VideoRecord, cloud: VideoRecord): DataDiffResult {
  return {
    videoRecords: {
      cloudOnly: [],
      localOnly: [],
      conflicts: [{
        id: local.id,
        local,
        cloud,
        differences: ['userTags', 'updatedAt'],
        recommendation: 'merge',
      }],
      identical: [],
      summary: {
        cloudOnlyCount: 0,
        localOnlyCount: 0,
        conflictCount: 1,
        identicalCount: 0,
        totalLocal: 1,
        totalCloud: 1,
      },
    },
    actorRecords: {
      cloudOnly: [],
      localOnly: [],
      conflicts: [],
      identical: [],
      summary: { cloudOnlyCount: 0, localOnlyCount: 0, conflictCount: 0, identicalCount: 0, totalLocal: 0, totalCloud: 0 },
    },
    settings: { hasConflict: false, differences: [] },
    userProfile: { hasConflict: false, differences: [] },
    logs: { hasData: false, cloudCount: 0, localCount: 0 },
    importStats: { hasData: false },
    newWorks: {
      subscriptions: { cloudOnly: {}, localOnly: {}, conflicts: [], identical: {}, summary: { cloudOnlyCount: 0, localOnlyCount: 0, conflictCount: 0, identicalCount: 0, totalLocal: 0, totalCloud: 0 } },
      records: { cloudOnly: {}, localOnly: {}, conflicts: [], identical: {}, summary: { cloudOnlyCount: 0, localOnlyCount: 0, conflictCount: 0, identicalCount: 0, totalLocal: 0, totalCloud: 0 } },
      config: { hasConflict: false, differences: [] },
    },
  };
}

describe('WebDAV video record merge', () => {
  it('detects changes to local user tags as a record conflict', () => {
    const local = createRecord({ userTags: ['本机收藏'], updatedAt: 10 });
    const cloud = createRecord({ userTags: ['云端收藏'], updatedAt: 10 });
    const diff = analyzeDataDifferences(
      { viewedRecords: { [local.id]: local } },
      { data: { [cloud.id]: cloud } },
    );

    expect(diff.videoRecords.conflicts[0]?.differences).toContain('userTags');
  });

  it('unions local user tags instead of replacing them with cloud tags', () => {
    const local = createRecord({ userTags: ['本机收藏'], updatedAt: 10 });
    const cloud = createRecord({ userTags: ['云端收藏'], updatedAt: 20 });

    const result = mergeData(
      { viewedRecords: { [local.id]: local } },
      { data: { [cloud.id]: cloud } },
      createDiff(local, cloud),
      {
        strategy: 'smart',
        restoreRecords: true,
        restoreSettings: false,
        restoreUserProfile: false,
        restoreActorRecords: false,
        restoreLogs: false,
        restoreImportStats: false,
      },
    );

    expect(result.mergedData.videoRecords?.[local.id].userTags).toEqual(['本机收藏', '云端收藏']);
  });
});
