/**
 * @file runCloudSyncNow.ts
 * @description 扩展侧一键同步：走服务端权威 session（apply + stats/message）
 * @module features/cloudSync
 */
import { createSyncEngine, type SyncSessionProgress } from '@javdb/sync-client';
import type { SyncEntity, SyncSessionCode, SyncSessionStats } from '@javdb/sync-protocol';
import { createChromeCursorStore } from './chromeCursorStore';
import { listCloudPending } from './chromePendingStore';
import { createExtensionCloudClient } from './createExtensionCloudClient';
import {
  collectLocalSyncEntities,
  createExtensionEntityStore,
  preparePushQueueStats,
} from './extensionEntityStore';
import { loadCloudSession } from './chromeTokenStore';
import { loadCloudSettings } from './cloudSettingsStorage';
import { countByType, type TypeCountMap } from './syncStats';

export type CloudSyncNowResult = {
  /** Server stats.downloaded */
  pulled: number;
  /** Server stats.uploaded */
  pushed: number;
  localEntityCount: number;
  pendingBefore: number;
  enqueuedNow: number;
  localByType: TypeCountMap;
  pendingByType: TypeCountMap;
  /** Server-authoritative fields */
  stats: SyncSessionStats;
  code: SyncSessionCode;
  message: string;
  totalDurationMs: number;
  requestBytes: number;
  sessionDurationMs: number;
  averageSessionRateBytesPerSecond: number;
};

export type CloudSyncProgress =
  | {
      stage: 'preparing';
      localEntityCount: number;
      pendingCount: number;
    }
  | SyncSessionProgress
  | {
      stage: 'complete';
      totalDurationMs: number;
      requestBytes: number;
      sessionDurationMs: number;
      averageSessionRateBytesPerSecond: number;
      uploaded: number;
      downloaded: number;
    };

export type CloudSyncNowOptions = {
  onProgress?: (event: CloudSyncProgress) => void;
};

function reportProgress(options: CloudSyncNowOptions, event: CloudSyncProgress): void {
  try {
    options.onProgress?.(event);
  } catch {
    // UI 进度订阅错误不能中断后台同步。
  }
}

export async function runCloudSyncNow(
  options: CloudSyncNowOptions = {},
): Promise<CloudSyncNowResult> {
  const startedAt = Date.now();
  const session = await loadCloudSession();
  if (!session?.accessToken) {
    throw new Error('请先登录 Cloud');
  }
  const settings = await loadCloudSettings();
  const deviceId = session.deviceId || settings.deviceId;
  if (!deviceId) {
    throw new Error('缺少设备 ID，请重新登录');
  }

  const snapshot = await collectLocalSyncEntities();
  const localByType = countByType(snapshot);
  const prep = await preparePushQueueStats();
  const pending = await listCloudPending();
  const pendingByType = countByType(pending as SyncEntity[]);
  reportProgress(options, {
    stage: 'preparing',
    localEntityCount: prep.localEntityCount,
    pendingCount: prep.pendingCount,
  });

  const { api } = await createExtensionCloudClient();
  const engine = createSyncEngine({
    api,
    local: createExtensionEntityStore(),
    cursors: createChromeCursorStore(),
  });
  const result = await engine.syncSession(deviceId, {
    onProgress: (event) => reportProgress(options, event),
  });
  const { response } = result;
  const totalDurationMs = Date.now() - startedAt;
  const { requestBytes, sessionDurationMs } = result.metrics;
  const averageSessionRateBytesPerSecond =
    sessionDurationMs > 0 ? Math.round((requestBytes * 1_000) / sessionDurationMs) : 0;
  const output: CloudSyncNowResult = {
    pulled: response.stats.downloaded,
    pushed: response.stats.uploaded,
    localEntityCount: prep.localEntityCount,
    pendingBefore: prep.pendingCount,
    enqueuedNow: prep.enqueuedNow,
    localByType,
    pendingByType,
    stats: response.stats,
    code: response.code,
    message: response.message,
    totalDurationMs,
    requestBytes,
    sessionDurationMs,
    averageSessionRateBytesPerSecond,
  };
  reportProgress(options, {
    stage: 'complete',
    totalDurationMs,
    requestBytes,
    sessionDurationMs,
    averageSessionRateBytesPerSecond,
    uploaded: response.stats.uploaded,
    downloaded: response.stats.downloaded,
  });
  return output;
}
