/**
 * @file advancedSettingsActions.ts
 * @description 高级配置动作（从遗留 AdvancedSettings 移植）
 * @module apps/dashboard/pages/settings/advanced
 */
import type { ExtensionSettings } from '../../../../../types';
import { getSettings } from '../shared/settingsPersist';

const KEY_LABELS: Record<string, string> = {
  display: '显示设置',
  actorLibrary: '演员库',
  webdav: 'WebDAV',
  dataSync: '数据同步',
  actorSync: '演员同步',
  privacy: '隐私保护',
  searchEngines: '搜索引擎',
  logging: '日志',
  drive115: '115 网盘',
  dataEnhancement: '数据增强',
  translation: '翻译',
  userExperience: '用户体验',
  magnetSearch: '磁力搜索',
  videoEnhancement: '影片页增强',
  contentFilter: '内容过滤',
  anchorOptimization: '锚点优化',
  listEnhancement: '列表增强',
  actorEnhancement: '演员页增强',
  emby: 'Emby',
  ai: 'AI',
  version: '版本',
  recordsPerPage: '每页记录数',
  showCoversInRecords: '记录列表显示封面',
  autoUpdateCheck: '自动检查更新',
  updateCheckInterval: '检查间隔',
  includePrerelease: '包含预发布',
};

async function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type);
  } catch {
    console.log(`[AdvancedSettings] ${type}: ${message}`);
  }
}

async function getDashboardState(): Promise<{ settings?: ExtensionSettings; records?: unknown; logs?: unknown[] }> {
  try {
    const { STATE } = await import('../../../../../dashboard/state');
    return STATE as any;
  } catch {
    const settings = await getSettings();
    return { settings };
  }
}

/**
 * 查看 JSON 设置（只读）
 */
export async function viewSettingsJson(): Promise<void> {
  try {
    const { dataViewModal } = await import('../../../../../dashboard/ui/dataViewModal');
    const state = await getDashboardState();
    dataViewModal.show({
      title: '原始设置 (JSON)',
      data: state.settings,
      dataType: 'json',
      enableFilter: true,
      keyLabels: KEY_LABELS,
      editable: false,
      filename: `javdb-settings-${new Date().toISOString().split('T')[0]}.json`,
      info: '当前扩展的所有设置配置',
    });
  } catch (error) {
    console.error('查看JSON设置失败:', error);
    await showToast('查看JSON设置失败', 'error');
  }
}

/**
 * 编辑 JSON 设置
 */
export async function editSettingsJson(): Promise<void> {
  try {
    const { dataViewModal } = await import('../../../../../dashboard/ui/dataViewModal');
    const { applyImportedData } = await import('../../../../../dashboard/import');
    const state = await getDashboardState();
    dataViewModal.show({
      title: '编辑设置 (JSON)',
      data: state.settings,
      dataType: 'json',
      editable: true,
      enableFilter: true,
      keyLabels: KEY_LABELS,
      onSave: async (data: string) => {
        try {
          const settingsObject = JSON.parse(data);
          await applyImportedData(JSON.stringify({ settings: settingsObject }));
          try {
            const { logAsync } = await import('../../../../../dashboard/logger');
            await logAsync('INFO', 'JSON 配置已通过弹窗编辑器更新');
          } catch {
            /* ignore */
          }
          await showToast('JSON配置已更新', 'success');
        } catch (error) {
          console.error('保存JSON配置失败:', error);
          await showToast('保存JSON配置失败', 'error');
        }
      },
      info: '编辑模式 - 请谨慎修改配置',
    });
  } catch (error) {
    console.error('编辑JSON设置失败:', error);
    await showToast('编辑JSON设置失败', 'error');
  }
}

/**
 * 导出完整备份
 */
export async function exportCompleteBackup(): Promise<void> {
  try {
    try {
      const { logAsync } = await import('../../../../../dashboard/logger');
      await logAsync('INFO', '用户在"高级设置"中点击了导出按钮');
    } catch {
      /* ignore */
    }

    const state = await getDashboardState();
    const exportData = {
      settings: state.settings,
      records: state.records,
      logs: state.logs,
      exportedAt: new Date().toISOString(),
      version: '1.13.356',
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `javdb-complete-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await showToast('完整备份已导出', 'success');
  } catch (error) {
    console.error('导出数据失败:', error);
    await showToast('导出数据失败', 'error');
  }
}

/**
 * 查看原始日志
 */
export async function viewRawLogs(): Promise<void> {
  try {
    const { dataViewModal } = await import('../../../../../dashboard/ui/dataViewModal');
    const state = await getDashboardState();
    const logs = (state.logs as unknown[]) || [];
    dataViewModal.show({
      title: '原始日志 (Raw Logs)',
      data: logs,
      dataType: 'json',
      editable: false,
      filename: `javdb-logs-${new Date().toISOString().split('T')[0]}.json`,
      info: `共 ${logs.length} 条日志记录`,
    });
  } catch (error) {
    console.error('查看原始日志失败:', error);
    await showToast('查看原始日志失败', 'error');
  }
}

/**
 * 发送测试日志
 */
export async function sendTestLog(): Promise<void> {
  try {
    const { logAsync } = await import('../../../../../dashboard/logger');
    await logAsync('INFO', 'This is a test log from the dashboard.', {
      timestamp: new Date().toLocaleTimeString(),
    });
    await showToast('测试日志已发送', 'success');
  } catch (error) {
    console.error('测试日志失败:', error);
    await showToast('测试日志失败', 'error');
  }
}
