/**
 * @file bootstrap.ts
 * @description bootstrap
 * @module apps/background
 */
// 背景入口：装配与注册各模块

if (typeof self === 'undefined' || !(self as any).registration) {
  console.warn('[Background] Service Worker context not ready, waiting...');
}

import { installDrive115V2Proxy } from '../../features/drive115/v2/backgroundProxy';
import { ensureMigrationsStart } from '../../platform/storage/migrations';
import { registerMiscRouter } from './miscMessageRouter';
import { registerWebDAVRouter } from '../../features/webdavSync/background/controller';
import { globalTaskCenter } from '../../background/globalTaskCenter';
import { registerNetProxyRouter } from '../../platform/network/backgroundFetchRouter';
import { installConsoleProxyWithSettings } from '../../platform/logging/backgroundConsole';
import { ensureWebDAVClientIdentity } from '../../features/webdavSync';
import {
  handleTelemetryRuntimeMessage,
  initializeTelemetryReporter,
} from '../../features/telemetry';
import { getSettings, saveSettings } from '../../utils/storage';
import { initializeBackgroundAlarmWiring } from './alarmRouter';
import { registerDbMessageRouter } from './dbMessageRouter';
import {
  registerDynamicContentScripts,
  registerEmbyDynamicContentScriptsOnStartup,
} from './dynamicContentScripts';
import { syncDrive115DailyAlarmFromSettings } from './drive115UserRefresh';
import { installCoversRefererDNR } from './dnrRules';
import { registerBackgroundErrorHandlers } from './errorHandlers';
import { registerReleaseAnnouncementEvents } from './releaseAnnouncementEvents';
import { initializeRouteAutoUpdate } from './routeAutoUpdate';
import { initializeTelemetryAfterClientIdentity } from './telemetryStartup';
import {
  parseBackgroundBootstrapSkipProfile,
  shouldRunBackgroundBootstrapStep,
} from './bootstrapProfile';

const skippedBootstrapSteps = parseBackgroundBootstrapSkipProfile(
  import.meta.env.VITE_JAVDB_PERF_BOOTSTRAP_SKIP,
);
const shouldRunBootstrapStep = (step: Parameters<typeof shouldRunBackgroundBootstrapStep>[1]) => (
  shouldRunBackgroundBootstrapStep(skippedBootstrapSteps, step)
);

if (skippedBootstrapSteps.length > 0) {
  console.info('[Background] Diagnostic bootstrap profile enabled', {
    skippedSteps: skippedBootstrapSteps,
  });
}

installConsoleProxyWithSettings();
if (shouldRunBootstrapStep('drive115-proxy')) installDrive115V2Proxy();
if (shouldRunBootstrapStep('migrations')) ensureMigrationsStart();
if (shouldRunBootstrapStep('release-announcement')) registerReleaseAnnouncementEvents();
if (shouldRunBootstrapStep('telemetry')) {
  initializeTelemetryAfterClientIdentity({
    ensureClientIdentity: () => ensureWebDAVClientIdentity({ getSettings, saveSettings }),
    initializeTelemetry: initializeTelemetryReporter,
    logWarning: (message, context) => console.warn(message, context),
  }).catch(() => {});
}

if (shouldRunBootstrapStep('task-center-restore')) {
  globalTaskCenter.restoreFromStorage().catch(console.warn);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    console.log('[Background] Tab removed, canceling tasks', { tabId });
    globalTaskCenter.cancelTasksByTabId(tabId, 'page-closed-by-user');
  } catch (err) {
    console.warn('[Background] cancelTasksByTabId failed:', err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (handleTelemetryRuntimeMessage(message, sendResponse)) {
    return true;
  }
  if (typeof message?.type === 'string' && message.type.startsWith('task-center:')) {
    globalTaskCenter.handleMessage(message, sender, sendResponse);
    return globalTaskCenter.isAsyncMessage(message.type) || undefined;
  }
  if (message?.type === 'CANCEL_STALE_LEASE') {
    try {
      const { taskId, reason } = message.payload || {};
      if (taskId) {
        globalTaskCenter.cancelTask(taskId, reason || 'hidden-timeout');
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'missing-task-id' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
    return false;
  }
  return false;
});

if (shouldRunBootstrapStep('dynamic-content-scripts')) registerDynamicContentScripts();
if (shouldRunBootstrapStep('emby-content-scripts')) registerEmbyDynamicContentScriptsOnStartup();
if (shouldRunBootstrapStep('route-auto-update')) initializeRouteAutoUpdate();

if (shouldRunBootstrapStep('webdav-router')) registerWebDAVRouter();
if (shouldRunBootstrapStep('db-router')) registerDbMessageRouter();
if (shouldRunBootstrapStep('misc-router')) registerMiscRouter();
if (shouldRunBootstrapStep('net-proxy-router')) registerNetProxyRouter();

if (shouldRunBootstrapStep('covers-referer-dnr')) installCoversRefererDNR();
if (shouldRunBootstrapStep('drive115-alarm')) syncDrive115DailyAlarmFromSettings().catch(() => {});
if (shouldRunBootstrapStep('alarm-wiring')) initializeBackgroundAlarmWiring();
if (shouldRunBootstrapStep('error-handlers')) registerBackgroundErrorHandlers();

try {
  console.info('[Background] Service Worker ready', { ts: new Date().toISOString() });
} catch {}
