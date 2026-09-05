/**
 * @file relatedLists.spec.ts
 * @description #48 真机回归：JavDB 2026-08 新影片页 DOM 下「相關清單」功能。
 * 背景：新 DOM 中 tab 为 li[data-movie-tab-target="listTab"] > a.list-tab[data-url="/v/<id>/lists/related"]，
 *      原生空面板为 div[data-movie-tab-target="lists"]#lists；旧通配选择器会误命中 #lists，
 *      导致中和逻辑剥离原生面板属性、点击 tab 走 JavDB 原生导航（触发 VIP 解锁提示）。
 * 证据链：
 *   1) 页面控制台出现 "[RelatedLists] click interception installed"（拦截器已装）；
 *   2) 原生 #lists 面板保留 data-movie-tab-target="lists"（未被误中和）；
 *   3) 新 DOM tab 被中和：href 改写为 #jdb-related-lists-panel、data-action 剥离；
 *   4) 点击 tab 后 #jdb-related-lists-panel 打开（aria-hidden=false）并渲染清单卡片，
 *      且 URL 仍停留在影片详情页（未发生原生导航）。
 * @module tests/extension-e2e
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';
import {
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
} from '../../scripts/extensionHarness';

function resolveTestHarnessOptions(userDataDir: string): ReturnType<typeof resolveExtensionHarnessOptions> {
  return resolveExtensionHarnessOptions(
    {
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: path.resolve(userDataDir),
    },
    process.cwd(),
  );
}

const JAVDB_E2E_HOST = 'https://javdb570.com';
const E2E_VIDEO_URL = `${JAVDB_E2E_HOST}/v/ZNzGYP`;
const LIST_TAB_SELECTOR = 'li[data-movie-tab-target="listTab"] > a.list-tab';

/** 全新测试 profile 首次访问影片页可能遇到 18+ 年龄确认页，自动点过（最多 3 轮） */
async function dismissAgeGateIfPresent(page: import('@playwright/test').Page): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const yes = page.locator('a[href*="over18?respond=1"]').first();
    let visible = false;
    try {
      visible = (await yes.count()) > 0 && (await yes.isVisible());
    } catch {
      return;
    }
    if (!visible) return;
    await yes.click({ timeout: 10_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });
  }
}

/** 本机环境代理不可达 javdb570，浏览器必须直连；node 侧 fetch 本来就不走代理 */
function stripProxyEnv(): void {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[key];
  }
}

test.describe('related lists on JavDB new video-detail DOM (#48)', () => {
  test.setTimeout(180_000);

  test('new-DOM tab is neutralized and click opens in-page panel without navigation', async ({}, testInfo) => {
    // 网络预检（不可达则 skip，避免环境抖动造成误报）
    try {
      const resp = await fetch(E2E_VIDEO_URL, { signal: AbortSignal.timeout(20_000) });
      if (!resp.ok) test.skip(true, `影片页不可达 (status=${resp.status})`);
    } catch (error) {
      test.skip(true, `网络不可用，跳过真机检查: ${error instanceof Error ? error.message : String(error)}`);
    }

    stripProxyEnv();
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
      // 本机环境代理不可达 javdb570，强制浏览器直连
      extraArgs: ['--no-proxy-server'],
    });

    try {
      await readExtensionId(context);
      const page = context.pages()[0] ?? (await context.newPage());
      const consoleLines: string[] = [];
      page.on('console', (msg) => consoleLines.push(msg.text()));

      await page.goto(E2E_VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await dismissAgeGateIfPresent(page);

      // 1) 等待扩展内容脚本安装点击拦截
      await expect
        .poll(
          () => consoleLines.some((line) => line.includes('[RelatedLists] click interception installed')),
          { timeout: 45_000, message: '相关清单点击拦截未安装（内容脚本未生效?）' },
        )
        .toBeTruthy();

      // 2) 原生空面板结构必须保留（旧 bug：被误中和，剥离 data-movie-tab-target）
      await expect
        .poll(async () => {
          const el = await page.$('#lists');
          return el ? el.getAttribute('data-movie-tab-target') : null;
        }, { timeout: 15_000, message: '原生 #lists 面板不存在或缺少 data-movie-tab-target（被误中和）' })
        .toBe('lists');

      // 3) 新 DOM tab 被中和：href 改写 + data-action 剥离
      await expect
        .poll(async () => {
          const tab = await page.$(LIST_TAB_SELECTOR);
          return tab ? (await tab.getAttribute('href')) === '#jdb-related-lists-panel' : false;
        }, { timeout: 30_000, message: 'listTab tab 未被中和（href 未改写为 #jdb-related-lists-panel）' })
        .toBeTruthy();
      const tabDataAction = await page.$eval(LIST_TAB_SELECTOR, (el) => el.getAttribute('data-action'));
      expect(tabDataAction, 'tab 的 data-action 应被剥离').toBeNull();

      // 4) 点击 tab：页面内面板打开并渲染卡片，且不发生原生导航
      await page.click(LIST_TAB_SELECTOR);
      await expect
        .poll(async () => {
          return page.evaluate(() => {
            const panel = document.getElementById('jdb-related-lists-panel');
            return !!panel
              && panel.getAttribute('aria-hidden') === 'false'
              && panel.querySelectorAll('.jdb-related-list-card').length >= 1;
          });
        }, { timeout: 30_000, message: '相关清单面板未打开或未渲染清单卡片' })
        .toBeTruthy();
      const panelState = await page.evaluate(() => {
        const panel = document.getElementById('jdb-related-lists-panel');
        return panel
          ? { ariaHidden: panel.getAttribute('aria-hidden'), cards: panel.querySelectorAll('.jdb-related-list-card').length }
          : null;
      });

      // URL 必须仍停留在影片详情页（旧 bug：点击后跳到原生清单页/VIP 提示）
      expect(new URL(page.url()).pathname).toBe('/v/ZNzGYP');

      console.info(`[E2E #48] 面板状态: ${JSON.stringify(panelState)}, URL=${page.url()}`);
    } finally {
      await context.close();
    }
  });
});
