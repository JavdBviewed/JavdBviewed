/**
 * @file index.ts
 * @description 遥测上报（匿名使用统计）统一导出
 * @module features/telemetry
 */
export type {
  TelemetryChannel,
  TelemetryClientState,
  TelemetryCountBucket,
  TelemetryErrorPayload,
  TelemetryEventType,
  TelemetryPayload,
  TelemetryReportResult,
  TelemetryRuntimeInfo,
  TelemetrySettings,
} from './domain/types';
export { bucketCount, bucketViewedCount, countObjectKeys } from './domain/buckets';
export {
  TELEMETRY_FEATURE_CATALOG,
  buildTelemetryFeatures,
  type TelemetryFeatureCatalogItem,
  type TelemetryFeatureCategory,
  type TelemetryFeatureKey,
} from './domain/featureCatalog';
export {
  TELEMETRY_CLIENT_STATE_KEY,
  createTelemetryEventId,
  getTelemetryClientState,
  peekTelemetryClientState,
  writeTelemetryClientState,
} from './application/clientState';
export {
  TELEMETRY_ERROR_SAMPLE_INPUT,
  TELEMETRY_PREVIEW_EVENTS,
  buildTelemetryPayloadPreview,
  buildTelemetryPayloadPreviewWithSample,
  createTelemetryErrorSample,
  type BuildTelemetryPayloadPreviewOptions,
  type TelemetryPayloadPreview,
  type TelemetryPreviewEvent,
} from './application/payloadPreview';
export {
  describeTelemetrySensitiveFindings,
  findTelemetryPayloadSensitiveValues,
  type TelemetrySensitiveFinding,
  type TelemetrySensitivePatternId,
} from './domain/payloadHygiene';
export { getTelemetryRuntimeInfo } from './application/runtimeInfo';
export { buildTelemetryPayload } from './application/buildTelemetryPayload';
export {
  buildTelemetryErrorPayload,
  sanitizeTelemetryErrorPayload,
  type BuildTelemetryErrorPayloadInput,
} from './application/errorPayload';
export { sendTelemetry } from './infrastructure/telemetryClient';
export {
  TELEMETRY_HEARTBEAT_ALARM,
  handleTelemetryAlarm,
  initializeTelemetryReporter,
  reportTelemetryError,
  reportTelemetryErrorPayload,
  reportTelemetryEvent,
  syncTelemetryHeartbeatAlarm,
} from './application/reporter';
export {
  TELEMETRY_DASHBOARD_OPEN_MESSAGE,
  reportTelemetryForDashboardOpen,
} from './application/dashboardOpen';
export {
  TELEMETRY_ERROR_REPORT_MESSAGE,
  handleTelemetryRuntimeMessage,
} from './application/runtimeMessages';
