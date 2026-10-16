/**
 * @file cloudSettingsStorage.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCloudSettings, normalizeCloudBaseUrl } from './cloudSettingsStorage';

describe('normalizeCloudBaseUrl', () => {
  it('strips trailing slash and accepts host without scheme', () => {
    expect(normalizeCloudBaseUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
    expect(normalizeCloudBaseUrl('http://127.0.0.1:18080/')).toBe('http://127.0.0.1:18080');
    expect(normalizeCloudBaseUrl('127.0.0.1:8080')).toMatch(/127\.0\.0\.1:8080/);
  });
});

describe('createDefaultCloudSettings', () => {
  it('reuses shared device id when provided', () => {
    const s = createDefaultCloudSettings('shared-webdav-id');
    expect(s.deviceId).toBe('shared-webdav-id');
    expect(s.baseUrl).toContain('18080');
  });
});

describe('saveCloudSettings sync cursor handling', () => {
  let storedValues: Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    storedValues = {
      cloud_sync_settings_v1: {
        baseUrl: 'http://127.0.0.1:18091',
        deviceLabel: '浏览器扩展',
        accountIdentifier: 'admin',
        accountPassword: 'test-password',
        deviceId: 'device-x',
        updatedAt: 1,
      },
      cloud_sync_cursors_v1: { storage_item: 829, video: 77 },
    };
    const storageGet = vi.fn((_keys: string[], callback: (items: Record<string, unknown>) => void) => {
      queueMicrotask(() => callback(structuredClone(storedValues)));
    });
    const storageSet = vi.fn((items: Record<string, unknown>, callback: () => void) => {
      queueMicrotask(() => {
        storedValues = { ...storedValues, ...structuredClone(items) };
        callback();
      });
    });
    const storageRemove = vi.fn((keys: string[], callback: () => void) => {
      queueMicrotask(() => {
        for (const k of keys) delete storedValues[k];
        callback();
      });
    });
    vi.stubGlobal('chrome', { storage: { local: { get: storageGet, set: storageSet, remove: storageRemove } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears sync cursors when the connection identity (baseUrl/accountIdentifier) changes', async () => {
    const { saveCloudSettings } = await import('./cloudSettingsStorage');
    await saveCloudSettings({ baseUrl: 'http://127.0.0.1:18092', accountIdentifier: 'other' });
    expect(storedValues['cloud_sync_cursors_v1']).toBeUndefined();
  });

  it('keeps sync cursors when the same account connection is re-saved', async () => {
    const { saveCloudSettings } = await import('./cloudSettingsStorage');
    await saveCloudSettings({ deviceLabel: '新设备名' });
    expect(storedValues['cloud_sync_cursors_v1']).toEqual({ storage_item: 829, video: 77 });
  });
});
