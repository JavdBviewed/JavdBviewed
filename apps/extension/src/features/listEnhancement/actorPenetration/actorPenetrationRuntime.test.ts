/**
 * @vitest-environment jsdom
 * @file actorPenetrationRuntime.test.ts
 * @description 演员穿透运行时测试：缓存命中、失败抑制、幂等、失败回退、清理
 * 通过注入 mock 缓存与快捷操作绑定，隔离 chrome.storage 依赖。
 * B7（09-26-display-settings-audit）：fetch 失败 / 需登录 / parse 空 三态分离 + 英文标签。
 * D-B4：渲染完成回调 onActorsRendered。
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it, vi } from 'vitest';
import { createActorPenetrationRuntime, detectLoginRequired } from './actorPenetrationRuntime';
import { renderActorRow } from './renderActorRow';
import type { ActorPenetrationCacheResult, ActorPenetrationCacheValue } from './actorPenetrationCache';
import type { DetailActor } from './parseDetailActors';

const FEMALE = [
  { id: 'a1', name: '演员一', href: '/actors/a1', gender: 'female' },
  { id: 'a2', name: '演员二', href: '/actors/a2', gender: 'female' },
] as DetailActor[];

function makeItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  const title = document.createElement('div');
  title.className = 'video-title';
  title.innerHTML = '<strong>ABC-123</strong>';
  item.appendChild(title);
  document.body.appendChild(item);
  return item;
}

const FEMALE_HTML = `
<html><body><div class="panel-block"><strong>演員</strong>
<div class="value"><a class="actor-female" href="/actors/a1">演员一</a><a class="actor-female" href="/actors/a2">演员二</a></div>
</div></body></html>`;

const FEMALE_EN_HTML = `
<html><body><div class="panel-block"><strong>Actor(s):</strong>
<div class="value"><a class="actor-female" href="/actors/e1">Actress One</a><a class="actor-female" href="/actors/e2">Actress Two</a></div>
</div>
<div class="panel-block"><strong>Male Actor(s):</strong>
<div class="value"><a href="/actors/m1">Male One</a></div>
</div></body></html>`;

/** 登录受限番 302 后的最终 URL + 登录页 html（真机口径：javdb575.com/login）。 */
const LOGIN_HTML = '<html><head><title>Sign In</title></head><body>please sign in</body></html>';

/** 内存版缓存 mock（含「需登录」独立状态）。 */
function makeCacheMock() {
  const store = new Map<string, { value?: ActorPenetrationCacheValue; failed?: boolean; loginRequired?: boolean }>();
  return {
    readCache: vi.fn(async (code: string): Promise<ActorPenetrationCacheResult> => {
      const entry = store.get(code);
      if (!entry) return { status: 'miss' };
      if (entry.failed) return { status: 'failed', loginRequired: entry.loginRequired === true };
      return { status: 'hit', value: entry.value! };
    }),
    writeSuccess: vi.fn(async (code: string, value: ActorPenetrationCacheValue) => {
      store.set(code, { value });
    }),
    writeFailure: vi.fn(async (code: string) => {
      store.set(code, { failed: true });
    }),
    writeLoginRequired: vi.fn(async (code: string) => {
      store.set(code, { failed: true, loginRequired: true });
    }),
  };
}

const noopBind = vi.fn();

