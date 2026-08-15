/**
 * @file cloudSyncStorageListener.test.ts
 * @description Cloud 同步后台 storage 监听测试
 * @module tests/extension
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncEntity } from '@javdb/sync-protocol';
import { STORAGE_KEYS } from '../../apps/extension/src/utils/config';
import {
  CLOUD_PENDING_DELTA_STORAGE_KEY,
  CLOUD_PENDING_STORAGE_KEY,
} from '../../apps/extension/src/features/cloudSync/chromePendingStore';
import { getChromeStorageSnapshot, resetChromeMock } from '../setup/chrome';

async function flushStorageListener(): Promise<void> {
  // scheduleEnqueue 串行 await 多 key 入队；每个 key 至少 2 个 microtask（read+write pending）
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

function readPending(): SyncEntity[] {
  const snapshot = getChromeStorageSnapshot();
  const base = snapshot[CLOUD_PENDING_STORAGE_KEY];
  const delta = snapshot[CLOUD_PENDING_DELTA_STORAGE_KEY];
  const entities = new Map<string, SyncEntity>();
  for (const entity of Array.isArray(base) ? base as SyncEntity[] : []) {
    entities.set(`${entity.type}\0${entity.id}`, entity);
  }
  for (const entity of delta && typeof delta === 'object' && !Array.isArray(delta)
    ? Object.values(delta as Record<string, SyncEntity>)
    : []) {
    entities.set(`${entity.type}\0${entity.id}`, entity);
  }
  return [...entities.values()];
}

describe('Cloud 同步 storage 监听', () => {
  beforeEach(() => {
    resetChromeMock();
    vi.resetModules();
    vi.setSystemTime(new Date('2026-07-20T09:30:00.000Z'));
  });

  it('settings 变化会自动入队为 storage_item/settings', async () => {
    const { registerCloudSyncStorageListener } = await import(
      '../../apps/extension/src/features/cloudSync/backgroundCloudSync'
    );
    registerCloudSyncStorageListener();

    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { display: { hideViewed: true }, theme: 'dark' },
    });
    await flushStorageListener();

    expect(readPending()).toEqual([
      expect.objectContaining({
        id: STORAGE_KEYS.SETTINGS,
        type: 'storage_item',
        revision: 1,
        updatedAt: Date.now(),
        payload: {
          key: STORAGE_KEYS.SETTINGS,
          value: { display: { hideViewed: true }, theme: 'dark' },
        },
      }),
    ]);
  });

  it('日志与 Cloud 配置变化会入队，会话运行态仍排除', async () => {
    const { registerCloudSyncStorageListener } = await import(
      '../../apps/extension/src/features/cloudSync/backgroundCloudSync'
    );
    registerCloudSyncStorageListener();

    await chrome.storage.local.set({
      [STORAGE_KEYS.LOGS]: [{ message: 'now sync' }],
      drive115_logs: [{ message: 'now sync' }],
      cloud_sync_settings_v1: {
        baseUrl: 'http://127.0.0.1:18080',
        deviceLabel: '扩展 A',
        deviceId: 'dev-a',
        updatedAt: Date.now(),
      },
      cloud_auto_sync_settings_v1: { enabled: true, intervalMinutes: 15 },
      cloud_sync_session_v1: { accessToken: 'secret' },
      cloud_sync_cursors_v1: { video: 3 },
      cloud_sync_pending_v1: [],
      [STORAGE_KEYS.PRIVACY_SESSION]: { unlocked: true },
    });
    await flushStorageListener();

    const pending = readPending();
    const ids = new Set(pending.map((item) => item.id));
    expect(ids.has(STORAGE_KEYS.LOGS)).toBe(true);
    expect(ids.has('drive115_logs')).toBe(true);
    expect(ids.has('cloud_sync_settings_v1')).toBe(true);
    expect(ids.has('cloud_auto_sync_settings_v1')).toBe(true);
    expect(ids.has('cloud_sync_session_v1')).toBe(false);
    expect(ids.has('cloud_sync_cursors_v1')).toBe(false);
    expect(ids.has('cloud_sync_pending_v1')).toBe(false);
    expect(ids.has(STORAGE_KEYS.PRIVACY_SESSION)).toBe(false);
  });

  it('日志和 Cloud 本机状态变化不会进入待同步队列', async () => {
    const { registerCloudSyncStorageListener } = await import(
      '../../apps/extension/src/features/cloudSync/backgroundCloudSync'
    );
    registerCloudSyncStorageListener();

    await chrome.storage.local.set({
      cloud_sync_session_v1: { accessToken: 'secret' },
      cloud_sync_cursors_v1: { video: 3 },
      cloud_sync_pending_v1: [],
      [STORAGE_KEYS.PRIVACY_SESSION]: { unlocked: true },
      telemetry_client_state: { installId: 'x' },
    });
    await flushStorageListener();

    expect(readPending()).toEqual([]);
  });

  it('删除可同步 storage key 时会入队删除标记', async () => {
    const { registerCloudSyncStorageListener } = await import(
      '../../apps/extension/src/features/cloudSync/backgroundCloudSync'
    );
    registerCloudSyncStorageListener();

    await chrome.storage.local.set({ [STORAGE_KEYS.DASHBOARD_LAST_PAGE]: '#/records' });
    await flushStorageListener();
    await chrome.storage.local.set({ [CLOUD_PENDING_STORAGE_KEY]: [] });
    await chrome.storage.local.remove(STORAGE_KEYS.DASHBOARD_LAST_PAGE);
    await flushStorageListener();

    expect(readPending()).toEqual([
      expect.objectContaining({
        id: STORAGE_KEYS.DASHBOARD_LAST_PAGE,
        type: 'storage_item',
        updatedAt: Date.now(),
        deletedAt: Date.now(),
        payload: expect.objectContaining({ key: STORAGE_KEYS.DASHBOARD_LAST_PAGE }),
      }),
    ]);
  });

  it('应用远端 storage_item 时不会重新写入本地待同步队列', async () => {
    const { registerCloudSyncStorageListener } = await import(
      '../../apps/extension/src/features/cloudSync/backgroundCloudSync'
    );
    const { createExtensionEntityStore } = await import(
      '../../apps/extension/src/features/cloudSync/extensionEntityStore'
    );
    registerCloudSyncStorageListener();

    await createExtensionEntityStore().applyRemote([
      {
        id: STORAGE_KEYS.SETTINGS,
        type: 'storage_item',
        revision: 2,
        updatedAt: Date.now(),
        payload: {
          key: STORAGE_KEYS.SETTINGS,
          value: { display: { hideViewed: false }, theme: 'light' },
        },
      },
    ]);
    await flushStorageListener();

    expect(getChromeStorageSnapshot()[STORAGE_KEYS.SETTINGS]).toEqual({
      display: { hideViewed: false },
      theme: 'light',
    });
    expect(readPending()).toEqual([]);
  });

  it('远端写入抑制只消费匹配的下一次 storage 变更', async () => {
    const { markCloudStorageWrite, shouldSuppressCloudStorageChange } = await import(
      '../../apps/extension/src/features/cloudSync/storageChangeGate'
    );
    const settings = { display: { hideViewed: false }, theme: 'light' };

    markCloudStorageWrite(STORAGE_KEYS.SETTINGS, settings);

    expect(
      shouldSuppressCloudStorageChange(STORAGE_KEYS.SETTINGS, {
        oldValue: {},
        newValue: { display: { hideViewed: false }, theme: 'dark' },
      }),
    ).toBe(false);
    expect(
      shouldSuppressCloudStorageChange(STORAGE_KEYS.SETTINGS, {
        oldValue: {},
        newValue: settings,
      }),
    ).toBe(true);
    expect(
      shouldSuppressCloudStorageChange(STORAGE_KEYS.SETTINGS, {
        oldValue: {},
        newValue: settings,
      }),
    ).toBe(false);

    markCloudStorageWrite(STORAGE_KEYS.DASHBOARD_LAST_PAGE);
    expect(
      shouldSuppressCloudStorageChange(STORAGE_KEYS.DASHBOARD_LAST_PAGE, {
        oldValue: '#/records',
      }),
    ).toBe(true);
  });

  it('IDB 运行日志保留本地，任何级别都不会增量入队', async () => {
    vi.resetModules();
    const add = vi.fn().mockResolvedValue(7);
    const txStore = { add: vi.fn().mockResolvedValue(undefined), index: vi.fn() };
    const tx = { store: txStore, done: Promise.resolve() };

    vi.doMock('../../apps/extension/src/platform/storage/indexedDbConnection', () => ({
      initDB: vi.fn(async () => ({
        add,
        count: vi.fn().mockResolvedValue(1),
        transaction: vi.fn(() => tx),
        objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
        close: vi.fn(),
      })),
      resetDBConnection: vi.fn(),
    }));

    const { logsAdd, logsBulkAdd } = await import(
      '../../apps/extension/src/platform/storage/indexedDb'
    );

    await logsAdd({
      level: 'INFO',
      message: 'single log',
      timestamp: '2026-07-20T01:00:00.000Z',
    });
    await logsBulkAdd([
      {
        level: 'DEBUG',
        message: 'bulk debug log',
        timestamp: '2026-07-20T01:00:30.000Z',
      },
      {
        level: 'WARN',
        message: 'bulk warning log',
        timestamp: '2026-07-20T01:01:00.000Z',
      },
      {
        level: 'ERROR',
        message: 'bulk error log',
        timestamp: '2026-07-20T01:01:30.000Z',
      },
    ]);
    await flushStorageListener();

    expect(readPending().filter((item) => item.type === 'log')).toEqual([]);
  });

  it('IDB magnetPushLogs 写入保留本地，但不会增量入队', async () => {
    vi.resetModules();
    const add = vi.fn().mockResolvedValue(8);
    const txStore = { add: vi.fn().mockResolvedValue(undefined), index: vi.fn() };
    const tx = { store: txStore, done: Promise.resolve() };

    vi.doMock('../../apps/extension/src/platform/storage/indexedDbConnection', () => ({
      initDB: vi.fn(async () => ({
        add,
        count: vi.fn().mockResolvedValue(1),
        transaction: vi.fn(() => tx),
        objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
        close: vi.fn(),
      })),
      resetDBConnection: vi.fn(),
    }));

    const { magnetPushLogsAdd, magnetPushLogsBulkAdd } = await import(
      '../../apps/extension/src/platform/storage/indexedDb'
    );

    await magnetPushLogsAdd({
      type: 'push_success',
      videoId: 'AAA-001',
      message: 'single push',
      timestamp: Date.parse('2026-07-20T01:00:00.000Z'),
    });
    await magnetPushLogsBulkAdd([
      {
        type: 'push_failed',
        videoId: 'BBB-002',
        message: 'bulk push',
        timestamp: Date.parse('2026-07-20T01:01:00.000Z'),
      },
    ]);
    await flushStorageListener();

    expect(readPending().filter((item) => item.type === 'magnet_push_log')).toEqual([]);
  });
});
