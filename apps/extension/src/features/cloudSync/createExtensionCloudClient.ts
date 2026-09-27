/**
 * @file createExtensionCloudClient.ts
 * @description 组装扩展侧 Cloud API 客户端
 * @module features/cloudSync
 */
import { createApiClient, type ApiClient, type HttpTransport } from '@javdb/sync-client';
import { createChromeTokenStore } from './chromeTokenStore';
import { loadCloudSettings, type CloudConnectionSettings } from './cloudSettingsStorage';
import { chromeRefreshCoordinator } from './chromeRefreshCoordinator';
import { recoverCloudAuthSession } from './cloudAuthRecovery';

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
    // 会话彻底失效（refresh 失败，令牌已清空）→ 凭已存凭据自动恢复。
    // fire-and-forget：不阻断当前调用；内部有跨上下文锁与退避，详见 cloudAuthRecovery.ts
    onAuthFailure: () => {
      void recoverCloudAuthSession('auth-failure').catch((e) => {
        console.warn('[CloudSync] auth recovery failed', e);
      });
    },
  });
  return { api, settings: s };
}
