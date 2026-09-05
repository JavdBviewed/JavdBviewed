/**
 * @file listEnhancement-switches.spec.ts
 * @description 列表增强「开关矩阵」—— 真实浏览器（Chromium 加载 MV3 拓展）端到端验证：
 *   a) 主开关 userExperience.enableListEnhancement=false → 列表页不插入任何 x-btn / 预览 / 快捷操作；
 *   b) 主开关开启（默认子开关）→ 扩展在每张卡片插入 x-btn（data-code 正确）；
 *   c) F-L1 回归：enableVideoPreview=true 但 enableVideoPreviewList=false →
 *      封面不挂 x-preview、hover 不出预览 video；开关切 true 并**重载页面**后 hover 出 video
 *      （TEST-001 命中内置示例地址，无需真实网络解析）。
 *      注意：预览 attach 发生在 enhanceItem（带 data-list-enhanced 守卫），
 *      运行时切换开关不会重新 attach，因此正向断言必须在 reload 之后。
 *      reload 后需先将鼠标移离封面中心再 hover：同坐标零位移的 CDP
 *      mouseMoved 不会让 Chromium 重新派发 mouseover，show() 将永不触发。
 *   d) enableStatusQuickAction false→true→false：卡片状态快捷按钮同页即时增删；
 *   e) F-L3：hideUnrecognizedActorsInList=true 且本地演员库非空 →
 *      标题无可识别演员的卡片被隐藏（ACTOR_UNRECOGNIZED），含可识别演员的卡片不受影响；
 *   f) F-L3 保护阀：同开关但本地演员库为空 → 不隐藏任何卡片（避免新装整列被藏）。
 *
 * 基建与 listHiding-switches.spec.ts 一致：mock 列表页经 page.route 喂给内容脚本，
 * 设置切换 = service worker 改 chrome.storage + chrome.tabs.sendMessage('settings-updated')，
 * 与 dashboard 真实改设置走同一条广播链路；演员数据经 extension page 发
 * DB:ACTORS_BULK_PUT 写入真实 IndexedDB。
 *
 * @module tests/extension-e2e
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  seedExtensionStorage,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_ID = 'gnegjfjccmeafanpmbjboegcbchcghka';
const MOCK_FILE = path.resolve(__dirname, 'fixtures/javdbListEnhancementMock.html');
const MOCK_URL = 'http://localhost:4599/web/mock-list-enhancement.html';
const SETTINGS_KEY = 'settings';

function buildSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    userExperience: {
      enableListEnhancement: true,
      enableContentFilter: false,
    },
    display: {
      hideViewed: true,
      hideBrowsed: false,
      hideWant: false,
      hideVR: false,
    },
    listEnhancement: {
      hideBlacklistedActorsInList: false,
      hideNonFavoritedActorsInList: false,
      hideUnrecognizedActorsInList: false,
    },
    contentFilter: {
      enabled: false,
      showFilteredCount: false,
      hideEnabled: true,
      keywordRules: [],
    },
  };
  return deepMerge(settings, overrides);
}

function deepMerge<T>(base: T, extra: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v)
      && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** 用 localStorage 域名把 mock 列表页喂给内容脚本（无需登录、无需外网）。 */
async function serveMockListPage(context: BrowserContext, page: Page): Promise<void> {
  const html = await fs.readFile(MOCK_FILE, 'utf8');
  await page.route(MOCK_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(MOCK_URL, { waitUntil: 'domcontentloaded' });
}

/** 等待扩展处理完两张卡片（x-btn 由 optimizeListItemTitle 同步插入）。 */
async function waitForListProcessed(page: Page): Promise<void> {
  await expect(page.locator('.movie-list .item .x-btn')).toHaveCount(2, { timeout: 30_000 });
}

/**
 * 通过 extension page 向 background 发 DB:ACTORS_BULK_PUT，写入真实演员记录。
 * SW 冷启动时指数退避重试（与 seedViewedRecords 同模式）。
 */
async function seedActors(
  context: BrowserContext,
  extensionId: string,
  records: Record<string, unknown>[],
): Promise<void> {
  const page = await context.newPage();
  await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html'), { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async (recs) => {
    const send = (msg: any): Promise<any> =>
      new Promise((resolve) => {
        let settled = false;
        const done = (v: any) => { if (!settled) { settled = true; resolve(v); } };
        chrome.runtime.sendMessage(msg, (resp) => {
          done(resp || (chrome.runtime.lastError ? { error: String(chrome.runtime.lastError.message) } : null));
        });
        setTimeout(() => done(null), 4000);
      });

    const maxAttempts = 8;
    let attempt = 0;
    let lastErr: any = null;
    while (attempt < maxAttempts) {
      const pong = await send({ type: 'DB:VIEWED_COUNT', payload: {} });
      if (pong && typeof pong === 'object' && !pong.error) {
        const put = await send({ type: 'DB:ACTORS_BULK_PUT', payload: { records: recs } });
        if (!put || put.success !== true) {
          return { ok: false, reason: (put as any)?.error || 'bulkPut-not-success' };
        }
        return { ok: true };
      }
      lastErr = pong?.error || 'no-response';
      const delay = [200, 400, 800, 1500, 2500, 3500, 4500][attempt] || 4500;
      attempt++;
      await new Promise((r) => setTimeout(r, delay));
    }
    return { ok: false, reason: lastErr };
  }, records);

  await page.close();
  if (result?.ok) return;
  throw new Error(`seed actors failed: ${result?.reason || 'unknown'}`);
}

