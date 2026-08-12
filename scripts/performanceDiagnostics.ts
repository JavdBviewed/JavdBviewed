/**
 * 性能测试报告的纯数据工具。
 *
 * 该模块只供 Windows/WSL 测试探针使用，不进入扩展运行时代码，避免诊断逻辑改变业务行为。
 */

export type DiagnosticPhase = 'cold' | 'warmup' | 'steady' | 'interaction' | 'cooldown';

export interface DiagnosticSample {
  phase: DiagnosticPhase;
  module: string;
  at: number;
  rssBytes: number;
  cpuPercent: number;
  jsHeapUsedBytes?: number | null;
  longTaskDurationsMs?: readonly number[];
  lifecycleCounts?: Readonly<Record<string, number>>;
  newWorksDiagnostics?: unknown;
}

export interface DiagnosticSnapshot {
  scenarioId: string;
  stopped: boolean;
  samples: DiagnosticSample[];
}

export interface DiagnosticSession {
  record(sample: DiagnosticSample): void;
  stop(): void;
  snapshot(): DiagnosticSnapshot;
}

export interface DiagnosticSummary {
  sampleCount: number;
  peakRssBytes: number;
  peakCpuPercent: number;
  steadyRssSlopeBytesPerSecond: number;
  peakJsHeapUsedBytes: number | null;
  steadyJsHeapSlopeBytesPerSecond: number;
  longTaskCount: number;
  longTaskP95Ms: number | null;
  lifecycleCounts: Record<string, number>;
  cooldownRssBytes: number | null;
}

const REDACTED = '[REDACTED]';
const DEFAULT_MAX_SAMPLES = 256;
const SENSITIVE_KEY_PATTERN = /(?:password|passwd|token|secret|authorization|cookie|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|title|description|body|content|query)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.search || url.hash) {
      if (url.origin === 'null') {
        return `${value.split(/[?#]/, 1)[0]}?redacted=1`;
      }
      return `${url.origin}${url.pathname}?redacted=1`;
    }
    return url.toString();
  } catch {
    return REDACTED;
  }
}

function normalizeKey(key: string): string {
  return key.replace(/-/g, '_').toLowerCase();
}

/** 递归移除诊断报告中不应离开测试进程的敏感字段。 */
export function redactDiagnosticPayload(value: unknown, key?: string): unknown {
  if (key) {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey === 'url' || normalizedKey.endsWith('_url')) {
      return typeof value === 'string' ? sanitizeUrl(value) : REDACTED;
    }
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
      return REDACTED;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticPayload(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDiagnosticPayload(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function normalizeMaxSamples(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_SAMPLES;
  return Math.max(1, Math.floor(value ?? DEFAULT_MAX_SAMPLES));
}

export function createDiagnosticSession(options: {
  scenarioId: string;
  maxSamples?: number;
}): DiagnosticSession {
  const maxSamples = normalizeMaxSamples(options.maxSamples);
  const samples: DiagnosticSample[] = [];
  let stopped = false;

  return {
    record(sample: DiagnosticSample): void {
      if (stopped) return;
      samples.push({ ...sample });
      if (samples.length > maxSamples) {
        samples.splice(0, samples.length - maxSamples);
      }
    },
    stop(): void {
      stopped = true;
    },
    snapshot(): DiagnosticSnapshot {
      return {
        scenarioId: options.scenarioId,
        stopped,
        samples: samples.map((sample) => ({ ...sample })),
      };
    },
  };
}

function calculateRssSlope(samples: DiagnosticSample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return 0;
  const elapsedSeconds = (last.at - first.at) / 1000;
  if (elapsedSeconds <= 0) return 0;
  return (last.rssBytes - first.rssBytes) / elapsedSeconds;
}

function calculateValueSlope(
  samples: readonly DiagnosticSample[],
  readValue: (sample: DiagnosticSample) => number | null | undefined,
): number {
  const values = samples
    .map((sample) => ({ at: sample.at, value: readValue(sample) }))
    .filter((sample): sample is { at: number; value: number } => (
      Number.isFinite(sample.at) && Number.isFinite(sample.value)
    ));
  if (values.length < 2) return 0;
  const first = values[0];
  const last = values[values.length - 1];
  if (!first || !last) return 0;
  const elapsedSeconds = (last.at - first.at) / 1000;
  if (elapsedSeconds <= 0) return 0;
  return (last.value - first.value) / elapsedSeconds;
}

function calculateLongTaskP95(
  samples: readonly DiagnosticSample[],
): { count: number; p95Ms: number | null } {
  const hasMetric = samples.some((sample) => (
    Object.prototype.hasOwnProperty.call(sample, 'longTaskDurationsMs')
  ));
  const durations = samples
    .flatMap((sample) => sample.longTaskDurationsMs ?? [])
    .filter((duration): duration is number => Number.isFinite(duration) && duration >= 0)
    .sort((left, right) => left - right);
  if (durations.length === 0) {
    return { count: 0, p95Ms: hasMetric ? 0 : null };
  }
  const index = Math.min(durations.length - 1, Math.max(0, Math.ceil(durations.length * 0.95) - 1));
  return { count: durations.length, p95Ms: durations[index] ?? null };
}

function mergeLifecycleCounts(samples: readonly DiagnosticSample[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const sample of samples) {
    for (const [event, count] of Object.entries(sample.lifecycleCounts ?? {})) {
      if (!Number.isFinite(count)) continue;
      merged[event] = Math.max(merged[event] ?? 0, count);
    }
  }
  return merged;
}

export function summarizeDiagnosticSamples(samples: readonly DiagnosticSample[]): DiagnosticSummary {
  const steadySamples = samples.filter((sample) => sample.phase === 'steady');
  const cooldownSamples = samples.filter((sample) => sample.phase === 'cooldown');
  const peakRssBytes = samples.reduce((peak, sample) => Math.max(peak, sample.rssBytes), 0);
  const peakCpuPercent = samples.reduce((peak, sample) => Math.max(peak, sample.cpuPercent), 0);
  const heapSamples = samples.filter((sample) => Number.isFinite(sample.jsHeapUsedBytes));
  const peakJsHeapUsedBytes = heapSamples.reduce(
    (peak, sample) => Math.max(peak, sample.jsHeapUsedBytes ?? 0),
    0,
  );
  const longTasks = calculateLongTaskP95(samples);
  const lastCooldown = cooldownSamples[cooldownSamples.length - 1];

  return {
    sampleCount: samples.length,
    peakRssBytes,
    peakCpuPercent,
    steadyRssSlopeBytesPerSecond: calculateRssSlope(steadySamples),
    peakJsHeapUsedBytes: heapSamples.length > 0 ? peakJsHeapUsedBytes : null,
    steadyJsHeapSlopeBytesPerSecond: calculateValueSlope(
      steadySamples,
      (sample) => sample.jsHeapUsedBytes,
    ),
    longTaskCount: longTasks.count,
    longTaskP95Ms: longTasks.p95Ms,
    lifecycleCounts: mergeLifecycleCounts(samples),
    cooldownRssBytes: lastCooldown?.rssBytes ?? null,
  };
}