describe('ActorPenetrationRuntime', () => {
  it('缓存命中时直接渲染，不发起详情请求', async () => {
    const cache = makeCacheMock();
    await cache.writeSuccess('ABC-123', { actors: FEMALE, hasMore: false, fetchedAt: Date.now() });
    const fetchText = vi.fn(async () => { throw new Error('should not fetch'); });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    expect(fetchText).not.toHaveBeenCalled();
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    item.remove();
  });

  it('未命中时请求详情并渲染，随后写成功缓存', async () => {
    const cache = makeCacheMock();
    const fetchText = vi.fn(async () => ({ html: FEMALE_HTML, finalUrl: 'https://javdb.com/v/xyz' }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'XYZ-001', detailUrl: '/v/XYZ-001' });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    expect(cache.writeSuccess).toHaveBeenCalledWith('XYZ-001', expect.objectContaining({ hasMore: false }));
    item.remove();
  });

  it('请求失败后写失败缓存并抑制重试', async () => {
    const cache = makeCacheMock();
    const fetchText = vi.fn(async () => { throw new Error('network down'); });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind, timeoutMs: 50 });
    const item = makeItem();
    await runtime.process({ item, code: 'ERR-999', detailUrl: '/v/ERR-999' });
    expect(item.querySelector('a.x-ap-actor')).toBeNull();
    expect(cache.writeFailure).toHaveBeenCalledWith('ERR-999');

    // 第二次：失败短缓存抑制，不再请求
    await runtime.process({ item, code: 'ERR-999', detailUrl: '/v/ERR-999' });
    expect(fetchText).toHaveBeenCalledTimes(1);
    item.remove();
  });

  it('302→登录页识别为「需登录」独立状态：写 loginRequired 缓存而非失败抑制，且二次访问被抑制（B7）', async () => {
    const cache = makeCacheMock();
    const fetchText = vi.fn(async () => ({ html: LOGIN_HTML, finalUrl: 'https://javdb575.com/login' }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'LOG-1', detailUrl: '/v/LOG-1' });
    expect(cache.writeLoginRequired).toHaveBeenCalledWith('LOG-1');
    expect(cache.writeFailure).not.toHaveBeenCalled();
    expect(item.querySelector('a.x-ap-actor')).toBeNull();

    // 第二次：需登录状态有效期内抑制重试
    await runtime.process({ item, code: 'LOG-1', detailUrl: '/v/LOG-1' });
    expect(fetchText).toHaveBeenCalledTimes(1);
    item.remove();
  });

  it('详情页正常但 0 名女性演员：不写任何缓存（不抑制、不占重试预算，B7）', async () => {
    const cache = makeCacheMock();
    const maleOnlyHtml = `
<html><body><div class="panel-block"><strong>男優</strong>
<div class="value"><a href="/actors/m1">男演员</a></div>
</div></body></html>`;
    const fetchText = vi.fn(async () => ({ html: maleOnlyHtml, finalUrl: 'https://javdb.com/v/emp' }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'EMP-1', detailUrl: '/v/EMP-1' });
    expect(cache.writeFailure).not.toHaveBeenCalled();
    expect(cache.writeSuccess).not.toHaveBeenCalled();
    expect(cache.writeLoginRequired).not.toHaveBeenCalled();
    expect(item.querySelector('a.x-ap-actor')).toBeNull();

    // 不写缓存 ⇒ 再次访问仍会发起请求（不被 10 分钟 failed 误抑制）
    await runtime.process({ item, code: 'EMP-1', detailUrl: '/v/EMP-1' });
    expect(fetchText).toHaveBeenCalledTimes(2);
    item.remove();
  });

  it('英文标签详情（Actor(s): / Male Actor(s):）解析并渲染女性演员（B7）', async () => {
    const cache = makeCacheMock();
    const fetchText = vi.fn(async () => ({ html: FEMALE_EN_HTML, finalUrl: 'https://javdb.com/v/en1' }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'EN-1', detailUrl: '/v/EN-1' });
    const links = Array.from(item.querySelectorAll('a.x-ap-actor'));
    // renderActorRow 将 href 按文档 baseURI 绝对化（与 parseDetailActors 测试同口径）
    expect(links.map(a => a.getAttribute('href'))).toEqual(
      ['/actors/e1', '/actors/e2'].map(h => new URL(h, window.location.href).href),
    );
    expect(cache.writeSuccess).toHaveBeenCalled();
    item.remove();
  });

  it('渲染完成回调 onActorsRendered 携带真实演员；空演员不回调（D-B4）', async () => {
    const cache = makeCacheMock();
    const onActorsRendered = vi.fn();
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText: async () => ({ html: FEMALE_HTML, finalUrl: 'https://javdb.com/v/rd' }),
      bindQuickActions: noopBind,
      onActorsRendered,
    });
    const item = makeItem();
    await runtime.process({ item, code: 'RD-1', detailUrl: '/v/RD-1' });
    expect(onActorsRendered).toHaveBeenCalledTimes(1);
    expect(onActorsRendered).toHaveBeenCalledWith(item, expect.arrayContaining([expect.objectContaining({ id: 'a1' })]));
    item.remove();
  });

  it('解析结果无女性演员时不触发 onActorsRendered（无行可渲染，无需重决策）', async () => {
    const cache = makeCacheMock();
    const onActorsRendered = vi.fn();
    const maleOnlyHtml = `
<html><body><div class="panel-block"><strong>男優</strong>
<div class="value"><a href="/actors/m1">男演员</a></div>
</div></body></html>`;
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText: async () => ({ html: maleOnlyHtml, finalUrl: 'https://javdb.com/v/rde' }),
      bindQuickActions: noopBind,
      onActorsRendered,
    });
    const item = makeItem();
    await runtime.process({ item, code: 'RD-EMPTY', detailUrl: '/v/RD-EMPTY' });
    expect(onActorsRendered).not.toHaveBeenCalled();
    item.remove();
  });

  it('同一番号并发时只请求一次（幂等）', async () => {
    const cache = makeCacheMock();
    let release!: () => void;
    const pending = new Promise<void>(r => { release = r; });
    const fetchText = vi.fn(async () => {
      await pending;
      return { html: FEMALE_HTML, finalUrl: 'https://javdb.com/v/dup' };
    });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind, timeoutMs: 5000 });
    const item = makeItem();
    void runtime.process({ item, code: 'DUP-1', detailUrl: '/v/DUP-1' });
    void runtime.process({ item, code: 'DUP-1', detailUrl: '/v/DUP-1' });
    release();
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(1));
    item.remove();
  });

  it('clear 移除演员行', async () => {
    const cache = makeCacheMock();
    await cache.writeSuccess('CLR-1', { actors: FEMALE, hasMore: false, fetchedAt: Date.now() });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText: async () => ({ html: FEMALE_HTML }), bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'CLR-1', detailUrl: '/v/CLR-1' });
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    runtime.clear(item);
    expect(item.querySelector('[data-x-ap-actor-row]')).toBeNull();
    item.remove();
  });

  it('详情解析出 >3 位女演员时缓存保存全量（不截断），hasMore=true', async () => {
    const sixFemaleHtml = `
<html><body><div class="panel-block"><strong>演員</strong>
<div class="value">${Array.from({ length: 6 }, (_, i) => `<a class="actor-female" href="/actors/f${i + 1}">女演员${i + 1}</a>`).join('')}</div>
</div></body></html>`;
    const cache = makeCacheMock();
    const fetchText = vi.fn(async () => ({ html: sixFemaleHtml, finalUrl: 'https://javdb.com/v/full' }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'FULL-001', detailUrl: '/v/FULL-001' });
    const writeArgs = (cache.writeSuccess as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const value = writeArgs[1] as { actors: DetailActor[]; hasMore: boolean };
    expect(value.actors.length).toBe(6);
    expect(value.hasMore).toBe(true);
    // 行仍只常显前 3 + 「+3」控件（渲染层口径）
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(3);
    expect(item.querySelector('button.x-ap-actor-more')?.textContent).toBe('+3');
    item.remove();
  });
});

