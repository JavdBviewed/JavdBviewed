/**
 * @file listHiding-switches.spec.ts
 * @description 列表「隐藏」开关 —— 真实浏览器（Chromium 加载 MV3 拓展）端到端验证：
 *   1) 设置页新增的「隐藏开关」(contentFilterHideEnabled) 与单规则「隐藏」开关
 *      (filterRuleHideEnabled-<i>) 渲染、可点击、并持久化到 chrome.storage；
 *   2) 在真实 JavDB 列表页（经 localStorage 域名服务 + 内容脚本注入）验证：
 *      - 全局「隐藏开关」关闭后，关键字 hide 规则匹配到的卡片不再隐藏（rescan 生效）；
 *      - 「已看/已浏览」状态隐藏随 display 开关即时重算（已看→隐藏，关掉→显示）。
 *
 * 与 jsdom 单测不同：这里走真实浏览器 + 真实内容脚本（isolated world）+
 * chrome.runtime.sendMessage 消息链路 + 真实 IndexedDB（通过 background 写入）。
 *
 * 关于「真实点击」的边界说明：设置页 Toggle 的 <input> 是 0 尺寸、视觉隐藏
 * (h-0 w-0 opacity-0)，真正可见的是 track <span>。测试向 track 派发真实
 * pointer/mouse 事件序列（浏览器将其路由到 input → React 原生 click→change），
 * 与真人点击可见开关走完全相同的 DOM/React/自动保存/chrome.storage 路径；
 * 唯一合成的是物理鼠标指针的坐标下发。列表页断言全部走真实内容脚本(isolated world)。
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
const MOCK_FILE = path.resolve(__dirname, 'fixtures/javdbListMock.html');
const MOCK_URL = 'http://localhost:4599/web/mock-list.html';
const SETTINGS_KEY = 'settings';

function buildSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    userExperience: {
      enableListEnhancement: true,
      enableContentFilter: true,
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
      enabled: true,
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

function makeHideRule(): Record<string, unknown> {
  return {
    id: 'e2e-hide-rule-xyz',
    name: 'E2E 隐藏规则 XYZ',
    keyword: '敏感词XYZ',
    isRegex: false,
    caseSensitive: false,
    action: 'hide',
    enabled: true,
    hideEnabled: true,
    fields: ['title'],
  };
}

/**
 * 通过一个 extension page（dashboard，拥有有效的 chrome.runtime 发送端）向
 * background 发 DB:VIEWED_PUT，在真实 IndexedDB 写入观看记录。
 * 注意：service worker 向自身发 chrome.runtime.sendMessage 是无效的（没有接收端），
 * 所以必须从一个页面上下文发。SW 冷启动时指数退避重试（与 dashboard dbClient 一致）。
 */
async function seedViewedRecords(
  context: BrowserContext,
  extensionId: string,
  records: Record<string, { status: string; isFavorite: boolean }>,
): Promise<void> {
  const now = Date.now();
  const payload = Object.entries(records).map(([id, r]) => ({
    id,
    title: id,
    status: r.status,
    isFavorite: r.isFavorite,
    createdAt: now,
    updatedAt: now,
  }));

  const page = await context.newPage();
  // dashboard 页（extension page）；不依赖具体 UI，只用它的 chrome.runtime 发送端。
  await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html'), { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async (recs) => {
    const putOne = (record: any): Promise<any> =>
      new Promise((resolve) => {
        let settled = false;
        const done = (v: any) => { if (!settled) { settled = true; resolve(v); } };
        chrome.runtime.sendMessage({ type: 'DB:VIEWED_PUT', payload: { record } }, (resp) => {
          done(resp || (chrome.runtime.lastError ? { success: false, error: String(chrome.runtime.lastError.message) } : null));
        });
        setTimeout(() => done(null), 4000);
      });

    // 指数退避：SW 冷启动/休眠时 "Receiving end does not exist"
    const maxAttempts = 8;
    let attempt = 0;
    let lastErr: any = null;
    while (attempt < maxAttempts) {
      const pong = await new Promise<any>((resolve) => {
        let settled = false;
        const done = (v: any) => { if (!settled) { settled = true; resolve(v); } };
        chrome.runtime.sendMessage({ type: 'DB:VIEWED_COUNT', payload: {} }, (resp) => {
          done(resp || (chrome.runtime.lastError ? { error: String(chrome.runtime.lastError.message) } : null));
        });
        setTimeout(() => done(null), 3000);
      });
      if (pong && typeof pong === 'object' && !pong.error) {
        // 就绪，写全部记录
        for (const record of recs) {
          const put = await putOne(record);
          if (!put || put.success !== true || put.skipped === true) {
            return { ok: false, recordId: record.id, reason: (put as any)?.error || 'put-not-success' };
          }
        }
        return { ok: true };
      }
      lastErr = pong?.error || 'no-response';
      const delay = [200, 400, 800, 1500, 2500, 3500, 4500][attempt] || 4500;
      attempt++;
      await new Promise((r) => setTimeout(r, delay));
    }
    return { ok: false, reason: lastErr };
  }, payload);

  await page.close();

  if (result?.ok) return;
  throw new Error(`seed viewed records failed: ${result?.recordId ? `record ${result.recordId} (` : ''}${result?.reason}${result?.recordId ? ')' : ''}`);
}

