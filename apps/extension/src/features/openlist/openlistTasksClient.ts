/** OpenList 任务查询及操作；下载与转存是独立阶段，不能按任务 ID 跨阶段合并。 */
import { detectApiPrefix, type OpenListTask } from './openlistClient';
import { normalizeOpenListSettings } from './openlistSettingsModel';

export type OpenListTaskKind = 'offline_download' | 'offline_download_transfer';
export type OpenListDownloadTask = OpenListTask & { kind: OpenListTaskKind; error?: string; totalBytes?: number };
export type OpenListTaskConnection = { baseUrl: string; token: string };
type RequestOptions = { fetchImpl?: typeof fetch; signal?: AbortSignal };
const KINDS: OpenListTaskKind[] = ['offline_download', 'offline_download_transfer'];
export const OPENLIST_TASK_STATES: Record<number, string> = {
  0: '等待中', 1: '进行中', 2: '已完成', 3: '取消中', 4: '已取消', 5: '出错待重试',
  6: '失败处理中', 7: '失败', 8: '等待重试', 9: '准备重试',
};
export const OPENLIST_TASK_KINDS: Record<OpenListTaskKind, string> = {
  offline_download: '下载', offline_download_transfer: '转存到目标目录',
};

function requestWithTimeout({ fetchImpl, signal }: RequestOptions): typeof fetch {
  return async (input, init) => {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15_000);
    try {
      return await (fetchImpl ?? globalThis.fetch.bind(globalThis))(input, { ...init, signal: controller.signal });
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  };
}

async function readResponse(response: Response): Promise<unknown> {
  const raw: unknown = await response.json().catch(() => null);
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (response.status === 401 || body.code === 401) throw new Error('登录凭据已失效，请在 OpenList 设置中更新访问令牌。');
  if (response.status === 403 || body.code === 403) throw new Error('没有查看或操作此任务的权限，请检查 OpenList 账号权限。');
  if (!response.ok || (body.code !== 200 && body.code !== 1500)) {
    throw new Error(`任务请求失败（HTTP ${response.status}${typeof body.code === 'number' ? `，业务码 ${body.code}` : '，未返回有效数据'}）。`);
  }
  return body.data;
}

function connection(params: OpenListTaskConnection) {
  const settings = normalizeOpenListSettings(params);
  if (!settings.baseUrl || !settings.token) throw new Error('请先在网盘设置中填写 OpenList 地址和访问令牌。');
  return settings;
}

function parseTasks(data: unknown, kind: OpenListTaskKind): OpenListDownloadTask[] {
  if (data === null) return [];
  if (!Array.isArray(data) || data.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')) {
    throw new Error('服务器返回的任务列表格式不正确，请检查 OpenList 版本或代理配置。');
  }
  return data.map((item: Record<string, unknown>) => ({
    id: String(item.id), kind,
    name: typeof item.name === 'string' ? item.name : '未命名任务',
    state: typeof item.state === 'number' ? item.state : undefined,
    status: typeof item.status === 'string' ? item.status : undefined,
    error: typeof item.error === 'string' ? item.error : undefined,
    progress: typeof item.progress === 'number' && Number.isFinite(item.progress) ? Math.max(0, Math.min(100, item.progress)) : undefined,
    totalBytes: typeof item.total_bytes === 'number' ? item.total_bytes : undefined,
  }));
}

export async function listOpenListTasks(params: OpenListTaskConnection, options: RequestOptions = {}): Promise<{ tasks: OpenListDownloadTask[]; errors: string[] }> {
  const settings = connection(params);
  const request = requestWithTimeout(options);
  const { prefix } = await detectApiPrefix(settings.baseUrl, request);
  const partitions = KINDS.flatMap(kind => (['undone', 'done'] as const).map(state => ({ kind, state })));
  const results = await Promise.allSettled(partitions.map(async ({ kind, state }) => {
    const response = await request(`${settings.baseUrl}${prefix}/task/${kind}/${state}`, { headers: { Authorization: settings.token, Accept: 'application/json' } });
    return parseTasks(await readResponse(response), kind);
  }));
  options.signal?.throwIfAborted();
  const tasks = new Map<string, OpenListDownloadTask>();
  const errors: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') for (const task of result.value) tasks.set(`${task.kind}:${task.id}`, task);
    else errors.push(`${OPENLIST_TASK_KINDS[partitions[i].kind]}${partitions[i].state === 'done' ? '历史' : '当前'}任务：${result.reason instanceof Error ? result.reason.message : '请求失败，请重试。'}`);
  });
  return { tasks: [...tasks.values()], errors };
}

export async function operateOpenListTask(params: OpenListTaskConnection, task: Pick<OpenListDownloadTask, 'kind' | 'id'>,
  action: 'cancel' | 'retry', options: RequestOptions = {}): Promise<void> {
  if (!KINDS.includes(task.kind) || !task.id || !['cancel', 'retry'].includes(action)) throw new Error('无效的任务操作。');
  const settings = connection(params);
  const request = requestWithTimeout(options);
  const { prefix } = await detectApiPrefix(settings.baseUrl, request);
  const response = await request(`${settings.baseUrl}${prefix}/task/${task.kind}/${action}?${new URLSearchParams({ tid: task.id })}`, {
    method: 'POST', headers: { Authorization: settings.token, Accept: 'application/json' },
  });
  await readResponse(response);
}
