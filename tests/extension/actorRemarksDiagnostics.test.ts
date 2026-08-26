/**
 * @file actorRemarksDiagnostics.test.ts
 * @description actor remarks diagnostics 测试
 * @module tests/extension
 */
import { describe, expect, it, vi } from 'vitest';
import { NetworkError } from '../../apps/extension/src/platform/network/httpClient';

describe('actor remarks diagnostics', () => {
  it('preserves Wikipedia and xslist HTTP failures for actor metadata refresh', async () => {
    vi.resetModules();
    const getDocument = vi.fn()
      .mockRejectedValueOnce(new NetworkError('HTTP 404', 'https://ja.wikipedia.org/wiki/Alice', 404))
      .mockRejectedValueOnce(new NetworkError('HTTP 403', 'https://xslist.org/search?query=Alice&lg=zh', 403));

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
      const result = await actorExtraInfoService.getActorRemarksWithDiagnostics('Alice');

      expect(result.data).toBeNull();
      expect(result.failures).toEqual([
        {
          source: 'wikipedia',
          message: 'HTTP 404',
          statusCode: 404,
          url: 'https://ja.wikipedia.org/wiki/Alice',
        },
        {
          source: 'xslist',
          message: 'HTTP 403',
          statusCode: 403,
          url: 'https://xslist.org/search?query=Alice&lg=zh',
          reason: 'cloudflare_challenge',
        },
      ]);
      expect(getDocument).toHaveBeenNthCalledWith(2, 'https://xslist.org/search?query=Alice&lg=zh', expect.objectContaining({
        retries: 0,
        referrer: 'https://xslist.org/',
      }));
      // Wikipedia 单次尝试：重试会放大挂起场景下的整体耗时，必须 retries:0
      expect(getDocument).toHaveBeenNthCalledWith(1, 'https://ja.wikipedia.org/wiki/Alice', expect.objectContaining({
        retries: 0,
        timeout: 6500,
      }));
    } finally {
      vi.doUnmock('../../apps/extension/src/platform/network/httpClient');
      vi.resetModules();
    }
  });
});
