/**
 * @file alarmRouter.ts
 * @description alarmRouter
 * @module apps/background
 */
import { handleAlarmAsync, compensateOnStartup, INSIGHTS_ALARM, registerMonthlyAlarm } from './scheduler';
import { newWorksScheduler } from '../../features/newWorks';
import { handleTelemetryAlarm, syncTelemetryHeartbeatAlarm, TELEMETRY_HEARTBEAT_ALARM } from '../../features/telemetry';
import { getSettings } from '../../utils/storage';
import { registerDynamicContentScripts } from './dynamicContentScripts';
import {
  EMBY_LIBRARY_SYNC_ALARM,
  handleEmbyLibraryAlarm,
  handleEmbyLibraryStateStorageChange,
  syncEmbyLibrarySyncAlarmFromCurrentSettings,
  syncEmbyLibrarySyncAlarmFromSettings,
} from '../../features/embyLibrary/background/scheduler';
import {
  DRIVE115_USER_REFRESH_ALARM,
  handleDrive115Alarm,
  handleDrive115SettingsChange,
} from './drive115UserRefresh';
import {
  DRIVE115_LIBRARY_INDEX_RESUME_ALARM,
  ensureDrive115MediaLibraryResumeAlarm,
  handleDrive115MediaLibraryResumeAlarm,
} from '../../features/drive115/mediaLibrary';
import { viewedPurgeExpired, actorsPurgeExpired } from '../../platform/storage/indexedDb';
import {
  ALARM_DIAGNOSTICS_STORAGE_KEY,
  getAlarmNextScheduledAt,
  readAlarmDiagnostics,
  recordAlarmFire,
  withAlarmDiagnostics,
} from './alarmDiagnostics';
import {
  CLOUD_AUTO_SYNC_ALARM,
  handleCloudAutoSyncAlarm,
  registerCloudSyncMessageHandler,
  registerCloudSyncStorageListener,
  setupCloudAutoSyncAlarm,
} from '../../features/cloudSync/backgroundCloudSync';

// re-export for message handlers / tests
export { ALARM_DIAGNOSTICS_STORAGE_KEY, readAlarmDiagnostics, recordAlarmFire };

const RECYCLE_BIN_CLEANUP_ALARM = 'RECYCLE_BIN_CLEANUP';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function initializeBackgroundAlarmWiring(): void {
  syncInsightsMonthlyAlarmFromSettings();
  syncEmbyLibrarySyncAlarmFromCurrentSettings().catch(() => {});
  ensureDrive115MediaLibraryResumeAlarm().catch(() => {});
  registerNewWorksStartupInitializer();
  registerRecycleBinCleanupAlarm();
  registerBackgroundAlarmRouter();
  registerBackgroundSettingsChangeRouter();
  // Cloud 自动同步：消息 + storage 监听 + 冷启动 ensure alarm
  try {
    registerCloudSyncMessageHandler();
    registerCloudSyncStorageListener();
    setupCloudAutoSyncAlarm().catch(() => {});
  } catch {}
  // 冷启动也 ensure 新作品 alarm（onStartup 之外）
  newWorksScheduler.initialize().catch((e: any) => {
    console.warn('[Background] Failed to initialize new works scheduler on boot:', e?.message || e);
  });
}

function registerRecycleBinCleanupAlarm(): void {
  try {
    chrome.alarms.create(RECYCLE_BIN_CLEANUP_ALARM, { periodInMinutes: 360 }); // 每6小时
  } catch {}
}

async function handleRecycleBinCleanup(): Promise<void> {
  const purgedVideos = await viewedPurgeExpired(THIRTY_DAYS_MS).catch(() => 0);
  const purgedActors = await actorsPurgeExpired(THIRTY_DAYS_MS).catch(() => 0);
  if (purgedVideos > 0 || purgedActors > 0) {
    console.log(`[RecycleBin] 清理过期记录: 番号 ${purgedVideos} 条, 演员 ${purgedActors} 条`);
  }
}

export function syncInsightsMonthlyAlarmFromSettings(): void {
  try {
    (async () => {
      try {
        const settings = await getSettings();
        const ins = settings?.insights || {};
        if (ins.autoMonthlyEnabled) {
          const minute = Number(ins.autoMonthlyMinuteOfDay ?? 10);
          registerMonthlyAlarm({ enabled: true, minuteOfDay: Number.isFinite(minute) ? minute : 10 });
        } else {
          try { chrome.alarms?.clear?.(INSIGHTS_ALARM); } catch {}
        }
      } catch {}
    })();
  } catch {}
}

export function registerNewWorksStartupInitializer(): void {
  try {
    chrome.runtime.onStartup.addListener(async () => {
      try {
        await ensureDrive115MediaLibraryResumeAlarm();
        await newWorksScheduler.initialize();
        try {
          const settings = await getSettings();
          syncEmbyLibrarySyncAlarmFromSettings(settings);
          const ins = settings?.insights || {};
          if (ins.autoCompensateOnStartupEnabled) {
            compensateOnStartup();
          }
        } catch {}
      } catch (e: any) {
        console.warn('[Background] Failed to initialize new works scheduler:', e?.message || e);
      }
    });
  } catch {}
}


