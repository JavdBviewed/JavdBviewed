// @ts-nocheck
import { STATE } from '../state';
import { logAsync } from '../logger';
import { showMessage } from '../ui/toast';
import { setValue, getValue } from '../../utils/storage';
import { STORAGE_KEYS } from '../../utils/config';
import { showWebDAVRestoreModal } from '../webdavRestore';
import { showImportModal } from '../import';
import { sendRuntimeMessage } from '../../platform/browser/runtimeMessages';
import { showConfirm } from '../components/confirmModal';
import { dbViewedCleanInjectedSourceTags } from '../dbClient';

type BackupActionResponse = {
  success?: boolean;
  data?: unknown;
  error?: string;
};

const WEBDAV_WARN_LAST_AT_KEY = 'webdav-warn-last-at';
const WEBDAV_WARN_THROTTLE_MS = 6 * 60 * 60 * 1000;

function updateSyncDisplay(lastSyncTimeElement: HTMLSpanElement, syncIndicator: HTMLDivElement, lastSync: string, warningDays: number): void {
  const warningBanner = document.getElementById('webdavWarningBanner') as HTMLDivElement;
  const warningMessage = document.getElementById('webdavWarningMessage') as HTMLDivElement;
  
  if (lastSync) {
    const syncDate = new Date(lastSync);
    const now = new Date();
    const rawDiffMs = now.getTime() - syncDate.getTime();
    const diffMs = Number.isFinite(rawDiffMs) ? Math.max(0, rawDiffMs) : 0;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    let timeText = '';
    if (diffDays > 0) timeText = `${diffDays}天前`;
    else if (diffHours > 0) timeText = `${diffHours}小时前`;
    else { const diffMinutes = Math.floor(diffMs / (1000 * 60)); timeText = diffMinutes > 0 ? `${diffMinutes}分钟前` : '刚刚'; }
    lastSyncTimeElement.textContent = timeText;
    lastSyncTimeElement.title = syncDate.toLocaleString('zh-CN');
    syncIndicator.className = 'sync-indicator';
    
    // 显示/隐藏预警横幅
    if (warningDays > 0 && diffDays > warningDays) {
      syncIndicator.classList.add('error');
      const statusText = syncIndicator.querySelector('.sync-status-text') as HTMLSpanElement | null;
      if (statusText) statusText.textContent = '需要同步';
      
      // 显示预警横幅
      if (warningBanner && warningMessage) {
        warningBanner.style.display = 'flex';
        warningMessage.textContent = `已超过 ${diffDays} 天未备份，建议尽快同步`;
      }
    } else {
      // 隐藏预警横幅
      if (warningBanner) {
        warningBanner.style.display = 'none';
      }
      
      if (diffDays > 1) {
        syncIndicator.classList.add('synced');
        const statusText = syncIndicator.querySelector('.sync-status-text') as HTMLSpanElement | null;
        if (statusText) statusText.textContent = '已同步';
      } else {
        syncIndicator.classList.add('synced');
        const statusText = syncIndicator.querySelector('.sync-status-text') as HTMLSpanElement | null;
        if (statusText) statusText.textContent = '最新';
      }
    }
  } else {
    lastSyncTimeElement.textContent = '从未';
    lastSyncTimeElement.title = '尚未进行过同步';
    syncIndicator.className = 'sync-indicator';
    const text = syncIndicator.querySelector('.sync-status-text') as HTMLSpanElement | null;
    if (text) text.textContent = '未同步';
    
    // 显示预警横幅（从未备份）
    if (warningDays > 0 && warningBanner && warningMessage) {
      syncIndicator.classList.add('error');
      warningBanner.style.display = 'flex';
      warningMessage.textContent = '尚未进行过备份，建议立即同步';
    } else if (warningBanner) {
      warningBanner.style.display = 'none';
    }
  }
}

async function maybeWarnStaleBackup(diffDays: number, warningDays: number): Promise<void> {
  try {
    if (!(warningDays > 0 && diffDays > warningDays)) return;
    const now = Date.now();
    const lastAt = await getValue<number>(WEBDAV_WARN_LAST_AT_KEY, 0);
    if (typeof lastAt === 'number' && lastAt > 0 && lastAt <= now && now - lastAt < WEBDAV_WARN_THROTTLE_MS) return;
    showMessage(`⚠️ WebDAV 已超过 ${diffDays} 天未备份，建议尽快同步`, 'warn');
    await setValue(WEBDAV_WARN_LAST_AT_KEY, now);
  } catch {}
}

