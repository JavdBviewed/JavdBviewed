import { describe, expect, it, vi } from 'vitest';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';
import {
  deleteMediaCleanupCopy,
  isAttachmentFileName,
  parse115FolderCid,
} from './mediaCleanupDelete';

/**
 * 默认 Emby mock 服务器（仅 apiKey，无 userId）。
 */
function apiKeySettings() {
  return {
    emby: { mediaServers: [{
      id: 'home',
      type: 'emby',
      name: 'Home',
      url: 'http://home.local',
      apiKey: 'secret',
      enabled: true,
    }] },
  };
}

function embyCopy(overrides: Partial<MediaCleanupCopySnapshot> = {}): MediaCleanupCopySnapshot {
  return {
    copyId: 'emby:http://home.local:item-1',
    source: 'emby',
    serverUrl: 'http://home.local/',
    itemId: 'item-1',
    lastFoundAt: 1,
    ...overrides,
  };
}

/**
 * 删除全周期的 fetch mock：
 * 探测 GET（存在）→ DELETE → 探测 GET（结果）
 */
function lifecycleFetch(deleteStatus: number, postDeleteGet: { status: number; body?: string }) {
  let getCalls = 0;
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response(null, { status: deleteStatus });
    getCalls += 1;
    return getCalls === 1
      ? new Response('{"Id":"item-1","CanDelete":true}', { status: 200 })
      : new Response(postDeleteGet.body ?? '', { status: postDeleteGet.status });
  });
}

