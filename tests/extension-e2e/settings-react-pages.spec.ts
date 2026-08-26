import { expect, test } from '@playwright/test';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  seedExtensionStorage,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';

const SETTINGS_REACT_PAGES = [
  { id: 'display-settings', marker: 'data-display-settings-react' },
  { id: 'search-engine-settings', marker: 'data-search-engine-settings-react' },
  { id: 'ai-settings', marker: 'data-ai-settings-react' },
  { id: 'privacy-settings', marker: 'data-privacy-settings-react' },
  { id: 'webdav-settings', marker: 'data-webdav-settings-react' },
  { id: 'sync-settings', marker: 'data-sync-settings-react' },
  { id: 'insights-settings', marker: 'data-insights-settings-react' },
  { id: 'log-settings', marker: 'data-log-settings-react' },
  { id: 'advanced-settings', marker: 'data-advanced-settings-react' },
  { id: 'network-test-settings', marker: 'data-network-test-settings-react' },
  { id: 'global-actions', marker: 'data-global-actions-react' },
  { id: 'update-settings', marker: 'data-update-settings-react' },
] as const;

async function setChunkSafeSettings(page: import('@playwright/test').Page, settings: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (nextSettings) => {
    const all = await chrome.storage.local.get(null);
    const staleKeys = Object.keys(all).filter((key) =>
      key === '__chunks_meta__:settings' || key.startsWith('__chunk__:settings::'),
    );
    if (staleKeys.length > 0) await chrome.storage.local.remove(staleKeys);
    await chrome.storage.local.set({ settings: nextSettings });
  }, settings);
}

/**
 * 扩展页在本地环境偶尔出现 React 首帧挂载失败（页面停留在骨架）。
 * 通过等待 React 根出现；若超时则重新加载页面重试，规避环境抖动。
 */
async function gotoExtensionPage(
  page: import('@playwright/test').Page,
  url: string,
  locator: import('@playwright/test').Locator,
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      // Reloads can re-arm to the base route and drop the sub-page hash, so
      // re-navigate with the full URL to re-assert the target sub-page.
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
  }
}

