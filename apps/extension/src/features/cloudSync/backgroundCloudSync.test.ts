/**
 * @file backgroundCloudSync.test.ts
 * @description Cloud 后台会话恢复、定时同步与本地改动同步回归
 * @module features/cloudSync
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadAuto: vi.fn(),
  recover: vi.fn(),
  runSync: vi.fn(),
  enqueueChange: vi.fn(),
  enqueueDeletion: vi.fn(),
  shouldSyncKey: vi.fn(),
  shouldSuppress: vi.fn(),
}));

vi.mock('./autoSyncSettings', () => ({ loadCloudAutoSyncSettings: mocks.loadAuto }));
vi.mock('./cloudAuthRecovery', () => ({ recoverCloudAuthSession: mocks.recover }));
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
    mocks.recover.mockResolvedValue({ outcome: 'already-authenticated' });
    mocks.runSync.mockResolvedValue({ code: 'SYNC_OK' });
    mocks.enqueueChange.mockResolvedValue(undefined);
    mocks.enqueueDeletion.mockResolvedValue(undefined);
    mocks.shouldSyncKey.mockReturnValue(true);
    mocks.shouldSuppress.mockReturnValue(false);
  });

  it('recovers a lost session with saved credentials before scheduling periodic sync', async () => {
    mocks.recover.mockResolvedValue({ outcome: 'recovered' });

    await setupCloudAutoSyncAlarm();

    expect(mocks.recover).toHaveBeenCalledWith('ensure-session');
    expect(alarmsCreate).toHaveBeenCalledWith(CLOUD_AUTO_SYNC_ALARM, {
      delayInMinutes: 5,
      periodInMinutes: 30,
    });
  });

  it('does not schedule the alarm when the saved password is invalid', async () => {
    mocks.recover.mockResolvedValue({ outcome: 'credentials-invalid' });

    await setupCloudAutoSyncAlarm();

    expect(mocks.recover).toHaveBeenCalledWith('ensure-session');
    expect(alarmsCreate).not.toHaveBeenCalled();
    expect(alarmsClear).toHaveBeenCalledWith(CLOUD_AUTO_SYNC_ALARM);
  });

  it('syncs on a periodic alarm while the session is still valid', async () => {
    await expect(handleCloudAutoSyncAlarm(CLOUD_AUTO_SYNC_ALARM)).resolves.toBe(true);

    expect(mocks.recover).toHaveBeenCalledWith('ensure-session');
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });

  it('syncs eligible local changes shortly after they are enqueued', async () => {
    vi.useFakeTimers();
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