describe('mediaCleanupDelete', () => {
  it('deletes an Emby copy through its configured server (probe → DELETE /Items/{Id} → verify)', async () => {
    const fetchImpl = lifecycleFetch(204, { status: 404 });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe('已从媒体服务器删除（已校验条目消失）');
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method);
    // 探测走 GET /Items?Ids=（无 userId）；删除只走 DELETE /Items/{Id}，不带 Recursive/Permanent
    expect(urls).toEqual([
      'http://home.local/Items?Ids=item-1&api_key=secret',
      'http://home.local/Items/item-1?api_key=secret',
      'http://home.local/Items?Ids=item-1&api_key=secret',
    ]);
    expect(methods).toEqual([undefined, 'DELETE', undefined]);
  });

  it('apiKey 模式即使配置了 userId 也走列表形态探测（单条目路由 CanDelete 按路径用户计算会误判），且从不 DELETE /Users/...', async () => {
    const fetchImpl = lifecycleFetch(204, { status: 404 });
    const copy = embyCopy({
      copyId: 'jellyfin:http://jf.local:item-9',
      source: 'jellyfin',
      serverUrl: 'http://jf.local',
      itemId: 'item-9',
    });
    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({
        emby: { mediaServers: [{
          id: 'jf',
          type: 'jellyfin',
          name: 'JF',
          url: 'http://jf.local',
          apiKey: 'key',
          userId: 'u1',
          enabled: true,
        }] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(true);
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      // API Key 探测/校验一律走列表形态 GET /Items?Ids=（不做 CanDelete 判定）
      'http://jf.local/Items?Ids=item-9&api_key=key',
      // 删除只走 DELETE /Items/{Id}：/Users/... 路由只有 GET，对其 DELETE 恒 404（假成功根因）
      'http://jf.local/Items/item-9?api_key=key',
      'http://jf.local/Items?Ids=item-9&api_key=key',
    ]);
    const deleteCalls = fetchImpl.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
    expect(String(deleteCalls[0]?.[0])).not.toContain('/Users/');
  });

  it('fails before deleting when the probe gets 401/403 (invalid credential)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"Message":"not allowed"}', { status: 403 }));
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('删除前校验失败');
    expect(result.message).toContain('403');
    expect(result.message).toContain('Home');
    // 未发出 DELETE
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain('DELETE');
  });

  it('treats a pre-existing 404 (item already gone) as success without fake delete claims', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('已不存在');
    expect(result.message).toContain('按删除成功处理');
  });

  it('verifies deletion: DELETE ok then probe 404 confirms success and checks the same item', async () => {
    const fetchImpl = lifecycleFetch(204, { status: 404 });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('已从媒体服务器删除（已校验条目消失）');
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      'http://home.local/Items?Ids=item-1&api_key=secret',
      'http://home.local/Items/item-1?api_key=secret',
      'http://home.local/Items?Ids=item-1&api_key=secret',
    ]);
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method);
    expect(methods).toEqual([undefined, 'DELETE', undefined]);
  });

  it('fails when the server returns 204 but the item still exists after delete', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response('{"Items":[{"Id":"item-1"}],"TotalRecordCount":1}', { status: 200 }));
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('仍存在');
    expect(result.message).toContain('Home');
    expect(result.message).toContain('手动删除');
  });

  it('fails when the post-delete verification request itself cannot execute (Illegal invocation)', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('无法确认文件是否已删除');
  });

  it('fails with unknown-state when the post-delete probe gets an HTTP error (pre-probe passed)', async () => {
    let getCalls = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      getCalls += 1;
      return getCalls === 1
        ? new Response('{"Id":"item-1","CanDelete":true}', { status: 200 })
        : new Response(null, { status: 403 });
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('无法确认条目状态');
    expect(result.message).toContain('403');
  });

  it('treats a 204 DELETE with empty Ids list afterward as success', async () => {
    let getCalls = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      getCalls += 1;
      return getCalls === 1
        ? new Response('{"Items":[{"Id":"item-1"}],"TotalRecordCount":1}', { status: 200 })
        : new Response('{"Items":[],"TotalRecordCount":0}', { status: 200 });
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('已从媒体服务器删除（已校验条目消失）');
  });

  it('令牌探测 CanDelete=false 且无 API Key 可用时：失败并给出凭证身份与修复建议，不发出 DELETE', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"Id":"item-1","Type":"Movie","CanDelete":false}', { status: 200 }));
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => ({
        emby: { mediaServers: [{
          id: 'home',
          type: 'emby',
          name: 'Home',
          url: 'http://home.local',
          accessToken: 'tok-1',
          userId: 'u-1',
          userDisplayName: 'family',
          enabled: true,
        }] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('无该条目的删除权限');
    expect(result.message).toContain('用户令牌（family）');
    expect(result.message).toContain('Movie');
    expect(result.message).toContain('管理员');
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain('DELETE');
  });

  it('令牌无删除权限但 API Key 可用：自动回退到 API Key 完成删除（真实场景：扫库用管理员 Key、登录用的是普通账号）', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (u.includes('/Users/u-1/Items/')) {
        // 用户令牌单条目探测：普通账号 CanDelete=false
        return new Response('{"Id":"item-1","Type":"Movie","CanDelete":false}', { status: 200 });
      }
      // API Key 列表探测：删除前存在，删除后为空
      if (fetchImpl.mock.calls.length <= 2) {
        return new Response('{"Items":[{"Id":"item-1"}],"TotalRecordCount":1}', { status: 200 });
      }
      return new Response('{"Items":[],"TotalRecordCount":0}', { status: 200 });
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => ({
        emby: { mediaServers: [{
          id: 'home',
          type: 'emby',
          name: 'Home',
          url: 'http://home.local',
          apiKey: 'secret',
          accessToken: 'tok-1',
          userId: 'u-1',
          userDisplayName: 'family',
          enabled: true,
        }] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('已从媒体服务器删除（已校验条目消失）');
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    // 令牌探测（单条目）→ API Key 探测（列表）→ DELETE（API Key）→ API Key 校验（列表）
    expect(urls).toEqual([
      'http://home.local/Users/u-1/Items/item-1',
      'http://home.local/Items?Ids=item-1&api_key=secret',
      'http://home.local/Items/item-1?api_key=secret',
      'http://home.local/Items?Ids=item-1&api_key=secret',
    ]);
    // DELETE 只走 API Key，未用令牌
    const deleteCalls = fetchImpl.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
    expect(String(deleteCalls[0]?.[0])).toContain('api_key=secret');
    const deleteHeaders = (deleteCalls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(deleteHeaders['X-Emby-Token']).toBeUndefined();
  });

  it('令牌失效（401）时回退到 API Key 完成删除', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (u.includes('/Users/u-1/Items/')) return new Response('{"Message":"invalid token"}', { status: 401 });
      return new Response('{"Items":[],"TotalRecordCount":0}', { status: 200 });
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => ({
        emby: { mediaServers: [{
          id: 'home',
          type: 'emby',
          name: 'Home',
          url: 'http://home.local',
          apiKey: 'secret',
          accessToken: 'tok-1',
          userId: 'u-1',
          enabled: true,
        }] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(true);
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain('http://home.local/Items?Ids=item-1&api_key=secret');
    const deleteCalls = fetchImpl.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE');
    expect(String(deleteCalls[0]?.[0])).toContain('api_key=secret');
  });

  it('仅 API Key 且 DELETE 被 403 拒绝：报错带原始状态码、服务器响应文本与 API Key 归属提示', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response('Unauthorized access', { status: 403 });
      return new Response('{"Items":[{"Id":"item-1"}],"TotalRecordCount":1}', { status: 200 });
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => apiKeySettings(),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('拒绝删除');
    expect(result.message).toContain('HTTP 403');
    expect(result.message).toContain('Unauthorized access');
    expect(result.message).toContain('API Key 的权限跟随其属主账号');
  });

  it('令牌 DELETE 被 403 拒绝时回退 API Key 重试，成功后按 API Key 校验', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'DELETE') {
        if (u.includes('api_key=secret')) return new Response(null, { status: 204 });
        return new Response('Unauthorized access', { status: 403 });
      }
      if (u.includes('/Users/u-1/Items/')) {
        return new Response('{"Id":"item-1","CanDelete":true}', { status: 200 });
      }
      return new Response('{"Items":[],"TotalRecordCount":0}', { status: 200 });
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => ({
        emby: { mediaServers: [{
          id: 'home',
          type: 'emby',
          name: 'Home',
          url: 'http://home.local',
          apiKey: 'secret',
          accessToken: 'tok-1',
          userId: 'u-1',
          enabled: true,
        }] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(true);
    const deleteCalls = fetchImpl.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(2);
    expect(String(deleteCalls[0]?.[0])).not.toContain('api_key');
    expect(String(deleteCalls[1]?.[0])).toContain('api_key=secret');
  });

  it('两枚凭证都无删除权限相关状态时给出汇总（令牌 CanDelete=false + Key 凭证 401 无效）', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/Users/u-1/Items/')) return new Response('{"Id":"item-1","CanDelete":false}', { status: 200 });
      return new Response('{"Message":"invalid key"}', { status: 401 });
    });
    const result = await deleteMediaCleanupCopy(embyCopy(), {
      getSettings: async () => ({
        emby: { mediaServers: [{
          id: 'home',
          type: 'emby',
          name: 'Home',
          url: 'http://home.local',
          apiKey: 'secret',
          accessToken: 'tok-1',
          userId: 'u-1',
          userDisplayName: 'family',
          enabled: true,
        }] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('删除前校验失败');
    expect(result.message).toContain('用户令牌（family） 无删除权限');
    expect(result.message).toContain('API Key HTTP 401');
    expect(result.message).toContain('invalid key');
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain('DELETE');
  });

  it('delegates a 115 copy deletion by file id and cleans attachments best-effort', async () => {
    const deleteDrive115File = vi.fn(async () => ({ ok: true, message: '已删除 115 文件' }));
    const deleteDrive115FolderAttachments = vi.fn(async () => ({ ok: true, message: '已清理 2 个附属文件' }));
    const result = await deleteMediaCleanupCopy({
      copyId: '115:file-1',
      source: '115',
      fileId: 'file-1',
      fileName: 'AAA-1.mp4',
      folderPath: 'AAA-1（12345）',
      coverFileName: 'AAA-1.jpg',
      lastFoundAt: 1,
    }, {
      getSettings: async () => ({}),
      fetchImpl: fetch,
      deleteDrive115File,
      deleteDrive115FolderAttachments,
    });

    expect(deleteDrive115File).toHaveBeenCalledWith('file-1');
    expect(deleteDrive115FolderAttachments).toHaveBeenCalledWith({ cid: '12345', folderPath: 'AAA-1（12345）' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('已删除 115 文件');
    expect(result.message).toContain('附属文件');
  });

  it('still reports success when attachment cleanup fails', async () => {
    const deleteDrive115File = vi.fn(async () => ({ ok: true, message: '已删除 115 文件' }));
    const deleteDrive115FolderAttachments = vi.fn(async () => ({ ok: false, message: '附属清理失败' }));
    const result = await deleteMediaCleanupCopy({
      copyId: '115:file-1',
      source: '115',
      fileId: 'file-1',
      folderPath: 'AAA-1（12345）',
      coverFileName: 'AAA-1.jpg',
      lastFoundAt: 1,
    }, {
      getSettings: async () => ({}),
      fetchImpl: fetch,
      deleteDrive115File,
      deleteDrive115FolderAttachments,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('已删除 115 文件');
  });
});

describe('parse115FolderCid', () => {
  it('parses full-width parens', () => {
    expect(parse115FolderCid('AAA-1（12345）')).toBe('12345');
  });
  it('returns undefined for non-numeric or missing', () => {
    expect(parse115FolderCid('AAA-1')).toBeUndefined();
    expect(parse115FolderCid('AAA-1（abc）')).toBeUndefined();
    expect(parse115FolderCid('')).toBeUndefined();
  });
});

describe('115 copy deletion idempotency (file already gone)', () => {
  function depsWith(deleteDrive115File: ReturnType<typeof vi.fn>) {
    return {
      getSettings: async () => ({}),
      fetchImpl: fetch,
      deleteDrive115File,
    };
  }
  const copy = {
    copyId: '115:file-1',
    source: '115' as const,
    fileId: 'file-1',
    fileName: 'AAA-1.mp4',
    lastFoundAt: 1,
  };

  it('converges to success when 115 reports the file is already gone (stale duplicate record)', async () => {
    const deleteDrive115File = vi.fn(async () => ({ ok: false, message: '文件不存在', fileGone: true }));
    const result = await deleteMediaCleanupCopy(copy, depsWith(deleteDrive115File));
    expect(result.ok).toBe(true);
    expect(result.message).toBe('文件在 115 上已不存在，按删除成功处理');
    expect(deleteDrive115File).toHaveBeenCalledWith('file-1');
  });

  it('keeps the failure when 115 reports a real error (no fileGone signal)', async () => {
    const deleteDrive115File = vi.fn(async () => ({ ok: false, message: '网络错误' }));
    const result = await deleteMediaCleanupCopy(copy, depsWith(deleteDrive115File));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('网络错误');
  });
});

describe('isAttachmentFileName', () => {
  it('matches cover/subtitle/info files, not the video itself', () => {
    expect(isAttachmentFileName('AAA-1.jpg', 'AAA-1.mp4')).toBe(true);
    expect(isAttachmentFileName('AAA-1.jpg', undefined)).toBe(true);
    expect(isAttachmentFileName('AAA-1.ass', 'AAA-1.mp4')).toBe(true);
    expect(isAttachmentFileName('AAA-1.nfo', 'AAA-1.mp4')).toBe(true);
    expect(isAttachmentFileName('AAA-1.mp4', 'AAA-1.mp4')).toBe(false);
    expect(isAttachmentFileName('AAA-1.mkv', 'AAA-1.mp4')).toBe(false);
  });
});
