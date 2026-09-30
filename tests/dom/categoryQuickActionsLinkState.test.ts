/**
 * @file categoryQuickActionsLinkState.test.ts
 * @description 影片页类别链接文字级状态标记回归锁（09-30-category-link-state）。
 *   锁死四件事：
 *     1. 屏蔽（列表页）态 = 链接本体红 #d32f2f + line-through + title；
 *     2. 不入库态 = 🚫 必须是链接**外**的兄弟节点（放链接内会污染 textContent → 面板头部 name 被带上图标）；
 *     3. 幂等 + 双态共存（重复重绘不重复插图标；两态并存互不干扰）；
 *     4. 解除与 destroy 全清（内联样式/title 还原站点原值、图标摘除、onChanged 监听摘掉）。
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ICON_CLASS = 'x-category-quick-state-icon';
const ICON_DATA_ATTR = 'data-x-category-quick-state-icon';
const KEY_A = 'c4=17';
const KEY_B = 'c1=23';

/** 两集合的可变桩数据（readState 经 getValue 读取）。 */
const store = vi.hoisted(() => ({
  listBlack: [] as string[],
  newWorksBlack: [] as string[],
}));

vi.mock('../../apps/extension/src/features/newWorks', () => ({
  newWorksManager: {
    getGlobalConfig: vi.fn(async () => ({ filters: {} })),
    updateGlobalConfig: vi.fn(async () => undefined),
  },
}));
vi.mock('../../apps/extension/src/platform/browser/toast', () => ({
  showToast: vi.fn(),
}));
vi.mock('../../apps/extension/src/utils/storage', () => ({
  getSettings: vi.fn(async () => ({ listEnhancement: { categoryFilter: { black: store.listBlack } } })),
  getValue: vi.fn(async (key: string, fallback: any) => {
    if (key === 'settings') return { listEnhancement: { categoryFilter: { black: store.listBlack } } };
    if (key === 'new_works_config') return { filters: { categoryBlackFilters: store.newWorksBlack } };
    return fallback;
  }),
  saveSettings: vi.fn(async () => undefined),
}));

import { categoryQuickActionsManager } from '../../apps/extension/src/features/categoryQuickActions';

/** chrome.storage.onChanged 监听登记表（本测试自行安装 chrome 桩）。 */
const chromeStub = vi.hoisted(() => ({ listeners: [] as any[], removed: [] as any[] }));

function installChromeStub(): void {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      runtime: { id: 'test-runtime', getURL: (p: string) => `chrome-extension://test/${p}` },
      storage: {
        onChanged: {
          addListener: (fn: any) => chromeStub.listeners.push(fn),
          removeListener: (fn: any) => {
            chromeStub.removed.push(fn);
            const i = chromeStub.listeners.indexOf(fn);
            if (i >= 0) chromeStub.listeners.splice(i, 1);
          },
        },
      },
    },
    configurable: true,
    writable: true,
  });
}

/** 站点真实形态的類別面板（strong 标题 + a[href 含 /tags?cN=ID]）。 */
function buildCategoryPanel(): void {
  document.body.innerHTML = `
    <div class="panel-block">
      <strong class="panel-heading-icon">類別:</strong>
      <span class="panel-block-stat">
        <a href="/tags?c4=17">素人女</a>
        <a href="/tags?c1=23">中文字幕</a>
        <a href="/tags?c4=999999">字典外条目</a>
      </span>
    </div>`;
}

function linkOf(key: string): HTMLAnchorElement {
  const el = document.querySelector<HTMLAnchorElement>(`a[data-x-category-entry-key="${key}"]`);
  if (!el) throw new Error(`未找到已绑定链接：${key}`);
  return el;
}

function iconsOf(key: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`.${ICON_CLASS}[${ICON_DATA_ATTR}="${key}"]`));
}

