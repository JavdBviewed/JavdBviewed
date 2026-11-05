/**
 * @file embyUserAuth.test.ts
 * @description Emby 用户登录辅助单测
 * @module features/embyLibrary
 */
import { describe, expect, it, vi } from 'vitest';
import {
  authenticateEmbyUser,
  buildEmbyAuthHeaders,
  buildMediaBrowserAuthHeader,
  hasEmbyUserSession,
} from './embyUserAuth';

describe('embyUserAuth', () => {
  it('builds MediaBrowser auth header', () => {
    const h = buildMediaBrowserAuthHeader({ token: 'abc', deviceName: 'Test', version: '1.21.5' });
    expect(h).toContain('MediaBrowser');
    expect(h).toContain('Token="abc"');
    expect(h).toContain('DeviceId="Test"');
    expect(h).toContain('Version="1.21.5"');
  });

  it('does not hardcode client version to 1.0.0 when version is provided', () => {
    const h = buildMediaBrowserAuthHeader({ version: '9.8.7' });
    expect(h).toContain('Version="9.8.7"');
    expect(h).not.toContain('Version="1.0.0"');
  });

  it('detects user session', () => {
    expect(hasEmbyUserSession({ accessToken: 't', userId: 'u' })).toBe(true);
    expect(hasEmbyUserSession({ accessToken: '', userId: 'u' })).toBe(false);
  });

  it('parses AuthenticateByName success', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          AccessToken: 'tok-1',
          User: { Id: 'user-1', Name: 'alice' },
          ServerId: 'srv',
        }),
        { status: 200 },
      ),
    );
    const ret = await authenticateEmbyUser({
      url: 'http://emby.local:8096/',
      username: 'alice',
      password: 'secret',
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(true);
    expect(ret.accessToken).toBe('tok-1');
    expect(ret.userId).toBe('user-1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://emby.local:8096/Users/AuthenticateByName',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps 401 to password error', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    const ret = await authenticateEmbyUser({
      url: 'http://emby.local',
      username: 'a',
      password: 'b',
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(false);
    expect(ret.message).toMatch(/用户名或密码/);
  });

  it('sends both Authorization and X-Emby-Authorization headers with identical values on login', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          AccessToken: 'tok-1',
          User: { Id: 'user-1', Name: 'alice' },
          ServerId: 'srv',
        }),
        { status: 200 },
      ),
    );
    const ret = await authenticateEmbyUser({
      url: 'http://emby.local:8096/',
      username: 'alice',
      password: 'secret',
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(true);
    const [, init] = (fetchImpl as any).mock.calls[0];
    expect(init.headers['Authorization']).toBeTruthy();
    expect(init.headers['Authorization']).toBe(init.headers['X-Emby-Authorization']);
  });

  it('uses ProblemDetails title when the 400 body has no message', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ title: 'Bad password', status: 400 }), { status: 400 }),
    );
    const ret = await authenticateEmbyUser({
      url: 'http://emby.local',
      username: 'a',
      password: 'b',
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(false);
    expect(ret.message).toBe('Bad password');
  });

  it('adds the standard Authorization header to buildEmbyAuthHeaders only when a token exists', () => {
    const withToken = buildEmbyAuthHeaders({ accessToken: 'tok-1' });
    expect(withToken['Authorization']).toContain('Token="tok-1"');
    expect(withToken['X-Emby-Token']).toBe('tok-1');
    expect(withToken['X-Emby-Authorization']).toContain('Token="tok-1"');

    const noToken = buildEmbyAuthHeaders({});
    expect(noToken['Authorization']).toBeUndefined();
    expect(noToken['X-Emby-Token']).toBeUndefined();
  });
});