export function updateSyncStatus(): void {
  try {
    const lastSyncTimeElement = document.getElementById('lastSyncTime') as HTMLSpanElement;
    const lastSyncTimeSettings = document.getElementById('last-sync-time') as HTMLSpanElement;
    const syncIndicator = document.getElementById('syncIndicator') as HTMLDivElement;
    const webdavSettings = STATE.settings?.webdav || {};
    const lastSync = webdavSettings.lastSync || '';
    const warningDays = Number(webdavSettings.warningDays ?? 7);
    if (lastSyncTimeElement && syncIndicator) {
      updateSyncDisplay(lastSyncTimeElement, syncIndicator, lastSync, Number.isFinite(warningDays) ? warningDays : 7);
    }
    if (lastSyncTimeSettings) {
      lastSyncTimeSettings.textContent = lastSync ? new Date(lastSync).toLocaleString('zh-CN') : '从未';
    }
    if (lastSync && Number.isFinite(warningDays) && warningDays > 0) {
      const diffMs = Date.now() - new Date(lastSync).getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      // 预警横幅已经在 updateSyncDisplay 中显示，不需要额外的 toast 消息
    }
  } catch (error) {
    console.error('更新同步状态时出错:', error);
    const lastSyncTimeElement = document.getElementById('lastSyncTime') as HTMLSpanElement;
    const lastSyncTimeSettings = document.getElementById('last-sync-time') as HTMLSpanElement;
    const syncIndicator = document.getElementById('syncIndicator') as HTMLDivElement;
    if (lastSyncTimeElement) lastSyncTimeElement.textContent = '从未';
    if (lastSyncTimeSettings) lastSyncTimeSettings.textContent = '从未';
    if (syncIndicator) {
      syncIndicator.className = 'sync-indicator';
      const statusText = syncIndicator.querySelector('.sync-status-text');
      if (statusText) (statusText as HTMLSpanElement).textContent = '未同步';
    }
  }
}

export function setSyncingStatus(isUploading: boolean = false): void {
  const syncIndicator = document.getElementById('syncIndicator') as HTMLDivElement;
  if (!syncIndicator) return;
  syncIndicator.className = 'sync-indicator syncing';
  const statusText = syncIndicator.querySelector('.sync-status-text') as HTMLSpanElement | null;
  if (statusText) statusText.textContent = isUploading ? '上传中...' : '同步中...';
}

function queryBackupElement<T extends HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector(selector) as T | null;
}

function markBackupActionBound(element: HTMLElement, action: string): boolean {
  const key = `backup${action}Bound`;
  if (element.dataset[key] === 'true') {
    return false;
  }

  element.dataset[key] = 'true';
  return true;
}

function getBackupActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
}

