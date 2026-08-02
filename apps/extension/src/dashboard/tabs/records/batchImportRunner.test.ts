import { describe, expect, it, vi } from 'vitest';
import type { BatchImportResult } from './batchImportService';
import {
  runBatchImportTask,
  type BatchImportRunnerDependencies,
} from './batchImportRunner';
import type { BatchImportTaskSnapshot } from './batchImportTaskStore';

function task(): BatchImportTaskSnapshot {
  return {
    version: 1,
    id: 'task-1',
    mode: 'direct-import',
    userTags: ['精选'],
    items: [
      { code: 'ABC-001', sourceText: 'ABC-001', status: 'pending' },
      { code: 'ABC-002', sourceText: 'ABC-002', status: 'duplicate' },
      { code: '', sourceText: 'bad', status: 'invalid' },
      { code: 'ABC-003', sourceText: 'ABC-003', status: 'pending' },
    ],
    cursor: 0,
    status: 'running',
    updatedAt: 1,
  };
}

function dependencies(overrides: Partial<BatchImportRunnerDependencies> = {}): BatchImportRunnerDependencies {
  return {
    processItem: vi.fn(async (code): Promise<BatchImportResult> => ({ code, status: 'imported' })),
    saveTask: vi.fn(async () => undefined),
    now: () => 100,
    ...overrides,
  };
}

describe('records batch import runner', () => {
  it('skips duplicate and invalid items and persists each processed item', async () => {
    const deps = dependencies();
    const result = await runBatchImportTask(task(), deps);

    expect(result.status).toBe('completed');
    expect(result.cursor).toBe(4);
    expect(deps.processItem).toHaveBeenCalledTimes(2);
    expect(deps.saveTask).toHaveBeenCalledTimes(4);
    expect(result.items.map(item => item.status)).toEqual(['imported', 'duplicate', 'invalid', 'imported']);
  });

  it('stops at cancellation and can resume without reprocessing completed items', async () => {
    const current = task();
    const deps = dependencies({
      shouldCancel: vi.fn(() => current.cursor >= 1),
    });

    const paused = await runBatchImportTask(current, deps);
    expect(paused.status).toBe('paused');
    expect(deps.processItem).toHaveBeenCalledTimes(1);

    const resumedDeps = dependencies();
    const resumed = await runBatchImportTask(paused, resumedDeps);
    expect(resumed.status).toBe('completed');
    expect(resumedDeps.processItem).toHaveBeenCalledTimes(1);
    expect(resumedDeps.processItem).toHaveBeenCalledWith('ABC-003', 'direct-import', ['精选']);
  });

  it('does not reprocess later terminal items when retrying an earlier failure', async () => {
    const retryTask = task();
    retryTask.items = [
      { code: 'ABC-001', sourceText: 'ABC-001', status: 'failed', error: '网络错误' },
      { code: 'ABC-002', sourceText: 'ABC-002', status: 'imported' },
      { code: 'ABC-003', sourceText: 'ABC-003', status: 'existing' },
    ];
    retryTask.cursor = 0;

    const deps = dependencies();
    const result = await runBatchImportTask(retryTask, deps);

    expect(result.status).toBe('completed');
    expect(deps.processItem).toHaveBeenCalledTimes(1);
    expect(deps.processItem).toHaveBeenCalledWith('ABC-001', 'direct-import', ['精选']);
  });
});
