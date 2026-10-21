/**
 * @file controller.ts
 * @description controller
 * @module features/webdavSync
 */
// src/features/webdavSync/background/controller.ts
// WebDAV 后台装配层。

import { STORAGE_KEYS } from '../../../utils/config';
import { getSettings, getValue, saveSettings } from '../../../utils/storage';
import { readRawSettingsOrUndefined, saveSettingsSectionDelta, type SettingsDeltaWriter } from '../../../utils/settingsDelta';
import {
  getClientFilePath,
  normalizeWebDavBaseUrl,
  WEBDAV_UPLOAD_INDEX_FILE,
} from '../domain/paths';
import type {
  WebDAVClientProfile,
  WebDAVFile,
  WebDAVKnownDevice,
  WebDAVKnownDeviceView,
  WebDAVUploadIndex,
  WebDAVUploadIndexItem,
} from '../domain/types';
import {
  ensureWebDAVClientIdentity as ensureWebDAVClientIdentityCore,
  getWebDAVClientProfile,
  sanitizeDeviceLabel,
} from '../application/clientIdentity';
import {
  listWebDAVClientProfiles,
  readWebDAVClientProfile,
  updateWebDAVClientRegistry,
} from '../application/clientRegistry';
import {
  buildKnownDeviceInputsFromRemoteState,
  buildKnownDeviceViews,
  buildMissingRemoteClientProfiles,
  mergeKnownDevices,
  type WebDAVKnownDeviceSourceInput,
} from '../application/deviceRegistry';
import {
  ensureWebDAVSupportDirs,
  webDavReadJsonFile,
  webDavWriteJsonFile,
} from '../infrastructure/webdavClient';
import {
  collectBackupData as collectWebDAVBackupData,
} from '../application/backupCollector';
import { listWebDAVFiles } from '../application/cleanupService';
import { performWebDAVUpload } from '../application/uploadService';
import {
  downloadBackupFileAsBase64 as downloadBackupFileAsBase64Core,
  previewBackup as previewBackupCore,
} from '../application/restorePreview';
import {
  applyImportDataDirect as applyImportDataDirectCore,
  performRestoreUnified as performRestoreUnifiedCore,
} from '../application/restoreService';
import {
  diagnoseWebDAVConnection as diagnoseWebDAVConnectionCore,
  testWebDAVConnection as testWebDAVConnectionCore,
  testWebDAVConnectionWithConfig as testWebDAVConnectionWithConfigCore,
} from '../application/diagnostics';
import { registerWebDAVRouterListener } from './router';

export {
  buildUploadId,
  joinWebDavUrl,
  normalizeWebDavBaseUrl,
} from '../domain/paths';
export { sanitizeDeviceLabel } from '../application/clientIdentity';
export { isUserBackupFile, parseWebDAVResponse } from '../infrastructure/propfindParser';
export { byteSizeOf, omitLocalOnlyStorageKeys } from '../application/backupCollector';
export { buildNextWebDAVUploadIndex } from '../application/uploadIndex';
export { sanitizeImportedSettings } from '../application/importSanitizer';
export { buildBackupPreview } from '../application/restorePreview';
export { chunk, toArrayFromObjMap } from '../application/restoreStorage';
export { buildWebDAVDiagnosticConfig } from '../application/diagnostics';

function bgLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, data?: any): void {
  try { chrome.runtime.sendMessage({ type: 'log-message', payload: { level, message, data } }); } catch {}
}

let webdavAutoUploadInProgress = false;

// 10-21 B 组：controller 持久化点统一走 section delta 原语（写前紧贴重读 raw，只合 webdav 节）
const settingsDeltaWriter: SettingsDeltaWriter = {
  readRawSettings: () => getValue<any>(STORAGE_KEYS.SETTINGS, undefined),
  getMergedSettings: async (): Promise<Record<string, any>> => (await getSettings()) as Record<string, any>,
  saveSettings,
};

async function ensureWebDAVClientIdentity(): Promise<any> {
  return ensureWebDAVClientIdentityCore({
    getSettings,
    saveSettings,
    readRawSettings: () => getValue<any>(STORAGE_KEYS.SETTINGS, undefined),
  });
}

function readKnownDevices(value: unknown): WebDAVKnownDevice[] {
  return Array.isArray(value) ? value as WebDAVKnownDevice[] : [];
}

