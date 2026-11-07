/** 会话上传与解锁只能在同一 Cloud 连接、账号和设备下继续。 */
import { loadCloudSettings, normalizeCloudBaseUrl, type CloudConnectionSettings } from './cloudSettingsStorage';
import { loadCloudSession } from './chromeTokenStore';

export type CloudVaultIdentity = Pick<CloudConnectionSettings, 'baseUrl' | 'accountIdentifier' | 'accountPassword' | 'deviceId'> & { userId: string };

export async function isCurrentCloudVaultIdentity(expected: CloudVaultIdentity): Promise<boolean> {
  const [settings, session] = await Promise.all([loadCloudSettings(), loadCloudSession()]);
  return Boolean(session?.accessToken && expected.userId &&
    normalizeCloudBaseUrl(settings.baseUrl) === normalizeCloudBaseUrl(expected.baseUrl) &&
    settings.accountIdentifier.trim() === expected.accountIdentifier.trim() &&
    settings.accountPassword === expected.accountPassword && settings.deviceId === expected.deviceId &&
    session.userId === expected.userId && session.deviceId === expected.deviceId);
}
