import type { BatchImportMode } from './batchImportService';

export const BATCH_IMPORT_TASK_STORAGE_KEY = 'records_batch_import_task_v1';

export type BatchImportTaskStatus = 'running' | 'paused' | 'cancelled' | 'completed';
export type BatchImportTaskItemStatus =
  | 'pending'
  | 'searching'
  | 'matched'
  | 'imported'
  | 'existing'
  | 'placeholder'
  | 'duplicate'
  | 'invalid'
  | 'not-found'
  | 'failed';

export interface BatchImportTaskItem {
  code: string;
  sourceText: string;
  status: BatchImportTaskItemStatus;
  title?: string;
  error?: string;
}

export interface BatchImportTaskSnapshot {
  version: 1;
  id: string;
  mode: BatchImportMode;
  userTags: string[];
  items: BatchImportTaskItem[];
  cursor: number;
  status: BatchImportTaskStatus;
  updatedAt: number;
}

export interface BatchImportTaskStorage {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

function isBatchImportMode(value: unknown): value is BatchImportMode {
  return value === 'search-import' || value === 'search-only' || value === 'direct-import';
}

function isBatchImportTaskStatus(value: unknown): value is BatchImportTaskStatus {
  return value === 'running' || value === 'paused' || value === 'cancelled' || value === 'completed';
}

function isBatchImportTaskItem(value: unknown): value is BatchImportTaskItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BatchImportTaskItem>;
  return typeof item.code === 'string'
    && typeof item.sourceText === 'string'
    && typeof item.status === 'string';
}

function isBatchImportTaskSnapshot(value: unknown): value is BatchImportTaskSnapshot {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<BatchImportTaskSnapshot>;
  return task.version === 1
    && typeof task.id === 'string'
    && isBatchImportMode(task.mode)
    && Array.isArray(task.userTags)
    && Array.isArray(task.items)
    && task.items.every(isBatchImportTaskItem)
    && Number.isInteger(task.cursor)
    && isBatchImportTaskStatus(task.status)
    && typeof task.updatedAt === 'number';
}

export async function loadBatchImportTask(
  storage: BatchImportTaskStorage,
): Promise<BatchImportTaskSnapshot | undefined> {
  const value = await storage.get(BATCH_IMPORT_TASK_STORAGE_KEY);
  return isBatchImportTaskSnapshot(value) ? value : undefined;
}

export async function saveBatchImportTask(
  storage: BatchImportTaskStorage,
  task: BatchImportTaskSnapshot,
): Promise<void> {
  await storage.set(BATCH_IMPORT_TASK_STORAGE_KEY, task);
}

export async function clearBatchImportTask(storage: BatchImportTaskStorage): Promise<void> {
  await storage.remove(BATCH_IMPORT_TASK_STORAGE_KEY);
}