function buildActiveWebDAVKnownDeviceSource(webdav: any, baseUrl: string, seenAt: number): WebDAVKnownDeviceSourceInput {
  const activeConfigId = String(webdav?.activeConfigId || '').trim();
  const configs = Array.isArray(webdav?.configs) ? webdav.configs : [];
  const activeConfig = configs.find((config: any) => String(config?.id || '').trim() === activeConfigId);
  const configId = activeConfigId || String(activeConfig?.id || '').trim() || 'default';
  const configName = String(activeConfig?.name || '').trim() || undefined;
  const username = String(webdav?.username || '').trim();

  return {
    configId,
    configName,
    urlFingerprint: `${baseUrl}|${username}`,
    seenAt,
    hasClientProfile: false,
    hasBackup: false,
  };
}

async function readWebDAVUploadIndexItems(
  baseUrl: string,
  auth: { username: string; password: string },
): Promise<WebDAVUploadIndexItem[]> {
  const uploadIndex = await webDavReadJsonFile<WebDAVUploadIndex>(baseUrl, auth, WEBDAV_UPLOAD_INDEX_FILE).catch(() => null);
  return Array.isArray(uploadIndex?.items) ? uploadIndex.items : [];
}

async function persistKnownDevicesIfChanged(knownDevices: WebDAVKnownDevice[]): Promise<void> {
  // 10-21 B4：写前紧贴重读做 IfChanged 判别（保持跳过写语义），section delta 只写 knownDevices
  const latestRaw = await readRawSettingsOrUndefined(settingsDeltaWriter.readRawSettings);
  const latestBase = latestRaw !== undefined ? latestRaw : await getSettings();
  const previous = JSON.stringify(readKnownDevices((latestBase as any)?.webdav?.knownDevices));
  const next = JSON.stringify(knownDevices);
  if (previous === next) return;

  await saveSettingsSectionDelta(settingsDeltaWriter, latestBase, 'webdav', () => ({ knownDevices }));
}

function normalizeWebDAVClientListError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return '无法连接到 WebDAV 服务器，请检查服务器地址和当前网络。';
  }
  if (/CORS/i.test(message)) {
    return 'WebDAV 服务器拒绝了当前请求，请检查服务器跨域或访问策略。';
  }
  return message || '已知设备清单读取失败。';
}

async function backfillKnownDevicesToCurrentRemote(
  baseUrl: string,
  auth: { username: string; password: string },
  knownDevices: WebDAVKnownDevice[],
  remoteProfiles: WebDAVClientProfile[],
  source: WebDAVKnownDeviceSourceInput,
): Promise<{ written: number; failed: number; writtenProfiles: WebDAVClientProfile[] }> {
  const missingProfiles = buildMissingRemoteClientProfiles(knownDevices, remoteProfiles);
  if (missingProfiles.length === 0) return { written: 0, failed: 0, writtenProfiles: [] };

  let written = 0;
  let failed = 0;
  const writtenProfiles: WebDAVClientProfile[] = [];

  for (const profile of missingProfiles) {
    try {
      await updateWebDAVClientRegistry(baseUrl, auth, profile);
      written += 1;
      writtenProfiles.push(profile);
    } catch (error: any) {
      failed += 1;
      bgLog('WARN', 'Failed to backfill WebDAV known device profile', {
        clientId: profile.clientId,
        configId: source.configId,
        error: error?.message,
      });
    }
  }

  return { written, failed, writtenProfiles };
}

