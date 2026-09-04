import { describe, expect, it, vi } from 'vitest';
import type { EmbyMediaServer } from '../../embyLibrary/types';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';
import { deleteMediaCleanupCopy } from './mediaCleanupDelete';

const NOW = 1757102235179;

function embyServer(partial: Partial<EmbyMediaServer>): EmbyMediaServer {
  return {
    id: 'emby-134',
    type: 'emby',
    name: 'Emby-134',
    url: 'http://emby.example.local',
    apiKey: 'read-only-key',
    enabled: true,
    ...partial,
  };
}

/**
 * 多来源（115 + Emby）删除失败路径的 mock 复现。
 * 全部使用注入式 mock（fetchImpl / deleteDrive115File / getSettings），不触碰真实 API。
 */
describe('mediaCleanupDelete: multi-source failure paths (mock)', () => {
  it('115 副本缺少 fileId（只有 pickCode）→ 明确失败原因', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: '115:pick-only',
      source: '115',
      pickCode: 'pick-only',
      lastFoundAt: NOW,
    };
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({}),
      fetchImpl: fetch,
      deleteDrive115File: vi.fn(async () => {
        throw new Error('不应被调用');
      }),
    });
    expect(result).toEqual({ ok: false, message: '缺少 115 file_id，无法删除' });
  });

  it('115 open API 返回权限不足 → 透传 API 的错误消息', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: '115:file-1',
      source: '115',
      fileId: 'file-1',
      lastFoundAt: NOW,
    };
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({}),
      fetchImpl: fetch,
      deleteDrive115File: async () => ({ ok: false, message: '删除失败 (403): 无删除权限' }),
    });
    expect(result).toEqual({ ok: false, message: '删除失败 (403): 无删除权限' });
  });

  it('115 凭证不可用（token 过期）→ 透传凭证错误', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: '115:file-1',
      source: '115',
      fileId: 'file-1',
      lastFoundAt: NOW,
    };
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({}),
      fetchImpl: fetch,
      deleteDrive115File: async () => ({ ok: false, message: '115 凭证不可用' }),
    });
    expect(result).toEqual({ ok: false, message: '115 凭证不可用' });
  });

  it('Emby 副本的服务器已从设置中移除（URL 不匹配）→ 失败且不发请求', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: 'emby:http://emby.example.local:item-9',
      source: 'emby',
      serverName: 'Emby-134',
      serverUrl: 'http://emby.example.local',
      itemId: 'item-9',
      lastFoundAt: NOW,
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({
        emby: { mediaServers: [embyServer({ url: 'http://other.example.local' })] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result).toEqual({ ok: false, message: '对应媒体服务器配置已不存在' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Emby 服务器只配了只读 apiKey 时 DELETE 403 → 权限类失败原因', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: 'emby:http://emby.example.local:item-9',
      source: 'emby',
      serverName: 'Emby-134',
      serverUrl: 'http://emby.example.local',
      itemId: 'item-9',
      lastFoundAt: NOW,
    };
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 403 }));
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({ emby: { mediaServers: [embyServer({})] } }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    // 删除前探测先拿到 403 → 明确报凭证/权限问题，且不发出 DELETE
    expect(result).toEqual({
      ok: false,
      message: '删除前校验失败：媒体服务器凭证均无效（Emby Emby-134，item=item-9）：API Key HTTP 403，请检查服务器设置中的账号 / API 密钥',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://emby.example.local/Items?Ids=item-9&api_key=read-only-key',
      expect.objectContaining({}),
    );
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain('DELETE');
  });

  it('Emby DELETE 401（accessToken 失效）→ 权限类失败原因', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: 'jellyfin:http://jf.example.local:item-9',
      source: 'jellyfin',
      serverName: 'JF-1',
      serverUrl: 'http://jf.example.local',
      itemId: 'item-9',
      lastFoundAt: NOW,
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({
        emby: {
          mediaServers: [
            {
              id: 'jf-1',
              type: 'jellyfin',
              name: 'JF-1',
              url: 'http://jf.example.local',
              apiKey: '',
              enabled: true,
              username: 'u',
              password: 'p',
              accessToken: 'expired-token',
              userId: 'user-1',
            },
          ],
        },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      '删除前校验失败：媒体服务器凭证均无效（Jellyfin JF-1，item=item-9）：用户令牌（u） HTTP 401，请检查服务器设置中的账号 / API 密钥',
    );
    // 探测走 GET /Users/{uid}/Items/{id}（令牌头鉴权）；未发出 DELETE
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://jf.example.local/Users/user-1/Items/item-9',
      expect.objectContaining({}),
    );
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain('DELETE');
  });

  it('Emby DELETE 网络异常 → 透传网络错误消息', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: 'emby:http://emby.example.local:item-9',
      source: 'emby',
      serverName: 'Emby-134',
      serverUrl: 'http://emby.example.local',
      itemId: 'item-9',
      lastFoundAt: NOW,
    };
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({ emby: { mediaServers: [embyServer({})] } }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result).toEqual({ ok: false, message: '删除请求失败：Failed to fetch（Emby Emby-134，已尝试 API Key）' });
  });

  it('Emby DELETE 404（文件已不存在）→ 按删除成功处理', async () => {
    const copy: MediaCleanupCopySnapshot = {
      copyId: 'emby:http://emby.example.local:item-9',
      source: 'emby',
      serverName: 'Emby-134',
      serverUrl: 'http://emby.example.local',
      itemId: 'item-9',
      lastFoundAt: NOW,
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({ emby: { mediaServers: [embyServer({})] } }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result).toEqual({ ok: true, message: '条目在媒体服务器上已不存在，按删除成功处理' });
  });
});
