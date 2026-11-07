/**
 * @file javdbSessionVault.ts
 * @description 10-19 线 2（A.2）：javdb 会话 cookie 采集 + 云端 vault 桥接
 *
 * C1 锁值（与线 1 互操作向量一致，单测逐字锁）：
 * kind='javdb-session'；payload={cookies:{name:value 会话子集}, obtainedAt:毫秒}；
 * PBKDF2-HMAC-SHA512 / 210000 迭代 / 32B key / 16B 固定 salt；AES-256-GCM / 12B nonce；
 * ct=base64(nonce||ct||tag)；密钥源=已存云账号密码（内存值）。
 *
 * 日志纪律（凭据零回显）：只记布尔/计数/原因码/域名；cookie 值与密码永不出现在日志。
 *
 * 推送时机（三条，批复口径）：
 * 1) 用户显式开启云扫描（false→true 转换）/ 手动同步成功 → 立即推一次（fire-and-forget）；
 * 2) chrome.cookies.onChanged 白名单命中（javdb 域、未移除）→ scheduleEnqueue 随既有同步推更新；
 * 3) 未开启零自动推送（watcher 门控在读事件时实时判定）。
 * 永不自动删除 vault 项（移除仅经设置页显式按钮）。
 */
import type { VaultItem } from '@javdb/sync-protocol';
import { PROTOCOL_VERSION, SyncHttpError, type ApiClient, type AuthenticatedRequestOptions } from '@javdb/sync-client';
import type { CloudScanConfig } from '../../types';
import { STORAGE_KEYS, normalizeCloudScanConfig } from '../../utils/config';
import { loadCloudSettings } from './cloudSettingsStorage';
import { createExtensionCloudClient } from './createExtensionCloudClient';
import { scheduleEnqueue } from './enqueueLocalChange';
import { loadCloudSession } from './chromeTokenStore';
import { recoverCloudAuthSession } from './cloudAuthRecovery';
import { isCurrentCloudVaultIdentity, type CloudVaultIdentity } from './cloudSessionIdentity';

export const JAVDB_SESSION_VAULT_ITEM_ID = 'javdb-session';
export const JAVDB_SESSION_VAULT_KIND = 'javdb-session';
/** C1 锁值：salt "javdb-session-v1"（16B ASCII） */
export const JAVDB_SESSION_SALT = 'javdb-session-v1';
export const JAVDB_SESSION_PBKDF2_ITERATIONS = 210000;
export const JAVDB_SESSION_KEY_LENGTH_BYTES = 32;
/** 会话 cookie 白名单（批入）：会话核心 + Cloudflare 传输令牌 + 年龄门（最小超集） */
export const JAVDB_SESSION_COOKIE_WHITELIST = ['_jdb_session', 'cf_clearance', 'over18'] as const;
/** javdb 镜像域家族（host 后缀匹配，含裸域） */
export const JAVDB_MIRROR_HOSTS = ['javdb.com', 'javdb570.com', 'javdb575.com', 'javbus.com'] as const;

export type JavdbSessionPayload = {
  cookies: Record<string, string>;
  obtainedAt: number;
};

export type JavdbSessionCookieSnapshot = {
  cookies: Record<string, string>;
  /** 首个命中 cookie 的 host（vault 项 label；无 cookie 为 null） */
  host: string | null;
};

export type JavdbSessionVaultStatus = 'present' | 'absent' | 'error';

export type JavdbSessionPushFailure = 'no-credentials' | 'no-cookies' | 'push-failed' | 'session-locked' | 'session-invalid' | 'session-unavailable' | 'session-conflict' | 'identity-changed';

export type PushJavdbSessionVaultResult =
  | { ok: true; host: string; cookieCount: number }
  | { ok: false; reason: JavdbSessionPushFailure };

export type PushJavdbSessionVaultManualResult =
  | { ok: true; host: string; cookieCount: number }
  | { ok: false; reason: 'cloud-scan-disabled' | JavdbSessionPushFailure };

type VaultApiLike = Pick<ApiClient, 'listVault' | 'putVault' | 'deleteVault'>;

export type JavdbSessionVaultOptions = { vaultApi?: VaultApiLike };

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