async function listWebDAVClients(): Promise<{
  success: boolean;
  clients?: WebDAVKnownDeviceView[];
  currentClientId?: string;
  remoteSync?: { attempted: boolean; written: number; failed: number };
  error?: string;
}> {
  const settings = await ensureWebDAVClientIdentity();
  const webdav = settings.webdav || {};
  if (!webdav.enabled || !webdav.url || !webdav.username || !webdav.password) {
    return { success: false, error: 'WebDAV connection details are not fully configured.' };
  }

  const baseUrl = normalizeWebDavBaseUrl(webdav.url);
  const auth = { username: webdav.username, password: webdav.password };
  const now = Date.now();
  const currentProfile = getWebDAVClientProfile(settings);
  const currentSource = buildActiveWebDAVKnownDeviceSource(webdav, baseUrl, now);
  try {
    const remoteProfiles = await listWebDAVClientProfiles(baseUrl, auth);
    const uploadItems = await readWebDAVUploadIndexItems(baseUrl, auth);
    let knownDevices = mergeKnownDevices(
      readKnownDevices(webdav.knownDevices),
      buildKnownDeviceInputsFromRemoteState({
        profiles: remoteProfiles,
        uploadItems,
        source: currentSource,
        now,
      }),
      {
        now,
        currentProfile,
        currentSource: {
          ...currentSource,
          hasClientProfile: remoteProfiles.some((profile) => String(profile.clientId || '').trim() === currentProfile.clientId),
          hasBackup: uploadItems.some((item) => String(item.clientId || '').trim() === currentProfile.clientId && item.status === 'success'),
        },
      },
    );

    await persistKnownDevicesIfChanged(knownDevices);

    const remoteSync = await backfillKnownDevicesToCurrentRemote(baseUrl, auth, knownDevices, remoteProfiles, currentSource);
    if (remoteSync.writtenProfiles.length > 0) {
      knownDevices = mergeKnownDevices(
        knownDevices,
        remoteSync.writtenProfiles.map((profile) => ({
          profile,
          source: { ...currentSource, seenAt: Date.now(), hasClientProfile: true, hasBackup: false },
        })),
        { now: Date.now() },
      );
      await persistKnownDevicesIfChanged(knownDevices);
    }

    return {
      success: true,
      clients: buildKnownDeviceViews(knownDevices, currentProfile.clientId, currentSource),
      currentClientId: currentProfile.clientId,
      remoteSync: {
        attempted: true,
        written: remoteSync.written,
        failed: remoteSync.failed,
      },
    };
  } catch (error: any) {
    const knownDevices = mergeKnownDevices(
      readKnownDevices(webdav.knownDevices),
      [],
      { now, currentProfile, currentSource },
    );
    await persistKnownDevicesIfChanged(knownDevices);
    return {
      success: true,
      clients: buildKnownDeviceViews(knownDevices, currentProfile.clientId, currentSource),
      currentClientId: currentProfile.clientId,
      remoteSync: { attempted: false, written: 0, failed: 0 },
      error: normalizeWebDAVClientListError(error),
    };
  }
}

async function getCurrentWebDAVClientProfile(): Promise<{ success: boolean; profile?: WebDAVClientProfile; error?: string }> {
  try {
    const settings = await ensureWebDAVClientIdentity();
    let profile = getWebDAVClientProfile(settings);
    const webdav = settings.webdav || {};

    const canReadCloudProfile = webdav.enabled && webdav.url && webdav.username && webdav.password;
    if (canReadCloudProfile) {
      try {
        const cloudProfile = await readWebDAVClientProfile(
          normalizeWebDavBaseUrl(webdav.url),
          { username: webdav.username, password: webdav.password },
          profile.clientId,
        );
        if (cloudProfile) {
          const mergedDeviceLabel = String(cloudProfile.deviceLabel || profile.deviceLabel || '').trim() || profile.deviceLabel;
          const mergedLastSeenAt = profile.lastSeenAt || cloudProfile.lastSeenAt;
          const mergedLastSyncAt = profile.lastSyncAt || cloudProfile.lastSyncAt;
          const mergedLastSyncStatus = profile.lastSyncStatus || cloudProfile.lastSyncStatus;
          const mergedLastUploadId = profile.lastUploadId || cloudProfile.lastUploadId;

          profile = {
            ...profile,
            deviceLabel: mergedDeviceLabel,
            lastSeenAt: mergedLastSeenAt,
            lastSyncAt: mergedLastSyncAt,
            lastSyncStatus: mergedLastSyncStatus,
            lastUploadId: mergedLastUploadId,
          };

          const shouldPersistDeviceLabel = mergedDeviceLabel && mergedDeviceLabel !== settings.webdav?.deviceLabel;
          const shouldPersistLastSeenAt = !!mergedLastSeenAt && mergedLastSeenAt !== settings.webdav?.clientLastSeenAt;
          const shouldPersistLastSyncAt = !!mergedLastSyncAt && mergedLastSyncAt !== settings.webdav?.clientLastSyncAt;
          const shouldPersistLastSyncStatus = !!mergedLastSyncStatus && mergedLastSyncStatus !== settings.webdav?.clientLastSyncStatus;
          const shouldPersistLastUploadId = !!mergedLastUploadId && mergedLastUploadId !== settings.webdav?.clientLastUploadId;

          if (shouldPersistDeviceLabel || shouldPersistLastSeenAt || shouldPersistLastSyncAt || shouldPersistLastSyncStatus || shouldPersistLastUploadId) {
            // 10-21 B1：section delta 写，只写本次负责的 5 个 webdav 子键，基为写前紧贴重读的最新值
            await saveSettingsSectionDelta(settingsDeltaWriter, settings, 'webdav', (latest) => ({
              deviceLabel: mergedDeviceLabel || latest.deviceLabel || '',
              clientLastSeenAt: mergedLastSeenAt || latest.clientLastSeenAt || '',
              clientLastSyncAt: mergedLastSyncAt || latest.clientLastSyncAt || '',
              clientLastSyncStatus: mergedLastSyncStatus || latest.clientLastSyncStatus || '',
              clientLastUploadId: mergedLastUploadId || latest.clientLastUploadId || '',
            }));
          }
        }
      } catch {}
    }

    return { success: true, profile };
  } catch (error: any) {
    return { success: false, error: error?.message || '获取当前客户端信息失败。' };
  }
}

