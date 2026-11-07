import { expect, test } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';
import type { CrosslineSessionResponse } from '../../apps/extension/src/shared/protocols/crosslineSession';

// 全程隔离 profile + 人造 cookie，不访问站点、不读取用户会话。
test('crossline settings read stored sessions, persist the switch and preserve conflicting sessions', async ({}, testInfo) => {
  const options = resolveExtensionHarnessOptions({ ...process.env,
    JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile'),
  }, process.cwd());
  const context = await launchExtensionContext(options, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
  try {
    await context.route(/^https?:\/\//, route => route.abort());
    const id = await readExtensionId(context);
    await suppressReleaseAnnouncementForTest(context);
    const worker = context.serviceWorkers().find(item => item.url().includes(id));
    if (!worker) throw new Error('Extension worker missing');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ javdbCrosslineSessionEnabled: false });
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, routes: { ...settings.routes, javdb: {
        primary: 'https://javdb.com', alternatives: [
          { url: 'https://javdb570.com', enabled: true },
          { url: 'https://javdb575.com', enabled: true },
          { url: 'https://javdb36.com', enabled: true },
        ],
      } } } });
    });
    await context.addCookies([{ name: '_jdb_session', value: 'test-existing-session', domain: 'javdb.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/enhancement-settings/other'));
    const region = page.getByRole('region', { name: '跨线路登录态' });
    const toggle = region.locator('#crosslineEnabled');
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await expect(region).toContainText('自动同步已关闭');
    await expect(region.locator('li').filter({ hasText: 'javdb.com' })).toContainText('已找到会话');
    await expect(region.locator('li').filter({ hasText: 'javdb36.com' })).toContainText('暂不支持同步');
    const refresh = region.getByRole('button', { name: '获取或刷新当前登录态' });
    await refresh.click();
    await expect(refresh).toBeEnabled();
    expect((await context.cookies('https://javdb575.com')).some(cookie => cookie.name === '_jdb_session')).toBe(false);
    await region.locator('label[for="crosslineEnabled"]').click();
    await expect(toggle).toBeEnabled();
    await expect.poll(async () => (await context.cookies('https://javdb575.com')).some(cookie => cookie.name === '_jdb_session' && cookie.value === 'test-existing-session')).toBe(true);
    await refresh.click();
    await expect(region.locator('li').filter({ hasText: 'javdb575.com' })).toContainText('已找到会话');
    await region.locator('label[for="crosslineEnabled"]').click();
    await expect(toggle).toBeEnabled();
    await page.reload();
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await context.addCookies([{ name: '_jdb_session', value: 'test-other-session', domain: '.javdb575.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await region.locator('label[for="crosslineEnabled"]').click();
    await expect(toggle).toBeEnabled();
    await refresh.click();
    await expect(region).toContainText('线路之间存在不同会话');
    await expect(region.locator('li').filter({ hasText: 'javdb575.com' })).toContainText('存在不同会话，未覆盖');
    expect((await context.cookies('https://javdb575.com')).some(cookie => cookie.value === 'test-other-session')).toBe(true);
    const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'JAVDB_CROSSLINE:STATUS' })) as CrosslineSessionResponse;
    expect(response.success).toBe(true);
    expect(JSON.stringify(response)).not.toContain('test-existing-session');
    expect(JSON.stringify(response)).not.toContain('test-other-session');
    await region.screenshot({ path: testInfo.outputPath('desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await region.screenshot({ path: testInfo.outputPath('narrow.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await region.getByRole('link', { name: '线路管理' }).click();
    await expect(page).toHaveURL(/#tab-settings\/network-test-settings$/);
    await expect(page.locator('#javdb-routes-list')).toBeVisible();
  } finally {
    await context.close();
  }
});
