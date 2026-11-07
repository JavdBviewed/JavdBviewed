import { describe, expect, it, vi } from 'vitest';
import { listOpenListTasks, operateOpenListTask } from './openlistTasksClient';
const config = { baseUrl: 'https://files.example.test', token: 'private-test-token' };
const json = (data: unknown, code = 200) => new Response(JSON.stringify({ code, data }), { headers: { 'Content-Type': 'application/json' } });

describe('OpenList download task API', () => {
  it('reads running, finished and transfer tasks, preserving stage and accepting null lists', async () => {
    const request = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith('public/settings')) return json({ version: 'test' });
      if (path.endsWith('/offline_download/undone')) return json([{ id: 'a', name: 'one', state: 1, progress: 25 }]);
      if (path.endsWith('/offline_download_transfer/done')) return json([{ id: 'a', name: 'saved', state: 2, progress: 100 }]);
      return json(null);
    });
    const result = await listOpenListTasks(config, { fetchImpl: request });
    expect(result.tasks.map(task => [task.kind, task.id])).toEqual([['offline_download', 'a'], ['offline_download_transfer', 'a']]);
    expect(result.errors).toEqual([]);
    expect(request.mock.calls.map(([url]) => String(url))).toContain(`${config.baseUrl}/api/task/offline_download/done`);
  });
  it('reports a denied partition while keeping successful tasks, without leaking tokens', async () => {
    const request = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/transfer')) return json(null);
      if (String(url).endsWith('public/settings')) return json({});
      if (String(url).endsWith('/offline_download/undone')) return json([{ id: 'a', state: 1 }]);
      return json(null, 403);
    });
    const result = await listOpenListTasks(config, { fetchImpl: request });
    expect(result.tasks).toHaveLength(1);
    expect(result.errors.join()).toContain('权限');
    expect(JSON.stringify(result)).not.toContain(config.token);
  });
  it('rejects malformed success bodies instead of showing an empty list', async () => {
    const request = vi.fn(async (url: RequestInfo | URL) => json(String(url).endsWith('public/settings') ? {} : { unexpected: [] }));
    const result = await listOpenListTasks(config, { fetchImpl: request });
    expect(result.errors).toHaveLength(4);
  });
  it('uses POST and escaped tid query with the raw token for retry', async () => {
    const request = vi.fn(async () => json({}));
    await operateOpenListTask(config, { kind: 'offline_download_transfer', id: 'a&b' }, 'retry', { fetchImpl: request });
    expect(request).toHaveBeenLastCalledWith(`${config.baseUrl}/api/task/offline_download_transfer/retry?tid=a%26b`, expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: config.token }),
    }));
  });
  it('fails closed for an invalid task kind and does not request the server', async () => {
    const request = vi.fn();
    await expect(operateOpenListTask(config, { kind: '../admin' as 'offline_download', id: 'a' }, 'cancel', { fetchImpl: request })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
