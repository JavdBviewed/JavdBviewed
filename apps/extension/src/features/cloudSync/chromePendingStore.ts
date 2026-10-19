/**
 * @file chromePendingStore.ts
 * @description 待推送变更队列（本机 local-only）
 * @module features/cloudSync
 */
import type { SyncEntity } from '@javdb/sync-protocol';
import { CLOUD_SESSION_STORAGE_KEY } from './chromeTokenStore';
import { CLOUD_SETTINGS_STORAGE_KEY } from './cloudSettingsStorage';
import { CLOUD_CURSORS_STORAGE_KEY } from './chromeCursorStore';

export const CLOUD_PENDING_STORAGE_KEY = 'cloud_sync_pending_v1';
export const CLOUD_PENDING_DELTA_STORAGE_KEY = 'cloud_sync_pending_delta_v1';

let pendingMutationQueue: Promise<void> = Promise.resolve();

const UNSYNCABLE_LOG_TYPES = new Set(['log', 'magnet_push_log']);

function entityKey(type: string, id: string): string {
  return `${type}\0${id}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nextValue]) => `${JSON.stringify(key)}:${stableStringify(nextValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
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
  return new Promise<void>((resolve, reject) => {
    try {
      chrome.storage.local.set(values, () => {
        // 10-18 审计 C2-2（N1）：写失败（如配额超限）诚实上浮，交由 scheduleEnqueue 日志+重试
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message || 'chrome.storage.local.set 失败'));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 判断当前是否具备 Cloud 推送条件：存在会话，或已保存凭据（baseUrl + accountIdentifier）。
 * 每次入队前直接读 storage，不做任何缓存，避免登录后漏入队；
 * 不满足条件时跳过入队——首次登录时 ensureInitialPending 会从本地全量重建，无数据丢失。
 */
async function canQueuePending(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([CLOUD_SESSION_STORAGE_KEY, CLOUD_SETTINGS_STORAGE_KEY], (res) => {
        const session = res?.[CLOUD_SESSION_STORAGE_KEY];
        const hasSession =
          !!session && typeof session === 'object' && isNonEmptyString((session as { accessToken?: unknown }).accessToken);

        const settings = res?.[CLOUD_SETTINGS_STORAGE_KEY];
        const hasCredentials =
          !!settings &&
          typeof settings === 'object' &&
          isNonEmptyString((settings as { baseUrl?: unknown }).baseUrl) &&
          isNonEmptyString((settings as { accountIdentifier?: unknown }).accountIdentifier);

        resolve(hasSession || hasCredentials);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * 合并 base 全量快照与 delta 增量（同 key 以 delta 为准），并过滤不可同步类型。
 */
function mergePending(base: SyncEntity[], delta: Record<string, SyncEntity>): SyncEntity[] {
  const map = new Map(base.map((entity) => [entityKey(entity.type, entity.id), entity]));
  for (const entity of Object.values(delta)) {
    map.set(entityKey(entity.type, entity.id), entity);
  }
  return [...map.values()].filter((entity) => !UNSYNCABLE_LOG_TYPES.has(entity.type));
}

function enqueuePendingMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = pendingMutationQueue.then(mutation, mutation);
  pendingMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * storage 为跨上下文（SW / 页面 / dashboard）唯一权威来源：
 * 每次读/写都在操作开始时重新读取 storage，不使用进程内快照缓存。
 * pending 队列规模小，重读开销可忽略；同进程内由 mutation 队列串行化。
 */
export async function listCloudPending(): Promise<SyncEntity[]> {
  await pendingMutationQueue;
  const pending = await readPendingStorage();
  return mergePending(pending.base, pending.delta);
}

/** 按 type+id 覆盖写入 pending（后者覆盖前者） */
export async function upsertCloudPending(entities: SyncEntity[]): Promise<void> {
  const syncableEntities = entities.filter((entity) => !UNSYNCABLE_LOG_TYPES.has(entity.type));
  if (!syncableEntities.length) return;
  if (!(await canQueuePending())) return;
  await enqueuePendingMutation(async () => {
    const pending = await readPendingStorage();
    const effective = new Map(
      mergePending(pending.base, pending.delta).map((entity) => [entityKey(entity.type, entity.id), entity]),
    );
    const changed = syncableEntities.filter((entity) => {
      const current = effective.get(entityKey(entity.type, entity.id));
      return !current || stableStringify(current) !== stableStringify(entity);
    });
    if (!changed.length) return;
    const nextDelta: Record<string, SyncEntity> = { ...pending.delta };
    for (const entity of changed) {
      nextDelta[entityKey(entity.type, entity.id)] = entity;
    }
    await writePending({ [CLOUD_PENDING_DELTA_STORAGE_KEY]: nextDelta });
  });
}

/**
 * 仅移除服务端已接受（accepted/merged）的 key；
 * 未出现在 keys 中的 delta 条目保留，等待下次同步重推。
 */
export async function clearCloudPending(
  keys: Array<{ type: string; id: string }>,
): Promise<void> {
  if (!keys.length) return;
  await enqueuePendingMutation(async () => {
    const pending = await readPendingStorage();
    const drop = new Set(keys.map((k) => entityKey(k.type, k.id)));
    const nextBase = pending.base.filter((entity) => !drop.has(entityKey(entity.type, entity.id)));
    const nextDelta: Record<string, SyncEntity> = {};
    for (const [key, entity] of Object.entries(pending.delta)) {
      if (!drop.has(key) && !drop.has(entityKey(entity.type, entity.id))) {
        nextDelta[key] = entity;
      }
    }
    await writePending({
      [CLOUD_PENDING_STORAGE_KEY]: nextBase,
      [CLOUD_PENDING_DELTA_STORAGE_KEY]: nextDelta,
    });
  });
}

/**
 * 本设备是否已有同步游标（engine 在成功完成 session 后写入）：
 * 有游标 = 已与当前云账号完成过同步，不再是「首次同步」。
 */
async function hasSyncCursors(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([CLOUD_CURSORS_STORAGE_KEY], (res) => {
        const v = res?.[CLOUD_CURSORS_STORAGE_KEY];
        resolve(!!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * 首次同步：pending 为空且本设备尚无同步游标时，把当前本地全量实体入队，便于首推到空 Cloud。
 * 已完成过同步（有游标）的设备不再重播全量 base：否则 pending 每次同步清空后，
 * 每次静默同步都会整包重推本地状态，陈旧 settings 整 blob 会以 LWW 冲掉其它设备的新变更。
 */
export async function ensureInitialPending(snapshot: SyncEntity[]): Promise<number> {
  return enqueuePendingMutation(async () => {
    const pending = await readPendingStorage();
    if (mergePending(pending.base, pending.delta).length > 0) return 0;
    if (await hasSyncCursors()) return 0;
    if (!snapshot.length) return 0;
    await writePending({
      [CLOUD_PENDING_STORAGE_KEY]: [...snapshot],
      [CLOUD_PENDING_DELTA_STORAGE_KEY]: {},
    });
    return snapshot.length;
  });
}
