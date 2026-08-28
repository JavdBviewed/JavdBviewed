/**
 * @file embySettingsActions.ts
 * @description Emby/Jellyfin 设置动作：手动同步媒体库、测试入库检测、持久化
 * @module apps/dashboard/pages/settings/emby
 */
import type { EmbyLibraryIndexEntry } from '../../../../../features/embyLibrary/types';
import { buildMediaItemUrl } from '../../../../../features/embyLibrary/domain/libraryIndex';
import { sendRuntimeMessage } from '../../../../../platform/browser/runtimeMessages';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
} from '../shared/settingsPersist';
import {
  applyEmbyFormToSettings,
  validateEmbyForm,
  type EmbySettingsFormState,
} from './embySettingsModel';

export type LibrarySyncServerResult = {
  serverId?: string;
  serverType?: string;
  serverName?: string;
  success?: boolean;
  itemCount?: number;
  indexedCount?: number;
  error?: string;
};

export type LibrarySyncResponse = {
  success?: boolean;
  synced?: number;
  failed?: number;
  skipped?: boolean;
  error?: string;
  serverResults?: LibrarySyncServerResult[];
};

export type LibrarySyncDiagnosis = {
  title: string;
  description: string;
};

export type LibraryCheckResponse = {
  success?: boolean;
  error?: string;
  matches?: Record<string, EmbyLibraryIndexEntry[]>;
};

export type LibrarySyncUiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'setup';
      summary: string;
      hint: string;
    }
  | {
      kind: 'success' | 'error';
      summary: string;
      serverResults: LibrarySyncServerResult[];
    };

export type LibraryCheckMatchView = {
  code: string;
  entry: EmbyLibraryIndexEntry;
  href: string;
};

export type LibraryCheckUiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'success'; count: number; matches: LibraryCheckMatchView[] };

async function toast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' = 'info',
): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type as any);
  } catch {
    /* ignore */
  }
}

/**
 * 通知已打开标签页设置已更新（对齐遗留：广播全部 tabs）
 */
export function notifyTabsSettingsUpdated(settings: unknown): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, {
              type: 'settings-updated',
              settings,
            })
            .catch(() => {});
        }
      });
    });
  } catch {
    /* ignore */
  }
}

export type EmbyUserLoginResult =
  | {
      ok: true;
      accessToken: string;
      userId: string;
      userName?: string;
      username: string;
      tokenObtainedAt: number;
    }
  | { ok: false; error: string };

/**
 * 用户登录媒体服务器：本函数只负责鉴权，来源凭据与返回会话由调用方写入设置
 */
export async function loginEmbyUser(params: {
  serverUrl: string;
  username: string;
  password: string;
}): Promise<EmbyUserLoginResult> {
  const serverUrl = String(params.serverUrl || '').trim().replace(/\/+$/, '');
  const username = String(params.username || '').trim();
  const password = String(params.password || '');
  if (!serverUrl) return { ok: false, error: '请先填写服务器地址' };
  if (!username || !password) return { ok: false, error: '请填写用户名和密码' };

  try {
    const response = await sendRuntimeMessage<{
      success?: boolean;
      accessToken?: string;
      userId?: string;
      userName?: string;
      username?: string;
      tokenObtainedAt?: number;
      error?: string;
    }>({
      type: 'EMBY_USER_LOGIN',
      serverUrl,
      username,
      password,
    });
    if (!response?.success || !response.accessToken || !response.userId) {
      return { ok: false, error: response?.error || '登录失败' };
    }
    return {
      ok: true,
      accessToken: response.accessToken,
      userId: response.userId,
      userName: response.userName,
      username: response.username || username,
      tokenObtainedAt: Number(response.tokenObtainedAt) || Date.now(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '登录请求失败',
    };
  }
}

/**
 * 持久化 Emby 表单（含校验、STATE 同步、tabs 通知）
 */
export async function persistEmbyForm(form: EmbySettingsFormState): Promise<{
  ok: boolean;
  error?: string;
}> {
  // 匹配地址的空行不视为校验错误（新建未填/刚清空），由 formToEmbySettings 统一丢弃
  const validation = validateEmbyForm(normalizeEmbyFormForPersist(form));
  if (!validation.isValid) {
    return { ok: false, error: validation.errors[0] || '校验失败' };
  }
  try {
    const current = await getSettings();
    const next = applyEmbyFormToSettings(current, form);
    await saveSettings(next);
    await syncDashboardState(next);
    notifyTabsSettingsUpdated(next);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '保存设置失败',
    };
  }
}

/**
 * 持久化前规范化：丢弃匹配地址空行
 */
function normalizeEmbyFormForPersist(form: EmbySettingsFormState): EmbySettingsFormState {
  return {
    ...form,
    matchUrls: form.matchUrls.map((u) => u.trim()).filter(Boolean),
  };
}

/**
 * 同步结果诊断文案
 */
export function getLibrarySyncDiagnosis(error: string): LibrarySyncDiagnosis {
  const normalized = error.trim() || '同步失败';
  if (/API Key|401/i.test(normalized)) {
    return {
      title: 'API Key 可能无效',
      description:
        '请在媒体服务器后台重新生成 API Key，并确认当前服务器配置已填写最新密钥。',
    };
  }
  if (/超时|timeout|AbortError/i.test(normalized)) {
    return {
      title: '服务器连接超时',
      description: '请确认服务器地址可以从当前浏览器访问，反向代理或内网地址需要保持在线。',
    };
  }
  const httpStatus = normalized.match(/\((\d{3})\)/);
  if (httpStatus) {
    return {
      title: `服务器返回 HTTP ${httpStatus[1]}`,
      description: '请确认媒体服务器地址、端口、反向代理路径和账号权限是否正常。',
    };
  }
  if (/解析/i.test(normalized)) {
    return {
      title: '媒体服务器返回内容无法解析',
      description: '请确认配置的是 Emby/Jellyfin API 地址，不是网页登录页或反向代理错误页。',
    };
  }
  return {
    title: normalized,
    description: '请检查服务器地址、API Key、网络连通性和媒体服务器运行状态。',
  };
}

