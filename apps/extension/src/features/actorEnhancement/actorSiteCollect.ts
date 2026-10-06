/**
 * @file actorSiteCollect.ts
 * @description 演员收藏：拓展 → 站点单向 collect（10-05-actor-site-collect）
 *   - POST {origin}/actors/{id}/collect（uncollect 端点仅登记、本线永不调用）
 *   - CSRF：复用 collectionQuick/entityCollect.extractCSRFToken（meta[name=csrf-token] 三段 fallback）
 *   - 头：X-Requested-With: XMLHttpRequest + X-CSRF-Token（token 在位时）+ credentials: include
 *   - 双判（2xx + 按钮 DOM 翻转）：
 *       主 = 2xx 且响应为 JS → <script> 注入 MAIN world 执行（与点站点自家按钮字节等价）+ 6s 观察翻转；
 *       兜底 = 非 JS 响应 / 观察窗口内未翻转 → 手动切换两锚点 visible（零远程码执行、不得抛错）。
 *   - 翻转来源（site-applied / manual / none）进返回值并 console 留痕；本函数永不抛错。
 * @module features/actorEnhancement
 */

import { extractCSRFToken } from '../collectionQuick/entityCollect';

/** 站点演员页 collect 按钮锚点（10-05-actor-site-collect 570 真机侦察：双锚点同在初始 HTML，visible 切换） */
export const ACTOR_COLLECT_BTN_ID = 'button-collect-actor';
/** 站点演员页 uncollect 按钮锚点（只读判定用；对应端点仅登记、永不调用） */
const UNCOLLECT_ANCHOR_ID = 'button-uncollect-actor';

/** 站点 POST 超时（ms） */
export const ACTOR_SITE_POST_TIMEOUT_MS = 8000;
/** JS 注入后翻转观察窗口（ms） */
export const ACTOR_SITE_FLIP_WATCH_MS = 6000;
/** 翻转观察轮询步长（ms） */
export const ACTOR_SITE_FLIP_POLL_MS = 250;

export type ActorSiteCollectSource = 'site-applied' | 'manual' | 'none';

export interface ActorSiteCollectResult {
  ok: boolean;
  source: ActorSiteCollectSource;
  reason?: string;
}

export interface ActorSiteCollectDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => string | null;
  doc?: Document;
  origin?: string;
  postTimeoutMs?: number;
  flipWatchMs?: number;
  flipPollMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  applySiteScript?: (doc: Document, text: string) => boolean;
}

