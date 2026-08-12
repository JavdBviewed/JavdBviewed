/**
 * @file releaseAnnouncementModal.test.ts
 * @description release announcement modal 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
  mountReleaseAnnouncementModal,
} from '../../apps/extension/src/features/releaseAnnouncement';
import { mountDashboardReleaseAnnouncement } from '../../apps/extension/src/apps/dashboard/releaseAnnouncementBootstrap';

const storageState: Record<string, any> = {};

function installChromeStorageMock() {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      runtime: {
        id: 'test-runtime',
        getManifest: vi.fn(() => ({ version: '1.20.2' })),
        getURL: vi.fn((path: string) => `chrome-extension://test-runtime/${path}`),
      },
      storage: {
        local: {
          get: vi.fn((key: string, callback?: (items: Record<string, any>) => void) => {
            const result = Object.prototype.hasOwnProperty.call(storageState, key) ? { [key]: storageState[key] } : {};
            callback?.(result);
            return Promise.resolve(result);
          }),
          set: vi.fn((payload: Record<string, any>, callback?: () => void) => {
            Object.assign(storageState, payload);
            callback?.();
            return Promise.resolve();
          }),
        },
      },
    },
    configurable: true,
  });
}

describe('release announcement modal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    for (const key of Object.keys(storageState)) delete storageState[key];
  });

  it('mounts a themed update modal from pending storage and marks it seen on close', async () => {
    installChromeStorageMock();
    storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY] = {
      pending: {
        type: 'update',
        version: '1.20.2',
        previousVersion: '1.20.1',
        createdAt: 1000,
      },
    };

    await mountReleaseAnnouncementModal();

    const modal = document.querySelector<HTMLElement>('.jdb-release-announcement-modal');
    expect(modal?.textContent).toContain('Jav 助手已更新');
    expect(modal?.textContent).toContain('v1.20.2');
    expect(modal?.textContent).toContain('影片页新增在线可看、外部搜索和字幕搜索入口');
    expect(modal?.textContent).toContain('磁力升级多源聚合');
    expect(modal?.querySelectorAll('.jdb-release-burst').length).toBeGreaterThanOrEqual(3);
    expect(modal?.querySelectorAll('.jdb-release-burst-ring').length).toBe(0);
    expect(modal?.querySelectorAll('.jdb-release-spark').length).toBeGreaterThan(10);
    const styleText = document.getElementById('jdb-release-announcement-style')?.textContent;
    expect(styleText).toContain('animation: none;');
    expect(styleText).toContain('animation: jdbReleaseEnter 220ms ease-out both;');
    expect(styleText).toContain('width: 10px');
    expect(styleText).toContain('max-height: calc(100vh - 48px)');
    expect(styleText).toContain('overflow: auto');
    expect(styleText).not.toContain('jdbReleaseBurstRing');

    modal?.querySelector<HTMLButtonElement>('[data-action="release-announcement-close"]')?.click();
    await flushMicrotasks();

    expect(document.querySelector('.jdb-release-announcement-modal')).toBeNull();
    expect(storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY]).toEqual({
      lastSeenAnnouncementKey: '1.20.2',
      lastSeenAt: expect.any(Number),
    });
  });

  it('keeps close idempotent when the primary button is clicked repeatedly', async () => {
    installChromeStorageMock();
    storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY] = {
      pending: {
        type: 'update',
        version: '1.20.2',
        previousVersion: '1.20.1',
        createdAt: 1000,
      },
    };

    await mountReleaseAnnouncementModal();

    const closeButton = document.querySelector<HTMLButtonElement>('[data-action="release-announcement-close"]');
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    closeButton?.click();
    await flushMicrotasks();

    expect(document.querySelector('.jdb-release-announcement-modal')).toBeNull();
    expect(storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY]).toEqual({
      lastSeenAnnouncementKey: '1.20.2',
      lastSeenAt: expect.any(Number),
    });
  });

  it('does not mount when current announcement key was already seen', async () => {
    installChromeStorageMock();
    storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY] = {
      lastSeenAnnouncementKey: '1.20.2',
      pending: {
        type: 'update',
        version: '1.20.2',
        createdAt: 1000,
      },
    };

    await mountReleaseAnnouncementModal();

    expect(document.querySelector('.jdb-release-announcement-modal')).toBeNull();
  });

  it('forces an update modal from the dashboard debug query even after the version was seen', async () => {
    installChromeStorageMock();
    window.history.replaceState({}, '', '/dashboard/dashboard.html?debugReleaseAnnouncement=update#tab-home');
    storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY] = {
      lastSeenAnnouncementKey: '1.20.2',
      lastSeenAt: 2000,
    };

    await mountDashboardReleaseAnnouncement();

    const modal = document.querySelector<HTMLElement>('.jdb-release-announcement-modal');
    expect(modal?.textContent).toContain('Jav 助手已更新');
    expect(modal?.textContent).toContain('v1.20.2');
    expect(storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY]).toEqual({
      pending: expect.objectContaining({
        type: 'update',
        version: '1.20.2',
      }),
    });
  });

  it('also accepts the debug query inside the dashboard hash', async () => {
    installChromeStorageMock();
    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-home?debugReleaseAnnouncement=install');

    await mountDashboardReleaseAnnouncement();

    const modal = document.querySelector<HTMLElement>('.jdb-release-announcement-modal');
    expect(modal?.textContent).toContain('欢迎使用 Jav 助手');
    expect(storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY]).toEqual({
      pending: expect.objectContaining({
        type: 'install',
        version: '1.20.2',
      }),
    });
  });

  it('does not remount after closing a debug-triggered announcement and removing the debug query', async () => {
    installChromeStorageMock();
    window.history.replaceState({}, '', '/dashboard/dashboard.html?debugReleaseAnnouncement=update#tab-home');

    await mountDashboardReleaseAnnouncement();
    document.querySelector<HTMLButtonElement>('[data-action="release-announcement-close"]')?.click();
    await flushMicrotasks();

    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-home');
    await mountDashboardReleaseAnnouncement();

    expect(document.querySelector('.jdb-release-announcement-modal')).toBeNull();
    expect(storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY]).toEqual({
      lastSeenAnnouncementKey: '1.20.2',
      lastSeenAt: expect.any(Number),
    });
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