/** host 是否属于 javdb 镜像域家族（后缀匹配；javdb.com.evil.com 类仿冒后缀拒绝） */
export function hostMatchesJavdbFamily(host: string): boolean {
  const h = String(host || '').toLowerCase().replace(/^\./, '');
  return JAVDB_MIRROR_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function normalizeHost(rawDomain: string | undefined): string | null {
  const h = String(rawDomain || '').toLowerCase().replace(/^\./, '');
  return h || null;
}

/** 从 cookie 全量列表中过滤会话子集（白名单名 × javdb 域家族交集） */
export function filterJavdbSessionCookies(
  cookies: Array<{ name: string; value?: string; domain?: string; hostOnly?: boolean }>,
): JavdbSessionCookieSnapshot {
  const out: Record<string, string> = {};
  let host: string | null = null;
  for (const c of cookies || []) {
    if (!(JAVDB_SESSION_COOKIE_WHITELIST as readonly string[]).includes(c.name)) continue;
    if (!hostMatchesJavdbFamily(c.domain || '')) continue;
    if (typeof c.value !== 'string') continue;
    out[c.name] = c.value;
    if (host === null) {
      host = normalizeHost(c.domain);
    }
  }
  return { cookies: out, host };
}

// ---------------------------------------------------------------------------
// C1 加密（WebCrypto；密钥内存值，零日志）
// ---------------------------------------------------------------------------

/** PBKDF2-HMAC-SHA512 → 32B 原始密钥位（内存；供互操作校验与 importKey） */
export async function deriveJavdbSessionBits(password: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(JAVDB_SESSION_SALT),
      iterations: JAVDB_SESSION_PBKDF2_ITERATIONS,
      hash: 'SHA-512',
    },
    baseKey,
    JAVDB_SESSION_KEY_LENGTH_BYTES * 8,
  );
}

async function deriveJavdbSessionKey(password: string): Promise<CryptoKey> {
  const bits = await deriveJavdbSessionBits(password);
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function bufToB64(buf: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 加密：AES-256-GCM，输出 base64(nonce||ct||tag)；nonce 可注入（测试向量） */
export async function encryptJavdbSessionPayload(
  payload: JavdbSessionPayload,
  password: string,
  nonce?: Uint8Array,
): Promise<string> {
  const key = await deriveJavdbSessionKey(password);
  const n = nonce && nonce.length === 12 ? new Uint8Array(nonce) : crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: n },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const all = new Uint8Array(n.length + ct.byteLength);
  all.set(n, 0);
  all.set(new Uint8Array(ct), n.length);
  return bufToB64(all);
}

export async function decryptJavdbSessionCiphertext(b64: string, password: string): Promise<JavdbSessionPayload> {
  const key = await deriveJavdbSessionKey(password);
  const all = b64ToBuf(b64);
  if (all.length < 13) throw new Error('ciphertext too short');
  const iv = all.slice(0, 12);
  const ct = all.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)) as JavdbSessionPayload;
}

// ---------------------------------------------------------------------------
// 配置读取（new_works_config.cloudScan；读侧归一 关/20/60）
// ---------------------------------------------------------------------------

function readStorageValue(key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'storage read failed'));
        return;
      }
      resolve((res as Record<string, unknown> | undefined)?.[key]);
    });
  });
}

export async function readCloudScanConfig(): Promise<CloudScanConfig> {
  let raw: unknown;
  try {
    raw = await readStorageValue(STORAGE_KEYS.NEW_WORKS_CONFIG);
  } catch {
    return normalizeCloudScanConfig(undefined);
  }
  const v = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined);
  return normalizeCloudScanConfig(v?.cloudScan);
}

// ---------------------------------------------------------------------------
// cookie 采集
// ---------------------------------------------------------------------------

export function collectJavdbSessionCookies(): Promise<JavdbSessionCookieSnapshot> {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({}, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'cookies.getAll failed'));
        return;
      }
      resolve(filterJavdbSessionCookies(res || []));
    });
  });
}

// ---------------------------------------------------------------------------
// vault 读写
// ---------------------------------------------------------------------------

async function resolveVaultApi(options: JavdbSessionVaultOptions): Promise<VaultApiLike> {
  if (options.vaultApi) return options.vaultApi;
  const { api } = await createExtensionCloudClient();
  return api;
}

function sessionPushFailure(error: unknown): JavdbSessionPushFailure {
  if (error instanceof SessionIdentityChanged) return 'identity-changed';
  if (error instanceof SyncHttpError) {
    if (error.status === 409 && error.message === 'vault-session-locked') return 'session-locked';
    if (error.status === 422 && error.message === 'vault-session-invalid') return 'session-invalid';
    if (error.status === 503 && error.message === 'vault-session-unavailable') return 'session-unavailable';
  }
  return 'push-failed';
}

