/**
 * @file backgroundCloudSync.test.ts
 * @description Cloud 后台自动登录、定时同步与本地改动同步回归
 * @module features/cloudSync
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadAuto: vi.fn(),
  loadSettings: vi.fn(),
  createClient: vi.fn(),
  runSync: vi.fn(),
  enqueueChange: vi.fn(),
  enqueueDeletion: vi.fn(),
  shouldSyncKey: vi.fn(),
  shouldSuppress: vi.fn(),
}));

vi.mock('./chromeTokenStore', () => ({ loadCloudSession: mocks.loadSession }));
vi.mock('./autoSyncSettings', () => ({ loadCloudAutoSyncSettings: mocks.loadAuto }));
vi.mock('./cloudSettingsStorage', () => ({ loadCloudSettings: mocks.loadSettings }));
vi.mock('./createExtensionCloudClient', () => ({ createExtensionCloudClient: mocks.createClient }));
vi.mock('./runCloudSyncNow', () => ({ runCloudSyncNow: mocks.runSync }));
vi.mock('./enqueueLocalChange', () => ({
  enqueueStorageItemChange: mocks.enqueueChange,
  enqueueStorageItemDeletion: mocks.enqueueDeletion,
  scheduleEnqueue: (task: () => Promise<void>) => { void task(); },
}));
vi.mock('./storageChangeGate', () => ({ shouldSuppressCloudStorageChange: mocks.shouldSuppress }));
vi.mock('./storageItemPolicy', () => ({ shouldSyncStorageItemKey: mocks.shouldSyncKey }));

import {
  CLOUD_AUTO_SYNC_ALARM,
  handleCloudAutoSyncAlarm,
  registerCloudSyncStorageListener,
  setupCloudAutoSyncAlarm,
} from './backgroundCloudSync';

const savedSettings = {
  baseUrl: 'http://cloud.test',
  accountIdentifier: 'tester',
  accountPassword: 'password',
  deviceId: 'device-1',
  deviceLabel: '测试浏览器',
};

describe('backgroundCloudSync', () => {
  let storageChangedListener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null;
  const alarmsCreate = vi.fn();
  const alarmsClear = vi.fn();

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    storageChangedListener = null;
    vi.stubGlobal('chrome', {
      alarms: { create: alarmsCreate, clear: alarmsClear },
      storage: {
        onChanged: {
          addListener: vi.fn((listener) => { storageChangedListener = listener; }),
        },
      },
    });
    mocks.loadAuto.mockResolvedValue({ enabled: true, intervalMinutes: 30 });
    mocks.loadSettings.mockResolvedValue(savedSettings);
    mocks.createClient.mockResolvedValue({ api: { login: vi.fn().mockResolvedValue(undefined) } });
    mocks.runSync.mockResolvedValue({ code: 'SYNC_OK' });
    mocks.enqueueChange.mockResolvedValue(undefined);
    mocks.enqueueDeletion.mockResolvedValue(undefined);
    mocks.shouldSyncKey.mockReturnValue(true);
    mocks.shouldSuppress.mockReturnValue(false);
  });

  it('restores a saved account session before scheduling periodic sync', async () => {
    mocks.loadSession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ accessToken: 'restored-token' });

    await setupCloudAutoSyncAlarm();

    expect(mocks.createClient).toHaveBeenCalledWith(savedSettings);
    expect(alarmsCreate).toHaveBeenCalledWith(CLOUD_AUTO_SYNC_ALARM, {
      delayInMinutes: 5,
      periodInMinutes: 30,
    });
  });

  it('restores a saved account session before a periodic alarm sync', async () => {
    mocks.loadSession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ accessToken: 'restored-token' });

    await expect(handleCloudAutoSyncAlarm(CLOUD_AUTO_SYNC_ALARM)).resolves.toBe(true);

    expect(mocks.createClient).toHaveBeenCalledWith(savedSettings);
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });

  it('syncs eligible local changes shortly after they are enqueued', async () => {
    vi.useFakeTimers();
    mocks.loadSession.mockResolvedValue({ accessToken: 'token' });
    registerCloudSyncStorageListener();
    expect(storageChangedListener).not.toBeNull();

    storageChangedListener?.({
      settings: { oldValue: {}, newValue: { display: { theme: 'dark' } } },
    }, 'local');
    await vi.runAllTicks();
    expect(mocks.enqueueChange).toHaveBeenCalledWith('settings', { display: { theme: 'dark' } });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });
});
