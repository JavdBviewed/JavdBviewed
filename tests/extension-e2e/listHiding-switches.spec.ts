/**
 * @file listHiding-switches.spec.ts
 * @description 列表「隐藏」开关 —— 真实浏览器（Chromium 加载 MV3 拓展）端到端验证：
 *   1) 设置页内容过滤区：09-30 起「隐藏」子开关概念整体下线（全局开关 / 单规则开关 /
 *      规则弹窗勾选框三处一并移除），按文案断言内容过滤区内不再出现任何文案为「隐藏」的
 *      开关；仅保留每规则「启用」(filterRuleEnabled-<i>)、弹窗「启用」与主开关；
 *      遗留持久化旧键由读侧忽略、写侧停写（键名级断言见本线 untracked 真机探针）；
 *   2) 在真实 JavDB 列表页（经 localStorage 域名服务 + 内容脚本注入）验证：
 *      - action=hide 且规则「启用」为开 → 命中卡片被隐藏；关掉「启用」→ 即时恢复；
 *        重新打开「启用」需重载页面才重新隐藏（applyFilters 只重判未处理卡片，既有语义）；
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
// 规则弹窗作用域：legacy partial 与 React 弹窗复用同名 id，限定到 React 弹窗容器避免 strict-mode 冲突
const MODAL = '[data-enhancement-filter-rule-modal]';

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
  test('设置页：「隐藏」子开关不再渲染，仅保留规则「启用」且可切换持久化', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('settings-hide-profile'));
    try {
      const extensionId = await readExtensionId(context);
      expect(extensionId).toBe(EXTENSION_ID);
      await suppressReleaseAnnouncementForTest(context);

      // 预置：启用内容过滤 + 一条 action=hide 规则（09-30 起子开关概念已整体移除，
      // 存量旧键由读侧忽略、写侧停写，见本线 _tmp 真机探针的存储键断言）。
      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          userExperience: { enableContentFilter: true },
          contentFilter: { enabled: true, keywordRules: [makeHideRule()] },
        }),
      });

      const page = await context.newPage();
      const url = extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/enhancement-settings/list');
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // 设置页 form 有异步加载（loading 阶段子面板未渲染），用轮询等待内容过滤面板稳定就绪。
      const waitForPanel = async () => {
        const deadline = Date.now() + 20_000;
        for (;;) {
          const s = await page.evaluate(() => ({
            cfg: !!document.getElementById('contentFilterConfig'),
            en: !!document.getElementById('filterRuleEnabled-0'),
          }));
          if (s.cfg && s.en) return s;
          if (Date.now() > deadline) throw new Error('content filter panel not ready: ' + JSON.stringify(s));
          await page.waitForTimeout(300);
        }
      };
      await waitForPanel();

      // 「内容过滤」卡是卡内分段 tab（SettingTabs idPrefix="cf-"，默认活动 pane=「番号过滤」）：
      // 全部 pane 都渲染进 DOM，非活动 pane 带 hidden。交互/可见性断言前必须先落到
      // 「内容过滤规则」pane（与真人同路径），否则 #addFilterRule 永远不可见。
      await page.hover('[data-enhancement-feature="内容过滤"]', { timeout: 15_000 });
      await page.waitForSelector('[data-enhancement-feature="内容过滤"][data-expanded="1"]', { timeout: 10_000 });
      await page.click('#cf-tab-rules', { timeout: 15_000 });
      await page.waitForSelector('#cf-tabpanel-rules:not([hidden])', { state: 'visible', timeout: 15_000 });
      await expect(page.locator('#addFilterRule')).toBeVisible({ timeout: 15_000 });

      // 按文案断言（开关子概念已下线，任何文案为「隐藏」的开关都不得再出现在内容过滤区）
      const ui = await page.evaluate(() => {
        const labelTexts = (sel: string) => Array.from(
          document.querySelectorAll(sel + ' label'),
        ).map((el) => (el.textContent || '').replace(/\s+/g, ''));
        const cfg = labelTexts('#contentFilterConfig');
        const rules = labelTexts('#filterRulesList');
        return {
          cfgHide: cfg.filter((t) => t.includes('隐藏')),
          ruleHide: rules.filter((t) => t.includes('隐藏')),
          ruleEnabled: rules.includes('启用'),
          enabledChecked: document.getElementById('filterRuleEnabled-0')?.checked ?? null,
          enabledInVisiblePane:
            (document.getElementById('filterRuleEnabled-0')?.closest('[hidden]') ?? null) === null,
          paneRulesActive:
            document.getElementById('cf-tabpanel-rules')?.hasAttribute('hidden') === false,
        };
      });
      expect(ui.cfgHide).toEqual([]);
      expect(ui.ruleHide).toEqual([]);
      expect(ui.ruleEnabled).toBe(true);
      expect(ui.enabledChecked).toBe(true);
      expect(ui.paneRulesActive).toBe(true);
      expect(ui.enabledInVisiblePane).toBe(true);

      // 规则弹窗（动作默认 hide）：同样不再有「隐藏」勾选框，只保留弹窗「启用」。
      await page.click('#addFilterRule');
      await expect(page.locator(MODAL + ' #modalInlineRuleName')).toBeVisible({ timeout: 10_000 });
      const modal = await page.evaluate(() => {
        const box = document.querySelector('[data-enhancement-filter-rule-modal]');
        const inModal = (id: string) => box?.querySelector('#' + id) ?? null;
        const texts = Array.from(box?.querySelectorAll('label') ?? [])
          .map((el) => (el.textContent || '').replace(/\s+/g, ''));
        return {
          action: (inModal('modalInlineRuleAction') as HTMLSelectElement | null)?.value ?? null,
          modalHide: texts.filter((t) => t.includes('隐藏')),
          hasEnabledToggle: inModal('modalInlineRuleEnabled') !== null,
        };
      });
      expect(modal.action).toBe('hide');
      expect(modal.modalHide).toEqual([]);
      expect(modal.hasEnabledToggle).toBe(true);
      await page.click(MODAL + ' #filterRuleModalClose');

      // 真实点击开关：Toggle 的 <input> 是 h-0 w-0 opacity-0（0 尺寸、视觉隐藏），
      // 真正可见、可点的是其后面的 track <span>（relative 盒子）。向 track 派发真实
      // pointer/mouse 事件序列 → 浏览器路由到 input → React 原生 click→change，
      // 与真人点击可见开关走完全相同的 DOM/React/自动保存/chrome.storage 路径。
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

      // 关掉规则「启用」（唯一保留的开关）→ UI 即时翻转
      await clickToggle('filterRuleEnabled-0');
      const flipped = await page.evaluate(
        () => document.getElementById('filterRuleEnabled-0')?.checked ?? null,
      );
      expect(flipped).toBe(false);

      // 等待防抖自动保存（AUTO_SAVE_MS=1000ms）：启用状态落盘，主开关字段不受影响。
      await page.waitForTimeout(1_800);
      const persisted = await page.evaluate(async () => {
        const res = await chrome.storage.local.get('settings');
        return res.settings as any;
      });
      expect(persisted?.contentFilter?.enabled).toBe(true);
      expect(persisted?.contentFilter?.keywordRules?.[0]?.enabled).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('列表页：hide 规则命中即隐藏，随规则「启用」开关即时显隐', async ({}, testInfo) => {
    const context = await launchContext(testInfo.outputPath('list-keyword-hide-profile'));
    try {
      await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      await seedExtensionStorage(context, {
        [SETTINGS_KEY]: buildSettings({
          userExperience: { enableContentFilter: true },
          contentFilter: { enabled: true, keywordRules: [makeHideRule()] },
        }),
      });

      const page = await context.newPage();
      await serveMockListPage(context, page);

      // 第 1 张 = AAA-111（不匹配规则），第 2 张 = BBB-222（标题含「敏感词XYZ」）
      const aaaItem = page.locator('.movie-list .item').nth(0);
      const bbbItem = page.locator('.movie-list .item').nth(1);

      // 内容脚本初始化后（idle 阶段 ~2.5s）：action=hide 且规则启用 → 无子开关也直接隐藏
      await expect(bbbItem).toHaveClass(/content-filter-hidden/, { timeout: 30_000 });
      await expect(bbbItem).toHaveAttribute('data-filter-applied', 'hide');
      await expect(bbbItem).toBeHidden();
      await expect(aaaItem).not.toHaveClass(/content-filter-hidden/);

      // 关掉规则「启用」（storage 直改 + settings-updated 广播，等价于设置页点击开关）→ 即时恢复
      await toggleSettingField(context, page, 'contentFilter.keywordRules.0.enabled', false);
      await expect(bbbItem).not.toHaveClass(/content-filter-hidden/, { timeout: 15_000 });
      await expect(bbbItem).toBeVisible({ timeout: 15_000 });
      await expect(aaaItem).toBeVisible();

      // 再打开「启用」→ 重新载入后再次隐藏。
      // 注意：applyFilters 只重判未带 data-filter-processed 的卡片，上一步「关掉启用」时该卡片
      // 已被重新处理并再次标记，因此不重载页面时不会重新隐藏 —— 这是本线之前就存在的既有语义
      // （仅「隐藏」总开关曾走 rescan 例外，该开关已随子开关概念一并下线），本线未改动。
      await toggleSettingField(context, page, 'contentFilter.keywordRules.0.enabled', true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(bbbItem).toHaveClass(/content-filter-hidden/, { timeout: 30_000 });
      await expect(bbbItem).toBeHidden();
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
          contentFilter: { enabled: false, keywordRules: [] },
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
