/**
 * @file newWorksDiagnostics.ts
 * @description 新作品页按需性能诊断记录器；默认关闭且只保存聚合计数。
 * @module features/newWorks
 */

type DurationSummary = { count: number; totalMs: number; maxMs: number };
type NewWorksDiagnosticState = {
  counters: Record<string, number>;
  values: Record<string, number>;
  durations: Record<string, DurationSummary>;
  errors: Record<string, string>;
};

const STATE_KEY = '__JAVDB_NEW_WORKS_DIAGNOSTICS__';

function getGlobalState(): NewWorksDiagnosticState | null {
  const globalObject = globalThis as Record<string, unknown>;
  const value = globalObject[STATE_KEY];
  return value && typeof value === 'object' ? value as NewWorksDiagnosticState : null;
}

export function enableNewWorksDiagnostics(): void {
  const globalObject = globalThis as Record<string, unknown>;
  globalObject[STATE_KEY] = {
    counters: {},
    values: {},
    durations: {},
    errors: {},
  } satisfies NewWorksDiagnosticState;
}

export function enableNewWorksDiagnosticsFromQuery(search: string): void {
  const value = new URLSearchParams(search).get('perfNewWorks') ?? '';
  if (['full', 'no-stats', 'no-list', 'no-auto-sync'].includes(value.trim().toLowerCase())) {
    enableNewWorksDiagnostics();
  }
}

export function recordNewWorksDiagnosticCounter(name: string, amount = 1): void {
  const state = getGlobalState();
  if (!state || !name) return;
  state.counters[name] = (state.counters[name] ?? 0) + Math.max(0, amount);
}

export function recordNewWorksDiagnosticValue(name: string, value: number): void {
  const state = getGlobalState();
  if (!state || !name || !Number.isFinite(value)) return;
  state.values[name] = Math.max(0, value);
}

function sanitizeDiagnosticError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/(?:token|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi, '[token]')
    .slice(0, 240);
}

export function recordNewWorksDiagnosticError(name: string, error: unknown): void {
  const state = getGlobalState();
  if (!state || !name) return;
  state.errors[name] = sanitizeDiagnosticError(error);
}

export function beginNewWorksDiagnosticSpan(name: string): (durationMs?: number) => void {
  const startedAt = performance.now();
  return (durationMs = performance.now() - startedAt) => {
    const state = getGlobalState();
    if (!state || !name || !Number.isFinite(durationMs)) return;
    const current = state.durations[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
    const normalized = Math.max(0, durationMs);
    state.durations[name] = {
      count: current.count + 1,
      totalMs: current.totalMs + normalized,
      maxMs: Math.max(current.maxMs, normalized),
    };
  };
}

export function getNewWorksDiagnosticSnapshot(): NewWorksDiagnosticState | null {
  const state = getGlobalState();
  if (!state) return null;
  return {
    counters: { ...state.counters },
    values: { ...state.values },
    durations: Object.fromEntries(
      Object.entries(state.durations).map(([key, value]) => [key, { ...value }]),
    ),
    errors: { ...state.errors },
  };
}
