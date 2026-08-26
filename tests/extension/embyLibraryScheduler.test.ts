/**
 * @file embyLibraryScheduler.test.ts
 * @description Emby library scheduler 测试
 * @module tests/extension
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../apps/extension/src/utils/config';
import { getTabsMessages, setChromeStorage } from '../setup/chrome';

describe('Emby library scheduler', () => {
  it('schedules automatic library sync when library status has an enabled server', async () => {
    const { EMBY_LIBRARY_SYNC_ALARM, syncEmbyLibrarySyncAlarmFromSettings } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');

    syncEmbyLibrarySyncAlarmFromSettings({
      emby: {
        libraryEnabled: true,
        syncIntervalMinutes: 2,
        mediaServers: [
          {
            type: 'jellyfin',
            name: 'Home Jellyfin',
            url: 'http://jellyfin.local:8096',
            apiKey: 'secret',
            enabled: true,
          },
        ],
      },
    });

    expect(chrome.alarms.clear).toHaveBeenCalledWith(EMBY_LIBRARY_SYNC_ALARM);
    expect(chrome.alarms.create).toHaveBeenCalledWith(EMBY_LIBRARY_SYNC_ALARM, {
      delayInMinutes: 5,
      periodInMinutes: 5,
    });
  });

  it('clears automatic library sync when library status is disabled', async () => {
    const { EMBY_LIBRARY_SYNC_ALARM, syncEmbyLibrarySyncAlarmFromSettings } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');

    syncEmbyLibrarySyncAlarmFromSettings({
      emby: {
        libraryEnabled: false,
        syncIntervalMinutes: 60,
        mediaServers: [
          {
            type: 'emby',
            name: 'Home Emby',
            url: 'http://emby.local:8096',
            apiKey: 'secret',
            enabled: true,
          },
        ],
      },
    });

    expect(chrome.alarms.clear).toHaveBeenCalledWith(EMBY_LIBRARY_SYNC_ALARM);
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('runs automatic sync and notifies content tabs when the alarm fires', async () => {
    const { EMBY_LIBRARY_SYNC_ALARM, handleEmbyLibraryAlarm } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');
    setChromeStorage({
      [STORAGE_KEYS.SETTINGS]: {
        ...DEFAULT_SETTINGS,
        emby: {
          ...(DEFAULT_SETTINGS as any).emby,
          libraryStatus: {
            enabled: true,
            showOnList: true,
            showOnDetail: true,
          },
          mediaServers: [
            {
              id: 'jf-main',
              type: 'jellyfin',
              name: 'Home Jellyfin',
              url: 'http://jellyfin.local:8096',
              apiKey: 'secret',
              enabled: true,
            },
          ],
        },
      },
    });
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 1, url: 'https://javdb.com/' } as chrome.tabs.Tab,
      { id: 2, url: 'https://example.com/' } as chrome.tabs.Tab,
    ]);
    const syncLibrary = vi.fn(async () => ({ success: true, synced: 1, failed: 0 }));

    const handled = await handleEmbyLibraryAlarm(EMBY_LIBRARY_SYNC_ALARM, { syncLibrary });

    expect(handled).toBe(true);
    expect(syncLibrary).toHaveBeenCalledWith({ manual: false });
    expect(getTabsMessages()).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(getTabsMessages()).toEqual([
      { tabId: 1, message: { type: 'EMBY_LIBRARY_STATE_UPDATED' } },
      { tabId: 2, message: { type: 'EMBY_LIBRARY_STATE_UPDATED' } },
    ]);
  });

  it('does not notify content tabs when automatic sync is skipped by interval', async () => {
    const { EMBY_LIBRARY_SYNC_ALARM, handleEmbyLibraryAlarm } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');
    const syncLibrary = vi.fn(async () => ({ success: true, skipped: true, synced: 0, failed: 0 }));

    const handled = await handleEmbyLibraryAlarm(EMBY_LIBRARY_SYNC_ALARM, { syncLibrary });

    expect(handled).toBe(true);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it('notifies content tabs when the library state changes in local storage', async () => {
    const { handleEmbyLibraryStateStorageChange } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 1, url: 'https://javdb.com/' } as chrome.tabs.Tab,
      { id: 2, url: 'https://javdb.com/v/abc' } as chrome.tabs.Tab,
    ]);

    handleEmbyLibraryStateStorageChange({
      [STORAGE_KEYS.EMBY_LIBRARY_STATE]: {
        oldValue: { entries: {}, updatedAt: 0 },
        newValue: { entries: {}, updatedAt: 100 },
      },
    }, 'local');
    await vi.advanceTimersByTimeAsync(50);

    expect(getTabsMessages()).toEqual([
      { tabId: 1, message: { type: 'EMBY_LIBRARY_STATE_UPDATED' } },
      { tabId: 2, message: { type: 'EMBY_LIBRARY_STATE_UPDATED' } },
    ]);
  });

  it('does not notify content tabs for ordinary settings changes', async () => {
    const { handleEmbyLibraryStateStorageChange } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');

    handleEmbyLibraryStateStorageChange({
      [STORAGE_KEYS.SETTINGS]: {
        oldValue: {},
        newValue: DEFAULT_SETTINGS,
      },
    }, 'local');
    await vi.advanceTimersByTimeAsync(50);

    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(getTabsMessages()).toEqual([]);
  });

  it('coalesces rapid library state storage changes into one broadcast', async () => {
    const { handleEmbyLibraryStateStorageChange } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 1, url: 'https://javdb.com/' } as chrome.tabs.Tab,
    ]);

    handleEmbyLibraryStateStorageChange({
      [STORAGE_KEYS.EMBY_LIBRARY_STATE]: { oldValue: undefined, newValue: { entries: {}, updatedAt: 1 } },
    }, 'local');
    handleEmbyLibraryStateStorageChange({
      [STORAGE_KEYS.EMBY_LIBRARY_STATE]: { oldValue: undefined, newValue: { entries: {}, updatedAt: 2 } },
    }, 'local');
    handleEmbyLibraryStateStorageChange({
      [STORAGE_KEYS.EMBY_LIBRARY_STATE]: { oldValue: undefined, newValue: { entries: {}, updatedAt: 3 } },
    }, 'local');
    await vi.advanceTimersByTimeAsync(50);

    expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
    expect(getTabsMessages()).toEqual([
      { tabId: 1, message: { type: 'EMBY_LIBRARY_STATE_UPDATED' } },
    ]);
  });

  it('coalesces alarm success and storage state changes into one broadcast', async () => {
    const {
      EMBY_LIBRARY_SYNC_ALARM,
      handleEmbyLibraryAlarm,
      handleEmbyLibraryStateStorageChange,
    } = await import('../../apps/extension/src/features/embyLibrary/background/scheduler');
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 1, url: 'https://javdb.com/' } as chrome.tabs.Tab,
    ]);
    const syncLibrary = vi.fn(async () => ({ success: true, synced: 1, failed: 0 }));

    const handled = await handleEmbyLibraryAlarm(EMBY_LIBRARY_SYNC_ALARM, { syncLibrary });
    handleEmbyLibraryStateStorageChange({
      [STORAGE_KEYS.EMBY_LIBRARY_STATE]: { oldValue: undefined, newValue: { entries: {}, updatedAt: 100 } },
    }, 'local');
    await vi.advanceTimersByTimeAsync(50);

    expect(handled).toBe(true);
    expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
    expect(getTabsMessages()).toEqual([
      { tabId: 1, message: { type: 'EMBY_LIBRARY_STATE_UPDATED' } },
    ]);
  });

  it('registers the background storage listener for direct library state changes', async () => {
    const { registerBackgroundSettingsChangeRouter } = await import('../../apps/extension/src/apps/background/alarmRouter');
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 1, url: 'https://javdb.com/' } as chrome.tabs.Tab,
    ]);

    registerBackgroundSettingsChangeRouter();
    await chrome.storage.local.set({
      [STORAGE_KEYS.EMBY_LIBRARY_STATE]: { entries: {}, updatedAt: 100 },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(getTabsMessages()).toEqual([
      { tabId: 1, message: { type: 'EMBY_LIBRARY_STATE_UPDATED' } },
    ]);
  });
});
