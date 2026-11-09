/**
 * @file openlistClient.ts
 * @description OpenList 离线下载与连接探测；内容脚本优先经后台代理请求
 * @module features/openlist
 */
import { isOpenListDeletePolicy, type OpenListDeletePolicy } from './deletePolicy';
import { sendRuntimeMessage } from '../../platform/browser/runtimeMessages';

export type OpenListTask = {
  id: string;
  name?: string;
  state?: number;
  status?: string;
  progress?: number;
};

export type AddOfflineDownloadParams = {
  baseUrl: string;
  token: string;
  path: string;
  urls: string[];
  tool: string;
  deletePolicy?: OpenListDeletePolicy;
};

export type AddOfflineDownloadResult = {
  success: boolean;
  tasks?: OpenListTask[];
  message?: string;
  raw?: unknown;
};

export type TestConnectionResult = {
  ok: boolean;
  version?: string;
  username?: string;
  message?: string;
  diagnostics?: OpenListDiagnostics;
};

export type OpenListDiagnostics = {
  stage: 'public/settings' | 'me';
  httpStatus?: number;
  apiCode?: number;
  contentType?: string;
};

export type ListToolsResult = {
  success: boolean;
  tools?: string[];
  message?: string;
  raw?: unknown;
};

type ApiPrefix = '/api' | '/api/v3';
type ApiResponse = { code?: number; message?: string; data?: unknown };

class OpenListApiError extends Error {
  constructor(message: string, readonly diagnostics: OpenListDiagnostics) {
    super(message);
  }
}

function apiSucceeded(response: Response, raw: ApiResponse): boolean {
  return response.ok && (raw.code === 200 || raw.code === 1500);
}

function diagnosticsOf(stage: OpenListDiagnostics['stage'], response: Response, raw: ApiResponse): OpenListDiagnostics {
  return {
    stage,
    httpStatus: response.status,
    ...(typeof raw.code === 'number' ? { apiCode: raw.code } : {}),
    contentType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'unknown',
  };
}

function baseUrlOf(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) throw new Error('请输入有效的 OpenList 服务器地址（http:// 或 https://）');
  return value;
}

function friendlyRequestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/illegal invocation/i.test(message)) return '当前运行环境无法发起请求，请检查扩展后台是否正常';
  if (/failed to fetch|networkerror|load failed|network request failed|timed? ?out|timeout/i.test(message)) {
    return '网络异常，无法连接 OpenList 服务，请稍后重试';
  }
  return message || 'OpenList 请求失败';
}

// 以宿主全局为 this 调用 fetch，兼容 MV3 Service Worker 的原生方法绑定。
function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch.call(globalThis, input, init);
}

async function readApiResponse(response: Response): Promise<ApiResponse> {
  const body: unknown = await response.json().catch(() => ({}));
  return body !== null && typeof body === 'object' ? body as ApiResponse : {};
}

function messageOf(raw: ApiResponse, response: Response): string {
  if (!raw.code && response.ok && response.headers.get('content-type')?.includes('text/html')) {
    return `OpenList 接口返回 HTTP ${response.status} HTML 页面，请检查服务器地址或反向代理的 API 转发`;
  }
  return typeof raw.message === 'string' && raw.message.trim() && raw.message.toLowerCase() !== 'success'
    ? raw.message
    : `OpenList 请求失败 (HTTP ${response.status}${typeof raw.code === 'number' ? `，业务码 ${raw.code}` : '，未收到有效 JSON'})`;
}

/** 依次探测新旧 API 前缀；OpenList 使用 200，旧部署也可能返回 1500。 */
export async function detectApiPrefix(
  baseUrl: string,
  fetchImpl: typeof fetch = nativeFetch,
): Promise<{ prefix: ApiPrefix; version?: string }> {
  const base = baseUrlOf(baseUrl);
  let lastError = '该地址不是可用的 OpenList 服务';
  let lastDiagnostics: OpenListDiagnostics = { stage: 'public/settings' };
  for (const prefix of ['/api', '/api/v3'] as const) {
    try {
      const response = await fetchImpl(`${base}${prefix}/public/settings`, { method: 'GET' });
      const raw = await readApiResponse(response);
      if (apiSucceeded(response, raw)) {
        const data = raw.data;
        const version = data !== null && typeof data === 'object' && 'version' in data && typeof data.version === 'string'
          ? data.version : undefined;
        return { prefix, ...(version ? { version } : {}) };
      }
      lastError = messageOf(raw, response);
      lastDiagnostics = diagnosticsOf('public/settings', response, raw);
    } catch (error) {
      lastError = friendlyRequestError(error);
      lastDiagnostics = { stage: 'public/settings' };
    }
  }
  throw new OpenListApiError(lastError, lastDiagnostics);
}

