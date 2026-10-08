/**
 * @file videoRecordSourceSaveNegative.test.ts
 * @description 10-08 负测：站点浏览保存路径（dataSync saveVideoRecord）源未知 →
 *  新记录不得携带 sourceType/sourceId 键（禁猜默认值，客户端计 skipped 是其侧口径）。
 *  锁住既有构造面零改动。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  dbViewedPut: vi.fn(async () => undefined),
  getValue: vi.fn(async () => ({})),
  setValue: vi.fn(async () => undefined),
}));

vi.mock('../../apps/extension/src/dashboard/dbClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, dbViewedPut: spies.dbViewedPut };
});

vi.mock('../../apps/extension/src/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({})),
    getValue: spies.getValue,
    setValue: spies.setValue,
  };
});

describe('dataSync saveVideoRecord：源未知零源字段（负测）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('站点浏览保存构造的 VideoRecord 不含 sourceType/sourceId 键', async () => {
    const { ApiClient } = await import('../../apps/extension/src/dashboard/dataSync/api');
    const client = new ApiClient() as unknown as {
      saveVideoRecord(videoId: string, videoData: Record<string, unknown>, status: string): Promise<void>;
    };

    await client.saveVideoRecord('abc123', { title: '站点浏览标题' }, 'viewed');

    expect(spies.dbViewedPut).toHaveBeenCalledTimes(1);
    const record = spies.dbViewedPut.mock.calls[0][0] as Record<string, unknown>;
    expect(record.id).toBe('abc123');
    expect(record.status).toBe('viewed');
    expect(record.title).toBe('站点浏览标题');
    expect('sourceType' in record).toBe(false);
    expect('sourceId' in record).toBe(false);
  });
});
