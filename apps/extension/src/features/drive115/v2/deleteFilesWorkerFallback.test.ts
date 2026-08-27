import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDrive115V2Service } from './index';

/**
 * 复现并验证 Service Worker（WorkerGlobalScope）中 deleteFiles 兜底直连 fetch
 * 的 "Illegal invocation" 隐患：
 *
 * - 代理（chrome.runtime.sendMessage）不可用时，deleteFiles 回退到直连 fetch；
 *   个别 SW 环境下裸调 fetch 会抛
 *   `TypeError: Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation`。
 * - 修复后：
 *   1. 即使该 TypeError 真的抛出，也只返回 { success: false } 且 message 为可读文案，
 *      绝不再向外抛 "Illegal invocation"；
 *   2. 正常 fetch（绑定 self 后）仍可成功完成删除请求。
 *
 * 全部 mock，禁止真实 115 API 调用。
 */

// 让 chrome 存在但 runtime 不可用：使「后台代理」分支被跳过，走直连兜底
const CHROME_STUB = {
  runtime: { id: 'stub-extension-id' },
} as any;

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Drive115V2Service.deleteFiles: Service Worker 兜底 fetch', () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = (globalThis as any).chrome;

  beforeEach(() => {
    (globalThis as any).chrome = CHROME_STUB;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).chrome = originalChrome;
  });

  it('兜底 fetch 模拟 WorkerGlobalScope Illegal invocation → 返回可读错误而非向外抛', async () => {
    // 模拟：该环境下 fetch 一旦脱离宿主绑定即抛 Illegal invocation
    globalThis.fetch = vi.fn((..._args: any[]) => {
      throw new TypeError(
        "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
      );
    }) as unknown as typeof fetch;

    const service = getDrive115V2Service();
    const ret = await service.deleteFiles({ accessToken: 'tok', fileIds: ['f-1'] });

    expect(ret.success).toBe(false);
    const msg = String(ret.message || '');
    expect(msg).not.toContain('Illegal invocation');
    expect(msg).not.toBe('');
    expect(msg).toContain('后台代理不可用');
  });

  it('兜底 fetch 正常（绑定 self 调用）→ 成功删除并返回 115 原始响应', async () => {
    let seenThis: any = null;
    globalThis.fetch = vi.fn(function (this: any, _url: any, _init: any) {
      seenThis = this;
      return Promise.resolve(makeResponse({ state: true }));
    }) as unknown as typeof fetch;

    const service = getDrive115V2Service();
    const ret = await service.deleteFiles({ accessToken: 'tok', fileIds: ['f-1', 'f-2'] });

    expect(ret.success).toBe(true);
    expect((ret as any).raw).toMatchObject({ state: true });
    expect(ret.endpoint).toMatch(/open\/(rb|ufile)\/delete$/);
    // 关键断言：fetch 必须以宿主全局 globalThis 为 this 被调用
    // （nativeFetch 统一使用 Function.prototype.apply 绑定 globalThis，
    //   SW/Worker 中 globalThis === self === WorkerGlobalScope）
    expect(seenThis).toBe(globalThis);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('两个删除端点均网络失败 → message 为「网络异常」可读文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const service = getDrive115V2Service();
    const ret = await service.deleteFiles({ accessToken: 'tok', fileIds: ['f-1'] });

    expect(ret.success).toBe(false);
    expect(String(ret.message)).toBe('网络异常，无法连接 115 服务，请稍后重试');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('115 服务端返回业务错误码 → 使用 115 错误映射文案（优先级最高）', async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({ state: false, errNo: 40140125, message: 'access token invalid' }),
    ) as unknown as typeof fetch;

    const service = getDrive115V2Service();
    const ret = await service.deleteFiles({ accessToken: 'expired', fileIds: ['f-1'] });

    expect(ret.success).toBe(false);
    const msg = String(ret.message || '');
    expect(msg).toContain('40140125');
    // 115 业务码文案来自错误码映射（access_token 无效 → 建议刷新/重新授权）
    expect(msg).toContain('access_token 无效');
    expect(msg).toContain('access token invalid');
  });
});