/**
 * 规范化同步响应中的服务器结果
 */
export function normalizeLibrarySyncServerResults(value: unknown): LibrarySyncServerResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      serverId: typeof item.serverId === 'string' ? item.serverId : undefined,
      serverType: typeof item.serverType === 'string' ? item.serverType : undefined,
      serverName: typeof item.serverName === 'string' ? item.serverName : undefined,
      success: item.success === true,
      itemCount: typeof item.itemCount === 'number' ? item.itemCount : Number(item.itemCount || 0),
      indexedCount:
        typeof item.indexedCount === 'number'
          ? item.indexedCount
          : Number(item.indexedCount || 0),
      error: typeof item.error === 'string' ? item.error : undefined,
    }));
}

/**
 * 手动同步媒体库（先保存设置）
 */
export async function runManualLibrarySync(
  form: EmbySettingsFormState,
): Promise<{ ui: LibrarySyncUiState; toast?: { message: string; type: 'success' | 'warning' | 'error' } }> {
  const saved = await persistEmbyForm(form);
  if (!saved.ok) {
    await toast(saved.error || '保存设置失败', 'error');
    return {
      ui: { kind: 'error', summary: `同步失败：${saved.error || '保存设置失败'}`, serverResults: [] },
      toast: { message: saved.error || '保存设置失败', type: 'error' },
    };
  }

  try {
    const response = await sendRuntimeMessage<LibrarySyncResponse>({
      type: 'EMBY_LIBRARY_SYNC',
      manual: true,
    });
    const synced = Number(response?.synced || 0);
    const failed = Number(response?.failed || 0);
    const serverResults = normalizeLibrarySyncServerResults(response?.serverResults);

    if (synced === 0 && failed === 0 && serverResults.length === 0) {
      await toast('还没有可同步的媒体服务器', 'warning');
      return {
        ui: {
          kind: 'setup',
          summary: '还没有可同步的媒体服务器',
          hint: '请先添加服务器并填写 API Key，确认启用后再同步媒体库。',
        },
        toast: { message: '还没有可同步的媒体服务器', type: 'warning' },
      };
    }

    if (response?.success) {
      await toast('媒体库同步完成', 'success');
      return {
        ui: {
          kind: 'success',
          summary: `同步完成：成功 ${synced} 个服务器，失败 ${failed} 个服务器`,
          serverResults,
        },
        toast: { message: '媒体库同步完成', type: 'success' },
      };
    }

    const error = response?.error || (failed > 0 ? `失败 ${failed} 个服务器` : '同步失败');
    await toast('媒体库同步失败，请查看页面诊断信息', 'error');
    return {
      ui: {
        kind: 'error',
        summary: `同步失败：${error}`,
        serverResults,
      },
      toast: { message: '媒体库同步失败，请查看页面诊断信息', type: 'error' },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await toast(`媒体库同步失败：${message}`, 'error');
    return {
      ui: { kind: 'error', summary: `同步失败：${message}`, serverResults: [] },
      toast: { message: `媒体库同步失败：${message}`, type: 'error' },
    };
  }
}

/**
 * 将入库检测 matches 转为 UI 视图
 */
export function buildLibraryCheckMatches(
  matchesByCode: Record<string, EmbyLibraryIndexEntry[]>,
): LibraryCheckMatchView[] {
  return Object.entries(matchesByCode)
    .flatMap(([code, entries]) =>
      (Array.isArray(entries) ? entries : []).map((entry) => ({
        code,
        entry,
        href: buildMediaItemUrl(entry),
      })),
    );
}

/**
 * 测试入库检测（先保存设置）
 */
export async function runLibraryCheck(
  form: EmbySettingsFormState,
  codeRaw: string,
): Promise<{ ui: LibraryCheckUiState }> {
  const code = codeRaw.trim();
  if (!code) {
    await toast('请输入要测试的番号', 'warning');
    return { ui: { kind: 'idle' } };
  }

  const saved = await persistEmbyForm(form);
  if (!saved.ok) {
    await toast(saved.error || '保存设置失败', 'error');
    return {
      ui: { kind: 'error', message: `检测失败：${saved.error || '保存设置失败'}` },
    };
  }

  try {
    const response = await sendRuntimeMessage<LibraryCheckResponse>({
      type: 'EMBY_LIBRARY_CHECK_CODES',
      codes: [code],
    });

    if (!response?.success) {
      const error = response?.error || '检测失败';
      await toast(`入库检测失败：${error}`, 'error');
      return { ui: { kind: 'error', message: `检测失败：${error}` } };
    }

    const matches = buildLibraryCheckMatches(response?.matches || {});
    if (matches.length === 0) {
      return { ui: { kind: 'empty', message: '未检测到入库记录' } };
    }

    return {
      ui: {
        kind: 'success',
        count: matches.length,
        matches,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await toast(`入库检测失败：${message}`, 'error');
    return { ui: { kind: 'error', message: `检测失败：${message}` } };
  }
}

export { toast };
