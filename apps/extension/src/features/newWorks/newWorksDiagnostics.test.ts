import { afterEach, describe, expect, it } from 'vitest';
import {
  beginNewWorksDiagnosticSpan,
  enableNewWorksDiagnostics,
  enableNewWorksDiagnosticsFromQuery,
  getNewWorksDiagnosticSnapshot,
  recordNewWorksDiagnosticCounter,
  recordNewWorksDiagnosticError,
  recordNewWorksDiagnosticValue,
} from './newWorksDiagnostics';

describe('新作品页性能诊断记录器', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__JAVDB_NEW_WORKS_DIAGNOSTICS__;
  });

  it('未启用时不创建诊断状态', () => {
    recordNewWorksDiagnosticCounter('sync.calls');
    expect(getNewWorksDiagnosticSnapshot()).toBeNull();
  });

  it('记录计数、脱敏数值和耗时摘要', () => {
    enableNewWorksDiagnostics();
    recordNewWorksDiagnosticCounter('sync.viewedPageCalls', 2);
    recordNewWorksDiagnosticValue('sync.viewedRecordCount', 1287);
    const end = beginNewWorksDiagnosticSpan('sync.total');
    end(12.5);

    expect(getNewWorksDiagnosticSnapshot()).toEqual({
      counters: { 'sync.viewedPageCalls': 2 },
      values: { 'sync.viewedRecordCount': 1287 },
      durations: { 'sync.total': { count: 1, totalMs: 12.5, maxMs: 12.5 } },
      errors: {},
    });
  });

  it('记录批量同步失败的类型而不泄露长标识或 URL', () => {
    enableNewWorksDiagnostics();
    recordNewWorksDiagnosticError(
      'sync.batchError',
      new Error('TransactionInactiveError: https://example.test/secret/abcdefghijklmnopqrstuvwxyz0123456789'),
    );

    expect(getNewWorksDiagnosticSnapshot()?.errors).toEqual({
      'sync.batchError': 'Error: TransactionInactiveError: [url]',
    });
  });

  it('只在受控查询参数下启用诊断', () => {
    enableNewWorksDiagnosticsFromQuery('?perfNewWorks=no-list');
    recordNewWorksDiagnosticCounter('list.calls');
    expect(getNewWorksDiagnosticSnapshot()?.counters).toEqual({ 'list.calls': 1 });
  });
});