async function updateCurrentWebDAVDeviceLabel(deviceLabel: string): Promise<{ success: boolean; profile?: WebDAVClientProfile; error?: string }> {
  try {
    const trimmedLabel = String(deviceLabel || '').trim();
    if (!trimmedLabel) return { success: false, error: '设备名称不能为空。' };

    const settings = await ensureWebDAVClientIdentity();
    const labelUpdatedAt = new Date().toISOString();
    const knownDevicesNow = Date.parse(labelUpdatedAt) || Date.now();
    // 10-21 B2：section delta 写（deviceLabel + knownDevices，knownDevices 以写前重读最新值为种）；
    // profile 构造语义不变（基于含新 label 的 webdav 视图）
    const profileBase: any = { ...settings, webdav: { ...(settings.webdav || {}), deviceLabel: trimmedLabel } };
    const profile = getWebDAVClientProfile(profileBase, {
      deviceLabel: trimmedLabel,
      lastSeenAt: labelUpdatedAt,
    });
    const webdav = profileBase.webdav || {};
    const baseUrl = webdav.url ? normalizeWebDavBaseUrl(webdav.url) : '';
    await saveSettingsSectionDelta(settingsDeltaWriter, settings, 'webdav', (latest) => ({
      deviceLabel: trimmedLabel,
      knownDevices: mergeKnownDevices(
        readKnownDevices(latest.knownDevices),
        [{
          profile,
          source: buildActiveWebDAVKnownDeviceSource(webdav, baseUrl, knownDevicesNow),
          preferDeviceLabel: true,
        }],
        { now: knownDevicesNow },
      ),
    }));

    if (webdav.enabled && webdav.url && webdav.username && webdav.password) {
      try {
        await ensureWebDAVSupportDirs(baseUrl, webdav.username, webdav.password, { logger: bgLog });
        await updateWebDAVClientRegistry(baseUrl, { username: webdav.username, password: webdav.password }, profile);
      } catch (error: any) {
        bgLog('WARN', 'Failed to sync device label to WebDAV client registry', { error: error?.message });
      }
    }

    return { success: true, profile };
  } catch (error: any) {
    return { success: false, error: error?.message || '更新设备名称失败。' };
  }
}

