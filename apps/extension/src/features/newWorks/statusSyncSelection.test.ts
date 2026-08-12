import { describe, expect, it } from 'vitest';
import type { NewWorkRecord } from './types';
import type { VideoRecord } from '../../types';
import {
  buildViewedStatusMap,
  collectNewWorkMatchIds,
  getNewWorkMatchId,
} from './statusSyncSelection';

function work(overrides: Partial<NewWorkRecord>): NewWorkRecord {
  return {
    id: 'MISM-304',
    title: 'MISM-304 示例作品',
    actorId: 'actor-1',
    actorName: 'Actor',
    discoveredAt: 1,
    releaseDate: '',
    isRead: false,
    status: 'new',
    ...overrides,
  };
}

describe('new works status sync selection', () => {
  it('prefers the番号 extracted from the title when the title contains one', () => {
    expect(getNewWorkMatchId(work({ id: 'source-id', title: 'ABC-001 作品名' }))).toBe('ABC-001');
  });

  it('collects unique IDs so one batched query covers all new works', () => {
    const matches = collectNewWorkMatchIds([
      work({ id: 'one', title: 'ABC-001 作品' }),
      work({ id: 'two', title: 'ABC-001 另一部' }),
      work({ id: 'three', title: 'XYZ-002 作品' }),
    ]);

    expect([...matches.entries()]).toEqual([
      ['one', 'ABC-001'],
      ['two', 'ABC-001'],
      ['three', 'XYZ-002'],
    ]);
    expect(new Set(matches.values())).toEqual(new Set(['ABC-001', 'XYZ-002']));
  });

  it('builds a small status map instead of retaining full viewed records', () => {
    const records = [
      { id: 'ABC-001', status: 'viewed' },
      { id: 'XYZ-002', status: 'want' },
    ] as Array<Pick<VideoRecord, 'id' | 'status'>>;

    expect(buildViewedStatusMap(records)).toEqual(new Map([
      ['ABC-001', 'viewed'],
      ['XYZ-002', 'want'],
    ]));
  });
});
