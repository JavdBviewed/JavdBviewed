/**
 * @file dbMessageRouterFallbackMigrate.test.ts
 * @description 10-08 兜底补迁移：DB:VIEWED_FALLBACK_MIGRATE 路由测试
 *   复现场景 = flag(idb_migrated)=true + IDB viewed 空 + storage.local('viewed') 非空
 * @module tests/extension
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';

function viewedRecord(id: string) {
  return { id, title: id, status: 'viewed', createdAt: 1, updatedAt: 2 };
}

function mockIdb(overrides: { count?: number; bulkPut?: ReturnType<typeof vi.fn> }) {
  const viewedCount = vi.fn().mockResolvedValue(overrides.count ?? 0);
  const viewedBulkPut = overrides.bulkPut ?? vi.fn().mockResolvedValue(undefined);
  vi.doMock('../../apps/extension/src/platform/storage/indexedDb', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../apps/extension/src/platform/storage/indexedDb')>();
    return {
      ...actual,
      initDB: vi.fn(() => Promise.resolve({})),
      viewedCount,
      viewedBulkPut,
    };
  });
  return { viewedCount, viewedBulkPut };
}

async function invokeFallbackMigrate(): Promise<Record<string, any>> {
  const { registerDbMessageRouter } = await import('../../apps/extension/src/background/dbRouter');
  registerDbMessageRouter();

  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
  if (!listener) {
    throw new Error('DB message listener was not registered');
  }

  const response = await new Promise<Record<string, any>>((resolve) => {
    const asyncResult = listener(
      { type: 'DB:VIEWED_FALLBACK_MIGRATE' },
      {} as chrome.runtime.MessageSender,
      resolve,
    );
    expect(asyncResult).toBe(true);
  });
  return response;
}

describe('DB:VIEWED_FALLBACK_MIGRATE route（10-08 兜底补迁移）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('flag 已置 + IDB 空 + 老键非空 → 补迁移：bulkPut N 条、旗标在位、migrated=N', async () => {
    setChromeStorage({
      idb_migrated: true,
      viewed: { 'A-001': viewedRecord('A-001'), 'A-002': viewedRecord('A-002') },
    });
    const { viewedCount, viewedBulkPut } = mockIdb({ count: 0 });

    const response = await invokeFallbackMigrate();

    expect(viewedCount).toHaveBeenCalled();
    expect(viewedBulkPut).toHaveBeenCalledTimes(1);
    const put = viewedBulkPut.mock.calls[0][0] as Array<Record<string, any>>;
    expect(put.map((r) => r.id).sort()).toEqual(['A-001', 'A-002']);
    expect(put[0]).toMatchObject({ id: 'A-001', status: 'viewed' });
    expect(response).toEqual({ success: true, migrated: 2 });
    expect(getChromeStorageSnapshot().idb_migrated).toBe(true);
  });

  it('IDB 非空 → migrated=0，不读老键、不写入', async () => {
    setChromeStorage({
      idb_migrated: true,
      viewed: { 'POISON-1': viewedRecord('POISON-1') },
    });
    const { viewedBulkPut } = mockIdb({ count: 3 });

    const response = await invokeFallbackMigrate();

    expect(response).toEqual({ success: true, migrated: 0 });
    expect(viewedBulkPut).not.toHaveBeenCalled();
    // 「不读老键」= chrome.storage.local.get 从未触及 viewed 单键或分块键
    const gets = (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const viewedTouched = gets.some((call: unknown[]) => {
      const keys = call[0];
      const list: string[] = typeof keys === 'string'
        ? [keys]
        : Array.isArray(keys)
          ? [...keys]
          : keys && typeof keys === 'object'
            ? Object.keys(keys)
            : [];
      return list.some((k) => k === 'viewed' || k.startsWith('__chunk') || k.startsWith('__chunks_meta__'));
    });
    expect(viewedTouched).toBe(false);
  });

  it('IDB 与老键两空 → migrated=0，不 bulkPut、不写旗标（零副作用）', async () => {
    // beforeEach 已 reset storage：两空
    const { viewedBulkPut } = mockIdb({ count: 0 });

    const response = await invokeFallbackMigrate();

    expect(response).toEqual({ success: true, migrated: 0 });
    expect(viewedBulkPut).not.toHaveBeenCalled();
    expect(getChromeStorageSnapshot().idb_migrated).toBeUndefined();
  });

  it('补迁移写入异常 → success:false + error（响应契约不破）', async () => {
    setChromeStorage({
      idb_migrated: true,
      viewed: { 'X-001': viewedRecord('X-001') },
    });
    mockIdb({ count: 0, bulkPut: vi.fn().mockRejectedValue(new Error('bulk put exploded')) });

    const response = await invokeFallbackMigrate();

    expect(response.success).toBe(false);
    expect(String(response.error)).toContain('bulk put exploded');
  });
});
