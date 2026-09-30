/**
 * @file payloadPreview.ts
 * @description 遥测上报负载预览 —— 复用真实构造器组装 body，只读展示，绝不发送、绝不回写状态
 * @module features/telemetry
 */
import { getSettings } from '../../../utils/storage';
import type {
  TelemetryErrorPayload,
  TelemetryEventType,
  TelemetryPayload,
} from '../domain/types';
import { peekTelemetryClientState } from './clientState';
import { buildTelemetryErrorPayload } from './errorPayload';
import { buildTelemetryPayload } from './buildTelemetryPayload';

/** 可预览的遥测事件（与真实上报事件枚举完全一致，避免两套定义漂移） */
export const TELEMETRY_PREVIEW_EVENTS = ['startup', 'heartbeat', 'error_report'] as const satisfies readonly TelemetryEventType[];
export type TelemetryPreviewEvent = (typeof TELEMETRY_PREVIEW_EVENTS)[number];

/** 错误上报示例的固定入参：与 background 真实错误上报同一 component/code 口径 */
export const TELEMETRY_ERROR_SAMPLE_INPUT = {
  component: 'background',
  code: 'BACKGROUND_UNHANDLED_ERROR',
} as const;

export interface TelemetryPayloadPreview {
  event: TelemetryPreviewEvent;
  payload: TelemetryPayload;
  /** 仅 error_report 预览会有，值是按真实脱敏规则算出来的示例 */
  errorSample?: TelemetryErrorPayload;
}

export interface BuildTelemetryPayloadPreviewOptions {
  settings?: any;
  now?: Date;
}

/**
 * 用当前配置与当前客户端状态，组装「此刻若上报就会发出的 body」。
 * 与 reporter 的唯一区别：不调用 sendTelemetry、不写 telemetry_client_state。
 */
export async function buildTelemetryPayloadPreview(
  event: TelemetryPreviewEvent,
  options: BuildTelemetryPayloadPreviewOptions = {},
): Promise<TelemetryPayload> {
  const preview = await buildTelemetryPayloadPreviewWithSample(event, options);
  return preview.payload;
}

/**
 * 同 buildTelemetryPayloadPreview，但额外返回错误示例，供 UI 标注「示例值」。
 */
export async function buildTelemetryPayloadPreviewWithSample(
  event: TelemetryPreviewEvent,
  options: BuildTelemetryPayloadPreviewOptions = {},
): Promise<TelemetryPayloadPreview> {
  const now = options.now || new Date();
  const settings = options.settings || await getSettings();
  const state = await peekTelemetryClientState(settings, now);

  if (event === 'error_report') {
    const error = await createTelemetryErrorSample();
    return {
      event,
      errorSample: error,
      payload: await buildTelemetryPayload({ event, settings, state, now, error }),
    };
  }

  return {
    event,
    payload: await buildTelemetryPayload({ event, settings, state, now }),
  };
}

/**
 * 错误示例负载：走真实 buildTelemetryErrorPayload（含 URL/磁力/token 抹除与堆栈哈希），
 * 只用一个本地构造的示例异常，因此 message 只会是异常类名、stackHash 是示例堆栈的哈希。
 */
export async function createTelemetryErrorSample(): Promise<TelemetryErrorPayload> {
  return buildTelemetryErrorPayload({
    ...TELEMETRY_ERROR_SAMPLE_INPUT,
    error: new TypeError('telemetry payload preview sample'),
    fatal: false,
  });
}
