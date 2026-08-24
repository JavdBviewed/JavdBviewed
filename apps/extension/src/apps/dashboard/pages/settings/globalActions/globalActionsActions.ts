/**
 * @file globalActionsActions.ts
 * @description 全局操作动作（从遗留 GlobalActionsSettings 移植）
 * @module apps/dashboard/pages/settings/globalActions
 */
import { showConfirm } from '../../../../../dashboard/components/confirmModal';

async function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type);
  } catch {
    console.log(`[GlobalActions] ${type}: ${message}`);
  }
}

async function logInfo(message: string): Promise<void> {
  try {
    const { logAsync } = await import('../../../../../dashboard/logger');
    await logAsync('INFO', message);
  } catch {
    /* ignore */
  }
}

async function logError(message: string): Promise<void> {
  try {
    const { logAsync } = await import('../../../../../dashboard/logger');
    await logAsync('ERROR', message);
  } catch {
    /* ignore */
  }
}

/**
 * 清空所有本地数据（含隐私校验）
 */
export async function clearAllLocalData(): Promise<void> {
  const { requireAuthIfRestricted } = await import('../../../../../features/privacy');
  await requireAuthIfRestricted(
    'advanced-settings',
    async () => {
      const confirmed = await showConfirm({
        title: '清除所有扩展数据',
        message:
          '确定要清除所有扩展数据吗？此操作不可撤销！\n\n这将清除：\n- 所有已观看影片\n- 所有想看影片\n- 所有收藏演员\n- 所有设置配置',
        type: 'danger',
        confirmText: '清除全部数据',
      });
      if (!confirmed) {
        return;
      }
      try {
        await chrome.storage.local.clear();
        await showToast('所有数据已清除，页面将刷新', 'success');
        await logInfo('用户清除了所有扩展数据');
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } catch (error) {
        await showToast('清除所有数据失败', 'error');
        await logError(
          `清除所有数据失败: ${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    },
    { title: '需要密码验证', message: '清除所有数据为敏感操作，请先完成密码验证。' },
  );
}

/**
 * 清空缓存键
 */
export async function clearCacheData(): Promise<void> {
  if (!(await showConfirm({
    title: '清空缓存',
    message: '确定要清空缓存吗？这将清除所有缓存的图片、头像等临时文件。',
    type: 'warning',
    confirmText: '清空缓存',
  }))) {
    return;
  }
  try {
    await chrome.storage.local.remove([
      'actorAvatarCache',
      'videoCoverCache',
      'imageCache',
      'thumbnailCache',
    ]);
    await showToast('缓存已清除', 'success');
    await logInfo('用户清除了缓存数据');
  } catch (error) {
    await showToast('清除缓存失败', 'error');
    await logError(`清除缓存失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 清空临时数据
 */
export async function clearTempData(): Promise<void> {
  if (!(await showConfirm({
    title: '清空临时数据',
    message: '确定要清空临时数据吗？这将清除搜索历史、临时设置等非关键数据。',
    type: 'warning',
    confirmText: '清空临时数据',
  }))) {
    return;
  }
  try {
    await chrome.storage.local.remove([
      'searchHistory',
      'tempSettings',
      'sessionData',
      'recentViews',
      'logs',
    ]);
    await showToast('临时数据已清除', 'success');
    await logInfo('用户清除了临时数据');
  } catch (error) {
    await showToast('清除临时数据失败', 'error');
    await logError(`清除临时数据失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 重置所有设置为默认
 */
export async function resetAllSettings(): Promise<void> {
  if (!(await showConfirm({
    title: '重置所有设置',
    message: '确定要重置所有设置吗？这将恢复所有设置为默认值，但保留数据记录。',
    type: 'danger',
    confirmText: '重置设置',
  }))) {
    return;
  }
  try {
    const { DEFAULT_SETTINGS } = await import('../../../../../utils/config');
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    await showToast('所有设置已重置为默认值', 'success');
    await logInfo('用户重置了所有设置');
    if (await showConfirm({
      title: '设置已重置',
      message: '是否刷新页面以应用更改？',
      type: 'info',
      confirmText: '刷新页面',
      cancelText: '稍后刷新',
    })) {
      window.location.reload();
    }
  } catch (error) {
    await showToast('重置设置失败', 'error');
    await logError(`重置设置失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 重新加载扩展
 */
export async function reloadExtension(): Promise<void> {
  if (!(await showConfirm({
    title: '重新加载扩展',
    message: '确定要重新加载扩展吗？这将关闭所有扩展页面。',
    type: 'warning',
    confirmText: '重新加载',
  }))) {
    return;
  }
  try {
    await showToast('正在重新加载扩展...', 'info');
    await logInfo('用户触发了扩展重新加载');
    setTimeout(() => {
      chrome.runtime.reload();
    }, 1000);
  } catch (error) {
    await showToast('重新加载扩展失败', 'error');
    await logError(`重新加载扩展失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}
