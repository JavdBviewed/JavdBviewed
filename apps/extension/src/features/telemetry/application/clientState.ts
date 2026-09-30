/**
 * @file clientState.ts
 * @description clientState
 * @module features/telemetry
 */
import type { TelemetryClientState } from '../domain/types';

export const TELEMETRY_CLIENT_STATE_KEY = 'telemetry_client_state';

export async function getTelemetryClientState(settings?: any, now = new Date()): Promise<TelemetryClientState> {
  const state = await peekTelemetryClientState(settings, now);
  await writeTelemetryClientState(state);
  return state;
}

/**
 * 只读窥视客户端状态：与 getTelemetryClientState 同源，但不回写 storage。
 * 供「遥测数据查看器」等预览路径使用，保证查看动作本身不改变会话/安装标识。
 */
export async function peekTelemetryClientState(settings?: any, now = new Date()): Promise<TelemetryClientState> {
  const raw = await chrome.storage.local
    .get(TELEMETRY_CLIENT_STATE_KEY)
    .catch(() => ({} as Record<string, unknown>));
  const stored = normalizeClientState((raw as Record<string, unknown>)[TELEMETRY_CLIENT_STATE_KEY]);

  return {
    installId: stored.installId || resolveInitialInstallId(settings),
    sessionId: stored.sessionId || createId('session'),
    sessionStartedAt: stored.sessionStartedAt || now.toISOString(),
    lastStartupAt: stored.lastStartupAt,
    lastHeartbeatAt: stored.lastHeartbeatAt,
    lastSuccessAt: stored.lastSuccessAt,
  };
}

export async function writeTelemetryClientState(state: TelemetryClientState): Promise<void> {
  await chrome.storage.local.set({
    [TELEMETRY_CLIENT_STATE_KEY]: removeUndefined({
      installId: normalizeId(state.installId) || createId('install'),
      sessionId: normalizeId(state.sessionId) || createId('session'),
      sessionStartedAt: normalizeIso(state.sessionStartedAt) || new Date().toISOString(),
      lastStartupAt: normalizeNumber(state.lastStartupAt),
      lastHeartbeatAt: normalizeNumber(state.lastHeartbeatAt),
      lastSuccessAt: normalizeNumber(state.lastSuccessAt),
    }),
  });
}

export function createTelemetryEventId(): string {
  return createId('event');
}

function resolveInitialInstallId(settings?: any): string {
  const webdavClientId = normalizeId(settings?.webdav?.clientId);
  if (webdavClientId) return webdavClientId;
  return createId('install');
}

function normalizeClientState(value: unknown): Partial<TelemetryClientState> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Partial<TelemetryClientState>;
  return removeUndefined({
    installId: normalizeId(raw.installId),
    sessionId: normalizeId(raw.sessionId),
    sessionStartedAt: normalizeIso(raw.sessionStartedAt),
    lastStartupAt: normalizeNumber(raw.lastStartupAt),
    lastHeartbeatAt: normalizeNumber(raw.lastHeartbeatAt),
    lastSuccessAt: normalizeNumber(raw.lastSuccessAt),
  });
}

function normalizeId(value: unknown): string | undefined {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 200) return undefined;
  return text;
}

function normalizeIso(value: unknown): string | undefined {
  const text = String(value || '').trim();
  if (!text || Number.isNaN(Date.parse(text))) return undefined;
  return new Date(text).toISOString();
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function removeUndefined<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
