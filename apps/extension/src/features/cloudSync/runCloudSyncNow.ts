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
import { getValue, setValue } from '../../utils/storage';

const CLOUD_LOG_CLEANUP_MARKER = 'cloud_sync_log_cleanup_v2';

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
  /** Actual request body bytes after optional gzip compression. */
  requestBytes: number;
  /** JSON UTF-8 bytes before optional gzip compression. */
  uncompressedRequestBytes: number;
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
      uncompressedRequestBytes: number;
      sessionDurationMs: number;
      averageSessionRateBytesPerSecond: number;
      uploaded: number;
      downloaded: number;
    };

export type CloudSyncNowOptions = {
  onProgress?: (event: CloudSyncProgress) => void;
  signal?: AbortSignal;
};

function reportProgress(options: CloudSyncNowOptions, event: CloudSyncProgress): void {
  try {
    options.onProgress?.(event);
  } catch {
    // UI 进度订阅错误不能中断后台同步。
  }
}

async function cleanupDeprecatedCloudLogs(
  api: Awaited<ReturnType<typeof createExtensionCloudClient>>['api'],
  settings: Awaited<ReturnType<typeof loadCloudSettings>>,
  userId: string,
): Promise<void> {
  if (typeof api.cleanupSyncData !== 'function') return;
  const markerId = `${settings.baseUrl}\0${userId || settings.accountIdentifier}`;
  const markers = await getValue<Record<string, boolean>>(CLOUD_LOG_CLEANUP_MARKER, {});
  if (markers[markerId]) return;
  try {
    await api.cleanupSyncData(['log', 'magnet_push_log']);
    await setValue(CLOUD_LOG_CLEANUP_MARKER, { ...markers, [markerId]: true });
  } catch (error) {
    // 旧版 Cloud 没有清理接口时不阻断正常同步，升级 Cloud 后会自动重试。
    console.warn('[Cloud] 历史日志清理未完成，将在下次同步重试', error);
  }
}

export async function runCloudSyncNow(
  options: CloudSyncNowOptions = {},
): Promise<CloudSyncNowResult> {
  if (options.signal?.aborted) throw new DOMException('同步已取消', 'AbortError');
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
  if (options.signal?.aborted) throw new DOMException('同步已取消', 'AbortError');
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
  await cleanupDeprecatedCloudLogs(api, settings, session.userId);
  const engine = createSyncEngine({
    api,
    local: createExtensionEntityStore(),
    cursors: createChromeCursorStore(),
  });
  const result = await engine.syncSession(deviceId, {
    onProgress: (event) => reportProgress(options, event),
    signal: options.signal,
  });
  const { response } = result;
  const totalDurationMs = Date.now() - startedAt;
  const { requestBytes, uncompressedRequestBytes, sessionDurationMs } = result.metrics;
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
    uncompressedRequestBytes,
    sessionDurationMs,
    averageSessionRateBytesPerSecond,
  };
  reportProgress(options, {
    stage: 'complete',
    totalDurationMs,
    requestBytes,
    uncompressedRequestBytes,
    sessionDurationMs,
    averageSessionRateBytesPerSecond,
    uploaded: response.stats.uploaded,
    downloaded: response.stats.downloaded,
  });
  return output;
}
