/**
 * @file embyUserAuth.ts
 * @description Emby/Jellyfin 用户登录（AuthenticateByName）与令牌辅助
 * @module features/embyLibrary
 */
import type { EmbyMediaServer } from '../types';
import { normalizeServerUrl } from '../domain/libraryIndex';

export type EmbyAuthResult = {
  success: boolean;
  accessToken?: string;
  userId?: string;
  userName?: string;
  serverId?: string;
  message?: string;
  raw?: any;
};

/**
 * 使用用户名密码登录 Emby/Jellyfin
 * POST /Users/AuthenticateByName
 */
export async function authenticateEmbyUser(params: {
  url: string;
  username: string;
  password: string;
  /** 设备显示名 */
  deviceName?: string;
  fetchImpl?: typeof fetch;
}): Promise<EmbyAuthResult> {
  const base = normalizeServerUrl(params.url);
  const username = String(params.username || '').trim();
  const password = String(params.password || '');
  const fetchImpl = params.fetchImpl || fetch;

  if (!base) return { success: false, message: '服务器地址无效' };
  if (!username) return { success: false, message: '请填写用户名' };

  const authHeader = buildMediaBrowserAuthHeader({
    token: '',
    deviceName: params.deviceName || 'JavdBviewed',
  });

  try {
    const res = await fetchImpl(`${base}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 双头同发：新 Jellyfin（12+/legacy 关）只读标准 Authorization 头，
        // Emby 读 X-Emby-Authorization；两值相同，任一端点均可认证
        'Authorization': authHeader,
        'X-Emby-Authorization': authHeader,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        Username: username,
        Pw: password,
        Password: password,
      }),
    });

    const raw = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      const msg =
        raw?.message
        || raw?.Message
        // RFC7807 ProblemDetails（Jellyfin 400 常见形态只有 title 无 message）
        || raw?.title
        || raw?.Title
        || (res.status === 401 ? '用户名或密码错误' : `登录失败 (${res.status})`);
      return { success: false, message: msg, raw };
    }

    const accessToken = String(raw?.AccessToken || raw?.accessToken || '').trim();
    const userId = String(raw?.User?.Id || raw?.user?.id || raw?.UserId || '').trim();
    const userName = String(raw?.User?.Name || raw?.user?.name || username).trim();
    const serverId = String(raw?.ServerId || raw?.serverId || '').trim() || undefined;

    if (!accessToken || !userId) {
      return { success: false, message: '登录响应缺少 AccessToken 或 UserId', raw };
    }

    return {
      success: true,
      accessToken,
      userId,
      userName,
      serverId,
      raw,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || '登录请求失败' };
  }
}

/**
 * 扩展客户端版本（给 Emby/JF 会话显示用）。
 * 优先 manifest，其次 Vite 注入的 VITE_APP_VERSION。
 */
export function resolveEmbyClientVersion(): string {
  try {
    const manifestVersion = chrome?.runtime?.getManifest?.()?.version;
    if (manifestVersion) {
      // Emby 侧展示通常只要 x.y.z
      const m = String(manifestVersion).match(/^(\d+\.\d+\.\d+)/);
      return m?.[1] || String(manifestVersion);
    }
  } catch {
    /* ignore — 非扩展上下文 */
  }
  try {
    const envVersion = (import.meta as any)?.env?.VITE_APP_VERSION;
    if (envVersion) return String(envVersion);
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

/**
 * MediaBrowser 鉴权头（Emby/JF 通用）
 * Version 会出现在 Emby 后台「设备 / 正在播放」里，禁止写死 1.0.0
 */
export function buildMediaBrowserAuthHeader(opts: {
  token?: string;
  client?: string;
  device?: string;
  deviceName?: string;
  version?: string;
}): string {
  const client = opts.client || 'JavdBviewed';
  const device = opts.device || 'ChromeExtension';
  const deviceName = opts.deviceName || 'Dashboard';
  const version = opts.version || resolveEmbyClientVersion();
  const token = opts.token ? `, Token="${opts.token}"` : '';
  return `MediaBrowser Client="${client}", Device="${device}", DeviceId="${deviceName}", Version="${version}"${token}`;
}

/**
 * 请求头：优先用户令牌，否则 api_key 查询参数由调用方拼
 */
export function buildEmbyAuthHeaders(server: Pick<EmbyMediaServer, 'accessToken' | 'apiKey'>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (server.accessToken) {
    headers['X-Emby-Token'] = server.accessToken;
    headers['X-Emby-Authorization'] = buildMediaBrowserAuthHeader({ token: server.accessToken });
    // 标准 Authorization 头含 Token：Jellyfin 12+（legacy 默认关）只认这个头，
    // 登录后的所有 API 调用（播放/进度/库读取）都经本函数，缺它=未认证态
    headers['Authorization'] = buildMediaBrowserAuthHeader({ token: server.accessToken });
  }
  return headers;
}

/**
 * 是否已具备用户会话（可稳定写 UserData）
 */
export function hasEmbyUserSession(server: Pick<EmbyMediaServer, 'accessToken' | 'userId'>): boolean {
  return Boolean(server.accessToken && server.userId);
}
