/**
 * @file actorSiteCollect.test.ts
 * @description 演员收藏站点单向 collect（10-05-actor-site-collect）：
 *   URL 构造 / 请求形状（POST + credentials + X-Requested-With + X-CSRF-Token）/
 *   双判翻转（2xx + DOM 翻转：site-applied 主路径 = JS 注入 MAIN world + 观察窗口；
 *   manual 兜底 = 手动切锚点 visible，不得抛错）/ 失败容忍 / never-uncollect 三重负锁。
 *   纯函数 + 结构 fake doc + 注入 fetch，node 环境可跑。
 * @module features/actorEnhancement
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as siteCollectModule from './actorSiteCollect';
import {
  applyCollectedStateManual,
  buildActorCollectUrl,
  collectActorOnSite,
  readSiteCollectedState,
} from './actorSiteCollect';

const ORIGIN = 'https://javdb570.com';

interface FakeAnchor {
  id: string;
  style: { display: string };
  attrs: Record<string, string>;
  hasAttribute(n: string): boolean;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
}

interface FakeDoc {
  doc: Document;
  setCollected(v: boolean): void;
  getCollected(): boolean;
}

function makeFakeDoc(opts: { collected: boolean; withAnchors?: boolean }): FakeDoc {
  const state = { collected: opts.collected };
  const mk = (id: string): FakeAnchor => {
    const el: any = { id, style: { display: '' }, attrs: {} as Record<string, string> };
    el.hasAttribute = (n: string) => n in el.attrs;
    el.setAttribute = (n: string, v: string) => { el.attrs[n] = v; };
    el.removeAttribute = (n: string) => { delete el.attrs[n]; };
    return el;
  };
  const hasAnchors = opts.withAnchors !== false;
  const collect = hasAnchors ? mk('button-collect-actor') : null;
  const uncollect = hasAnchors ? mk('button-uncollect-actor') : null;
  const sync = () => {
    if (collect) collect.style.display = state.collected ? 'none' : '';
    if (uncollect) uncollect.style.display = state.collected ? '' : 'none';
  };
  sync();
  const raw: any = {
    getElementById: (id: string) =>
      id === 'button-collect-actor' ? collect : id === 'button-uncollect-actor' ? uncollect : null,
    createElement: (tag: string) => ({ tag, remove() {} }),
    head: { appendChild() {} },
    documentElement: {},
  };
  return {
    doc: raw as unknown as Document,
    setCollected(v: boolean) { state.collected = v; sync(); },
    getCollected() { return state.collected; },
  };
}

function makeResp(partial: { ok?: boolean; status?: number; ct?: string; text?: string }): any {
  const ct = partial.ct ?? 'text/javascript; charset=utf-8';
  const status = partial.status ?? 200;
  return {
    ok: partial.ok ?? (status >= 200 && status < 300),
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? ct : null) },
    text: async () => partial.text ?? '',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildActorCollectUrl（collect 端点构造）', () => {
  it('标准形态 /actors/{id}/collect', () => {
    expect(buildActorCollectUrl('abc123', ORIGIN)).toBe(`${ORIGIN}/actors/abc123/collect`);
  });

  it('origin 尾斜杠剔除', () => {
    expect(buildActorCollectUrl('abc123', `${ORIGIN}/`)).toBe(`${ORIGIN}/actors/abc123/collect`);
  });

  it('特殊字符 ID 走 encodeURIComponent', () => {
    expect(buildActorCollectUrl('a b/c', ORIGIN)).toBe(`${ORIGIN}/actors/a%20b%2Fc/collect`);
  });
});

describe('readSiteCollectedState（双锚点可见态读取）', () => {
  it('站点未收藏（collect 锚点可见）→ false', () => {
    const fake = makeFakeDoc({ collected: false });
    expect(readSiteCollectedState(fake.doc)).toBe(false);
  });

  it('站点已收藏（uncollect 锚点可见）→ true', () => {
    const fake = makeFakeDoc({ collected: true });
    expect(readSiteCollectedState(fake.doc)).toBe(true);
  });

  it('两锚点均隐藏 → false', () => {
    const fake = makeFakeDoc({ collected: true });
    const uncollect = fake.doc.getElementById('button-uncollect-actor') as any;
    uncollect.style.display = 'none';
    expect(readSiteCollectedState(fake.doc)).toBe(false);
  });

  it('无锚点 → null', () => {
    const fake = makeFakeDoc({ collected: false, withAnchors: false });
    expect(readSiteCollectedState(fake.doc)).toBeNull();
  });
});

describe('applyCollectedStateManual（manual 兜底翻转，不得抛错）', () => {
  it('未收藏 → 翻转后读回已收藏', () => {
    const fake = makeFakeDoc({ collected: false });
    expect(applyCollectedStateManual(fake.doc)).toBe(true);
    expect(readSiteCollectedState(fake.doc)).toBe(true);
  });

  it('无锚点 → false（不抛错）', () => {
    const fake = makeFakeDoc({ collected: false, withAnchors: false });
    expect(applyCollectedStateManual(fake.doc)).toBe(false);
  });
});

describe('请求形状（POST + credentials + 头）', () => {
  it('POST + credentials include + X-Requested-With + token 在位带 X-CSRF-Token', async () => {
    const fake = makeFakeDoc({ collected: false });
    const fetchMock = vi.fn(async () => makeResp({ ok: true, text: 'x' }));
    await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      getToken: () => 'tok-123',
      doc: fake.doc,
      applySiteScript: () => { fake.setCollected(true); return true; },
      flipWatchMs: 20,
      flipPollMs: 5,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${ORIGIN}/actors/abc123/collect`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(init.headers['X-CSRF-Token']).toBe('tok-123');
  });

  it('token 为 null → 不带 X-CSRF-Token 头', async () => {
    const fake = makeFakeDoc({ collected: false });
    const fetchMock = vi.fn(async () => makeResp({ ok: true, text: 'x' }));
    await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      getToken: () => null,
      doc: fake.doc,
      applySiteScript: () => { fake.setCollected(true); return true; },
      flipWatchMs: 20,
      flipPollMs: 5,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['X-CSRF-Token']).toBeUndefined();
    expect(init.headers['X-Requested-With']).toBe('XMLHttpRequest');
  });
});

describe('双判翻转（2xx + DOM 翻转）', () => {
  it('主路径：JS 响应注入后观察窗口内翻转 → site-applied', async () => {
    const fake = makeFakeDoc({ collected: false });
    let injected = '';
    const applySiteScript = vi.fn((_doc: Document, text: string) => {
      injected = text;
      fake.setCollected(true);
      return true;
    });
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => makeResp({ ok: true, text: 'window.__flip__();' })) as unknown as typeof fetch,
      doc: fake.doc,
      applySiteScript,
      flipWatchMs: 50,
      flipPollMs: 10,
    });
    expect(r).toEqual({ ok: true, source: 'site-applied' });
    expect(applySiteScript).toHaveBeenCalledTimes(1);
    expect(injected).toBe('window.__flip__();');
    expect(fake.getCollected()).toBe(true);
  });

  it('观察窗口过期未翻转 → manual 兜底（手动切锚点，翻转生效）', async () => {
    const fake = makeFakeDoc({ collected: false });
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => makeResp({ ok: true, text: 'x' })) as unknown as typeof fetch,
      doc: fake.doc,
      applySiteScript: () => true, // 注入但不翻转（站点 JS 无响应）
      flipWatchMs: 30,
      flipPollMs: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.source).toBe('manual');
    expect(readSiteCollectedState(fake.doc)).toBe(true);
  });

  it('非 JS 响应 → 不注入，直接 manual 兜底', async () => {
    const fake = makeFakeDoc({ collected: false });
    const applySiteScript = vi.fn(() => true);
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => makeResp({ ok: true, ct: 'text/html; charset=utf-8', text: '<html></html>' })) as unknown as typeof fetch,
      doc: fake.doc,
      applySiteScript,
      flipWatchMs: 30,
      flipPollMs: 5,
    });
    expect(r.source).toBe('manual');
    expect(applySiteScript).not.toHaveBeenCalled();
  });

  it('站点已是收藏态 → 无需翻转即 site-applied', async () => {
    const fake = makeFakeDoc({ collected: true });
    const applySiteScript = vi.fn(() => true);
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => makeResp({ ok: true, text: 'x' })) as unknown as typeof fetch,
      doc: fake.doc,
      applySiteScript,
      flipWatchMs: 30,
      flipPollMs: 5,
    });
    expect(r).toEqual({ ok: true, source: 'site-applied' });
  });

  it('无锚点 → ok + source none', async () => {
    const fake = makeFakeDoc({ collected: false, withAnchors: false });
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => makeResp({ ok: true, text: 'x' })) as unknown as typeof fetch,
      doc: fake.doc,
      flipWatchMs: 20,
      flipPollMs: 5,
    });
    expect(r).toEqual({ ok: true, source: 'none' });
  });

  it('非页面上下文（无 doc）→ ok + source none', async () => {
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => makeResp({ ok: true, text: 'x' })) as unknown as typeof fetch,
      doc: undefined,
    });
    expect(r).toEqual({ ok: true, source: 'none' });
  });
});

describe('失败容忍（best-effort，永不抛错）', () => {
  it('HTTP 非 2xx → ok:false + reason http-{status}，不翻转', async () => {
    const fake = makeFakeDoc({ collected: false });
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => makeResp({ ok: false, status: 403 })) as unknown as typeof fetch,
      doc: fake.doc,
      flipWatchMs: 20,
      flipPollMs: 5,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('http-403');
    expect(fake.getCollected()).toBe(false);
  });

  it('网络异常 → ok:false + reason network-or-timeout（不抛）', async () => {
    const fake = makeFakeDoc({ collected: false });
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
      doc: fake.doc,
    });
    expect(r).toEqual({ ok: false, source: 'none', reason: 'network-or-timeout' });
    expect(fake.getCollected()).toBe(false);
  });

  it('POST 超时（abort）→ ok:false + reason network-or-timeout', async () => {
    const fake = makeFakeDoc({ collected: false });
    const fetchMock = vi.fn(
      (_url: unknown, init: unknown) =>
        new Promise((_resolve: unknown, reject: (e: Error) => void) => {
          const signal = (init as { signal?: AbortSignal }).signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const r = await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      doc: fake.doc,
      postTimeoutMs: 30,
      flipWatchMs: 20,
      flipPollMs: 5,
    });
    expect(r).toEqual({ ok: false, source: 'none', reason: 'network-or-timeout' });
  });
});

describe('入参守卫', () => {
  it('无 actorId → no-actor-id 且零请求', async () => {
    const fetchMock = vi.fn(async () => makeResp({ ok: true }));
    const r = await collectActorOnSite('', ORIGIN, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'no-actor-id' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('无 origin → no-origin', async () => {
    const fetchMock = vi.fn(async () => makeResp({ ok: true }));
    const r = await collectActorOnSite('abc123', '', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'no-origin' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch 不可用 → fetch-unavailable', async () => {
    vi.stubGlobal('fetch', undefined);
    const r = await collectActorOnSite('abc123', ORIGIN, {});
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'fetch-unavailable' }));
  });
});

describe('never-uncollect 三重负锁（uncollect 端点仅登记、永不调用）', () => {
  it('① 模块导出名无 uncollect 字样', () => {
    const offenders = Object.keys(siteCollectModule).filter((k) => /uncollect/i.test(k));
    expect(offenders).toEqual([]);
  });

  it('② 全部成功路径（site-applied / manual / none）请求 URL 恒以 /collect 结尾', async () => {
    const urls: string[] = [];
    const mkFetch =
      () => (async (url: unknown) => {
        urls.push(String(url));
        return makeResp({ ok: true, text: 'x' });
      }) as typeof fetch;

    let fake = makeFakeDoc({ collected: false });
    await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: mkFetch(),
      doc: fake.doc,
      applySiteScript: () => { fake.setCollected(true); return true; },
      flipWatchMs: 20,
      flipPollMs: 5,
    });
    fake = makeFakeDoc({ collected: false });
    await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: mkFetch(),
      doc: fake.doc,
      applySiteScript: () => true,
      flipWatchMs: 20,
      flipPollMs: 5,
    });
    fake = makeFakeDoc({ collected: false, withAnchors: false });
    await collectActorOnSite('abc123', ORIGIN, {
      fetchImpl: mkFetch(),
      doc: fake.doc,
      flipWatchMs: 20,
      flipPollMs: 5,
    });

    expect(urls).toHaveLength(3);
    for (const u of urls) {
      expect(u.endsWith('/collect')).toBe(true);
      expect(u).not.toContain('uncollect');
    }
  });

  it('③ 源码无「带斜杠的 uncollect 端点字符串」（引号串同时含 uncollect 与 / 即违例）', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'actorSiteCollect.ts'), 'utf-8');
    const badLines = src
      .split('\n')
      .filter((line) =>
        (line.match(/["'`]([^"'`\n]*)["'`]/g) ?? []).some((s) => s.includes('uncollect') && s.includes('/')),
      );
    expect(badLines).toEqual([]);
  });
});
