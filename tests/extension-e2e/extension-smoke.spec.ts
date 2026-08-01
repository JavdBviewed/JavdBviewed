/**
 * @file extension-smoke.spec.ts
 * @description 用真实 Chromium profile 加载构建后的 MV3 拓展并打开核心拓展页面
 * @module tests/extension-e2e
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
} from '../../scripts/extensionHarness';

test.describe('JavdBviewed extension browser smoke', () => {
  test('loads extension service worker, popup, and dashboard without page errors', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      expect(extensionId).toBe('gnegjfjccmeafanpmbjboegcbchcghka');
      await markReleaseAnnouncementSeenInContext(context);

      await assertExtensionPageHealthy(context, extensionPageUrl(extensionId, 'popup/popup.html'));
      await assertExtensionPageHealthy(context, extensionPageUrl(extensionId, 'dashboard/dashboard.html'));

      if (harnessOptions.startupUrl) {
        const targetPage = await context.newPage();
        await targetPage.goto(harnessOptions.startupUrl, { waitUntil: 'domcontentloaded' });
        await expect(targetPage.locator('body')).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('shows the saved 115 index resume countdown after the dashboard page reloads', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/drive115-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => {
        const now = Date.now();
        return chrome.storage.local.set({
          settings: {
            drive115: {
              enabled: true,
              mediaLibraryRoots: [{ cid: 'e2e-resume-root', name: 'E2E 片库', enabled: true }],
              mediaLibraryLastIndexError: '目录访问暂时失败，已保存进度等待继续',
            },
          },
          drive115_library_index_checkpoint: {
            version: 1,
            rootCids: ['e2e-resume-root'],
            scanDepth: 2,
            nextRootIndex: 0,
            pendingQueue: [{
              cid: 'e2e-resume-folder',
              name: 'E2E 影片目录',
              depth: 1,
              rootCid: 'e2e-resume-root',
            }],
            stats: {
              roots: 1,
              foldersSeen: 12,
              indexed: 2,
              skipped: 1,
              unrecognized: 0,
              apiCalls: 13,
              truncatedFolders: 0,
            },
            containerFoldersSeen: 3,
            report: {
              version: 1,
              indexed: [],
              skipped: [],
              indexedTotal: 2,
              skippedTotal: 1,
              skipReasonCounts: { no_video: 1 },
              rootsTotal: 1,
              rootsDone: 0,
              apiCalls: 13,
              startedAt: now - 60_000,
              finishedAt: now,
              truncated: false,
              truncatedFolders: 0,
            },
            resumeAt: now + 5 * 60_000,
            createdAt: now,
            updatedAt: now,
          },
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      const resumeNotice = page.locator('[data-drive115-index-resume="1"]');
      await expect(resumeNotice).toBeVisible();
      await expect(resumeNotice).toContainText('将在');
      await expect(resumeNotice).toContainText('自动继续');
      await expect(resumeNotice).toContainText('可以关闭此管理页面');
      await expect(resumeNotice).toContainText('关闭浏览器或关机不会丢失进度');
    } finally {
      await context.close();
    }
  });

  test('opens the latest 115 index report directly and lists 20 history records', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/drive115-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => {
        const now = Date.now();
        const makeReport = (index: number) => ({
          indexed: [],
          skipped: [],
          indexedTotal: index + 1,
          skippedTotal: index,
          skipReasonCounts: {},
          truncatedList: false,
          rootsTotal: 1,
          rootsDone: 1,
          apiCalls: index + 2,
          truncatedFolders: 0,
          startedAt: now - index * 60_000,
          finishedAt: now - index * 60_000 + 1_000,
        });
        const history = Array.from({ length: 20 }, (_, index) => makeReport(index));
        return chrome.storage.local.set({
          settings: {
            drive115: {
              enabled: true,
              mediaLibraryRoots: [{ cid: 'e2e-history-root', name: 'E2E 片库', enabled: true }],
            },
          },
          drive115_library_index_report: history[0],
          drive115_library_index_history: history,
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page.locator('#drive115ViewLastIndexReport')).toHaveText('上次记录');
      await expect(page.locator('#drive115ViewIndexHistory')).toContainText('索引历史');

      await page.locator('#drive115ViewLastIndexReport').click();
      const latestDialog = page.getByRole('dialog', { name: '上次索引记录' });
      await expect(latestDialog).toBeVisible();

      await latestDialog.getByRole('button', { name: '关闭' }).click();
      await page.locator('#drive115ViewIndexHistory').click();
      const historyDialog = page.getByRole('dialog', { name: '索引历史' });
      await expect(historyDialog).toBeVisible();
      await expect(historyDialog.locator('[data-drive115-index-history-item="1"]')).toHaveCount(20);
      await expect(historyDialog).toContainText('最近 20 次索引');
      await historyDialog.locator('[data-drive115-index-history-item="1"]').nth(19).click();
      await expect(historyDialog).toContainText('入库 1');
    } finally {
      await context.close();
    }
  });

  test('renders 115 progress on cards, resume list, and pending credential refresh toast', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => {
        const now = Date.now();
        return chrome.storage.local.set({
          drive115_library_state: {
            updatedAt: now,
            entries: [
              {
                code: 'E2E-115',
                title: 'E2E-115 自动化测试',
                videoFileId: 'file-e2e-115',
                pickCode: 'pick-e2e-115',
                coverPickCode: 'cover-e2e-115',
                fileName: 'E2E-115.mp4',
                folderName: 'E2E-115',
                updatedAt: now,
              },
            ],
          },
          media_cleanup_state: {
            version: 1,
            items: {
              'E2E-CLEANUP': {
                id: 'E2E-CLEANUP',
                titleId: 'E2E-CLEANUP',
                code: 'E2E-CLEANUP',
                title: 'E2E 清理确认测试',
                reason: 'watched',
                addedAt: now,
                updatedAt: now,
                copies: {
                  '115:file-e2e-cleanup': {
                    copyId: '115:file-e2e-cleanup',
                    source: '115',
                    serverName: '115 片库',
                    fileId: 'file-e2e-cleanup',
                    coverPickCode: 'cover-e2e-115',
                    fileName: 'E2E-CLEANUP.mp4',
                    watchedAt: now,
                    lastFoundAt: now,
                    status: 'pending',
                    updatedAt: now,
                  },
                  'emby:http://emby.invalid:item-e2e-cleanup': {
                    copyId: 'emby:http://emby.invalid:item-e2e-cleanup',
                    source: 'emby',
                    serverName: 'E2E Emby',
                    serverUrl: 'http://emby.invalid',
                    itemId: 'item-e2e-cleanup',
                    coverImageUrl: 'https://example.invalid/e2e-emby-cover.jpg',
                    fileName: 'E2E-CLEANUP.mkv',
                    watchedAt: now,
                    lastFoundAt: now,
                    status: 'pending',
                    updatedAt: now,
                  },
                },
              },
            },
            observedWatchedCopyIds: ['115:file-e2e-cleanup'],
            updatedAt: now,
          },
          media_deletion_history: { version: 1, records: {}, updatedAt: now },
        });
      });
      await page.evaluate(() => new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'MEDIA_WATCH_EVIDENCE_REPORT',
          code: 'E2E-115.mp4',
          source: 'drive115',
          percent: 50,
          positionSec: 600,
          durationSec: 1200,
          pickCode: 'pick-e2e-115',
          fileId: 'file-e2e-115',
          fileName: 'E2E-115.mp4',
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.success) {
            reject(new Error(response?.error || '上报 115 进度失败'));
            return;
          }
          resolve();
        });
      }));
      await page.addInitScript(() => {
        const installCoverMock = () => {
          const runtime = chrome?.runtime as typeof chrome.runtime & { __e2eCoverMockInstalled?: boolean };
          if (!runtime || runtime.__e2eCoverMockInstalled) return;
          const originalSendMessage = runtime.sendMessage.bind(runtime);
          runtime.__e2eCoverMockInstalled = true;
          runtime.sendMessage = ((...args: Parameters<typeof chrome.runtime.sendMessage>) => {
            const message = args.length > 0 && typeof args[0] === 'object' ? args[0] : args[1];
            const callback = args.find((arg) => typeof arg === 'function') as ((response: unknown) => void) | undefined;
            if (
              message
              && typeof message === 'object'
              && 'type' in message
              && message.type === 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL'
            ) {
              window.setTimeout(() => {
                callback?.({ success: true, url: 'https://example.invalid/e2e-115-cover.jpg' });
              }, 0);
              return undefined;
            }
            return originalSendMessage(...args);
          }) as typeof chrome.runtime.sendMessage;
        };
        installCoverMock();
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page.locator('.ml-view-shell')).toBeVisible();
      await expect(page.locator('.ml-view-summary')).toContainText('项');
      await expect(page.getByRole('button', { name: '同步媒体库' })).toBeVisible();
      await expect(page.locator('.ml-view-command-group').getByRole('button', { name: '刷新' })).toHaveCount(0);
      await expect(page.locator('.ml-view-command-group').getByRole('button', { name: '115' })).toHaveCount(0);
      await expect(page.locator('.ml-view-command-group').getByRole('button', { name: '清理' })).toHaveCount(0);
      await page.getByRole('button', { name: '媒体库工具' }).click();
      await expect(page.locator('[data-media-tools-panel="1"]')).toBeVisible();
      await expect(page.getByRole('button', { name: /115 手动播放/ })).toBeVisible();
      const cleanupTool = page.getByRole('button', { name: /已看影片整理/ });
      await expect(cleanupTool).toBeVisible();
      await cleanupTool.click();
      const cleanupOverlay = page.locator('[data-media-cleanup-overlay="1"]');
      await expect(cleanupOverlay).toBeVisible();
      await expect(cleanupOverlay.getByRole('button', { name: '查找已看影片' })).toBeVisible();
      await expect(cleanupOverlay.getByRole('tab', { name: '待处理' })).toBeVisible();
      await expect(cleanupOverlay.getByRole('tab', { name: '处理失败' })).toBeVisible();
      await expect(cleanupOverlay.getByRole('tab', { name: '操作记录' })).toBeVisible();
      const cleanupCard = cleanupOverlay.locator('[data-media-cleanup-card="1"]');
      await expect(cleanupCard).toHaveCount(1);
      await expect(cleanupCard).toContainText('115 网盘 · 115 片库 · 1 个文件');
      await expect(cleanupCard).toContainText('Emby · E2E Emby · 1 个文件');
      await cleanupOverlay.getByRole('checkbox', { name: '选择 E2E-CLEANUP 的全部来源文件' }).check();
      await cleanupOverlay.getByRole('button', { name: '删除选中的文件' }).click();
      const confirmDialog = cleanupOverlay.getByRole('alertdialog');
      await expect(confirmDialog).toContainText('确认删除 2 个文件');
      await expect(confirmDialog).toContainText('115 网盘 1 个文件');
      await expect(confirmDialog).toContainText('Emby 1 个文件');
      await expect(confirmDialog).toContainText('115 文件会移入回收站');
      await confirmDialog.getByRole('button', { name: '取消' }).click();
      await expect(confirmDialog).toHaveCount(0);
      const cleanupStateAfterCancel = await page.evaluate(async () => (
        (await chrome.storage.local.get('media_cleanup_state')).media_cleanup_state
      ));
      expect(cleanupStateAfterCancel.items['E2E-CLEANUP'].copies['115:file-e2e-cleanup'].status).toBe('pending');
      await page.locator('.ui-overlay-shell__win-btn--close').last().click();
      await page.getByRole('button', { name: '同步媒体库' }).click();
      await expect(page.locator('[data-media-sync-panel="1"]')).toBeVisible();
      const syncPanel = page.locator('[data-media-sync-panel="1"]');
      await expect(syncPanel.getByText('全选', { exact: true })).toBeVisible();
      await expect(syncPanel.getByRole('checkbox').first()).toBeChecked();
      await expect(syncPanel.getByRole('button', { name: '同步全部来源' })).toBeVisible();
      await page.locator('.ui-overlay-shell__win-btn--close').click();
      await expect(page.getByRole('button', { name: '视图' })).toBeVisible();
      await page.getByRole('button', { name: '视图' }).click();
      await expect(page.getByRole('heading', { name: '卡片外观' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '显示内容' })).toBeVisible();
      await expect(page.getByRole('button', { name: '恢复默认' })).toBeVisible();
      await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '完成', exact: true }).click();

      const heroDots = page.locator('.ml-hero-dot');
      if (await heroDots.count() > 1) {
        await heroDots.last().click();
        await expect(heroDots.last()).toHaveClass(/is-active/);
        const hero = page.locator('.ml-hero');
        const beforeStep = Number(await hero.getAttribute('data-hero-step'));
        await page.getByRole('button', { name: '下一张' }).click();
        await expect(heroDots.first()).toHaveClass(/is-active/);
        await expect(hero).toHaveAttribute('data-hero-step', String(beforeStep + 1));
        await expect(hero.locator('.ml-hero-card[data-active="1"]')).toHaveAttribute('data-item-index', '0');
      }

      await expect(page.locator('.ml-card[data-code="E2E-115"] .ml-card-progress')).toBeVisible();
      await expect(page.locator('.ml-card[data-code="E2E-115"] .ml-card-progress-fill')).toHaveAttribute(
        'style',
        /width:\s*50%/,
      );
      const resume115 = page.locator('.ml-resume-card').filter({ hasText: 'E2E-115' });
      await expect(resume115).toBeVisible();
      await expect(resume115.locator('.ml-resume-cover')).toHaveCSS(
        'background-image',
        /e2e-115-cover\.jpg/,
      );

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('drive115:tokenRefresh', {
          detail: { phase: 'start', at: Date.now(), source: 'auto' },
        }));
      });
      await expect(page.locator('#messageContainer .toast').filter({ hasText: '正在刷新 115 凭证' })).toBeVisible();
      await page.waitForTimeout(5500);
      await expect(page.locator('#messageContainer .toast').filter({ hasText: '正在刷新 115 凭证' })).toBeVisible();

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('drive115:tokenRefresh', {
          detail: { phase: 'success', at: Date.now(), source: 'auto', expiresIn: 7200 },
        }));
      });
      await expect(page.locator('#messageContainer .toast').filter({ hasText: '115 凭证刷新成功' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('keeps Emby continue watching visible after local progress cache and reload', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => {
        const now = Date.now();
        return chrome.storage.local.set({
          settings: {
            emby: {
              mediaServers: [
                {
                  id: 'e2e-emby',
                  type: 'emby',
                  name: 'E2E Emby',
                  url: 'http://127.0.0.1:9',
                  apiKey: 'e2e-api-key',
                  enabled: true,
                },
              ],
            },
          },
          emby_library_state: {
            updatedAt: now,
            entries: {
              'E2E-EMBY': [
                {
                  serverType: 'emby',
                  serverName: 'E2E Emby',
                  serverUrl: 'http://127.0.0.1:9',
                  itemId: 'emby-e2e-item',
                  itemName: 'E2E-EMBY 自动化测试',
                  updatedAt: now,
                },
              ],
            },
          },
        });
      });

      await page.evaluate(() => new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'EMBY_LIBRARY_REPORT_PROGRESS',
          itemId: 'emby-e2e-item',
          serverUrl: 'http://127.0.0.1:9',
          positionSeconds: 300,
          durationSeconds: 600,
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.success) {
            reject(new Error(response?.error || '上报 Emby 进度失败'));
            return;
          }
          resolve();
        });
      }));
      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page.locator('.ml-card[data-code="E2E-EMBY"] .ml-card-progress')).toBeVisible();
      await expect(page.locator('.ml-card[data-code="E2E-EMBY"] .ml-card-progress-fill')).toHaveAttribute(
        'style',
        /width:\s*50%/,
      );
      await expect(page.locator('.ml-resume-card').filter({ hasText: 'E2E-EMBY' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('aggregates the same title and asks for a source before multi-copy playback', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);
      await page.evaluate(() => {
        const now = Date.now();
        return chrome.storage.local.set({
          emby_library_state: {
            updatedAt: now,
            entries: {
              'EETM-001': [{
                serverType: 'emby',
                serverName: 'E2E Emby',
                serverUrl: 'http://emby.e2e.local:8096',
                itemId: 'emby-multi-item',
                itemName: 'EETM-001 多来源影片',
                updatedAt: now,
              }],
            },
          },
          drive115_library_state: {
            updatedAt: now,
            entries: [{
              code: 'EETM-001',
              title: 'EETM-001 多来源影片',
              videoFileId: 'drive-multi-item',
              pickCode: 'drive-multi-pick',
              fileName: 'EETM-001.mp4',
              updatedAt: now,
            }],
          },
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      const card = page.locator('.ml-card[data-code="EETM-001"]');
      await expect(card).toHaveCount(1);
      await expect(card.locator('[data-media-copy-count="2"]')).toHaveText('2 个来源');
      await expect(card.locator('.ml-card-source-row')).toContainText('Emby · E2E Emby');
      await expect(card.locator('.ml-card-source-row')).toContainText('115 · 115 片库');
      await card.getByRole('button', { name: '扩展内播放' }).click();
      const chooser = page.locator('[data-media-source-choice="1"]');
      await expect(chooser).toBeVisible();
      await expect(chooser.getByRole('button')).toHaveCount(2);
      await expect(chooser).toContainText('Emby · E2E Emby');
      await expect(chooser).toContainText('115 · 115');
    } finally {
      await context.close();
    }
  });

  test('uses configured media source channels and wide secret editor', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => {
        const now = Date.now();
        return chrome.storage.local.set({
          settings: {
            emby: {
              enabled: true,
              mediaServers: [
                {
                  id: 'e2e-emby',
                  type: 'emby',
                  name: '主服务器',
                  url: 'http://emby.e2e.local:8096/',
                  apiKey: 'emby-secret',
                  username: 'e2e-user',
                  password: 'e2e-password',
                  enabled: true,
                },
                {
                  id: 'e2e-jellyfin',
                  type: 'jellyfin',
                  name: '家庭影音',
                  url: 'http://jellyfin.e2e.local:8096',
                  apiKey: 'jellyfin-secret',
                  enabled: true,
                },
                {
                  id: 'e2e-disabled',
                  type: 'emby',
                  name: '停用服务器',
                  url: 'http://disabled.e2e.local:8096',
                  apiKey: 'disabled-secret',
                  enabled: false,
                },
              ],
            },
            drive115: {
              enabled: true,
              mediaLibraryRoots: [{ cid: 'e2e-root', name: '115 测试片库', enabled: true }],
            },
          },
          emby_library_state: {
            updatedAt: now,
            entries: {
              'E2E-EMBY-SOURCE': [{
                serverType: 'emby',
                serverName: '主服务器',
                serverUrl: 'http://emby.e2e.local:8096',
                itemId: 'emby-source-item',
                itemName: 'Emby 渠道影片',
                updatedAt: now,
              }],
              'E2E-JF-SOURCE': [{
                serverType: 'jellyfin',
                serverName: '家庭影音',
                serverUrl: 'http://jellyfin.e2e.local:8096/',
                itemId: 'jf-source-item',
                itemName: 'Jellyfin 渠道影片',
                updatedAt: now,
              }],
            },
          },
          drive115_library_state: {
            updatedAt: now,
            entries: [{
              code: 'E2E-115-SOURCE',
              title: '115 渠道影片',
              videoFileId: 'drive-source-item',
              pickCode: 'drive-source-pick',
              fileName: 'E2E-115-SOURCE.mp4',
              folderName: 'E2E-115-SOURCE',
              updatedAt: now,
            }],
          },
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      const sourceSelect = page.getByRole('combobox', { name: '来源筛选' });
      await expect(sourceSelect.locator('option')).toHaveText([
        '全部来源',
        'Emby · 主服务器',
        'Jellyfin · 家庭影音',
        '115 片库',
      ]);
      const embyValue = await sourceSelect.locator('option', { hasText: 'Emby · 主服务器' }).getAttribute('value');
      expect(embyValue).toBeTruthy();
      await sourceSelect.selectOption(embyValue || 'all');
      await expect(page.locator('.ml-card')).toHaveCount(1);
      await expect(page.locator('.ml-card[data-code="E2E-EMBY-SOURCE"]')).toBeVisible();

      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/emby-settings'), {
        waitUntil: 'domcontentloaded',
      });
      const summary = page.locator('.emby-media-server-summary').filter({ hasText: '主服务器' });
      await expect(summary).toBeVisible();
      await summary.getByRole('button', { name: '编辑' }).click();

      const dialog = page.getByRole('dialog', { name: '编辑 主服务器' });
      await expect(dialog).toBeVisible();
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox?.width || 0).toBeGreaterThan(1000);
      const apiKeyInput = dialog.locator('input[id$="-api-key"]');
      await expect(apiKeyInput).toHaveAttribute('type', 'password');
      await dialog.getByRole('button', { name: '显示API Key' }).click();
      await expect(apiKeyInput).toHaveAttribute('type', 'text');
      await expect(dialog.getByRole('button', { name: '隐藏API Key' }).locator('.fa-eye-slash')).toBeVisible();

      const passwordInput = dialog.locator('input[id$="-password"]');
      await expect(passwordInput).toHaveAttribute('type', 'password');
      await expect(passwordInput).toHaveValue('e2e-password');
      await dialog.getByRole('button', { name: '显示密码' }).click();
      await expect(passwordInput).toHaveAttribute('type', 'text');
      await passwordInput.fill('e2e-password-updated');
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        const settings = state.settings as {
          emby?: { mediaServers?: Array<{ id?: string; password?: string }> };
        } | undefined;
        return settings?.emby?.mediaServers?.find((server) => server.id === 'e2e-emby')?.password;
      })).toBe('e2e-password-updated');
      await dialog.getByRole('button', { name: '完成', exact: true }).click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await summary.getByRole('button', { name: '编辑' }).click();
      await expect(dialog.locator('input[id$="-password"]')).toHaveValue('e2e-password-updated');

      await dialog.locator('input[id$="-password"]').fill('e2e-password-before-route-switch');
      await page.evaluate(() => {
        window.location.hash = '#tab-settings/cloud-settings';
      });
      await expect(page.locator('.cloud-connection-summary')).toBeVisible();
      await page.evaluate(() => {
        window.location.hash = '#tab-settings/emby-settings';
      });
      await expect(summary).toBeVisible();
      await summary.getByRole('button', { name: '编辑' }).click();
      await expect(dialog.locator('input[id$="-password"]')).toHaveValue(
        'e2e-password-before-route-switch',
      );

      await dialog.getByRole('button', { name: '删除', exact: true }).click();
      const deleteDialog = page.getByRole('dialog', { name: '确认删除媒体服务器' });
      await expect(deleteDialog).toBeVisible();
      await expect(deleteDialog).toContainText('主服务器');
      await expect(deleteDialog).toContainText('http://emby.e2e.local:8096');
      await expect(deleteDialog).toContainText('不会删除本地媒体索引');
      await deleteDialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(deleteDialog).toBeHidden();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: '完成', exact: true }).click();
      await expect(summary).toBeVisible();

      const removableSummary = page.locator('.emby-media-server-summary').filter({ hasText: '停用服务器' });
      await removableSummary.getByRole('button', { name: '删除', exact: true }).click();
      await expect(deleteDialog).toContainText('停用服务器');
      await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(deleteDialog).toBeHidden();
      await expect(removableSummary).toHaveCount(0);
      const deletionState = await page.evaluate(async () => {
        const state = await chrome.storage.local.get(['settings', 'emby_library_state']);
        const settings = state.settings as {
          emby?: { mediaServers?: Array<{ name?: string }> };
        } | undefined;
        const library = state.emby_library_state as {
          entries?: Record<string, unknown>;
        } | undefined;
        return {
          serverNames: settings?.emby?.mediaServers?.map((server) => server.name || '') ?? [],
          libraryCodes: Object.keys(library?.entries ?? {}),
        };
      });
      expect(deletionState.serverNames).not.toContain('停用服务器');
      expect(deletionState.serverNames).toContain('主服务器');
      expect(deletionState.libraryCodes).toContain('E2E-EMBY-SOURCE');

      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/cloud-settings'), {
        waitUntil: 'domcontentloaded',
      });
      const connectionSummary = page.locator('.cloud-connection-summary');
      await expect(connectionSummary).toBeVisible();
      await expect(connectionSummary).toContainText('健康状态');
      await expect(connectionSummary).toContainText('登录状态');
      await expect(connectionSummary).toContainText('本机设备名');
      await connectionSummary.getByRole('button', { name: '编辑连接' }).click();

      const connectionDialog = page.getByRole('dialog', { name: '连接服务' });
      await expect(connectionDialog).toBeVisible();
      await expect(connectionDialog.getByText('账号与会话', { exact: true })).toBeVisible();
      const deviceLabelInput = connectionDialog.locator('#cloud-device-label');
      const originalDeviceLabel = await deviceLabelInput.inputValue();
      await deviceLabelInput.fill('E2E 未保存设备名');
      await connectionDialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(connectionDialog).toBeHidden();
      await connectionSummary.getByRole('button', { name: '编辑连接' }).click();
      await expect(connectionDialog.locator('#cloud-device-label')).toHaveValue(originalDeviceLabel);
      await connectionDialog.locator('#cloud-base-url').fill('http://127.0.0.1:18080');
      await connectionDialog.locator('#cloud-device-label').fill('E2E Cloud 浏览器');
      await connectionDialog.locator('#cloud-identifier').fill('e2e-cloud-account');
      await connectionDialog.locator('#cloud-password').fill('e2e-cloud-password');
      await connectionDialog.getByRole('button', { name: '保存修改' }).click();
      await expect(connectionDialog).toBeHidden();
      await expect(connectionSummary).toContainText('http://127.0.0.1:18080');
      await expect(connectionSummary).toContainText('E2E Cloud 浏览器');
      await expect(connectionSummary).not.toContainText('登录后同步');
      await expect(connectionSummary.getByRole('button', { name: '重新连接' })).toBeVisible();
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('cloud_sync_settings_v1');
        return state.cloud_sync_settings_v1 as {
          accountIdentifier?: string;
          accountPassword?: string;
        } | undefined;
      })).toMatchObject({
        accountIdentifier: 'e2e-cloud-account',
        accountPassword: 'e2e-cloud-password',
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.cloud-connection-summary')).toContainText('E2E Cloud 浏览器');
      await page.locator('.cloud-connection-summary').getByRole('button', { name: '编辑连接' }).click();
      await expect(connectionDialog.locator('#cloud-identifier')).toHaveValue('e2e-cloud-account');
      await expect(connectionDialog.locator('#cloud-password')).toHaveValue('e2e-cloud-password');
    } finally {
      await context.close();
    }
  });

  test('opens Cloud sync progress from the connection summary and keeps an actionable error result', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/cloud-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => {
        const now = Date.now();
        return chrome.storage.local.set({
          cloud_sync_settings_v1: {
            baseUrl: 'http://127.0.0.1:1',
            deviceLabel: 'E2E Cloud 同步',
            deviceId: 'e2e-cloud-sync-device',
            updatedAt: now,
          },
          cloud_sync_session_v1: {
            accessToken: 'e2e-invalid-token',
            refreshToken: 'e2e-invalid-refresh',
            userId: 'e2e-cloud-user',
            deviceId: 'e2e-cloud-sync-device',
            savedAt: now,
          },
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      const summary = page.locator('.cloud-connection-summary');
      await expect(summary).toBeVisible();
      await expect(page.getByText('后台自动同步', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: '已登录设备' })).toBeVisible();
      await summary.getByRole('button', { name: '立即同步' }).click();

      const progressDialog = page.getByRole('dialog', { name: '正在同步 Cloud' });
      await expect(progressDialog).toBeVisible();
      await expect(progressDialog).toContainText(/正在整理本机数据|正在与 Cloud 服务同步并合并数据/);
      const failedDialog = page.getByRole('dialog', { name: '同步失败' });
      await expect(failedDialog).toBeVisible({ timeout: 30_000 });
      await expect(failedDialog.getByRole('button', { name: '重试同步' })).toBeVisible();
      await failedDialog.getByText('关闭', { exact: true }).click();
      await expect(failedDialog).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test('syncs Emby-134 watched state into media filtering and watched organizer', async ({}, testInfo) => {
    test.skip(
      process.env.JAVDB_EXTENSION_REAL_MEDIA_E2E !== '1',
      '需要显式启用真实 Chrome 数据与 Emby-134 网络验收',
    );
    test.setTimeout(180_000);
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      const sourceConfig = await page.evaluate(async () => {
        const result = await chrome.storage.local.get('settings');
        const settings = result.settings as {
          emby?: {
            enabled?: boolean;
            mediaServers?: Array<{
              id?: string;
              name?: string;
              enabled?: boolean;
              username?: string;
              userDisplayName?: string;
              userId?: string;
              apiKey?: string;
              accessToken?: string;
            }>;
          };
          drive115?: { enabled?: boolean };
        } | undefined;
        const source = settings?.emby?.mediaServers?.find((server) => server.name === 'Emby-134');
        if (!source?.id) throw new Error('隔离 Chrome 数据中未找到 Emby-134 来源');
        await chrome.storage.local.set({
          settings: {
            ...settings,
            emby: {
              ...settings?.emby,
              enabled: true,
              mediaServers: settings?.emby?.mediaServers?.map((server) => ({
                ...server,
                enabled: server.id === source.id,
              })),
            },
            drive115: {
              ...settings?.drive115,
              enabled: false,
            },
          },
        });
        return {
          id: source.id,
          username: String(source.username || ''),
          userDisplayName: String(source.userDisplayName || ''),
          hasUserId: Boolean(source.userId),
          hasApiKey: Boolean(source.apiKey),
          hasAccessToken: Boolean(source.accessToken),
        };
      });
      console.log('[E2E] Emby-134 脱敏来源配置', sourceConfig);

      const syncResult = await page.evaluate((serverId) => new Promise<{
        success?: boolean;
        synced?: number;
        error?: string;
      }>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error('Emby-134 同步等待超时')), 90_000);
        chrome.runtime.sendMessage({
          type: 'EMBY_LIBRARY_SYNC',
          manual: true,
          serverId,
        }, (response) => {
          window.clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || {});
        });
      }), sourceConfig.id);
      expect(syncResult).toMatchObject({ success: true, synced: 1 });

      const persistedUserId = await page.evaluate(async (serverId) => {
        const result = await chrome.storage.local.get('settings');
        const settings = result.settings as {
          emby?: { mediaServers?: Array<{ id?: string; userId?: string }> };
        } | undefined;
        return settings?.emby?.mediaServers?.find((server) => server.id === serverId)?.userId || '';
      }, sourceConfig.id);
      expect(persistedUserId).not.toBe('');

      const syncedEntry = await page.evaluate(async () => {
        const result = await chrome.storage.local.get('emby_library_state');
        const state = result.emby_library_state as {
          entries?: Record<string, Array<{
            serverName?: string;
            itemId?: string;
            userData?: { played?: boolean; percent?: number };
          }>>;
        } | undefined;
        return state?.entries?.['MIDA-440']?.find((entry) => entry.serverName === 'Emby-134');
      });
      expect(syncedEntry).toMatchObject({
        itemId: '3257',
        userData: { played: true, percent: 100 },
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('searchbox', { name: '搜索媒体库' }).fill('MIDA-440');
      await page.getByRole('combobox', { name: '观看状态筛选' }).selectOption('watched');
      const card = page.locator('.ml-card[data-code="MIDA-440"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText('真实已看');

      await page.getByRole('button', { name: '媒体库工具' }).click();
      await page.getByRole('button', { name: /已看影片整理/ }).click();
      const cleanupOverlay = page.locator('[data-media-cleanup-overlay="1"]');
      await expect(cleanupOverlay).toBeVisible();
      await cleanupOverlay.getByRole('button', { name: '查找已看影片' }).click();
      await expect(cleanupOverlay.locator('.ml-cleanup-msg')).toContainText(/查找完成|找到并加入/, {
        timeout: 120_000,
      });
      await expect(cleanupOverlay.locator('[data-media-cleanup-title-group="1"]', {
        hasText: 'MIDA-440',
      })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('keeps vertical detail scrolling active over horizontal people rows', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => chrome.storage.local.set({
        emby_library_state: {
          updatedAt: Date.now(),
          entries: {
            'E2E-DETAIL-SCROLL': [{
              serverType: 'emby',
              serverName: '详情滚动测试',
              serverUrl: 'http://detail-scroll.e2e.local:8096',
              itemId: 'detail-scroll-item',
              itemName: '详情滚动测试影片',
              updatedAt: Date.now(),
            }],
          },
        },
      }));
      await page.addInitScript(() => {
        const runtime = chrome.runtime as typeof chrome.runtime & { __e2eDetailScrollMock?: boolean };
        if (runtime.__e2eDetailScrollMock) return;
        const originalSendMessage = runtime.sendMessage.bind(runtime);
        runtime.__e2eDetailScrollMock = true;
        runtime.sendMessage = ((...args: Parameters<typeof chrome.runtime.sendMessage>) => {
          const message = args.length > 0 && typeof args[0] === 'object' ? args[0] : args[1];
          const callback = args.find((arg) => typeof arg === 'function') as ((response: unknown) => void) | undefined;
          if (
            message
            && typeof message === 'object'
            && 'type' in message
            && message.type === 'EMBY_LIBRARY_GET_ITEM_DETAIL'
          ) {
            window.setTimeout(() => callback?.({
              success: true,
              detail: {
                itemId: 'detail-scroll-item',
                name: '详情滚动测试影片',
                overview: Array.from({ length: 18 }, (_, index) => `详情段落 ${index + 1}`).join('。'),
                people: Array.from({ length: 24 }, (_, index) => ({
                  id: `person-${index}`,
                  name: `演员 ${index + 1}`,
                  type: 'Actor',
                  role: '演员',
                })),
                chapters: Array.from({ length: 10 }, (_, index) => ({
                  index,
                  name: `章节 ${index + 1}`,
                  startPositionTicks: index * 600_000_000,
                })),
                collections: Array.from({ length: 10 }, (_, index) => ({
                  itemId: `collection-${index}`,
                  name: `合集 ${index + 1}`,
                })),
                similar: Array.from({ length: 10 }, (_, index) => ({
                  itemId: `similar-${index}`,
                  name: `相似影片 ${index + 1}`,
                })),
              },
            }), 0);
            return undefined;
          }
          return originalSendMessage(...args);
        }) as typeof chrome.runtime.sendMessage;
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      await page.locator('.ml-card[data-code="E2E-DETAIL-SCROLL"] .ml-card-hit')
        .evaluate((element: HTMLButtonElement) => element.click());
      const overlayBody = page.locator('.ui-overlay-shell__body').filter({ has: page.locator('[data-media-detail="1"]') });
      const peopleRow = page.locator('.ml-detail-people-row');
      await expect(peopleRow).toHaveAttribute('data-hscroll-overflow', '1');
      await peopleRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await peopleRow.hover();
      const before = await overlayBody.evaluate((element) => ({
        top: element.scrollTop,
        left: element.querySelector<HTMLElement>('.ml-detail-people-row')?.scrollLeft || 0,
      }));
      await page.mouse.wheel(0, 420);
      await expect.poll(() => overlayBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(before.top);
      await expect.poll(() => peopleRow.evaluate((element) => element.scrollLeft)).toBe(before.left);
    } finally {
      await context.close();
    }
  });

  test('closes detail before opening player when choosing a source', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await markReleaseAnnouncementSeenInContext(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);

      await page.evaluate(() => {
        const now = Date.now();
        return chrome.storage.local.set({
          emby_library_state: {
            updatedAt: now,
            entries: {
              'MIDA-440': [{
                serverType: 'emby',
                serverName: 'E2E Emby',
                serverUrl: 'http://source-choice.e2e.local:8096',
                itemId: 'source-choice-emby',
                itemName: 'MIDA-440 来源选择测试',
                updatedAt: now,
              }],
            },
          },
          drive115_library_state: {
            updatedAt: now,
            entries: [{
              key: 'source-choice:115',
              code: 'MIDA-440',
              title: 'MIDA-440 来源选择测试',
              videoFileId: 'source-choice-115',
              pickCode: 'source-choice-pick',
              fileName: 'MIDA-440.mp4',
              folderName: 'MIDA-440',
              updatedAt: now,
            }],
          },
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      await page.locator('.ml-card[data-code="MIDA-440"] .ml-card-hit')
        .evaluate((element: HTMLButtonElement) => element.click());
      const detail = page.locator('[data-media-detail="1"]');
      await expect(detail).toBeVisible();
      await detail.getByRole('button', { name: /选择播放来源/ }).click();

      const sourceMenu = detail.getByRole('menu', { name: '选择播放来源' });
      await expect(sourceMenu).toBeVisible();
      await expect(detail).toBeVisible();
      await sourceMenu.getByRole('menuitem', { name: /115.*115 片库/ }).click();

      await expect(detail).toBeHidden();
      await expect(page.locator('[data-media-115-play-overlay="1"]')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

function resolveTestHarnessOptions(userDataDir: string): ReturnType<typeof resolveExtensionHarnessOptions> {
  return resolveExtensionHarnessOptions(
    {
      ...process.env,
      JAVDB_EXTENSION_PROFILE: path.resolve(userDataDir),
    },
    process.cwd(),
  );
}

async function assertExtensionPageHealthy(
  context: Awaited<ReturnType<typeof launchExtensionContext>>,
  url: string,
): Promise<void> {
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toBeEmpty();
  expect(pageErrors, `page errors while opening ${url}`).toEqual([]);
  expect(consoleErrors, `console errors while opening ${url}`).toEqual([]);

  await page.close();
}

async function dismissReleaseAnnouncementIfPresent(page: Page): Promise<void> {
  const startButton = page.getByRole('button', { name: '开始使用' });
  if (await startButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await startButton.click();
  }
}

async function markReleaseAnnouncementSeenInContext(context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
    ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });

  await worker.evaluate(() => chrome.storage.local.set({
    release_announcement_state: {
      lastSeenAnnouncementKey: chrome.runtime.getManifest?.().version || '2.0.0',
      lastSeenAt: Date.now(),
    },
  }));
}
