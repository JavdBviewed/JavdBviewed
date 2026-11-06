/**
 * @file embyPlaystate.test.ts
 * @description 进度写回：ticks 换算 + UserData / PlayingItems
 * @module features/embyLibrary
 */
import { describe, expect, it, vi } from 'vitest';
import { reportEmbyPlaybackProgress, secondsToTicks, ticksToSeconds } from './embyPlaystate';

describe('embyPlaystate', () => {
  it('uses Jellyfin 12 user data and session endpoints with a user token', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const server = { url: 'http://jf.local', apiKey: 'key', accessToken: 'token', userId: 'user-1', type: 'jellyfin' as const };
    const active = await reportEmbyPlaybackProgress({ server, itemId: 'movie-1', positionSeconds: 42, mediaSourceId: 'source-1', playSessionId: 'session-1', fetchImpl });
    expect(active.success).toBe(true);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/UserItems/movie-1/UserData', '/Sessions/Playing', '/Sessions/Playing/Progress',
    ]);
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get('userId')).toBe('user-1');
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({ ItemId: 'movie-1', MediaSourceId: 'source-1', PlaySessionId: 'session-1' });
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body))).not.toHaveProperty('PlayedToCompletion');

    fetchImpl.mockClear();
    const stopped = await reportEmbyPlaybackProgress({ server, itemId: 'movie-1', positionSeconds: 55, isStopped: true, fetchImpl });
    expect(stopped.success).toBe(true);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/UserItems/movie-1/UserData', '/Sessions/Playing/Stopped',
    ]);
  });

  it('uses Jellyfin 12 user data endpoint with an API key', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await reportEmbyPlaybackProgress({
      server: { url: 'http://jf.local', apiKey: 'key', userId: 'user-1', type: 'jellyfin' },
      itemId: 'movie-1', positionSeconds: 22, fetchImpl,
    });
    expect(result.success).toBe(true);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe('/UserItems/movie-1/UserData');
    expect(url.searchParams.get('userId')).toBe('user-1');
    expect(url.searchParams.get('api_key')).toBe('key');
  });

  it('converts seconds and ticks', () => {
    expect(secondsToTicks(1)).toBe(10_000_000);
    expect(secondsToTicks(12.5)).toBe(125_000_000);
    expect(ticksToSeconds(10_000_000)).toBe(1);
  });

  it('writes UserData first when user session exists', async () => {
    const fetchImpl = vi.fn(async (_url: string) => {
      // UserData / PlayingItems Start / Progress 都返回 204
      return new Response(null, { status: 204 });
    });
    const ret = await reportEmbyPlaybackProgress({
      server: {
        url: 'http://emby.local:8096',
        apiKey: 'k',
        accessToken: 'tok',
        userId: 'u1',
        type: 'emby',
      },
      itemId: '99',
      positionSeconds: 42,
      durationSeconds: 120,
      mediaSourceId: 'ms',
      playSessionId: 'ps',
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(true);
    expect(['userdata', 'both', 'playing_progress']).toContain(ret.method);
    expect(fetchImpl).toHaveBeenCalled();
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/Users/u1/Items/99/UserData'))).toBe(true);
  });

  it('stops PlayingItems session when isStopped', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      return new Response(null, { status: 204 });
    });
    const ret = await reportEmbyPlaybackProgress({
      server: {
        url: 'http://emby.local:8096',
        apiKey: 'k',
        accessToken: 'tok',
        userId: 'u1',
        type: 'emby',
      },
      itemId: '99',
      positionSeconds: 42,
      durationSeconds: 120,
      mediaSourceId: 'ms',
      playSessionId: 'ps',
      isStopped: true,
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(true);
    const calls = fetchImpl.mock.calls.map((c) => ({
      url: String(c[0]),
      method: String((c[1] as RequestInit | undefined)?.method || 'GET').toUpperCase(),
    }));
    expect(calls.some((c) => c.url.includes('/Users/u1/Items/99/UserData'))).toBe(true);
    // 关播：DELETE PlayingItems（或 /Delete），并尽量 Sessions/Playing/Stopped
    expect(
      calls.some((c) =>
        c.url.includes('/Users/u1/PlayingItems/99')
        && (c.method === 'DELETE' || c.url.includes('/Delete')),
      ),
    ).toBe(true);
    expect(calls.some((c) => c.url.includes('/Sessions/Playing/Stopped'))).toBe(true);
    // 关播不应再 Start 会话
    expect(
      calls.some((c) =>
        c.method === 'POST'
        && /\/PlayingItems\/99(\?|$)/.test(c.url)
        && !c.url.includes('/Progress')
        && !c.url.includes('/Delete'),
      ),
    ).toBe(false);
  });

  it('fails clearly without auth', async () => {
    const ret = await reportEmbyPlaybackProgress({
      server: {
        url: 'http://emby.local:8096',
        apiKey: '',
        type: 'emby',
      },
      itemId: '1',
      positionSeconds: 10,
      fetchImpl: (async () => new Response(null, { status: 200 })) as any,
    });
    expect(ret.success).toBe(false);
    expect(ret.method).toBe('none');
  });

  it('skips zero progress', async () => {
    const ret = await reportEmbyPlaybackProgress({
      server: {
        url: 'http://emby.local:8096',
        apiKey: 'k',
        accessToken: 'tok',
        userId: 'u1',
        type: 'emby',
      },
      itemId: '1',
      positionSeconds: 0,
      fetchImpl: vi.fn(async () => new Response(null, { status: 204 })) as any,
    });
    expect(ret.success).toBe(false);
    expect(ret.message).toMatch(/0/);
  });
});

describe('reportEmbyPlaybackProgress timeout', () => {
  it('各写回请求携带 abort signal（超时守卫接线）', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Response(null, { status: 204 });
    });
    const ret = await reportEmbyPlaybackProgress({
      server: { url: 'http://emby.local:8096', apiKey: 'k', accessToken: 'tok', userId: 'u1', type: 'emby' },
      itemId: '99',
      positionSeconds: 42,
      durationSeconds: 120,
      isStopped: true,
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(true);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it('服务器黑洞时整次写回在超时预算内结束（fire-and-forget 不堆积）', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
      }));
    const started = Date.now();
    const ret = await reportEmbyPlaybackProgress({
      server: { url: 'http://emby.local:8096', apiKey: 'k', accessToken: 'tok', userId: 'u1', type: 'emby' },
      itemId: '99',
      positionSeconds: 42,
      isStopped: true,
      fetchImpl: fetchImpl as any,
      timeoutMs: 80,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(ret.success).toBe(false);
  });
});

describe('reportEmbyPlaybackProgress credential guard', () => {
  it('reports an actionable credential error instead of opaque failure when nothing is configured', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const ret = await reportEmbyPlaybackProgress({
      server: {
        url: 'http://emby.local:8096',
        type: 'emby' as const,
        apiKey: '',
        accessToken: '',
        userId: '',
      },
      itemId: '1',
      positionSeconds: 60,
      fetchImpl,
    });
    expect(ret.success).toBe(false);
    expect(ret.message).toContain('写回进度缺少可用凭据');
    expect(ret.message).toContain('Emby 设置');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
