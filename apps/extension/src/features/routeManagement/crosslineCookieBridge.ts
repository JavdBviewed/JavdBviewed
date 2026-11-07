/** JavDB 镜像站点的本机登录态补写；不处理 Cloudflare 挑战 cookie。 */
import { createDefaultRouteSettings } from './defaultRoutes';

const MIRROR_HOSTS = ['javdb.com', 'javdb570.com', 'javdb575.com'] as const;
const previousSessions = new Map<string, { value: string; time: number }>();

function sourceKey(cookie: chrome.cookies.Cookie): string {
  return `${cookie.storeId}:${mirrorHost(cookie.domain)}`;
}

function mirrorHost(domain: string): (typeof MIRROR_HOSTS)[number] | null {
  const host = domain.toLowerCase().replace(/^\./, '');
  return MIRROR_HOSTS.find(mirror => host === mirror || host === `www.${mirror}`) ?? null;
}

function isUsableSession(cookie: chrome.cookies.Cookie): boolean {
  return cookie.name === '_jdb_session' && !!cookie.value && cookie.path === '/' &&
    !cookie.partitionKey && (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000) &&
    mirrorHost(cookie.domain) !== null;
}

function readCookies(url: string, storeId?: string): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({ url, ...(storeId ? { storeId } : {}) }, cookies => {
      if (chrome.runtime.lastError) reject(new Error('读取 JavDB cookie 失败'));
      else resolve(cookies ?? []);
    });
  });
}

function readEnabledHosts(): Promise<(typeof MIRROR_HOSTS)[number][]> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('settings', result => {
      if (chrome.runtime.lastError) {
        reject(new Error('读取 JavDB 线路设置失败'));
        return;
      }
      const defaults = createDefaultRouteSettings().javdb;
      const routes = (result?.settings as { routes?: { javdb?: typeof defaults } } | undefined)?.routes?.javdb ?? defaults;
      const urls = [routes.primary, ...(routes.alternatives ?? [])
        .filter((alt: { enabled: boolean }) => alt.enabled)
        .map((alt: { url: string }) => alt.url)];
      const enabled = new Set(urls.flatMap(url => {
        try {
          const parsed = new URL(url);
          const host = mirrorHost(parsed.hostname);
          return parsed.protocol === 'https:' && host ? [host] : [];
        } catch { return []; }
      }));
      resolve(MIRROR_HOSTS.filter(host => enabled.has(host)));
    });
  });
}

function readAllSessions(): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({ name: '_jdb_session' }, cookies => {
      if (chrome.runtime.lastError) reject(new Error('读取 JavDB 会话失败'));
      else resolve(cookies ?? []);
    });
  });
}

function writeCookie(url: string, domain: string, cookie: chrome.cookies.Cookie): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.cookies.set({
      url, domain: `.${domain}`, name: cookie.name, value: cookie.value, path: '/',
      httpOnly: cookie.httpOnly, secure: true, sameSite: cookie.sameSite,
      ...(cookie.session ? {} : { expirationDate: cookie.expirationDate }),
      ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    }, result => {
      if (chrome.runtime.lastError || !result) reject(new Error('写入 JavDB cookie 失败'));
      else resolve();
    });
  });
}

function removeCookie(cookie: chrome.cookies.Cookie): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.cookies.remove({
      url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
      name: cookie.name,
      storeId: cookie.storeId,
    }, () => {
      if (chrome.runtime.lastError) reject(new Error('删除 JavDB cookie 失败'));
      else resolve();
    });
  });
}

/** 只补齐缺失会话或本次明确轮换的旧副本；不覆盖独立会话。 */
export async function bridgeJavdbSessionCookie(session: chrome.cookies.Cookie, previousValue?: string): Promise<void> {
  if (!isUsableSession(session)) return;
  const source = mirrorHost(session.domain);
  if (!source) return;
  const enabledHosts = await readEnabledHosts();
  if (!enabledHosts.includes(source)) return;
  const sourceCookies = await readCookies(`https://${session.domain.replace(/^\./, '')}/`, session.storeId);
  if (!sourceCookies.some(cookie => isUsableSession(cookie) && cookie.value === session.value)) return;
  const ageGate = sourceCookies.find(cookie => cookie.name === 'over18' && cookie.value &&
    !cookie.partitionKey && cookie.path === '/' &&
    (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000));

  const targets = await Promise.all(enabledHosts.filter(host => host !== source).map(async target => ({
    target,
    existing: [
      ...await readCookies(`https://${target}/`, session.storeId),
      ...await readCookies(`https://www.${target}/`, session.storeId),
    ],
  })));
  if (targets.some(({ existing }) => existing.some(cookie =>
    isUsableSession(cookie) && cookie.value !== session.value && cookie.value !== previousValue))) {
    console.info('[JavDB crossline] 已跳过同步：目标线路存在独立会话', { source });
    return;
  }

  for (const { target, existing } of targets) {
    const targetSession = existing.find(cookie => cookie.name === '_jdb_session');
    if (targetSession && targetSession.value !== session.value && targetSession.value !== previousValue) continue;
    const url = `https://${target}/`;
    if (!targetSession || targetSession.value === previousValue) {
      await writeCookie(url, target, session);
      console.info('[JavDB crossline] 会话已同步', { source, target });
    }
    if (ageGate && !existing.some(cookie => cookie.name === 'over18')) {
      await writeCookie(url, target, ageGate);
    }
  }
}

