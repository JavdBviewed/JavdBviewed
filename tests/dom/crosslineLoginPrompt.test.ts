import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installCrosslineLoginPrompt } from '../../apps/extension/src/apps/content/crosslineLoginPrompt';
let dispose = () => {};
let messages: Record<string, unknown>[];
beforeEach(() => {
  messages = [];
  document.body.innerHTML = '<nav id="navbar-menu-user"><div class="navbar-end"><a href="https://javdb575.com/login">登录</a></div></nav>';
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.stubGlobal('chrome', { runtime: { lastError: undefined, sendMessage: (message: Record<string, unknown>, cb: (v: unknown) => void) => {
    messages.push(message);
    if (message.type === 'JAVDB_CROSSLINE_PAGE:STATUS') cb({ success: true, status: { enabled: true, targetHost: 'javdb575.com', targetState: 'anonymous', sources: [{ host: 'javdb.com' }, { host: 'javdb570.com' }], offerId: 'offer' } });
    else if (message.type === 'JAVDB_CROSSLINE_PAGE:CLAIM') cb({ success: true, show: true });
    else cb({ success: true });
  } }, storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
});
afterEach(() => { dispose(); vi.unstubAllGlobals(); });
it('mounts only once near the login link and offers sources without exposing account data', async () => {
  dispose = installCrosslineLoginPrompt({ origin: 'https://javdb575.com' });
  await vi.waitFor(() => expect(document.querySelectorAll('.javdb-ext-crossline')).toHaveLength(1));
  const button = document.querySelector<HTMLButtonElement>('.javdb-ext-crossline-trigger');
  button?.click();
  await vi.waitFor(() => expect(document.querySelectorAll('.javdb-ext-crossline select option:not([disabled])')).toHaveLength(2));
  expect(document.querySelector('.javdb-ext-crossline')?.textContent).toContain('暂不提醒');
  document.querySelector<HTMLButtonElement>('.javdb-ext-crossline-dismiss')?.click();
  await vi.waitFor(() => expect(messages.some(m => m.type === 'JAVDB_CROSSLINE_PAGE:DISMISS')).toBe(true));
  expect(document.querySelector<HTMLElement>('.javdb-ext-crossline-panel')?.hidden).toBe(true);
});
it('does not request credentials or render a prompt when current page is logged in', async () => {
  document.body.innerHTML = '<nav id="navbar-menu-user"><a href="https://javdb575.com/users/profile">用户</a><a href="https://javdb575.com/logout">退出</a></nav>';
  dispose = installCrosslineLoginPrompt({ origin: 'https://javdb575.com' });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(messages).toEqual([]);
  expect(document.querySelector('.javdb-ext-crossline')).toBeNull();
});
it('removes its UI and ignores a late response when disposed', async () => {
  let complete: ((v: unknown) => void) | undefined;
  chrome.runtime.sendMessage = vi.fn((_m, cb) => { complete = cb; }) as typeof chrome.runtime.sendMessage;
  dispose = installCrosslineLoginPrompt({ origin: 'https://javdb575.com' });
  dispose();
  complete?.({ success: true, status: { enabled: true, targetHost: 'javdb575.com', targetState: 'anonymous', sources: [{ host: 'javdb.com' }], offerId: 'late' } });
  await Promise.resolve();
  expect(document.querySelector('.javdb-ext-crossline')).toBeNull();
});
it('keeps the site logout untouched and does not trust a synthetic click', async () => {
  document.body.innerHTML = '<nav id="navbar-menu-user"><a href="https://javdb575.com/users/profile">用户</a><a href="https://javdb575.com/logout">退出</a></nav>';
  dispose = installCrosslineLoginPrompt({ origin: 'https://javdb575.com' });
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  let preventedByFeature: boolean | undefined;
  document.addEventListener('click', click => { preventedByFeature = click.defaultPrevented; click.preventDefault(); }, { once: true });
  document.querySelector('a[href$="logout"]')?.dispatchEvent(event);
  expect(preventedByFeature).toBe(false);
  expect(messages).toEqual([]);
});
it('does not probe without a recognized menu, then mounts when navigation becomes available', async () => {
  document.body.replaceChildren();
  dispose = installCrosslineLoginPrompt({ origin: 'https://javdb575.com' });
  expect(messages).toEqual([]);
  document.body.innerHTML = '<nav id="navbar-menu-user"><div class="navbar-end"><a href="https://javdb575.com/login">登录</a></div></nav>';
  await vi.waitFor(() => expect(document.querySelectorAll('.javdb-ext-crossline')).toHaveLength(1));
});
it('restores once after a BFCache pagehide/pageshow cycle', async () => {
  dispose = installCrosslineLoginPrompt({ origin: 'https://javdb575.com' });
  await vi.waitFor(() => expect(document.querySelectorAll('.javdb-ext-crossline')).toHaveLength(1));
  window.dispatchEvent(new Event('pagehide'));
  expect(document.querySelector('.javdb-ext-crossline')).toBeNull();
  window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('pageshow'));
  await vi.waitFor(() => expect(document.querySelectorAll('.javdb-ext-crossline')).toHaveLength(1));
});
it('does not consume the auto-expansion slot for a hidden menu', async () => {
  dispose = installCrosslineLoginPrompt({ origin: 'https://javdb575.com' });
  await vi.waitFor(() => expect(document.querySelectorAll('.javdb-ext-crossline')).toHaveLength(1));
  // JSDOM has no layout, so the anchor has zero client rects.
  expect(messages.some(message => message.type === 'JAVDB_CROSSLINE_PAGE:CLAIM')).toBe(false);
});