async function tryBackground<T>(type: string, payload: unknown, isResult: (value: unknown) => value is T): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') return undefined;
  try {
    const result: unknown = await sendRuntimeMessage({ type, payload });
    return isResult(result) ? result : undefined;
  } catch {
    // 仅后台代理不可用时回退，业务失败是有效响应，不重复发起请求。
    return undefined;
  }
}

function isAddResult(value: unknown): value is AddOfflineDownloadResult {
  return value !== null && typeof value === 'object' && 'success' in value && typeof value.success === 'boolean';
}

function isConnectionResult(value: unknown): value is TestConnectionResult {
  return value !== null && typeof value === 'object' && 'ok' in value && typeof value.ok === 'boolean';
}

/** 令牌以 OpenList 原值发出，不加 Bearer；注入 fetch 时跳过后台消息。 */
export async function testConnection(
  params: { baseUrl: string; token: string },
  fetchImpl?: typeof fetch,
): Promise<TestConnectionResult> {
  if (!fetchImpl) {
    const result = await tryBackground('openlist.test_connection', params, isConnectionResult);
    if (result) return result;
  }
  const request = fetchImpl ?? nativeFetch;
  try {
    const { prefix, version } = await detectApiPrefix(params.baseUrl, request);
    if (!params.token.trim()) return { ok: true, version };
    const response = await request(`${baseUrlOf(params.baseUrl)}${prefix}/me`, {
      method: 'GET',
      headers: { Authorization: params.token.trim(), Accept: 'application/json' },
    });
    const raw = await readApiResponse(response);
    if (!apiSucceeded(response, raw)) return { ok: false, message: messageOf(raw, response), diagnostics: diagnosticsOf('me', response, raw) };
    const data = raw.data;
    const username = data !== null && typeof data === 'object' && 'username' in data && typeof data.username === 'string'
      ? data.username : undefined;
    return { ok: true, version, username };
  } catch (error) {
    return { ok: false, message: friendlyRequestError(error), ...(error instanceof OpenListApiError ? { diagnostics: error.diagnostics } : {}) };
  }
}

/** 发起离线下载；HTTP 200 但业务码不成功仍视为失败。 */
export async function addOfflineDownload(
  params: AddOfflineDownloadParams,
  fetchImpl?: typeof fetch,
): Promise<AddOfflineDownloadResult> {
  if (!isOpenListDeletePolicy(params.deletePolicy)) return { success: false, message: '不支持的 OpenList 源文件删除策略' };
  if (!params.token.trim() || !Array.isArray(params.urls) || !params.urls.length || params.urls.some((url) => typeof url !== 'string' || !url.trim())) {
    return { success: false, message: '缺少 OpenList token 或下载链接' };
  }
  if (params.tool.trim().toLowerCase() === 'simplehttp' && params.urls.some(url => /^magnet:/i.test(url.trim()))) {
    return { success: false, message: 'SimpleHttp 不支持磁链，请在 OpenList 配置 aria2 等磁链下载器后再推送' };
  }
  if (!fetchImpl) {
    const result = await tryBackground('openlist.add_offline_download', params, isAddResult);
    if (result) return result;
  }
  const request = fetchImpl ?? nativeFetch;
  try {
    const { prefix } = await detectApiPrefix(params.baseUrl, request);
    const response = await request(`${baseUrlOf(params.baseUrl)}${prefix}/fs/add_offline_download`, {
      method: 'POST',
      headers: { Authorization: params.token.trim(), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: params.urls, path: params.path, tool: params.tool,
        ...(params.deletePolicy === 'delete_on_upload_succeed' ? { delete_policy: params.deletePolicy } : {}),
      }),
    });
    const raw = await readApiResponse(response);
    if (!apiSucceeded(response, raw)) return { success: false, message: messageOf(raw, response), raw };
    const data = raw.data;
    const tasks = data !== null && typeof data === 'object' && 'tasks' in data && Array.isArray(data.tasks)
      ? data.tasks as OpenListTask[] : [];
    return { success: true, tasks, raw };
  } catch (error) {
    return { success: false, message: friendlyRequestError(error) };
  }
}

/** 列出服务器该路径可用的下载器。 */
export async function listTools(
  params: { baseUrl: string; path?: string },
  fetchImpl: typeof fetch = nativeFetch,
): Promise<ListToolsResult> {
  try {
    const { prefix } = await detectApiPrefix(params.baseUrl, fetchImpl);
    const query = params.path === undefined ? '' : `?${new URLSearchParams({ path: params.path })}`;
    const response = await fetchImpl(`${baseUrlOf(params.baseUrl)}${prefix}/public/offline_download_tools${query}`, { method: 'GET' });
    const raw = await readApiResponse(response);
    if (!apiSucceeded(response, raw)) return { success: false, message: messageOf(raw, response), raw };
    return { success: true, tools: Array.isArray(raw.data) ? raw.data.filter((tool): tool is string => typeof tool === 'string') : [], raw };
  } catch (error) {
    return { success: false, message: friendlyRequestError(error) };
  }
}