async function reconcileStoredSessions(): Promise<void> {
  const enabled = await readEnabledHosts();
  if (enabled.length < 2) return;
  const sessions = (await readAllSessions()).filter(cookie =>
    isUsableSession(cookie) && enabled.includes(mirrorHost(cookie.domain) as (typeof MIRROR_HOSTS)[number]));
  const byStore = new Map<string, chrome.cookies.Cookie[]>();
  for (const cookie of sessions) {
    const group = byStore.get(cookie.storeId) ?? [];
    group.push(cookie);
    byStore.set(cookie.storeId, group);
  }
  for (const group of byStore.values()) {
    if (new Set(group.map(cookie => cookie.value)).size !== 1) {
      console.info('[JavDB crossline] 已跳过启动同步：线路存在不同会话');
      continue;
    }
    await bridgeJavdbSessionCookie(group[0]);
  }
}

async function clearMatchingMirrorSessions(session: chrome.cookies.Cookie): Promise<void> {
  if (!isUsableSession(session)) return;
  const source = mirrorHost(session.domain);
  if (!source) return;
  const enabledHosts = await readEnabledHosts();
  if (!enabledHosts.includes(source)) return;
  const current = await readCookies(`https://${session.domain.replace(/^\./, '')}/`, session.storeId);
  if (current.some(cookie => isUsableSession(cookie) && cookie.value === session.value)) return;
  const targets = await Promise.all(enabledHosts.filter(host => host !== source).flatMap(host => [
    readCookies(`https://${host}/`, session.storeId),
    readCookies(`https://www.${host}/`, session.storeId),
  ]));
  const seen = new Set<string>();
  for (const cookie of targets.flat()) {
    if (!isUsableSession(cookie) || cookie.value !== session.value) continue;
    const key = `${cookie.storeId}:${cookie.domain}:${cookie.path}:${cookie.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await removeCookie(cookie);
  }
}

let listener: ((change: chrome.cookies.CookieChangeInfo) => void) | null = null;
let settingsListener: ((changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void) | null = null;
let pending: Promise<void> = Promise.resolve();

function reportBridgeError(error: unknown): void {
  console.warn('[JavDB crossline] cookie 操作失败', {
    reason: error instanceof Error ? error.message : 'unknown',
  });
}

/** 首次启动和线路配置变更补齐已有会话，之后监听新登录和登出。 */
export function initJavdbCrosslineCookieBridge(): void {
  if (typeof chrome === 'undefined' || !chrome.cookies?.onChanged || !chrome.storage?.onChanged) return;
  if (listener) chrome.cookies.onChanged.removeListener(listener);
  if (settingsListener) chrome.storage.onChanged.removeListener(settingsListener);
  listener = change => {
    const cookie = change.cookie;
    if (change.removed) {
      if (change.cause === 'overwrite' && isUsableSession(cookie)) {
        previousSessions.set(sourceKey(cookie), { value: cookie.value, time: Date.now() });
      }
      if (change.cause === 'explicit' && isUsableSession(cookie)) {
        pending = pending.then(() => clearMatchingMirrorSessions(cookie)).catch(reportBridgeError);
      }
      return;
    }
    if (cookie.name === 'over18' && mirrorHost(cookie.domain)) {
      pending = pending.then(async () => {
        const cookies = await readCookies(`https://${cookie.domain.replace(/^\./, '')}/`, cookie.storeId);
        const activeSession = cookies.find(isUsableSession);
        if (activeSession) await bridgeJavdbSessionCookie(activeSession);
      }).catch(reportBridgeError);
      return;
    }
    if (!isUsableSession(cookie)) return;
    const previous = previousSessions.get(sourceKey(cookie));
    const previousValue = previous && Date.now() - previous.time < 10_000 ? previous.value : undefined;
    previousSessions.delete(sourceKey(cookie));
    pending = pending.then(() => bridgeJavdbSessionCookie(cookie, previousValue)).catch(reportBridgeError);
  };
  chrome.cookies.onChanged.addListener(listener);
  settingsListener = (changes, area) => {
    if (area === 'local' && changes.settings) {
      pending = pending.then(reconcileStoredSessions).catch(reportBridgeError);
    }
  };
  chrome.storage.onChanged.addListener(settingsListener);
  pending = pending.then(reconcileStoredSessions).catch(reportBridgeError);
}
