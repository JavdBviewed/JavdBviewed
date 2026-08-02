import type { BatchImportMode, BatchImportResult } from './batchImportService';
import type { BatchImportTaskItem, BatchImportTaskSnapshot } from './batchImportTaskStore';

export interface BatchImportRunnerDependencies {
  processItem: (code: string, mode: BatchImportMode, userTags: string[]) => Promise<BatchImportResult>;
  saveTask: (task: BatchImportTaskSnapshot) => Promise<void>;
  shouldCancel?: () => boolean;
  now?: () => number;
}

function updateItem(item: BatchImportTaskItem, result: BatchImportResult): void {
  item.status = result.status;
  item.title = result.title;
  item.error = result.error;
}

function isTerminalItem(item: BatchImportTaskItem): boolean {
  return !['pending', 'searching', 'failed'].includes(item.status);
}

export async function runBatchImportTask(
  task: BatchImportTaskSnapshot,
  dependencies: BatchImportRunnerDependencies,
): Promise<BatchImportTaskSnapshot> {
  const now = dependencies.now || Date.now;
  task.status = 'running';

  while (task.cursor < task.items.length) {
    if (dependencies.shouldCancel?.()) {
      task.status = 'paused';
      task.updatedAt = now();
      await dependencies.saveTask(task);
      return task;
    }

    const item = task.items[task.cursor];
    if (!item) {
      task.cursor += 1;
      continue;
    }

    if (!isTerminalItem(item)) {
      item.status = 'searching';
      try {
        const result = await dependencies.processItem(item.code, task.mode, task.userTags);
        updateItem(item, result);
      } catch (error) {
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : String(error || '处理失败');
      }
    }

    task.cursor += 1;
    task.status = task.cursor >= task.items.length ? 'completed' : 'running';
    task.updatedAt = now();
    await dependencies.saveTask(task);
  }

  task.status = 'completed';
  task.updatedAt = now();
  return task;
}
