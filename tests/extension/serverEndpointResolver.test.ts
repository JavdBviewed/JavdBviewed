/**
 * @file serverEndpointResolver.test.ts
 * @description 服务端入口解析与 bootstrap 容灾测试
 * @module tests/extension
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'checksum')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nextValue]) => `${JSON.stringify(key)}:${stableStringify(nextValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksumFor(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function bootstrap(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const payload = {
    schemaVersion: 1,
    updatedAt: '2026-07-04T00:00:00.000Z',
    ttlSeconds: 3600,
    apiBaseUrls: [
      {
        url: 'https://api-from-bootstrap.example',
        priority: 10,
        status: 'active',
      },
    ],
    configPath: '/v1/config',
    telemetryPath: '/v1/telemetry/report',
    ...overrides,
  };
  return {
    ...payload,
    checksum: checksumFor(payload),
  };
}

describe('serverEndpointResolver', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('provides Web Crypto SHA-256 for bootstrap checksum verification', async () => {
    const { verifyJsonChecksum } = await import('../../apps/extension/src/platform/network/serverEndpointResolver');
    const document = bootstrap();

    expect(globalThis.crypto?.subtle).toBeDefined();
    await expect(verifyJsonChecksum(document, document.checksum)).resolves.toBe(true);
  });

  it('builds service URLs from the last known good API base without fetching bootstrap', async () => {
    const { SERVER_ENDPOINT_STATE_KEY, buildServerApiUrl } = await import('../../apps/extension/src/platform/network/serverEndpointResolver');
    setChromeStorage({
      [SERVER_ENDPOINT_STATE_KEY]: {
        apiBaseUrl: 'https://cached-api.example',
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildServerApiUrl('/v1/config', { channel: 'stable' })).resolves.toBe(
      'https://cached-api.example/v1/config?channel=stable',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to GitHub bootstrap when the primary bootstrap source fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(bootstrap()) });
    vi.stubGlobal('fetch', fetchMock);

    const { GITHUB_BOOTSTRAP_URL, PRIMARY_BOOTSTRAP_URL, SERVER_ENDPOINT_STATE_KEY, refreshServerEndpoint } = await import(
      '../../apps/extension/src/platform/network/serverEndpointResolver'
    );

    expect(GITHUB_BOOTSTRAP_URL).toBe(
      'https://raw.githubusercontent.com/JavdBviewed/JavdBviewed/main/public/bootstrap.json',
    );

    await expect(refreshServerEndpoint({ force: true })).resolves.toMatchObject({
      apiBaseUrl: 'https://api-from-bootstrap.example',
      source: GITHUB_BOOTSTRAP_URL,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, PRIMARY_BOOTSTRAP_URL, expect.objectContaining({ cache: 'no-cache' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, GITHUB_BOOTSTRAP_URL, expect.objectContaining({ cache: 'no-cache' }));
    expect(getChromeStorageSnapshot()[SERVER_ENDPOINT_STATE_KEY]).toEqual(expect.objectContaining({
      apiBaseUrl: 'https://api-from-bootstrap.example',
      source: GITHUB_BOOTSTRAP_URL,
    }));
  });

  it('rejects bootstrap updates when checksum validation fails', async () => {
    const invalidBootstrap = bootstrap({ apiBaseUrls: [{ url: 'https://tampered.example', priority: 10, status: 'active' }] });
    invalidBootstrap.checksum = 'bad-checksum';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(invalidBootstrap) });
    vi.stubGlobal('fetch', fetchMock);

    const { SERVER_ENDPOINT_STATE_KEY, refreshServerEndpoint } = await import('../../apps/extension/src/platform/network/serverEndpointResolver');

    await expect(refreshServerEndpoint({ force: true })).resolves.toMatchObject({
      apiBaseUrl: 'https://jbd-server.we-together.club',
      source: 'default',
    });
    expect(getChromeStorageSnapshot()[SERVER_ENDPOINT_STATE_KEY]).toBeUndefined();
  });

  it('uses stale last known good endpoint without fetching while retry backoff is active', async () => {
    vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'));
    const now = Date.now();
    const { SERVER_ENDPOINT_STATE_KEY, buildServerApiUrl } = await import('../../apps/extension/src/platform/network/serverEndpointResolver');
    setChromeStorage({
      [SERVER_ENDPOINT_STATE_KEY]: {
        apiBaseUrl: 'https://cached-api.example',
        source: 'test-cache',
        updatedAt: now - 7_200_000,
        expiresAt: now - 1_000,
        failureCount: 2,
        nextRetryAt: now + 60_000,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildServerApiUrl('/v1/config')).resolves.toBe('https://cached-api.example/v1/config');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records exponential backoff after consecutive bootstrap failures with stale cache', async () => {
    vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'));
    const now = Date.now();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { SERVER_ENDPOINT_STATE_KEY, refreshServerEndpoint } = await import('../../apps/extension/src/platform/network/serverEndpointResolver');
    setChromeStorage({
      [SERVER_ENDPOINT_STATE_KEY]: {
        apiBaseUrl: 'https://cached-api.example',
        source: 'test-cache',
        updatedAt: now - 7_200_000,
        expiresAt: now - 1_000,
        failureCount: 1,
      },
    });

    await expect(refreshServerEndpoint({ force: true })).resolves.toMatchObject({
      apiBaseUrl: 'https://cached-api.example',
      failureCount: 2,
      nextRetryAt: now + 120_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getChromeStorageSnapshot()[SERVER_ENDPOINT_STATE_KEY]).toEqual(expect.objectContaining({
      apiBaseUrl: 'https://cached-api.example',
      failureCount: 2,
      nextRetryAt: now + 120_000,
    }));
  });
});
