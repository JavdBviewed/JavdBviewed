/**
 * @file syncEngine.ts
 * @description Sync loop over CloudApi + local entity buffer (no chrome).
 * Prefer syncSession (server-authoritative); syncNow keeps pull/push compatibility.
 * @module @javdb/sync-client
 */

import {
  PROTOCOL_VERSION,
  type ProtocolVersion,
  type SyncCursorMap,
  type SyncEntity,
  type SyncSessionItemResult,
  type SyncSessionResponse,
  type SyncSessionStats,
} from '@javdb/sync-protocol';
import type { ApiClient } from './apiClient';
import { advanceCursors, mergeEntityBatches } from './conflictPolicy';

const SYNC_SESSION_BATCH_SIZE = 500;

export interface LocalEntityStore {
  listAll(): Promise<SyncEntity[]>;
  /**
   * Upsert remote/session entities by type+id.
   * Must NOT clear local entities absent from the batch (incremental apply).
   */
  applyRemote(entities: SyncEntity[]): Promise<void>;
  /** Pending local changes not yet acknowledged by server. */
  listPending(): Promise<SyncEntity[]>;
  /** Drop pending entries that server accepted/merged (by type+id). */
  clearPending(keys: Array<{ type: string; id: string }>): Promise<void>;
}

export interface CursorStore {
  get(): Promise<SyncCursorMap>;
  set(cursors: SyncCursorMap): Promise<void>;
}

export interface SyncSessionEngineResult {
  response: SyncSessionResponse;
  /** Convenience mirrors of response.stats for callers. */
  pulled: number;
  pushed: number;
  cursors: SyncCursorMap;
  metrics: SyncSessionMetrics;
}

export type SyncSessionProgress =
  | {
      stage: 'uploading';
      pendingCount: number;
      requestBytes: number;
      batchNumber?: number;
      batchCount?: number;
    }
  | {
      stage: 'applying';
      pendingCount: number;
      requestBytes: number;
      uploaded: number;
      downloaded: number;
      batchNumber?: number;
      batchCount?: number;
    };

export interface SyncSessionMetrics {
  /** Actual request body bytes after optional gzip compression. */
  requestBytes: number;
  /** JSON UTF-8 bytes before optional gzip compression. */
  uncompressedRequestBytes: number;
  sessionDurationMs: number;
}

export interface SyncSessionOptions {
  onProgress?: (event: SyncSessionProgress) => void;
  signal?: AbortSignal;
}

export interface SyncEngine {
  readonly protocolVersion: ProtocolVersion;
  /**
   * Server-authoritative path: one or more POST /v1/sync/session requests.
   * Applies `apply` as-is (no local LWW); clears accepted/merged pending per batch.
   */
  syncSession(deviceId: string, options?: SyncSessionOptions): Promise<SyncSessionEngineResult>;
  /**
   * @deprecated Prefer syncSession. Legacy pull → local merge → push.
   */
  syncNow(): Promise<{ pulled: number; pushed: number; cursors: SyncCursorMap }>;
}

