import type { EmbyMediaServer } from '../embyLibrary/types';
import { buildEmbyAuthHeaders } from '../embyLibrary/domain/embyUserAuth';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';

export type MediaCleanupDeleteDeps = {
  getSettings: () => Promise<unknown>;
  fetchImpl: typeof fetch;
  deleteDrive115File: (fileId: string) => Promise<{ ok: boolean; message: string; fileGone?: boolean }>;
  /**
   * 删除 115 视频所在文件夹中的封面/缩略图/字幕等附属文件（不删视频本身，也不删其他视频）。
   * 仅在有明确 folder 上下文（cid 或 folderPath）时由调用方提供。
   */
  deleteDrive115FolderAttachments?: (input: { cid?: string; folderPath?: string }) => Promise<{ ok: boolean; message: string }>;
};

function normalizeServerUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

/**
 * 以宿主全局为 this 调用 fetch，规避 Service Worker / 页面上下文裸调 fetch
 * 丢失宿主绑定导致的 "Failed to execute 'fetch': Illegal invocation"。
 */
function nativeFetchImpl(fetchImpl: typeof fetch, input: unknown, init?: RequestInit): Promise<Response> {
  if (fetchImpl && fetchImpl !== (globalThis as { fetch?: typeof fetch }).fetch) {
    return fetchImpl(input as RequestInfo, init);
  }
  const target = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof target === 'function') {
    return Function.prototype.apply.call(target, globalThis, init === undefined ? [input] : [input, init]);
  }
  return fetch(input as RequestInfo, init);
}

/** 从 115 文件/文件夹路径中解析 cid，格式：路径名(cid)。 */
export function parse115FolderCid(folderPath: string | undefined): string | undefined {
  const raw = String(folderPath || '').trim();
  if (!raw) return undefined;
  const match = raw.match(/（([^（）]+)）$/);
  if (!match) return undefined;
  const value = match[1].trim();
  return /^\d+$/.test(value) ? value : undefined;
}

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m2ts|ts|rmvb|mpg|mpeg|m4v)$/i;
const ATTACHMENT_EXT = /\.(jpg|jpeg|png|webp|gif|bmp|sub|ass|ssa|txt|nfo|upl|info)$/i;

/** 判断一个 115 文件是否为附属文件（封面/缩略图/字幕/信息），排除视频本身。 */
export function isAttachmentFileName(fileName: string | undefined, videoFileName: string | undefined): boolean {
  const name = String(fileName || '').trim();
  if (!name) return false;
  if (VIDEO_EXT.test(name)) return false;
  const video = String(videoFileName || '').trim();
  if (video && name.toLowerCase() === video.toLowerCase()) return false;
  const stem = video ? video.replace(/\.[^.]+$/, '') : '';
  if (stem && name.toLowerCase().startsWith(`${stem.toLowerCase()}.`)) return true;
  return ATTACHMENT_EXT.test(name);
}

export async function deleteMediaCleanupCopy(
  copy: MediaCleanupCopySnapshot,
  deps: MediaCleanupDeleteDeps,
): Promise<{ ok: boolean; message: string }> {
  if (copy.source === '115') {
    return deleteDrive115Copy(copy, deps);
  }
  return deleteEmbyCopy(copy, deps);
}

