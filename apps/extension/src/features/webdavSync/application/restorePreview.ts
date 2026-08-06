/**
 * @file restorePreview.ts
 * @description restorePreview
 * @module features/webdavSync
 */
import { byteSizeOf } from './backupCollector';
import { readBackupFileContent } from './backupArchive';

export interface WebDAVRestorePreviewOptions {
  getSettings: () => Promise<any>;
}

export interface ParseBackupProgressEvent {
  stage: 'download' | 'parse';
  status: 'running' | 'done';
  message: string;
}

export function resolveWebDavUrl(filename: string, webdavBaseUrl: string): string {
  if (filename.startsWith('http://') || filename.startsWith('https://')) return filename;
  if (filename.startsWith('/')) {
    const origin = new URL(webdavBaseUrl).origin;
    return new URL(filename, origin).href;
  }
  let base = webdavBaseUrl;
  if (!base.endsWith('/')) base += '/';
  return new URL(filename, base).href;
}

export async function parseBackupFromUrl(
  finalUrl: string,
  auth: { username: string; password: string },
  onProgress?: (event: ParseBackupProgressEvent) => void,
): Promise<any> {
  onProgress?.({ stage: 'download', status: 'running', message: '正在下载云端备份...' });
  const response = await fetch(finalUrl, {
    method: 'GET',
    headers: { Authorization: 'Basic ' + btoa(`${auth.username}:${auth.password}`) },
  });
  if (!response.ok) throw new Error(`Download failed with status: ${response.status}`);
  const isZip = /\.zip$/i.test(finalUrl);
  const fileContents = isZip ? await response.arrayBuffer() : await response.text();
  onProgress?.({ stage: 'download', status: 'done', message: '云端备份下载完成' });
  onProgress?.({ stage: 'parse', status: 'running', message: '正在解析备份文件...' });
  const jsonText = await readBackupFileContent(finalUrl, fileContents);
  const data = JSON.parse(jsonText);
  onProgress?.({ stage: 'parse', status: 'done', message: '备份文件解析完成' });
  return data;
}

export function buildBackupPreview(importData: any): any {
  const stats = (importData && importData.stats) || {};
  return {
    version: importData?.version || '1.0',
    timestamp: importData?.timestamp || null,
    counts: {
      viewed: (stats?.idb?.viewedRecords?.count) ?? (Array.isArray(importData?.idb?.viewedRecords) ? importData.idb.viewedRecords.length : Object.keys(importData?.data || importData?.viewed || {}).length),
      actors: (stats?.idb?.actors?.count) ?? (Array.isArray(importData?.idb?.actors) ? importData.idb.actors.length : Object.keys(importData?.actorRecords || {}).length),
      newWorks: (stats?.idb?.newWorks?.count) ?? (Array.isArray(importData?.idb?.newWorks) ? importData.idb.newWorks.length : Object.keys(importData?.newWorks?.records || {}).length),
      magnets: (stats?.idb?.magnets?.count) ?? (Array.isArray(importData?.idb?.magnets) ? importData.idb.magnets.length : 0),
      lists: (stats?.idb?.lists?.count) ?? (Array.isArray(importData?.idb?.lists) ? importData.idb.lists.length : 0),
      logs: (stats?.idb?.logs?.count) ?? (Array.isArray(importData?.idb?.logs) ? importData.idb.logs.length : Array.isArray(importData?.logs) ? importData.logs.length : 0),
    },
    bytes: {
      settings: byteSizeOf(importData?.settings),
      userProfile: byteSizeOf(importData?.userProfile),
      viewed: byteSizeOf(importData?.idb?.viewedRecords || importData?.data || importData?.viewed),
      actors: byteSizeOf(importData?.idb?.actors || importData?.actorRecords),
      newWorks: byteSizeOf(importData?.idb?.newWorks || importData?.newWorks),
      magnets: byteSizeOf(importData?.idb?.magnets),
      lists: byteSizeOf(importData?.idb?.lists),
      logs: byteSizeOf(importData?.idb?.logs || importData?.logs),
      importStats: byteSizeOf(importData?.importStats),
    },
    storageKeys: stats?.storage?.keys ?? (importData?.storageAll ? Object.keys(importData.storageAll).length : undefined),
  };
}

export async function previewBackup(filename: string, options: WebDAVRestorePreviewOptions): Promise<{ success: boolean; error?: string; preview?: any; raw?: any }> {
  try {
    const settings = await options.getSettings();
    const finalUrl = resolveWebDavUrl(filename, settings.webdav.url);
    const importData = await parseBackupFromUrl(finalUrl, { username: settings.webdav.username, password: settings.webdav.password });
    const preview = buildBackupPreview(importData);
    return { success: true, preview, raw: importData };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}

export async function downloadBackupFileAsBase64(filename: string, options: WebDAVRestorePreviewOptions): Promise<{ success: boolean; base64?: string; filename?: string; error?: string }> {
  try {
    const settings = await options.getSettings();
    const url = resolveWebDavUrl(filename, settings.webdav.url);
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: 'Basic ' + btoa(`${settings.webdav.username}:${settings.webdav.password}`) },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    return { success: true, base64, filename };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}
