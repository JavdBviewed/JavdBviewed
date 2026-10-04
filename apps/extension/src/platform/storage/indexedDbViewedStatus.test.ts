import { beforeEach, describe, expect, it, vi } from 'vitest';

const initDB = vi.fn();

vi.mock('./indexedDbConnection', () => ({
  initDB,
  resetDBConnection: vi.fn(),
}));

function makeDb(keys: string[], records: Record<string, { id: string; status: string; isFavorite?: boolean; deletedAt?: number | null }>) {
  return {
    getAllKeys: vi.fn(async (store: string) => {
      expect(store).toBe('viewedRecords');
      return keys;
    }),
    get: vi.fn(async (store: string, key: unknown) => {
      expect(store).toBe('viewedRecords');
      return records[key as string] ?? undefined;
    }),
  };
}

describe('viewedStatusGetManyFolded', () => {
  beforeEach(() => {
    vi.resetModules();
    initDB.mockReset();
  });

  it('折叠命中：原键取真实状态，summary.id 回传查询键（原文大小写）', async () => {
    initDB.mockResolvedValue(makeDb(['RKPRIME.26.10.01'], {
      'RKPRIME.26.10.01': { id: 'RKPRIME.26.10.01', status: 'browsed', isFavorite: false },
    }));
    const { viewedStatusGetManyFolded } = await import('./indexedDbViewedStatus');
    const out = await viewedStatusGetManyFolded(['rkprime.26.10.01', 'RKPrime.26.10.01']);
    expect(out).toEqual([
      { id: 'rkprime.26.10.01', status: 'browsed', isFavorite: false },
      { id: 'RKPrime.26.10.01', status: 'browsed', isFavorite: false },
    ]);
  });

  it('双键冲突取首：大小写差异双键时取 getAllKeys 顺序首个原键', async () => {
    initDB.mockResolvedValue(makeDb(['AB.1.1', 'ab.1.1'], {
      'AB.1.1': { id: 'AB.1.1', status: 'viewed', isFavorite: true },
      'ab.1.1': { id: 'ab.1.1', status: 'want', isFavorite: false },
    }));
    const { viewedStatusGetManyFolded } = await import('./indexedDbViewedStatus');
    const out = await viewedStatusGetManyFolded(['Ab.1.1']);
    expect(out).toEqual([{ id: 'Ab.1.1', status: 'viewed', isFavorite: true }]);
  });

  it('miss 无折叠命中：不返回摘要、不取记录、不抛错', async () => {
    const db = makeDb(['SSIS-001'], { 'SSIS-001': { id: 'SSIS-001', status: 'viewed', isFavorite: false } });
    initDB.mockResolvedValue(db);
    const { viewedStatusGetManyFolded } = await import('./indexedDbViewedStatus');
    const out = await viewedStatusGetManyFolded(['ZZ.9.9', '']);
    expect(out).toEqual([]);
    expect(db.get).not.toHaveBeenCalled();
  });
});
