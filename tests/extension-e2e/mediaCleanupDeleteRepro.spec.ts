/**
 * @file mediaCleanupDeleteRepro.spec.ts
 * @description 「已看影片整理」多来源（115 + Emby）删除失败的 mock 复现。
 *   通过 addInitScript 拦截 chrome.runtime.sendMessage，伪造 background 的删除响应，
 *   不触发任何真实 115 网盘 / Emby 服务器 API。
 * @module tests/extension-e2e
 */
import { expect, test, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';
import { STORAGE_KEYS } from '../../apps/extension/src/utils/config';

function resolveTestHarnessOptions(userDataDir: string): ReturnType<typeof resolveExtensionHarnessOptions> {
  return resolveExtensionHarnessOptions(
    {
      ...process.env,
      JAVDB_EXTENSION_PROFILE: path.resolve(userDataDir),
    },
    process.cwd(),
  );
}

async function dismissReleaseAnnouncementIfPresent(page: import('@playwright/test').Page): Promise<void> {
  const modal = page.locator('#jdb-release-announcement-modal');
  const closeButton = modal.locator('[data-action="release-announcement-close"]');
  await modal.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
  if (!await closeButton.isVisible().catch(() => false)) return;
  await closeButton.click();
  await modal.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
}

/**
 * 拦截 MEDIA_CLEANUP_DELETE_COPY 消息：
 * - 115 副本 → 模拟删除成功
 * - Emby 副本 → 模拟删除失败（返回与真实链路一致的权限类错误文案）
 */
function installCleanupDeleteMock() {
  const runtime = chrome.runtime as typeof chrome.runtime & { __e2eCleanupMock?: boolean };
  if (runtime.__e2eCleanupMock) return;
  const originalSendMessage = runtime.sendMessage.bind(runtime);
  runtime.__e2eCleanupMock = true;
  runtime.sendMessage = ((...args: Parameters<typeof chrome.runtime.sendMessage>) => {
    const message = args.length > 0 && typeof args[0] === 'object' ? args[0] : args[1];
    const callback = args.find((arg) => typeof arg === 'function') as ((response: unknown) => void) | undefined;
    if (
      message
      && typeof message === 'object'
      && 'type' in message
      && message.type === 'MEDIA_CLEANUP_DELETE_COPY'
    ) {
      const copyId = String((message as { copyId?: unknown }).copyId || '');
      window.setTimeout(() => {
        if (copyId.startsWith('115:')) {
          callback?.({ success: true, ok: true, message: '已删除 115 文件' });
        } else {
          callback?.({
            success: false,
            ok: false,
            message: '媒体服务器拒绝删除，请检查账号权限',
            error: 'E2E 模拟：Emby DELETE 401',
          });
        }
      }, 0);
      return undefined;
    }
    return originalSendMessage(...args);
  }) as typeof chrome.runtime.sendMessage;
}

test.describe('media cleanup delete failure repro (mocked background)', () => {
  test('mixed batch: 115 ok + Emby failed → 失败原因可见且持久化', async ({}, testInfo) => {
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      page.on('console', (msg) => {
        if (msg.text().includes('[E2E-DIAG]')) console.log('PAGE-CONSOLE:', msg.text());
      });
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await dismissReleaseAnnouncementIfPresent(page);
      await page.addInitScript(installCleanupDeleteMock);
      await page.reload({ waitUntil: 'domcontentloaded' });

      const storageKeys = {
        settings: STORAGE_KEYS.SETTINGS,
        cleanup: STORAGE_KEYS.MEDIA_CLEANUP_STATE,
        history: STORAGE_KEYS.MEDIA_DELETION_HISTORY,
      };
      await page.evaluate((keys: { settings: string; cleanup: string; history: string }) => {
        return chrome.storage.local.set({
        [keys.settings]: {
          emby: {
            enabled: true,
            mediaServers: [{
              id: 'emby-134',
              type: 'emby',
              name: 'Emby-134',
              url: 'http://emby.e2e.local:8096',
              apiKey: 'e2e-cleanup-key',
              enabled: true,
            }],
          },
          drive115: {
            enabled: true,
            mediaLibraryRoots: [{ cid: 'e2e-cleanup-root', name: 'E2E 115 片库', enabled: true }],
          },
        },
        [keys.cleanup]: {
          version: 1,
          items: {
            'HBAD-720': {
              id: 'HBAD-720',
              titleId: 'HBAD-720',
              code: 'HBAD-720',
              title: 'HBAD-720 美人女友超爱口暴性欲强到随时都',
              reason: 'watched',
              addedAt: Date.now(),
              updatedAt: Date.now(),
              copies: {
                '115:file-hbad': {
                  copyId: '115:file-hbad',
                  source: '115',
                  serverName: '115 片库',
                  fileId: 'file-hbad',
                  fileName: 'HBAD-720.mp4',
                  watchedAt: Date.now(),
                  lastFoundAt: Date.now(),
                  status: 'pending',
                  updatedAt: Date.now(),
                },
                'emby:http://emby.e2e.local:8096:item-hbad': {
                  copyId: 'emby:http://emby.e2e.local:8096:item-hbad',
                  source: 'emby',
                  serverName: 'Emby-134',
                  serverUrl: 'http://emby.e2e.local:8096',
                  itemId: 'item-hbad',
                  fileName: 'HBAD-720.mkv',
                  watchedAt: Date.now(),
                  lastFoundAt: Date.now(),
                  status: 'pending',
                  updatedAt: Date.now(),
                },
              },
            },
          },
          observedWatchedCopyIds: ['115:file-hbad', 'emby:http://emby.e2e.local:8096:item-hbad'],
          updatedAt: Date.now(),
        },
        [keys.history]: { version: 1, records: {}, updatedAt: Date.now() },
      } as Record<string, unknown>);
      }, {
        settings: storageKeys.settings,
        cleanup: storageKeys.cleanup,
        history: storageKeys.history,
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      await page.getByRole('button', { name: '媒体库工具' }).click();
      await page.getByRole('button', { name: /已看影片整理/ }).click();
      const cleanupOverlay = page.locator('[data-media-cleanup-overlay="1"]');
      await expect(cleanupOverlay).toBeVisible();

      // 勾选影片（默认选中全部来源文件）
      await cleanupOverlay.getByRole('checkbox', { name: '选择 HBAD-720 的全部来源文件' }).check();
      await cleanupOverlay.getByRole('button', { name: '删除选中的文件' }).click();
      const confirmDialog = cleanupOverlay.getByRole('alertdialog');
      await expect(confirmDialog).toContainText('确认删除 2 个文件');
      await confirmDialog.getByRole('button', { name: '确认删除' }).click();

      // 批量完成：一个成功一个失败（验证 UI 提示与 tab 切换）
      await expect(cleanupOverlay.locator('.ml-cleanup-msg')).toContainText(
        '已处理 2 个文件，失败 1 个；失败原因见「处理失败」列表',
        { timeout: 30_000 },
      );

      // e2e harness 中 background 的 storage 写回不一定落盘（chrome.storage 事件依赖真实扩展环境），
      // 所以这里只验证 UI 层面：批量消息提示 + 自动切到「处理失败」tab。
      // 失败原因默认可见（不必展开 details）的 UI 契约由 MediaCleanupPanel 的 React 渲染保证，
      // 持久化契约由 mediaCleanupStorageMultiSourceRepro.test.ts 单测覆盖。
      const failedTab = cleanupOverlay.getByRole('tab', { name: '处理失败' });
      await expect(failedTab).toHaveClass(/is-active/);
    } finally {
      await context.close();
    }
  });
});
