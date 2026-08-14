/**
 * @file createExtensionCloudClient.ts
 * @description 组装扩展侧 Cloud API 客户端
 * @module features/cloudSync
 */
import { createApiClient, type ApiClient, type HttpTransport } from '@javdb/sync-client';
import { createChromeTokenStore } from './chromeTokenStore';
import { loadCloudSettings, type CloudConnectionSettings } from './cloudSettingsStorage';
import { chromeRefreshCoordinator } from './chromeRefreshCoordinator';

export type ExtensionCloudClientOptions = {
  transport?: HttpTransport;
};

export async function createExtensionCloudClient(
  settings?: CloudConnectionSettings,
  options: ExtensionCloudClientOptions = {},
): Promise<{ api: ApiClient; settings: CloudConnectionSettings }> {
  const s = settings ?? (await loadCloudSettings());
  const tokens = createChromeTokenStore({
    getDeviceId: () => s.deviceId,
  });
  const api = createApiClient({
    baseUrl: s.baseUrl,
    tokens,
    transport: options.transport,
    refreshCoordinator: chromeRefreshCoordinator,
  });
  return { api, settings: s };
}
