import { describe, expect, it } from 'vitest';
import type { VideoRecord } from '../../../types';
import {
  buildImportedRecord,
  normalizeBatchNumbers,
  mergeUserTags,
} from './batchImportModel';

describe('records batch import model', () => {
  it('normalizes separators, full-width hyphens, case, and duplicate numbers', () => {
    expect(normalizeBatchNumbers('abc-001\n MISM－304, xyz 002\n\nMISM 304')).toEqual([
      { code: 'ABC-001', sourceText: 'abc-001', status: 'ready' },
      { code: 'MISM-304', sourceText: 'MISM－304', status: 'ready' },
      { code: 'XYZ-002', sourceText: 'xyz 002', status: 'ready' },
      { code: 'MISM-304', sourceText: 'MISM 304', status: 'duplicate' },
    ]);
  });

  it('marks repeated numbers without sending them to the importer twice', () => {
    const result = normalizeBatchNumbers('ABC-001\nABC-001\nabc001');

    expect(result).toEqual([
      { code: 'ABC-001', sourceText: 'ABC-001', status: 'ready' },
      { code: 'ABC-001', sourceText: 'ABC-001', status: 'duplicate' },
      { code: 'ABC-001', sourceText: 'abc001', status: 'duplicate' },
    ]);
  });

  it('marks empty or clearly invalid input instead of creating a record', () => {
    expect(normalizeBatchNumbers('\nnot valid!\n---')).toEqual([
      { code: '', sourceText: 'not valid!', status: 'invalid' },
      { code: '', sourceText: '---', status: 'invalid' },
    ]);
  });

  it('merges local user tags without touching scraped tags', () => {
    const record: VideoRecord = {
      id: 'ABC-001',
      title: '标题',
      status: 'viewed',
      tags: ['中文字幕'],
      userTags: ['待整理'],
      isFavorite: false,
      userRating: 4,
      userNotes: '保留',
      createdAt: 1,
      updatedAt: 2,
    };

    const updated = buildImportedRecord(record, {
      code: 'ABC-001',
      title: '新标题',
      isFavorite: true,
      userTags: ['待整理', '精选'],
      now: 100,
    });

    expect(updated).toEqual(expect.objectContaining({
      id: 'ABC-001',
      title: '新标题',
      tags: ['中文字幕'],
      userTags: ['待整理', '精选'],
      isFavorite: true,
      userRating: 4,
      userNotes: '保留',
      updatedAt: 100,
    }));
  });

  it('trims and deduplicates local user tags', () => {
    expect(mergeUserTags(['精选', ' 待整理 '], ['精选', '新片', ''])).toEqual([
      '精选',
      '待整理',
      '新片',
    ]);
  });
});
