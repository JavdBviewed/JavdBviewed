/**
 * @file cloudSyncFacade.test.ts
 * @description Cloud facade 契约：UI 只依赖清晰状态/动作，不直接拼 API 细节
 */
import { describe, expect, it, vi } from 'vitest';
import { createMockCloudTransport, type HttpTransport } from '@javdb/sync-client';
import { accountEntityTypesFromMatrix } from '@javdb/sync-protocol';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';
import { CLOUD_SETTINGS_STORAGE_KEY } from '../../apps/extension/src/features/cloudSync/cloudSettingsStorage';
import { CLOUD_SESSION_STORAGE_KEY } from '../../apps/extension/src/features/cloudSync/chromeTokenStore';

describe('Cloud sync extension facade', () => {
  it('keeps Cloud credentials as the only extension connection path', async () => {
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const facade = createExtensionCloudFacade();

    expect('logout' in facade).toBe(true);
    expect('requestDeviceAccess' in facade).toBe(false);
    expect('checkDeviceAccess' in facade).toBe(false);
  });

  it('declares adapter support for every protocol account entity type', async () => {
    const mod = await import('../../apps/extension/src/features/cloudSync/extensionEntityStore');
    expect(mod.assertExtensionCloudAdapterCoverage).toBeTypeOf('function');
    expect(mod.EXTENSION_SYNC_ENTITY_TYPES.slice().sort()).toEqual(
      accountEntityTypesFromMatrix().sort(),
    );
    expect(() => mod.assertExtensionCloudAdapterCoverage()).not.toThrow();
  });

  it('exposes state, login and logout without leaking API client wiring to UI', async () => {
    const { transport } = createMockCloudTransport();
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const setupAutoSyncAlarm = vi.fn(async () => undefined);
    const facade = createExtensionCloudFacade({
      transport,
      platform: 'vitest-user-agent',
      setupAutoSyncAlarm,
    });

    setChromeStorage({
      settings: { webdav: { clientId: 'shared-device-id' } },
      [CLOUD_SETTINGS_STORAGE_KEY]: {
        baseUrl: 'http://mock',
        deviceLabel: '测试扩展',
        deviceId: 'shared-device-id',
        updatedAt: 1,
      },
    });

    const before = await facade.loadState();
    expect(before.loggedIn).toBe(false);
    expect(before.settings.deviceId).toBe('shared-device-id');

    await facade.register({ identifier: 'admin', password: 'pw' });
    const login = await facade.login({ identifier: 'admin', password: 'pw' });
    expect(login.session?.accessToken).toBeTruthy();
    expect(login.devices.some((device) => device.id === 'shared-device-id')).toBe(
      true,
    );

    const afterLogin = await facade.loadState();
    expect(afterLogin.loggedIn).toBe(true);
    expect(afterLogin.devices.some((device) => device.id === 'shared-device-id')).toBe(
      true,
    );

    // alarm 再评估：登录后恰一次
    expect(setupAutoSyncAlarm).toHaveBeenCalledTimes(1);
    await facade.logout();
    expect(getChromeStorageSnapshot()[CLOUD_SESSION_STORAGE_KEY]).toBeUndefined();
    expect(setupAutoSyncAlarm).toHaveBeenCalledTimes(2);
    const afterLogout = await facade.loadState();
    expect(afterLogout.loggedIn).toBe(false);
    expect(afterLogout.devices).toEqual([]);
    // C′（10-13 裁决）：登出连带清已存密码，保留 baseUrl/账号
    expect(afterLogout.settings.accountPassword).toBe('');
    expect(afterLogout.settings.accountIdentifier).toBe('admin');
    expect(afterLogout.settings.baseUrl).toBe('http://mock');
    // ③ 本机移除拦截：指向登出
    await expect(facade.revokeDevice('shared-device-id')).rejects.toThrow(
      '不能移除本机设备，请使用「退出登录」',
    );
  });

  it('normalizes connection validation errors into UI-facing messages', async () => {
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const facade = createExtensionCloudFacade();
    await expect(facade.saveConnection({ baseUrl: '', deviceLabel: 'A' })).rejects.toThrow(
      '请填写有效的 Cloud 地址',
    );
  });

  it('probes stored-credential auth state read-only in checkHealth for the saved address only', async () => {
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );

    const jsonResponse = (status: number, body: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response;

    const calls: Array<{ url: string; auth?: string }> = [];
    let devicesStatus = 401;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, auth: headers.Authorization });
      if (url.endsWith('/health')) {
        return jsonResponse(200, { ok: true, protocolVersion: 3 });
      }
      if (url.endsWith('/v1/devices')) {
        return jsonResponse(devicesStatus, []);
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    const facade = createExtensionCloudFacade({ fetchImpl });

    await facade.saveConnection({
      baseUrl: 'http://probe.test',
      deviceLabel: 'probe',
      identifier: 'admin',
      password: 'pw',
    });
    setChromeStorage({
      [CLOUD_SESSION_STORAGE_KEY]: {
        accessToken: 'tok-1',
        refreshToken: 'rt-1',
        userId: 'u-1',
        deviceId: 'd-1',
        savedAt: 1,
      },
    });

    // 已存地址 + 已存令牌被拒（401）→ invalid；判定只读，仅一次裸 GET /v1/devices
    const invalid = await facade.checkHealth();
    expect(invalid.ok).toBe(true);
    expect(invalid.auth).toBe('invalid');
    expect(calls).toContainEqual({
      url: 'http://probe.test/v1/devices',
      auth: 'Bearer tok-1',
    });

    // 会话被清空（如 refresh 失败后）→ not-logged-in，不再请求 /v1/devices
    setChromeStorage({ [CLOUD_SESSION_STORAGE_KEY]: null });
    const anonymous = await facade.checkHealth();
    expect(anonymous.ok).toBe(true);
    expect(anonymous.auth).toBe('not-logged-in');
    expect(calls.filter((c) => c.url.endsWith('/v1/devices')).length).toBe(1);

    // 探测别的地址：只探 health，不附带鉴权状态，不触碰已存会话
    setChromeStorage({
      [CLOUD_SESSION_STORAGE_KEY]: {
        accessToken: 'tok-2',
        refreshToken: 'rt-2',
        userId: 'u-1',
        deviceId: 'd-1',
        savedAt: 2,
      },
    });
    const other = await facade.checkHealth('http://other.test');
    expect(other.ok).toBe(true);
    expect(other.auth).toBeUndefined();
    expect(calls.filter((c) => c.url.startsWith('http://other.test')).map((c) => c.url)).toEqual([
      'http://other.test/health',
    ]);

    // 令牌有效 → authenticated；全程不发起任何登录请求（不触发自动恢复）
    devicesStatus = 200;
    const authed = await facade.checkHealth();
    expect(authed.auth).toBe('authenticated');
    expect(calls.every((c) => !c.url.endsWith('/v1/auth/login'))).toBe(true);

    // ② server 不可达回落：logout 请求失败 → 本地 clear 生效（已存会话清空，状态回未登录）
    setChromeStorage({
      [CLOUD_SESSION_STORAGE_KEY]: {
        accessToken: 'tok-3',
        refreshToken: 'rt-3',
        userId: 'u-1',
        deviceId: 'd-1',
        savedAt: 3,
      },
    });
    const unreachableFacade = createExtensionCloudFacade({
      fetchImpl,
      transport: {
        async request<T>(): Promise<T> {
          throw new Error('network down');
        },
      } as unknown as HttpTransport,
    });
    await unreachableFacade.logout();
    expect(getChromeStorageSnapshot()[CLOUD_SESSION_STORAGE_KEY]).toBeUndefined();
    expect((await unreachableFacade.loadState()).loggedIn).toBe(false);
  });

  it('persists configured account credentials with the reusable Cloud connection', async () => {
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const facade = createExtensionCloudFacade();

    await facade.saveConnection({
      baseUrl: 'https://cloud.example.com',
      deviceLabel: '测试扩展',
      identifier: 'alice',
      password: 'saved-password',
    });

    expect(getChromeStorageSnapshot()[CLOUD_SETTINGS_STORAGE_KEY]).toMatchObject({
      accountIdentifier: 'alice',
      accountPassword: 'saved-password',
    });
    await expect(facade.loadState()).resolves.toMatchObject({
      settings: {
        accountIdentifier: 'alice',
        accountPassword: 'saved-password',
      },
    });
  });

});

