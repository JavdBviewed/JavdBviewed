// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS,
  CONTENT_PERFORMANCE_DIAGNOSTIC_MESSAGES,
  countContentPerformanceEvent,
  getContentPerformanceDiagnosticSnapshot,
  installContentPerformanceDiagnostics,
  recordContentPerformanceDuration,
} from './contentPerformanceDiagnostics';

describe('content performance diagnostics', () => {
  afterEach(() => {
    delete (window as Window & { __JDB_CONTENT_PERF__?: unknown }).__JDB_CONTENT_PERF__;
    window.history.replaceState({}, '', '/');
  });

  it('stays inert unless the explicit content diagnostic query is present', () => {
    window.history.replaceState({}, '', '/source');
    installContentPerformanceDiagnostics();
    countContentPerformanceEvent('interval.test');
    expect((window as Window & { __JDB_CONTENT_PERF__?: unknown }).__JDB_CONTENT_PERF__).toBeUndefined();
  });

  it('records bounded counters when enabled', () => {
    window.history.replaceState({}, '', '/source?perfContent=1');
    installContentPerformanceDiagnostics();
    countContentPerformanceEvent('interval.test', 2);
    recordContentPerformanceDuration('init.test', 4);

    expect(getContentPerformanceDiagnosticSnapshot()).toMatchObject({
      enabled: true,
      counters: { 'interval.test': 2 },
      durations: { 'init.test': { count: 1, totalMs: 4, maxMs: 4 } },
    });
    expect(CONTENT_PERFORMANCE_DIAGNOSTIC_MESSAGES.READ).toBe('JDB_CONTENT_PERF_READ');
  });

  it('exposes stable source-page startup stage labels', () => {
    expect(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS).toEqual({
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
    });
  });

  it('does not retain the diagnostic listener after dispose', () => {
    window.history.replaceState({}, '', '/source?perfContent=1');
    installContentPerformanceDiagnostics();
    const diagnosticWindow = window as Window & { __JDB_CONTENT_PERF__?: { dispose?: () => void } };
    const dispose = diagnosticWindow.__JDB_CONTENT_PERF__?.dispose;
    expect(dispose).toEqual(expect.any(Function));
    dispose?.();
    expect(diagnosticWindow.__JDB_CONTENT_PERF__).toBeDefined();
  });
});
