/**
 * @file chromePendingStore.errorSurface.test.ts
 * @description 10-18 审计 C2-2（N1）：pending 存储写失败诚实化判别
 * - set 回调置 lastError → upsertCloudPending reject（原实现静默 resolve=永久漏推）
 * - set 成功 → resolve 且实体入队（现状零漂移）
 * @module features/cloudSync
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncEntity } from '@javdb/sync-protocol';
import { CLOUD_SESSION_STORAGE_KEY } from './chromeTokenStore';
import { CLOUD_PENDING_STORAGE_KEY, listCloudPending, upsertCloudPending } from './chromePendingStore';

type PendingEntity = SyncEntity;

function makeEntity(): PendingEntity {
  return {
    id: 'v1',
    type: 'video',
    revision: 1,
    updatedAt: 1700000000000,
    payload: { id: 'v1' },
  };
}

function makeStub(opts: { failSet?: boolean; lastErrorMessage?: string }) {
  const store: Record<string, unknown> = {
    [CLOUD_SESSION_STORAGE_KEY]: { accessToken: 'probe-token' },
  };
  const runtime: { lastError?: { message: string } | null } = { lastError: null };
  const chromeStub = {
    runtime,
    storage: {
      local: {
        get: (keys: unknown, cb: (items: Record<string, unknown>) => void) => {
          const out: Record<string, unknown> = {};
          if (keys === null || keys === undefined) {
            Object.assign(out, store);
          } else if (typeof keys === 'string') {
            if (store[keys] !== undefined) out[keys] = store[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) if (store[k] !== undefined) out[k] = store[k];
          }
          queueMicrotask(() => cb(out));
        },
        set: (values: Record<string, unknown>, cb: () => void) => {
          queueMicrotask(() => {
            if (opts.failSet) {
              runtime.lastError = { message: opts.lastErrorMessage ?? 'QUOTA_BYTES_PER_ITEM exceeded (probe)' };
              cb();
              return;
            }
            Object.assign(store, values);
            runtime.lastError = null;
            cb();
          });
        },
      },
    },
  };
  return { chromeStub, runtime, store };
}

describe('chromePendingStore 写失败诚实化（C2-2/N1）', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('set 回调置 lastError → upsertCloudPending reject（错误上浮，原实现静默吞）', async () => {
    const { chromeStub, runtime } = makeStub({ failSet: true, lastErrorMessage: 'QUOTA_BYTES_PER_ITEM exceeded (probe)' });
    vi.stubGlobal('chrome', chromeStub);
    const err = await upsertCloudPending([makeEntity()]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('QUOTA_BYTES_PER_ITEM exceeded (probe)');
    // lastError 被消费过即清除，避免污染后续调用
    expect(runtime.lastError).toEqual({ message: 'QUOTA_BYTES_PER_ITEM exceeded (probe)' });
  });

  it('set 成功 → resolve 且实体进入 pending 队列（现状零漂移）', async () => {
    const { chromeStub, store } = makeStub({ failSet: false });
    vi.stubGlobal('chrome', chromeStub);
    await upsertCloudPending([makeEntity()]);
    expect(store[CLOUD_PENDING_STORAGE_KEY]).toBeUndefined();
    const delta = store['cloud_sync_pending_delta_v1'] as Record<string, unknown>;
    expect(delta).toBeDefined();
    const pending = await listCloudPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe('video');
    expect(pending[0].id).toBe('v1');
  });
});
