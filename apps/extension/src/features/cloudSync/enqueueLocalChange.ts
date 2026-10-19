/**
 * @file enqueueLocalChange.ts
 * @description 本地写入后入 pending 队列（自动同步前置）
 * @module features/cloudSync
 */
import type { SyncEntity } from '@javdb/sync-protocol';
import type { ActorRecord, ListRecord, NewWorkRecord, VideoRecord } from '../../types';
import type { ReportMonthly, ViewsDaily } from '../../types/insights';
import type { MagnetCacheRecord, NewWorksDailyStat } from '../../platform/storage/indexedDb';
import { upsertCloudPending } from './chromePendingStore';
import {
  actorToSyncEntity,
  insightsReportToSyncEntity,
  insightsViewToSyncEntity,
  listToSyncEntity,
  magnetToSyncEntity,
  newWorkDailyStatToSyncEntity,
  newWorkToSyncEntity,
  preferenceToSyncEntity,
  storageItemToSyncEntity,
  toSyncEntity,
  videoToSyncEntity,
  CLOUD_PREFERENCE_KEYS,
} from './toSyncEntity';
import { STORAGE_KEYS } from '../../utils/config';
import { stripEmbySessionFieldsFromValue } from '../../shared/embyMediaServerSync';

export async function enqueueSyncEntities(entities: SyncEntity[]): Promise<void> {
  const list = entities.filter(Boolean);
  if (!list.length) return;
  await upsertCloudPending(list);
}

export async function enqueueVideoChange(record: VideoRecord): Promise<void> {
  const e = videoToSyncEntity(record);
  if (e) await upsertCloudPending([e]);
}

export async function enqueueVideoChanges(records: VideoRecord[]): Promise<void> {
  const list = records.map(videoToSyncEntity).filter(Boolean) as SyncEntity[];
  if (list.length) await upsertCloudPending(list);
}

export async function enqueueActorChange(record: ActorRecord): Promise<void> {
  const e = actorToSyncEntity(record);
  if (e) await upsertCloudPending([e]);
}

export async function enqueueActorChanges(records: ActorRecord[]): Promise<void> {
  const list = records.map(actorToSyncEntity).filter(Boolean) as SyncEntity[];
  if (list.length) await upsertCloudPending(list);
}

export async function enqueueListChange(record: ListRecord): Promise<void> {
  const e = listToSyncEntity(record);
  if (e) await upsertCloudPending([e]);
}

export async function enqueueListChanges(records: ListRecord[]): Promise<void> {
  const list = records.map(listToSyncEntity).filter(Boolean) as SyncEntity[];
  if (list.length) await upsertCloudPending(list);
}

export async function enqueueListDeletions(records: ListRecord[]): Promise<void> {
  // 清单删除墓碑：顶层 deletedAt 一等公民实体（storage_item 墓碑先例形态）；服务端按墓碑存储，拉取侧软删回写
  const list = (records || [])
    .filter((r) => !!r?.id)
    .map((r) => {
      const deletedAt = Number(r.deletedAt) || Date.now();
      return { ...toSyncEntity('list', String(r.id), r, deletedAt), deletedAt };
    });
  if (!list.length) return;
  await upsertCloudPending(list);
}

export async function enqueueNewWorkChange(record: NewWorkRecord): Promise<void> {
  const e = newWorkToSyncEntity(record);
  if (e) await upsertCloudPending([e]);
}

export async function enqueueNewWorkChanges(records: NewWorkRecord[]): Promise<void> {
  const list = records.map(newWorkToSyncEntity).filter(Boolean) as SyncEntity[];
  if (list.length) await upsertCloudPending(list);
}

export async function enqueueSubscriptionChange(id: string, payload: unknown): Promise<void> {
  if (!id) return;
  await upsertCloudPending([
    toSyncEntity('new_work_subscription', id, payload, Date.now()),
  ]);
}

export async function enqueueUserProfileChange(profile: unknown): Promise<void> {
  if (profile == null) return;
  await upsertCloudPending([toSyncEntity('user_profile', 'default', profile, Date.now())]);
}

export async function enqueueSearchPresetChange(id: string, payload: unknown): Promise<void> {
  if (!id) return;
  await upsertCloudPending([toSyncEntity('search_preset', id, payload, Date.now())]);
}