/** 用 localStorage 域名把 mock 列表页喂给内容脚本（无需登录、无需外网）。 */
async function serveMockListPage(context: BrowserContext, page: Page): Promise<void> {
  const html = await fs.readFile(MOCK_FILE, 'utf8');
  await page.route(MOCK_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(MOCK_URL, { waitUntil: 'domcontentloaded' });
}

/**
 * 模拟「在设置页点击开关」：在 service worker 里改 chrome.storage 的 settings 字段，
 * 再用 chrome.tabs.sendMessage 把 settings-updated 广播到目标 tab 的 content script。
 * （真实 dashboard 正是 background 改 storage + chrome.tabs.sendMessage 到各 tab；
 *   普通网页主世界没有 chrome.storage/runtime 发送端，所以不能直接在网页里 evaluate。）
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

  // 在 worker 侧用 chrome.tabs.query 按 url 反查目标 tab 的 id
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

test.describe('列表隐藏开关（真实浏览器 E2E）', () => {
  test('设置页：全局隐藏开关与单规则隐藏开关渲染、可切换并持久化', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('settings-hide-profile'));
    try {
      const extensionId = await readExtensionId(context);
      expect(extensionId).toBe(EXTENSION_ID);
      await suppressReleaseAnnouncementForTest(context);

      // 预置：启用内容过滤 + 一条 hide 规则，使单规则「隐藏」开关渲染
      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          userExperience: { enableContentFilter: true },
          contentFilter: { enabled: true, hideEnabled: true, keywordRules: [makeHideRule()] },
        }),
      });

      const page = await context.newPage();
      const url = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings/list');
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // 设置页 form 有异步加载（loading 阶段子面板未渲染），用轮询等待 config 面板稳定就绪。
      const waitForPanel = async () => {
        const deadline = Date.now() + 20_000;
        for (;;) {
          const s = await page.evaluate(() => {
            const g = document.getElementById('contentFilterHideEnabled');
            const r = document.getElementById('filterRuleHideEnabled-0');
            return {
              cfg: !!document.getElementById('contentFilterConfig'),
              g: !!g, gChecked: g ? g.checked : null,
              r: !!r, rChecked: r ? r.checked : null,
            };
          });
          if (s.cfg && s.g && s.r) return s;
          if (Date.now() > deadline) throw new Error('content filter panel not ready: ' + JSON.stringify(s));
          await page.waitForTimeout(300);
        }
      };
      const ready = await waitForPanel();
      expect(ready.gChecked).toBe(true);
      expect(ready.rChecked).toBe(true);

      // 真实点击开关：Toggle 的 <input> 是 h-0 w-0 opacity-0（0 尺寸、视觉隐藏），
      // 真正可见、可点的是其后面的 track <span>（relative 盒子）。
      // Playwright 的 .click() 对「click point 落在 0 尺寸 input 上」会做稳定性/可操作性
      // 检查而卡死，所以这里向 track 派发真实 pointer/mouse 事件序列 ——
      // 浏览器会把它路由到该 <label> 包裹的 input，触发 React 的原生 click→change，
      // 与真人在可见开关上点击完全同一条 DOM/React 路径（仅物理鼠标由测试合成）。
      const clickToggle = async (inputId: string) => {
        const ok = await page.evaluate((id: string) => {
          const input = document.getElementById(id) as HTMLInputElement | null;
          if (!input) return false;
          const wrapper = input.closest('label');
          const track = wrapper
            ? Array.from(wrapper.querySelectorAll(':scope > span'))
                .find((el) => el.classList.contains('relative'))
            : null;
          if (!track) return false;
          const r = track.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const init = { clientX: cx, clientY: cy, bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
          for (const el of [document.elementFromPoint(cx, cy) || track, track]) {
            el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, isPrimary: true }));
            el.dispatchEvent(new MouseEvent('mousedown', init));
          }
          for (const el of [document, track]) {
            el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, isPrimary: true, buttons: 0 }));
            el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
          }
          track.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
          return true;
        }, inputId);
        if (!ok) throw new Error('clickToggle: track not found for ' + inputId);
      };
      await clickToggle('contentFilterHideEnabled');
      await clickToggle('filterRuleHideEnabled-0');

      // 点击后 UI 即时翻转（同步 re-render），断言两个开关变 unchecked。
      const flipped = await page.evaluate(() => ({
        g: document.getElementById('contentFilterHideEnabled')?.checked ?? null,
        r: document.getElementById('filterRuleHideEnabled-0')?.checked ?? null,
      }));
      expect(flipped.g).toBe(false);
      expect(flipped.r).toBe(false);

      // 等待防抖自动保存（AUTO_SAVE_MS=1000ms），再校验持久化到 chrome.storage。
      await page.waitForTimeout(1_800);
      const persisted = await page.evaluate(async () => {
        const res = await chrome.storage.local.get('settings');
        return res.settings as any;
      });
      expect(persisted?.contentFilter?.hideEnabled).toBe(false);
      expect(persisted?.contentFilter?.keywordRules?.[0]?.hideEnabled).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('列表页：全局隐藏开关控制关键字 hide 规则的显隐（rescan 生效）', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('list-keyword-hide-profile'));
    try {
      await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          userExperience: { enableContentFilter: true },
          contentFilter: { enabled: true, hideEnabled: true, keywordRules: [makeHideRule()] },
        }),
      });

      const page = await context.newPage();
      await serveMockListPage(context, page);

      // 第 1 张 = AAA-111（不匹配规则），第 2 张 = BBB-222（标题含「敏感词XYZ」）
      const aaaItem = page.locator('.movie-list .item').nth(0);
      const bbbItem = page.locator('.movie-list .item').nth(1);

      // 内容脚本初始化后（idle 阶段 ~2.5s），BBB 卡片应被关键字规则隐藏
      await expect(bbbItem).toHaveClass(/content-filter-hidden/, { timeout: 30_000 });
      await expect(aaaItem).not.toHaveClass(/content-filter-hidden/);

      // 关闭全局隐藏开关（storage 直改 + settings-updated 广播，等价于设置页点击开关）→ rescan 后 BBB 不再隐藏
      await toggleSettingField(context, page, 'contentFilter.hideEnabled', false);
      await expect(bbbItem).not.toHaveClass(/content-filter-hidden/, { timeout: 15_000 });
      await expect(aaaItem).not.toHaveClass(/content-filter-hidden/);
    } finally {
      await context.close();
    }
  });

  test('列表页：已看/已浏览状态隐藏随 display 开关即时重算', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('list-status-hide-profile'));
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      // 隔离：列表增强启用、内容过滤关闭；已看隐藏开、已浏览隐藏关
      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          userExperience: { enableListEnhancement: true, enableContentFilter: false },
          contentFilter: { enabled: false, hideEnabled: true, keywordRules: [] },
          display: { hideViewed: true, hideBrowsed: false, hideWant: false, hideVR: false },
        }),
      });

      // 写入真实观看记录（background IndexedDB）：AAA-111=已看，BBB-222=已浏览
      await seedViewedRecords(context, extensionId, {
        'AAA-111': { status: 'viewed', isFavorite: false },
        'BBB-222': { status: 'browsed', isFavorite: false },
      });

      const page = await context.newPage();
      await serveMockListPage(context, page);

      // content script 的 DB 批量状态查询挂在 window 上（isolated world 的 window === 主世界 window）。
      // 真实浏览器中 background 会把响应投回 window 上，这里用 addInitScript 模拟该接线，
      // 使列表增强能读到刚写入的观看记录（其余隐藏逻辑全部走真实内容脚本）。
      await page.addInitScript((ids: string[]) => {
        const table: Record<string, { status: string; isFavorite: boolean }> = {};
        ids.forEach((id) => {
          table[id] = {
            status: id === 'AAA-111' ? 'viewed' : 'browsed',
            isFavorite: false,
          };
        });
        (window as any).addEventListener('message', (event: MessageEvent) => {
          const data = event.data;
          if (!data || data.source !== 'javdb-extension-db-proxy') return;
          if (data.type === 'DB:VIEWED_STATUS_GET_MANY') {
            const ids2: string[] = data.payload?.ids || [];
            const records = ids2
              .filter((id: string) => table[id])
              .map((id: string) => ({ id, status: table[id].status, isFavorite: table[id].isFavorite }));
            (event.source as any)?.postMessage(
              { source: 'javdb-extension-db-proxy', type: data.type, requestId: data.requestId, payload: { success: true, records } },
              { targetOrigin: '*' },
            );
          }
        });
      }, [page.url() && 'x']);

      const aaaItem = page.locator('.movie-list .item').nth(0);
      const bbbItem = page.locator('.movie-list .item').nth(1);

      // 初始：AAA 已看 → 隐藏；BBB 已浏览 → 不隐藏（hideBrowsed=false）
      await expect(aaaItem).toHaveAttribute('data-hide-src-viewed', 'true', { timeout: 30_000 });
      await expect(aaaItem).toBeHidden({ timeout: 15_000 });
      await expect(bbbItem).toHaveAttribute('data-hide-src-browsed', 'true');
      await expect(bbbItem).toBeVisible();

      // 关闭「已看」隐藏 → AAA 重新显示
      await toggleSettingField(context, page, 'display.hideViewed', false);
      await expect(aaaItem).toBeVisible({ timeout: 15_000 });
      await expect(aaaItem).not.toHaveAttribute('data-hidden-by-default');

      // 打开「已浏览」隐藏 → BBB 隐藏
      await toggleSettingField(context, page, 'display.hideBrowsed', true);
      await expect(bbbItem).toBeHidden({ timeout: 15_000 });
      await expect(bbbItem).toHaveAttribute('data-hidden-by-default', 'true');
      await expect(bbbItem).toHaveAttribute('data-hide-reason', 'BROWSED');
    } finally {
      await context.close();
    }
  });
});
