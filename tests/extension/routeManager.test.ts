/**
 * @file routeManager.test.ts
 * @description RouteManager remote config 测试
 * @module tests/extension
 */
import { describe, expect, it, vi } from 'vitest';
import manifest from '../../apps/extension/src/manifest.json';
import { DEFAULT_SETTINGS } from '../../apps/extension/src/utils/config';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';

describe('RouteManager remote config', () => {
  it('updates routes from the server config endpoint before falling back to legacy routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        updatedAt: '2026-05-27T00:00:00.000Z',
        routes: {
          javdb: {
            primary: 'https://javdb.com',
            alternatives: [
              {
                url: 'https://javdb-server-alt.example',
                status: 'active',
                description: 'server route',
              },
            ],
          },
          javbus: {
            primary: 'https://www.javbus.com',
            alternatives: [],
          },
        },
        announcements: [],
        updatePolicy: {
          latestVersion: '1.20.2',
          minimumVersion: '1.18.0',
          releaseUrl: 'https://github.com/JavdBviewed/JavdBviewed-release/releases/latest',
        },
        featureFlags: {
          telemetryRequired: true,
          remoteRoutesEnabled: true,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    setChromeStorage({
      settings: {
        ...DEFAULT_SETTINGS,
        routes: {
          ...(DEFAULT_SETTINGS as any).routes,
          javdb: {
            ...(DEFAULT_SETTINGS as any).routes.javdb,
            alternatives: [
              {
                url: 'https://user-route.example',
                enabled: true,
                description: 'user custom',
                addedAt: 1,
              },
            ],
          },
        },
      },
    });

    const { SERVER_ENDPOINT_STATE_KEY } = await import('../../apps/extension/src/platform/network');
    setChromeStorage({
      [SERVER_ENDPOINT_STATE_KEY]: {
        apiBaseUrl: 'https://resolved-api.example',
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    });

    const { RouteManager } = await import('../../apps/extension/src/features/routeManagement');

    await expect(RouteManager.getInstance().checkAndUpdateRoutes(true)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://resolved-api.example/v1/config?channel=stable&version=${manifest.version}&platform=unknown&locale=en-US`,
      expect.objectContaining({
        cache: 'no-cache',
      }),
    );
    const settings = getChromeStorageSnapshot().settings;
    expect(settings.routes.javdb.alternatives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: 'https://javdb-server-alt.example',
        enabled: true,
        description: 'server route',
      }),
      expect.objectContaining({
        url: 'https://user-route.example',
        enabled: true,
        description: 'user custom',
      }),
    ]));
  });

  it('rejects server config updates when checksum validation fails', async () => {
    const tamperedConfig = {
      schemaVersion: 1,
      updatedAt: '2026-05-27T00:00:00.000Z',
      routes: {
        javdb: {
          primary: 'https://tampered.example',
          alternatives: [],
        },
        javbus: {
          primary: 'https://www.javbus.com',
          alternatives: [],
        },
      },
      announcements: [],
      updatePolicy: {
        latestVersion: '1.20.2',
        minimumVersion: '1.18.0',
        releaseUrl: 'https://github.com/JavdBviewed/JavdBviewed-release/releases/latest',
      },
      featureFlags: {
        telemetryRequired: true,
        remoteRoutesEnabled: true,
      },
    };
    const configBody = JSON.stringify(tamperedConfig);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => name.toLowerCase() === 'x-config-checksum' ? 'bad-checksum' : null,
      },
      text: async () => configBody,
      json: async () => tamperedConfig,
    });
    vi.stubGlobal('fetch', fetchMock);
    const { SERVER_ENDPOINT_STATE_KEY } = await import('../../apps/extension/src/platform/network');
    setChromeStorage({
      settings: DEFAULT_SETTINGS,
      [SERVER_ENDPOINT_STATE_KEY]: {
        apiBaseUrl: 'https://resolved-api.example',
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    });

    const { RouteManager } = await import('../../apps/extension/src/features/routeManagement');

    await expect(RouteManager.getInstance().checkAndUpdateRoutes(true)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getChromeStorageSnapshot().settings.routes.javdb.primary).toBe(DEFAULT_SETTINGS.routes?.javdb.primary);
  });
});
