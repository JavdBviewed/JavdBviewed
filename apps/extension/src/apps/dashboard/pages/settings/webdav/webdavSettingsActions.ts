/**
 * @file webdavSettingsActions.ts
 * @description WebDAV 设置动作：测试/诊断/备份/设备，调用遗留 background 消息与服务
 * @module apps/dashboard/pages/settings/webdav
 */
import type { ExtensionSettings, WebDAVClientProfile, WebDAVKnownDeviceView } from '../../../../../types';
import { sendRuntimeMessage } from '../../../../../platform/browser/runtimeMessages';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
} from '../shared/settingsPersist';
import {
  applyWebdavFormToSettings,
  friendlyWebdavError,
  validateWebdavForm,
  type WebdavConfigModalDraft,
  type WebdavSettingsFormState,
} from './webdavSettingsModel';

export type WebdavActionResult = {
  success: boolean;
  message?: string;
  error?: string;
};

export type WebdavDiagnostic = {
  success?: boolean;
  serverType?: string;
  supportedMethods?: string[];
  responseFormat?: string;
  issues?: string[];
  recommendations?: string[];
};

export type WebdavUploadConfigResponse = {
  success?: boolean;
  configId?: string;
  configName?: string;
  error?: string;
};

export type WebdavUploadAllConfigResult = {
  configId: string;
  configName?: string;
  success: boolean;
  error?: string;
};

export type WebdavUploadAllConfigsResponse = {
  success?: boolean;
  total?: number;
  succeeded?: number;
  failed?: number;
  results?: WebdavUploadAllConfigResult[];
  error?: string;
};

export type WebdavClientsSnapshot = {
  current: WebDAVClientProfile | WebDAVKnownDeviceView | null;
  others: WebDAVKnownDeviceView[];
  notice?: string;
  error?: string;
};

/**
 * Toast 提示
 */
export async function toast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' | 'warn' = 'info',
  duration?: number,
): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type as any, duration as any);
  } catch {
    /* ignore */
  }
}

/**
 * 持久化表单到 storage + STATE
 */