/**
 * 模拟「在设置页点击开关」：在 service worker 里改 chrome.storage 的 settings 字段，
 * 再广播 settings-updated 到目标 tab 的 content script（与 dashboard 改设置同链路）。
 */
async function toggleSettingField(
  context: BrowserContext,
  page: Page,
  field: string,
  value: boolean,
): Promise<void> {
  const worker =
    context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));

  const tabId = await worker.evaluate(async (url: string) => {
    const tabs = await chrome.tabs.query({ url });
    return tabs[0]?.id ?? null;
  }, page.url());

  await worker.evaluate(async (d: { field: string; value: boolean; tabId: number | null }) => {
    const res = await chrome.storage.local.get('settings');
    const settings = { ...(res.settings || {}) };
    const parts = d.field.split('.');
    let node: any = settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = d.value;
    await chrome.storage.local.set({ settings });
    if (d.tabId != null) {
      try {
        await chrome.tabs.sendMessage(d.tabId, { type: 'settings-updated' });
      } catch { /* tab 未注入时忽略 */ }
    }
  }, { field, value, tabId });
}

function launchContext(profile: string) {
  const opts = resolveExtensionHarnessOptions({
    ...process.env,
    JAVDB_EXTENSION_USE_CHROME_DATA: '0',
    JAVDB_EXTENSION_PROFILE: profile,
  }, process.cwd());
  return launchExtensionContext(opts, {
    headless: process.env.JAVDB_EXTENSION_HEADLESS !== '0',
    channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
  });
}