class SessionIdentityChanged extends Error {}

/** 密文可能被 Cloud 转为 v2，只核对本次写入的元数据，不把 LWW 返回的旧项当成成功。 */
function acceptedSessionWrite(actual: VaultItem, expected: VaultItem): boolean {
  return Boolean(actual && actual.id === expected.id && actual.kind === expected.kind &&
    actual.revision === expected.revision && actual.updatedAt === expected.updatedAt &&
    actual.updatedByDeviceId === expected.updatedByDeviceId && !actual.deletedAt && actual.ciphertext);
}

/** 采集并上传一次；Cloud 未解锁时同账号重新认证，重新读 revision 后最多重试一次。 */
export async function pushJavdbSessionVault(
  reason: string,
  options: JavdbSessionVaultOptions = {},
): Promise<PushJavdbSessionVaultResult> {
  const [settings, session] = await Promise.all([loadCloudSettings(), loadCloudSession()]);
  if (!settings.accountPassword || !session?.accessToken || !session.userId) {
    return { ok: false, reason: 'no-credentials' };
  }
  const identity: CloudVaultIdentity = { ...settings, userId: session.userId };
  const assertCurrent = async () => {
    if (!await isCurrentCloudVaultIdentity(identity)) throw new SessionIdentityChanged();
  };
  const requestOptions: AuthenticatedRequestOptions = { auth: { baseUrl: settings.baseUrl, assertCurrent } };
  try {
    await assertCurrent();
    const snapshot = await collectJavdbSessionCookies();
    const cookieCount = Object.keys(snapshot.cookies).length;
    if (cookieCount === 0) return { ok: false, reason: 'no-cookies' };
    const api = options.vaultApi ?? (await createExtensionCloudClient(settings)).api;
    const payload: JavdbSessionPayload = { cookies: snapshot.cookies, obtainedAt: Date.now() };
    const ciphertext = await encryptJavdbSessionPayload(payload, settings.accountPassword);
    let previousTimestamp = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assertCurrent();
      // 读失败不猜 revision；登录可能迁移旧值，所以每次发送前都重新读。
      const list = await api.listVault(requestOptions);
      await assertCurrent();
      const existing = (list.items || []).find(item => item.id === JAVDB_SESSION_VAULT_ITEM_ID);
      const revision = existing && Number.isSafeInteger(existing.revision) && existing.revision > 0 ? existing.revision + 1 : 1;
      const latestTimestamp = existing && Number.isSafeInteger(existing.updatedAt) ? existing.updatedAt : 0;
      const updatedAt = Math.max(Date.now(), previousTimestamp + 1, latestTimestamp + 1);
      previousTimestamp = updatedAt;
      const item: VaultItem = {
        id: JAVDB_SESSION_VAULT_ITEM_ID, kind: JAVDB_SESSION_VAULT_KIND,
        label: snapshot.host ?? undefined, ciphertext, revision, updatedAt, updatedByDeviceId: settings.deviceId,
      };
      try {
        const saved = await api.putVault(JAVDB_SESSION_VAULT_ITEM_ID, { protocolVersion: PROTOCOL_VERSION, item }, requestOptions);
        await assertCurrent();
        if (!acceptedSessionWrite(saved, item)) return { ok: false, reason: 'session-conflict' };
        console.info(`[cloudSync] javdb 会话 vault 推送成功 reason=${reason} host=${snapshot.host || '-'} cookies=${cookieCount} rev=${revision}`);
        return { ok: true, host: snapshot.host ?? '', cookieCount };
      } catch (error) {
        await assertCurrent();
        const failure = sessionPushFailure(error);
        if (failure !== 'session-locked' || attempt > 0) return { ok: false, reason: failure };
        const recovery = await recoverCloudAuthSession('vault-locked', { vaultIdentity: identity });
        await assertCurrent();
        if (recovery.outcome !== 'recovered') return { ok: false, reason: 'session-locked' };
      }
    }
    return { ok: false, reason: 'session-locked' };
  } catch (error) {
    const failure = sessionPushFailure(error);
    console.warn('[cloudSync] javdb 会话推送未完成 reason:', failure);
    return { ok: false, reason: failure };
  }
}

