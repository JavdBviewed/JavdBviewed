import { expect, test } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';

test('115 invalid authorization stops requests; a valid replacement reads the list without an orphan message', async ({}, testInfo) => {
  const harness = resolveExtensionHarnessOptions({ ...process.env,
    JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile'),
  }, process.cwd());
  const context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
  let listRequests = 0;
  try {
    await context.route(/^https?:\/\//, async route => {
      if (route.request().url().includes('/open/offline/get_task_list')) {
        listRequests++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: true, data: { tasks: [], count: 0, page_count: 1 } }) });
      } else await route.abort();
    });
    const id = await readExtensionId(context);
    await suppressReleaseAnnouncementForTest(context);
    const page = await context.newPage();
    const messages: string[] = [];
    page.on('console', msg => messages.push(msg.text()));
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/media-library-settings'));
    await expect(page.locator('#sync-emby-library')).toBeVisible();
    await page.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, drive115: { ...settings.drive115,
        v2AccessToken: 'synthetic-expired', v2RefreshToken: 'synthetic-refresh', v2TokenExpiresAt: Math.floor(Date.now() / 1000) - 120,
        v2AutoRefresh: true, v2RefreshTokenStatus: 'invalid', v2RefreshTokenLastError: '测试授权已失效',
      } } });
    });
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-drive115-tasks'));
    await expect(page.locator('#drive115TasksContainer')).toContainText('请重新授权');
    expect(listRequests).toBe(0);
    await page.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, drive115: { ...settings.drive115,
        v2AccessToken: 'synthetic-valid', v2RefreshTokenStatus: 'valid', v2TokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      } } });
    });
    await page.locator('#drive115TasksContainer button').click();
    await expect(page.locator('#drive115TasksContainer')).toContainText('暂无下载任务');
    expect(listRequests).toBe(1);
    expect(messages.join('\n')).not.toContain('message port closed');
    expect(messages.join('\n')).not.toMatch(/synthetic-expired|synthetic-valid|synthetic-refresh/);
  } finally { await context.close(); }
});
