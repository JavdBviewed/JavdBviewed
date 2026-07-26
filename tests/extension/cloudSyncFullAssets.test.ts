/**
 * @file cloudSyncFullAssets.test.ts
 * @description Cloud 全量资产采集与恢复测试
 * @module tests/extension
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncEntity } from '@javdb/sync-protocol';
import { STORAGE_KEYS } from '../../apps/extension/src/utils/config';
import {
  getChromeStorageSnapshot,
  resetChromeMock,
  setChromeStorage,
} from '../setup/chrome';

type PutCall = {
  store: string;
  value: Record<string, unknown>;
};

const idbMock = vi.hoisted(() => ({
  stores: {} as Record<string, unknown[]>,
  putCalls: [] as PutCall[],
  bulk: {
    videos: [] as unknown[],
    actors: [] as unknown[],
    lists: [] as unknown[],
    newWorks: [] as unknown[],
  },
}));

vi.mock('../../apps/extension/src/platform/storage/indexedDb', () => ({
  initDB: vi.fn(async () => ({
    getAll: vi.fn(async (store: string) => idbMock.stores[store] ?? []),
    put: vi.fn(async (store: string, value: Record<string, unknown>) => {
      idbMock.putCalls.push({ store, value });
    }),
  })),
  viewedBulkPut: vi.fn(async (records: unknown[]) => {
    idbMock.bulk.videos.push(...records);
  }),
  actorsBulkPut: vi.fn(async (records: unknown[]) => {
    idbMock.bulk.actors.push(...records);
  }),
  listsBulkPut: vi.fn(async (records: unknown[]) => {
    idbMock.bulk.lists.push(...records);
  }),
  newWorksBulkPut: vi.fn(async (records: unknown[]) => {
    idbMock.bulk.newWorks.push(...records);
  }),
  viewedGet: vi.fn(),
  actorsGet: vi.fn(),
  listsGet: vi.fn(),
  newWorksGet: vi.fn(),
}));

function entityKey(entity: SyncEntity): string {
  return `${entity.type}/${entity.id}`;
}

describe('Cloud 全量资产同步', () => {
  beforeEach(() => {
    resetChromeMock();
    idbMock.stores = {};
    idbMock.putCalls = [];
    idbMock.bulk = {
      videos: [],
      actors: [],
      lists: [],
      newWorks: [],
    };
    vi.resetModules();
  });

  it('采集所有可恢复持久资产（含日志与 Cloud 配置），排除设备运行态', async () => {
    idbMock.stores = {
      viewedRecords: [{ id: 'ABC-001', title: 'A', status: 'viewed', updatedAt: 100 }],
      actors: [{ id: 'actor-1', name: 'Actor', updatedAt: 110 }],
      lists: [{ id: 'list-1', name: 'List', updatedAt: 120 }],
      newWorks: [{ id: 'work-1', discoveredAt: 130 }],
      magnets: [{ key: 'javdb:ABC-001:h1', videoId: 'ABC-001', source: 'javdb', createdAt: 140 }],
      insightsViews: [{ date: '2026-07-18', total: 3 }],
      insightsReports: [{ month: '2026-07', html: '<p>report</p>', createdAt: 150 }],
      newWorksDailyStats: [{ date: '2026-07-18', total: 4, unread: 2 }],
      logs: [{ id: 1, message: 'general log', timestampMs: 160, level: 'info' }],
      magnetPushLogs: [{ id: 2, message: 'push log', timestampMs: 170, type: 'push_success', videoId: 'ABC-001' }],
    };
    setChromeStorage({
      [STORAGE_KEYS.SETTINGS]: {
        theme: 'dark',
        display: { hideViewed: true },
        emby: {
          enabled: true,
          mediaServers: [
            {
              id: 'srv-1',
              type: 'emby',
              name: 'Home',
              url: 'http://emby.local:8096',
              apiKey: 'emby-key',
              accessToken: 'emby-token',
              enabled: true,
            },
          ],
        },
      },
      [STORAGE_KEYS.USER_PROFILE]: { email: 'u@example.com' },
      [STORAGE_KEYS.ADV_SEARCH_PRESETS]: { presetA: { name: 'Preset A' } },
      [STORAGE_KEYS.LOGS]: [{ message: 'legacy log' }],
      drive115_logs: [{ message: 'drive log' }],
      magnetPushLogs_backup: [{ message: 'backup log' }],
      cloud_sync_session_v1: { accessToken: 'secret' },
      cloud_sync_pending_v1: [{ id: 'pending' }],
      cloud_sync_cursors_v1: { video: 1 },
      cloud_sync_settings_v1: {
        baseUrl: 'http://127.0.0.1:18080',
        deviceLabel: '浏览器扩展',
        deviceId: 'dev-local-1',
        updatedAt: 180,
      },
      cloud_auto_sync_settings_v1: { enabled: true, intervalMinutes: 30 },
      [STORAGE_KEYS.IDB_MIGRATED]: true,
      [STORAGE_KEYS.IDB_LOGS_MIGRATED]: true,
      [STORAGE_KEYS.IDB_ACTORS_MIGRATED]: true,
      idb_magnet_push_logs_migrated: true,
      telemetry_client_state: { installId: 'install-1' },
      [STORAGE_KEYS.PRIVACY_SESSION]: { unlocked: true },
      [STORAGE_KEYS.PRIVACY_STATE]: { screenshotMode: true },
      [STORAGE_KEYS.EMBY_LIBRARY_STATE]: { items: [{ code: 'ABC-001' }] },
      [STORAGE_KEYS.DRIVE115_LIBRARY_STATE]: { items: [{ code: 'ABC-001', pickCode: 'pick-1' }] },
      [STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS]: { phase: 'scan', current: 12, total: 50 },
      [STORAGE_KEYS.MEDIA_WATCH_EVIDENCE]: { 'ABC-001': { progress: 80 } },
      [STORAGE_KEYS.DASHBOARD_LAST_PAGE]: '#/records',
      restore_backup_2026: { records: 1 },
    });

    const { collectLocalSyncEntities } = await import(
      '../../apps/extension/src/features/cloudSync/extensionEntityStore'
    );
    const entities = await collectLocalSyncEntities();
    const keys = new Set(entities.map(entityKey));

    expect([...keys]).toEqual(
      expect.arrayContaining([
        'video/ABC-001',
        'actor/actor-1',
        'list/list-1',
        'new_work/work-1',
        'magnet/javdb:ABC-001:h1',
        'insights_view/2026-07-18',
        'insights_report/2026-07',
        'new_work_daily_stat/2026-07-18',
        'log/1',
        'magnet_push_log/2',
        `storage_item/${STORAGE_KEYS.SETTINGS}`,
        `storage_item/${STORAGE_KEYS.LOGS}`,
        'storage_item/drive115_logs',
        'storage_item/magnetPushLogs_backup',
        'storage_item/cloud_sync_settings_v1',
        'storage_item/cloud_auto_sync_settings_v1',
        `storage_item/${STORAGE_KEYS.EMBY_LIBRARY_STATE}`,
        `storage_item/${STORAGE_KEYS.DRIVE115_LIBRARY_STATE}`,
        `storage_item/${STORAGE_KEYS.MEDIA_WATCH_EVIDENCE}`,
        `storage_item/${STORAGE_KEYS.DASHBOARD_LAST_PAGE}`,
        'storage_item/restore_backup_2026',
      ]),
    );
    expect(keys.has('storage_item/cloud_sync_session_v1')).toBe(false);
    expect(keys.has('storage_item/cloud_sync_pending_v1')).toBe(false);
    expect(keys.has('storage_item/cloud_sync_cursors_v1')).toBe(false);
    expect(keys.has(`storage_item/${STORAGE_KEYS.IDB_MIGRATED}`)).toBe(false);
    expect(keys.has('storage_item/idb_magnet_push_logs_migrated')).toBe(false);
    expect(keys.has('storage_item/telemetry_client_state')).toBe(false);
    expect(keys.has(`storage_item/${STORAGE_KEYS.PRIVACY_SESSION}`)).toBe(false);
    expect(keys.has(`storage_item/${STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS}`)).toBe(false);
    expect(keys.has('preference/display')).toBe(false);
    expect(keys.has('preference/dataSync')).toBe(false);
    expect(keys.has('preference/actorLibrary')).toBe(false);

    const settingsEntity = entities.find(
      (e) => e.type === 'storage_item' && e.id === STORAGE_KEYS.SETTINGS,
    );
    expect(settingsEntity?.payload).toMatchObject({
      key: STORAGE_KEYS.SETTINGS,
      value: {
        emby: {
          enabled: true,
          mediaServers: [
            expect.objectContaining({
              id: 'srv-1',
              apiKey: 'emby-key',
              accessToken: 'emby-token',
            }),
          ],
        },
      },
    });
  });

  it('应用远端新增类型时恢复到 IndexedDB 和 Chrome Storage', async () => {
    const { createExtensionEntityStore } = await import(
      '../../apps/extension/src/features/cloudSync/extensionEntityStore'
    );
    const store = createExtensionEntityStore();

    await store.applyRemote([
      {
        id: 'javdb:ABC-001:h1',
        type: 'magnet',
        revision: 2,
        updatedAt: 200,
        payload: { videoId: 'ABC-001', source: 'javdb' },
      },
      {
        id: '2026-07-18',
        type: 'insights_view',
        revision: 2,
        updatedAt: 210,
        payload: { total: 3 },
      },
      {
        id: '2026-07',
        type: 'insights_report',
        revision: 2,
        updatedAt: 220,
        payload: { html: '<p>report</p>' },
      },
      {
        id: '2026-07-18',
        type: 'new_work_daily_stat',
        revision: 2,
        updatedAt: 230,
        payload: { total: 4, unread: 2 },
      },
      {
        id: STORAGE_KEYS.DASHBOARD_LAST_PAGE,
        type: 'storage_item',
        revision: 2,
        updatedAt: 240,
        payload: { key: STORAGE_KEYS.DASHBOARD_LAST_PAGE, value: '#/cloud' },
      },
      {
        id: '11',
        type: 'log',
        revision: 2,
        updatedAt: 250,
        payload: { message: 'from cloud', timestampMs: 250, level: 'info' },
      },
      {
        id: '22',
        type: 'magnet_push_log',
        revision: 2,
        updatedAt: 260,
        payload: {
          message: 'push from cloud',
          timestampMs: 260,
          type: 'push_success',
          videoId: 'ABC-001',
        },
      },
    ]);

    expect(idbMock.putCalls).toEqual(
      expect.arrayContaining([
        {
          store: 'magnets',
          value: expect.objectContaining({ key: 'javdb:ABC-001:h1', videoId: 'ABC-001' }),
        },
        {
          store: 'insightsViews',
          value: expect.objectContaining({ date: '2026-07-18', total: 3 }),
        },
        {
          store: 'insightsReports',
          value: expect.objectContaining({ month: '2026-07', html: '<p>report</p>' }),
        },
        {
          store: 'newWorksDailyStats',
          value: expect.objectContaining({ date: '2026-07-18', total: 4, unread: 2 }),
        },
        {
          store: 'logs',
          value: expect.objectContaining({ id: 11, message: 'from cloud' }),
        },
        {
          store: 'magnetPushLogs',
          value: expect.objectContaining({ id: 22, message: 'push from cloud', videoId: 'ABC-001' }),
        },
      ]),
    );
    expect(getChromeStorageSnapshot()[STORAGE_KEYS.DASHBOARD_LAST_PAGE]).toBe('#/cloud');
  });

  it('同批远端同时有旧 preference 和完整 settings 时以 storage_item 为准', async () => {
    const { createExtensionEntityStore } = await import(
      '../../apps/extension/src/features/cloudSync/extensionEntityStore'
    );
    const store = createExtensionEntityStore();

    await store.applyRemote([
      {
        id: STORAGE_KEYS.SETTINGS,
        type: 'storage_item',
        revision: 2,
        updatedAt: 240,
        payload: {
          key: STORAGE_KEYS.SETTINGS,
          value: {
            display: { hideViewed: false },
            dataSync: { enabled: true },
            actorLibrary: { enabled: true },
            emby: {
              enabled: true,
              mediaServers: [
                {
                  id: 'srv-1',
                  type: 'emby',
                  name: 'Home',
                  url: 'http://emby.local:8096',
                  apiKey: 'emby-key',
                  accessToken: 'emby-token',
                  enabled: true,
                },
              ],
            },
          },
        },
      },
      {
        id: 'display',
        type: 'preference',
        revision: 3,
        updatedAt: 250,
        payload: { key: 'display', value: { hideViewed: true } },
      },
    ]);

    expect(getChromeStorageSnapshot()[STORAGE_KEYS.SETTINGS]).toMatchObject({
      display: { hideViewed: false },
      dataSync: { enabled: true },
      actorLibrary: { enabled: true },
      emby: {
        enabled: true,
        mediaServers: [
          expect.objectContaining({
            id: 'srv-1',
            apiKey: 'emby-key',
            accessToken: 'emby-token',
          }),
        ],
      },
    });
  });

  it('应用远端 Cloud 连接配置时保留本机 deviceId', async () => {
    setChromeStorage({
      cloud_sync_settings_v1: {
        baseUrl: 'http://old.local:18080',
        deviceLabel: '旧设备',
        deviceId: 'local-device-keep',
        updatedAt: 100,
      },
    });
    const { createExtensionEntityStore } = await import(
      '../../apps/extension/src/features/cloudSync/extensionEntityStore'
    );
    const store = createExtensionEntityStore();

    await store.applyRemote([
      {
        id: 'cloud_sync_settings_v1',
        type: 'storage_item',
        revision: 5,
        updatedAt: 300,
        payload: {
          key: 'cloud_sync_settings_v1',
          value: {
            baseUrl: 'http://cloud.example:18080',
            deviceLabel: '远端标签',
            deviceId: 'remote-device-should-not-win',
            updatedAt: 300,
          },
        },
      },
    ]);

    expect(getChromeStorageSnapshot().cloud_sync_settings_v1).toEqual({
      baseUrl: 'http://cloud.example:18080',
      deviceLabel: '远端标签',
      deviceId: 'local-device-keep',
      updatedAt: 300,
    });
  });
});
