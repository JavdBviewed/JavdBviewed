/**
 * @file backgroundCloudSync.ts
 * @description Background：定时 Cloud 同步闹钟 + 消息触发同步
 * @module features/cloudSync
 */
import { loadCloudSession } from './chromeTokenStore';
import { loadCloudAutoSyncSettings } from './autoSyncSettings';
import { loadCloudSettings } from './cloudSettingsStorage';
import { createExtensionCloudClient } from './createExtensionCloudClient';
import {
  enqueueStorageItemChange,
  enqueueStorageItemDeletion,
  scheduleEnqueue,
} from './enqueueLocalChange';
import { shouldSuppressCloudStorageChange } from './storageChangeGate';
import { runCloudSyncNow } from './runCloudSyncNow';
import { shouldSyncStorageItemKey } from './storageItemPolicy';

export const CLOUD_AUTO_SYNC_ALARM = 'cloud-auto-sync';

let syncInFlight: Promise<unknown> | null = null;
let credentialLoginInFlight: Promise<boolean> | null = null;
let localChangeSyncTimer: ReturnType<typeof setTimeout> | null = null;

/** 会话丢失时用已保存的账号密码恢复；失败不清除配置，等待用户修正后再试。 */
async function ensureCloudSessionFromSavedCredentials(): Promise<boolean> {
  const existing = await loadCloudSession();
  if (existing?.accessToken) return true;
  if (credentialLoginInFlight) return credentialLoginInFlight;
  credentialLoginInFlight = (async () => {
    const settings = await loadCloudSettings();
    if (!settings.baseUrl || !settings.accountIdentifier || !settings.accountPassword) return false;
    try {
      const { api } = await createExtensionCloudClient(settings);
      await api.login({
        identifier: settings.accountIdentifier,
        password: settings.accountPassword,
        device: {
          id: settings.deviceId,
          label: settings.deviceLabel,
          clientType: 'extension',
          platform: navigator.userAgent.slice(0, 120),
        },
      });
      return Boolean((await loadCloudSession())?.accessToken);
    } catch (e) {
      console.warn('[CloudSync] automatic login failed', e);
      return false;
    }
  })().finally(() => {
    credentialLoginInFlight = null;
  });
  return credentialLoginInFlight;
}

/** 合并短时间内的本地改动；入队完成后立即同步，不必等待下一个周期闹钟。 */
function scheduleCloudSyncAfterLocalChange(): void {
  if (localChangeSyncTimer) clearTimeout(localChangeSyncTimer);
  localChangeSyncTimer = setTimeout(() => {
    localChangeSyncTimer = null;
    void (async () => {
      const auto = await loadCloudAutoSyncSettings();
      if (!auto.enabled || !await ensureCloudSessionFromSavedCredentials()) return;
      await runCloudSyncExclusive();
    })().catch((e) => console.warn('[CloudSync] local change sync failed', e));
  }, 1_000);
}

export async function runCloudSyncExclusive(): Promise<Awaited<ReturnType<typeof runCloudSyncNow>>> {
  if (syncInFlight) {
    await syncInFlight.catch(() => {});
  }
  const run = runCloudSyncNow();
  syncInFlight = run.finally(() => {
    syncInFlight = null;
  });
  return run as Promise<Awaited<ReturnType<typeof runCloudSyncNow>>>;
}

export async function setupCloudAutoSyncAlarm(): Promise<void> {
  try {
    const auto = await loadCloudAutoSyncSettings();
    const loggedIn = await ensureCloudSessionFromSavedCredentials();
    if (!auto.enabled || !loggedIn) {
      try {
        chrome.alarms?.clear?.(CLOUD_AUTO_SYNC_ALARM);
      } catch {
        // ignore
      }
      return;
    }
    const period = Math.max(5, auto.intervalMinutes);
    chrome.alarms.create(CLOUD_AUTO_SYNC_ALARM, {
      delayInMinutes: Math.min(period, 5),
      periodInMinutes: period,
    });
  } catch (e) {
    console.warn('[CloudSync] setup alarm failed', e);
  }
}

export async function handleCloudAutoSyncAlarm(name: string): Promise<boolean> {
  if (name !== CLOUD_AUTO_SYNC_ALARM) return false;
  try {
    if (!await ensureCloudSessionFromSavedCredentials()) return true;
    const auto = await loadCloudAutoSyncSettings();
    if (!auto.enabled) return true;
    await runCloudSyncExclusive();
  } catch (e) {
    console.warn('[CloudSync] auto sync failed', e);
  }
  return true;
}

export function registerCloudSyncMessageHandler(): void {
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse): boolean | void => {
      if (!message || typeof message !== 'object') return false;
      if (message.type === 'CLOUD_SYNC_NOW') {
        runCloudSyncExclusive()
          .then((result) => sendResponse({ success: true, result }))
          .catch((e: unknown) =>
            sendResponse({
              success: false,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        return true;
      }
      if (message.type === 'CLOUD_SYNC_SETUP_ALARM') {
        setupCloudAutoSyncAlarm()
          .then(() => sendResponse({ success: true }))
          .catch((e: unknown) =>
            sendResponse({
              success: false,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        return true;
      }
      return false;
    });
  } catch {
    // ignore
  }
}

/** storage 变更时刷新闹钟（登录态 / 自动同步开关） */
export function registerCloudSyncStorageListener(): void {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (
        changes.cloud_sync_session_v1 ||
        changes.cloud_auto_sync_settings_v1 ||
        changes.cloud_sync_settings_v1
      ) {
        void setupCloudAutoSyncAlarm();
      }
      const storageChanges = Object.entries(changes).filter(
        ([key, change]) =>
          shouldSyncStorageItemKey(key) &&
          !shouldSuppressCloudStorageChange(key, change),
      );
      if (storageChanges.length) {
        scheduleEnqueue(async () => {
          for (const [key, change] of storageChanges) {
            if (Object.prototype.hasOwnProperty.call(change, 'newValue')) {
              await enqueueStorageItemChange(key, change.newValue);
            } else {
              await enqueueStorageItemDeletion(key);
            }
          }
          scheduleCloudSyncAfterLocalChange();
        });
      }
    });
  } catch {
    // ignore
  }
}