async function deleteDrive115Copy(
  copy: MediaCleanupCopySnapshot,
  deps: MediaCleanupDeleteDeps,
): Promise<{ ok: boolean; message: string }> {
  if (!copy.fileId) return { ok: false, message: '缺少 115 file_id，无法删除' };
  const videoResult = await deps.deleteDrive115File(copy.fileId);
  if (!videoResult.ok) {
    // 幂等收敛：文件在 115 上已不存在（手动删除过 / 历史操作已删除 / 重复入队的脏记录），
    // 按删除成功处理，避免历史重复记录卡在待处理、每次删除都失败。
    if (videoResult.fileGone) {
      return { ok: true, message: '文件在 115 上已不存在，按删除成功处理' };
    }
    return videoResult;
  }

  // 附属文件清理：best-effort，不影响视频已删除的成功结论
  if (deps.deleteDrive115FolderAttachments && (copy.coverFileName || copy.folderPath)) {
    try {
      const cid = parse115FolderCid(copy.folderPath);
      if (cid) {
        const attachmentResult = await deps.deleteDrive115FolderAttachments({ cid, folderPath: copy.folderPath });
        if (attachmentResult.ok) {
          return { ok: true, message: `${videoResult.message}；已一并清理同文件夹的封面/缩略图等附属文件` };
        }
      }
    } catch { /* 附属清理失败不影响主删除 */ }
  }
  return videoResult;
}

/** 单条目状态探测结果（删除前/删除后共用）。 */
type EmbyItemProbe =
  | { state: 'deleted' }
  | { state: 'still-present'; detail?: string }
  | { state: 'auth-error'; status: number; detail?: string }
  | { state: 'no-delete-permission'; type?: string }
  | { state: 'unknown'; status: number; detail?: string }
  | { state: 'verify-error' };

/** 删除凭证：用户令牌优先（既有行为），API Key 兜底。 */
type EmbyDeleteCred = { mode: 'token' | 'apiKey'; label: string };

/** 服务器是否提供用户令牌（优先于 api_key）。 */
function hasUserToken(server: EmbyMediaServer): boolean {
  return Boolean(String(server.accessToken || '').trim());
}

/** 按优先级列出可用凭证：用户令牌 → API Key。 */
function credentialCandidates(server: EmbyMediaServer): EmbyDeleteCred[] {
  const candidates: EmbyDeleteCred[] = [];
  if (hasUserToken(server)) {
    const who = String(server.userDisplayName || server.username || server.userId || '').trim() || '未知账号';
    candidates.push({ mode: 'token', label: `用户令牌（${who}）` });
  }
  if (String(server.apiKey || '').trim()) {
    candidates.push({ mode: 'apiKey', label: 'API Key' });
  }
  return candidates;
}

/**
 * 删除路由：仅 DELETE /Items/{Id}（规范中唯一的删除路由，只带 Id）。
 * - 不带 Recursive/Permanent：规范中该路由只接受 Id 参数（两参数被服务器静默忽略，容器实测确认）。
 * - DELETE 对已不存在的条目同样返回 204，因此 2xx 不能证明删除生效，必须删除后重新探测确认。
 */
function buildEmbyDeleteRequest(
  server: EmbyMediaServer,
  serverUrl: string,
  itemId: string,
  cred: EmbyDeleteCred,
): { url: string; headers: Record<string, string> } {
  const base = `${serverUrl}/Items/${encodeURIComponent(itemId)}`;
  if (cred.mode === 'apiKey') {
    return { url: `${base}?api_key=${encodeURIComponent(server.apiKey || '')}`, headers: { Accept: 'application/json' } };
  }
  return { url: base, headers: buildEmbyAuthHeaders(server) };
}

/**
 * 单条目查询路由（用于删除前探测与删除后校验）：
 * - 令牌模式且有 userId → GET /Users/{UserId}/Items/{Id}（规范路由，条目缺失返回 404）；
 *   响应 CanDelete=false 表示该账号对条目无删除权限。
 * - 令牌模式无 userId / API Key 模式 → GET /Items?Ids={Id}（列表形态，条目缺失返回空列表）。
 *   注意：API Key 模式必须走列表形态——单条目路由的 CanDelete 按路径上的用户计算，
 *   当路径用户不是 Key 属主时会误报"无删除权限"（容器实测确认，此时 Key 实际可删除）。
 * 注意：GET /Items/{Id} 在 Emby 4.9.5.0 规范中不存在（恒 404），严禁用于存在性判断。
 */