export async function enqueueMagnetChanges(records: MagnetCacheRecord[]): Promise<void> {
  const list = records.map(magnetToSyncEntity).filter(Boolean) as SyncEntity[];
  if (list.length) await upsertCloudPending(list);
}

export async function enqueueInsightsViewChange(view: ViewsDaily): Promise<void> {
  const e = insightsViewToSyncEntity(view);
  if (e) await upsertCloudPending([e]);
}

export async function enqueueInsightsViews(views: ViewsDaily[]): Promise<void> {
  const list = views.map(insightsViewToSyncEntity).filter(Boolean) as SyncEntity[];
  if (list.length) await upsertCloudPending(list);
}

export async function enqueueInsightsReportChange(report: ReportMonthly): Promise<void> {
  const e = insightsReportToSyncEntity(report);
  if (e) await upsertCloudPending([e]);
}

export async function enqueueNewWorkDailyStatChange(stat: NewWorksDailyStat): Promise<void> {
  const e = newWorkDailyStatToSyncEntity(stat);
  if (e) await upsertCloudPending([e]);
}

export async function enqueueLogChange(entry: Record<string, unknown>): Promise<void> {
  void entry;
}

export async function enqueueLogChanges(entries: Array<Record<string, unknown>>): Promise<void> {
  void entries;
}

export async function enqueueMagnetPushLogChange(entry: Record<string, unknown>): Promise<void> {
  void entry;
}

export async function enqueueMagnetPushLogChanges(entries: Array<Record<string, unknown>>): Promise<void> {
  void entries;
}

export async function enqueueStorageItemChange(key: string, value: unknown): Promise<void> {
  // X2：settings 增量入队前剥离 emby 会话字段（与全量快照同口径；本地 storage 不动）
  const sanitized = key === STORAGE_KEYS.SETTINGS ? stripEmbySessionFieldsFromValue(value) : value;
  const e = storageItemToSyncEntity(key, sanitized, Date.now());
  if (e) await upsertCloudPending([e]);
}

export async function enqueueStorageItemDeletion(key: string): Promise<void> {
  if (!key) return;
  const deletedAt = Date.now();
  await upsertCloudPending([
    {
      ...toSyncEntity('storage_item', key, { key }, deletedAt),
      deletedAt,
    },
  ]);
}

export async function enqueuePreferenceChange(key: string, value: unknown): Promise<void> {
  if (!(CLOUD_PREFERENCE_KEYS as readonly string[]).includes(key)) return;
  await upsertCloudPending([preferenceToSyncEntity(key, value)]);
}

/** 入队最多尝试次数（首次 + 重试）；失败经日志+重试，不阻塞主写入路径（10-18 审计 C2-2） */
const CLOUD_ENQUEUE_MAX_ATTEMPTS = 3;
/** 重试退避（ms）：第 1 次失败后 / 第 2 次失败后 */
const CLOUD_ENQUEUE_RETRY_DELAYS_MS = [1000, 4000];

let cloudEnqueueFailureCount = 0;

/** 仅测试/诊断读取：入队重试耗尽、变更未进 pending 队列的次数（10-18 审计 C2-2） */
export function getCloudEnqueueFailureCount(): number {
  return cloudEnqueueFailureCount;
}

function enqueueErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attemptCloudEnqueue(task: () => Promise<void>, attempt: number): Promise<void> {
  let failed: unknown;
  let failedThrown = false;
  try {
    await task();
  } catch (error) {
    failedThrown = true;
    failed = error;
  }
  if (!failedThrown) return;
  const message = enqueueErrorMessage(failed);
  const delayMs = CLOUD_ENQUEUE_RETRY_DELAYS_MS[attempt - 1];
  if (delayMs === undefined) {
    cloudEnqueueFailureCount += 1;
    console.error(`[cloudSync] 入队重试耗尽，变更未进 pending 队列: ${message}`);
    return;
  }
  console.warn(`[cloudSync] 入队失败（第 ${attempt}/${CLOUD_ENQUEUE_MAX_ATTEMPTS} 次）：${message}，${delayMs}ms 后重试`);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
  await attemptCloudEnqueue(task, attempt + 1);
}

/** fire-and-forget：不阻塞主写入路径；失败走日志+有限重试（10-18 审计 C2-2） */
export function scheduleEnqueue(task: () => Promise<void>): void {
  void attemptCloudEnqueue(task, 1);
}
