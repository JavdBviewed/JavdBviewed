/**
 * @file cloudAuthRecovery.ts
 * @description Cloud 会话自恢复：服务端撤销令牌（如管理端修改密码会撤销该账号全部设备会话）
 * 导致 refresh 失败、本机会话被清空后，凭已保存的账号密码自动重新登录；
 * 失败时按原因退避，已存密码失效时通知用户更新存储的密码。
 *
 * 触发点：
 * - createExtensionCloudClient 的 onAuthFailure（refresh 失败后调用，此时会话已清空）
 * - backgroundCloudSync 的 ensureCloudSessionFromSavedCredentials（周期闹钟 / 本地变更入队后）
 * - runCloudSyncNow（手动「立即同步」时会话缺失）
 *
 * 防打爆服务端（登录限流 5 次 / 5 分钟，按 IP+账号）：
 * - navigator.locks 跨上下文（SW / dashboard / popup）独占去重，同上下文内进程级兜底
 * - 退避：已存密码失效 30 分钟；网络 / 服务 / 限流原因 5 分钟
 * @module features/cloudSync
 */
import type { AuthLoginResponse } from '@javdb/sync-protocol';
import { getValue, setValue } from '../../utils/storage';
import { createChromeTokenStore, loadCloudSession } from './chromeTokenStore';
import { loadCloudSettings, normalizeCloudBaseUrl } from './cloudSettingsStorage';

export type CloudAuthRecoveryOutcome =
  /** 会话仍在，无需恢复 */
  | 'already-authenticated'
  /** 未保存账号密码，无法自动恢复 */
  | 'no-credentials'
  /** 退避期内，不请求服务端 */
  | 'suppressed'
  /** 已用已存凭据重新登录 */
  | 'recovered'
  /** 重登失败：已存密码不再有效（如服务端改密） */
  | 'credentials-invalid'
  /** 网络 / 服务侧暂不可达，短退避后重试 */
  | 'network-error';

export type CloudAuthRecoveryResult = {
  outcome: CloudAuthRecoveryOutcome;
  detail?: string;
};

export type CloudAuthRecoveryBackoff = {
  kind: 'credentials-invalid' | 'network-error';
  until: number;
  reason?: string;
};

const RECOVERY_LOCK_NAME = 'javdb-cloud-auth-recovery';
const BACKOFF_STORAGE_KEY = 'cloud_sync_auth_recovery_backoff_v1';
const NOTICE_STORAGE_KEY = 'cloud_sync_auth_recovery_notice_v1';
/** 已存密码失效：30 分钟退避（高于服务端 5 分钟登录限流窗口） */
const CREDENTIALS_BACKOFF_MS = 30 * 60 * 1000;
/** 网络 / 服务 / 限流原因：5 分钟退避 */
const NETWORK_BACKOFF_MS = 5 * 60 * 1000;

/** UI / 通知共用的「已存密码失效」引导文案 */
export const CREDENTIALS_INVALID_MESSAGE =
  'Cloud 登录已失效，且已保存的密码不再有效（可能已修改密码），请在「设置 → Cloud 同步」中更新账号密码';

type NoticeRecord = { kind: 'recovered' | 'credentials-invalid'; at: number };

let inProcessFallbackInFlight: Promise<unknown> | null = null;

async function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(RECOVERY_LOCK_NAME, { mode: 'exclusive' }, work);
  }
  if (inProcessFallbackInFlight) return inProcessFallbackInFlight as Promise<T>;
  const current = work();
  inProcessFallbackInFlight = current;
  return current.finally(() => {
    if (inProcessFallbackInFlight === current) inProcessFallbackInFlight = null;
  });
}

export async function loadCloudAuthRecoveryBackoff(): Promise<CloudAuthRecoveryBackoff | null> {
  try {
    const value = await getValue<CloudAuthRecoveryBackoff | null>(BACKOFF_STORAGE_KEY, null);
    if (!value || typeof value !== 'object') return null;
    if (value.kind !== 'credentials-invalid' && value.kind !== 'network-error') return null;
    if (typeof value.until !== 'number') return null;
    return value;
  } catch {
    return null;
  }
}

