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
  type SyncSessionResponse,
} from '@javdb/sync-protocol';
import type { ApiClient } from './apiClient';
import { advanceCursors, mergeEntityBatches } from './conflictPolicy';

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
    }
  | {
      stage: 'applying';
      pendingCount: number;
      requestBytes: number;
      uploaded: number;
      downloaded: number;
    };

export interface SyncSessionMetrics {
  requestBytes: number;
  sessionDurationMs: number;
}

export interface SyncSessionOptions {
  onProgress?: (event: SyncSessionProgress) => void;
}

export interface SyncEngine {
  readonly protocolVersion: ProtocolVersion;
  /**
   * Server-authoritative path: POST /v1/sync/session.
   * Applies `apply` as-is (no local LWW); clears accepted/merged pending.
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

  return {
    protocolVersion,

    async syncSession(deviceId: string, options?: SyncSessionOptions) {
      const cursors = await opts.cursors.get();
      const pending = await opts.local.listPending();
      const request = {
        protocolVersion,
        deviceId,
        cursors,
        changes: pending,
      };
      const requestBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
      reportSessionProgress(options, {
        stage: 'uploading',
        pendingCount: pending.length,
        requestBytes,
      });
      const sessionStartedAt = Date.now();
      const response = await opts.api.session(request);
      const sessionDurationMs = Date.now() - sessionStartedAt;
      reportSessionProgress(options, {
        stage: 'applying',
        pendingCount: pending.length,
        requestBytes,
        uploaded: response.stats.uploaded,
        downloaded: response.stats.downloaded,
      });

      if (response.apply.length) {
        // Trust server apply only — do not mergeEntityBatches locally.
        await opts.local.applyRemote(response.apply);
      }

      const done: Array<{ type: string; id: string }> = [];
      for (const r of response.results) {
        if (r.status === 'accepted' || r.status === 'merged') {
          done.push({ type: r.type, id: r.id });
        }
      }
      if (done.length) await opts.local.clearPending(done);

      await opts.cursors.set(response.cursors);

      return {
        response,
        pulled: response.stats.downloaded,
        pushed: response.stats.uploaded,
        cursors: response.cursors,
        metrics: {
          requestBytes,
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
