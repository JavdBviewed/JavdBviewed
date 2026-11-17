/**
 * @file localMediaIndexSync.replay.test.ts
 * @description 本地媒体索引补拉回拨必须一次性（2026-11-17 P0：云端无索引账号每 5min 全量重下）
 * @module features/cloudSync
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryLocalStore, createSyncEngine, type ApiClient } from '@javdb/sync-client';
import type { SyncCursorMap, SyncEntity, SyncSessionRequest } from '@javdb/sync-protocol';

import { createChromeCursorStore, CLOUD_CURSORS_STORAGE_KEY } from './chromeCursorStore';
import { applyLocalMediaIndex, prepareLocalMediaIndexReplay, LOCAL_MEDIA_INDEX_MIGRATION_KEY } from './localMediaIndexSync';

const INDEX_KEY = 'local_media_library_state';
const BASE_TS = 1_700_000_000_000;

let storedValues: Record<string, unknown>;

function storageGet(keys: string[], cb: (items: Record<string, unknown>) => void): void {
  queueMicrotask(() => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in storedValues) out[key] = structuredClone(storedValues[key]);
    }
    cb(out);
  });
}

function seedStorageItems(count: number): Array<{ entity: SyncEntity; seq: number }> {
  return Array.from({ length: count }, (_, i) => {
    const key = `storage_key_${i + 1}`;
    return {
      seq: i + 1,
      entity: {
        id: key,
        type: 'storage_item',
        revision: 1,
        updatedAt: BASE_TS + i,
        payload: { key, value: { n: i } },
      } satisfies SyncEntity,
    };
  });
}

/** 复刻生产 wave3i pullLocked 水位语义：seq > cursors[type] 才下发，next=max(入参, applied)。 */
function createFakeCloud(seed: Array<{ entity: SyncEntity; seq: number }>) {
  const requests: SyncSessionRequest[] = [];
  const api = {
    async session(request: SyncSessionRequest) {
      requests.push(structuredClone(request));
      const cursors: SyncCursorMap = request.cursors ?? {};
      const hits = seed.filter((item) => item.seq > (cursors[item.entity.type] ?? 0));
      const next: SyncCursorMap = { ...cursors };
      for (const hit of hits) {
        if (hit.seq > (next[hit.entity.type] ?? 0)) next[hit.entity.type] = hit.seq;
      }
      return {
        protocolVersion: request.protocolVersion,
        apply: hits.map((hit) => structuredClone(hit.entity)),
        results: [],
        stats: { uploaded: 0, downloaded: hits.length, merged: 0, rejected: 0, byType: {} },
        code: hits.length ? 'SYNC_OK' : 'SYNC_EMPTY',
        message: '',
        cursors: next,
        hasMore: false,
      };
    },
  };
  return { api: api as unknown as ApiClient, requests };
}

function createEngine(api: ApiClient) {
  return createSyncEngine({ api, local: createMemoryLocalStore(), cursors: createChromeCursorStore() });
}

