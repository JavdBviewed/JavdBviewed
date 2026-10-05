/**
 * @file collectionQuickActionsManager.test.ts
 * @description 影片页实体快捷收藏（番号/導演/片商/系列）DOM 回归锁（10-05-collection-makers-directors）
 *   - 仅 .movie-panel-info 内四实体链接被绑定，非实体链接零绑定
 *   - hover 出浮窗 → 点击收藏 POST /{entity}/{id}/collect（CSRF 头三段 fallback）
 *   - POST 成功显示已收藏态；失败轻 toast；永不自动取消（无取消入口）
 *   - destroy 回收全部绑定/浮窗/样式
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/extension/src/platform/browser/toast', () => ({
  showToast: vi.fn(),
}));

import {
  COLLECTION_QUICK_ACTIONS_BOUND_ATTR,
  COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR,
  collectionQuickActionsManager,
  extractCSRFToken,
} from '../../apps/extension/src/features/collectionQuick';
import { showToast } from '../../apps/extension/src/platform/browser/toast';

const ORIGIN = 'https://javdb.com';

function makePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'movie-panel-info';
  document.body.appendChild(panel);
  return panel;
}

function makeLink(panel: HTMLElement, href: string, text = 'X'): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  panel.appendChild(a);
  return a;
}

describe('影片页实体快捷收藏 manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    // 模拟 CSRF meta 在位
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'csrf-token');
    meta.setAttribute('content', 'tok-123');
    document.head.appendChild(meta);
  });

  afterEach(() => {
    collectionQuickActionsManager.destroy();
    try { vi.runOnlyPendingTimers(); } catch { /* 时钟已释放 */ }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.clearAllMocks();
  });

  it('仅绑定四实体链接：演员/视频页等非实体链接零绑定', () => {
    const panel = makePanel();
    const maker = makeLink(panel, `${ORIGIN}/makers/AEO`, 'AEO');
    const director = makeLink(panel, `${ORIGIN}/directors/dekM`, 'dekM');
    const code = makeLink(panel, `${ORIGIN}/video_codes/SORA`, 'SORA');
    const series = makeLink(panel, `${ORIGIN}/series/gr8A`, 'gr8A');
    const actor = makeLink(panel, `${ORIGIN}/actors/abc123`, '演员名');
    const video = makeLink(panel, `${ORIGIN}/v/ABC-123`, '影片');
    const user = makeLink(panel, `${ORIGIN}/users/collection_makers`, '我的收藏');

    collectionQuickActionsManager.enhanceEntityLink(maker);
    collectionQuickActionsManager.enhanceEntityLink(director);
    collectionQuickActionsManager.enhanceEntityLink(code);
    collectionQuickActionsManager.enhanceEntityLink(series);
    collectionQuickActionsManager.enhanceEntityLink(actor);
    collectionQuickActionsManager.enhanceEntityLink(video);
    collectionQuickActionsManager.enhanceEntityLink(user);

    expect(maker.getAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe('true');
    expect(director.getAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe('true');
    expect(code.getAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe('true');
    expect(series.getAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe('true');
    expect(actor.hasAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe(false);
    expect(video.hasAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe(false);
    expect(user.hasAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe(false);
  });

  it('hover 片商链接 300ms 出浮窗；点击收藏 POST /makers/AEO/collect 带 CSRF 头；成功显示已收藏态', async () => {
    const panel = makePanel();
    const maker = makeLink(panel, `${ORIGIN}/makers/AEO`, 'AEO');
    collectionQuickActionsManager.enhanceEntityLink(maker);

    maker.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(document.querySelector(COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR)).toBeNull();
    vi.advanceTimersByTime(300);
    const tooltip = document.querySelector(COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR) as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.textContent).toContain('AEO');

    const btn = tooltip.querySelector('button') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    await Promise.resolve();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/makers/AEO/collect`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = (init.headers || {}) as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('tok-123');
    expect(headers['X-Requested-With']).toBe('XMLHttpRequest');
    await Promise.resolve();
    await Promise.resolve();
    expect(tooltip.textContent).toContain('已收藏');
    expect(tooltip.querySelector('button[disabled]')).not.toBeNull();
  });

  it('POST 失败轻 toast 且保留可重试（不置已收藏态）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const panel = makePanel();
    const director = makeLink(panel, `${ORIGIN}/directors/dekM`, 'dekM');
    collectionQuickActionsManager.enhanceEntityLink(director);
    director.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(300);
    const tooltip = document.querySelector(COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR) as HTMLElement;
    (tooltip.querySelector('button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(tooltip.textContent).not.toContain('已收藏');
  });

  it('destroy 回收浮窗与绑定标记（可重新绑定）', () => {
    const panel = makePanel();
    const maker = makeLink(panel, `${ORIGIN}/makers/AEO`, 'AEO');
    collectionQuickActionsManager.enhanceEntityLink(maker);
    maker.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(document.querySelector(COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR)).not.toBeNull();
    collectionQuickActionsManager.destroy();
    expect(document.querySelector(COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR)).toBeNull();
    expect(maker.hasAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe(false);
    // 可重新绑定
    collectionQuickActionsManager.enhanceEntityLink(maker);
    expect(maker.getAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)).toBe('true');
  });
});

describe('extractCSRFToken 三段 fallback', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('meta[name=csrf-token] 优先', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'csrf-token');
    meta.setAttribute('content', 'tok-meta');
    document.head.appendChild(meta);
    expect(extractCSRFToken()).toBe('tok-meta');
  });

  it('无 meta 时回落 input[name=authenticity_token]', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.setAttribute('name', 'authenticity_token');
    input.setAttribute('value', 'tok-input');
    form.appendChild(input);
    document.body.appendChild(form);
    expect(extractCSRFToken()).toBe('tok-input');
  });

  it('两段皆无时返回 null（POST 继续不带 CSRF 头，best-effort）', () => {
    expect(extractCSRFToken()).toBeNull();
  });
});
