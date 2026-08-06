/**
 * @file uploadService.ts
 * @description uploadService
 * @module features/webdavSync
 */
import { buildUploadId, DEFAULT_UPLOAD_INDEX_LIMIT, normalizeWebDavBaseUrl } from '../domain/paths';
import type { WebDAVKnownDevice, WebDAVUploadIndexItem } from '../domain/types';
import type { WebDAVClientLog } from '../infrastructure/webdavClient';
import { ensureWebDAVSupportDirs } from '../infrastructure/webdavClient';
import { getWebDAVClientProfile } from './clientIdentity';
import { updateWebDAVClientRegistry } from './clientRegistry';
import { byteSizeOf, collectBackupData } from './backupCollector';
import { createBackupArchive } from './backupArchive';
import { appendWebDAVUploadIndex } from './uploadIndex';
import { cleanupOldBackups } from './cleanupService';
import { mergeKnownDevices, type WebDAVKnownDeviceSourceInput } from './deviceRegistry';

type WebDAVUploadTarget = {
  configId: string;
  configName?: string;
  url: string;
  username: string;
  password: string;
  isDefault: boolean;
};

export interface WebDAVUploadServiceOptions {
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  logger?: WebDAVClientLog;
  configId?: string;
}

function readKnownDevices(value: unknown): WebDAVKnownDevice[] {
  return Array.isArray(value) ? value as WebDAVKnownDevice[] : [];
}

function getConfigId(value: unknown): string {
  return String(value || '').trim();
}

function readWebDAVConfigs(webdav: any): any[] {
  return Array.isArray(webdav?.configs) ? webdav.configs : [];
}

function resolveWebDAVUploadTarget(settings: any, requestedConfigId?: string): WebDAVUploadTarget {
  const webdav = settings?.webdav || {};
  const configs = readWebDAVConfigs(webdav);
  const activeConfigId = getConfigId(webdav.activeConfigId);
  const safeRequestedConfigId = getConfigId(requestedConfigId);

  if (safeRequestedConfigId) {
    const targetConfig = configs.find((config: any) => getConfigId(config?.id) === safeRequestedConfigId);
    if (!targetConfig) {
      throw new Error('未找到指定的 WebDAV 备份端。');
    }

    return {
      configId: safeRequestedConfigId,
      configName: String(targetConfig.name || '').trim() || undefined,
      url: String(targetConfig.url || '').trim(),
      username: String(targetConfig.username || '').trim(),
      password: String(targetConfig.password || ''),
      isDefault: !!activeConfigId && safeRequestedConfigId === activeConfigId,
    };
  }

  const activeConfig = configs.find((config: any) => getConfigId(config?.id) === activeConfigId);
  return {
    configId: activeConfigId || getConfigId(activeConfig?.id) || 'default',
    configName: String(activeConfig?.name || '').trim() || undefined,
    url: String(webdav.url || activeConfig?.url || '').trim(),
    username: String(webdav.username || activeConfig?.username || '').trim(),
    password: String(webdav.password || activeConfig?.password || ''),
    isDefault: true,
  };
}

function validateWebDAVUploadTarget(target: WebDAVUploadTarget): string | null {
  const label = target.configName ? `“${target.configName}”` : '当前备份端';
  if (!target.url) return `${label}还没有填写 WebDAV 地址。`;
  if (!target.username) return `${label}还没有填写用户名。`;
  if (!target.password) return `${label}还没有填写密码或应用密钥。`;
  return null;
}

function buildUploadKnownDeviceSource(target: WebDAVUploadTarget, baseUrl: string, uploadedAt: string, uploadId: string): WebDAVKnownDeviceSourceInput {
  return {
    configId: target.configId,
    configName: target.configName,
    urlFingerprint: `${baseUrl}|${target.username}`,
    seenAt: uploadedAt,
    hasClientProfile: true,
    hasBackup: true,
    lastUploadId: uploadId,
    lastUploadAt: uploadedAt,
  };
}

