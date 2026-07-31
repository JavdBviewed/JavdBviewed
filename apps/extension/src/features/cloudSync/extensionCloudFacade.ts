/**
 * @file extensionCloudFacade.ts
 * @description 扩展 Cloud UI facade：集中暴露连接、登录态、设备、同步与错误动作
 * @module features/cloudSync
 */
import type { DeviceInfo } from '@javdb/sync-protocol';
import type { HttpTransport } from '@javdb/sync-client';
import {
  loadCloudAutoSyncSettings,
  saveCloudAutoSyncSettings,
  type CloudAutoSyncSettings,
} from './autoSyncSettings';
import {
  loadCloudSession,
  type CloudSessionRecord,
} from './chromeTokenStore';
import {
  loadCloudSettings,
  normalizeCloudBaseUrl,
  saveCloudSettings,
  type CloudConnectionSettings,
} from './cloudSettingsStorage';
import { createExtensionCloudClient } from './createExtensionCloudClient';
import { runCloudSyncNow, type CloudSyncNowResult } from './runCloudSyncNow';

export type CloudFacadeState = {
  settings: CloudConnectionSettings;
  autoSync: CloudAutoSyncSettings;
  session: CloudSessionRecord | null;
  loggedIn: boolean;
  devices: DeviceInfo[];
};

export type CloudHealthResult = {
  ok: boolean;
  detail: string;
  protocolVersion?: number;
  httpStatus?: number;
};

export type CloudLoginInput = {
  identifier: string;
  password: string;
};

export type CloudConnectionInput = {
  baseUrl: string;
  deviceLabel: string;
  identifier?: string;
  password?: string;
};

export type ExtensionCloudFacadeOptions = {
  transport?: HttpTransport;
  platform?: string;
  fetchImpl?: typeof fetch;
  setupAutoSyncAlarm?: () => Promise<void>;
  syncNow?: () => Promise<CloudSyncNowResult>;
};

export type ExtensionCloudFacade = {
  loadState(): Promise<CloudFacadeState>;
  saveConnection(input: CloudConnectionInput): Promise<CloudConnectionSettings>;
  checkHealth(baseUrl?: string): Promise<CloudHealthResult>;
  register(input: CloudLoginInput): Promise<void>;
  login(input: CloudLoginInput): Promise<CloudFacadeState>;
  logout(): Promise<CloudFacadeState>;
  listDevices(): Promise<DeviceInfo[]>;
  revokeDevice(deviceId: string): Promise<DeviceInfo[]>;
  syncNow(): Promise<CloudSyncNowResult>;
  setAutoSync(patch: Partial<CloudAutoSyncSettings>): Promise<CloudAutoSyncSettings>;
};

function requireCredentials(input: CloudLoginInput): { identifier: string; password: string } {
  const identifier = input.identifier.trim();
  if (!identifier || !input.password) {
    throw new Error('请填写账号与密码');
  }
  return { identifier, password: input.password };
}

async function setupAlarm(options: ExtensionCloudFacadeOptions): Promise<void> {
  if (options.setupAutoSyncAlarm) {
    await options.setupAutoSyncAlarm();
    return;
  }
  try {
    await chrome.runtime.sendMessage({ type: 'CLOUD_SYNC_SETUP_ALARM' });
  } catch {
    // ignore
  }
}

