/**
 * @file cloudSyncFacade.test.ts
 * @description Cloud facade 契约：UI 只依赖清晰状态/动作，不直接拼 API 细节
 */
import { describe, expect, it, vi } from 'vitest';
import { createMockCloudTransport } from '@javdb/sync-client';
import { accountEntityTypesFromMatrix } from '@javdb/sync-protocol';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';
import { CLOUD_SESSION_STORAGE_KEY } from '../../apps/extension/src/features/cloudSync/chromeTokenStore';
import { CLOUD_SETTINGS_STORAGE_KEY } from '../../apps/extension/src/features/cloudSync/cloudSettingsStorage';

describe('Cloud sync extension facade', () => {
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

    await facade.logout();
    expect(getChromeStorageSnapshot()[CLOUD_SESSION_STORAGE_KEY]).toBeUndefined();
    const afterLogout = await facade.loadState();
    expect(afterLogout.loggedIn).toBe(false);
    expect(afterLogout.devices).toEqual([]);
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