async function updateWebDAVClientDeviceLabel(clientId: string, deviceLabel: string): Promise<{ success: boolean; profile?: WebDAVClientProfile; error?: string }> {
  try {
    const trimmedClientId = String(clientId || '').trim();
    const trimmedLabel = String(deviceLabel || '').trim();
    if (!trimmedClientId) return { success: false, error: '设备 ID 不能为空。' };
    if (!trimmedLabel) return { success: false, error: '设备名称不能为空。' };

    const settings = await ensureWebDAVClientIdentity();
    const webdav = settings.webdav || {};
    if (!webdav.enabled || !webdav.url || !webdav.username || !webdav.password) {
      return { success: false, error: 'WebDAV 连接尚未配置完整。' };
    }

    const baseUrl = normalizeWebDavBaseUrl(webdav.url);
    const auth = { username: webdav.username, password: webdav.password };
    const filePath = getClientFilePath(trimmedClientId);
    const existing = await readWebDAVClientProfile(baseUrl, auth, trimmedClientId);
    if (!existing) return { success: false, error: '未找到对应的云端设备记录。' };

    const nextProfile: WebDAVClientProfile = {
      ...existing,
      clientId: trimmedClientId,
      deviceLabel: trimmedLabel,
    };
    await webDavWriteJsonFile(baseUrl, auth, filePath, nextProfile);

    // 10-21 B3：section delta 写（knownDevices + 条件 deviceLabel），不再整包写回入口快照
    const currentClientId = String(settings.webdav?.clientId || '').trim();
    const isCurrentClient = !!currentClientId && currentClientId === trimmedClientId;
    const now = Date.now();
    await saveSettingsSectionDelta(settingsDeltaWriter, settings, 'webdav', (latest) => {
      const delta: Record<string, any> = {
        knownDevices: mergeKnownDevices(
          readKnownDevices(latest.knownDevices),
          [{
            profile: nextProfile,
            source: buildActiveWebDAVKnownDeviceSource(webdav, baseUrl, now),
            preferDeviceLabel: true,
          }],
          { now },
        ),
      };
      if (isCurrentClient) delta.deviceLabel = trimmedLabel;
      return delta;
    });

    return { success: true, profile: nextProfile };
  } catch (error: any) {
    return { success: false, error: error?.message || '更新云端设备名称失败。' };
  }
}

export async function triggerWebDAVAutoUpload(): Promise<void> {
  if (webdavAutoUploadInProgress) return;
  webdavAutoUploadInProgress = true;
  try {
    const settings = await getSettings();
    const webdav = settings?.webdav as any;
    if (!webdav?.enabled || !webdav?.autoSync) return;
    if (!webdav?.url || !webdav?.username || !webdav?.password) return;
    await performUpload();
  } finally {
    webdavAutoUploadInProgress = false;
  }
}

async function previewBackup(filename: string): Promise<{ success: boolean; error?: string; preview?: any; raw?: any }> {
  return previewBackupCore(filename, { getSettings });
}

async function collectBackupData(): Promise<any> {
  return collectWebDAVBackupData({ logger: bgLog });
}

async function performUpload(): Promise<{ success: boolean; error?: string }> {
  return performWebDAVUpload({ getSettings, saveSettings, logger: bgLog, readRawSettings: () => getValue<any>(STORAGE_KEYS.SETTINGS, undefined), });
}

type WebDAVUploadConfigResult = {
  configId: string;
  configName?: string;
  success: boolean;
  error?: string;
};

type WebDAVUploadAllConfigsResult = {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: WebDAVUploadConfigResult[];
  error?: string;
};

function getSavedWebDAVConfigs(settings: any): any[] {
  return Array.isArray(settings?.webdav?.configs) ? settings.webdav.configs : [];
}

function findSavedWebDAVConfig(settings: any, configId: string): any | undefined {
  const safeConfigId = String(configId || '').trim();
  return getSavedWebDAVConfigs(settings).find((config: any) => String(config?.id || '').trim() === safeConfigId);
}

function getWebDAVConfigName(config: any, fallbackId: string): string | undefined {
  return String(config?.name || '').trim() || String(fallbackId || '').trim() || undefined;
}

function validateSavedWebDAVConfig(config: any): string | null {
  const name = getWebDAVConfigName(config, '');
  const label = name ? `“${name}”` : '该备份端';
  if (!String(config?.url || '').trim()) return `${label}还没有填写 WebDAV 地址。`;
  if (!String(config?.username || '').trim()) return `${label}还没有填写用户名。`;
  if (!String(config?.password || '').trim()) return `${label}还没有填写密码或应用密钥。`;
  return null;
}