describe('detectLoginRequired', () => {
  it('finalUrl 落在 /login 或 /sign-in → true', () => {
    expect(detectLoginRequired('https://javdb575.com/login', '<html></html>')).toBe(true);
    expect(detectLoginRequired('https://javdb575.com/sign_in/x', '<html></html>')).toBe(true);
    expect(detectLoginRequired('https://javdb575.com/Sign-In/', '<html></html>')).toBe(true);
  });

  it('正常详情页 finalUrl → false', () => {
    expect(detectLoginRequired('https://javdb575.com/v/abc123', '<html><body>actors</body></html>')).toBe(false);
  });

  it('finalUrl 缺失时按 html title 兜底', () => {
    expect(detectLoginRequired(undefined, '<html><head><title>Sign In - JavDB</title></head><body></body></html>')).toBe(true);
    expect(detectLoginRequired(undefined, '<html><head><title>Video Detail</title></head><body></body></html>')).toBe(false);
  });

  it('finalUrl 非绝对 URL 时回退 html 判断而不抛错', () => {
    expect(detectLoginRequired('/login', '<html></html>')).toBe(false);
    expect(detectLoginRequired('/login', '<html><head><title>Log In</title></head></html>')).toBe(true);
  });
});

describe('pending 转圈占位行（获取期视觉反馈）', () => {
  it('fetch 路径（缓存 miss）期间显示 pending，成功后覆盖为正式行（无转圈残留）', async () => {
    const cache = makeCacheMock();
    let resolveFetch!: (v: { html: string; finalUrl?: string }) => void;
    const fetchText = vi.fn(() => new Promise<{ html: string; finalUrl?: string }>(resolve => {
      resolveFetch = resolve;
    }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    const p = runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    await vi.waitFor(() => {
      expect(item.querySelector('.x-ap-actor-row-spinner')).toBeTruthy();
    });
    resolveFetch!({ html: FEMALE_HTML });
    await p;
    expect(item.querySelector('.x-ap-actor-row-spinner')).toBeNull();
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    expect(item.querySelectorAll('.x-ap-actor-row-container').length).toBe(1);
  });

  it('fetch 失败后清理 pending 行（无占位残留，失败抑制语义不变）', async () => {
    const cache = makeCacheMock();
    // hold-promise：fetch 挂起期间 spinner 可被观察，再触发失败（快速失败时
    // spinner 仅存在于微任务窗口，waitFor 轮询观察不到，测试非确定性）
    let rejectFetch!: (e: Error) => void;
    const fetchText = vi.fn(() => new Promise<{ html: string; finalUrl?: string }>((_, reject) => {
      rejectFetch = reject;
    }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    const p = runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    await vi.waitFor(() => {
      expect(item.querySelector('.x-ap-actor-row-spinner')).toBeTruthy();
    });
    rejectFetch!(new Error('net'));
    await p;
    expect(item.querySelector('.x-ap-actor-row-container')).toBeNull();
    expect(cache.writeFailure).toHaveBeenCalledTimes(1);
  });

  it('需登录（302→/login）后清理 pending 行', async () => {
    const cache = makeCacheMock();
    let resolveFetch!: (v: { html: string; finalUrl?: string }) => void;
    const fetchText = vi.fn(() => new Promise<{ html: string; finalUrl?: string }>(resolve => {
      resolveFetch = resolve;
    }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    const p = runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    await vi.waitFor(() => {
      expect(item.querySelector('.x-ap-actor-row-spinner')).toBeTruthy();
    });
    resolveFetch!({ html: LOGIN_HTML, finalUrl: 'https://javdb575.com/login' });
    await p;
    expect(item.querySelector('.x-ap-actor-row-container')).toBeNull();
    expect(cache.writeLoginRequired).toHaveBeenCalledTimes(1);
  });

  it('空详情（0 女演员）后清理 pending 行且不写任何缓存（B7 语义不变）', async () => {
    const cache = makeCacheMock();
    let resolveFetch!: (v: { html: string; finalUrl?: string }) => void;
    const fetchText = vi.fn(() => new Promise<{ html: string; finalUrl?: string }>(resolve => {
      resolveFetch = resolve;
    }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    const p = runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    await vi.waitFor(() => {
      expect(item.querySelector('.x-ap-actor-row-spinner')).toBeTruthy();
    });
    resolveFetch!({ html: '<html><body>no actors</body></html>' });
    await p;
    expect(item.querySelector('.x-ap-actor-row-container')).toBeNull();
    expect(cache.writeSuccess).not.toHaveBeenCalled();
    expect(cache.writeFailure).not.toHaveBeenCalled();
  });

  it('缓存命中不闪 pending（直接渲染正式行，全程无转圈）', async () => {
    const cache = makeCacheMock();
    await cache.writeSuccess('ABC-123', { actors: FEMALE, hasMore: false, fetchedAt: Date.now() });
    const fetchText = vi.fn(async () => { throw new Error('should not fetch'); });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    expect(fetchText).not.toHaveBeenCalled();
    expect(item.querySelector('.x-ap-actor-row-spinner')).toBeNull();
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
  });

  it('失败抑制路径（failed 缓存）不插 pending', async () => {
    const cache = makeCacheMock();
    await cache.writeFailure('ABC-123');
    const fetchText = vi.fn(async () => { throw new Error('should not fetch'); });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    expect(fetchText).not.toHaveBeenCalled();
    expect(item.querySelector('.x-ap-actor-row-spinner')).toBeNull();
    expect(item.querySelector('.x-ap-actor-row-container')).toBeNull();
  });
});

const RATE_LIMIT_HTML = '<html><head><title>429</title></head><body>Too Many Requests</body></html>';

/**
 * F2（10-30-ext-actor-penetration-paging RC-B）：fetchAndParse 原来不查 res.status，
 * 429 body 解析出 0 演员被误判 'empty'（删已有行+不写缓存→重试风暴）。
 * 修复：ActorPenetrationFetchResult 可选 status；login 判定后/parse 前分类：
 * 429/503→'rate-limited'，其余非 2xx→'fetch-error'；无 status（旧注入）跳过分类。
 * F3：rate-limited 分支——保留已有好行（仅清本次 pending 行）、写 60s 回退抑制、
 * 独立埋点 actorPenetration.rateLimited。
 * R2（裁决=选项 A + 并发 2）：runtime 有界 fetch 队列（可注入并发值）+ pop 时刻
 * 视窗优先级（0=严格在视口 / 1=视窗外，seq FIFO 平手）。
 */
describe('F2：fetch status 分类', () => {
  it('429 → rate-limited（写 rate-limited 短缓存，不误判 empty / fetch-error）', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({ html: RATE_LIMIT_HTML, finalUrl: 'https://javdb.com/v/RL1', status: 429 }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'RL-1', detailUrl: '/v/RL-1' });
    expect(writeRateLimited).toHaveBeenCalledWith('RL-1');
    expect(cache.writeFailure).not.toHaveBeenCalled();
    expect(cache.writeSuccess).not.toHaveBeenCalled();
    item.remove();
  });

  it('503 → rate-limited（同 429 处理）', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({ html: '<html><body>unavailable</body></html>', finalUrl: 'https://javdb.com/v/RL2', status: 503 }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'RL-2', detailUrl: '/v/RL-2' });
    expect(writeRateLimited).toHaveBeenCalledWith('RL-2');
    expect(cache.writeFailure).not.toHaveBeenCalled();
    item.remove();
  });

  it('404 → fetch-error（非 2xx 非限流：写失败抑制，不写 rate-limited）', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({ html: '<html><body>not found</body></html>', finalUrl: 'https://javdb.com/v/NE1', status: 404 }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'NE-1', detailUrl: '/v/NE-1' });
    expect(cache.writeFailure).toHaveBeenCalledWith('NE-1');
    expect(writeRateLimited).not.toHaveBeenCalled();
    item.remove();
  });

  it('500 → fetch-error（同 404 处理）', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({ html: '<html><body>server error</body></html>', finalUrl: 'https://javdb.com/v/SE1', status: 500 }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'SE-1', detailUrl: '/v/SE-1' });
    expect(cache.writeFailure).toHaveBeenCalledWith('SE-1');
    expect(writeRateLimited).not.toHaveBeenCalled();
    item.remove();
  });

  it('login 判定优先于 status：302→/login 且 status 429 → login-required', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({ html: LOGIN_HTML, finalUrl: 'https://javdb.com/login', status: 429 }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'LP-1', detailUrl: '/v/LP-1' });
    expect(cache.writeLoginRequired).toHaveBeenCalledWith('LP-1');
    expect(writeRateLimited).not.toHaveBeenCalled();
    item.remove();
  });

  it('旧路径兼容：注入 fetchText 无 status 字段 → 语义不变（有演员仍成功）', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({ html: FEMALE_HTML, finalUrl: 'https://javdb.com/v/LS1' }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'LS-1', detailUrl: '/v/LS-1' });
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    expect(cache.writeSuccess).toHaveBeenCalled();
    expect(writeRateLimited).not.toHaveBeenCalled();
    item.remove();
  });
});

