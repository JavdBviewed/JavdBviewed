/**
 * @file backgroundUtilityHandlers.test.ts
 * @description background utility message handlers 测试
 * @module tests/extension
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applySchedulerConfigFromSettings,
  handlePrivacyLock,
  handleUpdateWatchedStatus,
  setupWebDAVSyncAlarm,
} from '../../apps/extension/src/apps/background/utilityMessageHandlers';

describe('background utility message handlers', () => {
  it('applies scheduler concurrency settings with defaults', async () => {
    const requestScheduler = { updateConfig: vi.fn() };

    await applySchedulerConfigFromSettings({
      getValue: vi.fn(async () => ({
        magnetSearch: {
          concurrency: {
            bgGlobalMaxConcurrent: 8,
            bgPerHostMaxConcurrent: 2,
            bgPerHostRateLimitPerMin: 20,
          },
        },
      })),
      requestScheduler: requestScheduler as any,
    });

    expect(requestScheduler.updateConfig).toHaveBeenCalledWith({
      globalMaxConcurrent: 8,
      perHostMaxConcurrent: 2,
      perHostRateLimitPerMin: 20,
    });
  });

  it('creates WebDAV sync alarm with clamped interval', async () => {
    await setupWebDAVSyncAlarm({
      getValue: vi.fn(async () => ({
        webdav: {
          enabled: true,
          autoSync: true,
          url: 'https://alist.example/dav',
          username: 'u',
          password: 'p',
          syncInterval: 2,
        },
      })),
      alarmName: 'webdav-sync',
    });

    expect(chrome.alarms.clear).toHaveBeenCalledWith('webdav-sync');
    expect(chrome.alarms.create).toHaveBeenCalledWith('webdav-sync', {
      delayInMinutes: 5,
      periodInMinutes: 5,
    });
  });

  it('updates watched status with a viewed record', async () => {
    const sendResponse = vi.fn();
    const viewedPut = vi.fn(async () => {});
    vi.setSystemTime(123456);

    await handleUpdateWatchedStatus({ videoId: 'abc123' }, sendResponse, viewedPut as any, async () => undefined);

    expect(viewedPut).toHaveBeenCalledWith(expect.objectContaining({
      id: 'abc123',
      status: 'viewed',
      createdAt: 123456,
      updatedAt: 123456,
    }));
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      record: expect.objectContaining({ id: 'abc123', status: 'viewed' }),
    });
  });

  it('preserves the existing record when a 115 push upgrades it to viewed', async () => {
    const sendResponse = vi.fn();
    const viewedGet = vi.fn(async () => ({
      id: 'abc123',
      title: 'Existing title',
      status: 'browsed' as const,
      tags: ['tag-a'],
      userTags: ['mine'],
      createdAt: 100,
      updatedAt: 200,
      javdbUrl: 'https://javdb.com/v/abc123',
      coverImage: 'https://image.example/cover.jpg',
      notes: 'keep this note',
    }));
    const viewedPut = vi.fn(async () => ({ success: true }));
    vi.setSystemTime(123456);

    await handleUpdateWatchedStatus(
      { videoId: 'abc123' },
      sendResponse,
      viewedPut as any,
      viewedGet as any,
    );

    expect(viewedPut).toHaveBeenCalledWith({
      id: 'abc123',
      title: 'Existing title',
      status: 'viewed',
      tags: ['tag-a'],
      userTags: ['mine'],
      createdAt: 100,
      updatedAt: 123456,
      javdbUrl: 'https://javdb.com/v/abc123',
      coverImage: 'https://image.example/cover.jpg',
      notes: 'keep this note',
    });
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      record: expect.objectContaining({
        id: 'abc123',
        status: 'viewed',
        title: 'Existing title',
      }),
    });
  });

  it('sends privacy lock trigger to dashboard tabs', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([{ id: 7, url: 'chrome-extension://test-runtime/dashboard/dashboard.html' } as chrome.tabs.Tab]);
    const sendResponse = vi.fn();

    await handlePrivacyLock(sendResponse);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'privacy-lock-trigger' });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});