export function initBackupActions(root: ParentNode = document): void {
  const exportBtn = queryBackupElement<HTMLButtonElement>(root, '#exportBtn');
  const syncNowBtn = queryBackupElement<HTMLButtonElement>(root, '#syncNow');
  const syncDownBtn = queryBackupElement<HTMLButtonElement>(root, '#syncDown');
  const cleanupInjectedSourceTagsBtn = queryBackupElement<HTMLButtonElement>(root, '#cleanupInjectedSourceTags');
  const importFileInput = queryBackupElement<HTMLInputElement>(root, '#importFile');

  if (exportBtn && markBackupActionBound(exportBtn, 'Export')) {
    exportBtn.addEventListener('click', async () => {
      logAsync('INFO', '用户点击了"导出到本地"按钮');
      exportBtn.disabled = true;
      const originalHtml = exportBtn.innerHTML;
      exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>正在导出...</span>';
      try {
        const response = await sendRuntimeMessage<BackupActionResponse>({ type: 'collect-backup-data' });
        if (!response?.success) throw new Error(response?.error || '获取备份数据失败');
        const dataStr = JSON.stringify(response.data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `javdb-extension-backup-${new Date().toISOString().split('T')[0]}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        showMessage('数据导出成功', 'success');
        logAsync('INFO', '本地数据导出成功');
      } catch (err: unknown) {
        const message = getBackupActionErrorMessage(err, '导出失败');
        showMessage(`导出失败: ${message}`, 'error');
        logAsync('ERROR', '本地数据导出失败', { error: message });
      } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = originalHtml;
      }
    });
  }

  if (importFileInput && markBackupActionBound(importFileInput, 'Import')) {
    importFileInput.addEventListener('change', (event) => {
      logAsync('INFO', '用户选择了本地文件进行导入');
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) { logAsync('WARN', '用户取消了文件选择'); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === 'string') showImportModal(text);
        else { showMessage('Failed to read file content.', 'error'); logAsync('ERROR', '无法读取文件内容，内容非字符串'); }
      };
      reader.onerror = () => { showMessage(`Error reading file: ${reader.error}`, 'error'); logAsync('ERROR', '读取导入文件时发生错误', { error: reader.error as any }); };
      reader.readAsText(file);
      importFileInput.value = '';
    });
  }

  if (syncNowBtn && markBackupActionBound(syncNowBtn, 'Upload')) {
    syncNowBtn.addEventListener('click', async () => {
      const originalHtml = syncNowBtn.innerHTML;
      syncNowBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>正在上传...</span>';
      syncNowBtn.disabled = true;
      setSyncingStatus(true);
      logAsync('INFO', '用户点击“立即上传至云端”，开始上传数据');
      try {
        const response = await sendRuntimeMessage<BackupActionResponse>({ type: 'webdav-upload' });
        if (!response?.success) {
          throw new Error(response?.error || '上传失败');
        }

        showMessage('数据已成功上传至云端', 'success');
        logAsync('INFO', '数据成功上传至云端');
      } catch (error: unknown) {
        const message = getBackupActionErrorMessage(error, '上传失败');
        showMessage(`上传失败: ${message}`, 'error');
        logAsync('ERROR', '数据上传至云端失败', { error: message });
      } finally {
        syncNowBtn.innerHTML = originalHtml;
        syncNowBtn.disabled = false;
        setTimeout(() => updateSyncStatus(), 500);
      }
    });
  }

  if (syncDownBtn && markBackupActionBound(syncDownBtn, 'Restore')) {
    syncDownBtn.addEventListener('click', () => { logAsync('INFO', '用户点击“从云端恢复”，打开恢复弹窗'); showWebDAVRestoreModal(); });
  }

  if (cleanupInjectedSourceTagsBtn && markBackupActionBound(cleanupInjectedSourceTagsBtn, 'CleanupInjectedSourceTags')) {
    cleanupInjectedSourceTagsBtn.addEventListener('click', async () => {
      const originalHtml = cleanupInjectedSourceTagsBtn.innerHTML;
      cleanupInjectedSourceTagsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>正在扫描...</span>';
      cleanupInjectedSourceTagsBtn.disabled = true;
      logAsync('INFO', '用户点击“清理错误来源标签”，开始扫描历史记录');
      try {
        const preview = await dbViewedCleanInjectedSourceTags({ dryRun: true });
        if (!preview || preview.affectedCount <= 0) {
          showMessage('没有发现需要清理的错误来源标签', 'success');
          logAsync('INFO', '错误来源标签扫描完成，无需清理', { scannedCount: preview?.scannedCount || 0 });
          return;
        }

        const removedNames = Array.isArray(preview.removedTagNames) && preview.removedTagNames.length > 0
          ? preview.removedTagNames.join('、')
          : '已知错误来源标签';
        const totalRemoved = (preview.tagsRemoved || 0) + (preview.categoriesRemoved || 0);
        const confirmed = await showConfirm({
          title: '清理错误来源标签',
          message: `扫描到 ${preview.affectedCount} 条记录包含错误来源标签（${removedNames}），预计移除 ${totalRemoved} 个标签。此操作不会删除番号记录，是否继续？`,
          confirmText: '确认清理',
          cancelText: '取消',
          type: 'warning',
        });
        if (!confirmed) {
          logAsync('INFO', '用户取消清理错误来源标签', { affectedCount: preview.affectedCount });
          return;
        }

        cleanupInjectedSourceTagsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>正在清理...</span>';
        const result = await dbViewedCleanInjectedSourceTags({ dryRun: false });
        const removed = (result.tagsRemoved || 0) + (result.categoriesRemoved || 0);
        showMessage(`已清理 ${result.affectedCount || 0} 条记录，移除 ${removed} 个错误标签`, 'success');
        logAsync('INFO', '错误来源标签清理完成', result);
      } catch (error: unknown) {
        const message = getBackupActionErrorMessage(error, '清理失败');
        showMessage(`清理失败: ${message}`, 'error');
        logAsync('ERROR', '错误来源标签清理失败', { error: message });
      } finally {
        cleanupInjectedSourceTagsBtn.innerHTML = originalHtml;
        cleanupInjectedSourceTagsBtn.disabled = false;
      }
    });
  }

  updateSyncStatus();
}