export function createExtensionCloudFacade(
  options: ExtensionCloudFacadeOptions = {},
): ExtensionCloudFacade {
  async function loadState(): Promise<CloudFacadeState> {
    const [settings, autoSync, session] = await Promise.all([
      loadCloudSettings(),
      loadCloudAutoSyncSettings(),
      loadCloudSession(),
    ]);
    let devices: DeviceInfo[] = [];
    if (session?.accessToken) {
      try {
        const { api } = await createExtensionCloudClient(settings, {
          transport: options.transport,
        });
        devices = await api.listDevices();
      } catch {
        devices = [];
      }
    }
    return {
      settings,
      autoSync,
      session,
      loggedIn: Boolean(session?.accessToken),
      devices,
    };
  }

  async function saveConnection(input: CloudConnectionInput): Promise<CloudConnectionSettings> {
    const baseUrl = normalizeCloudBaseUrl(input.baseUrl);
    if (!baseUrl) {
      throw new Error('请填写有效的 Cloud 地址，例如 http://127.0.0.1:18080');
    }
    return saveCloudSettings({
      baseUrl,
      deviceLabel: input.deviceLabel.trim() || '浏览器扩展',
      ...(typeof input.identifier === 'string'
        ? { accountIdentifier: input.identifier.trim() }
        : {}),
      ...(typeof input.password === 'string' ? { accountPassword: input.password } : {}),
    });
  }

  async function checkHealth(baseUrl?: string): Promise<CloudHealthResult> {
    const settings = await loadCloudSettings();
    const root = normalizeCloudBaseUrl(baseUrl ?? settings.baseUrl);
    if (!root) {
      return { ok: false, detail: '地址无效' };
    }
    const fetcher = options.fetchImpl ?? fetch;
    try {
      const res = await fetcher(`${root}/health`);
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        protocolVersion?: number;
      };
      if (!res.ok || !data.ok) {
        return { ok: false, detail: `异常 · HTTP ${res.status}`, httpStatus: res.status };
      }
      return {
        ok: true,
        detail: `在线 · 协议 v${data.protocolVersion ?? '?'}`,
        protocolVersion: data.protocolVersion,
        httpStatus: res.status,
      };
    } catch {
      return { ok: false, detail: '无法连接' };
    }
  }

  async function register(input: CloudLoginInput): Promise<void> {
    const credentials = requireCredentials(input);
    const settings = await saveCloudSettings({
      accountIdentifier: credentials.identifier,
      accountPassword: credentials.password,
    });
    const { api } = await createExtensionCloudClient(settings, {
      transport: options.transport,
    });
    await api.register(credentials);
  }

  async function login(input: CloudLoginInput): Promise<CloudFacadeState> {
    const credentials = requireCredentials(input);
    const settings = await saveCloudSettings({
      accountIdentifier: credentials.identifier,
      accountPassword: credentials.password,
    });
    const { api } = await createExtensionCloudClient(settings, {
      transport: options.transport,
    });
    await api.login({
      ...credentials,
      device: {
        id: settings.deviceId,
        label: settings.deviceLabel,
        clientType: 'extension',
        platform: options.platform ?? navigator.userAgent.slice(0, 120),
      },
    });
    await setupAlarm(options);
    return loadState();
  }

  async function logout(): Promise<CloudFacadeState> {
    const settings = await loadCloudSettings();
    const { api } = await createExtensionCloudClient(settings, {
      transport: options.transport,
    });
    try {
      await api.logout();
    } catch {
      await api.tokens.clear();
    }
    await setupAlarm(options);
    return loadState();
  }

  async function listDevices(): Promise<DeviceInfo[]> {
    const settings = await loadCloudSettings();
    const { api } = await createExtensionCloudClient(settings, {
      transport: options.transport,
    });
    return api.listDevices();
  }

  async function revokeDevice(deviceId: string): Promise<DeviceInfo[]> {
    const settings = await loadCloudSettings();
    if (deviceId === settings.deviceId) {
      throw new Error('不能踢掉本机，请使用「退出登录」');
    }
    const { api } = await createExtensionCloudClient(settings, {
      transport: options.transport,
    });
    await api.revokeDevice(deviceId);
    return api.listDevices();
  }

  async function setAutoSync(
    patch: Partial<CloudAutoSyncSettings>,
  ): Promise<CloudAutoSyncSettings> {
    const next = await saveCloudAutoSyncSettings(patch);
    await setupAlarm(options);
    return next;
  }

  return {
    loadState,
    saveConnection,
    checkHealth,
    register,
    login,
    logout,
    listDevices,
    revokeDevice,
    syncNow: options.syncNow ?? runCloudSyncNow,
    setAutoSync,
  };
}

export const extensionCloudFacade = createExtensionCloudFacade();
