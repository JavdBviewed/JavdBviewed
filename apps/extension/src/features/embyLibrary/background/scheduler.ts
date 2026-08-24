/**
 * @file scheduler.ts
 * @description scheduler
 * @module features/embyLibrary
 */
import { STORAGE_KEYS, isEmbyLibraryEnabled } from '../../../utils/config';
import { getSettings } from '../../../utils/storage';
import { handleEmbyLibrarySync } from './handlers';

export const EMBY_LIBRARY_SYNC_ALARM = 'emby.library.sync';

const DEFAULT_SYNC_INTERVAL_MINUTES = 60;
const MIN_SYNC_INTERVAL_MINUTES = 5;
const MAX_SYNC_INTERVAL_MINUTES = 10080;
const LIBRARY_STATE_BROADCAST_DEBOUNCE_MS = 50;

type SyncLibrary = (message: { manual: boolean }) => Promise<any>;
let libraryStateBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

export interface EmbyLibraryAlarmDeps {
  syncLibrary?: SyncLibrary;
}

function hasEnabledMediaServer(settings: any): boolean {
  const servers = settings?.emby?.mediaServers;
  if (!Array.isArray(servers)) return false;
  return servers.some((server) => {
    return server
      && server.enabled !== false
      && String(server.url || '').trim()
      && String(server.apiKey || '').trim();
  });
}

function getSyncIntervalMinutes(settings: any): number {
  const raw = Number(settings?.emby?.syncIntervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SYNC_INTERVAL_MINUTES;
  return Math.max(MIN_SYNC_INTERVAL_MINUTES, Math.min(MAX_SYNC_INTERVAL_MINUTES, Math.round(raw)));
}

function shouldScheduleLibrarySync(settings: any): boolean {
  return isEmbyLibraryEnabled(settings?.emby) && hasEnabledMediaServer(settings);
}

export function syncEmbyLibrarySyncAlarmFromSettings(settings: any): void {
  try {
    if (!chrome?.alarms) return;
    chrome.alarms.clear(EMBY_LIBRARY_SYNC_ALARM);
    if (!shouldScheduleLibrarySync(settings)) return;

    const interval = getSyncIntervalMinutes(settings);
    chrome.alarms.create(EMBY_LIBRARY_SYNC_ALARM, {
      delayInMinutes: interval,
      periodInMinutes: interval,
    });
  } catch {}
}

export async function syncEmbyLibrarySyncAlarmFromCurrentSettings(): Promise<void> {
  try {
    const settings = await getSettings();
    syncEmbyLibrarySyncAlarmFromSettings(settings);
  } catch {}
}

async function runSyncLibrary(message: { manual: boolean }): Promise<any> {
  return new Promise((resolve) => {
    void handleEmbyLibrarySync(message, resolve);
  });
}

async function queryTabs(): Promise<chrome.tabs.Tab[]> {
  try {
    return await (chrome.tabs.query as any)({});
  } catch {
    return [];
  }
}

async function broadcastLibraryStateUpdated(): Promise<void> {
  if (!chrome?.tabs) return;
  const tabs = await queryTabs();
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'EMBY_LIBRARY_STATE_UPDATED' });
    } catch {}
  }));
}

function scheduleLibraryStateUpdatedBroadcast(): void {
  if (libraryStateBroadcastTimer) {
    clearTimeout(libraryStateBroadcastTimer);
  }

  libraryStateBroadcastTimer = setTimeout(() => {
    libraryStateBroadcastTimer = null;
    broadcastLibraryStateUpdated().catch(() => {});
  }, LIBRARY_STATE_BROADCAST_DEBOUNCE_MS);
}

export function handleEmbyLibraryStateStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): void {
  if (areaName !== 'local') return;
  if (!changes[STORAGE_KEYS.EMBY_LIBRARY_STATE]) return;

  scheduleLibraryStateUpdatedBroadcast();
}

export async function handleEmbyLibraryAlarm(
  alarmName: string,
  deps: EmbyLibraryAlarmDeps = {},
): Promise<boolean> {
  if (alarmName !== EMBY_LIBRARY_SYNC_ALARM) return false;

  const syncLibrary = deps.syncLibrary || runSyncLibrary;
  const response = await syncLibrary({ manual: false });
  if (response?.success && response?.skipped !== true) {
    scheduleLibraryStateUpdatedBroadcast();
  }

  return true;
}
