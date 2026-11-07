import { expect, test } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';

test('download center switches services and shows OpenList download and transfer tasks', async ({}, testInfo) => {
  const options = resolveExtensionHarnessOptions({ ...process.env, JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile') }, process.cwd());
  const context = await launchExtensionContext(options, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
  let retries = 0;
  let driveRequests = 0;
  try {
    context.on('request', request => { if (/\.115\.com\//.test(request.url())) driveRequests++; });
    await context.route(/^https?:\/\//, async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'openlist.example.test') return route.abort();
      let data: unknown = null;
      if (url.pathname.endsWith('/public/settings')) data = { version: 'test' };
      if (url.pathname.endsWith('/offline_download/undone')) data = [{ id: 'download-1', name: 'Sample download', state: 1, progress: 42, status: 'Downloading' }];
      if (url.pathname.endsWith('/offline_download_transfer/done')) data = [{ id: 'transfer-1', name: 'Sample transfer', state: 7, progress: 10, error: 'Test disk full' }];
      if (url.pathname.endsWith('/retry')) { retries++; expect(url.searchParams.get('tid')).toBe('transfer-1'); }
      await route.fulfill({ json: { code: 200, data }, headers: { 'access-control-allow-origin': '*' } });
    });
    const id = await readExtensionId(context);
    await suppressReleaseAnnouncementForTest(context);
    const worker = context.serviceWorkers().find(item => item.url().includes(id));
    if (!worker) throw new Error('Extension worker missing');
    await worker.evaluate(async () => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, openlist: { baseUrl: 'https://openlist.example.test', token: 'synthetic-test-token', path: '/test', tool: 'SimpleHttp' } } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-drive115-tasks/openlist'));
    const panel = page.getByRole('region', { name: 'OpenList 下载任务' });
    await expect(panel).toContainText('Sample download'); await expect(panel).toContainText('42%');
    expect((await panel.getByRole('textbox', { name: '搜索 OpenList 任务' }).boundingBox())?.height).toBeGreaterThanOrEqual(32);
    await expect(panel).toContainText('转存到目标目录'); await expect(panel).toContainText('Test disk full');
    expect(driveRequests).toBe(0);
    await expect(page.getByRole('tab', { name: 'OpenList', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('button', { name: '重试', exact: true }).click();
    await expect.poll(() => retries).toBe(1);
    await panel.getByRole('textbox', { name: '搜索 OpenList 任务' }).fill('transfer');
    await expect(panel).not.toContainText('Sample download'); await expect(panel).toContainText('Sample transfer');
    await panel.getByRole('textbox', { name: '搜索 OpenList 任务' }).fill('');
    await page.locator('#downloadTasksPage').screenshot({ path: testInfo.outputPath('desktop.png') });
    await page.getByRole('tab', { name: '115 网盘', exact: true }).click();
    await expect(page.locator('#downloadTasks115Panel')).toBeVisible(); await expect(panel).toHaveCount(0);
    await page.getByRole('tab', { name: 'OpenList', exact: true }).click();
    await expect(panel).toContainText('Sample download');
    await page.reload(); await expect(panel).toContainText('Sample download');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#downloadTasksPage').screenshot({ path: testInfo.outputPath('narrow.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally { await context.close(); }
});