export async function persistWebdavForm(
  form: WebdavSettingsFormState,
  options?: { setupAlarms?: boolean; skipValidation?: boolean },
): Promise<WebdavActionResult> {
  if (!options?.skipValidation) {
    const v = validateWebdavForm(form);
    if (!v.isValid) {
      return { success: false, error: v.errors[0] || '校验失败' };
    }
  }
  try {
    const current = await getSettings();
    const next = applyWebdavFormToSettings(current, form);
    await saveSettings(next);
    await syncDashboardState(next);
    if (options?.setupAlarms !== false) {
      try {
        void sendRuntimeMessage({ type: 'setup-alarms' }).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存失败';
    console.error('[WebdavSettings] persist failed', err);
    return { success: false, error: message };
  }
}

/**
 * 备份后刷新 settings
 */
export async function refreshSettingsAfterBackup(): Promise<ExtensionSettings | null> {
  try {
    const next = await getSettings();
    await syncDashboardState(next);
    return next;
  } catch (err) {
    console.warn('[WebdavSettings] refresh after backup failed', err);
    return null;
  }
}

/**
 * 读取下次自动同步时间
 */
export async function fetchNextSyncTime(): Promise<number | string | null> {
  try {
    const resp = await sendRuntimeMessage<{ scheduledTime?: number | string }>({
      type: 'get-next-sync-time',
    });
    return resp?.scheduledTime ?? null;
  } catch {
    return null;
  }
}

/**
 * 测试当前激活配置连接
 */
export async function testActiveWebdavConnection(
  form: WebdavSettingsFormState,
): Promise<WebdavActionResult> {
  const activeConfigId = form.activeConfigId;
  if (!activeConfigId) {
    await toast('请先选择一个配置', 'warning');
    return { success: false, error: '未选择配置' };
  }
  const active = form.configs.find((c) => c.id === activeConfigId);
  const configName = active?.name || '未知配置';

  await toast(`正在测试配置"${configName}"...`, 'info');
  try {
    const response = await sendRuntimeMessage<{ success?: boolean; error?: string }>({
      type: 'webdav-test',
    });
    if (response?.success) {
      const message = `配置"${configName}"测试成功！服务器响应正常`;
      await toast(`🎉 ${message}`, 'success');
      return { success: true, message };
    }
    const errorMsg = response?.error || '未知错误';
    const friendly = friendlyWebdavError(errorMsg);
    await toast(`配置"${configName}"测试失败：${friendly}`, 'error');
    return { success: false, error: friendly };
  } catch (err) {
    const message = err instanceof Error ? err.message : '无法进行连接测试';
    await toast('❌ 无法进行连接测试', 'error');
    return { success: false, error: message };
  }
}

/**
 * 诊断当前激活配置
 */
export async function diagnoseActiveWebdavConnection(
  form: WebdavSettingsFormState,
): Promise<WebdavActionResult & { diagnostic?: WebdavDiagnostic }> {
  const activeConfigId = form.activeConfigId;
  if (!activeConfigId) {
    await toast('请先选择一个配置', 'warning');
    return { success: false, error: '未选择配置' };
  }
  const active = form.configs.find((c) => c.id === activeConfigId);
  const configName = active?.name || '未知配置';

  await toast(`正在诊断配置"${configName}"...`, 'info');
  try {
    const response = await sendRuntimeMessage<{
      success?: boolean;
      error?: string;
      diagnostic?: WebdavDiagnostic;
    }>({ type: 'webdav-diagnose' });

    if (response?.success && response.diagnostic) {
      await showDiagnosticResultAsToast(response.diagnostic, configName);
      return {
        success: !!response.diagnostic.success,
        diagnostic: response.diagnostic,
        message: response.diagnostic.success ? '诊断通过' : '诊断发现问题',
      };
    }
    const errorMsg = response?.error || '诊断失败';
    await toast(`配置"${configName}"诊断失败：${errorMsg}`, 'error');
    return { success: false, error: errorMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : '无法进行诊断';
    await toast('❌ 无法进行诊断', 'error');
    return { success: false, error: message };
  }
}

/**
 * Toast 展示诊断结果（对齐遗留）
 */
export async function showDiagnosticResultAsToast(
  diagnostic: WebdavDiagnostic,
  configName: string,
): Promise<void> {
  const lines: string[] = [];
  lines.push(`🔍 配置 "${configName}" 诊断完成`);
  lines.push('');

  if (diagnostic.serverType) {
    lines.push(`📡 服务器类型: ${diagnostic.serverType}`);
  }
  if (diagnostic.supportedMethods && diagnostic.supportedMethods.length > 0) {
    lines.push('🛠️ 支持的方法:');
    lines.push(`   ${diagnostic.supportedMethods.join(', ')}`);
  }
  if (diagnostic.responseFormat) {
    lines.push('📄 响应格式:');
    lines.push(`   ${diagnostic.responseFormat}`);
  }
  if (diagnostic.issues && diagnostic.issues.length > 0) {
    lines.push('');
    lines.push('⚠️ 发现的问题:');
    diagnostic.issues.forEach((issue, index) => {
      lines.push(`   ${index + 1}. ${issue}`);
    });
  }
  if (diagnostic.recommendations && diagnostic.recommendations.length > 0) {
    lines.push('');
    lines.push('💡 建议:');
    diagnostic.recommendations.forEach((rec, index) => {
      lines.push(`   ${index + 1}. ${rec}`);
    });
  }

  await toast(lines.join('\n'), diagnostic.success ? 'success' : 'warning', 10000);
}

/**
 * 弹窗内临时配置测试
 */
export async function testTempWebdavConfig(
  draft: WebdavConfigModalDraft,
  fullUrl: string,
): Promise<WebdavActionResult> {
  const configName = draft.name.trim() || '当前配置';
  await toast(`正在测试配置"${configName}"...`, 'info');
  try {
    const response = await sendRuntimeMessage<{ success?: boolean; error?: string }>({
      type: 'webdav-test-temp',
      config: {
        url: fullUrl,
        username: draft.username.trim(),
        password: draft.password,
      },
    });
    if (response?.success) {
      const message = `配置"${configName}"测试成功！服务器响应正常`;
      await toast(`🎉 ${message}`, 'success');
      return { success: true, message };
    }
    const errorMsg = response?.error || '未知错误';
    const friendly = friendlyWebdavError(errorMsg);
    await toast(`配置"${configName}"测试失败：${friendly}`, 'error');
    return { success: false, error: friendly };
  } catch (err) {
    const message = err instanceof Error ? err.message : '测试失败';
    await toast(`配置"${configName}"测试失败：${message}`, 'error');
    return { success: false, error: message };
  }
}

/**
 * 立即备份到指定配置
 */
export async function backupWebdavConfig(configId: string): Promise<WebdavActionResult> {
  try {
    const response = await sendRuntimeMessage<WebdavUploadConfigResponse>({
      type: 'webdav-upload-config',
      configId,
    });
    if (!response?.success) {
      const error = response?.error || '请稍后重试';
      await toast(`备份失败：${error}`, 'error');
      return { success: false, error };
    }
    const name = response.configName || configId;
    await toast(`已备份到：${name}`, 'success');
    await refreshSettingsAfterBackup();
    return { success: true, message: name };
  } catch (err) {
    const message = err instanceof Error ? err.message : '备份失败';
    await toast(`备份失败：${message}`, 'error');
    return { success: false, error: message };
  }
}

/**
 * 备份到全部备份端
 */
export async function backupAllWebdavConfigs(): Promise<
  WebdavActionResult & { response?: WebdavUploadAllConfigsResponse }
> {
  try {
    const response = await sendRuntimeMessage<WebdavUploadAllConfigsResponse>({
      type: 'webdav-upload-all',
    });
    if (!response?.results) {
      const error = response?.error || '备份到全部备份端失败';
      await toast(error, 'error');
      return { success: false, error, response };
    }
    const message = renderUploadAllMessage(response);
    await toast(message, response.failed ? 'warning' : 'success', response.failed ? 9000 : undefined);
    await refreshSettingsAfterBackup();
    return {
      success: !response.failed,
      message,
      response,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : '备份失败';
    await toast(`备份到全部备份端失败：${message}`, 'error');
    return { success: false, error: message };
  }
}

/**
 * 全部备份结果文案
 */
export function renderUploadAllMessage(response: WebdavUploadAllConfigsResponse): string {
  const total = Number(response.total || 0);
  const succeeded = Number(response.succeeded || 0);
  const failed = Number(response.failed || 0);
  const failedItems = (response.results || [])
    .filter((result) => !result.success)
    .map(
      (result) =>
        `${result.configName || result.configId || '未命名备份端'}：${result.error || '备份失败'}`,
    );

  if (failedItems.length === 0) {
    return `已完成 ${succeeded}/${total} 个备份端`;
  }
  return `已完成 ${succeeded}/${total} 个备份端，${failed} 个失败：${failedItems.join('；')}`;
}

/**
 * 加载当前设备 + 已知设备列表
 */
export async function loadWebdavClients(
  formClientId?: string,
): Promise<WebdavClientsSnapshot> {
  let current: WebDAVClientProfile | WebDAVKnownDeviceView | null = null;
  let activeClientId = String(formClientId || '').trim();

  try {
    const profileResp = await sendRuntimeMessage<{
      success?: boolean;
      profile?: WebDAVClientProfile;
      error?: string;
    }>({ type: 'webdav-get-client-profile' });
    if (profileResp?.success && profileResp.profile) {
      current = profileResp.profile;
      activeClientId = String(profileResp.profile.clientId || activeClientId).trim();
    }
  } catch {
    /* continue with list */
  }

  try {
    const listResp = await sendRuntimeMessage<{
      success?: boolean;
      clients?: WebDAVKnownDeviceView[];
      error?: string;
    }>({ type: 'webdav-list-clients' });

    if (!listResp?.success) {
      return {
        current,
        others: [],
        error: listResp?.error || '已知设备加载失败',
      };
    }

    const allClients = listResp.clients || [];
    const currentView = allClients.find(
      (client) => String(client.clientId || '').trim() === activeClientId,
    );
    if (currentView) current = currentView;

    const others = allClients
      .filter((client) => {
        const id = String(client.clientId || '').trim();
        return !!id && id !== activeClientId;
      })
      .sort((a, b) => Number(b.lastKnownAt || 0) - Number(a.lastKnownAt || 0));

    return {
      current,
      others,
      notice: listResp.error || undefined,
    };
  } catch {
    return {
      current,
      others: [],
      error: '已知设备加载失败',
    };
  }
}

/**
 * 更新设备备注名
 */
export async function updateDeviceLabel(input: {
  clientId: string;
  deviceLabel: string;
  isCurrent: boolean;
}): Promise<WebdavActionResult> {
  const clientId = String(input.clientId || '').trim();
  const deviceLabel = String(input.deviceLabel || '').trim();
  if (!deviceLabel) {
    await toast('设备名称不能为空', 'warning');
    return { success: false, error: '设备名称不能为空' };
  }
  try {
    const type = input.isCurrent
      ? 'webdav-update-device-label'
      : 'webdav-update-client-device-label';
    const resp = await sendRuntimeMessage<{ success?: boolean; error?: string }>({
      type,
      clientId,
      deviceLabel,
    });
    if (!resp?.success) {
      await toast(resp?.error || '更新设备名称失败', 'error');
      return { success: false, error: resp?.error || '更新设备名称失败' };
    }

    if (input.isCurrent) {
      try {
        const settings = await getSettings();
        const next = {
          ...settings,
          webdav: {
            ...((settings as any).webdav || {}),
            deviceLabel,
          },
        } as ExtensionSettings;
        await saveSettings(next);
        await syncDashboardState(next);
      } catch {
        /* ignore local mirror failure */
      }
    }

    await toast('设备名称已更新', 'success');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '更新设备名称失败';
    await toast(message, 'error');
    return { success: false, error: message };
  }
}

/**
 * 复制到剪贴板
 */
export async function copyText(text: string, emptyMessage: string, successMessage: string): Promise<boolean> {
  if (!text) {
    await toast(emptyMessage, 'warning');
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    await toast(successMessage, 'success');
    return true;
  } catch {
    await toast('复制失败，请手动复制', 'error');
    return false;
  }
}
