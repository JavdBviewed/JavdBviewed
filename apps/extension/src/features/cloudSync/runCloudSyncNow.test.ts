/**
 * @file runCloudSyncNow.test.ts
 * @description Cloud 同步运行进度与性能指标回归
 * @module features/cloudSync
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadSettings: vi.fn(),
  listPending: vi.fn(),
  collectEntities: vi.fn(),
  createEntityStore: vi.fn(),
  prepareQueue: vi.fn(),
  createCursorStore: vi.fn(),
  createClient: vi.fn(),
  createSyncEngine: vi.fn(),
  countByType: vi.fn(),
}));

vi.mock('@javdb/sync-client', () => ({ createSyncEngine: mocks.createSyncEngine }));
vi.mock('./chromeTokenStore', () => ({ loadCloudSession: mocks.loadSession }));
vi.mock('./cloudSettingsStorage', () => ({ loadCloudSettings: mocks.loadSettings }));
vi.mock('./chromePendingStore', () => ({ listCloudPending: mocks.listPending }));
vi.mock('./chromeCursorStore', () => ({ createChromeCursorStore: mocks.createCursorStore }));
vi.mock('./createExtensionCloudClient', () => ({ createExtensionCloudClient: mocks.createClient }));
vi.mock('./extensionEntityStore', () => ({
  collectLocalSyncEntities: mocks.collectEntities,
  createExtensionEntityStore: mocks.createEntityStore,
  preparePushQueueStats: mocks.prepareQueue,
}));
vi.mock('./syncStats', () => ({ countByType: mocks.countByType }));

import { runCloudSyncNow } from './runCloudSyncNow';

describe('runCloudSyncNow progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSession.mockResolvedValue({ accessToken: 'access', deviceId: 'device-1' });
    mocks.loadSettings.mockResolvedValue({ deviceId: 'device-1' });
    mocks.collectEntities.mockResolvedValue([{ id: 'snapshot-1', type: 'video' }]);
    mocks.prepareQueue.mockResolvedValue({ localEntityCount: 1, pendingCount: 2, enqueuedNow: 1 });
    mocks.listPending.mockResolvedValue([{ id: 'pending-1', type: 'video' }, { id: 'pending-2', type: 'actor' }]);
    mocks.countByType.mockReturnValue({ video: 1 });
    mocks.createEntityStore.mockReturnValue({});
    mocks.createCursorStore.mockReturnValue({});
    mocks.createClient.mockResolvedValue({ api: {} });
    mocks.createSyncEngine.mockReturnValue({
      syncSession: async (_deviceId: string, options?: {
        onProgress?: (event: Record<string, unknown>) => void;
      }) => {
        options?.onProgress?.({ stage: 'uploading', pendingCount: 2, requestBytes: 2_048 });
        options?.onProgress?.({
          stage: 'applying',
          pendingCount: 2,
          requestBytes: 2_048,
          uploaded: 2,
          downloaded: 1,
        });
        return {
          response: {
            stats: { uploaded: 2, downloaded: 1 },
            code: 'SYNC_OK',
            message: '同步完成',
          },
          metrics: { requestBytes: 2_048, uncompressedRequestBytes: 4_096, sessionDurationMs: 400 },
        };
      },
    });
  });

  it('forwards truthful sync stages and exposes session rate metrics', async () => {
    const events: Array<Record<string, unknown>> = [];

    const result = await runCloudSyncNow({
      onProgress: (event) => events.push(event),
    });

    expect(events.map((event) => event.stage)).toEqual([
      'preparing',
      'uploading',
      'applying',
      'complete',
    ]);
    expect(events[0]).toMatchObject({ localEntityCount: 1, pendingCount: 2 });
    expect(events[1]).toMatchObject({ requestBytes: 2_048, pendingCount: 2 });
    expect(events[2]).toMatchObject({ uploaded: 2, downloaded: 1 });
    expect(events[3]).toMatchObject({ averageSessionRateBytesPerSecond: 5_120 });
    expect(result).toMatchObject({
      requestBytes: 2_048,
      uncompressedRequestBytes: 4_096,
      sessionDurationMs: 400,
      averageSessionRateBytesPerSecond: 5_120,
    });
  });
});
