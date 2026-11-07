import type { CrosslinePageContext, CrosslineLoginState } from '../../shared/protocols/crosslineSession';
import { copyVerifiedCrosslineSession, isUsableSession, mirrorHost, readCookies, readEnabled, readEnabledHosts } from './crosslineCookieBridge';
import { classifyJavdbLoginHtml, JAVDB_LOGIN_REDIRECT } from './javdbLoginVerification';
import { withReadOnlyCrosslineProbe } from './crosslineReadOnlyProbe';
import { createCrosslinePromptService } from './crosslinePromptService';
import { readCrosslineStorage, withCrosslineProbeGuard, writeCrosslineStorage } from './crosslineSessionGuards';

export function getCrosslineCookieStores(): Promise<chrome.cookies.CookieStore[]> {
  return new Promise((resolve, reject) => chrome.cookies.getAllCookieStores(stores => {
    if (chrome.runtime.lastError) reject(new Error('读取浏览器存储区失败')); else resolve(stores);
  }));
}
export async function isCrosslinePageCurrent(ctx: CrosslinePageContext): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(ctx.tabId);
    if (!tab.url || new URL(tab.url).origin !== ctx.origin || !!tab.incognito !== ctx.incognito || !ctx.documentId) return false;
    if (tab.pendingUrl && new URL(tab.pendingUrl).origin !== ctx.origin) return false;
    const stores = await getCrosslineCookieStores();
    if (!stores.some(store => store.id === ctx.storeId && store.tabIds.includes(ctx.tabId))) return false;
    const result = await chrome.scripting.executeScript({ target: { tabId: ctx.tabId, documentIds: [ctx.documentId] },
      world: 'ISOLATED', func: () => location.origin });
    return result[0]?.result === ctx.origin;
  } catch { return false; }
}
export async function crosslineCookieSnapshot(ctx: CrosslinePageContext, host: string): Promise<string> {
  const cookies = [...await readCookies(`https://${host}/`, ctx.storeId), ...await readCookies(`https://www.${host}/`, ctx.storeId)]
    .filter(cookie => isUsableSession(cookie) && mirrorHost(cookie.domain) === host);
  if (!cookies.length) return '';
  return JSON.stringify([...new Set(cookies.map(c => JSON.stringify([c.domain, c.path, c.value])))].sort());
}

/** Runs in the site's isolated world; returns structural markers only, never account text/HTML. */
async function probeAccountInPage(loginRedirectPattern: string, urls: { profile: string; login: string }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const options: RequestInit = { credentials: 'include', cache: 'no-store', redirect: 'manual', signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' } };
    let response = await fetch(urls.profile, options);
    let text = await response.text();
    if (response.type === 'opaqueredirect' || (response.ok && new URL(response.url).origin === location.origin && new RegExp(loginRedirectPattern).test(text))) {
      response = await fetch(urls.login, options); text = await response.text();
    }
    const doc = new DOMParser().parseFromString(text, 'text/html');
    doc.querySelectorAll('script,style,template').forEach(node => node.remove());
    let html = /cf-challenge|challenge-form|cf-chl-|just a moment|checking your browser/i.test(doc.documentElement.outerHTML) ? '<div id="cf-challenge"></div>' : '';
    for (const element of doc.querySelectorAll('a[href],form[action]')) {
      const attr = element.tagName === 'A' ? 'href' : 'action';
      try {
        const url = new URL(element.getAttribute(attr) || '', response.url);
        if (url.origin !== location.origin || !/^\/(?:users\/(?:profile|want_watch_videos|watched_videos|sign[_-]?in|sign[_-]?out|logout)|login|logout|sign[_-]?in|sign[_-]?out)\/?$/.test(url.pathname)) continue;
        const tag = element.tagName.toLowerCase(); html += `<${tag} ${attr}="${url.pathname}"></${tag}>`;
      } catch { /* Invalid link is not evidence. */ }
    }
    if (doc.querySelector('input[type="password"]')) html += '<input type="password">';
    return { html, url: response.url, status: response.status, origin: location.origin };
  } finally { clearTimeout(timer); }
}
export async function verifyCrosslineAccount(ctx: CrosslinePageContext, host: string): Promise<CrosslineLoginState> {
  return withCrosslineProbeGuard([host], ctx.storeId, async () => {
    const origin = host === ctx.targetHost ? ctx.origin : `https://${host}`;
    return withReadOnlyCrosslineProbe(origin, async urls => {
      // A service worker fetch uses its own cookie store. Never use it for an incognito tab.
      if (!ctx.incognito) {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const options: RequestInit = { credentials: 'include', cache: 'no-store', redirect: 'manual', signal: controller.signal,
            headers: { Accept: 'text/html,application/xhtml+xml' } };
          let res = await fetch(urls.profile, options);
          let html = await res.text();
          // Follow only the site's exact, fixed login wall; do not execute returned scripts or follow arbitrary URLs.
          if (res.type === 'opaqueredirect' || (res.ok && new URL(res.url).origin === origin && JAVDB_LOGIN_REDIRECT.test(html))) {
            res = await fetch(urls.login, options); html = await res.text();
          }
          const state = classifyJavdbLoginHtml({ html, status: res.status, url: res.url, origin });
          if (state !== 'unknown') return state;
        } catch { /* A first-party tab may work when background requests are blocked. */ }
        finally { clearTimeout(timer); }
      }
      const stores = await getCrosslineCookieStores();
      const ids = stores.find(store => store.id === ctx.storeId)?.tabIds || [];
      const tabs = await chrome.tabs.query({ url: `${origin}/*` });
      const tab = tabs.find(candidate => typeof candidate.id === 'number' && ids.includes(candidate.id) && !!candidate.incognito === ctx.incognito);
      if (typeof tab?.id !== 'number') return 'unknown';
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', func: probeAccountInPage, args: [JAVDB_LOGIN_REDIRECT.source, urls] });
        const evidence = results[0]?.result;
        return evidence && evidence.origin === origin ? classifyJavdbLoginHtml(evidence) : 'unknown';
      } catch { return 'unknown'; }
    });
  });
}
export const crosslinePromptService = createCrosslinePromptService({
  now: () => Date.now(), id: () => crypto.randomUUID(), enabled: readEnabled,
  hosts: readEnabledHosts, current: isCrosslinePageCurrent, snapshot: crosslineCookieSnapshot,
  verify: verifyCrosslineAccount, read: readCrosslineStorage, write: writeCrosslineStorage,
  copy: (ctx, source, before) => copyVerifiedCrosslineSession(source, ctx.targetHost, ctx.storeId, before,
    async () => await isCrosslinePageCurrent(ctx) ? verifyCrosslineAccount(ctx, ctx.targetHost) : 'unknown'),
});

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.javdbCrosslineSessionEnabled)) crosslinePromptService.invalidate();
  });
}
