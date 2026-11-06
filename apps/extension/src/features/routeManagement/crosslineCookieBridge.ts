/** JavDB 镜像站点的本机登录态补写；不处理 Cloudflare 挑战 cookie。 */
const MIRROR_HOSTS = ['javdb.com', 'javdb570.com', 'javdb575.com'] as const;

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

/** 只填缺口，不覆盖目标域的已有会话；即使新站不共享后端会话，也不会改掉原账号。 */
export async function bridgeJavdbSessionCookie(session: chrome.cookies.Cookie): Promise<void> {
  if (!isUsableSession(session)) return;
  const source = mirrorHost(session.domain);
  if (!source) return;
  const sourceCookies = await readCookies(`https://${session.domain.replace(/^\./, '')}/`, session.storeId);
  if (!sourceCookies.some(cookie => isUsableSession(cookie) && cookie.value === session.value)) return;
  const ageGate = sourceCookies.find(cookie => cookie.name === 'over18' && cookie.value &&
    !cookie.partitionKey && cookie.path === '/' &&
    (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000));

  const targets = await Promise.all(MIRROR_HOSTS.filter(host => host !== source).map(async target => ({
    target,
    existing: [
      ...await readCookies(`https://${target}/`, session.storeId),
      ...await readCookies(`https://www.${target}/`, session.storeId),
    ],
  })));
  if (targets.some(({ existing }) => existing.some(cookie =>
    isUsableSession(cookie) && cookie.value !== session.value))) return;

  for (const { target, existing } of targets) {
    const targetSession = existing.find(cookie => cookie.name === '_jdb_session');
    if (targetSession && targetSession.value !== session.value) continue;
    const url = `https://${target}/`;
    if (!targetSession) await writeCookie(url, target, session);
    if (ageGate && !existing.some(cookie => cookie.name === 'over18')) {
      await writeCookie(url, target, ageGate);
    }
  }
}

async function clearMatchingMirrorSessions(session: chrome.cookies.Cookie): Promise<void> {
  if (!isUsableSession(session)) return;
  const source = mirrorHost(session.domain);
  if (!source) return;
  const current = await readCookies(`https://${session.domain.replace(/^\./, '')}/`, session.storeId);
  if (current.some(cookie => isUsableSession(cookie) && cookie.value === session.value)) return;
  const targets = await Promise.all(MIRROR_HOSTS.filter(host => host !== source).flatMap(host => [
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
let pending: Promise<void> = Promise.resolve();

/** 仅响应新登录，不在冷启动时补回用户主动退出的镜像域。 */
export function initJavdbCrosslineCookieBridge(): void {
  if (typeof chrome === 'undefined' || !chrome.cookies?.onChanged) return;
  if (listener) chrome.cookies.onChanged.removeListener(listener);
  listener = change => {
    const cookie = change.cookie;
    if (change.removed) {
      if (change.cause === 'explicit' && isUsableSession(cookie)) {
        pending = pending.then(() => clearMatchingMirrorSessions(cookie)).catch(() => {});
      }
      return;
    }
    if (cookie.name === 'over18' && mirrorHost(cookie.domain)) {
      pending = pending.then(async () => {
        const cookies = await readCookies(`https://${cookie.domain.replace(/^\./, '')}/`, cookie.storeId);
        const activeSession = cookies.find(isUsableSession);
        if (activeSession) await bridgeJavdbSessionCookie(activeSession);
      }).catch(() => {});
      return;
    }
    if (!isUsableSession(cookie)) return;
    pending = pending.then(() => bridgeJavdbSessionCookie(cookie)).catch(() => {});
  };
  chrome.cookies.onChanged.addListener(listener);
}
