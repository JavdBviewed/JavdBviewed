/**
 * @file embyPlaystate.ts
 * @description Emby/JF 播放进度写回（UserData 为主，PlayingItems 为辅）
 * @module features/embyLibrary
 *
 * 依据 reference/emby-api-4.9.5.0 播放状态-PlaystateService：
 * - POST /Users/{UserId}/Items/{ItemId}/UserData  body.PlaybackPositionTicks  ← 续看真正靠这个
 * - POST /Users/{UserId}/PlayingItems/{Id}/Progress  ← 会话「正在播」，不保证写成续看点
 */
import type { EmbyMediaServer } from '../types';
import { buildEmbyAuthHeaders, hasEmbyUserSession } from './embyUserAuth';
import { normalizeServerUrl } from './libraryIndex';
import { EMBY_LIBRARY_REQUEST_TIMEOUT_MS } from './fetchWithTimeout';

export type EmbyProgressReportResult = {
  success: boolean;
  message?: string;
  positionTicks?: number;
  /** 用于本地 percent：优先服务端 runtime，否则用播放器 duration */
  runtimeTicks?: number;
  method?: 'userdata' | 'playing_progress' | 'both' | 'local_only' | 'none';
};

/** 秒 → Emby ticks（1s = 10_000_000） */
export function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds * 10_000_000);
}

export function ticksToSeconds(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return ticks / 10_000_000;
}

/**
 * 写回播放进度。
 * 策略：先写 UserData（续看依赖），再尽力写 PlayingItems/Progress（会话态）。
 * 关闭播放时传 isStopped：额外 DELETE PlayingItems，清掉 Emby 后台「正在播放」。
 */
