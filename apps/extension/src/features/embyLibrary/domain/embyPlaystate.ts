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
      fetchImpl,
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
      if (isStopped) {
        progOk = await stopPlayingItemSession({
          base,
          server: params.server,
          itemId,
          positionTicks,
          mediaSourceId: params.mediaSourceId,
          playSessionId: params.playSessionId,
          fetchImpl,
        });
      } else {
        // 部分服务器要求先 Start（刷新 Now Playing 会话）
        const startUrl = `${base}/Users/${encodeURIComponent(params.server.userId)}/PlayingItems/${encodeURIComponent(itemId)}`;
        const startQ = new URLSearchParams();
        if (params.mediaSourceId) startQ.set('MediaSourceId', params.mediaSourceId);
        if (params.playSessionId) startQ.set('PlaySessionId', params.playSessionId);
        await fetchImpl(`${startUrl}?${startQ.toString()}`, {
          method: 'POST',
          headers: {
            ...buildEmbyAuthHeaders(params.server),
            'Content-Type': 'application/json',
          },
          body: '{}',
        }).catch(() => undefined);

        const q = new URLSearchParams();
        q.set('PositionTicks', String(positionTicks));
        if (params.mediaSourceId) q.set('MediaSourceId', params.mediaSourceId);
        if (params.playSessionId) q.set('PlaySessionId', params.playSessionId);

        const url = `${base}/Users/${encodeURIComponent(params.server.userId)}/PlayingItems/${encodeURIComponent(itemId)}/Progress?${q.toString()}`;
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            ...buildEmbyAuthHeaders(params.server),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            PositionTicks: positionTicks,
            IsPaused: false,
            PlayedToCompletion: false,
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
}

/**
 * 结束 Now Playing 会话。
 * 优先 DELETE PlayingItems；兼容 POST .../Delete；并尽力打 Sessions/Playing/Stopped。
 */
async function stopPlayingItemSession(params: {
  base: string;
  server: Pick<EmbyMediaServer, 'accessToken' | 'apiKey' | 'userId'>;
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
  server: Pick<EmbyMediaServer, 'apiKey' | 'accessToken' | 'userId'>;
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
      url = `${base}/Users/${encodeURIComponent(server.userId)}/Items/${encodeURIComponent(itemId)}/UserData`;
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
      url = `${base}/Users/${encodeURIComponent(server.userId)}/Items/${encodeURIComponent(itemId)}/UserData?api_key=${encodeURIComponent(server.apiKey)}`;
      headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    } else {
      return { success: false, message: '无可用鉴权写 UserData', method: 'none' };
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