describe('F3：rate-limited 分支（保留好行 + 60s 回退抑制）', () => {
  it('429：清 pending 行（spinner），写 rate-limited，不写成功缓存', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    let resolveFetch!: (v: { html: string; finalUrl?: string; status?: number }) => void;
    const fetchText = vi.fn(() => new Promise<{ html: string; finalUrl?: string; status?: number }>(resolve => {
      resolveFetch = resolve;
    }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    const p = runtime.process({ item, code: 'RLP-1', detailUrl: '/v/RLP-1' });
    await vi.waitFor(() => {
      expect(item.querySelector('.x-ap-actor-row-spinner')).toBeTruthy();
    });
    resolveFetch!({ html: RATE_LIMIT_HTML, status: 429 });
    await p;
    expect(item.querySelector('.x-ap-actor-row-container')).toBeNull(); // pending 行被清
    expect(writeRateLimited).toHaveBeenCalledTimes(1);
    expect(cache.writeSuccess).not.toHaveBeenCalled();
    item.remove();
  });

  it('429：60s 回退抑制期内二次 process 不再请求', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async (code: string) => {
      await cache.writeFailure(code); // 模拟 rate-limited 写入 failed 短缓存（read 路径按 failed 抑制）
    });
    const fetchText = vi.fn(async () => ({ html: RATE_LIMIT_HTML, finalUrl: 'https://javdb.com/v/RLS1', status: 429 }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'RLS-1', detailUrl: '/v/RLS-1' });
    expect(fetchText).toHaveBeenCalledTimes(1);
    await runtime.process({ item, code: 'RLS-1', detailUrl: '/v/RLS-1' });
    expect(fetchText).toHaveBeenCalledTimes(1); // 抑制期内不重发
    item.remove();
  });

  it('429：已有正式演员行（好行）保留，不被删除（RC-B 实锤缺陷 52→51 的修复）', async () => {
    const cache = makeCacheMock();
    const writeRateLimited = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({ html: RATE_LIMIT_HTML, finalUrl: 'https://javdb.com/v/RKG1', status: 429 }));
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, writeRateLimited, bindQuickActions: noopBind });
    const item = makeItem();
    renderActorRow({ item, actors: FEMALE, bindQuickActions: noopBind }); // 预置正式行
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    await runtime.process({ item, code: 'RKG-1', detailUrl: '/v/RKG-1' });
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2); // 好行保留
    expect(writeRateLimited).toHaveBeenCalledTimes(1);
    item.remove();
  });
});

