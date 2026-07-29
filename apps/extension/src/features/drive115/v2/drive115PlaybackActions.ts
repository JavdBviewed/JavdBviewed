/**
 * @file drive115PlaybackActions.ts
 * @description 115 播放动作：搜索候选 + 取流尝试 + 官方页兜底
 * @module features/drive115
 */
import { getDrive115V2Service } from './index';
import { searchFilesV2 } from './search';
import {
  buildPlaySessionFromSearch,
  pickDefaultPlayCandidate,
  type Drive115PlayCandidate,
  type Drive115PlaySessionIntent,
} from './drive115PlaybackModel';
import type { Drive115StreamType } from './streamResponse';

/**
 * 按番号/关键字在 115 搜索视频类文件
 */
export async function searchDrive115PlayCandidates(
  query: string,
  opts?: { limit?: number; cid?: string | number },
): Promise<Drive115PlaySessionIntent> {
  const q = String(query || '').trim();
  if (!q) {
    return { query: '', candidates: [], status: 'error', message: '搜索关键字为空' };
  }

  const ret = await searchFilesV2({
    search_value: q,
    limit: opts?.limit ?? 20,
    offset: 0,
    type: 4,
    fc: 2,
    cid: opts?.cid,
  });

  if (!ret.success) {
    return {
      query: q,
      candidates: [],
      status: 'error',
      message: ret.message || '115 搜索失败',
    };
  }

  return buildPlaySessionFromSearch(q, ret.data);
}

/**
 * 115 官方/网页播放入口
 */
export function buildDrive115WebPlayUrl(candidate: Pick<Drive115PlayCandidate, 'pickCode'>): string | null {
  const pick = String(candidate.pickCode || '').trim();
  if (!pick) return null;
  return `https://115.com/?ct=play&pickcode=${encodeURIComponent(pick)}`;
}

/**
 * 尝试 open API 取流
 */
export async function tryResolveDrive115StreamUrl(
  pickCode: string,
): Promise<{ success: boolean; streamUrl?: string; streamType?: Drive115StreamType; message?: string }> {
  const pick = String(pickCode || '').trim();
  if (!pick) return { success: false, message: '缺少 pick_code' };
  try {
    const svc = getDrive115V2Service();
    const tokenRet = await svc.getValidAccessToken();
    if (!tokenRet.success) {
      return { success: false, message: (tokenRet as any).message || '无法获取 access_token' };
    }
    const ret = await svc.getVideoPlayInfo({
      accessToken: tokenRet.accessToken,
      pickCode: pick,
    });
    if (ret.success && ret.streamUrl) {
      return { success: true, streamUrl: ret.streamUrl, streamType: ret.streamType || 'auto' };
    }
    return { success: false, message: ret.message || '取流失败' };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 解析默认播放目标并尝试取流
 */
export async function resolveDrive115PlayTarget(
  query: string,
  preset?: { pickCode?: string; fileId?: string },
): Promise<{
  success: boolean;
  session: Drive115PlaySessionIntent;
  defaultCandidate: Drive115PlayCandidate | null;
  webPlayUrl: string | null;
  streamUrl?: string;
  streamType?: Drive115StreamType;
  message?: string;
}> {
  if (preset?.pickCode) {
    const candidate: Drive115PlayCandidate = {
      fileId: String(preset.fileId || ''),
      fileName: query,
      fileSize: 0,
      pickCode: preset.pickCode,
      parentId: '',
      sha1: '',
    };
    const stream = await tryResolveDrive115StreamUrl(candidate.pickCode);
    return {
      success: true,
      session: {
        query,
        candidates: [candidate],
        streamUrl: stream.streamUrl,
        status: stream.streamUrl ? 'ready' : 'candidates',
        message: stream.streamUrl ? '已获取播放地址' : stream.message || '使用已缓存的 pick_code',
      },
      defaultCandidate: candidate,
      webPlayUrl: buildDrive115WebPlayUrl(candidate),
      streamUrl: stream.streamUrl,
      streamType: stream.streamType,
      message: stream.streamUrl ? '已获取播放地址' : stream.message,
    };
  }

  const session = await searchDrive115PlayCandidates(query);
  const def = pickDefaultPlayCandidate(session.candidates);
  let streamUrl: string | undefined;
  let streamType: Drive115StreamType | undefined;
  if (def?.pickCode) {
    const stream = await tryResolveDrive115StreamUrl(def.pickCode);
    streamUrl = stream.streamUrl;
    streamType = stream.streamType;
    if (streamUrl) {
      session.streamUrl = streamUrl;
      session.status = 'ready';
      session.message = `找到 ${session.candidates.length} 个候选，已解析播放地址`;
    }
  }
  return {
    success: session.status !== 'error',
    session,
    defaultCandidate: def,
    webPlayUrl: def ? buildDrive115WebPlayUrl(def) : null,
    streamUrl,
    streamType,
    message: session.message,
  };
}