async function performUploadToConfig(configId: string): Promise<WebDAVUploadConfigResult> {
  const safeConfigId = String(configId || '').trim();
  if (!safeConfigId) {
    return { configId: '', success: false, error: '请选择要备份的 WebDAV 备份端。' };
  }

  const settings = await getSettings();
  const config = findSavedWebDAVConfig(settings, safeConfigId);
  const configName = getWebDAVConfigName(config, safeConfigId);
  if (!config) {
    return { configId: safeConfigId, configName, success: false, error: '未找到指定的 WebDAV 备份端。' };
  }

  const validationError = validateSavedWebDAVConfig(config);
  if (validationError) {
    return { configId: safeConfigId, configName, success: false, error: validationError };
  }

  const result = await performWebDAVUpload({ getSettings, saveSettings, logger: bgLog, configId: safeConfigId, readRawSettings: () => getValue<any>(STORAGE_KEYS.SETTINGS, undefined), });
  return {
    configId: safeConfigId,
    configName,
    success: result.success,
    error: result.error,
  };
}

async function performUploadToAllConfigs(): Promise<WebDAVUploadAllConfigsResult> {
  const settings = await getSettings();
  const configs = getSavedWebDAVConfigs(settings);
  if (configs.length === 0) {
    return {
      success: false,
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      error: '还没有可用的 WebDAV 备份端。',
    };
  }

  const results: WebDAVUploadConfigResult[] = [];
  for (const config of configs) {
    const configId = String(config?.id || '').trim();
    const configName = getWebDAVConfigName(config, configId);
    if (!configId) {
      results.push({ configId: '', configName, success: false, error: '备份端缺少配置 ID。' });
      continue;
    }

    const validationError = validateSavedWebDAVConfig(config);
    if (validationError) {
      results.push({ configId, configName, success: false, error: validationError });
      continue;
    }

    const result = await performUploadToConfig(configId);
    results.push(result);
  }

  const succeeded = results.filter(result => result.success).length;
  const failed = results.length - succeeded;
  return {
    success: failed === 0 && results.length > 0,
    total: results.length,
    succeeded,
    failed,
    results,
  };
}

async function applyImportDataDirect(importData: any, options?: Parameters<typeof applyImportDataDirectCore>[1]): Promise<{ success: boolean; error?: string; summary?: any }> {
  return applyImportDataDirectCore(importData, options, { logger: bgLog });
}

async function performRestoreUnified(filename: string, options?: Parameters<typeof performRestoreUnifiedCore>[1], restoreTaskId?: string): Promise<{ success: boolean; error?: string; summary?: any }> {
  return performRestoreUnifiedCore(filename, options, {
    logger: bgLog,
    onProgress: (event) => {
      if (!restoreTaskId) return;
      try {
        chrome.runtime.sendMessage({
          type: 'WEB_DAV:RESTORE_PROGRESS',
          taskId: restoreTaskId,
          ...event,
        });
      } catch {}
    },
  });
}

async function listFiles(): Promise<{ success: boolean; error?: string; files?: WebDAVFile[] }> {
  return listWebDAVFiles({ getSettings, logger: bgLog });
}

async function testWebDAVConnection(): Promise<{ success: boolean; error?: string }> {
  return testWebDAVConnectionCore({ getSettings, logger: bgLog });
}

async function testWebDAVConnectionWithConfig(config: { url: string; username: string; password: string }): Promise<{ success: boolean; error?: string }> {
  return testWebDAVConnectionWithConfigCore(config, { getSettings, logger: bgLog });
}

async function diagnoseWebDAVConnection(): Promise<any> {
  return diagnoseWebDAVConnectionCore({ getSettings, logger: bgLog });
}

async function downloadBackupFileAsBase64(filename: string): Promise<{ success: boolean; base64?: string; filename?: string; error?: string }> {
  return downloadBackupFileAsBase64Core(filename, { getSettings });
}

export function registerWebDAVRouter(): void {
  registerWebDAVRouterListener({
    listFiles,
    previewBackup,
    performRestoreUnified,
    testWebDAVConnection,
    testWebDAVConnectionWithConfig,
    diagnoseWebDAVConnection,
    performUpload,
    performUploadToConfig,
    performUploadToAllConfigs,
    getCurrentWebDAVClientProfile,
    listWebDAVClients,
    updateCurrentWebDAVDeviceLabel,
    updateWebDAVClientDeviceLabel,
    collectBackupData,
    downloadBackupFileAsBase64,
    applyImportDataDirect,
  });
}