function buildEmbyProbeRequest(
  server: EmbyMediaServer,
  serverUrl: string,
  itemId: string,
  cred: EmbyDeleteCred,
): { url: string; headers: Record<string, string>; shape: 'single' | 'list' } {
  if (cred.mode === 'token') {
    const userId = String(server.userId || '').trim();
    if (userId) {
      return {
        url: `${serverUrl}/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`,
        headers: buildEmbyAuthHeaders(server),
        shape: 'single',
      };
    }
    const qs = new URLSearchParams({ Ids: itemId });
    return { url: `${serverUrl}/Items?${qs.toString()}`, headers: buildEmbyAuthHeaders(server), shape: 'list' };
  }
  const qs = new URLSearchParams({ Ids: itemId });
  qs.set('api_key', server.apiKey || '');
  return { url: `${serverUrl}/Items?${qs.toString()}`, headers: { Accept: 'application/json' }, shape: 'list' };
}

async function deleteEmbyCopy(
  copy: MediaCleanupCopySnapshot,
  deps: MediaCleanupDeleteDeps,
): Promise<{ ok: boolean; message: string }> {
  if (!copy.itemId || !copy.serverUrl) {
    return { ok: false, message: '缺少媒体服务器地址或影片 ID' };
  }
  const settings = await deps.getSettings() as { emby?: { mediaServers?: EmbyMediaServer[] } } | null;
  const servers = Array.isArray(settings?.emby?.mediaServers) ? settings.emby.mediaServers : [];
  const serverUrl = normalizeServerUrl(copy.serverUrl);
  const server = servers.find((candidate) => (
    candidate.type === copy.source
    && normalizeServerUrl(candidate.url) === serverUrl
  ));
  if (!server) return { ok: false, message: '对应媒体服务器配置已不存在' };
  const candidates = credentialCandidates(server);
  if (candidates.length === 0) return { ok: false, message: '媒体服务器缺少可用凭证' };

  const label = `${copy.source === 'jellyfin' ? 'Jellyfin' : 'Emby'} ${server.name || serverUrl}`;
  const credSummary = candidates.map((cred) => cred.label).join(' / ');

  // 1) 探测阶段：按优先级逐个探测，选出第一个可用凭证（令牌优先）。
  //    单一凭证"无删除权限/凭证无效"不再直接阻断：换下一个凭证继续。
  //    探测失败（网络异常）不阻断删除，交给删除请求自身报错（与既有行为一致）。
  let chosen: EmbyDeleteCred | null = null;
  let alreadyGone = false;
  const noPermCreds: EmbyDeleteCred[] = [];
  let noPermType: string | undefined;
  const authFailures: { label: string; status: number; detail?: string }[] = [];
  const unknownFailures: { label: string; status: number; detail?: string }[] = [];
  let verifyErrors = 0;

  for (const cred of candidates) {
    const probe = await probeEmbyItem(deps, server, serverUrl, copy.itemId, cred);
    if (probe.state === 'deleted' || probe.state === 'still-present') {
      chosen = cred;
      alreadyGone = probe.state === 'deleted';
      break;
    }
    if (probe.state === 'no-delete-permission') {
      noPermCreds.push(cred);
      if (probe.type) noPermType = probe.type;
      continue;
    }
    if (probe.state === 'auth-error') {
      authFailures.push({ label: cred.label, status: probe.status, detail: probe.detail });
      continue;
    }
    if (probe.state === 'unknown') {
      // 探测返回 2xx 但响应体无法按预期解析：与既有行为一致，不阻断删除，
      // 由 DELETE 与删除后探测给出最终结论（兼容响应体格式略有差异的服务器）。
      if (!chosen) {
        chosen = cred;
        unknownFailures.push({ label: cred.label, status: probe.status, detail: probe.detail });
      }
      break;
    }
    verifyErrors += 1;
  }

  if (!chosen) {
    if (verifyErrors === candidates.length) {
      // 全部探测都因网络异常失败：回落到第一个凭证，让删除请求自身报错。
      chosen = candidates[0];
    } else if (noPermCreds.length === candidates.length) {
      return {
        ok: false,
        message: `媒体服务器账号无该条目的删除权限（${label}，item=${copy.itemId}${noPermType ? `，条目类型 ${noPermType}` : ''}），已尝试：${credSummary}。该凭证可以读取条目但没有删除权限，请确认其为管理员；或在「设置 → 媒体服务器」中补填管理员账号的 API Key / 用管理员账号重新登录后重试`,
      };
    } else if (authFailures.length === candidates.length) {
      const detail = authFailures
        .map((failure) => `${failure.label} HTTP ${failure.status}${failure.detail ? `（${failure.detail}）` : ''}`)
        .join('；');
      return {
        ok: false,
        message: `删除前校验失败：媒体服务器凭证均无效（${label}，item=${copy.itemId}）：${detail}，请检查服务器设置中的账号 / API 密钥`,
      };
    } else {
      const parts: string[] = [];
      for (const cred of noPermCreds) parts.push(`${cred.label} 无删除权限`);
      for (const failure of authFailures) parts.push(`${failure.label} HTTP ${failure.status}${failure.detail ? `（${failure.detail}）` : ''}`);
      for (const failure of unknownFailures) parts.push(`${failure.label} HTTP ${failure.status}${failure.detail ? `（${failure.detail}）` : ''}`);
      return {
        ok: false,
        message: `删除前校验失败，无法确认条目状态（${label}，item=${copy.itemId}）：${parts.join('；')}，请检查服务器账号 / API 密钥与网络`,
      };
    }
  }

  // 2) 删除阶段：先用选定的凭证，被拒绝/失败时依次尝试其余凭证（每凭证最多一次）。
  const order: EmbyDeleteCred[] = [chosen, ...candidates.filter((cred) => cred !== chosen)];
  const failures: { label: string; status: number; detail?: string }[] = [];
  let deleteCred: EmbyDeleteCred | null = null;

  for (const cred of order) {
    const request = buildEmbyDeleteRequest(server, serverUrl, copy.itemId, cred);
    let response: Response;
    try {
      response = await nativeFetchImpl(deps.fetchImpl, request.url, { method: 'DELETE', headers: request.headers });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '网络错误';
      return { ok: false, message: `删除请求失败：${detail}（${label}，已尝试 ${cred.label}）` };
    }
    const body = await response.text().catch(() => '');
    const serverDetail = describeEmbyBody(body);
    if (response.ok || response.status === 404) {
      deleteCred = cred;
      break;
    }
    failures.push({ label: cred.label, status: response.status, detail: serverDetail || undefined });
  }

  if (!deleteCred) {
    const detail = failures
      .map((failure) => `${failure.label} HTTP ${failure.status}${failure.detail ? `（${failure.detail}）` : ''}`)
      .join('；');
    const keyHint = String(server.apiKey || '').trim()
      ? '；API Key 的权限跟随其属主账号，也请确认创建该 Key 的账号拥有删除权限'
      : '';
    return {
      ok: false,
      message: `媒体服务器拒绝删除（${label}，item=${copy.itemId}）：${detail}${keyHint}`,
    };
  }

  // 3) 删除后探测：条目必须确认消失才算成功（杜绝"提示成功但文件还在"的假成功）。
  const postProbe = await probeEmbyItem(deps, server, serverUrl, copy.itemId, deleteCred);
  if (postProbe.state === 'deleted') {
    return {
      ok: true,
      message: alreadyGone ? '条目在媒体服务器上已不存在，按删除成功处理' : '已从媒体服务器删除（已校验条目消失）',
    };
  }
  if (postProbe.state === 'still-present') {
    return {
      ok: false,
      message: `媒体服务器返回成功但删除后校验发现条目仍存在（${label}，item=${copy.itemId}）${postProbe.detail ? `，服务器反馈：${postProbe.detail}` : ''}，请到媒体服务器中手动删除`,
    };
  }
  if (postProbe.state === 'verify-error') {
    return {
      ok: false,
      message: `删除请求已发出但删除后校验请求执行失败（${label}，item=${copy.itemId}），无法确认文件是否已删除，请到媒体服务器中核实`,
    };
  }
  if (postProbe.state === 'no-delete-permission') {
    return {
      ok: false,
      message: `删除后校验时 ${deleteCred.label} 被报告无该条目的删除权限（${label}，item=${copy.itemId}），无法确认文件是否已删除，请到媒体服务器中核实`,
    };
  }
  return {
    ok: false,
    message: `删除后校验无法确认条目状态（${label}，item=${copy.itemId}，HTTP ${postProbe.status}${postProbe.detail ? `（${postProbe.detail}）` : ''}），请到媒体服务器中核实文件是否已删除`,
  };
}