beforeEach(() => {
  storedValues = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (keys: string[], cb: (items: Record<string, unknown>) => void) => storageGet(keys, cb),
        set: (items: Record<string, unknown>, cb: () => void) => {
          queueMicrotask(() => {
            for (const [key, value] of Object.entries(items)) storedValues[key] = structuredClone(value);
            cb?.();
          });
        },
        remove: (keys: string[], cb: () => void) => {
          queueMicrotask(() => {
            for (const key of keys) delete storedValues[key];
            cb?.();
          });
        },
      },
    },
    runtime: {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prepareLocalMediaIndexReplay 一次性回拨', () => {
  it('云端从未有本地媒体索引时只回拨一次：第二轮起请求带水位游标且零下载', async () => {
    // 老用户：游标已在水位（云内 20 条 storage_item，无任何本地媒体索引实体，补拉永不成功）
    storedValues[CLOUD_CURSORS_STORAGE_KEY] = { storage_item: 20 };
    const cloud = createFakeCloud(seedStorageItems(20));
    const engine = createEngine(cloud.api);

    // 第 1 轮：升级后首轮一次性回拨补拉，允许全量重下一次（存量兼容路径）
    await prepareLocalMediaIndexReplay();
    const r1 = await engine.syncSession('device-1');
    expect(cloud.requests[0]?.cursors).toEqual({ storage_item: 0 });
    expect(r1.pulled).toBe(20);

    // 第 2 轮（5min 后）：游标必须生效，禁止再全量重下（P0 回归点）
    await prepareLocalMediaIndexReplay();
    const r2 = await engine.syncSession('device-1');
    expect(cloud.requests[1]?.cursors).toEqual({ storage_item: 20 });
    expect(r2.pulled).toBe(0);

    // 第 3 轮保持静默
    await prepareLocalMediaIndexReplay();
    const r3 = await engine.syncSession('device-1');
    expect(r3.pulled).toBe(0);
  });

  it('补拉真的拉到索引并应用后停止补拉，后续轮次增量', async () => {
    const seed = seedStorageItems(20);
    const index = { version: 1, updatedAt: BASE_TS + 999_999, entries: [] };
    seed.push({
      seq: 21,
      entity: {
        id: INDEX_KEY,
        type: 'storage_item',
        revision: 1,
        updatedAt: BASE_TS + 999_999,
        payload: { key: INDEX_KEY, value: index },
      },
    });
    storedValues[CLOUD_CURSORS_STORAGE_KEY] = { storage_item: 20 };
    const cloud = createFakeCloud(seed);
    const engine = createEngine(cloud.api);

    await prepareLocalMediaIndexReplay();
    const r1 = await engine.syncSession('device-1');
    expect(r1.pulled).toBe(21); // 回拨后补拉包含索引本体

    // 模拟入站 applyRemote 命中索引后的调用方（extensionEntityStore）落标记
    await applyLocalMediaIndex(index);

    await prepareLocalMediaIndexReplay();
    const r2 = await engine.syncSession('device-1');
    expect(cloud.requests[1]?.cursors).toEqual({ storage_item: 21 });
    expect(r2.pulled).toBe(0);
  });

  it('回拨只影响 storage_item 水位，其余游标保留；成功后再次调用不回拨', async () => {
    storedValues[CLOUD_CURSORS_STORAGE_KEY] = { storage_item: 2065, video: 88, history: 3 };
    await prepareLocalMediaIndexReplay();
    expect(storedValues[CLOUD_CURSORS_STORAGE_KEY]).toEqual({ storage_item: 0, video: 88, history: 3 });

    // 模拟首轮全量补拉成功后服务端游标推回水位；下一轮不得再次归零
    storedValues[CLOUD_CURSORS_STORAGE_KEY] = { storage_item: 2065, video: 88, history: 3 };
    await prepareLocalMediaIndexReplay();
    expect(storedValues[CLOUD_CURSORS_STORAGE_KEY]).toEqual({ storage_item: 2065, video: 88, history: 3 });
  });

  it('迁移完成标记在位时不回拨（既有门控钉住）', async () => {
    storedValues[LOCAL_MEDIA_INDEX_MIGRATION_KEY] = true;
    storedValues[CLOUD_CURSORS_STORAGE_KEY] = { storage_item: 2065 };
    await prepareLocalMediaIndexReplay();
    expect(storedValues[CLOUD_CURSORS_STORAGE_KEY]).toEqual({ storage_item: 2065 });
  });

  it('本地已有合法索引时不回拨（既有门控钉住）', async () => {
    storedValues[INDEX_KEY] = { version: 1, updatedAt: BASE_TS, entries: [] };
    storedValues[CLOUD_CURSORS_STORAGE_KEY] = { storage_item: 2065 };
    await prepareLocalMediaIndexReplay();
    expect(storedValues[CLOUD_CURSORS_STORAGE_KEY]).toEqual({ storage_item: 2065 });
  });
});