/** 构造 collect 端点：{origin}/actors/{id}/collect（id 走 encodeURIComponent） */
export function buildActorCollectUrl(actorId: string, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/actors/${encodeURIComponent(actorId)}/collect`;
}

function isHiddenEl(el: Element | null | undefined): boolean {
  if (!el) return true;
  try {
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('hidden')) return true;
    const style = (el as HTMLElement).style;
    if (style && style.display === 'none') return true;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      if (window.getComputedStyle(el).display === 'none') return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * 读站点收藏态（双锚点可见性）：
 *   true = 站点已收藏（uncollect 锚点可见）；false = 未收藏；null = 无锚点（非演员页形态）。
 */
export function readSiteCollectedState(doc: Document): boolean | null {
  try {
    const collect = doc.getElementById(ACTOR_COLLECT_BTN_ID) as HTMLElement | null;
    const uncollect = doc.getElementById(UNCOLLECT_ANCHOR_ID) as HTMLElement | null;
    if (!collect && !uncollect) return null;
    return !isHiddenEl(uncollect);
  } catch {
    return null;
  }
}

/**
 * manual 兜底：手动切换两锚点 visible 为「已收藏」形态（零远程码执行、不得抛错）。
 * 返回 true = 存在锚点且切换完成；false = 无锚点（或异常，已吞）。
 */
export function applyCollectedStateManual(doc: Document): boolean {
  try {
    const collect = doc.getElementById(ACTOR_COLLECT_BTN_ID) as HTMLElement | null;
    const uncollect = doc.getElementById(UNCOLLECT_ANCHOR_ID) as HTMLElement | null;
    if (!collect && !uncollect) return false;
    if (uncollect) {
      uncollect.removeAttribute('hidden');
      uncollect.style.display = '';
    }
    if (collect) {
      collect.setAttribute('hidden', '');
      collect.style.display = 'none';
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * MAIN world 注入：站点返回的 JS 以 <script> 文本挂入 head 执行（与站点自家按钮点击字节等价）。
 * 返回 true = 注入完成；false = 无文本或异常（已吞）。
 */
export function injectSiteScript(doc: Document, text: string): boolean {
  try {
    if (!text) return false;
    const script = doc.createElement('script');
    script.textContent = text;
    const parent = (doc.head as HTMLElement | null) || doc.documentElement;
    parent.appendChild(script);
    script.remove();
    return true;
  } catch {
    return false;
  }
}

function safeOrigin(): string {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      return window.location.origin;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * 站点 collect（best-effort，永不抛错）：
 *   入参守卫 → CSRF → POST（超时中止）→ 非 2xx 即败 → 2xx 后双判翻转
 *   （JS 注入 + 观察窗口 → manual 兜底 → 无锚点 none）。
 */
export async function collectActorOnSite(
  actorId: string,
  originArg: string = safeOrigin(),
  deps: ActorSiteCollectDeps = {},
): Promise<ActorSiteCollectResult> {
  try {
    if (!actorId) return { ok: false, source: 'none', reason: 'no-actor-id' };
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      return { ok: false, source: 'none', reason: 'fetch-unavailable' };
    }
    const origin = deps.origin ?? originArg;
    if (!origin) return { ok: false, source: 'none', reason: 'no-origin' };

    let token: string | null = null;
    try {
      token = (deps.getToken ?? extractCSRFToken)();
    } catch {
      token = null;
    }
    const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
    if (token) headers['X-CSRF-Token'] = token;

    const controller = new AbortController();
    const postTimeoutMs = deps.postTimeoutMs ?? ACTOR_SITE_POST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), postTimeoutMs);
    let resp: Response;
    try {
      resp = await (fetchImpl as typeof fetch)(buildActorCollectUrl(actorId, origin), {
        method: 'POST',
        credentials: 'include',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      return { ok: false, source: 'none', reason: 'network-or-timeout' };
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      return { ok: false, source: 'none', reason: `http-${resp.status}` };
    }

    let text = '';
    let contentType = '';
    try {
      contentType = resp.headers.get('content-type') || '';
      text = await resp.text();
    } catch {
      return { ok: false, source: 'none', reason: 'network-or-timeout' };
    }

    let doc: Document | undefined = deps.doc;
    if (!doc && typeof document !== 'undefined') doc = document;
    if (!doc) return { ok: true, source: 'none' };

    const isJs = /javascript/i.test(contentType);
    const applySiteScript = deps.applySiteScript ?? injectSiteScript;
    if (isJs && text) {
      applySiteScript(doc, text);
    }

    const sleep = deps.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const watchMs = deps.flipWatchMs ?? ACTOR_SITE_FLIP_WATCH_MS;
    const pollMs = deps.flipPollMs ?? ACTOR_SITE_FLIP_POLL_MS;
    const deadline = Date.now() + watchMs;
    for (;;) {
      if (readSiteCollectedState(doc) === true) {
        console.log('[ActorSiteCollect] 站点态翻转完成（site-applied）:', actorId);
        return { ok: true, source: 'site-applied' };
      }
      if (Date.now() >= deadline) break;
      await sleep(Math.min(pollMs, deadline - Date.now()));
    }
    if (readSiteCollectedState(doc) === true) {
      console.log('[ActorSiteCollect] 站点态翻转完成（site-applied，观察窗口尾）:', actorId);
      return { ok: true, source: 'site-applied' };
    }

    const manual = applyCollectedStateManual(doc);
    if (manual) {
      console.log('[ActorSiteCollect] 站点态翻转完成（manual 兜底）:', actorId);
      return { ok: true, source: 'manual' };
    }
    return { ok: true, source: 'none' };
  } catch (e) {
    console.warn('[ActorSiteCollect] collect 异常（best-effort，不抛错）:', e);
    return { ok: false, source: 'none', reason: 'unexpected' };
  }
}