/**
 * 探测单条目状态（使用指定凭证）：
 * - 404/410 → 'deleted'
 * - 401/403 → 'auth-error'（凭证无效或无读取权限，无法判定存在性）
 * - 其他 4xx/5xx → 'unknown'
 * - 2xx 单条目形态 → 'still-present'（CanDelete=false 时 → 'no-delete-permission'）；
 *   2xx 列表形态 → 空列表为 'deleted'，非空为 'still-present'
 * - 请求本身抛错（fetch 绑定丢失/网络中断等）→ 'verify-error'
 */
async function probeEmbyItem(
  deps: MediaCleanupDeleteDeps,
  server: EmbyMediaServer,
  serverUrl: string,
  itemId: string,
  cred: EmbyDeleteCred,
): Promise<EmbyItemProbe> {
  const request = buildEmbyProbeRequest(server, serverUrl, itemId, cred);
  let response: Response;
  try {
    response = await nativeFetchImpl(deps.fetchImpl, request.url, { headers: request.headers });
  } catch {
    return { state: 'verify-error' };
  }
  // 读取响应体：JSON 错误信息（如 401/403 的 Message）纳入诊断，便于定位。
  const body = await response.text().catch(() => '');
  const detail = describeEmbyBody(body);
  if (response.status === 404 || response.status === 410) return { state: 'deleted' };
  if (response.status === 401 || response.status === 403) return { state: 'auth-error', status: response.status, detail: detail || undefined };
  if (response.status >= 400) return { state: 'unknown', status: response.status, detail: detail || undefined };

  let parsed: { TotalRecordCount?: unknown; Items?: unknown[]; CanDelete?: unknown; Type?: unknown } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return { state: 'unknown', status: response.status };

  if (request.shape === 'single') {
    if (parsed.CanDelete === false) {
      return { state: 'no-delete-permission', type: typeof parsed.Type === 'string' ? parsed.Type : undefined };
    }
    // 解析失败按仍存在处理（保守，不产生假成功）
    return { state: 'still-present', detail: detail || undefined };
  }
  const count = Array.isArray(parsed.Items)
    ? parsed.Items.length
    : (typeof parsed.TotalRecordCount === 'number' ? parsed.TotalRecordCount : -1);
  if (count < 0) return { state: 'unknown', status: response.status };
  return count === 0 ? { state: 'deleted' } : { state: 'still-present', detail: detail || undefined };
}

function describeEmbyBody(body: string): string {
  const text = String(body || '').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const candidate = parsed?.Message || parsed?.Error || parsed?.message;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 120);
    return '';
  } catch {
    /* 非 JSON 响应体：Emby 403 等场景返回短纯文本（如 "Unauthorized access"），
       有诊断价值；HTML 错误页丢弃。 */
    if (text.length <= 120 && !text.startsWith('<')) return text;
    return '';
  }
}
