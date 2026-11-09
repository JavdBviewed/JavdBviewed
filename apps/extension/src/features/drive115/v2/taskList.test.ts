/** @description 任务页直接请求列表，不发送没有后台接收器的消息；业务错误保持失败。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../utils/storage', () => ({ getSettings: async () => ({ drive115: {} }) }));
vi.mock('./logs', () => ({ addLogV2: vi.fn() }));
import { getDrive115V2Service } from './index';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('115 task list request', () => {
  it.each([true, false])('uses one HTTP request and preserves business result: %s', async success => {
    const sendMessage = vi.fn((_message, callback) => callback(undefined));
    vi.stubGlobal('chrome', { runtime: { id: 'synthetic-extension', sendMessage } });
    const data = { tasks: [], count: 0, page_count: 1 };
    const body = success ? { state: true, data } : { state: false, code: 40140125, message: 'access_token 无效' };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal('fetch', fetch);
    const result = await getDrive115V2Service().getTaskList({ accessToken: 'synthetic-token', page: 2 });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toContain('/open/offline/get_task_list?page=2');
    expect(result.success).toBe(success);
    if (success) expect(result.data).toEqual(data);
    else expect(result.message).toContain('access_token');
  });
});