export async function reportEmbyPlaybackProgress(params: {
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'accessToken' | 'userId' | 'type'>;
  itemId: string;
  positionSeconds: number;
  /** 播放器已知总时长（秒），用于本地 percent */
  durationSeconds?: number;
  /** 是否已播完（>=95% 或 ended） */
  isCompleted?: boolean;
  /**
   * 关闭播放器 / 结束会话。
   * true 时：不再 Start，写完进度后 DELETE PlayingItems（并尽量 Sessions/Playing/Stopped），
   * 否则 Emby 后台会继续显示「播放中」直到会话超时（常几十秒）。
   */
  isStopped?: boolean;
  mediaSourceId?: string;
  playSessionId?: string;
  fetchImpl?: typeof fetch;
  /** 整次进度写回（UserData + 会话 Start/Progress/Stop）共享的超时预算 */
  timeoutMs?: number;
}): Promise<EmbyProgressReportResult> {
  const base = normalizeServerUrl(params.server.url);
  const itemId = String(params.itemId || '').trim();
  const fetchImpl = params.fetchImpl || fetch;
  const positionTicks = secondsToTicks(params.positionSeconds);
  const runtimeTicks = params.durationSeconds && params.durationSeconds > 0
    ? secondsToTicks(params.durationSeconds)
    : 0;
  const isStopped = Boolean(params.isStopped || params.isCompleted);

  if (!base || !itemId) {
    return { success: false, message: '缺少服务器或 itemId', method: 'none' };
  }
  if (positionTicks <= 0 && !params.isCompleted && !isStopped) {
    return { success: false, message: '进度为 0，跳过写回', method: 'none', positionTicks: 0 };
  }

  // 单一超时预算：服务器黑洞时各写回请求快速失败（fire-and-forget，UI 无感，
  // 但消除旧行为下每条上报挂到 TCP 层的 promise 泄漏）
  const timeoutMs = params.timeoutMs ?? EMBY_LIBRARY_REQUEST_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const signal = controller?.signal;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  const timedFetch: typeof fetchImpl = (url, init) =>
    fetchImpl(url, { ...init, ...(signal ? { signal } : {}) });

  try {
    let udOk = false;
    let progOk = false;
    let lastError = '';

    // 1) UserData：续看进度的权威写入
    if (positionTicks > 0 || params.isCompleted) {
      const ud = await postUserDataProgress({
        base,
        server: params.server,
        itemId,
        positionTicks,
        isCompleted: params.isCompleted,
        fetchImpl: timedFetch,
        useApiKeyQuery: !(hasEmbyUserSession(params.server) && params.server.userId && params.server.accessToken),
      });
      if (ud.success) {
        udOk = true;
      } else {
        lastError = ud.message || 'UserData 写回失败';
      }
    }

    // 2) 会话态：播放中写 Progress；关闭时 Stop，避免后台「仍在播放」
    if (hasEmbyUserSession(params.server) && params.server.userId && params.server.accessToken) {
      try {
        const isJellyfin = params.server.type === 'jellyfin';
        if (isStopped) {
          progOk = await stopPlayingItemSession({
            base,
            server: params.server,
            itemId,
            positionTicks,
            mediaSourceId: params.mediaSourceId,
            playSessionId: params.playSessionId,
            fetchImpl: timedFetch,
          });
        } else {
          // 部分服务器要求先 Start（刷新 Now Playing 会话）
          const startUrl = isJellyfin
            ? `${base}/Sessions/Playing`
            : `${base}/Users/${encodeURIComponent(params.server.userId)}/PlayingItems/${encodeURIComponent(itemId)}`;
          const startQ = new URLSearchParams();
          if (params.mediaSourceId) startQ.set('MediaSourceId', params.mediaSourceId);
          if (params.playSessionId) startQ.set('PlaySessionId', params.playSessionId);
          await timedFetch(isJellyfin ? startUrl : `${startUrl}?${startQ.toString()}`, {
            method: 'POST',
            headers: {
              ...buildEmbyAuthHeaders(params.server),
              'Content-Type': 'application/json',
            },
            body: isJellyfin
              ? JSON.stringify({ ItemId: itemId, MediaSourceId: params.mediaSourceId, PlaySessionId: params.playSessionId, PositionTicks: positionTicks, IsPaused: false })
              : '{}',
          }).catch(() => undefined);

          const q = new URLSearchParams();
          q.set('PositionTicks', String(positionTicks));
          if (params.mediaSourceId) q.set('MediaSourceId', params.mediaSourceId);
          if (params.playSessionId) q.set('PlaySessionId', params.playSessionId);

          const url = isJellyfin
            ? `${base}/Sessions/Playing/Progress`
            : `${base}/Users/${encodeURIComponent(params.server.userId)}/PlayingItems/${encodeURIComponent(itemId)}/Progress?${q.toString()}`;
          const res = await timedFetch(url, {
            method: 'POST',
            headers: {
              ...buildEmbyAuthHeaders(params.server),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              PositionTicks: positionTicks,
              ...(isJellyfin ? { ItemId: itemId } : { PlayedToCompletion: false }),
              IsPaused: false,
              MediaSourceId: params.mediaSourceId,
              PlaySessionId: params.playSessionId,
            }),
          });
          if (res.ok || res.status === 204) {
            progOk = true;
          }
        }
      } catch {
        /* ignore session progress errors */
      }
    }

    if (udOk || progOk) {
      return {
        success: true,
        positionTicks: params.isCompleted ? 0 : positionTicks,
        runtimeTicks: runtimeTicks || undefined,
        method: udOk && progOk ? 'both' : udOk ? 'userdata' : 'playing_progress',
      };
    }

    return {
      success: false,
      message: lastError || '进度写回失败',
      method: 'none',
      positionTicks: params.isCompleted ? 0 : positionTicks,
      runtimeTicks: runtimeTicks || undefined,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 结束 Now Playing 会话。
 * 优先 DELETE PlayingItems；兼容 POST .../Delete；并尽力打 Sessions/Playing/Stopped。
 */
async function stopPlayingItemSession(params: {
  base: string;
  server: Pick<EmbyMediaServer, 'accessToken' | 'apiKey' | 'userId' | 'type'>;
  itemId: string;
  positionTicks: number;
  mediaSourceId?: string;
  playSessionId?: string;
  fetchImpl: typeof fetch;
}): Promise<boolean> {
  const { base, server, itemId, positionTicks, mediaSourceId, playSessionId, fetchImpl } = params;
  if (!server.userId) return false;

  const q = new URLSearchParams();
  if (positionTicks > 0) q.set('PositionTicks', String(positionTicks));
  if (mediaSourceId) q.set('MediaSourceId', mediaSourceId);
  if (playSessionId) q.set('PlaySessionId', playSessionId);
  const qs = q.toString();
  const headers = {
    ...buildEmbyAuthHeaders(server as EmbyMediaServer),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (server.type === 'jellyfin') {
    try {
      const res = await fetchImpl(`${base}/Sessions/Playing/Stopped`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ItemId: itemId, MediaSourceId: mediaSourceId, PlaySessionId: playSessionId, PositionTicks: positionTicks > 0 ? positionTicks : 0, Failed: false }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  const playingItemUrl = `${base}/Users/${encodeURIComponent(server.userId)}/PlayingItems/${encodeURIComponent(itemId)}${qs ? `?${qs}` : ''}`;

  let stopped = false;
  try {
    const del = await fetchImpl(playingItemUrl, { method: 'DELETE', headers });
    if (del.ok || del.status === 204 || del.status === 404) {
      stopped = true;
    }
  } catch {
    /* try alternate */
  }

  if (!stopped) {
    try {
      // 旧路径兼容：POST .../Delete
      const alt = `${base}/Users/${encodeURIComponent(server.userId)}/PlayingItems/${encodeURIComponent(itemId)}/Delete${qs ? `?${qs}` : ''}`;
      const res = await fetchImpl(alt, { method: 'POST', headers, body: '{}' });
      if (res.ok || res.status === 204 || res.status === 404) {
        stopped = true;
      }
    } catch {
      /* ignore */
    }
  }

  // Sessions 级 Stopped：部分 Emby 后台「正在播放」看这个
  try {
    await fetchImpl(`${base}/Sessions/Playing/Stopped`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ItemId: itemId,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        PositionTicks: positionTicks > 0 ? positionTicks : 0,
        Failed: false,
      }),
    }).catch(() => undefined);
  } catch {
    /* optional */
  }

  return stopped;
}

async function postUserDataProgress(params: {
  base: string;
  server: Pick<EmbyMediaServer, 'apiKey' | 'accessToken' | 'userId' | 'type'>;
  itemId: string;
  positionTicks: number;
  isCompleted?: boolean;
  fetchImpl: typeof fetch;
  useApiKeyQuery?: boolean;
}): Promise<EmbyProgressReportResult> {
  const { base, server, itemId, positionTicks, isCompleted, fetchImpl } = params;
  try {
    let url: string;
    let headers: Record<string, string>;
    if (server.userId && server.accessToken && !params.useApiKeyQuery) {
      url = server.type === 'jellyfin'
        ? `${base}/UserItems/${encodeURIComponent(itemId)}/UserData?userId=${encodeURIComponent(server.userId)}`
        : `${base}/Users/${encodeURIComponent(server.userId)}/Items/${encodeURIComponent(itemId)}/UserData`;
      headers = {
        ...buildEmbyAuthHeaders(server as EmbyMediaServer),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    } else if (server.apiKey) {
      if (!server.userId) {
        return {
          success: false,
          message: '请配置媒体服务器用户名或登录用户账号后再写回进度',
          method: 'none',
        };
      }
      url = server.type === 'jellyfin'
        ? `${base}/UserItems/${encodeURIComponent(itemId)}/UserData?userId=${encodeURIComponent(server.userId)}&api_key=${encodeURIComponent(server.apiKey)}`
        : `${base}/Users/${encodeURIComponent(server.userId)}/Items/${encodeURIComponent(itemId)}/UserData?api_key=${encodeURIComponent(server.apiKey)}`;
      headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    } else {
      // 凭据守卫：无会话、无 API Key 时不再输出晦涩的「无可用鉴权」，
      // 直接给出可操作的配置指引
      return {
        success: false,
        message: '写回进度缺少可用凭据：请在 Emby 设置中填写用户名+密码并登录用户，或配置 API Key 与用户名',
        method: 'none',
      };
    }

    const body: Record<string, unknown> = {
      PlaybackPositionTicks: isCompleted ? 0 : positionTicks,
      Played: Boolean(isCompleted),
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.ok || res.status === 204) {
      return { success: true, positionTicks, method: 'userdata' };
    }
    return {
      success: false,
      message: `UserData 写回失败 (${res.status})`,
      method: 'userdata',
      positionTicks,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e?.message || 'UserData 写回网络错误',
      method: 'userdata',
    };
  }
}
