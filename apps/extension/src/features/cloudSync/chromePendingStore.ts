/**
 * @file chromePendingStore.ts
 * @description 待推送变更队列（本机 local-only）
 * @module features/cloudSync
 */
import type { SyncEntity } from '@javdb/sync-protocol';
import { shouldSyncLogEntry } from './logSyncPolicy';

export const CLOUD_PENDING_STORAGE_KEY = 'cloud_sync_pending_v1';
export const CLOUD_PENDING_DELTA_STORAGE_KEY = 'cloud_sync_pending_delta_v1';

let pendingMutationQueue: Promise<void> = Promise.resolve();
let pendingBaseSnapshot: SyncEntity[] | null = null;
let pendingDeltaSnapshot: Record<string, SyncEntity> | null = null;

function entityKey(type: string, id: string): string {
  return `${type}\0${id}`;
}

async function readPendingStorage(): Promise<{ base: SyncEntity[]; delta: Record<string, SyncEntity> }> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([CLOUD_PENDING_STORAGE_KEY, CLOUD_PENDING_DELTA_STORAGE_KEY], (res) => {
        const base = res?.[CLOUD_PENDING_STORAGE_KEY];
        const delta = res?.[CLOUD_PENDING_DELTA_STORAGE_KEY];
        resolve({
          base: Array.isArray(base) ? (base as SyncEntity[]) : [],
          delta: delta && typeof delta === 'object' && !Array.isArray(delta)
            ? delta as Record<string, SyncEntity>
            : {},
        });
      });
    } catch {
      resolve({ base: [], delta: {} });
    }
  });
}

async function writePending(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(values, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function loadPendingSnapshots(): Promise<void> {
  if (pendingBaseSnapshot === null || pendingDeltaSnapshot === null) {
    const pending = await readPendingStorage();
    pendingBaseSnapshot = pending.base;
    pendingDeltaSnapshot = pending.delta;
  }
}

function pendingEntities(): SyncEntity[] {
  const map = new Map((pendingBaseSnapshot ?? []).map((entity) => [entityKey(entity.type, entity.id), entity]));
  for (const [key, entity] of Object.entries(pendingDeltaSnapshot ?? {})) {
    map.set(key, entity);
  }
  return [...map.values()];
}

function enqueuePendingMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = pendingMutationQueue.then(mutation, mutation);
  pendingMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function listCloudPending(): Promise<SyncEntity[]> {
  await pendingMutationQueue;
  await loadPendingSnapshots();
  return pendingEntities();
}

/** 按 type+id 覆盖写入 pending（后者覆盖前者） */
export async function upsertCloudPending(entities: SyncEntity[]): Promise<void> {
  const syncableEntities = entities.filter((entity) => {
    if (entity.type !== 'log') return true;
    const payload = entity.payload;
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? shouldSyncLogEntry(payload as Record<string, unknown>)
      : false;
  });
  if (!syncableEntities.length) return;
  await enqueuePendingMutation(async () => {
    await loadPendingSnapshots();
    for (const e of syncableEntities) {
      pendingDeltaSnapshot![entityKey(e.type, e.id)] = e;
    }
    await writePending({ [CLOUD_PENDING_DELTA_STORAGE_KEY]: pendingDeltaSnapshot });
  });
}

export async function clearCloudPending(
  keys: Array<{ type: string; id: string }>,
): Promise<void> {
  if (!keys.length) return;
  await enqueuePendingMutation(async () => {
    await loadPendingSnapshots();
    const drop = new Set(keys.map((k) => entityKey(k.type, k.id)));
    pendingBaseSnapshot = pendingEntities().filter((entity) => !drop.has(entityKey(entity.type, entity.id)));
    pendingDeltaSnapshot = {};
    await writePending({
      [CLOUD_PENDING_STORAGE_KEY]: pendingBaseSnapshot,
      [CLOUD_PENDING_DELTA_STORAGE_KEY]: pendingDeltaSnapshot,
    });
  });
}

/**
 * 首次同步：若 pending 为空，把当前本地全量实体入队，便于首推到空 Cloud。
 */
export async function ensureInitialPending(snapshot: SyncEntity[]): Promise<number> {
  return enqueuePendingMutation(async () => {
    await loadPendingSnapshots();
    if (pendingEntities().length > 0) return 0;
    if (!snapshot.length) return 0;
    pendingBaseSnapshot = [...snapshot];
    pendingDeltaSnapshot = {};
    await writePending({
      [CLOUD_PENDING_STORAGE_KEY]: pendingBaseSnapshot,
      [CLOUD_PENDING_DELTA_STORAGE_KEY]: pendingDeltaSnapshot,
    });
    return snapshot.length;
  });
}
