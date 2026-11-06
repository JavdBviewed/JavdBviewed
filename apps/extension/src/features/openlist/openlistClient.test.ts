import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addOfflineDownload,
  detectApiPrefix,
  listTools,
  testConnection,
} from './openlistClient';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const params = {
  baseUrl: 'https://list.example/',
  token: 'raw-token',
  path: '/downloads',
  urls: ['magnet:?xt=urn:btih:abc', 'https://files.example/a'],
  tool: 'aria2',
};

afterEach(() => vi.unstubAllGlobals());

describe('OpenList client', () => {
  it('detects /api first and preserves its version', async () => {
    const fetchMock = vi.fn(async () => json({ code: 1500, data: { version: '1.9.9' } }));
    expect(await detectApiPrefix('https://list.example///', fetchMock)).toEqual({ prefix: '/api', version: '1.9.9' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://list.example/api/public/settings');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to /api/v3 when /api returns a non-1500 response', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('/api/v3/')
      ? json({ code: 1500, data: { version: '3.1' } })
      : json({ code: 404 }, 404));
    expect(await detectApiPrefix('http://nas.local:5244', fetchMock)).toEqual({ prefix: '/api/v3', version: '3.1' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://nas.local:5244/api/public/settings',
      'http://nas.local:5244/api/v3/public/settings',
    ]);
  });

  it('reports an unreachable server after both prefix attempts', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(detectApiPrefix('https://list.example', fetchMock)).rejects.toThrow('网络异常');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends JSON and raw Authorization and returns tasks for code 1500', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/public/settings')
      ? json({ code: 1500, data: {} })
      : json({ code: 1500, data: { tasks: [{ id: 't-1', name: 'x', state: 0, status: 'created', progress: 0 }] } }));
    const result = await addOfflineDownload(params, fetchMock);
    expect(result).toMatchObject({ success: true, tasks: [{ id: 't-1' }] });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://list.example/api/fs/add_offline_download');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'raw-token', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ urls: params.urls, path: '/downloads', tool: 'aria2' });
  });

  it('treats HTTP 200 with non-1500 code as failure with server message', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/public/settings')
      ? json({ code: 1500, data: {} }) : json({ code: 403, message: 'permission denied' }));
    expect(await addOfflineDownload(params, fetchMock)).toMatchObject({ success: false, message: 'permission denied', raw: { code: 403 } });
  });

  it('returns a friendly network error when posting fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/public/settings')) return json({ code: 1500, data: {} });
      throw new TypeError('Failed to fetch');
    });
    expect(await addOfflineDownload(params, fetchMock)).toMatchObject({ success: false, message: expect.stringContaining('网络异常') });
  });

  it('tests connection with raw token and version/username', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/public/settings')
      ? json({ code: 1500, data: { version: '1.9.9' } })
      : json({ code: 1500, data: { username: 'admin', role: 100 } }));
    expect(await testConnection(params, fetchMock)).toEqual({ ok: true, version: '1.9.9', username: 'admin' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://list.example/api/me');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('raw-token');
  });

  it('reports 401 without claiming connection success', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/public/settings')
      ? json({ code: 1500, data: { version: '1.9.9' } })
      : json({ code: 401, message: 'invalid token' }, 401));
    expect(await testConnection(params, fetchMock)).toMatchObject({ ok: false, message: 'invalid token' });
  });

  it('lists available tools with URL-encoded path on the detected prefix', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/public/settings')
      ? json({ code: 1500, data: {} }) : json({ code: 1500, data: ['aria2', 'qbittorrent'] }));
    expect(await listTools({ baseUrl: params.baseUrl, path: '/movies & tv' }, fetchMock)).toMatchObject({ success: true, tools: ['aria2', 'qbittorrent'] });
    expect(fetchMock.mock.calls[1][0]).toBe('https://list.example/api/public/offline_download_tools?path=%2Fmovies+%26+tv');
  });

  it('uses the SW result without direct requests, including business failures', async () => {
    const direct = vi.fn();
    vi.stubGlobal('fetch', direct);
    const sendMessage = vi.fn((_message, reply) => reply({ success: false, message: 'permission denied', raw: { code: 403 } }));
    vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
    expect(await addOfflineDownload(params)).toMatchObject({ success: false, message: 'permission denied' });
    expect(sendMessage.mock.calls[0][0]).toEqual({ type: 'openlist.add_offline_download', payload: params });
    expect(direct).not.toHaveBeenCalled();
  });

  it('falls back to direct fetch when SW has no response', async () => {
    vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage: vi.fn((_message, reply) => reply(undefined)) } });
    const direct = vi.fn(async (url: string) => url.endsWith('/public/settings')
      ? json({ code: 1500, data: { version: '1.9.9' } })
      : json({ code: 1500, data: { username: 'admin' } }));
    vi.stubGlobal('fetch', direct);
    expect(await testConnection(params)).toMatchObject({ ok: true, username: 'admin' });
    expect(direct).toHaveBeenCalledTimes(2);
  });
});