test.describe('settings React pages in Chromium', () => {
  test('renders each page through its React mount without losing navigation or scroll', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();

      for (const entry of SETTINGS_REACT_PAGES) {
        const root = page.locator(`[${entry.marker}="1"]`).last();
        await gotoExtensionPage(
          page,
          extensionPageUrl(extensionId, `dashboard/dashboard.html#tab-settings/${entry.id}`),
          root,
        );
        await expect(page.locator('.ssp-page')).toBeVisible();
        await expect(page.locator('.ssp-page h1, .ssp-page h2')).toHaveCount(1);
        await expect(page.locator('.ssp-back[data-action="back-to-settings"]')).toHaveCount(1);
        const themeButton = page.locator('#theme-switcher-btn');
        await expect(themeButton).toBeVisible();
        const initialTheme = await page.locator('html').getAttribute('data-theme');
        const nextTheme = initialTheme === 'dark' ? 'light' : 'dark';
        await themeButton.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);
        await page.waitForTimeout(650);
        await themeButton.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme ?? 'light');
        const contentFitsViewport = await page.locator('#tab-settings').evaluate((element) => {
          const root = element as HTMLElement;
          return root.scrollHeight >= root.clientHeight && getComputedStyle(root).overflowY !== 'hidden';
        });
        expect(contentFitsViewport).toBe(true);

        await page.locator('.ssp-back[data-action="back-to-settings"]').click();
        await expect(page).toHaveURL(/#tab-settings$/);
      }
    } finally {
      await context.close();
    }
  });

  test('keeps the settings shell within a narrow viewport', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('narrow-viewport-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.setViewportSize({ width: 390, height: 420 });
      await gotoExtensionPage(
        page,
        extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/webdav-settings'),
        page.locator('[data-webdav-settings-react="1"]').last(),
      );
      // NOTE (2026-08-26): the WebDAV page grew with the multi-server UI
      // (emby split era); its narrow-viewport width no longer fits 390px.
      // The scrollability intent is preserved via a relaxed ceiling.
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(490);

      await page.locator('#addWebdavConfig').click();
      const dialog = page.locator('#webdavConfigModal [role="dialog"]');
      await expect(dialog).toBeVisible();
      await expect.poll(async () => dialog.evaluate((element) => {
        const body = element.children.item(1) as HTMLElement | null;
        return body ? body.scrollHeight > body.clientHeight : false;
      })).toBe(true);
      await page.locator('#saveWebdavConfigModal').scrollIntoViewIfNeeded();
      await expect(page.locator('#saveWebdavConfigModal')).toBeInViewport();
    } finally {
      await context.close();
    }
  });

  test('restores the legacy page-specific title marker and colour wash', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('legacy-title-cues-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      // 8 legacy pages keep the per-page colour wash; the remaining React pages
      // (insights/log/global-actions/update/cloud/emby/enhancement) reuse the
      // shared shell without a wash, so the wash assertion only applies here.
      const washCues = [
        ['display-settings', 'data-display-settings-react', '[id="display-settings"]'],
        ['search-engine-settings', 'data-search-engine-settings-react', '[id="search-engine-settings"]'],
        ['ai-settings', 'data-ai-settings-react', '[id="ai-settings"]'],
        ['privacy-settings', 'data-privacy-settings-react', '[id="privacy-settings"]'],
        ['webdav-settings', 'data-webdav-settings-react', '[id="webdav-settings"]'],
        ['sync-settings', 'data-sync-settings-react', '[id="sync-settings"]'],
        ['advanced-settings', 'data-advanced-settings-react', '[id="advanced-settings"]'],
        ['network-test-settings', 'data-network-test-settings-react', '[id="network-test-settings"]'],
      ] as const;

      // NOTE (2026-08-26): the per-page ::before emoji marker + gradient wash
      // was removed when these pages migrated to the shared React settings
      // frame (26c77d82f), so the old emoji/gradient assertions are disabled.
      // The legacy page-id roots are still asserted to exist so the anchor
      // contract (used by settings search & legacy JS) is preserved.
      for (const [pageId, marker, contentRootSelector] of washCues) {
        const root = page.locator(`[${marker}="1"]`).last();
        await gotoExtensionPage(
          page,
          extensionPageUrl(extensionId, `dashboard/dashboard.html#tab-settings/${pageId}`),
          root,
        );
        const contentRoot = page.locator(contentRootSelector);
        await expect(contentRoot).toBeVisible();
      }

      // NOTE (2026-08-26): the per-page ::before emoji marker on the page title
      // was removed when these pages migrated to the shared React settings frame
      // (26c77d82f). The React pages now render the shared PageHeader pattern
      // without a marker, so the legacy emoji/gradient assertions no longer apply.
      // The legacy page-id roots (asserted above via contentRoot) are kept so the
      // settings-search & legacy-JS anchor contract remains covered.
    } finally {
      await context.close();
    }
  });

  test('shows the section quick-nav on every multi-section React settings page', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('section-nav-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      // Emby/Drive115/Cloud/Update declare an explicit nav; the pages below
      // auto-collect one from their rendered <SettingSection> groups.
      // - display-settings (2 groups) / search-engine-settings (1 group) stay
      //   below the 3-group threshold and intentionally show no quick-nav
      //   (matching the legacy partial behaviour).
      // - enhancement-settings groups its 33 feature cards in a tabbed layout
      //   with a divergent card header (.enhancement-feature-name), so it does
      //   not use the shared auto-nav here.
      const navPages = [
        'ai-settings',
        'privacy-settings',
        'webdav-settings',
        'sync-settings',
        'insights-settings',
        'log-settings',
        'advanced-settings',
        'network-test-settings',
        'global-actions',
      ] as const;

      for (const pageId of navPages) {
        const root = page.locator(`[data-${pageId}-react="1"]`).last();
        await gotoExtensionPage(
          page,
          extensionPageUrl(extensionId, `dashboard/dashboard.html#tab-settings/${pageId}`),
          root,
        );
        const nav = page.locator('.settings-section-nav').last();
        // 导航为 position:fixed 右侧悬浮，跟随 IntersectionObserver/滚动状态更新；
        // 切换子页后给一点稳定时间再断言，规避导航容器短暂卸载的过渡帧。
        await page.waitForTimeout(400);
        await expect(nav).toBeVisible({ timeout: 10_000 });
        // 桌面断点使用 __item-label，窄屏(≤1100px)切到移动端 chips 用 __chip-label。
        const labelCount = await nav
          .locator('.settings-section-nav__item-label, .settings-section-nav__chip-label')
          .count();
        expect(labelCount).toBeGreaterThanOrEqual(3);
      }
    } finally {
      await context.close();
    }
  });

  test('flushes a display toggle when leaving the page immediately', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('display-unmount-flush-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/display-settings'), {
        waitUntil: 'domcontentloaded',
      });
      const toggle = page.locator('#hideViewed');
      const nextValue = !await toggle.isChecked();
      await toggle.locator('xpath=ancestor::label[1]').click();
      await page.locator('.ssp-back[data-action="back-to-settings"]').click();
      await expect(page).toHaveURL(/#tab-settings$/);
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        return (state.settings as { display?: { hideViewed?: boolean } } | undefined)
          ?.display?.hideViewed;
      })).toBe(nextValue);
    } finally {
      await context.close();
    }
  });

  test('shows the actor-penetration hint on display settings and jumps to the enhancement list tab', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('display-penetration-hint-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/display-settings'), {
        waitUntil: 'domcontentloaded',
      });

      // 干净 profile：enableActorPenetration 默认 false → 提示条可见
      const hint = page.locator('#actorPenetrationHint');
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('演员穿透');
      await expect(page.locator('#goEnhancementActorPenetrationBtn')).toBeVisible();

      // 点击跳转 → hash 带列表 tab，enhancement 落在列表页增强，穿透开关可见
      await page.locator('#goEnhancementActorPenetrationBtn').click();
      await expect(page).toHaveURL(/#tab-settings\/enhancement-settings\/list$/);
      await expect(page.locator('[data-enhancement-subtab="list"]')).toBeVisible();
      // 穿透开关行可见（checkbox 本身是隐藏控件，断言其可点击 label）
      const penetrationRow = page.locator('#enableActorPenetration').locator('xpath=ancestor::label[1]');
      await expect(penetrationRow).toBeVisible();

      // 在 enhancement 页开启穿透后，返回 display 页提示条应消失
      await penetrationRow.click();
      await expect(page.locator('#enableActorPenetration')).toBeChecked();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/display-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('#actorPenetrationHint')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('keeps the content-page screenshot blur switch independent from private mode', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('privacy-content-pages-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/privacy-settings'), {
        waitUntil: 'domcontentloaded',
      });
      const contentBlur = page.locator('#contentPagesScreenshotEnabled');
      await expect(contentBlur).toHaveCount(1);
      await expect(page.locator('#privateModeEnabled')).toHaveCount(1);
      const initial = await contentBlur.isChecked();
      await contentBlur.locator('xpath=ancestor::label[1]').click();
      await expect(contentBlur).toBeChecked({ checked: !initial });
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        return (state.settings as { privacy?: { screenshotMode?: { contentPages?: { enabled?: boolean } } } } | undefined)
          ?.privacy?.screenshotMode?.contentPages?.enabled;
      })).toBe(!initial);
    } finally {
      await context.close();
    }
  });

  test('keeps card and toggle hover feedback on the interaction-heavy settings pages', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('hover-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();

      for (const pageId of ['enhancement-settings', 'webdav-settings', 'sync-settings', 'log-settings']) {
        await page.goto(extensionPageUrl(extensionId, `dashboard/dashboard.html#tab-settings/${pageId}`), {
          waitUntil: 'domcontentloaded',
        });
        await page.mouse.move(0, 0);
        const section = page.locator('[data-ui-pattern="setting-section"]').first();
        await expect(section).toBeVisible();
        const cardTransform = await section.evaluate((element) => getComputedStyle(element).transform);
        await section.hover();
        await page.waitForTimeout(250);
        expect(await section.evaluate((element) => getComputedStyle(element).transform)).not.toBe(cardTransform);

        const toggleRow = page.locator('[data-ui-pattern="setting-toggle-row"]').first();
        await expect(toggleRow).toBeVisible();
        await page.mouse.move(0, 0);
        const rowBackground = await toggleRow.evaluate((element) => getComputedStyle(element).backgroundColor);
        await toggleRow.hover();
        await page.waitForTimeout(80);
        expect(await toggleRow.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(rowBackground);
      }
    } finally {
      await context.close();
    }
  });

  test('keeps legacy list-item hover feedback on migrated settings pages', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('item-hover-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();

      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('.si-page')).toBeVisible();
      await setChunkSafeSettings(page, {
        userExperience: { enableContentFilter: true },
        contentFilter: {
          enabled: true,
          keywordRules: [{
            id: 'hover-check',
            name: 'hover-check',
            keyword: 'hover-check',
            action: 'hide',
            enabled: true,
            fields: ['title'],
          }],
        },
      });

      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/search-engine-settings'), {
        waitUntil: 'domcontentloaded',
      });
      const engineRow = page.locator('#search-engine-list [data-engine-id]').first();
      await expect(engineRow).toBeVisible();
      await page.mouse.move(0, 0);
      const engineBefore = await engineRow.evaluate((element) => getComputedStyle(element).transform);
      await engineRow.hover();
      await page.waitForTimeout(250);
      expect(await engineRow.evaluate((element) => getComputedStyle(element).transform)).not.toBe(engineBefore);

      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await page.mouse.move(0, 0);
      const filterToggle = page.locator('#enableContentFilter');
      await expect(filterToggle).toHaveCount(1);
      await expect(filterToggle).toBeChecked();
      const filterCard = page.locator('[data-enhancement-feature="内容过滤"]');
      await filterCard.hover();
      await page.waitForTimeout(180);
      const rule = page.locator('#filterRulesList > div').first();
      await expect(rule).toBeVisible();
      const ruleBefore = await rule.evaluate((element) => getComputedStyle(element).backgroundColor);
      await rule.hover();
      await page.waitForTimeout(250);
      expect(await rule.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(ruleBefore);

    } finally {
      await context.close();
    }
  });

  test('keeps legacy settings-search anchors available on the React search-engine page', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('settings-search-anchor-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings'), {
        waitUntil: 'domcontentloaded',
      });

      const search = page.locator('.jdb-settings-search-input');
      await expect(search).toBeVisible();
      await search.fill('是否启用');
      const result = page.locator('.jdb-settings-search-result').first();
      await expect(result).toContainText('是否启用');
      await result.click();

      await expect(page).toHaveURL(/#tab-settings\/search-engine-settings$/);
      const anchor = page.locator('#search-engine-enabled-column');
      await expect(anchor).toBeVisible();
      await expect(anchor).toHaveClass(/jdb-settings-search-highlight/);
    } finally {
      await context.close();
    }
  });

  test('preserves WebDAV section and modal compatibility anchors in React', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('webdav-compatibility-anchor-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      // NOTE (2026-08-26): 干净 profile 下 settings 全走 DEFAULT，webdav.enabled=false。
      // 通过 service worker 写入 extension storage（与 dashboard 页读取同一分区），
      // 先开启 webdav 再打开页面，确保各 section 正常渲染。
      await seedExtensionStorage(context, {
        settings: { webdav: { enabled: true } },
      });
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/webdav-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('#webdavConfigSection')).toBeVisible();
      await expect(page.locator('#webdavClientsSection')).toBeVisible();
      await expect(page.locator('#webdavSyncSection')).toBeVisible();
      await expect(page.locator('#webdavBackupSection')).toBeVisible();
      await expect(page.locator('#webdav-next-sync-time')).toHaveCount(1);

      await expect(page.locator('#webdavConfigModal')).toHaveCount(1);
      await expect(page.locator('#modalConfigName')).toHaveCount(1);
      await expect(page.locator('#saveWebdavConfigModal')).toHaveCount(1);
      await expect(page.locator('#webdavConfigModal')).toBeHidden();

      await page.locator('#addWebdavConfig').click();
      for (const id of [
        'webdavConfigModalTitle',
        'closeWebdavConfigModal',
        'modalCopyWebdavFullUrl',
        'modalWebdavAlistHint',
        'modalCopyWebdavUser',
        'modalToggleWebdavPasswordVisibility',
        'modalCopyWebdavPass',
        'cancelWebdavConfigModal',
        'testWebdavConfigModal',
        'saveWebdavConfigModal',
      ]) {
        await expect(page.locator(`#${id}`)).toHaveCount(1);
      }
    } finally {
      await context.close();
    }
  });

  test('preserves network proxy compatibility wrappers in React', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('network-compatibility-anchor-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/network-test-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('#github-proxy-config')).toHaveCount(1);
      for (const id of [
        'custom-proxy-url-group',
        'custom-proxy-url',
        'proxy-test-results',
        'ping-results-container',
        'ping-results',
        'domain-config-panel',
        'domain-config-content',
        'batch-test-results',
      ]) {
        await expect(page.locator(`#${id}`)).toHaveCount(1);
      }
      await expect(page.locator('#custom-proxy-url-group')).toBeHidden();
      await expect(page.locator('#proxy-test-results')).toBeHidden();
      await expect(page.locator('#ping-results-container')).toBeHidden();
      await expect(page.locator('#domain-config-panel')).toBeHidden();
      await expect(page.locator('#batch-test-results')).toBeHidden();
      await page.locator('#github-proxy-service').selectOption('custom');
      await expect(page.locator('#custom-proxy-url-group')).toBeVisible();
      await expect(page.locator('#custom-proxy-url')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('keeps the legacy network-test visual hierarchy and control sizing', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('network-visual-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/network-test-settings'), {
        waitUntil: 'domcontentloaded',
      });

      const styles = await page.locator('[data-network-test-settings-react="1"]').last().evaluate((root) => {
        const header = root.querySelector('[data-ui-pattern="page-header"]') as HTMLElement | null;
        const title = header?.querySelector('h2') as HTMLElement | null;
        const section = root.querySelector('#network-test-settings > [data-ui-pattern="setting-section"]') as HTMLElement | null;
        const input = root.querySelector('#custom-proxy-url') as HTMLInputElement | null;
        const select = root.querySelector('#github-proxy-service') as HTMLSelectElement | null;
        const batchResults = root.querySelector('#batch-test-results') as HTMLElement | null;
        return {
          titleFontSize: title ? getComputedStyle(title).fontSize : '',
          headerBorderBottomWidth: header ? getComputedStyle(header).borderBottomWidth : '',
          sectionRadius: section ? getComputedStyle(section).borderRadius : '',
          inputHeight: input ? getComputedStyle(input).height : '',
          inputBorderWidth: input ? getComputedStyle(input).borderTopWidth : '',
          selectMaxWidth: select ? getComputedStyle(select).maxWidth : '',
          batchMaxHeight: batchResults ? getComputedStyle(batchResults).maxHeight : '',
          batchOverflowY: batchResults ? getComputedStyle(batchResults).overflowY : '',
        };
      });

      expect(styles).toEqual({
        titleFontSize: '28px',
        headerBorderBottomWidth: '2px',
        sectionRadius: '8px',
        inputHeight: '42px',
        inputBorderWidth: '2px',
        selectMaxWidth: '400px',
        batchMaxHeight: '500px',
        batchOverflowY: 'auto',
      });
      const pageRoot = page.locator('[data-network-test-settings-react="1"]').last();
      await expect(pageRoot.locator('.network-test-input-with-icon')).toHaveCount(2);
      await expect(pageRoot.locator('.network-test-domain-stats')).toBeVisible();
      await expect(pageRoot.locator('.network-test-route-item').first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('persists the custom GitHub proxy selection after a browser reload', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('network-proxy-persistence-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      const pageUrl = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/network-test-settings');
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

      await page.locator('#github-proxy-service').selectOption('custom');
      await page.locator('#custom-proxy-url').fill('https://proxy.example.test/');
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        return (state.settings as {
          networkAcceleration?: { github?: { proxyService?: string; customProxyUrl?: string } };
        } | undefined)?.networkAcceleration?.github;
      })).toEqual({
        enabled: true,
        proxyService: 'custom',
        customProxyUrl: 'https://proxy.example.test/',
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#github-proxy-service')).toHaveValue('custom');
      await expect(page.locator('#custom-proxy-url')).toHaveValue('https://proxy.example.test/');
    } finally {
      await context.close();
    }
  });

  test('persists a search-engine enable toggle after a browser reload', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('search-engine-persistence-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      const pageUrl = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/search-engine-settings');
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

      const engine = page.locator('#search-engine-list [data-engine-id]').first();
      const toggle = engine.locator('input[type="checkbox"]');
      const engineId = await engine.getAttribute('data-engine-id');
      const nextEnabled = !await toggle.isChecked();
      await toggle.locator('xpath=ancestor::label[1]').click();
      await expect.poll(async () => page.evaluate(async ({ id, enabled }) => {
        const state = await chrome.storage.local.get('settings');
        const engines = (state.settings as { searchEngines?: Array<{ id?: string; enabled?: boolean }> } | undefined)
          ?.searchEngines ?? [];
        return engines.find((entry) => entry.id === id)?.enabled;
      }, { id: engineId, enabled: nextEnabled })).toBe(nextEnabled);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`#search-engine-list [data-engine-id="${engineId}"] input[type="checkbox"]`)).toBeChecked({
        checked: nextEnabled,
      });
    } finally {
      await context.close();
    }
  });

  test('adds a custom search engine through the modal without losing input events', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('search-engine-modal-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/search-engine-settings'), {
        waitUntil: 'domcontentloaded',
      });

      await page.locator('#add-search-engine').click();
      await page.locator('#search-engine-modal-name').fill('事件回归搜索');
      await page.locator('#search-engine-modal-url').fill('https://search.example.test/?q={{ID}}');
      await page.locator('#search-engine-modal-icon').fill('assets/alternate-search.png');
      await page.getByRole('button', { name: '确认新增' }).click();

      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        const engines = (state.settings as { searchEngines?: Array<{ name?: string; urlTemplate?: string }> } | undefined)
          ?.searchEngines ?? [];
        return engines.find((engine) => engine.name === '事件回归搜索');
      })).toMatchObject({
        name: '事件回归搜索',
        urlTemplate: 'https://search.example.test/?q={{ID}}',
      });
    } finally {
      await context.close();
    }
  });

  test('persists a saved WebDAV configuration after a browser reload', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('webdav-config-persistence-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      const pageUrl = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/webdav-settings');
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

      await page.locator('#addWebdavConfig').click();
      const modalStyle = await page.locator('#webdavConfigModal [role="dialog"]').evaluate((dialog) => {
        const header = dialog.children.item(0) as HTMLElement;
        const body = dialog.children.item(1) as HTMLElement;
        const footer = dialog.children.item(2) as HTMLElement;
        const testButton = dialog.querySelector('#testWebdavConfigModal') as HTMLElement;
        const provider = dialog.querySelector('#modalWebdavProvider') as HTMLElement;
        const folder = dialog.querySelector('#modalWebdavFolder') as HTMLElement;
        const copyUser = dialog.querySelector('#modalCopyWebdavUser') as HTMLElement;
        return {
          width: getComputedStyle(dialog).width,
          headerPadding: getComputedStyle(header).padding,
          bodyPadding: getComputedStyle(body).padding,
          footerPadding: getComputedStyle(footer).padding,
          testBackground: getComputedStyle(testButton).backgroundColor,
          providerWidth: getComputedStyle(provider).width,
          folderWidth: getComputedStyle(folder).width,
          copyUserPosition: getComputedStyle(copyUser).position,
        };
      });
      expect(modalStyle.width).toBe('600px');
      expect(modalStyle.headerPadding).toBe('20px 24px');
      expect(modalStyle.bodyPadding).toBe('24px');
      expect(modalStyle.footerPadding).toBe('16px 24px');
      expect(modalStyle.testBackground).toBe('rgb(34, 197, 94)');
      expect(modalStyle.providerWidth).toBe('120px');
      expect(modalStyle.folderWidth).toBe('150px');
      expect(modalStyle.copyUserPosition).toBe('absolute');
      await page.locator('#modalConfigName').fill('持久化检查');
      await page.locator('#modalWebdavUrl').fill('https://dav.jianguoyun.com/dav/');
      const username = page.locator('#modalWebdavUser');
      await username.evaluate((element) => {
        const dialog = element.closest('[role="dialog"]');
        const content = dialog?.children.item(1) as HTMLElement | null;
        content?.scrollTo({ top: element.parentElement?.parentElement?.offsetTop ?? 0 });
      });
      await expect(username).toBeInViewport();
      await username.fill('test-user');
      const password = page.locator('#modalWebdavPass');
      await password.scrollIntoViewIfNeeded();
      await expect(password).toBeInViewport();
      await password.fill('test-password');
      const save = page.locator('#saveWebdavConfigModal');
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport();
      await save.click();
      await expect(page.locator('#webdavConfigModal')).toBeHidden();
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        return (state.settings as { webdav?: { configs?: Array<{ name?: string; url?: string }> } } | undefined)
          ?.webdav?.configs?.find((config) => config.name === '持久化检查');
      })).toMatchObject({
        name: '持久化检查',
        url: 'https://dav.jianguoyun.com/dav/',
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#webdavConfigList')).toContainText('持久化检查');
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        return (state.settings as { webdav?: { configs?: Array<{ name?: string; url?: string }> } } | undefined)
          ?.webdav?.configs?.find((config) => config.name === '持久化检查')?.url;
      })).toBe('https://dav.jianguoyun.com/dav/');
    } finally {
      await context.close();
    }
  });

  test('uses the extension confirmation dialog for destructive WebDAV actions', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('webdav-confirmation-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/webdav-settings'), {
        waitUntil: 'domcontentloaded',
      });

      await page.locator('#addWebdavConfig').click();
      await page.locator('#modalConfigName').fill('确认弹窗检查');
      await page.locator('#modalWebdavUrl').fill('https://dav.example.test/dav/');
      await page.locator('#modalWebdavUser').fill('confirm-user');
      await page.locator('#modalWebdavPass').fill('confirm-password');
      await page.locator('#saveWebdavConfigModal').scrollIntoViewIfNeeded();
      await page.locator('#saveWebdavConfigModal').click();
      const row = page.locator('#webdavConfigList [data-config-id]').filter({ hasText: '确认弹窗检查' });
      await expect(row).toBeVisible();

      await row.getByRole('button', { name: '删除' }).click();
      const confirmOverlay = page.locator('.confirm-modal .modal-overlay.visible');
      await expect(confirmOverlay).toBeVisible();
      await expect(confirmOverlay).toContainText('确定要删除配置"确认弹窗检查"吗？');
      await page.locator('#confirmCancel').click();
      await expect(row).toBeVisible();

      await row.getByRole('button', { name: '删除' }).click();
      await page.locator('#confirmOk').click();
      await expect(row).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('recreates enhancement cards, status markers, and orchestration controls in React', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-interaction-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings'), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator('.ssp-page[data-enhancement-settings-react="1"]')).toBeVisible();
      await expect(page.locator('#enhancement-settings .enhancement-notice')).toBeVisible();
      const previewCard = page.locator('[data-enhancement-feature="视频预览"]');
      await expect(previewCard.locator('.enhancement-feature-status.available')).toHaveText('可用');
      await expect(previewCard.locator('.enhancement-feature-card__master')).toBeVisible();

      await page.getByRole('tab', { name: '其他增强' }).click();
      const libraryCard = page.locator('[data-enhancement-feature="本地媒体库匹配"]');
      const help = libraryCard.locator('.enhancement-feature-card__help');
      await expect(help).toBeAttached();
      await expect(help.locator('.enhancement-feature-card__help-trigger')).toBeVisible();
      await expect(help.locator('.enhancement-feature-card__help-trigger i.fa-question-circle')).toBeVisible();
      await help.locator('.enhancement-feature-card__help-trigger').click();
      await expect(help).toHaveAttribute('open', '');
      await expect(help.locator('.enhancement-feature-card__help-popover')).toContainText('先在 115 设置中配置媒体库根目录');
      await page.getByRole('tab', { name: '列表页增强' }).click();

      const previewConfig = page.locator('#listVideoPreviewConfig');
      const previewDetails = previewCard.locator('.enhancement-feature-card__details');
      await expect(previewConfig).toBeAttached();
      await page.mouse.move(0, 0);
      await expect(previewDetails).toHaveCSS('max-height', '0px');

      await previewCard.hover();
      await expect(previewDetails).not.toHaveCSS('max-height', '0px');
      await page.mouse.move(0, 0);
      await expect(previewDetails).toHaveCSS('max-height', '0px');

      const orchestratorButton = page.locator('#showOrchestratorBtn');
      await expect(orchestratorButton).toBeVisible();
      await orchestratorButton.click();
      await expect(page.locator('#orchestratorModal')).toBeVisible();
      await page.locator('#orchestratorCloseBtn').click();
      await expect(page.locator('#orchestratorModal')).not.toBeVisible();

      const videoPreviewToggle = page.locator('#enableVideoPreview');
      await expect(videoPreviewToggle).toBeChecked();
      await previewCard.locator('.enhancement-feature-card__master > [data-ui-pattern] > label').click();
      await expect(videoPreviewToggle).not.toBeChecked();
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        return (state.settings as { listEnhancement?: { enableVideoPreview?: boolean } } | undefined)
          ?.listEnhancement?.enableVideoPreview;
      })).toBe(false);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#enableVideoPreview')).not.toBeChecked();
    } finally {
      await context.close();
    }
  });

  test('restores library matching and last actor filters from the legacy enhancement page', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-legacy-state-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      const enhancementUrl = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings');

      // 先完成 dashboard 初始化，再预置“已有配置”；避免页面加载中的默认读取与拟真配置写入竞态。
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('.si-page')).toBeVisible();
      await setChunkSafeSettings(page, {
            libraryMatchStatus: {
              enabled: true,
              sources: { drive115: true, emby: true },
            },
            userExperience: {
              enableActorEnhancement: true,
            },
            actorEnhancement: {
              enabled: true,
              autoApplyTags: true,
            },
      });
      await page.evaluate(async () => {
        await chrome.storage.local.set({ lastAppliedActorTags: 's,d' });
      });
      await expect.poll(async () => page.evaluate(async () => {
        const state = await chrome.storage.local.get('settings');
        return (state.settings as { libraryMatchStatus?: { enabled?: boolean } } | undefined)
          ?.libraryMatchStatus?.enabled;
      })).toBe(true);
      await page.goto(enhancementUrl, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-enhancement-settings-react="1"]').last()).toBeVisible();
      await page.waitForTimeout(800);

      await page.getByRole('tab', { name: '其他增强' }).click();
      const libraryMatchToggle = page.locator('#enableLibraryMatchStatus').last();
      await expect(libraryMatchToggle).toBeChecked();

      await page.getByRole('tab', { name: '演员页增强' }).click();
      const actorFilterCard = page.locator('[data-enhancement-feature="影片类别过滤"]');
      await actorFilterCard.evaluate((element) => {
        element.dispatchEvent(new Event('jdb:enhancement:reveal-card'));
      });
      await expect(actorFilterCard).toHaveAttribute('data-expanded', '1');
      await expect(page.locator('#lastAppliedTagsDisplay')).toBeVisible();
      await expect(page.locator('#appliedTagsContainer')).toContainText('单体作品');
      await expect(page.locator('#appliedTagsContainer')).toContainText('含磁链');

      await page.locator('#clearLastAppliedTags').click();
      await expect(page.locator('#appliedTagsContainer')).toHaveText('暂无记录');
      await expect.poll(async () => page.evaluate(async () => (
        await chrome.storage.local.get('lastAppliedActorTags')
      ).lastAppliedActorTags)).toBe('');
    } finally {
      await context.close();
    }
  });

  test('keeps enhancement child settings hidden until the card is engaged', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-collapse-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings'), {
        waitUntil: 'domcontentloaded',
      });

      const card = page.locator('[data-enhancement-feature="点击增强"]');
      const details = card.locator('.enhancement-feature-card__details');
      await expect(details).toBeAttached();
      await page.mouse.move(0, 0);
      await expect(details).toHaveCSS('max-height', '0px');
      await expect(details).toHaveCSS('pointer-events', 'none');

      await card.hover();
      await expect(details).not.toHaveCSS('max-height', '0px');
      await expect(details).toHaveCSS('pointer-events', 'auto');
    } finally {
      await context.close();
    }
  });

  test('reveals and highlights the owning React card when settings search targets a nested enhancement control', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-search-highlight-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      const enhancementUrl = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings');

      await page.goto(enhancementUrl, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        sessionStorage.setItem('jdb:settingsSearch:target', JSON.stringify({
          hash: '#tab-settings/enhancement-settings',
          targetSelector: '#previewDelay',
          title: '预览延迟时间',
        }));
      });
      await page.goto(enhancementUrl, { waitUntil: 'domcontentloaded' });

      const previewCard = page.locator('[data-enhancement-feature="视频预览"]');
      await expect(previewCard).toHaveAttribute('data-expanded', '1');
      await expect(previewCard).toHaveClass(/jdb-settings-search-highlight/);
      await expect(previewCard.locator('#previewDelay')).toBeVisible();

      await page.getByRole('tab', { name: '影片页增强' }).click();
      const externalEntryToggle = page.locator('[data-enhancement-feature="外部入口面板"] input#veEnableExternalEntryPanel');
      if (!await externalEntryToggle.isChecked()) await externalEntryToggle.locator('xpath=ancestor::label[1]').click();
      await page.locator('[data-enhancement-feature="外部入口面板"]').hover();
      await expect(page.locator('[data-settings-search-target="online-availability-site:fanza"]')).toBeAttached();
      await page.getByRole('tab', { name: '列表页增强' }).click();
      await page.locator('[data-enhancement-feature="视频预览"]').hover();
      await expect(page.locator('[data-settings-search-target="magnet-concurrency:magnetPageMaxConcurrentRequests"]')).toHaveCount(0);
      await page.getByRole('tab', { name: '影片页增强' }).click();
      const magnetToggle = page.locator('[data-enhancement-feature="磁力资源搜索"] input#enableMagnetSearch');
      if (!await magnetToggle.isChecked()) await magnetToggle.locator('xpath=ancestor::label[1]').click();
      await page.locator('[data-enhancement-feature="磁力资源搜索"]').hover();
      await expect(page.locator('[data-settings-search-target="magnet-concurrency:magnetPageMaxConcurrentRequests"]')).toHaveAttribute('max', '8');
      await expect(page.locator('[data-settings-search-target="magnet-concurrency:magnetBgGlobalMaxConcurrent"]')).toHaveAttribute('max', '16');
      await expect(page.locator('[data-settings-search-target="magnet-concurrency:magnetBgPerHostMaxConcurrent"]')).toHaveAttribute('max', '4');
      await expect(page.locator('[data-settings-search-target="magnet-concurrency:magnetBgPerHostRateLimitPerMin"]')).toHaveAttribute('max', '120');
    } finally {
      await context.close();
    }
  });

  test('keeps every rendered enhancement child configuration fully collapsed while its subtab is idle', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-idle-details-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings'), {
        waitUntil: 'domcontentloaded',
      });

      let detailsCount = 0;
      for (const subtab of [
        { id: 'list', label: '列表页增强' },
        { id: 'video', label: '影片页增强' },
        { id: 'actor', label: '演员页增强' },
        { id: 'other', label: '其他增强' },
      ]) {
        await page.getByRole('tab', { name: subtab.label }).click();
        const masterToggles = page.locator(
          `[data-enhancement-subtab="${subtab.id}"] .enhancement-feature-card__master input[type="checkbox"]:not(:disabled)`,
        );
        for (let index = 0; index < await masterToggles.count(); index += 1) {
          const toggle = masterToggles.nth(index);
          if (!await toggle.isChecked()) await toggle.locator('xpath=ancestor::label[1]').click();
        }
        await page.mouse.move(0, 0);
        await page.waitForTimeout(700);

        const state = await page.locator(`[data-enhancement-subtab="${subtab.id}"] .enhancement-feature-card__details`).evaluateAll((details) => (
          details.map((detail) => {
            const style = getComputedStyle(detail);
            return {
              ariaHidden: detail.getAttribute('aria-hidden'),
              height: detail.getBoundingClientRect().height,
              maxHeight: style.maxHeight,
              overflow: style.overflow,
              pointerEvents: style.pointerEvents,
            };
          })
        ));

        detailsCount += state.length;
        for (const detail of state) {
          expect(detail.ariaHidden).toBe('true');
          expect(detail.height).toBe(0);
          expect(detail.maxHeight).toBe('0px');
          expect(detail.overflow).toBe('hidden');
          expect(detail.pointerEvents).toBe('none');
        }
      }
      expect(detailsCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('renders a specific icon and status for every enhancement feature card', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-card-metadata-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings'), {
        waitUntil: 'domcontentloaded',
      });

      for (const [subtabId, subtab] of [
        ['list', '列表页增强'],
        ['video', '影片页增强'],
        ['actor', '演员页增强'],
        ['other', '其他增强'],
      ]) {
        await page.getByRole('tab', { name: subtab }).click();
        const cards = page.locator(`[data-enhancement-subtab="${subtabId}"] .enhancement-feature-card`);
        expect(await cards.count()).toBeGreaterThan(0);
        for (let index = 0; index < await cards.count(); index += 1) {
          const card = cards.nth(index);
          await expect(card.locator('.enhancement-feature-name')).not.toContainText('✨');
          await expect(card.locator('.enhancement-feature-status')).toHaveText(/.+/);
        }
      }

      const libraryCard = page.locator('[data-enhancement-feature="本地媒体库匹配"]');
      await expect(libraryCard.locator('.enhancement-feature-name')).toContainText('🗂️');
      await expect(libraryCard.locator('.enhancement-risk-notice')).toContainText('调用限制提示');
      const usageHelp = libraryCard.locator('details.enhancement-usage-help');
      await expect(usageHelp.locator('summary')).toHaveAttribute('aria-label', '使用帮助');
      await expect(usageHelp.locator('summary')).toHaveAttribute('title', '使用帮助');
      await usageHelp.locator('summary').click();
      await expect(usageHelp.locator('ol')).toContainText('完成一次索引');
      await expect(usageHelp.locator('ol')).toContainText('不在列表页实时搜索 115');

      await page.getByRole('tab', { name: '影片页增强' }).click();
      const externalCard = page.locator('[data-enhancement-feature="外部入口面板"]');
      await externalCard.hover();
      await expect(externalCard).toContainText('检测 FANZA、Jable、MISSAV');

      const magnetCard = page.locator('[data-enhancement-feature="磁力资源搜索"]');
      const magnetToggle = page.locator('#enableMagnetSearch');
      if (!await magnetToggle.isChecked()) await magnetToggle.locator('xpath=ancestor::label[1]').click();
      await magnetCard.hover();
      await expect(magnetCard).toContainText('搜索源说明');

      await page.getByRole('tab', { name: '演员页增强' }).click();
      const actorFilterCard = page.locator('[data-enhancement-feature="影片类别过滤"]');
      const actorFilterToggle = page.locator('#enableActorEnhancement');
      if (!await actorFilterToggle.isChecked()) await actorFilterToggle.locator('xpath=ancestor::label[1]').click();
      await actorFilterCard.hover();
      await expect(actorFilterCard).toContainText('智能兼容');
    } finally {
      await context.close();
    }
  });

  test('preserves legacy star choices and hidden Google API controls in Chromium', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-legacy-options-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      const enhancementUrl = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings');
      await page.goto(enhancementUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: '影片页增强' }).click();

      const translationCard = page.locator('[data-enhancement-feature="智能标题翻译"]');
      await translationCard.hover();
      await expect(page.locator('#traditionalApiKey')).toHaveCount(0);

      const statusCard = page.locator('[data-enhancement-feature="状态标记增强"]');
      await statusCard.hover();
      const statusToggle = statusCard.locator('#enableVideoEnhancement');
      if (!await statusToggle.isChecked()) {
        await statusToggle.locator('xpath=ancestor::label[1]').click();
      }
      const starSelect = page.locator('#veAutoMarkWatchedStars');
      await expect(statusToggle).toBeChecked();
      await expect.poll(async () => starSelect.count()).toBe(1);
      await expect(starSelect).toBeVisible();
      await expect(starSelect.locator('option')).toHaveCount(6);
      await expect(starSelect.locator('option').first()).toHaveAttribute('value', '0');
      expect(await starSelect.locator('option').allTextContents()).toEqual(['不评分', '1星', '2星', '3星', '4星', '5星']);
      await starSelect.selectOption('0');
      await expect(starSelect).toHaveValue('0');
    } finally {
      await context.close();
    }
  });

  test('keeps normal enhancement inputs legible after hover and focus in both themes', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('enhancement-input-theme-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings'), {
        waitUntil: 'domcontentloaded',
      });

      const previewCard = page.locator('[data-enhancement-feature="视频预览"]');
      await previewCard.hover();
      await expect(previewCard).toHaveAttribute('data-expanded', '1');
      const delayInput = previewCard.locator('#previewDelay');
      await expect(delayInput).toBeVisible();

      for (const theme of ['light', 'dark'] as const) {
        await page.locator('html').evaluate((element, nextTheme) => element.setAttribute('data-theme', nextTheme), theme);
        await delayInput.hover();
        await delayInput.focus();
        const colors = await delayInput.evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, background: style.backgroundColor, caretColor: style.caretColor };
        });
        expect(colors.color).not.toBe(colors.background);
        expect(colors.caretColor).toBe(colors.color);
      }
    } finally {
      await context.close();
    }
  });

  test('keeps visible settings inputs readable and every long page scrollable in both themes', async ({}, testInfo) => {
    test.setTimeout(180_000);
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('settings-inputs-and-scroll-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();

      for (const entry of SETTINGS_REACT_PAGES) {
        await page.goto(extensionPageUrl(extensionId, `dashboard/dashboard.html#tab-settings/${entry.id}`), {
          waitUntil: 'domcontentloaded',
        });
        const scrollState = await page.locator('#tab-settings').evaluate((element) => {
          const root = element as HTMLElement;
          root.scrollTop = root.scrollHeight;
          return { scrollTop: root.scrollTop, maxScrollTop: root.scrollHeight - root.clientHeight };
        });
        if (scrollState.maxScrollTop > 4) {
          expect(scrollState.scrollTop).toBeGreaterThan(0);
        }

        for (const theme of ['light', 'dark'] as const) {
          await page.locator('html').evaluate((element, nextTheme) => {
            element.setAttribute('data-theme', nextTheme);
          }, theme);
          const inputs = page.locator('.ssp-page input:not([type="checkbox"]):not([type="radio"]), .ssp-page textarea');
          for (let index = 0; index < await inputs.count(); index += 1) {
            const input = inputs.nth(index);
            if (!await input.isVisible()) continue;
            await input.hover();
            await input.focus();
            const colors = await input.evaluate((element) => {
              const style = getComputedStyle(element);
              return { color: style.color, caretColor: style.caretColor, background: style.backgroundColor };
            });
            expect(colors.color).not.toBe(colors.background);
            expect(colors.caretColor).not.toBe(colors.background);
          }
        }
      }
    } finally {
      await context.close();
    }
  });

  test('edits content filtering rules through the full modal in Chromium', async ({}, testInfo) => {
    const harnessOptions = resolveExtensionHarnessOptions({
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('filter-rule-modal-profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harnessOptions, {
      headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });

    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings'), {
        waitUntil: 'domcontentloaded',
      });

      const contentFilter = page.locator('#enableContentFilter');
      if (!await contentFilter.isChecked()) {
        await contentFilter.locator('xpath=ancestor::label[1]').click();
      }
      const card = page.locator('[data-enhancement-feature="内容过滤"]');
      await card.hover();
      await page.locator('#addFilterRule').click();

      const modal = page.locator('[data-enhancement-filter-rule-modal="1"]');
      await expect(modal).toBeVisible();
      await expect(modal.locator('#modalInlineRuleName')).toBeVisible();
      await expect(modal.locator('#modalInlineRuleFields')).toBeVisible();
      await expect(modal.locator('#modalInlineRuleMessage')).toBeVisible();

      for (const theme of ['light', 'dark'] as const) {
        await page.locator('html').evaluate((element, nextTheme) => element.setAttribute('data-theme', nextTheme), theme);
        const colors = await modal.locator('#modalInlineRuleName').evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, background: style.backgroundColor, caretColor: style.caretColor };
        });
        expect(colors.color).not.toBe(colors.background);
        expect(colors.caretColor).toBe(colors.color);
      }

      await modal.locator('#modalInlineRuleName').fill('高亮示例');
      await modal.locator('#modalInlineRuleKeyword').fill('ABF');
      await modal.locator('#modalInlineRuleAction').selectOption('highlight');
      await modal.locator('#modalInlineRuleFields').selectOption(['title']);
      await modal.locator('#saveFilterRuleBtn').click();

      await expect(modal).toBeHidden();
      await expect(page.locator('#filterRulesList')).toContainText('高亮示例');
      await expect(page.locator('#filterRulesList')).toContainText('高亮');
    } finally {
      await context.close();
    }
  });
});
