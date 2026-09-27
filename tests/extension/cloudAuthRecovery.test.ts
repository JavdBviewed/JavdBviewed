/**
 * @file cloudAuthRecovery.test.ts
 * @description Cloud 会话自恢复：凭已存账号密码自动重登、退避、通知去重与失效引导
 */
import { describe, expect, it, vi } from 'vitest';
import { SyncHttpError, type HttpTransport } from '@javdb/sync-client';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';
import { CLOUD_SETTINGS_STORAGE_KEY } from '../../apps/extension/src/features/cloudSync/cloudSettingsStorage';
import { CLOUD_SESSION_STORAGE_KEY } from '../../apps/extension/src/features/cloudSync/chromeTokenStore';

const RECOVERY_BACKOFF_KEY = 'cloud_sync_auth_recovery_backoff_v1';
const RECOVERY_NOTICE_KEY = 'cloud_sync_auth_recovery_notice_v1';

const BASE = 'http://127.0.0.1:18099';

const SETTINGS = {
  baseUrl: BASE,
  deviceLabel: '测试扩展',
  accountIdentifier: 'admin',
  accountPassword: 'pw-old',
  deviceId: 'device-1',
  updatedAt: 1,
};

function mockHttp(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
}

const RECOVERY_MODULE =
  '../../apps/extension/src/features/cloudSync/cloudAuthRecovery' as const;

