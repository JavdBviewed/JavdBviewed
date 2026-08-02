import { describe, expect, it } from 'vitest';
import {
  BATCH_IMPORT_TASK_STORAGE_KEY,
  clearBatchImportTask,
  loadBatchImportTask,
  saveBatchImportTask,
  type BatchImportTaskSnapshot,
  type BatchImportTaskStorage,
} from './batchImportTaskStore';

function createMemoryStorage(): BatchImportTaskStorage & { value?: unknown } {
  return {
    async get(key) {
      return key === BATCH_IMPORT_TASK_STORAGE_KEY ? this.value : undefined;
    },
    async set(key, value) {
      if (key === BATCH_IMPORT_TASK_STORAGE_KEY) this.value = value;
    },
    async remove(key) {
      if (key === BATCH_IMPORT_TASK_STORAGE_KEY) this.value = undefined;
    },
  };
}

describe('records batch import task store', () => {
  it('persists and reloads the latest task snapshot', async () => {
    const storage = createMemoryStorage();
    const task: BatchImportTaskSnapshot = {
      version: 1,
      id: 'task-1',
      mode: 'search-import',
      userTags: ['精选'],
      items: [{ code: 'ABC-001', sourceText: 'ABC-001', status: 'pending' }],
      cursor: 0,
      status: 'running',
      updatedAt: 100,
    };

    await saveBatchImportTask(storage, task);
    expect(await loadBatchImportTask(storage)).toEqual(task);
  });

  it('rejects malformed snapshots and allows clearing the task', async () => {
    const storage = createMemoryStorage();
    storage.value = { version: 99, status: 'running' };

    expect(await loadBatchImportTask(storage)).toBeUndefined();
    await saveBatchImportTask(storage, {
      version: 1,
      id: 'task-2',
      mode: 'direct-import',
      userTags: [],
      items: [],
      cursor: 0,
      status: 'completed',
      updatedAt: 101,
    });
    await clearBatchImportTask(storage);
    expect(storage.value).toBeUndefined();
  });
});