function removeStorageKey(key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove([key], () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * 清空退避与通知去重状态。
 * 用户主动登录成功后调用：否则上一次「密码失效」通知会抑制后续同状态通知。
 */
export async function resetCloudAuthRecoveryState(): Promise<void> {
  await Promise.all([removeStorageKey(BACKOFF_STORAGE_KEY), removeStorageKey(NOTICE_STORAGE_KEY)]);
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** 裸 fetch 登录（不经过 ApiClient，避免触发 onAuthFailure 递归） */
async function loginWithSavedCredentials(args: {
  baseUrl: string;
  identifier: string;
  password: string;
  deviceId: string;
  deviceLabel: string;
  fetchImpl: typeof fetch;
}): Promise<AuthLoginResponse> {
  const root = normalizeCloudBaseUrl(args.baseUrl);
  const res = await args.fetchImpl(`${root}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: args.identifier,
      password: args.password,
      device: {
        id: args.deviceId,
        label: args.deviceLabel,
        clientType: 'extension',
        platform: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 120),
      },
    }),
  });
  const data = (await res.json().catch(() => null)) as AuthLoginResponse | null;
  if (!res.ok || !data || typeof data.accessToken !== 'string' || !data.accessToken) {
    const error = new Error(`Cloud 登录失败（HTTP ${res.status}）`);
    (error as { status?: number }).status = res.status;
    throw error;
  }
  return data;
}

/**
 * 恢复通知：按状态变化去重（recovered / credentials-invalid 交替时才发），
 * requireInteraction 保持到用户处理；点击直达 Cloud 设置页。
 */
async function notifyRecovery(kind: 'recovered' | 'credentials-invalid'): Promise<void> {
  try {
    const prev = (await getValue<NoticeRecord | null>(NOTICE_STORAGE_KEY, null)) ?? null;
    if (prev && prev.kind === kind) return;
    await setValue(NOTICE_STORAGE_KEY, { kind, at: Date.now() });
    const title = kind === 'recovered' ? 'Cloud 登录已恢复' : 'Cloud 登录已失效';
    const message =
      kind === 'recovered'
        ? '已用已保存的账号密码自动重新登录，同步已恢复'
        : CREDENTIALS_INVALID_MESSAGE;
    const notificationId = `cloud-auth-recovery-${Date.now()}`;
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/favicons/light/favicon-48x48.png'),
      title,
      message,
      priority: 2,
      requireInteraction: true,
    });
    const onClicked = (clicked: string) => {
      if (clicked !== notificationId) return;
      void chrome.tabs.create({
        url: chrome.runtime.getURL('dashboard/dashboard.html#tab-settings/cloud-settings'),
      });
      try {
        chrome.notifications.clear(notificationId);
      } catch {
        // ignore
      }
      try {
        chrome.notifications.onClicked.removeListener(onClicked);
      } catch {
        // ignore
      }
    };
    try {
      chrome.notifications.onClicked?.addListener?.(onClicked);
    } catch {
      // ignore
    }
  } catch (e) {
    console.warn('[CloudSync] 恢复通知发送失败', e);
  }
}

/**
 * 会话缺失时凭已存凭据自动重新登录（跨上下文独占）。
 *
 * 注意：退避期内返回 suppressed，不碰服务端；调用方（如闹钟路径）可静默忽略。
 */
export async function recoverCloudAuthSession(
  reason?: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<CloudAuthRecoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const result = await runExclusive(async (): Promise<CloudAuthRecoveryResult> => {
    // 锁内复查：另一上下文可能已完成恢复
    const existing = await loadCloudSession();
    if (existing?.accessToken) {
      return { outcome: 'already-authenticated' };
    }

    const settings = await loadCloudSettings();
    const identifier = (settings.accountIdentifier || '').trim();
    const password = settings.accountPassword || '';
    if (!settings.baseUrl || !identifier || !password) {
      return { outcome: 'no-credentials', detail: '未保存 Cloud 账号密码，无法自动重新登录' };
    }

    const backoff = await loadCloudAuthRecoveryBackoff();
    if (backoff && backoff.until > Date.now()) {
      return {
        outcome: 'suppressed',
        detail:
          backoff.kind === 'credentials-invalid'
            ? '退避期：已保存的密码不再有效，等待用户更新'
            : '退避期：Cloud 服务暂不可达，稍后自动重试',
      };
    }

    try {
      const pair = await loginWithSavedCredentials({
        baseUrl: settings.baseUrl,
        identifier,
        password,
        deviceId: settings.deviceId,
        deviceLabel: settings.deviceLabel,
        fetchImpl,
      });
      const tokens = createChromeTokenStore({ getDeviceId: () => settings.deviceId });
      await tokens.setTokens(pair);
      await removeStorageKey(BACKOFF_STORAGE_KEY);
      await notifyRecovery('recovered');
      return { outcome: 'recovered' };
    } catch (e) {
      const status = httpStatusOf(e);
      if (status === 401 || status === 403) {
        await setValue(BACKOFF_STORAGE_KEY, {
          kind: 'credentials-invalid',
          until: Date.now() + CREDENTIALS_BACKOFF_MS,
          reason: String((e as Error)?.message ?? e),
        });
        await notifyRecovery('credentials-invalid');
        return { outcome: 'credentials-invalid', detail: CREDENTIALS_INVALID_MESSAGE };
      }
      await setValue(BACKOFF_STORAGE_KEY, {
        kind: 'network-error',
        until: Date.now() + NETWORK_BACKOFF_MS,
        reason: status === 429 ? '登录被限流，冷却后重试' : String((e as Error)?.message ?? e),
      });
      return {
        outcome: 'network-error',
        detail:
          status === 429
            ? 'Cloud 登录尝试过于频繁，稍后自动重试'
            : 'Cloud 服务暂不可达，稍后自动重试',
      };
    }
  });
  if (reason && result.outcome !== 'already-authenticated') {
    console.info(`[CloudSync] auth recovery reason=${reason} outcome=${result.outcome}`);
  }
  return result;
}
