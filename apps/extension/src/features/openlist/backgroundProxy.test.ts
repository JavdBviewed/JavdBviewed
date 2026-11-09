import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOpenListProxy } from './backgroundProxy';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

type Listener = (message: unknown, sender: unknown, reply: (response: unknown) => void) => boolean | void;

function setup(): { send: (message: unknown) => Promise<{ keepAlive: boolean | void; reply: unknown }>; fetchMock: ReturnType<typeof vi.fn> } {
  let listener: Listener | undefined;
  const addListener = vi.fn((fn: Listener) => { listener = fn; });
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } });
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/public/settings')
    ? json({ code: 1500, data: { version: '1.9.9' } })
    : url.endsWith('/me')
      ? json({ code: 1500, data: { username: 'admin' } })
      : json({ code: 1500, data: { tasks: [{ id: 't-1' }] } }));
  vi.stubGlobal('fetch', fetchMock);
  installOpenListProxy();
  return {
    fetchMock,
    send: async (message) => {
      let keepAlive: boolean | void;
      const reply = await new Promise<unknown>((resolve) => { keepAlive = listener?.(message, {}, resolve); });
      return { keepAlive, reply };
    },
  };
}

afterEach(() => {
  delete (globalThis as { __openlist_proxy_installed?: boolean }).__openlist_proxy_installed;
  vi.unstubAllGlobals();
});

describe('OpenList background proxy', () => {
  it('forwards success-only cleanup and rejects unsafe policies at the message boundary', async () => {
    const { send, fetchMock } = setup();
    const payload = { baseUrl: 'http://nas.local', token: 'synthetic', path: '/nas', urls: ['magnet:?x'], tool: '115 Open', deletePolicy: 'delete_on_upload_succeed' };
    expect((await send({ type: 'openlist.add_offline_download', payload })).reply).toMatchObject({ success: true });
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toMatchObject({ delete_policy: 'delete_on_upload_succeed' });
    fetchMock.mockClear();
    expect((await send({ type: 'openlist.add_offline_download', payload: { ...payload, deletePolicy: 'delete_always' } })).reply).toMatchObject({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the channel alive and forwards add request with raw token and JSON body', async () => {
    const { send, fetchMock } = setup();
    const { keepAlive, reply } = await send({
      type: 'openlist.add_offline_download',
      payload: { baseUrl: 'http://nas.local', token: 'secret', path: '/downloads', urls: ['magnet:?x'], tool: 'aria2' },
    });
    expect(keepAlive).toBe(true);
    expect(reply).toMatchObject({ success: true, tasks: [{ id: 't-1' }] });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('http://nas.local/api/fs/add_offline_download');
    expect(init.headers).toMatchObject({ Authorization: 'secret' });
    expect(JSON.parse(String(init.body))).toEqual({ urls: ['magnet:?x'], path: '/downloads', tool: 'aria2' });
  });

  it('forwards connection result and validates add payload before any fetch', async () => {
    const { send, fetchMock } = setup();
    expect((await send({ type: 'openlist.test_connection', payload: { baseUrl: 'http://nas.local', token: 'secret' } })).reply)
      .toMatchObject({ ok: true, version: '1.9.9', username: 'admin' });
    fetchMock.mockClear();
    expect((await send({ type: 'openlist.add_offline_download', payload: { baseUrl: 'http://nas.local', token: 'secret', urls: [] } })).reply)
      .toMatchObject({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores unrelated messages and registers once', () => {
    let listener: Listener | undefined;
    const addListener = vi.fn((fn: Listener) => { listener = fn; });
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } });
    installOpenListProxy();
    installOpenListProxy();
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(listener?.({ type: 'other' }, {}, vi.fn())).toBe(false);
  });
});
