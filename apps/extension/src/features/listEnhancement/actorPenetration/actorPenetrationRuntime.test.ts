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
