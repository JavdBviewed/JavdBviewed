/** JavDB 镜像站点的本机登录态补写；不处理 Cloudflare 挑战 cookie。 */
import { createDefaultRouteSettings } from './defaultRoutes';
import { isCrosslineProbeActive, isCrosslineLogoutSuppressed, withCrosslineProbeGuard } from './crosslineSessionGuards';
import type { CrosslineCopyOutcome, CrosslineLoginState } from '../../shared/protocols/crosslineSession';
import type { CrosslineDiagnosticError, CrosslineErrorStage, CrosslineSessionStatus } from '../../shared/protocols/crosslineSession';

const MIRROR_HOSTS = ['javdb.com', 'javdb570.com', 'javdb575.com'] as const;
const ENABLED_KEY = 'javdbCrosslineSessionEnabled';
type MirrorHost = (typeof MIRROR_HOSTS)[number];
const ERROR_MESSAGES: Record<CrosslineErrorStage, string> = {
  'settings-read': '读取线路或同步设置失败，请重试。',
  'settings-write': '保存自动同步开关失败，请重试。',
  'cookie-read': '读取浏览器会话失败，请检查扩展的网站访问权限后重试。',
  'cookie-write': '写入目标线路会话失败，部分线路可能已同步；请检查权限后重试。',
  selection: '无法确定唯一的来源会话，请打开来源网站确认账号，再刷新列表并重新选择已启用的支持线路。',
  unknown: '登录态操作未完成，请重试。',
};
class CrosslineOperationError extends Error {
  constructor(readonly stage: CrosslineErrorStage, readonly host?: string) {
    super(ERROR_MESSAGES[stage]);
  }
}
export function describeCrosslineError(error: unknown): CrosslineDiagnosticError {
  const stage = error instanceof CrosslineOperationError ? error.stage : 'unknown';
  return { stage, message: ERROR_MESSAGES[stage] };
}
// 手动替换目标的清理不代表用户登出，不能触发其它线路的联动清理。
const manualRemovals = new Map<string, number>();
function removalKey(cookie: chrome.cookies.Cookie): string {
  return JSON.stringify([cookie.storeId, cookie.domain, cookie.path, cookie.name, cookie.value]);
}
const previousSessions = new Map<string, { value: string; time: number }>();

export function readEnabled(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(ENABLED_KEY, result => {
      if (chrome.runtime.lastError) reject(new CrosslineOperationError('settings-read'));
      else resolve(result?.[ENABLED_KEY] !== false);
    });
  });
}

export function setJavdbCrosslineEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [ENABLED_KEY]: enabled }, () => {
      if (chrome.runtime.lastError) reject(new CrosslineOperationError('settings-write'));
      else {
        if (!enabled) previousSessions.clear();
        resolve();
      }
    });
  });
}

function sourceKey(cookie: chrome.cookies.Cookie): string {
  return `${cookie.storeId}:${mirrorHost(cookie.domain)}`;
}

export function mirrorHost(domain: string): (typeof MIRROR_HOSTS)[number] | null {
  const host = domain.toLowerCase().replace(/^\./, '');
  return MIRROR_HOSTS.find(mirror => host === mirror || host === `www.${mirror}`) ?? null;
}

export function isUsableSession(cookie: chrome.cookies.Cookie): boolean {
  return cookie.name === '_jdb_session' && !!cookie.value && cookie.path === '/' &&
    !cookie.partitionKey && (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000) &&
    mirrorHost(cookie.domain) !== null;
}

export function readCookies(url: string, storeId?: string): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({ url, ...(storeId ? { storeId } : {}) }, cookies => {
      if (chrome.runtime.lastError) reject(new CrosslineOperationError('cookie-read'));
      else resolve(cookies ?? []);
    });
  });
}