describe('R2：有界 fetch 队列（并发上限 + pop 时刻视窗优先级）', () => {
  const WIN_H = 800;

  function makeRectItem(rect: { top: number; bottom: number }): HTMLElement {
    const item = document.createElement('div');
    item.className = 'item';
    document.body.appendChild(item);
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: rect.top,
      bottom: rect.bottom,
      left: 0,
      right: 300,
      width: 300,
      height: rect.bottom - rect.top,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    } as DOMRect);
    return item;
  }

  function makeHoldingFetch() {
    const gates = new Map<string, (v: { html: string }) => void>();
    const fetchText = vi.fn(
      (url: string) =>
        new Promise<{ html: string; finalUrl?: string }>(resolve => {
          const code = /\/v\/(.+)$/.exec(url)?.[1] ?? '';
          gates.set(code, resolve as (v: { html: string }) => void);
        }),
    );
    return { fetchText, gates };
  }

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('并发上限=2：5 卡入队，任意时刻在途详情请求 ≤2，完成一个补一个', async () => {
    const cache = makeCacheMock();
    const { fetchText, gates } = makeHoldingFetch();
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText,
      bindQuickActions: noopBind,
      maxConcurrency: 2,
      getViewportHeight: () => WIN_H,
    });
    const items = Array.from({ length: 5 }, () => makeRectItem({ top: 10, bottom: 210 }));
    const promises = items.map((item, i) => runtime.process({ item, code: `Q${i}`, detailUrl: `/v/Q${i}` }));

    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(2));
    expect(fetchText).toHaveBeenCalledTimes(2); // 2 在途，3 排队

    const gateQ0 = gates.get('Q0'); if (gateQ0) gateQ0({ html: FEMALE_HTML });
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(3));
    expect(fetchText).toHaveBeenCalledTimes(3); // 只补一个

    // 放走 2 在途（Q1/Q2），让 Q3/Q4 入队并被调（gates 在被调时才注册）
    const g1 = gates.get('Q1'); if (g1) g1({ html: FEMALE_HTML });
    const g2 = gates.get('Q2'); if (g2) g2({ html: FEMALE_HTML });
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(5));

    const g3 = gates.get('Q3'); if (g3) g3({ html: FEMALE_HTML });
    const g4 = gates.get('Q4'); if (g4) g4({ html: FEMALE_HTML });
    await Promise.all(promises);
    expect(fetchText).toHaveBeenCalledTimes(5);
    items.forEach(item => item.remove());
  });

  it('pop 时刻视窗优先级：排队中滚出视口的卡片让位于当前视口内卡片（即使入队更晚）', async () => {
    const cache = makeCacheMock();
    const { fetchText, gates } = makeHoldingFetch();
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText,
      bindQuickActions: noopBind,
      maxConcurrency: 1,
      getViewportHeight: () => WIN_H,
    });
    // 槽位先被 W（此时在视口内）占用；随后用户下滚：C 滚出视口上方，A 进入视口
    const wItem = makeRectItem({ top: 10, bottom: 210 });
    const cItem = makeRectItem({ top: -5000, bottom: -4900 }); // 已划走
    const aItem = makeRectItem({ top: 100, bottom: 300 }); // 当前视口内

    const pW = runtime.process({ item: wItem, code: 'W', detailUrl: '/v/W' });
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(1));
    const pC = runtime.process({ item: cItem, code: 'C', detailUrl: '/v/C' }); // 先排队
    const pA = runtime.process({ item: aItem, code: 'A', detailUrl: '/v/A' }); // 后排队但视口内

    const gateW = gates.get('W'); if (gateW) gateW({ html: FEMALE_HTML });
    await pW;
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(2));
    expect(fetchText.mock.calls[1][0]).toContain('/v/A'); // A 先于 C（优先级 0 < 1）

    const gateA = gates.get('A'); if (gateA) gateA({ html: FEMALE_HTML });
    await pA;
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(3));
    expect(fetchText.mock.calls[2][0]).toContain('/v/C');

    const gateC = gates.get('C'); if (gateC) gateC({ html: FEMALE_HTML });
    await pC;
    [wItem, cItem, aItem].forEach(item => item.remove());
  });

  it('同优先级 FIFO：视窗外卡片按入队顺序取队列', async () => {
    const cache = makeCacheMock();
    const { fetchText, gates } = makeHoldingFetch();
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText,
      bindQuickActions: noopBind,
      maxConcurrency: 1,
      getViewportHeight: () => WIN_H,
    });
    const wItem = makeRectItem({ top: 10, bottom: 210 });
    const dItem = makeRectItem({ top: -5000, bottom: -4900 });
    const eItem = makeRectItem({ top: 900, bottom: 1100 });

    const pW = runtime.process({ item: wItem, code: 'W', detailUrl: '/v/W' });
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(1));
    const pD = runtime.process({ item: dItem, code: 'D', detailUrl: '/v/D' });
    const pE = runtime.process({ item: eItem, code: 'E', detailUrl: '/v/E' });

    const gateW = gates.get('W'); if (gateW) gateW({ html: FEMALE_HTML });
    await pW;
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(2));
    expect(fetchText.mock.calls[1][0]).toContain('/v/D'); // D 先入队

    const gateD = gates.get('D'); if (gateD) gateD({ html: FEMALE_HTML });
    await pD;
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(3));
    expect(fetchText.mock.calls[2][0]).toContain('/v/E');

    const gateE = gates.get('E'); if (gateE) gateE({ html: FEMALE_HTML });
    await pE;
    [wItem, dItem, eItem].forEach(item => item.remove());
  });

  it('reset：排队中的任务作废（不发起请求），对应 process() promise 不悬挂', async () => {
    const cache = makeCacheMock();
    const { fetchText, gates } = makeHoldingFetch();
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText,
      bindQuickActions: noopBind,
      maxConcurrency: 1,
      getViewportHeight: () => WIN_H,
    });
    const wItem = makeRectItem({ top: 10, bottom: 210 });
    const cItem = makeRectItem({ top: -5000, bottom: -4900 });
    const aItem = makeRectItem({ top: 100, bottom: 300 });

    const pW = runtime.process({ item: wItem, code: 'W', detailUrl: '/v/W' });
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(1));
    const pC = runtime.process({ item: cItem, code: 'C', detailUrl: '/v/C' });
    const pA = runtime.process({ item: aItem, code: 'A', detailUrl: '/v/A' });

    // 等 C/A 真正入队（process 异步，入队在 readCache await 之后的微任务）
    await vi.waitFor(() => {
      const queue = (runtime as unknown as { fetchQueue: unknown[] }).fetchQueue;
      expect(queue.length).toBe(2);
    });

    runtime.reset(); // 排队 C/A 作废
    await Promise.all([pC, pA]); // 不悬挂
    expect(fetchText).toHaveBeenCalledTimes(1); // 只有 W 在途

    const gateW = gates.get('W'); if (gateW) gateW({ html: FEMALE_HTML });
    await pW;
    [wItem, cItem, aItem].forEach(item => item.remove());
  });
});
