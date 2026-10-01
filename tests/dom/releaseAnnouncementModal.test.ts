/**
 * @file releaseAnnouncementModal.test.ts
 * @description release announcement modal 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
  RELEASE_NOTES,
  mountReleaseAnnouncementModal,
  type ResolvedReleaseAnnouncement,
} from '../../apps/extension/src/features/releaseAnnouncement';
import {
  MAX_ANNOUNCEMENT_HIGHLIGHTS,
  createReleaseAnnouncementModal,
} from '../../apps/extension/src/features/releaseAnnouncement/ui/releaseAnnouncementModal';
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

  it('caps update highlights at 7 and exposes the GitHub release tag link', async () => {
    installChromeStorageMock();
    storageState[RELEASE_ANNOUNCEMENT_STORAGE_KEY] = {
      pending: {
        type: 'update',
        version: '2.1.0',
        previousVersion: '2.0.1',
        createdAt: 1000,
      },
    };

    await mountReleaseAnnouncementModal('2.1.0');

    const notes = RELEASE_NOTES.find(note => note.version === '2.1.0')?.highlights ?? [];
    const visible = notes.slice(0, MAX_ANNOUNCEMENT_HIGHLIGHTS);
    expect(MAX_ANNOUNCEMENT_HIGHLIGHTS).toBe(7);

    const modal = document.querySelector<HTMLElement>('.jdb-release-announcement-modal');
    const items = Array.from(modal?.querySelectorAll<HTMLLIElement>('.jdb-release-highlights li') ?? []);
    expect(items.length).toBe(visible.length);
    expect(items.map(item => item.textContent)).toEqual(visible);
    if (notes.length > MAX_ANNOUNCEMENT_HIGHLIGHTS) {
      expect(items.length).toBe(7);
      expect(modal?.textContent).not.toContain(notes[MAX_ANNOUNCEMENT_HIGHLIGHTS]);
    }

    const more = modal?.querySelector<HTMLAnchorElement>('a.jdb-release-more');
    expect(more?.textContent).toBe('更多');
    expect(more?.getAttribute('href')).toBe('https://github.com/JavdBviewed/JavdBviewed/releases/tag/v2.1.0');
    expect(more?.getAttribute('target')).toBe('_blank');
    expect(more?.getAttribute('rel')).toBe('noopener');

    const styleText = document.getElementById('jdb-release-announcement-style')?.textContent;
    expect(styleText).toContain('.jdb-release-more');
  });

  it('caps an over-long update announcement at 7 independently of release notes data', () => {
    const highlights = Array.from({ length: 19 }, (_, index) => `更新要点 ${index + 1}，超出 7 条上限的部分不再渲染。`);
    const announcement = {
      type: 'update',
      announcementKey: '9.9.9',
      version: '9.9.9',
      title: 'Jav 助手已更新',
      subtitle: '合成 19 条，锁定 7 条硬上限与 tag 链接推导。',
      highlights,
      primaryActionLabel: '知道了',
    } satisfies ResolvedReleaseAnnouncement;

    const modal = createReleaseAnnouncementModal(announcement);
    const items = Array.from(modal.querySelectorAll<HTMLLIElement>('.jdb-release-highlights li'));
    expect(items.length).toBe(7);
    expect(items.map(item => item.textContent)).toEqual(highlights.slice(0, 7));
    expect(modal.textContent).not.toContain(highlights[7]);

    const more = modal.querySelector<HTMLAnchorElement>('a.jdb-release-more');
    expect(more?.textContent).toBe('更多');
    expect(more?.getAttribute('href')).toBe('https://github.com/JavdBviewed/JavdBviewed/releases/tag/v9.9.9');
  });

  it('caps install welcome highlights at 7 and never renders the more link', () => {
    const announcement = {
      type: 'install',
      announcementKey: '2.1.0',
      version: '2.1.0',
      title: '欢迎使用 Jav 助手',
      subtitle: '安装欢迎文案，用于验证 7 条上限同样适用。',
      highlights: Array.from({ length: 19 }, (_, index) => `安装要点 ${index + 1}，超出上限的部分不再渲染。`),
      primaryActionLabel: '开始使用',
    } satisfies ResolvedReleaseAnnouncement;

    const modal = createReleaseAnnouncementModal(announcement);
    const items = modal.querySelectorAll('.jdb-release-highlights li');
    expect(items.length).toBe(7);
    expect(modal.querySelectorAll('a.jdb-release-more').length).toBe(0);
  });

  it('still renders the more link for update announcements with fewer than 7 highlights', () => {
    const announcement = {
      type: 'update',
      announcementKey: '2.0.1',
      version: '2.0.1',
      title: 'Jav 助手已更新',
      subtitle: 'v2.0.1 已安装，以下是本次主要变化。',
      highlights: [
        '媒体库入口已开放，Dashboard 分类导航重新整理。',
        'WebDAV 支持默认备份端与全部备份端上传。',
        '新增本地 ZIP 备份与恢复能力。',
      ],
      primaryActionLabel: '知道了',
    } satisfies ResolvedReleaseAnnouncement;

    const modal = createReleaseAnnouncementModal(announcement);
    expect(modal.querySelectorAll('.jdb-release-highlights li').length).toBe(3);

    const more = modal.querySelector<HTMLAnchorElement>('a.jdb-release-more');
    expect(more?.textContent).toBe('更多');
    expect(more?.getAttribute('href')).toBe('https://github.com/JavdBviewed/JavdBviewed/releases/tag/v2.0.1');
    expect(more?.getAttribute('target')).toBe('_blank');
    expect(more?.getAttribute('rel')).toBe('noopener');
  });

  it('omits the more link when an update announcement carries no version', () => {
    const announcement = {
      type: 'update',
      announcementKey: 'release-announcement-fallback',
      title: 'Jav 助手已更新',
      subtitle: '以下是本次主要变化。',
      highlights: Array.from({ length: 19 }, (_, index) => `更新要点 ${index + 1}，无法拼出 tag 链接。`),
      primaryActionLabel: '知道了',
    } satisfies ResolvedReleaseAnnouncement;

    const modal = createReleaseAnnouncementModal(announcement);
    expect(modal.querySelectorAll('.jdb-release-highlights li').length).toBe(7);
    expect(modal.querySelectorAll('a.jdb-release-more').length).toBe(0);
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