describe('Cloud 登出顺序与恢复竞态（10-13 四跑根因, 裁决修复①）', () => {
  const seedLoggedOutState = () => {
    setChromeStorage({
      settings: { webdav: { clientId: 'shared-device-id' } },
      [CLOUD_SETTINGS_STORAGE_KEY]: {
        baseUrl: 'http://mock',
        accountIdentifier: 'admin',
        accountPassword: 'pw',
        deviceLabel: '测试扩展',
        deviceId: 'shared-device-id',
        updatedAt: 1,
      },
      [CLOUD_SESSION_STORAGE_KEY]: {
        accessToken: 'tok',
        refreshToken: 'r',
        userId: 'u1',
        deviceId: 'shared-device-id',
        savedAt: 1,
      },
    });
  };

  it('logout 必须先落盘密码清写再清 session（顺序锁：对旧顺序 RED）', async () => {
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const { transport: mockTransport } = createMockCloudTransport();
    const events: string[] = [];
    const transport: HttpTransport = {
      request: async (opts) => {
        events.push(`api:${opts.method} ${opts.path}`);
        return mockTransport.request(opts);
      },
    };

    seedLoggedOutState();

    // 只记「已存密码被清空」这一次 settings 写（old 非空 → new 空）
    chrome.storage.onChanged.addListener((changes) => {
      const c = changes[CLOUD_SETTINGS_STORAGE_KEY];
      const oldPw = (c?.oldValue as { accountPassword?: string } | undefined)?.accountPassword;
      const newPw = (c?.newValue as { accountPassword?: string } | undefined)?.accountPassword;
      if (typeof oldPw === 'string' && oldPw !== '' && newPw === '') {
        events.push('storage:password-cleared');
      }
    });

    const facade = createExtensionCloudFacade({
      transport,
      platform: 'vitest-user-agent',
      setupAutoSyncAlarm: vi.fn(async () => undefined),
    });

    await facade.logout();

    const pwIndex = events.indexOf('storage:password-cleared');
    const apiLogoutIndex = events.indexOf('api:POST /v1/auth/logout');
    expect(pwIndex, `events=${JSON.stringify(events)}`).toBeGreaterThanOrEqual(0);
    expect(apiLogoutIndex, `events=${JSON.stringify(events)}`).toBeGreaterThanOrEqual(0);
    // 裁决①：密码清写完成先于 session 清除（api.logout 内含 finally tokens.clear）
    expect(pwIndex, `events=${JSON.stringify(events)}`).toBeLessThan(apiLogoutIndex);
  });

  it('logout 后由 session 移除事件触发的 ensure-session 恢复不得重登（场景锁：对旧顺序 RED）', async () => {
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const { recoverCloudAuthSession } = await import(
      '../../apps/extension/src/features/cloudSync/cloudAuthRecovery'
    );

    seedLoggedOutState();

    const loginAttempts: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/auth/login')) {
        loginAttempts.push(url);
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: 'new-tok',
          refreshToken: 'new-r',
          userId: 'u1',
          deviceId: 'shared-device-id',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    // 复刻 backgroundCloudSync 的触发链：session 键变更事件 → 并发（不 await）
    // ensure-session 恢复——即四跑真机重登的竞态入口
    const recoveryRuns: Promise<unknown>[] = [];
    chrome.storage.onChanged.addListener((changes) => {
      if (changes[CLOUD_SESSION_STORAGE_KEY]) {
        recoveryRuns.push(recoverCloudAuthSession('ensure-session', { fetchImpl }));
      }
    });

    const { transport } = createMockCloudTransport();
    const facade = createExtensionCloudFacade({
      transport,
      platform: 'vitest-user-agent',
      setupAutoSyncAlarm: vi.fn(async () => undefined),
    });

    await facade.logout();
    await Promise.allSettled(recoveryRuns);

    // 修复后终态：无重登、无 'recovered' 通知、session 空、密码空、账号/地址保留
    expect(loginAttempts).toEqual([]);
    const snapshot = getChromeStorageSnapshot();
    expect(snapshot[CLOUD_SESSION_STORAGE_KEY]).toBeUndefined();
    const settings = snapshot[CLOUD_SETTINGS_STORAGE_KEY] as {
      accountPassword?: string;
      accountIdentifier?: string;
      baseUrl?: string;
    };
    expect(settings.accountPassword).toBe('');
    expect(settings.accountIdentifier).toBe('admin');
    expect(settings.baseUrl).toBe('http://mock');
    expect(snapshot['cloud_sync_auth_recovery_notice_v1']).toBeUndefined();
  });
});
