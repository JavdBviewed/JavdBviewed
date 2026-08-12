/**
 * @file contentPerformanceDiagnostics.ts
 * @description 内容脚本性能诊断计数器，仅在显式诊断参数下启用。
 * @module platform/tasks
 */

export type ContentPerformanceDiagnosticSnapshot = {
  enabled: boolean;
  startedAt: number;
  elapsedMs: number;
  counters: Record<string, number>;
  durations: Record<string, { count: number; totalMs: number; maxMs: number }>;
};

type ContentPerformanceDiagnosticState = ContentPerformanceDiagnosticSnapshot & {
  dispose?: () => void;
};

type DiagnosticWindow = Window & {
  __JDB_CONTENT_PERF__?: ContentPerformanceDiagnosticState;
};

const READ_MESSAGE = 'JDB_CONTENT_PERF_READ';
const SNAPSHOT_MESSAGE = 'JDB_CONTENT_PERF_SNAPSHOT';

export const CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS = {
  bootstrapInitialize: 'content.bootstrap.initialize',
  bootstrapRecordState: 'content.bootstrap.recordState',
  orchestratorRun: 'content.orchestrator.run',
  orchestratorTaskPrefix: 'content.orchestrator.task.',
  videoDetailPreLease: 'content.videoDetail.preLease',
  videoDetailLibraryStatus: 'content.videoDetail.libraryStatus',
  videoDetailSearchLinks: 'content.videoDetail.searchLinks',
  videoDetailAcquireOperation: 'content.videoDetail.acquireOperation',
  videoStatusInitialSyncPersist: 'content.videoStatus.initialSync.persist',
  videoStatusInitialSyncExtract: 'content.videoStatus.initialSync.extract',
  videoStatusInitialSyncStorageCommit: 'content.videoStatus.initialSync.storageCommit',
  videoStatusInitialSyncFinalize: 'content.videoStatus.initialSync.finalize',
  actorMarksQuery: 'content.actorMarks.query',
  actorMarksDom: 'content.actorMarks.dom',
} as const;

function isEnabled(): boolean {
  try {
    const value = new URLSearchParams(window.location.search).get('perfContent');
    return value === '1' || value === 'true' || value === 'on';
  } catch {
    return false;
  }
}

function createState(): ContentPerformanceDiagnosticState {
  return {
    enabled: true,
    startedAt: Date.now(),
    elapsedMs: 0,
    counters: {},
    durations: {},
  };
}

function snapshot(state: ContentPerformanceDiagnosticState): ContentPerformanceDiagnosticSnapshot {
  return {
    enabled: state.enabled,
    startedAt: state.startedAt,
    elapsedMs: Math.max(0, Date.now() - state.startedAt),
    counters: { ...state.counters },
    durations: Object.fromEntries(
      Object.entries(state.durations).map(([name, value]) => [name, { ...value }]),
    ),
  };
}

export function getContentPerformanceDiagnosticSnapshot(): ContentPerformanceDiagnosticSnapshot | null {
  const state = (typeof window !== 'undefined' ? (window as DiagnosticWindow).__JDB_CONTENT_PERF__ : undefined);
  return state ? snapshot(state) : null;
}

export function installContentPerformanceDiagnostics(): void {
  if (typeof window === 'undefined' || !isEnabled()) return;

  const diagnosticWindow = window as DiagnosticWindow;
  if (diagnosticWindow.__JDB_CONTENT_PERF__) return;

  const state = createState();
  const onMessage = (event: MessageEvent<unknown>): void => {
    const data = event.data as { type?: string; requestId?: string } | null;
    if ((event.source !== window && event.source !== null) || data?.type !== READ_MESSAGE) return;
    window.postMessage({
      type: SNAPSHOT_MESSAGE,
      requestId: data.requestId,
      snapshot: snapshot(state),
    }, '*');
  };

  window.addEventListener('message', onMessage);
  state.dispose = () => window.removeEventListener('message', onMessage);
  diagnosticWindow.__JDB_CONTENT_PERF__ = state;
}

export function countContentPerformanceEvent(name: string, amount = 1): void {
  const state = (typeof window !== 'undefined' ? (window as DiagnosticWindow).__JDB_CONTENT_PERF__ : undefined);
  if (!state || !name) return;
  state.counters[name] = (state.counters[name] ?? 0) + Math.max(0, amount);
}

export function recordContentPerformanceDuration(name: string, durationMs: number): void {
  const state = (typeof window !== 'undefined' ? (window as DiagnosticWindow).__JDB_CONTENT_PERF__ : undefined);
  if (!state || !name || !Number.isFinite(durationMs)) return;
  const current = state.durations[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += Math.max(0, durationMs);
  current.maxMs = Math.max(current.maxMs, durationMs);
  state.durations[name] = current;
}

export function startContentPerformanceSpan(name: string): () => void {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return () => {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    recordContentPerformanceDuration(name, endedAt - startedAt);
  };
}

export const CONTENT_PERFORMANCE_DIAGNOSTIC_MESSAGES = {
  READ: READ_MESSAGE,
  SNAPSHOT: SNAPSHOT_MESSAGE,
} as const;