/** 门控包装：未开启云扫描零动作；任何失败仅 warn 不外抛（fire-and-forget 安全） */
export async function pushJavdbSessionVaultIfEnabled(reason: string): Promise<void> {
  try {
    const cfg = await readCloudScanConfig();
    if (!cfg.enabled) return;
    const result = await pushJavdbSessionVault(reason);
    if (!result.ok && result.reason !== 'no-cookies') {
      console.warn('[cloudSync] javdb 会话 vault 推送未成功 reason 码:', result.reason);
    }
  } catch (err) {
    console.warn('[cloudSync] javdb 会话 vault 推送异常:', sessionPushFailure(err));
  }
}

/** 手动入口（设置页「设置登录态」按钮，10-28）：返回结果、不吞异常（对照 IfEnabled 静默 fire-and-forget）。
 *  云扫描未启用 → 'cloud-scan-disabled'（不触 vault api）；其余复用 pushJavdbSessionVault('manual') 原因码；任何异常 → 'push-failed'。 */
export async function pushJavdbSessionVaultManual(
  options: JavdbSessionVaultOptions = {},
): Promise<PushJavdbSessionVaultManualResult> {
  try {
    const cfg = await readCloudScanConfig();
    if (!cfg.enabled) {
      return { ok: false, reason: 'cloud-scan-disabled' };
    }
    return await pushJavdbSessionVault('manual', options);
  } catch (err) {
    console.warn('[cloudSync] javdb 会话 vault 手动推送异常:', sessionPushFailure(err));
    return { ok: false, reason: 'push-failed' };
  }
}

/** vault 项状态（设置页状态行）：present/absent（含墓碑）/error */
export async function fetchJavdbSessionVaultStatus(options: JavdbSessionVaultOptions = {}): Promise<JavdbSessionVaultStatus> {
  try {
    const api = await resolveVaultApi(options);
    const res = await api.listVault();
    const item = (res.items || []).find((i) => i.id === JAVDB_SESSION_VAULT_ITEM_ID);
    return item && !item.deletedAt ? 'present' : 'absent';
  } catch {
    return 'error';
  }
}

/** 显式删除 vault 项（仅设置页按钮；watcher/推送路径永不自动删） */
export async function deleteJavdbSessionVault(options: JavdbSessionVaultOptions = {}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const api = await resolveVaultApi(options);
    await api.deleteVault(JAVDB_SESSION_VAULT_ITEM_ID);
    console.info('[cloudSync] javdb 会话 vault 项已删除');
    return { ok: true };
  } catch (err) {
    console.warn('[cloudSync] javdb 会话 vault 删除失败:', (err as Error)?.message || 'unknown');
    return { ok: false, reason: 'delete-failed' };
  }
}

// ---------------------------------------------------------------------------
// background watcher（chrome.cookies.onChanged → 随既有同步推更新）
// ---------------------------------------------------------------------------

let watcherListener: ((change: unknown) => void) | null = null;

/**
 * 注册会话 cookie 变更监听（幂等；chrome 上下文切换时移除旧监听再挂新监听，
 * 同一上下文重复调用不产生重复监听）。门控三层：
 * 云扫描已开启 + 已存云密码 + 变更命中白名单名 × javdb 域 × 未移除。
 * 命中 → scheduleEnqueue（3 次尝试/退避，10-18 线既有语义）随既有同步推送。
 */
export function initJavdbSessionCookieWatcher(): void {
  if (typeof chrome === 'undefined' || !chrome.cookies?.onChanged) return;
  if (watcherListener) {
    try {
      chrome.cookies.onChanged.removeListener(watcherListener);
    } catch {}
    watcherListener = null;
  }
  const listener = (change: unknown) => {
    void (async () => {
      const c = change as { cookie?: { name?: string; domain?: string }; removed?: boolean } | undefined;
      const cookie = c?.cookie;
      if (!cookie || c?.removed) return;
      if (!(JAVDB_SESSION_COOKIE_WHITELIST as readonly string[]).includes(cookie.name || '')) return;
      if (!hostMatchesJavdbFamily(cookie.domain || '')) return;
      try {
        const [cfg, settings] = await Promise.all([readCloudScanConfig(), loadCloudSettings()]);
        if (!cfg.enabled) return;
        if (!settings.accountPassword) return;
      } catch {
        return;
      }
      scheduleEnqueue(() => pushJavdbSessionVaultIfEnabled('cookie-change'));
    })();
  };
  watcherListener = listener;
  chrome.cookies.onChanged.addListener(listener);
}
