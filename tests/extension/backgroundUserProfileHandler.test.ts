/**
 * @file backgroundUserProfileHandler.test.ts
 * @description background user profile message handler 测试
 * @module tests/extension
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fetchUserProfileFromJavDB,
} from '../../apps/extension/src/apps/background/userProfileMessageHandler';
import { DOCUMENT_ONLY_ACCEPT } from '../../apps/extension/src/platform/network/documentRequestHeaders';

describe('background user profile message handler', () => {
  it('parses JavDB profile counts and profile fields from profile html', async () => {
    const html = `
      <a href="/users/profile">amixture</a>
      <a href="/users/want_watch_videos">想看 (97)</a>
      <a href="/users/watched_videos">看过 (4,166)</a>
      <span class="label">电邮地址:</span> user@example.com
      <span class="label">用户类型:</span> VIP
    `;
    const requestScheduler = {
      enqueue: vi.fn(async () => ({
        ok: true,
        status: 200,
        url: 'https://javdb.com/users/profile',
        text: async () => html,
      })),
    };
    const setValue = vi.fn();

    const profile = await fetchUserProfileFromJavDB({
      getValue: vi.fn(async () => ({ email: 'old@example.com' })),
      setValue,
      requestScheduler: requestScheduler as any,
      getJavDBRoute: vi.fn(async () => 'https://javdb.com'),
      now: () => 123456,
    });

    expect(profile).toEqual({
      email: 'user@example.com',
      username: 'amixture',
      userType: 'VIP',
      isLoggedIn: true,
      lastUpdated: 123456,
      serverStats: {
        wantCount: 97,
        watchedCount: 4166,
        lastSyncTime: 123456,
      },
    });
    expect(setValue).toHaveBeenCalledWith(expect.any(String), profile);
    expect(requestScheduler.enqueue).toHaveBeenCalledWith(
      'https://javdb.com/users/profile',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: DOCUMENT_ONLY_ACCEPT,
        }),
      }),
    );
  });

  it('uses the configured JavDB route for profile requests and referer', async () => {
    const html = `
      <a href="/users/profile">amixture</a>
      <span class="label">电邮地址:</span> user@example.com
    `;
    const requestScheduler = {
      enqueue: vi.fn(async (url: string, options: RequestInit) => ({
        ok: true,
        status: 200,
        url,
        text: async () => html,
        requestOptions: options,
      })),
    };

    await fetchUserProfileFromJavDB({
      getValue: vi.fn(async () => null),
      setValue: vi.fn(),
      requestScheduler: requestScheduler as any,
      getJavDBRoute: vi.fn(async () => 'https://javdb570.com/'),
      now: () => 123456,
    });

    expect(requestScheduler.enqueue).toHaveBeenCalledWith(
      'https://javdb570.com/users/profile',
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://javdb570.com/',
        }),
      }),
    );
    expect(requestScheduler.enqueue).toHaveBeenCalledTimes(2);
  });

  it('throws when the profile page is not logged in', async () => {
    const requestScheduler = {
      enqueue: vi.fn(async () => ({
        ok: true,
        status: 200,
        url: 'https://javdb.com/login',
        text: async () => '<form>login</form>',
      })),
    };

    await expect(fetchUserProfileFromJavDB({
      getValue: vi.fn(async () => null),
      setValue: vi.fn(),
      requestScheduler: requestScheduler as any,
      now: () => 123456,
    })).rejects.toThrow('未登录 JavDB');
  });

  it('falls back to a JavDB page request when the background request is blocked', async () => {
    const html = `
      <a href="/users/profile">amixture</a>
      <a href="/users/want_watch_videos">想看 (2)</a>
      <span class="label">电邮地址:</span> user@example.com
    `;
    const requestScheduler = {
      enqueue: vi.fn(async () => ({
        ok: false,
        status: 403,
        url: 'https://javdb.com/users/profile',
        text: async () => 'Forbidden',
      })),
    };
    const fetchFromJavDBTab = vi.fn(async () => ({
      ok: true,
      status: 200,
      finalUrl: 'https://javdb.com/users/profile',
      html,
    }));

    const profile = await fetchUserProfileFromJavDB({
      getValue: vi.fn(async () => null),
      setValue: vi.fn(),
      requestScheduler: requestScheduler as any,
      getJavDBRoute: vi.fn(async () => 'https://javdb.com'),
      fetchFromJavDBTab,
      now: () => 123456,
    });

    expect(profile.email).toBe('user@example.com');
    expect(profile.serverStats.wantCount).toBe(2);
    expect(fetchFromJavDBTab).toHaveBeenCalledWith('https://javdb.com/users/profile');
  });
});
