/**
 * @file dbRouterViewedTags.test.ts
 * @description DB:GET_ALL_TAGS route 测试
 * @module tests/extension
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DB:GET_ALL_TAGS route', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../../apps/extension/src/platform/storage/indexedDb');
  });

  it('builds tag stats from the viewedByTag index when viewed records have no tag fields', async () => {
    const viewedGetAll = vi.fn().mockResolvedValue([
      { id: 'SSIS-001', title: 'record without tags' },
    ]);
    const viewedTagIndexGetAll = vi.fn().mockResolvedValue([
      { key: '巨乳::SSIS-001', tag: '巨乳', videoId: 'SSIS-001' },
      { key: '中出::SSIS-001', tag: '中出', videoId: 'SSIS-001' },
      { key: '巨乳::SSIS-002', tag: '巨乳', videoId: 'SSIS-002' },
    ]);

    vi.doMock('../../apps/extension/src/platform/storage/indexedDb', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../apps/extension/src/platform/storage/indexedDb')>();
      return {
        ...actual,
        initDB: vi.fn(() => Promise.resolve({})),
        viewedGetAll,
        viewedTagIndexGetAll,
      };
    });

    const { registerDbMessageRouter } = await import('../../apps/extension/src/background/dbRouter');
    registerDbMessageRouter();

    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
    expect(listener).toBeTypeOf('function');

    const response = await new Promise<any>((resolve) => {
      const asyncResult = listener!(
        { type: 'DB:GET_ALL_TAGS', payload: { limit: 10 } },
        {} as chrome.runtime.MessageSender,
        resolve,
      );
      expect(asyncResult).toBe(true);
    });

    expect(response).toEqual({
      success: true,
      tags: [
        { name: '巨乳', count: 2 },
        { name: '中出', count: 1 },
      ],
    });
    expect(viewedGetAll).not.toHaveBeenCalled();
    expect(viewedTagIndexGetAll).toHaveBeenCalledTimes(1);
  });
});
