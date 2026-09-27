/**
 * @file cloudSyncFacade.test.ts
 * @description Cloud facade 契约：UI 只依赖清晰状态/动作，不直接拼 API 细节
 */
import { describe, expect, it, vi } from 'vitest';
import { createMockCloudTransport } from '@javdb/sync-client';
import { accountEntityTypesFromMatrix } from '@javdb/sync-protocol';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';
import { CLOUD_SETTINGS_STORAGE_KEY } from '../../apps/extension/src/features/cloudSync/cloudSettingsStorage';

describe('Cloud sync extension facade', () => {
  it('keeps Cloud credentials as the only extension connection path', async () => {
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const facade = createExtensionCloudFacade();

    expect('logout' in facade).toBe(false);
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

  it('exposes state and credential login without leaking API client wiring to UI', async () => {
    const { transport } = createMockCloudTransport();
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const facade = createExtensionCloudFacade({
      transport,
      platform: 'vitest-user-agent',
      setupAutoSyncAlarm: vi.fn(async () => undefined),
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
    const { CLOUD_SESSION_STORAGE_KEY } = await import(
      '../../apps/extension/src/features/cloudSync/chromeTokenStore'
    );
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
