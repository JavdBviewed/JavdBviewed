/**
 * @file extensionCloudFacade.test.ts
 * @description Cloud 版本端点拉取（/version）静默降级回归
 * @module features/cloudSync
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  loadSession: vi.fn(),
  loadAutoSync: vi.fn(),
}));

vi.mock('./cloudSettingsStorage', () => ({
  loadCloudSettings: mocks.loadSettings,
  normalizeCloudBaseUrl: (v: string) => (v ? String(v).replace(/\/+$/, '') : ''),
  saveCloudSettings: vi.fn(),
  createDefaultCloudSettings: () => ({
    baseUrl: 'http://127.0.0.1:18080',
    deviceLabel: '浏览器扩展',
    accountIdentifier: '',
    accountPassword: '',
    deviceId: 'd-1',
    updatedAt: 0,
  }),
}));
vi.mock('./chromeTokenStore', () => ({ loadCloudSession: mocks.loadSession }));
vi.mock('./autoSyncSettings', () => ({ loadCloudAutoSyncSettings: mocks.loadAutoSync }));
vi.mock('./createExtensionCloudClient', () => ({ createExtensionCloudClient: vi.fn() }));

import { createExtensionCloudFacade } from './extensionCloudFacade';

function makeFetch(status: number, body: unknown): typeof fetch {
  return (vi.fn(async (url: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    url: String(url),
  })) as unknown) as typeof fetch;
}

function makeFacade(fetchImpl: typeof fetch) {
  return createExtensionCloudFacade({
    fetchImpl,
    transport: {} as never,
    setupAutoSyncAlarm: async () => {},
    // 本文件只测 /version；syncNow 不会被调用，类型占位即可。
    syncNow: (vi.fn() as unknown) as () => Promise<never>,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.loadSettings.mockResolvedValue({
    baseUrl: 'http://127.0.0.1:18080',
    deviceLabel: '浏览器扩展',
    accountIdentifier: '',
    accountPassword: '',
    deviceId: 'd-1',
    updatedAt: 0,
  });
});

describe('fetchCloudVersion', () => {
  it('parses /version payload and keeps shortCommit', async () => {
    const fetchImpl = makeFetch(200, {
      version: 'v1.4.2',
      commit: 'abcdef1234567890',
      shortCommit: 'abcdef12',
      buildNumber: '42',
      buildTime: '2026-08-27T10:00:00Z',
      dirty: false,
      obfuscated: true,
      releaseChannel: 'stable',
      protocolVersion: 3,
    });
    const facade = makeFacade(fetchImpl as typeof fetch);
    const info = await facade.fetchCloudVersion('http://127.0.0.1:18080');
    expect(info).toEqual({
      version: 'v1.4.2',
      shortCommit: 'abcdef12',
      buildNumber: '42',
      buildTime: '2026-08-27T10:00:00Z',
      releaseChannel: 'stable',
      protocolVersion: 3,
    });
    const called = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(called).toBe('http://127.0.0.1:18080/version');
  });

  it('returns null on non-2xx response', async () => {
    const facade = makeFacade(makeFetch(404, { error: 'not found' }) as typeof fetch);
    expect(await facade.fetchCloudVersion('http://127.0.0.1:18080')).toBeNull();
  });

  it('returns null when payload has no version field', async () => {
    const facade = makeFacade(makeFetch(200, { protocolVersion: 3 }) as typeof fetch);
    expect(await facade.fetchCloudVersion('http://127.0.0.1:18080')).toBeNull();
  });

  it('returns null on network failure without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const facade = makeFacade(fetchImpl);
    expect(await facade.fetchCloudVersion('http://127.0.0.1:18080')).toBeNull();
  });

  it('returns null when no valid base url is configured', async () => {
    mocks.loadSettings.mockResolvedValue({
      baseUrl: '',
      deviceLabel: '浏览器扩展',
      accountIdentifier: '',
      accountPassword: '',
      deviceId: 'd-1',
      updatedAt: 0,
    });
    const fetchImpl = makeFetch(200, { version: 'v1.0.0' }) as typeof fetch;
    const facade = makeFacade(fetchImpl);
    expect(await facade.fetchCloudVersion()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
