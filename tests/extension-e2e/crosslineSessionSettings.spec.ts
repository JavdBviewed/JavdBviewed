import { expect, test } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';
import type { CrosslineSessionResponse } from '../../apps/extension/src/shared/protocols/crosslineSession';

// 全程隔离 profile + 人造 cookie，不访问站点、不读取用户会话。
test('crossline settings read stored sessions, persist the switch and preserve conflicting sessions', async ({}, testInfo) => {
  const options = resolveExtensionHarnessOptions({ ...process.env,
    JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile'),
  }, process.cwd());
  const context = await launchExtensionContext(options, { headless: true, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
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
          { url: 'https://unrelated.example', enabled: true },
        ],
      } } } });
    });
    await context.addCookies([{ name: '_jdb_session', value: 'test-existing-session', domain: 'javdb.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/enhancement-settings/other'));
    const region = page.locator('[data-enhancement-feature="跨线路登录态"]');
    const toggle = region.locator('#crosslineEnabled');
    await expect(toggle).toBeEnabled();
    await expect(region).toHaveAttribute('data-expanded', '0');
    await region.hover({ position: { x: 20, y: 20 } });
    await expect(region).toHaveAttribute('data-expanded', '1');
    await expect(toggle).not.toBeChecked();
    await expect(region).toContainText('自动同步已关闭');
    await expect(region.locator('li').filter({ hasText: 'javdb.com' })).toContainText('已找到会话');
    await expect(region.locator('li').filter({ hasText: 'unrelated.example' })).toContainText('仅支持 HTTPS');
    const refresh = region.getByRole('button', { name: '获取或刷新当前登录态' });
    await refresh.click();
    await expect(refresh).toBeEnabled();
    expect((await context.cookies('https://javdb575.com')).some(cookie => cookie.name === '_jdb_session')).toBe(false);
    await region.locator('label:has(#crosslineEnabled)').click();
    await expect(toggle).toBeEnabled();
    await expect.poll(async () => (await context.cookies('https://javdb575.com')).some(cookie => cookie.name === '_jdb_session' && cookie.value === 'test-existing-session')).toBe(true);
    await refresh.click();
    await expect(region.locator('li').filter({ hasText: 'javdb575.com' })).toContainText('已找到会话');
    await region.locator('label:has(#crosslineEnabled)').click();
    await expect(toggle).toBeEnabled();
    await page.mouse.move(0, 0);
    await page.reload();
    await expect(toggle).toBeEnabled();
    await expect(region).toHaveAttribute('data-expanded', '0');
    await region.hover({ position: { x: 20, y: 20 } });
    await expect(region).toHaveAttribute('data-expanded', '1');
    await expect(toggle).not.toBeChecked();
    await context.addCookies([{ name: '_jdb_session', value: 'test-other-session', domain: '.javdb575.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await region.locator('label:has(#crosslineEnabled)').click();
    await expect(toggle).toBeEnabled();
    await refresh.click();
    await expect(region).toContainText('这些网站保存的会话信息不同');
    await expect(region.locator('li').filter({ hasText: 'javdb575.com' })).toContainText('保存的信息不同，尚未同步');
    expect((await context.cookies('https://javdb575.com')).some(cookie => cookie.value === 'test-other-session')).toBe(true);
    const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'JAVDB_CROSSLINE:STATUS' })) as CrosslineSessionResponse;
    expect(response.success).toBe(true);
    expect(JSON.stringify(response)).not.toContain('test-existing-session');
    expect(JSON.stringify(response)).not.toContain('test-other-session');
    await region.locator('#crosslineSource').selectOption('javdb.com');
    await region.locator('#crosslineTarget').selectOption('javdb575.com');
    await region.getByRole('button', { name: '使用此站登录态' }).click();
    await expect(page.getByRole('dialog', { name: '确认同步登录态' })).toContainText('javdb575.com');
    expect((await context.cookies('https://javdb575.com')).some(cookie => cookie.value === 'test-other-session')).toBe(true);
    await page.getByRole('button', { name: '确认替换并同步' }).click();
    await region.hover({ position: { x: 20, y: 20 } });
    await expect(region.locator('li').filter({ hasText: 'javdb575.com' })).toContainText('本次已补齐');
    expect((await context.cookies('https://javdb575.com')).filter(cookie => cookie.name === '_jdb_session').every(cookie => cookie.value === 'test-existing-session')).toBe(true);
    await region.screenshot({ path: testInfo.outputPath('desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await region.hover({ position: { x: 20, y: 20 } });
    await region.screenshot({ path: testInfo.outputPath('narrow.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await toggle.focus();
    await expect(region).toHaveAttribute('data-expanded', '1');
    await region.getByRole('link', { name: '线路管理' }).click();
    await expect(page).toHaveURL(/#tab-settings\/network-test-settings$/);
    await expect(page.locator('#javdb-routes-list')).toBeVisible();
  } finally {
    await context.close();
  }
});
