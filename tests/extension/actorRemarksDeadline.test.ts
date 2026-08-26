/**
 * @file actorRemarksDeadline.test.ts
 * @description 演员备注获取截止时间（deadlineMs）行为测试
 * @module tests/extension
 */
import { describe, expect, it, vi } from 'vitest';

describe('actor remarks deadline', () => {
  it('clamps Wikipedia timeout to the remaining deadline budget and skips xslist when exhausted', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    // 模拟 Wikipedia 挂起：1200ms 后才失败，超过 deadline（1000ms）
    const getDocument = vi.fn(() => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('slow')), 1200)));

    vi.doMock('../../apps/extension/src/platform/network/httpClient', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../apps/extension/src/platform/network/httpClient')>();
      return {
        ...actual,
        defaultHttpClient: {
          getDocument,
        },
      };
    });

    try {
      const { actorExtraInfoService } = await import('../../apps/extension/src/features/actorRemarks');
      const pending = actorExtraInfoService.getActorRemarks('Alice', undefined, 1000);
      await vi.advanceTimersByTimeAsync(1500);
      await pending;

      // deadline 1000ms → wiki 单请求超时收缩为 min(6500, max(200, 剩余1000)) = 1000
      expect(getDocument).toHaveBeenNthCalledWith(1, 'https://ja.wikipedia.org/wiki/Alice', expect.objectContaining({
        timeout: 1000,
        retries: 0,
      }));
      // 剩余预算耗尽 → 不再发起 xslist 请求
      expect(getDocument).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    } finally {
      vi.useRealTimers();
      vi.doUnmock('../../apps/extension/src/platform/network/httpClient');
      vi.resetModules();
    }
  });

  it('keeps default timeouts when no deadline is given (dashboard metadata refresh path)', async () => {
    vi.resetModules();
    const getDocument = vi.fn().mockRejectedValue(new Error('blocked'));

    vi.doMock('../../apps/extension/src/platform/network/httpClient', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../apps/extension/src/platform/network/httpClient')>();
      return {
        ...actual,
        defaultHttpClient: {
          getDocument,
        },
      };
    });

    try {
      const { actorExtraInfoService } = await import('../../apps/extension/src/features/actorRemarks');
      await actorExtraInfoService.getActorRemarksWithDiagnostics('Alice');

      expect(getDocument).toHaveBeenNthCalledWith(1, 'https://ja.wikipedia.org/wiki/Alice', expect.objectContaining({
        timeout: 6500,
        retries: 0,
      }));
      expect(getDocument).toHaveBeenNthCalledWith(2, 'https://xslist.org/search?query=Alice&lg=zh', expect.objectContaining({
        timeout: 5000,
        retries: 0,
      }));
    } finally {
      vi.doUnmock('../../apps/extension/src/platform/network/httpClient');
      vi.resetModules();
    }
  });
});