describe('Cloud auth recovery', () => {
  it('already-authenticated: 会话仍在时不请求服务端', async () => {
    const { recoverCloudAuthSession } = await import(RECOVERY_MODULE);
    const fetchImpl = vi.fn();
    setChromeStorage({
      [CLOUD_SESSION_STORAGE_KEY]: {
        accessToken: 'at',
        refreshToken: 'rt',
        userId: 'u1',
        deviceId: 'device-1',
        savedAt: 1,
      },
    });
    const result = await recoverCloudAuthSession('test', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('already-authenticated');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no-credentials: 未保存账号密码时不请求服务端', async () => {
    const { recoverCloudAuthSession } = await import(RECOVERY_MODULE);
    const fetchImpl = vi.fn();
    setChromeStorage({
      [CLOUD_SETTINGS_STORAGE_KEY]: {
        ...SETTINGS,
        accountIdentifier: '',
        accountPassword: '',
      },
    });
    const result = await recoverCloudAuthSession('test', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('no-credentials');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('recovered: 凭已存凭据重登，写会话、清退避并发送恢复通知', async () => {
    const { recoverCloudAuthSession } = await import(RECOVERY_MODULE);
    const fetchImpl = mockHttp(200, {
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      userId: 'u1',
      deviceId: 'device-1',
      protocolVersion: 1,
    });
    setChromeStorage({
      [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS,
      // 已过期退避：允许再次尝试，成功时应被清除
      [RECOVERY_BACKOFF_KEY]: { kind: 'credentials-invalid', until: Date.now() - 1_000 },
      [RECOVERY_NOTICE_KEY]: { kind: 'credentials-invalid', at: 1 },
    });

    const result = await recoverCloudAuthSession('test', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('recovered');

    const snap = getChromeStorageSnapshot();
    expect(snap[CLOUD_SESSION_STORAGE_KEY].accessToken).toBe('new-at');
    expect(snap[CLOUD_SESSION_STORAGE_KEY].deviceId).toBe('device-1');
    expect(snap[RECOVERY_BACKOFF_KEY] ?? null).toBe(null);
    expect(snap[RECOVERY_NOTICE_KEY].kind).toBe('recovered');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe(`${BASE}/v1/auth/login`);
    const body = JSON.parse(init.body) as {
      identifier: string;
      device: { id: string; clientType: string };
    };
    expect(body.identifier).toBe('admin');
    expect(body.device).toMatchObject({ id: 'device-1', clientType: 'extension' });

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const opts = (chrome.notifications.create as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { title: string; message: string };
    expect(opts.title).toBe('Cloud 登录已恢复');
  });

  it('credentials-invalid: 401 时 30 分钟退避、不写会话、发送失效引导通知', async () => {
    const { recoverCloudAuthSession, CREDENTIALS_INVALID_MESSAGE } = await import(
      RECOVERY_MODULE
    );
    const fetchImpl = mockHttp(401, { message: 'invalid credentials' });
    setChromeStorage({ [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS });

    const result = await recoverCloudAuthSession('test', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('credentials-invalid');
    expect(result.detail).toBe(CREDENTIALS_INVALID_MESSAGE);

    const snap = getChromeStorageSnapshot();
    expect(snap[CLOUD_SESSION_STORAGE_KEY] ?? null).toBe(null);
    const backoff = snap[RECOVERY_BACKOFF_KEY] as { kind: string; until: number };
    expect(backoff.kind).toBe('credentials-invalid');
    expect(backoff.until).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
    expect(snap[RECOVERY_NOTICE_KEY].kind).toBe('credentials-invalid');

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const opts = (chrome.notifications.create as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { title: string; message: string };
    expect(opts.title).toBe('Cloud 登录已失效');
    expect(opts.message).toContain('更新账号密码');
  });

  it('suppressed: 退避期内不请求服务端', async () => {
    const { recoverCloudAuthSession } = await import(RECOVERY_MODULE);
    const fetchImpl = vi.fn();
    setChromeStorage({
      [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS,
      [RECOVERY_BACKOFF_KEY]: { kind: 'credentials-invalid', until: Date.now() + 60_000 },
    });
    const result = await recoverCloudAuthSession('test', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('suppressed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('network-error: 网络异常时 5 分钟短退避，不发「密码失效」通知', async () => {
    const { recoverCloudAuthSession } = await import(RECOVERY_MODULE);
    const netFetch = (async () => {
      throw new TypeError('failed to fetch');
    }) as unknown as typeof fetch;
    setChromeStorage({ [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS });

    const result = await recoverCloudAuthSession('test', {
      fetchImpl: netFetch,
    });
    expect(result.outcome).toBe('network-error');

    const snap = getChromeStorageSnapshot();
    const backoff = snap[RECOVERY_BACKOFF_KEY] as { kind: string; until: number };
    expect(backoff.kind).toBe('network-error');
    expect(backoff.until).toBeGreaterThan(Date.now());
    expect(backoff.until).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('429 限流按 network-error 处理，不误报「密码失效」', async () => {
    const { recoverCloudAuthSession } = await import(RECOVERY_MODULE);
    const fetchImpl = mockHttp(429, {
      message: 'too many failed login attempts; try again later',
    });
    setChromeStorage({ [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS });

    const result = await recoverCloudAuthSession('test', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('network-error');
    const snap = getChromeStorageSnapshot();
    const backoff = snap[RECOVERY_BACKOFF_KEY] as { kind: string; reason: string };
    expect(backoff.kind).toBe('network-error');
    expect(backoff.reason).toContain('限流');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('通知去重: 相同「密码失效」状态不重复通知', async () => {
    const { recoverCloudAuthSession } = await import(RECOVERY_MODULE);
    const fetchImpl = mockHttp(401, { message: 'invalid credentials' });
    setChromeStorage({
      [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS,
      // 上一次已通知过密码失效
      [RECOVERY_NOTICE_KEY]: { kind: 'credentials-invalid', at: 1 },
    });

    const result = await recoverCloudAuthSession('test', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('credentials-invalid');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('resetCloudAuthRecoveryState: 清除退避与通知去重状态', async () => {
    const { resetCloudAuthRecoveryState } = await import(RECOVERY_MODULE);
    setChromeStorage({
      [RECOVERY_BACKOFF_KEY]: { kind: 'credentials-invalid', until: Date.now() + 60_000 },
      [RECOVERY_NOTICE_KEY]: { kind: 'credentials-invalid', at: 1 },
    });
    await resetCloudAuthRecoveryState();
    const snap = getChromeStorageSnapshot();
    expect(snap[RECOVERY_BACKOFF_KEY] ?? null).toBe(null);
    expect(snap[RECOVERY_NOTICE_KEY] ?? null).toBe(null);
  });

  it('facade.login 成功后重置恢复状态（用户改密重登后，后续失效可重新通知）', async () => {
    const { createMockCloudTransport } = await import('@javdb/sync-client');
    const { createExtensionCloudFacade } = await import(
      '../../apps/extension/src/features/cloudSync/extensionCloudFacade'
    );
    const { transport } = createMockCloudTransport();
    const facade = createExtensionCloudFacade({
      transport,
      platform: 'test',
      setupAutoSyncAlarm: vi.fn(async () => undefined),
    });
    setChromeStorage({
      [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS,
      [RECOVERY_BACKOFF_KEY]: { kind: 'credentials-invalid', until: Date.now() + 60_000 },
      [RECOVERY_NOTICE_KEY]: { kind: 'credentials-invalid', at: 1 },
    });

    await facade.register({ identifier: 'admin', password: 'pw-old' });
    const state = await facade.login({ identifier: 'admin', password: 'pw-old' });
    expect(state.loggedIn).toBe(true);

    const snap = getChromeStorageSnapshot();
    expect(snap[RECOVERY_BACKOFF_KEY] ?? null).toBe(null);
    expect(snap[RECOVERY_NOTICE_KEY] ?? null).toBe(null);
  });

  it('接线: auth 失败（401 且无 refresh token）触发自动恢复（fire-and-forget）', async () => {
    // 真实网络失败（本地无服务）→ network-error 退避落盘，可观测恢复确实被触发
    vi.useRealTimers();
    const { createExtensionCloudClient } = await import(
      '../../apps/extension/src/features/cloudSync/createExtensionCloudClient'
    );
    setChromeStorage({ [CLOUD_SETTINGS_STORAGE_KEY]: SETTINGS });
    const failingTransport: HttpTransport = {
      async request<T>(): Promise<T> {
        throw new SyncHttpError(401, 'unauthorized');
      },
    };
    const { api } = await createExtensionCloudClient(SETTINGS, {
      transport: failingTransport,
    });
    await expect(api.listDevices()).rejects.toBeInstanceOf(SyncHttpError);

    let snap = getChromeStorageSnapshot();
    for (let i = 0; i < 100 && !snap[RECOVERY_BACKOFF_KEY]; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      snap = getChromeStorageSnapshot();
    }
    const backoff = snap[RECOVERY_BACKOFF_KEY] as { kind: string };
    expect(backoff).toBeTruthy();
    expect(backoff.kind).toBe('network-error');
  });
});