/** jsdom / 真 Chrome 都会把 #d32f2f 归一为 rgb(211, 47, 47)，两种写法都算通过。 */
function expectBlockedColor(el: HTMLElement): void {
  expect(['#d32f2f', 'rgb(211, 47, 47)']).toContain(el.style.color);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 触发一次 storage.onChanged（两键之一）。 */
async function fireStorageChanged(areaKey: string): Promise<void> {
  [...chromeStub.listeners].forEach((fn) => fn({ [areaKey]: { newValue: {} } }, 'local'));
  await flush();
}

beforeEach(() => {
  installChromeStub();
  chromeStub.listeners.length = 0;
  chromeStub.removed.length = 0;
  store.listBlack = [];
  store.newWorksBlack = [];
  buildCategoryPanel();
});

afterEach(() => {
  categoryQuickActionsManager.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('类别链接状态标记（屏蔽态=红+删除线+title）', () => {
  it('初始化后：命中列表页隐藏集的链接被标红加删除线并带 title，未命中的不受影响', async () => {
    store.listBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    const a = linkOf(KEY_A);
    expectBlockedColor(a);
    expect(a.style.textDecoration).toContain('line-through');
    expect(a.getAttribute('title')).toBe('已屏蔽：列表页隐藏该类别');
    const b = linkOf(KEY_B);
    expect(b.style.color).toBe('');
    expect(b.getAttribute('title')).toBeNull();
  });

  it('字典外链接不绑定也不标记（面板与标记都不出现）', async () => {
    store.listBlack = ['c4=999999'];
    await categoryQuickActionsManager.ensureInit();
    expect(document.querySelector('a[href="/tags?c4=999999"]')?.getAttribute('data-x-category-quick-bound')).toBeNull();
  });

  it('取消屏蔽：颜色/线型/title 三项还原（原 title 不存在则移除属性）', async () => {
    store.listBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    expectBlockedColor(linkOf(KEY_A));
    store.listBlack = [];
    await fireStorageChanged('settings');
    const a = linkOf(KEY_A);
    expect(a.style.color).toBe('');
    expect(a.style.textDecoration).not.toContain('line-through');
    expect(a.hasAttribute('title')).toBe(false);
  });

  it('站点原有 title 在解除后按原值恢复（不被我们的 title 永久覆盖）', async () => {
    linkOfBeforeInit('自定义原提示');
    store.listBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    expect(linkOf(KEY_A).getAttribute('title')).toBe('已屏蔽：列表页隐藏该类别');
    store.listBlack = [];
    await fireStorageChanged('settings');
    expect(linkOf(KEY_A).getAttribute('title')).toBe('自定义原提示');
  });
});

describe('类别链接状态标记（不入库态=链接外 🚫）', () => {
  it('🚫 是链接的兄弟节点、在链接之前，且不在链接内部', async () => {
    store.newWorksBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    const a = linkOf(KEY_A);
    const icon = a.previousElementSibling as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains(ICON_CLASS)).toBe(true);
    expect(icon?.getAttribute(ICON_DATA_ATTR)).toBe(KEY_A);
    expect(icon?.textContent).toBe('🚫');
    // ★ 关键：不得污染链接 textContent（面板头部 name 取 candidate.label，但锚点文本必须干净）
    expect(a.textContent).toBe('素人女');
    expect(a.querySelector(`.${ICON_CLASS}`)).toBeNull();
  });

  it('图标样式口径=0.9em / margin-right 4px / vertical-align text-top / aria-hidden', async () => {
    store.newWorksBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    const icon = iconsOf(KEY_A)[0];
    expect(icon.style.fontSize).toBe('0.9em');
    expect(icon.style.marginRight).toBe('4px');
    expect(icon.style.verticalAlign).toBe('text-top');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('重绘幂等：多次 storage 变化不重复插图标', async () => {
    store.newWorksBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    await fireStorageChanged('new_works_config');
    await fireStorageChanged('new_works_config');
    expect(iconsOf(KEY_A)).toHaveLength(1);
  });

  it('恢复入库：图标消失，标记全清', async () => {
    store.newWorksBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    expect(iconsOf(KEY_A)).toHaveLength(1);
    store.newWorksBlack = [];
    await fireStorageChanged('new_works_config');
    expect(iconsOf(KEY_A)).toHaveLength(0);
    expect(linkOf(KEY_A).getAttribute('title')).toBeNull();
  });
});

describe('类别链接状态标记（双态共存 + 面板 name 不含图标）', () => {
  it('同一类别两态并存：红删除线 + 🚫 + 两段 title 用中文分号拼接', async () => {
    store.listBlack = [KEY_A];
    store.newWorksBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    const a = linkOf(KEY_A);
    expectBlockedColor(a);
    expect(a.style.textDecoration).toContain('line-through');
    expect(iconsOf(KEY_A)).toHaveLength(1);
    expect(a.getAttribute('title')).toBe('已屏蔽：列表页隐藏该类别；新作品不入库：该类别影片将不再入库');
  });

  it('hover 出面板时头部 name 不含 🚫（图标在链接外，不污染文本）', async () => {
    store.newWorksBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    const a = linkOf(KEY_A);
    // 先确认图标真的在位（否则本条负断言会因「没有标记」而假过）
    expect(iconsOf(KEY_A)).toHaveLength(1);
    a.dispatchEvent(new Event('mouseenter'));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 320));
    await flush();
    const name = document.querySelector<HTMLElement>('.x-category-quick-name');
    expect(name).not.toBeNull();
    expect(name?.textContent).toBe('素人女');
    expect(name?.textContent).not.toContain('🚫');
  });
});

describe('类别链接状态标记（生灭同步：storage.onChanged 与 destroy）', () => {
  it('storage 变化即时重画（新增屏蔽→出现标记，取消→还原）', async () => {
    await categoryQuickActionsManager.ensureInit();
    expect(chromeStub.listeners.length).toBe(1);
    store.listBlack = [KEY_B];
    await fireStorageChanged('settings');
    expectBlockedColor(linkOf(KEY_B));
    store.listBlack = [];
    await fireStorageChanged('settings');
    expect(linkOf(KEY_B).style.color).toBe('');
  });

  it('无关 storage 键不触发重画', async () => {
    await categoryQuickActionsManager.ensureInit();
    const fn = chromeStub.listeners[0];
    const before = linkOf(KEY_A).style.color;
    fn?.({ some_other_key: { newValue: {} } }, 'local');
    await flush();
    expect(linkOf(KEY_A).style.color).toBe(before);
  });

  it('destroy 全清：标记消失、原值还原、监听摘除（可回收性）', async () => {
    store.listBlack = [KEY_A];
    store.newWorksBlack = [KEY_B];
    await categoryQuickActionsManager.ensureInit();
    expectBlockedColor(linkOf(KEY_A));
    expect(iconsOf(KEY_B)).toHaveLength(1);

    categoryQuickActionsManager.destroy();
    expect(linkOf(KEY_A).style.color).toBe('');
    expect(linkOf(KEY_A).hasAttribute('title')).toBe(false);
    expect(iconsOf(KEY_A)).toHaveLength(0);
    expect(iconsOf(KEY_B)).toHaveLength(0);
    expect(chromeStub.listeners).toHaveLength(0);
    expect(chromeStub.removed.length).toBeGreaterThanOrEqual(1);
  });

  it('子开关关闭后重新初始化：标记从空集开始，不残留历史标记（生灭同步）', async () => {
    store.listBlack = [KEY_A];
    await categoryQuickActionsManager.ensureInit();
    expectBlockedColor(linkOf(KEY_A));
    // 模拟子开关关→destroy→（bootstrap 不再 init）：标记必须已全清
    categoryQuickActionsManager.destroy();
    expect(document.querySelectorAll(`.${ICON_CLASS}`).length).toBe(0);
    expect(linkOf(KEY_A).style.color).toBe('');
  });
});

/** 绑定前给站点链接加原 title（模拟站内自带提示文案）。 */
function linkOfBeforeInit(title: string): void {
  const el = document.querySelector<HTMLAnchorElement>('a[href="/tags?c4=17"]');
  if (el) el.setAttribute('title', title);
}
