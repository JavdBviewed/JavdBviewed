/**
 * @file cloudSettingsStorage.ts
 * @description Cloud 连接配置（地址 / 设备名 / 可恢复账号）本地持久化
 * @module features/cloudSync
 */
import { getSettings } from '../../utils/storage';

export const CLOUD_SETTINGS_STORAGE_KEY = 'cloud_sync_settings_v1';

export type CloudConnectionSettings = {
  /** Cloud 根地址，如 http://127.0.0.1:18080 */
  baseUrl: string;
  /** 本机设备显示名 */
  deviceLabel: string;
  /** 用于再次登录的账号名；会随连接配置备份与同步。 */
  accountIdentifier: string;
  /** 用于再次登录的密码；会随连接配置备份与同步。 */
  accountPassword: string;
  /**
   * 稳定设备 id。
   * 优先复用 WebDAV `settings.webdav.clientId`（关于页 Device ID），
   * 避免 Cloud / WebDAV / 关于页出现两套身份。
   */
  deviceId: string;
  updatedAt: number;
};

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 与关于页 / WebDAV 共用的本机设备 ID（若尚未生成则返回空） */
export async function getSharedDeviceId(): Promise<string> {
  try {
    const settings = await getSettings();
    const id = String((settings as { webdav?: { clientId?: string } })?.webdav?.clientId || '').trim();
    return id;
  } catch {
    return '';
  }
}

export function createDefaultCloudSettings(sharedDeviceId?: string): CloudConnectionSettings {
  return {
    // 本机 Docker 在 Windows 上常因 8080 被保留而映射到 18080；仍可手改
    baseUrl: 'http://127.0.0.1:18080',
    deviceLabel: '浏览器扩展',
    accountIdentifier: '',
    accountPassword: '',
    deviceId: sharedDeviceId?.trim() || randomId(),
    updatedAt: Date.now(),
  };
}

export async function loadCloudSettings(): Promise<CloudConnectionSettings> {
  const sharedDeviceId = await getSharedDeviceId();

  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([CLOUD_SETTINGS_STORAGE_KEY], (res) => {
        const v = res?.[CLOUD_SETTINGS_STORAGE_KEY] as Partial<CloudConnectionSettings> | undefined;
        const defaults = createDefaultCloudSettings(sharedDeviceId);

        if (!v || typeof v !== 'object') {
          // 首次：直接落盘共享 deviceId，避免下次又 random
          void chrome.storage.local.set({ [CLOUD_SETTINGS_STORAGE_KEY]: defaults });
          resolve(defaults);
          return;
        }

        const storedId =
          typeof v.deviceId === 'string' && v.deviceId.trim() ? v.deviceId.trim() : '';
        // 若已有 WebDAV clientId，优先对齐到共享 id
        const deviceId = sharedDeviceId || storedId || defaults.deviceId;

        const next: CloudConnectionSettings = {
          baseUrl:
            typeof v.baseUrl === 'string' && v.baseUrl.trim() ? v.baseUrl.trim() : defaults.baseUrl,
          deviceLabel:
            typeof v.deviceLabel === 'string' && v.deviceLabel.trim()
              ? v.deviceLabel.trim()
              : defaults.deviceLabel,
          accountIdentifier:
            typeof v.accountIdentifier === 'string' ? v.accountIdentifier.trim() : '',
          accountPassword: typeof v.accountPassword === 'string' ? v.accountPassword : '',
          deviceId,
          updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now(),
        };

        // 后台纠正 deviceId 漂移（不阻塞 UI）
        if (sharedDeviceId && storedId && sharedDeviceId !== storedId) {
          void chrome.storage.local.set({
            [CLOUD_SETTINGS_STORAGE_KEY]: { ...next, updatedAt: Date.now() },
          });
        } else if (!storedId) {
          void chrome.storage.local.set({ [CLOUD_SETTINGS_STORAGE_KEY]: next });
        }

        resolve(next);
      });
    } catch {
      resolve(createDefaultCloudSettings(sharedDeviceId));
    }
  });
}

export async function saveCloudSettings(
  patch: Partial<CloudConnectionSettings>,
): Promise<CloudConnectionSettings> {
  const current = await loadCloudSettings();
  // 禁止调用方随意改写已有 deviceId（保持与 WebDAV 对齐）
  const nextDeviceId =
    current.deviceId ||
    (typeof patch.deviceId === 'string' ? patch.deviceId.trim() : '') ||
    (await getSharedDeviceId()) ||
    randomId();

  const next: CloudConnectionSettings = {
    ...current,
    ...patch,
    baseUrl: normalizeCloudBaseUrl(patch.baseUrl ?? current.baseUrl),
    deviceLabel: (patch.deviceLabel ?? current.deviceLabel).trim() || current.deviceLabel,
    accountIdentifier: (patch.accountIdentifier ?? current.accountIdentifier).trim(),
    accountPassword: patch.accountPassword ?? current.accountPassword,
    deviceId: nextDeviceId,
    updatedAt: Date.now(),
  };
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [CLOUD_SETTINGS_STORAGE_KEY]: next }, () => resolve(next));
    } catch {
      resolve(next);
    }
  });
}

/** 规范化用户输入的 base URL */
export function normalizeCloudBaseUrl(input: string): string {
  const t = input.trim();
  if (!t) return '';
  try {
    const u = new URL(t.includes('://') ? t : `http://${t}`);
    const path = u.pathname.replace(/\/+$/, '');
    return path && path !== '/'
      ? `${u.protocol}//${u.host}${path}`
      : `${u.protocol}//${u.host}`;
  } catch {
    return t.replace(/\/+$/, '');
  }
}
