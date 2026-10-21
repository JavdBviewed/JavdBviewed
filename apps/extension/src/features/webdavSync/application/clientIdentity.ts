/**
 * @file clientIdentity.ts
 * @description clientIdentity
 * @module features/webdavSync
 */
import type { WebDAVClientProfile } from '../domain/types';
import { saveSettingsSectionDelta } from '../../../utils/settingsDelta';

export interface WebDAVSettingsAdapter {
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  /**
   * 原始读取 settings 存储值（不合并默认值）。
   * 可选：提供后，身份补写只把自身 delta 合并到最新原始值上写回，
   * 避免 SW 启动窗口内用全默认值实例覆盖并发写入的其他节（读-改-写竞态）。
   * 未提供时保持旧行为（merged 视图全量写回）。
   */
  readRawSettings?: () => Promise<Partial<any> | null | undefined>;
}

const UUID_BYTE_LENGTH = 16;

export function createUuidLike(): string {
  try {
    const cryptoProvider = globalThis.crypto;
    if (typeof cryptoProvider?.randomUUID === 'function') {
      return cryptoProvider.randomUUID();
    }
  } catch {}

  return formatUuidFromBytes(getRandomUuidBytes());
}

function getRandomUuidBytes(): Uint8Array {
  try {
    const cryptoProvider = globalThis.crypto;
    if (typeof cryptoProvider?.getRandomValues === 'function') {
      const bytes = new Uint8Array(UUID_BYTE_LENGTH);
      cryptoProvider.getRandomValues(bytes);
      return bytes;
    }
  } catch {}

  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function formatUuidFromBytes(sourceBytes: Uint8Array): string {
  const bytes = new Uint8Array(sourceBytes.slice(0, UUID_BYTE_LENGTH));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function detectBrowserName(): string {
  try {
    const ua = navigator.userAgent || '';
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua)) return 'Opera';
    if (/Brave\//i.test(ua)) return 'Brave';
    if (/Chrome\//i.test(ua)) return 'Chrome';
  } catch {}
  return 'Unknown Chromium';
}

export function getPlatformName(): string {
  try {
    const platform = navigator.platform || '';
    return platform || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest()?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function sanitizeDeviceLabel(value: string): string {
  const trimmed = String(value || '').trim();
  return trimmed || detectBrowserName();
}

type IdentityAnyRecord = Record<string, any>;

function readWebDAVSection(base: IdentityAnyRecord | null | undefined): IdentityAnyRecord {
  const section = (base as IdentityAnyRecord | null | undefined)?.webdav;
  return section && typeof section === 'object' && !Array.isArray(section) ? (section as IdentityAnyRecord) : {};
}

function buildMissingIdentityDelta(webdav: IdentityAnyRecord): IdentityAnyRecord | null {
  const delta: IdentityAnyRecord = {};
  if (!webdav.clientId) delta.clientId = createUuidLike();
  if (!webdav.clientInstalledAt) delta.clientInstalledAt = new Date().toISOString();
  const detectedBrowser = detectBrowserName();
  if (!webdav.browserName) delta.browserName = detectedBrowser;
  if (!webdav.deviceLabel) delta.deviceLabel = detectedBrowser;
  return Object.keys(delta).length > 0 ? delta : null;
}

async function readRawSettingsSafe(adapter: WebDAVSettingsAdapter): Promise<IdentityAnyRecord | null | undefined> {
  if (typeof adapter.readRawSettings !== 'function') return undefined;
  try {
    const raw = await adapter.readRawSettings();
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as IdentityAnyRecord) : null;
  } catch {
    // 原始读失败时退回旧路径（merged 视图全量写回），保证可用性
    return undefined;
  }
}

/**
 * 补全 WebDAV 客户端身份字段（clientId/clientInstalledAt/browserName/deviceLabel）。
 *
 * 竞态安全说明（10-21：迁移 section delta 原语，修复 SW 启动期整包写覆盖并发写入的问题）：
 * - “缺哪些字段”基于原始存储值（readRawSettings）判别，绝不把 getSettings() 的
 *   全默认值实例写回（那会覆盖启动窗口内并发写入的其他节）；
 * - 缺失判据在写前预检重读一次：并发窗口内身份字段已完整落盘则零写
 *   （直接返回 merged 视图，保持返回契约）；
 * - 仍需写时经 saveSettingsSectionDelta（section=webdav）落盘：写前紧贴重读原始值，
 *   delta 对 latestSection 动态计算（并发落盘的身份字段不会重复生成/覆盖），
 *   只合并 webdav 节，钩子对新鲜 prev 无墓碑副作用；
 * - 原始读不可用（adapter 未实现 / 抛错）时由原语回退链保持旧行为。
 */
export async function ensureWebDAVClientIdentity(adapter: WebDAVSettingsAdapter): Promise<any> {
  const rawBase = await readRawSettingsSafe(adapter);
  const hasRaw = rawBase !== undefined;
  const base = hasRaw ? (rawBase ?? {}) : ((await adapter.getSettings()) as IdentityAnyRecord);

  const delta = buildMissingIdentityDelta(readWebDAVSection(base));
  if (!delta) {
    return hasRaw ? adapter.getSettings() : base;
  }

  // 写前预检重读：并发窗口内身份字段已完整落盘则零写（不冗余写回、不覆盖并发值）
  if (hasRaw) {
    const freshRaw = await readRawSettingsSafe(adapter);
    if (freshRaw !== undefined && freshRaw !== null && !buildMissingIdentityDelta(readWebDAVSection(freshRaw))) {
      return adapter.getSettings();
    }
  }

  // 返回契约保持：raw 可用时返回写后新鲜 merged 视图；旧路径（raw 不可用）返回实际写入对象
  const written = await saveSettingsSectionDelta(
    {
      readRawSettings: adapter.readRawSettings,
      getMergedSettings: adapter.getSettings,
      saveSettings: adapter.saveSettings,
    },
    base,
    'webdav',
    (latestSection) => buildMissingIdentityDelta(latestSection) ?? {},
  );
  return hasRaw ? adapter.getSettings() : written;
}

export function getWebDAVClientProfile(settings: any, overrides?: Partial<WebDAVClientProfile>): WebDAVClientProfile {
  const webdav = settings?.webdav || {};
  const resolvedClientId = String(overrides?.clientId || webdav.clientId || createUuidLike()).trim();
  return {
    clientId: resolvedClientId,
    deviceLabel: sanitizeDeviceLabel(String(overrides?.deviceLabel || webdav.deviceLabel || '')),
    browserName: String(overrides?.browserName || webdav.browserName || detectBrowserName()).trim() || 'Unknown Chromium',
    platform: String(overrides?.platform || getPlatformName()).trim(),
    extensionVersion: String(overrides?.extensionVersion || getExtensionVersion()).trim(),
    installedAt: String(overrides?.installedAt || webdav.clientInstalledAt || new Date().toISOString()),
    lastSeenAt: String(overrides?.lastSeenAt || webdav.clientLastSeenAt || '').trim() || undefined,
    lastSyncAt: String(overrides?.lastSyncAt || webdav.clientLastSyncAt || '').trim() || undefined,
    lastSyncStatus: (overrides?.lastSyncStatus || webdav.clientLastSyncStatus || undefined) as any,
    lastUploadId: String(overrides?.lastUploadId || webdav.clientLastUploadId || '').trim() || undefined,
    disabled: overrides?.disabled || false,
  };
}
