/**
 * @file cloud-selfhost-sync.spec.ts
 * @description 使用隔离 Cloud 容器与真实 Chrome 数据副本，验收扩展的跨 profile 同步闭环
 * @module tests/extension-e2e
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import {
  assertExtensionBuildDirectory,
  createChromiumExtensionArgs,
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
} from '../../scripts/extensionHarness';

const cloudBaseUrl = process.env.CLOUD_E2E_BASE_URL?.trim();
const cloudPassword = process.env.CLOUD_E2E_PASSWORD?.trim();
const cloudUser = process.env.CLOUD_E2E_USER?.trim() || 'admin';

test.describe('Cloud self-host extension acceptance', () => {
  test.skip(!cloudBaseUrl || !cloudPassword, '需要 CLOUD_E2E_BASE_URL 与 CLOUD_E2E_PASSWORD 指向隔离测试容器');

  test('syncs through the settings UI across two profiles and survives a profile restart', async ({}, testInfo) => {
    test.setTimeout(300_000);
    const markerPrefix = `cloud-e2e-${Date.now()}`;
    const videoIdA = `${markerPrefix}-first`;
    const videoIdB = `${markerPrefix}-after-restart`;
    const videoA = createTestVideo(videoIdA);
    const videoB = createTestVideo(videoIdB);
    const profileA = testInfo.outputPath('profile-a');
    const profileB = testInfo.outputPath('profile-b');
    const optionsA = resolveTestHarnessOptions(profileA);
    const optionsB = resolveTestHarnessOptions(profileB);

    const contextA = await launchExtensionContext(optionsA, { headless: false, channel: 'chromium' });
    let contextB: BrowserContext | undefined;

    try {
      const extensionId = await readExtensionId(contextA);
      await markReleaseAnnouncementSeen(contextA);
      await resetCloudConnectionForIsolatedTest(contextA);
      const pageA = await openCloudSettings(contextA, extensionId);
      await connectAndSync(pageA, `Cloud E2E A ${markerPrefix}`);
      await expect(pageA.getByText('已登录', { exact: true }).first()).toBeVisible();

      await writeTestVideo(pageA, videoA);
      await expect.poll(() => isTestVideoQueued(pageA, videoIdA)).toBe(true);
      await syncFromSummary(pageA);

      contextB = await launchExtensionContext(optionsB, { headless: false, channel: 'chromium' });
      const extensionIdB = await readExtensionId(contextB);
      expect(extensionIdB).toBe(extensionId);
      await markReleaseAnnouncementSeen(contextB);
      await resetCloudConnectionForIsolatedTest(contextB);
      const pageB = await openCloudSettings(contextB, extensionIdB);
      await connectAndSync(pageB, `Cloud E2E B ${markerPrefix}`);
      await expect.poll(() => readTestVideo(pageB, videoIdA)).toMatchObject(videoA);

      await contextB.close();
      contextB = undefined;

      await writeTestVideo(pageA, videoB);
      await expect.poll(() => isTestVideoQueued(pageA, videoIdB)).toBe(true);
      await syncFromSummary(pageA);

      contextB = await reopenExistingProfile(optionsB);
      const extensionIdAfterRestart = await readExtensionId(contextB);
      expect(extensionIdAfterRestart).toBe(extensionId);
      await markReleaseAnnouncementSeen(contextB);
      const restartedPageB = await openCloudSettings(contextB, extensionIdAfterRestart);
      await expect(restartedPageB.getByText('已登录', { exact: true }).first()).toBeVisible();
      await syncFromSummary(restartedPageB);
      await expect.poll(() => readTestVideo(restartedPageB, videoIdB)).toMatchObject(videoB);
    } finally {
      await contextB?.close();
      await contextA.close();
    }
  });
});

function resolveTestHarnessOptions(userDataDir: string): ReturnType<typeof resolveExtensionHarnessOptions> {
  return resolveExtensionHarnessOptions({
    ...process.env,
    JAVDB_EXTENSION_PROFILE: path.resolve(userDataDir),
  }, process.cwd());
}

async function reopenExistingProfile(options: ReturnType<typeof resolveExtensionHarnessOptions>): Promise<BrowserContext> {
  await assertExtensionBuildDirectory(options.extensionDir);
  return chromium.launchPersistentContext(options.userDataDir, {
    channel: 'chromium',
    headless: false,
    args: createChromiumExtensionArgs(options.extensionDir),
  });
}

async function openCloudSettings(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/cloud-settings'), {
    waitUntil: 'domcontentloaded',
  });
  await dismissReleaseAnnouncementIfPresent(page);
  await expect(page.locator('[data-cloud-settings-react="1"]').last()).toBeVisible();
  return page;
}

async function connectAndSync(page: Page, deviceLabel: string): Promise<void> {
  await page.getByRole('button', { name: '编辑连接' }).click();
  const dialog = page.getByRole('dialog', { name: '连接服务' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#cloud-base-url').fill(cloudBaseUrl!);
  await dialog.locator('#cloud-device-label').fill(deviceLabel);
  await dialog.locator('#cloud-identifier').fill(cloudUser);
  await dialog.locator('#cloud-password').fill(cloudPassword!);
  await dialog.getByRole('button', { name: /保存(?:修改|连接)/ }).click();
  await expect(page.getByText('已自动登录并完成首次同步', { exact: true }).first())
    .toBeVisible({ timeout: 180_000 });
  await expect(dialog).toHaveCount(0);
  await closeCompletedSyncDialog(page);
}

async function syncFromSummary(page: Page): Promise<void> {
  await page.getByRole('button', { name: '立即同步' }).click();
  const progressDialog = page.getByRole('dialog').filter({ hasText: '同步完成' });
  await expect(progressDialog).toBeVisible({ timeout: 180_000 });
  await closeCompletedSyncDialog(page);
}

function createTestVideo(id: string) {
  const now = Date.now();
  return {
    id,
    title: `Cloud E2E ${id}`,
    status: 'viewed',
    tags: ['cloud-e2e'],
    createdAt: now,
    updatedAt: now,
    notes: 'Temporary cross-profile Cloud acceptance record.',
  };
}

async function writeTestVideo(page: Page, video: ReturnType<typeof createTestVideo>): Promise<void> {
  await page.evaluate((record) => new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'DB:VIEWED_PUT', payload: { record } }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'DB:VIEWED_PUT failed'));
        return;
      }
      resolve();
    });
  }), video);
}

async function readTestVideo(page: Page, videoId: string): Promise<unknown> {
  return page.evaluate((id) => new Promise<unknown>((resolve, reject) => {
    const openRequest = indexedDB.open('javdb_v1', 14);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const transaction = db.transaction('viewedRecords', 'readonly');
      const getRequest = transaction.objectStore('viewedRecords').get(id);
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  }), videoId);
}

async function isTestVideoQueued(page: Page, videoId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const { cloud_sync_pending_v1: pending } = await chrome.storage.local.get('cloud_sync_pending_v1');
    return Array.isArray(pending) && pending.some(
      (entity) => entity?.type === 'video' && entity?.id === id,
    );
  }, videoId);
}

async function closeCompletedSyncDialog(page: Page): Promise<void> {
  const progressDialog = page.getByRole('dialog').filter({ hasText: '同步完成' });
  if (await progressDialog.count()) {
    await progressDialog.getByRole('button', { name: '完成', exact: true }).click();
    await expect(progressDialog).toHaveCount(0);
  }
}

async function markReleaseAnnouncementSeen(context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://'))
    ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await worker.evaluate(() => chrome.storage.local.set({
    release_announcement_state: {
      lastSeenAnnouncementKey: chrome.runtime.getManifest?.().version || '2.0.0',
      lastSeenAt: Date.now(),
    },
  }));
}

async function resetCloudConnectionForIsolatedTest(context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://'))
    ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await worker.evaluate(async () => {
    await chrome.storage.local.remove([
      'cloud_sync_session_v1',
      'cloud_sync_pending_v1',
      'cloud_sync_cursors_v1',
    ]);
    await chrome.storage.local.set({
      cloud_sync_settings_v1: {
        baseUrl: '',
        deviceLabel: '',
        accountIdentifier: '',
        accountPassword: '',
      },
      cloud_auto_sync_settings_v1: {
        enabled: false,
        intervalMinutes: 30,
      },
    });
  });
}

async function dismissReleaseAnnouncementIfPresent(page: Page): Promise<void> {
  const startButton = page.getByRole('button', { name: '开始使用' });
  if (await startButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await startButton.click();
  }
}