test.describe('列表增强开关矩阵（真实浏览器 E2E）', () => {
  test('a) 主开关关闭：列表页不插入 x-btn / 预览 / 快捷操作', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('le-master-off-profile'));
    try {
      const extensionId = await readExtensionId(context);
      expect(extensionId).toBe(EXTENSION_ID);
      await suppressReleaseAnnouncementForTest(context);

      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          userExperience: { enableListEnhancement: false, enableContentFilter: false },
        }),
      });

      const page = await context.newPage();
      await serveMockListPage(context, page);

      // fixture 本身不含 x-btn；给内容脚本充足的初始化窗口后仍应无插入
      expect(await page.locator('.movie-list .item').count()).toBe(2);
      await page.waitForTimeout(3500);
      await expect(page.locator('.movie-list .item .x-btn')).toHaveCount(0);
      await expect(page.locator('.movie-list .item .cover.x-preview')).toHaveCount(0);
      await expect(page.locator('.movie-list .item .jdb-list-status-actions')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('b) 默认开启：扩展在每张卡片插入 x-btn（data-code 正确）', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('le-default-on-profile'));
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      await seedExtensionStorage(context, { [SETTINGS_KEY]: buildSettings() });

      const page = await context.newPage();
      await serveMockListPage(context, page);
      await waitForListProcessed(page);

      const codes = await page.locator('.movie-list .item .x-btn').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-code')),
      );
      expect(codes).toEqual(['TEST-001', 'AAA-111']);
    } finally {
      await context.close();
    }
  });

  test('c) F-L1 回归：enableVideoPreviewList=false 时 hover 不出预览，开关切 true + 重载后出预览', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('le-preview-list-switch-profile'));
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          listEnhancement: {
            enableVideoPreview: true,
            enableVideoPreviewList: false,
            previewDelay: 100,
          },
        }),
      });

      const page = await context.newPage();
      await serveMockListPage(context, page);
      await waitForListProcessed(page);

      const cover1 = page.locator('.movie-list .item').nth(0).locator('.cover');

      // 子开关关闭：封面不挂 x-preview（enhanceItem 的 preview attach 被 gate 掉）
      await expect(cover1).not.toHaveClass(/x-preview/);

      // hover 也不出视频（委托监听找不到已 attach 的封面）
      await cover1.hover();
      await page.waitForTimeout(1500);
      await expect(cover1.locator('video')).toHaveCount(0);

      // 切开关 = 设置页真实链路；预览 attach 受 data-list-enhanced 守卫，
      // 运行时切换不会重新 attach，正向断言必须在 reload 之后。
      await toggleSettingField(context, page, 'listEnhancement.enableVideoPreviewList', true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForListProcessed(page);

      const cover1b = page.locator('.movie-list .item').nth(0).locator('.cover');
      await expect(cover1b).toHaveClass(/x-preview/, { timeout: 15_000 });

      // reload 后鼠标仍停在 phase1 的封面中心：先移走到中性位置，
      // 否则后续 hover 为零位移，Chromium 不会重新派发 mouseover（show() 永不触发）。
      await page.mouse.move(600, 500);

      await page.mouse.move(600, 500);
      await cover1b.hover();
      await page.waitForFunction(() => {
        const cover = document.querySelectorAll('.movie-list .item .cover')[0];
        return !!cover?.querySelector('video');
      }, undefined, { timeout: 8000 });

      // TEST-001 命中内置示例地址（BigBuckBunny），无需真实站点解析
      const src = await page.locator('.movie-list .item').nth(0)
        .locator('.cover video source').first().getAttribute('src');
      expect(src ?? '').toContain('BigBuckBunny');
    } finally {
      await context.close();
    }
  });

  test('d) enableStatusQuickAction：状态快捷按钮同页即时增删', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('le-status-quick-profile'));
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          listEnhancement: { enableStatusQuickAction: false },
        }),
      });

      const page = await context.newPage();
      await serveMockListPage(context, page);
      await waitForListProcessed(page);

      // 关闭态：卡片无快捷操作组（itemProcessor 直读 STATE.settings）
      await page.waitForTimeout(1000);
      await expect(page.locator('.movie-list .item .jdb-list-status-actions')).toHaveCount(0);

      // 开：force rescan 后每张卡片 3 个状态按钮
      await toggleSettingField(context, page, 'listEnhancement.enableStatusQuickAction', true);
      await expect(page.locator('.movie-list .item .jdb-list-status-actions')).toHaveCount(2, { timeout: 15_000 });
      await expect(page.locator('.movie-list .item').nth(0)
        .locator('.jdb-list-status-action')).toHaveCount(3);

      // 关：再次 force rescan 后全部移除
      await toggleSettingField(context, page, 'listEnhancement.enableStatusQuickAction', false);
      await expect(page.locator('.movie-list .item .jdb-list-status-actions')).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await context.close();
    }
  });

  test('e) F-L3：隐藏未识别演员独立生效（演员库非空时）', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('le-actor-unrecognized-profile'));
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          listEnhancement: {
            hideBlacklistedActorsInList: false,
            hideNonFavoritedActorsInList: false,
            hideUnrecognizedActorsInList: true,
          },
        }),
      });

      // 注入一条本地演员（标题含 "Test Actress" 的卡片可识别；另一张不可识别）
      const now = Date.now();
      await seedActors(context, extensionId, [{
        id: 'actor-e2e-test-actress',
        name: 'Test Actress',
        aliases: [],
        gender: 'female',
        category: 'unknown',
        profileUrl: '',
        createdAt: now,
        updatedAt: now,
      }]);

      const page = await context.newPage();
      await serveMockListPage(context, page);
      await waitForListProcessed(page);

      const noActorItem = page.locator('.movie-list .item').nth(0);
      const withActorItem = page.locator('.movie-list .item').nth(1);

      // 未识别卡片：来源标记 + 重算后真正隐藏
      await expect(noActorItem).toHaveAttribute('data-hidden-by-actor', 'true', { timeout: 30_000 });
      await expect(noActorItem).toHaveAttribute('data-hide-reason-actor', 'ACTOR_UNRECOGNIZED');
      await expect(noActorItem).toHaveAttribute('data-hide-src-actor', 'true');
      await expect(noActorItem).toBeHidden();

      // 含可识别演员的卡片不受影响
      await expect(withActorItem).not.toHaveAttribute('data-hidden-by-actor');
      await expect(withActorItem).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('f) F-L3 保护阀：演员库为空时不隐藏任何卡片', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('le-actor-unrecognized-empty-profile'));
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          listEnhancement: {
            hideBlacklistedActorsInList: false,
            hideNonFavoritedActorsInList: false,
            hideUnrecognizedActorsInList: true,
          },
        }),
      });
      // 注意：本用例不注入任何演员 —— 空演员库时开关不得隐藏（新装保护）

      const page = await context.newPage();
      await serveMockListPage(context, page);
      await waitForListProcessed(page);

      const noActorItem = page.locator('.movie-list .item').nth(0);
      const withActorItem = page.locator('.movie-list .item').nth(1);

      // 给演员隐藏工作流充足的执行窗口（DB 查询 + 工作队列），随后断言无隐藏
      await expect(noActorItem).not.toHaveAttribute('data-hidden-by-actor', { timeout: 6000 });
      await expect(withActorItem).not.toHaveAttribute('data-hidden-by-actor');
      await expect(noActorItem).toBeVisible();
      await expect(withActorItem).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