export function createSyncEngine(opts: {
  api: ApiClient;
  local: LocalEntityStore;
  cursors: CursorStore;
  protocolVersion?: ProtocolVersion;
}): SyncEngine {
  const protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION;

  function reportSessionProgress(options: SyncSessionOptions | undefined, event: SyncSessionProgress): void {
    try {
      options?.onProgress?.(event);
    } catch {
      // 进度订阅失败不能中断同步。
    }
  }

  function mergeCountMap(target: Record<string, number>, source?: Record<string, number>): void {
    for (const [type, count] of Object.entries(source ?? {})) {
      target[type] = (target[type] ?? 0) + count;
    }
  }

  function emptySessionStats(): SyncSessionStats {
    return {
      uploaded: 0,
      downloaded: 0,
      merged: 0,
      rejected: 0,
      byType: {},
      uploadedByType: {},
      downloadedByType: {},
      rejectedByType: {},
    };
  }

  function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('同步已取消', 'AbortError');
  }

  function splitPending(pending: SyncEntity[]): SyncEntity[][] {
    if (!pending.length) return [[]];
    const batches: SyncEntity[][] = [];
    for (let offset = 0; offset < pending.length; offset += SYNC_SESSION_BATCH_SIZE) {
      batches.push(pending.slice(offset, offset + SYNC_SESSION_BATCH_SIZE));
    }
    return batches;
  }

  return {
    protocolVersion,

    async syncSession(deviceId: string, options?: SyncSessionOptions) {
      throwIfAborted(options?.signal);
      let cursors = await opts.cursors.get();
      const pending = await opts.local.listPending();
      const batches = splitPending(pending);
      const aggregateStats = emptySessionStats();
      const aggregateApply: SyncEntity[] = [];
      const aggregateResults: SyncSessionItemResult[] = [];
      let requestBytes = 0;
      let uncompressedRequestBytes = 0;
      let sessionDurationMs = 0;
      let lastResponse: SyncSessionResponse | undefined;

      for (const [batchIndex, changes] of batches.entries()) {
        throwIfAborted(options?.signal);
        const request = {
          protocolVersion,
          deviceId,
          cursors,
          changes,
        };
        const batchUncompressedBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
        // Non-fetch/custom transports do not report body metrics, so keep the JSON size as a safe fallback.
        let batchReported = false;
        requestBytes += batchUncompressedBytes;
        uncompressedRequestBytes += batchUncompressedBytes;
        const remainingPending = Math.max(0, pending.length - batchIndex * SYNC_SESSION_BATCH_SIZE);
        reportSessionProgress(options, {
          stage: 'uploading',
          pendingCount: remainingPending,
          requestBytes,
          batchNumber: batchIndex + 1,
          batchCount: batches.length,
        });

        const sessionStartedAt = Date.now();
        const response = await opts.api.session(request, {
          signal: options?.signal,
          onRequestBodyMetrics: (metrics) => {
            if (batchReported) {
              // A 401 retry sends another physical request body; include it in actual traffic totals.
              requestBytes += metrics.transmittedBytes;
              uncompressedRequestBytes += metrics.uncompressedBytes;
              return;
            }
            batchReported = true;
            requestBytes += metrics.transmittedBytes - batchUncompressedBytes;
            uncompressedRequestBytes += metrics.uncompressedBytes - batchUncompressedBytes;
          },
        });
        throwIfAborted(options?.signal);
        sessionDurationMs += Date.now() - sessionStartedAt;
        lastResponse = response;
        aggregateApply.push(...response.apply);
        aggregateResults.push(...response.results);
        aggregateStats.uploaded += response.stats.uploaded;
        aggregateStats.downloaded += response.stats.downloaded;
        aggregateStats.merged += response.stats.merged;
        aggregateStats.rejected += response.stats.rejected;
        mergeCountMap(aggregateStats.byType, response.stats.byType);
        mergeCountMap(aggregateStats.uploadedByType ?? {}, response.stats.uploadedByType);
        mergeCountMap(aggregateStats.downloadedByType ?? {}, response.stats.downloadedByType);
        mergeCountMap(aggregateStats.rejectedByType ?? {}, response.stats.rejectedByType);

        if (response.apply.length) {
          // Trust server apply only — do not mergeEntityBatches locally.
          await opts.local.applyRemote(response.apply);
        }
        throwIfAborted(options?.signal);

        const done: Array<{ type: string; id: string }> = [];
        for (const result of response.results) {
          if (result.status === 'accepted' || result.status === 'merged') {
            done.push({ type: result.type, id: result.id });
          }
        }
        if (done.length) await opts.local.clearPending(done);
        throwIfAborted(options?.signal);
        cursors = response.cursors;
        await opts.cursors.set(cursors);

        reportSessionProgress(options, {
          stage: 'applying',
          pendingCount: remainingPending,
          requestBytes,
          uploaded: aggregateStats.uploaded,
          downloaded: aggregateStats.downloaded,
          batchNumber: batchIndex + 1,
          batchCount: batches.length,
        });
      }

      const code = aggregateStats.rejected > 0
        ? 'SYNC_PARTIAL'
        : aggregateStats.uploaded === 0 && aggregateStats.downloaded === 0
          ? 'SYNC_EMPTY'
          : 'SYNC_OK';
      const message = code === 'SYNC_EMPTY'
        ? '同步完成（无变更）'
        : code === 'SYNC_PARTIAL'
          ? `同步部分成功：上传 ${aggregateStats.uploaded}，下载 ${aggregateStats.downloaded}，拒绝 ${aggregateStats.rejected}`
          : `同步完成：上传 ${aggregateStats.uploaded}，下载 ${aggregateStats.downloaded}`;
      const response: SyncSessionResponse = {
        protocolVersion,
        apply: aggregateApply,
        results: aggregateResults,
        stats: aggregateStats,
        code,
        message,
        cursors,
        hasMore: lastResponse?.hasMore,
      };

      return {
        response,
        pulled: response.stats.downloaded,
        pushed: response.stats.uploaded,
        cursors: response.cursors,
        metrics: {
          requestBytes,
          uncompressedRequestBytes,
          sessionDurationMs,
        },
      };
    },

    async syncNow() {
      let cursors = await opts.cursors.get();
      let pulled = 0;
      let hasMore = true;

      while (hasMore) {
        const pullRes = await opts.api.pull({ protocolVersion, cursors });
        pulled += pullRes.changes.length;
        if (pullRes.changes.length) {
          const localAll = await opts.local.listAll();
          const merged = mergeEntityBatches(localAll, pullRes.changes);
          await opts.local.applyRemote(merged);
        }
        cursors = advanceCursors(pullRes.cursors ?? cursors, pullRes.changes);
        await opts.cursors.set(cursors);
        hasMore = Boolean(pullRes.hasMore);
        if (!pullRes.changes.length) break;
      }

      const pending = await opts.local.listPending();
      let pushed = 0;
      if (pending.length) {
        const pushRes = await opts.api.push({ protocolVersion, changes: pending });
        const done: Array<{ type: string; id: string }> = [];
        for (const r of pushRes.results) {
          if (r.status === 'accepted' || r.status === 'merged') {
            done.push({ type: r.type, id: r.id });
            pushed += 1;
          }
        }
        if (done.length) await opts.local.clearPending(done);
        if (pushRes.cursors) {
          cursors = { ...cursors, ...pushRes.cursors };
          await opts.cursors.set(cursors);
        }
      }

      return { pulled, pushed, cursors };
    },
  };
}

/** In-memory local store for unit tests (applyRemote = upsert by type+id). */
export function createMemoryLocalStore(seed: SyncEntity[] = []): LocalEntityStore {
  const map = new Map<string, SyncEntity>();
  const ek = (e: SyncEntity) => `${e.type}\0${e.id}`;
  for (const e of seed) map.set(ek(e), e);
  let pending: SyncEntity[] = [];
  return {
    async listAll() {
      return [...map.values()];
    },
    async applyRemote(next) {
      for (const e of next) map.set(ek(e), e);
    },
    async listPending() {
      return [...pending];
    },
    async clearPending(keys) {
      const drop = new Set(keys.map((k) => `${k.type}\0${k.id}`));
      pending = pending.filter((e) => !drop.has(ek(e)));
    },
    // test helper not on interface — attach via cast in tests
    ...({
      async enqueuePending(e: SyncEntity) {
        pending.push(e);
      },
    } as object),
  };
}

export function createMemoryCursorStore(initial: SyncCursorMap = {}): CursorStore {
  let cursors = { ...initial };
  return {
    async get() {
      return { ...cursors };
    },
    async set(next) {
      cursors = { ...next };
    },
  };
}