function readConfiguredRoutes(): Promise<{ host: string; enabled: boolean; supported: boolean }[]> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('settings', result => {
      if (chrome.runtime.lastError) {
        reject(new CrosslineOperationError('settings-read'));
        return;
      }
      const defaults = createDefaultRouteSettings().javdb;
      const routes = (result?.settings as { routes?: { javdb?: typeof defaults } } | undefined)?.routes?.javdb ?? defaults;
      const configured = new Map<string, { host: string; enabled: boolean; supported: boolean }>();
      for (const route of [{ url: routes.primary, enabled: true }, ...(routes.alternatives ?? [])]) {
        try {
          const parsed = new URL(route.url);
          const mirror = mirrorHost(parsed.hostname);
          const host = mirror ?? parsed.hostname;
          const supported = parsed.protocol === 'https:' && !!mirror;
          const prior = configured.get(host);
          // 启用状态与 HTTPS 支持必须属于同一条配置，不能跨条目拼出同步资格。
          if (!prior || (route.enabled === true && (!prior.enabled || supported))) {
            configured.set(host, { host, enabled: route.enabled === true, supported });
          }
        } catch { /* 无效 URL 不作为会话来源或目标，也不回传原始配置串。 */ }
      }
      resolve([...configured.values()]);
    });
  });
}

export async function readEnabledHosts(): Promise<MirrorHost[]> {
  const routes = await readConfiguredRoutes();
  return MIRROR_HOSTS.filter(host => routes.some(route => route.host === host && route.enabled && route.supported));
}

