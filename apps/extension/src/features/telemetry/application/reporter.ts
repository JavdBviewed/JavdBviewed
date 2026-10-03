/**
 * @file reporter.ts
 * @description reporter
 * @module features/telemetry
 */
import { getSettings } from '../../../utils/storage';
import { buildTelemetryReportUrl } from '../../../platform/network';
import { TELEMETRY_REPORT_ENDPOINT } from '../../../utils/config';
import type { TelemetryErrorPayload, TelemetryEventType, TelemetryReportResult } from '../domain/types';
import { getTelemetryClientState, writeTelemetryClientState } from './clientState';
import { buildTelemetryPayload } from './buildTelemetryPayload';
import { sendTelemetry } from '../infrastructure/telemetryClient';
import { buildTelemetryErrorPayload, type BuildTelemetryErrorPayloadInput } from './errorPayload';

export const TELEMETRY_HEARTBEAT_ALARM = 'telemetry.heartbeat';
const HEARTBEAT_INTERVAL_MINUTES = 360;
const STARTUP_THROTTLE_MS = 30 * 60 * 1000;
const HEARTBEAT_THROTTLE_MS = 6 * 60 * 60 * 1000;
const ERROR_REPORT_THROTTLE_MS = 15 * 60 * 1000;
const errorReportLastSentAt = new Map<string, number>();

export interface ReportTelemetryEventOptions {
  settings?: any;
  fetchImpl?: typeof fetch;
  now?: Date;
  force?: boolean;
  error?: TelemetryErrorPayload;
}

export async function initializeTelemetryReporter(): Promise<void> {
  const settings = await getSettings();
  syncTelemetryHeartbeatAlarm(settings);
  await reportTelemetryEvent('startup', { settings }).catch(() => ({ sent: false, reason: 'network-error' }));
}

export async function handleTelemetryAlarm(name: string): Promise<boolean> {
  if (name !== TELEMETRY_HEARTBEAT_ALARM) return false;
  await reportTelemetryEvent('heartbeat');
  return true;
}

export function syncTelemetryHeartbeatAlarm(settings?: any): void {
  try {
    if (!chrome?.alarms) return;
    // 2026-10-03 10-11 线裁决：使用即上报，legacy enabled 不再作为发送门禁
    const endpoint = String(settings?.telemetry?.endpoint || '').trim();
    if (!endpoint) {
      chrome.alarms.clear(TELEMETRY_HEARTBEAT_ALARM);
      return;
    }

    chrome.alarms.get(TELEMETRY_HEARTBEAT_ALARM, (existing) => {
      if (existing) return;
      chrome.alarms.create(TELEMETRY_HEARTBEAT_ALARM, {
        delayInMinutes: HEARTBEAT_INTERVAL_MINUTES,
        periodInMinutes: HEARTBEAT_INTERVAL_MINUTES,
      });
    });
  } catch {}
}

export async function reportTelemetryEvent(
  event: TelemetryEventType,
  options: ReportTelemetryEventOptions = {},
): Promise<TelemetryReportResult> {
  const settings = options.settings || await getSettings();
  const telemetrySettings = settings?.telemetry || {};
  // 2026-10-03 10-11 线裁决：legacy enabled 不再拦截（键仍存储，不再读取）
  const endpoint = await resolveTelemetryReportEndpoint(String(telemetrySettings.endpoint || '').trim());
  if (!endpoint) return { sent: false, reason: 'missing-endpoint' };

  const now = options.now || new Date();
  const state = await getTelemetryClientState(settings, now);
  const throttle = getEventThrottle(event, state);
  if (!options.force && throttle && typeof throttle.lastEventAt === 'number' && now.getTime() - throttle.lastEventAt < throttle.throttleMs) {
    return { sent: false, reason: 'throttled' };
  }

  const attemptedState = {
    ...state,
    ...getEventStatePatch(event, now),
  };
  await writeTelemetryClientState(attemptedState);

  try {
    const payload = await buildTelemetryPayload({
      event,
      settings,
      state: attemptedState,
      now,
      error: options.error,
    });
    const result = await sendTelemetry({
      endpoint,
      payload,
      fetchImpl: options.fetchImpl,
    });

    if (!result.ok) {
      return { sent: false, reason: 'http-error', status: result.status };
    }

    await writeTelemetryClientState({
      ...attemptedState,
      lastSuccessAt: now.getTime(),
    });
    return { sent: true, status: result.status };
  } catch {
    return { sent: false, reason: 'network-error' };
  }
}

export async function reportTelemetryError(
  input: BuildTelemetryErrorPayloadInput,
  options: ReportTelemetryEventOptions = {},
): Promise<TelemetryReportResult> {
  const error = await buildTelemetryErrorPayload(input);
  return reportTelemetryErrorPayload(error, options);
}

export async function reportTelemetryErrorPayload(
  error: TelemetryErrorPayload,
  options: ReportTelemetryEventOptions = {},
): Promise<TelemetryReportResult> {
  const now = options.now || new Date();
  const settings = options.settings || await getSettings();
  const telemetrySettings = settings?.telemetry || {};
  // 2026-10-03 10-11 线裁决：legacy enabled 不再拦截（键仍存储，不再读取）
  const endpoint = String(telemetrySettings.endpoint || '').trim();
  if (!endpoint) return { sent: false, reason: 'missing-endpoint' };

  const throttleKey = buildErrorThrottleKey(error);
  const lastSentAt = errorReportLastSentAt.get(throttleKey);
  if (!options.force && typeof lastSentAt === 'number' && now.getTime() - lastSentAt < ERROR_REPORT_THROTTLE_MS) {
    return { sent: false, reason: 'throttled' };
  }
  errorReportLastSentAt.set(throttleKey, now.getTime());

  return reportTelemetryEvent('error_report', {
    ...options,
    settings,
    now,
    force: true,
    error,
  });
}

function getEventThrottle(event: TelemetryEventType, state: { lastStartupAt?: number; lastHeartbeatAt?: number }): { lastEventAt?: number; throttleMs: number } | undefined {
  if (event === 'startup') {
    return { lastEventAt: state.lastStartupAt, throttleMs: STARTUP_THROTTLE_MS };
  }
  if (event === 'heartbeat') {
    return { lastEventAt: state.lastHeartbeatAt, throttleMs: HEARTBEAT_THROTTLE_MS };
  }
  return undefined;
}

function getEventStatePatch(event: TelemetryEventType, now: Date): Partial<{ lastStartupAt: number; lastHeartbeatAt: number }> {
  if (event === 'startup') return { lastStartupAt: now.getTime() };
  if (event === 'heartbeat') return { lastHeartbeatAt: now.getTime() };
  return {};
}

async function resolveTelemetryReportEndpoint(endpoint: string): Promise<string> {
  if (!endpoint) return '';
  if (normalizeEndpoint(endpoint) !== normalizeEndpoint(TELEMETRY_REPORT_ENDPOINT)) {
    return endpoint;
  }
  return buildTelemetryReportUrl();
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

function buildErrorThrottleKey(error: TelemetryErrorPayload): string {
  return [
    error.component || 'unknown',
    error.code || 'UNKNOWN_ERROR',
    error.stackHash || error.message || 'no-stack',
  ].join('|');
}