export async function performWebDAVUpload(options: WebDAVUploadServiceOptions): Promise<{ success: boolean; error?: string }> {
  const logger = options.logger;
  logger?.('INFO', 'Attempting to perform WebDAV upload.');
  const settings = await options.getSettings();
  if (!settings.webdav.enabled) {
    const errorMsg = 'WebDAV is not enabled or URL is not configured.';
    logger?.('WARN', errorMsg);
    return { success: false, error: errorMsg };
  }
  try {
    const target = resolveWebDAVUploadTarget(settings, options.configId);
    const targetValidationError = validateWebDAVUploadTarget(target);
    if (targetValidationError) {
      logger?.('WARN', targetValidationError, { configId: target.configId });
      return { success: false, error: targetValidationError };
    }
    const dataToExport = await collectBackupData({ logger });

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    const filename = `javdb-extension-backup-${date}-${hour}-${minute}-${second}.zip`;

    let fileUrl = normalizeWebDavBaseUrl(target.url);
    const baseUrl = fileUrl;
    const auth = { username: target.username, password: target.password };

    try {
      await ensureWebDAVSupportDirs(fileUrl, target.username, target.password, { logger });
    } catch (dirError: any) {
      logger?.('WARN', 'Failed to ensure directory exists, will try upload anyway', { error: dirError.message });
    }

    fileUrl += filename.startsWith('/') ? filename.substring(1) : filename;

    const backupJson = JSON.stringify(dataToExport, null, 2);
    const backupJsonBytes = byteSizeOf(backupJson);
    const zipBlob = await createBackupArchive(dataToExport);
    try { logger?.('INFO', 'Backup package prepared', { jsonBytes: backupJsonBytes, zipBytes: (zipBlob as any)?.size }); } catch {}
    try { logger?.('DEBUG', 'Backup stats summary', (dataToExport as any)?.stats || {}); } catch {}

    logger?.('INFO', `Uploading to ${fileUrl}`, { zipBytes: (zipBlob as any)?.size });
    const response = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        Authorization: 'Basic ' + btoa(`${target.username}:${target.password}`),
        'Content-Type': 'application/zip',
      },
      body: zipBlob,
    });
    if (!response.ok) throw new Error(`Upload failed with status: ${response.status}`);

    const uploadedAt = new Date().toISOString();
    const clientProfile = getWebDAVClientProfile(settings, {
      lastSeenAt: uploadedAt,
      lastSyncAt: uploadedAt,
      lastSyncStatus: 'success',
    });
    const uploadId = buildUploadId(clientProfile.clientId, uploadedAt);
    clientProfile.lastUploadId = uploadId;

    try {
      await updateWebDAVClientRegistry(baseUrl, auth, clientProfile);
    } catch (registryError: any) {
      logger?.('WARN', 'Failed to update WebDAV client registry', { error: registryError?.message });
    }

    try {
      const uploadIndexItem: WebDAVUploadIndexItem = {
        uploadId,
        uploadedAt,
        clientId: clientProfile.clientId,
        deviceLabel: clientProfile.deviceLabel,
        browserName: clientProfile.browserName,
        type: 'full',
        status: 'success',
        file: filename,
        recordCount: Object.keys((dataToExport as any)?.data || (dataToExport as any)?.viewed || {}).length,
        dataVersion: Number((dataToExport as any)?.version || 1),
      };
      await appendWebDAVUploadIndex(baseUrl, auth, uploadIndexItem, Number(settings.webdav.uploadIndexLimit ?? DEFAULT_UPLOAD_INDEX_LIMIT));
    } catch (indexError: any) {
      logger?.('WARN', 'Failed to update WebDAV upload index', { error: indexError?.message });
    }

    const updatedSettings = await options.getSettings();
    if (!updatedSettings.webdav) updatedSettings.webdav = {};
    const lastSync = new Date().toISOString();
    if (target.isDefault) {
      updatedSettings.webdav.lastSync = lastSync;
    }
    updatedSettings.webdav.clientLastSeenAt = uploadedAt;
    updatedSettings.webdav.clientLastSyncAt = uploadedAt;
    updatedSettings.webdav.clientLastSyncStatus = 'success';
    updatedSettings.webdav.clientLastUploadId = uploadId;
    updatedSettings.webdav.knownDevices = mergeKnownDevices(
      readKnownDevices(updatedSettings.webdav.knownDevices),
      [{
        profile: clientProfile,
        source: buildUploadKnownDeviceSource(target, baseUrl, uploadedAt, uploadId),
        preferDeviceLabel: true,
      }],
      { now: Date.parse(uploadedAt) || Date.now() },
    );

    if (target.configId && updatedSettings.webdav.configs) {
      const configIndex = updatedSettings.webdav.configs.findIndex((c: { id: string }) => c.id === target.configId);
      if (configIndex !== -1) {
        updatedSettings.webdav.configs[configIndex].lastSync = lastSync;
      }
    }

    await options.saveSettings(updatedSettings);
    logger?.('INFO', 'WebDAV upload successful, updated last sync time.');

    try {
      const retentionCount = Number(updatedSettings.webdav.retentionDays ?? 10);
      if (target.isDefault && !isNaN(retentionCount) && retentionCount > 0) {
        await cleanupOldBackups(retentionCount, { getSettings: options.getSettings, logger });
      }
    } catch (e: any) {
      logger?.('WARN', 'Failed to cleanup old WebDAV backups', { error: e?.message });
    }

    return { success: true };
  } catch (error: any) {
    logger?.('ERROR', 'WebDAV upload failed.', { error: error.message });
    return { success: false, error: error.message };
  }
}