export function registerBackgroundAlarmRouter(): void {
  try {
    chrome.alarms.onAlarm.addListener((alarm) => {
      const name = alarm?.name || '';

      // 115 用户刷新：同步返回，但仍记录诊断
      if (name === DRIVE115_USER_REFRESH_ALARM) {
        void withAlarmDiagnostics(name, async () => {
          handleDrive115Alarm(name);
          return true;
        }, () => 'drive115-user-refresh').catch(() => {});
        return;
      }

      if (name === DRIVE115_LIBRARY_INDEX_RESUME_ALARM) {
        void withAlarmDiagnostics(
          name,
          () => handleDrive115MediaLibraryResumeAlarm(name),
          () => 'drive115-library-index-resume',
        ).catch(() => {});
        return;
      }

      // 回收站清理
      if (name === RECYCLE_BIN_CLEANUP_ALARM) {
        void withAlarmDiagnostics(name, () => handleRecycleBinCleanup(), () => 'recycle-bin-cleanup').catch(() => {});
        return;
      }

      // Cloud 自动同步
      if (name === CLOUD_AUTO_SYNC_ALARM) {
        void withAlarmDiagnostics(
          name,
          async () => {
            await handleCloudAutoSyncAlarm(name);
            return true;
          },
          () => 'cloud-auto-sync',
        ).catch(() => {});
        return;
      }

      const keepAlive = setInterval(() => {
        try { chrome.storage.local.get('_keepalive', () => {}); } catch {}
      }, 20000);
      const done = () => clearInterval(keepAlive);
      try {
        const p = (async () => {
          // 新作品周期检查（与 drive115 同层 early-return）
          const handledNewWorks = await newWorksScheduler.handleAlarm(name);
          if (handledNewWorks) {
            const nextScheduledAt = await getAlarmNextScheduledAt(name);
            await recordAlarmFire(name, 'success', {
              summary: 'new-works-check',
              nextScheduledAt,
            });
            return;
          }

          if (await handleTelemetryAlarm(name)) {
            const nextScheduledAt = await getAlarmNextScheduledAt(name);
            await recordAlarmFire(name, 'success', {
              summary: name === TELEMETRY_HEARTBEAT_ALARM ? 'telemetry-heartbeat' : 'telemetry',
              nextScheduledAt,
            });
            return;
          }

          if (await handleEmbyLibraryAlarm(name)) {
            const nextScheduledAt = await getAlarmNextScheduledAt(name);
            await recordAlarmFire(name, 'success', {
              summary: name === EMBY_LIBRARY_SYNC_ALARM ? 'emby-library-sync' : 'emby',
              nextScheduledAt,
            });
            return;
          }

          await withAlarmDiagnostics(name, () => handleAlarmAsync(name), () => 'scheduler-async');
        })();
        p.then(done).catch(async (error) => {
          try {
            await recordAlarmFire(name, 'error', {
              error: error instanceof Error ? error.message : String(error),
            });
          } catch {}
          done();
        });
      } catch { done(); }
    });
  } catch {}
}

export function registerBackgroundSettingsChangeRouter(): void {
  try {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      handleEmbyLibraryStateStorageChange(changes, area);

      if (area === 'local' && changes['settings']) {
        try {
          const settings = await getSettings();
          const ins = settings?.insights || {};
          if (ins.autoMonthlyEnabled) {
            const minute = Number(ins.autoMonthlyMinuteOfDay ?? 10);
            registerMonthlyAlarm({ enabled: true, minuteOfDay: Number.isFinite(minute) ? minute : 10 });
          } else {
            try { chrome.alarms?.clear?.(INSIGHTS_ALARM); } catch {}
          }
          syncTelemetryHeartbeatAlarm(settings);
          syncEmbyLibrarySyncAlarmFromSettings(settings);

          const oldSettings = changes['settings']?.oldValue as any;
          const newSettings = changes['settings']?.newValue as any;
          const oldRoutes = oldSettings?.routes;
          const newRoutes = newSettings?.routes;
          if (JSON.stringify(oldRoutes) !== JSON.stringify(newRoutes)) {
            console.info('[Background] Routes config changed, re-registering dynamic content scripts');
            await registerDynamicContentScripts(true);
          }

          handleDrive115SettingsChange(oldSettings, newSettings);
        } catch {}
      }

      // 新作品配置变更时同步 alarm
      if (area === 'local' && changes['new_works_config']) {
        try {
          await newWorksScheduler.initialize();
        } catch {}
      }
    });
  } catch {}
}

export async function getBackgroundAlarmDiagnosticsSnapshot(): Promise<{
  diagnostics: Awaited<ReturnType<typeof readAlarmDiagnostics>>;
  storageKey: string;
}> {
  return {
    diagnostics: await readAlarmDiagnostics(),
    storageKey: ALARM_DIAGNOSTICS_STORAGE_KEY,
  };
}