function readAllSessions(): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({ name: '_jdb_session' }, cookies => {
      if (chrome.runtime.lastError) reject(new CrosslineOperationError('cookie-read'));
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
      if (chrome.runtime.lastError || !result) reject(new CrosslineOperationError('cookie-write', domain));
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
  if (!await readEnabled()) return;
  if (!isUsableSession(session)) return;
  const source = mirrorHost(session.domain);
  if (!source || isCrosslineProbeActive(source, session.storeId)) return;
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
    if (!await readEnabled()) return;
    if (isCrosslineProbeActive(target, session.storeId) || await isCrosslineLogoutSuppressed(target, session.storeId)) continue;
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
  if (!await readEnabled()) return;
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

async function inspectSessions(): Promise<CrosslineSessionStatus> {
  const [enabled, routes, all] = await Promise.all([readEnabled(), readConfiguredRoutes(), readAllSessions()]);
  const enabledHosts = routes.filter(route => route.enabled && route.supported).map(route => route.host);
  const sessions = all.filter(cookie => isUsableSession(cookie) && enabledHosts.includes(mirrorHost(cookie.domain) as MirrorHost));
  const stores = new Set(sessions.map(cookie => cookie.storeId));
  const values = new Set(sessions.map(cookie => cookie.value));
  const reason = sessions.length === 0 ? 'no-session' : stores.size > 1 ? 'multiple-stores' :
    values.size > 1 ? 'different-sessions' : 'ready';
  return {
    enabled,
    checkedAt: Date.now(),
    reason,
    routes: routes.map(({ host, enabled: routeEnabled, supported }) => ({
      host,
      status: !routeEnabled ? 'disabled' : !supported ? 'unsupported' :
        !sessions.some(cookie => mirrorHost(cookie.domain) === host) ? 'missing' :
          reason === 'different-sessions' || reason === 'multiple-stores' ? 'conflict' : 'present',
    })),
  };
}

/** 仅返回每条线路的状态；cookie 值不会越过后台消息边界。 */
export async function getJavdbCrosslineStatus(): Promise<CrosslineSessionStatus> {
  await pending;
  return inspectSessions();
}

/** 与启动补齐共享同一队列，避免手动刷新与 cookie 事件交叉写入。 */
export async function refreshJavdbCrosslineSessions(): Promise<CrosslineSessionStatus> {
  const task = pending.then(async () => {
    const before = await inspectSessions();
    let failure: unknown;
    if (before.enabled && before.reason === 'ready') {
      try { await reconcileStoredSessions(); } catch (error) { failure = error; }
    }
    const after = await inspectSessions();
    return {
      ...after,
      ...(failure ? { error: describeCrosslineError(failure) } : {}),
      routes: after.routes.map(route => ({
        ...route,
        status: failure instanceof CrosslineOperationError && failure.host === route.host ? 'error' as const :
          before.routes.find(item => item.host === route.host)?.status === 'missing' && route.status === 'present'
          ? 'synced' as const : route.status,
      })),
    };
  });
  pending = task.then(() => undefined, reportBridgeError);
  return task;
}

/** 用户明确选择来源及单个目标后才允许替换；关闭自动同步不影响本次手动操作。 */
async function copySessionInQueue(sourceHost: string, targetHost: string, storeId?: string): Promise<CrosslineSessionStatus> {
    const hosts = await readEnabledHosts();
    if (sourceHost === targetHost || !hosts.some(host => host === sourceHost) || !hosts.some(host => host === targetHost)) {
      throw new CrosslineOperationError('selection');
    }
    const all = (storeId ? [...await readCookies(`https://${sourceHost}/`, storeId), ...await readCookies(`https://www.${sourceHost}/`, storeId)] : await readAllSessions()).filter(cookie => isUsableSession(cookie) && hosts.some(host => host === mirrorHost(cookie.domain)));
    const sources = all.filter(cookie => mirrorHost(cookie.domain) === sourceHost);
    const source = sources[0];
    if (!source || new Set(all.map(cookie => cookie.storeId)).size !== 1 || new Set(sources.map(cookie => cookie.value)).size !== 1) {
      throw new CrosslineOperationError('selection');
    }
    const sourceCookies = await readCookies(`https://${source.domain.replace(/^\./, '')}/`, source.storeId);
    if (!sourceCookies.some(cookie => isUsableSession(cookie) && cookie.value === source.value)) {
      throw new CrosslineOperationError('selection');
    }
    const ageGate = sourceCookies.find(cookie => cookie.name === 'over18' && cookie.value && !cookie.partitionKey && cookie.path === '/' &&
      (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000));
    const targets = [...await readCookies(`https://${targetHost}/`, source.storeId),
      ...await readCookies(`https://www.${targetHost}/`, source.storeId)];
    const unique = new Map(targets.filter(cookie => !cookie.partitionKey && cookie.path === '/' &&
      (cookie.name === '_jdb_session' || (ageGate && cookie.name === 'over18'))).map(cookie => [removalKey(cookie), cookie]));
    let failure: unknown;
    try {
      for (const [key, expiry] of manualRemovals) if (expiry < Date.now()) manualRemovals.delete(key);
      for (const cookie of unique.values()) {
        manualRemovals.set(removalKey(cookie), Date.now() + 10_000);
        await removeCookie(cookie);
      }
      await writeCookie(`https://${targetHost}/`, targetHost, source);
      if (ageGate) await writeCookie(`https://${targetHost}/`, targetHost, ageGate);
      const verified = [...await readCookies(`https://${targetHost}/`, source.storeId),
        ...await readCookies(`https://www.${targetHost}/`, source.storeId)].filter(isUsableSession);
      if (!verified.length || verified.some(cookie => cookie.value !== source.value)) throw new CrosslineOperationError('cookie-write', targetHost);
    } catch { failure = new CrosslineOperationError('cookie-write', targetHost); }
    const after = await inspectSessions();
    return { ...after, ...(failure ? { error: describeCrosslineError(failure) } : {}),
      routes: after.routes.map(route => route.host === targetHost ? { ...route, status: failure ? 'error' as const : 'synced' as const } : route) };
}

export function copyJavdbCrosslineSession(sourceHost: string, targetHost: string): Promise<CrosslineSessionStatus> {
  const task = pending.then(() => copySessionInQueue(sourceHost, targetHost));
  pending = task.then(() => undefined, reportBridgeError);
  return task;
}

/** This operation owns the same queue as the automatic bridge. Checks must not await that queue. */
export function copyVerifiedCrosslineSession(
  sourceHost: string, targetHost: string, storeId: string,
  before: () => Promise<CrosslineCopyOutcome | undefined>,
  verifyTarget: () => Promise<CrosslineLoginState>,
): Promise<CrosslineCopyOutcome> {
  const task = pending.then(() => withCrosslineProbeGuard([sourceHost, targetHost], storeId, async (): Promise<CrosslineCopyOutcome> => {
    const early = await before();
    if (early) return early;
    if (!await readEnabled()) return 'stale';
    const snapshot = [...await readCookies(`https://${targetHost}/`, storeId), ...await readCookies(`https://www.${targetHost}/`, storeId)];
    const old = [...new Map(snapshot.filter(c => c.path === '/' && !c.partitionKey &&
      (c.name === '_jdb_session' || c.name === 'over18')).map(c => [removalKey(c), c])).values()];
    const source = (await readCookies(`https://${sourceHost}/`, storeId)).find(isUsableSession) ||
      (await readCookies(`https://www.${sourceHost}/`, storeId)).find(isUsableSession);
    if (!source) return 'stale';
    const copied = await copySessionInQueue(sourceHost, targetHost, storeId);
    if (copied.error) return 'unconfirmed';
    const state = await verifyTarget().catch(() => 'unknown' as const);
    if (state === 'authenticated') return 'authenticated';
    if (state === 'unknown') return 'unconfirmed';
    const current = [...await readCookies(`https://${targetHost}/`, storeId), ...await readCookies(`https://www.${targetHost}/`, storeId)];
    const sessions = current.filter(isUsableSession);
    // Never restore over a new session written by the site or another tab.
    if (sessions.length && sessions.every(c => c.value === source.value)) {
      for (const c of [...new Map(current.filter(c => c.path === '/' && !c.partitionKey &&
        (c.name === '_jdb_session' || c.name === 'over18')).map(c => [removalKey(c), c])).values()]) {
        manualRemovals.set(removalKey(c), Date.now() + 10_000);
        await removeCookie(c);
      }
      for (const c of old) {
        await new Promise<void>((resolve, reject) => chrome.cookies.set({
          url: `https://${c.domain.replace(/^\./, '')}${c.path}`, name: c.name, value: c.value, path: c.path,
          ...(c.hostOnly ? {} : { domain: c.domain }), storeId: c.storeId, secure: c.secure,
          httpOnly: c.httpOnly, sameSite: c.sameSite, ...(c.session ? {} : { expirationDate: c.expirationDate }),
        }, result => { if (chrome.runtime.lastError || !result) reject(new Error('恢复原会话失败')); else resolve(); }));
      }
    }
    return 'not-accepted';
  }));
  pending = task.then(() => undefined, reportBridgeError);
  return task;
}

async function clearMatchingMirrorSessions(session: chrome.cookies.Cookie): Promise<void> {
  if (!await readEnabled()) return;
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
    if (!await readEnabled()) return;
    await removeCookie(cookie);
  }
}

let listener: ((change: chrome.cookies.CookieChangeInfo) => void) | null = null;
let settingsListener: ((changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void) | null = null;
let pending: Promise<void> = Promise.resolve();

function reportBridgeError(error: unknown): void {
  console.warn('[JavDB crossline] cookie 操作失败', {
    stage: describeCrosslineError(error).stage,
  });
}

/** 首次启动和线路配置变更补齐已有会话，之后监听新登录和登出。 */
export function initJavdbCrosslineCookieBridge(): void {
  if (typeof chrome === 'undefined' || !chrome.cookies?.onChanged || !chrome.storage?.onChanged) return;
  if (listener) chrome.cookies.onChanged.removeListener(listener);
  if (settingsListener) chrome.storage.onChanged.removeListener(settingsListener);
  listener = change => {
    const cookie = change.cookie;
    const host = mirrorHost(cookie.domain);
    if (host && isCrosslineProbeActive(host, cookie.storeId)) return;
    const suppressedUntil = manualRemovals.get(removalKey(cookie));
    if (change.removed && suppressedUntil) {
      manualRemovals.delete(removalKey(cookie));
      if (suppressedUntil >= Date.now()) return;
    }
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
    if (area === 'local' && (changes.settings || changes[ENABLED_KEY]?.newValue === true)) {
      pending = pending.then(reconcileStoredSessions).catch(reportBridgeError);
    }
  };
  chrome.storage.onChanged.addListener(settingsListener);
  pending = pending.then(reconcileStoredSessions).catch(reportBridgeError);
}
