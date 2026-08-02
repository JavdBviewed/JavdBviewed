import { describe, expect, it, vi } from 'vitest';
import type { VideoRecord } from '../../../types';
import {
  processBatchImportItem,
  type BatchImportDependencies,
} from './batchImportService';

function record(partial: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: partial.id || 'ABC-001',
    title: partial.title || '旧标题',
    status: partial.status || 'viewed',
    tags: partial.tags || ['旧标签'],
    userTags: partial.userTags || [],
    userRating: partial.userRating,
    createdAt: partial.createdAt || 1,
    updatedAt: partial.updatedAt || 2,
    ...partial,
  };
}

function dependencies(overrides: Partial<BatchImportDependencies> = {}): BatchImportDependencies {
  return {
    findExactMatch: vi.fn(async () => null),
    fetchMatchMetadata: vi.fn(async () => ({})),
    getRecord: vi.fn(async () => undefined),
    putRecord: vi.fn(async () => undefined),
    now: () => 100,
    ...overrides,
  };
}

describe('records batch import service', () => {
  it('directly creates a favorite placeholder without network calls', async () => {
    const deps = dependencies();
    const result = await processBatchImportItem('ABC-001', 'direct-import', ['待补全'], deps);

    expect(result.status).toBe('placeholder');
    expect(deps.findExactMatch).not.toHaveBeenCalled();
    expect(deps.fetchMatchMetadata).not.toHaveBeenCalled();
    expect(deps.putRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ABC-001',
      title: 'ABC-001',
      isFavorite: true,
      userTags: ['待补全'],
    }));
  });

  it('search-only returns a match without writing local records', async () => {
    const deps = dependencies({
      findExactMatch: vi.fn(async () => ({ href: 'https://javdb.com/v/abc', title: '匹配标题' })),
    });
    const result = await processBatchImportItem('ABC-001', 'search-only', [], deps);

    expect(result.status).toBe('matched');
    expect(result.title).toBe('匹配标题');
    expect(deps.getRecord).not.toHaveBeenCalled();
    expect(deps.putRecord).not.toHaveBeenCalled();
  });

  it('search-import enriches an existing record while preserving user fields', async () => {
    const existing = record({ userRating: 4, userNotes: '保留' });
    const deps = dependencies({
      findExactMatch: vi.fn(async () => ({ href: 'https://javdb.com/v/abc', title: '新标题' })),
      fetchMatchMetadata: vi.fn(async () => ({
        javdbUrl: 'https://javdb.com/v/abc',
        javdbImage: 'https://img.test/abc.jpg',
        tags: ['新标签'],
      })),
      getRecord: vi.fn(async () => existing),
    });

    const result = await processBatchImportItem('ABC-001', 'search-import', ['精选'], deps);

    expect(result.status).toBe('imported');
    expect(deps.putRecord).toHaveBeenCalledWith(expect.objectContaining({
      title: '新标题',
      tags: ['新标签'],
      userTags: ['精选'],
      isFavorite: true,
      userRating: 4,
      userNotes: '保留',
    }));
  });

  it('keeps an unmatched number as a local placeholder in search-import mode', async () => {
    const deps = dependencies();
    const result = await processBatchImportItem('ABC-001', 'search-import', [], deps);

    expect(result.status).toBe('placeholder');
    expect(deps.putRecord).toHaveBeenCalledWith(expect.objectContaining({
      title: 'ABC-001',
      isFavorite: true,
    }));
  });
});
