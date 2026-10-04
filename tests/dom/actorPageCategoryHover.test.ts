/**
 * @file actorPageCategoryHover.test.ts
 * @description 演员页类别链接 hover 行为回归锁（10-15-issue-53-actor-cat-hover）。
 *
 * issue #53：演员页登录态 hover 类别标签链接，应弹「类别」悬浮卡，实际弹「演员快捷操作」卡。
 * 双缺陷修复锁：
 *   D1 误伤——演员页标签云（同 pathname + ?t= 查询变体）不得被演员快捷操作绑定；
 *   D2 缺绑——演员页 ensureInit 必须绑定字典内 t= 纯数字标签链接（字母码/字典外跳过，不置灰）。
 * 另含影片页零回归守卫（255/256 线行为不动）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  listBlack: [] as string[],
  newWorksBlack: [] as string[],
}));

vi.mock('../../apps/extension/src/features/actors', () => ({
  actorManager: {
    getActorById: vi.fn(async () => null),
    saveActor: vi.fn(async () => undefined),
    deleteActor: vi.fn(async () => undefined),
    setBlacklisted: vi.fn(async () => undefined),
  },
}));
vi.mock('../../apps/extension/src/features/newWorks', () => ({
  newWorksManager: {
    getGlobalConfig: vi.fn(async () => ({ filters: {} })),
    updateGlobalConfig: vi.fn(async () => undefined),
    getSubscriptions: vi.fn(async () => []),
    addSubscription: vi.fn(async () => undefined),
    removeSubscription: vi.fn(async () => undefined),
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

/** chrome.storage.onChanged 监听登记表（dom setup 的全局 chrome 桩无 onChanged，本文件自装）。 */
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

import { categoryQuickActionsManager } from '../../apps/extension/src/features/categoryQuickActions';
import {
  actorQuickActionsManager,
  bindActorQuickActionsToLink,
} from '../../apps/extension/src/features/actorEnhancement/actorQuickActionsManager';

beforeEach(() => {
  installChromeStub();
  chromeStub.listeners.length = 0;
  chromeStub.removed.length = 0;
  store.listBlack = [];
  store.newWorksBlack = [];
  document.body.innerHTML = '';
});

afterEach(() => {
  categoryQuickActionsManager.destroy();
  actorQuickActionsManager.destroy();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
  vi.restoreAllMocks();
});

describe('D1 误伤守卫：演员页标签链接不得出「演员快捷操作」卡', () => {
  it('演员页：同 pathname ?t= 标签链接不绑定；自己裸名链接与他演员链接照旧绑定', () => {
    window.history.pushState({}, '', '/actors/MmnyQ');
    document.body.innerHTML = `
      <a href="/actors/MmnyQ?t=48&amp;sort_type=0" class="tag is-medium">蕩婦</a>
      <a href="/actors/MmnyQ">有栖花绯</a>
      <a href="/actors/OtherId">其他演员</a>`;
    const [tagLink, selfLink, otherLink] = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));

    bindActorQuickActionsToLink(tagLink);
    bindActorQuickActionsToLink(selfLink);
    bindActorQuickActionsToLink(otherLink);

    expect(tagLink.getAttribute('data-x-actor-quick-bound')).toBeNull();
    expect(tagLink.classList.contains('x-actor-hoverable')).toBe(false);
    expect(selfLink.getAttribute('data-x-actor-quick-bound')).toBe('true');
    expect(otherLink.getAttribute('data-x-actor-quick-bound')).toBe('true');
  });

  it('非演员页（影片页）：演员链接绑定行为零变化（守卫仅演员页生效）', () => {
    window.history.pushState({}, '', '/v/NQ6pPb');
    const link = document.createElement('a');
    link.href = 'https://javdb.com/actors/abc123';
    link.textContent = '有栖花绯';
    document.body.appendChild(link);

    bindActorQuickActionsToLink(link);

    expect(link.getAttribute('data-x-actor-quick-bound')).toBe('true');
  });
});

describe('D2 缺绑修复：演员页类别卡绑定', () => {
  it('演员页 ensureInit：字典内 t= 纯数字标签绑定并记 entryKey；字母码/字典外跳过（不置灰）', async () => {
    window.history.pushState({}, '', '/actors/MmnyQ');
    document.body.innerHTML = `
      <a href="/actors/MmnyQ?t=48&amp;sort_type=0" class="tag is-medium">蕩婦</a>
      <a href="/actors/MmnyQ?t=s&amp;sort_type=0" class="tag is-medium">S</a>
      <a href="/actors/MmnyQ?t=999999&amp;sort_type=0" class="tag is-medium">字典外</a>`;
    const [a48, alpha, outOfDict] = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));

    categoryQuickActionsManager.updateConfig({ enabled: true, showDelay: 300, hideDelay: 200 });
    await categoryQuickActionsManager.ensureInit();

    expect(a48.getAttribute('data-x-category-quick-bound')).toBe('true');
    expect(a48.getAttribute('data-x-category-entry-key')).toBe('c2=48');
    expect(alpha.getAttribute('data-x-category-quick-bound')).toBeNull();
    expect(outOfDict.getAttribute('data-x-category-quick-bound')).toBeNull();
  });

  it('演员页 ensureInit：他演员 pathname 的 ?t= 链接不绑定（仅同 pathname 标签云）', async () => {
    window.history.pushState({}, '', '/actors/MmnyQ');
    document.body.innerHTML = `
      <a href="/actors/OtherId?t=48&amp;sort_type=0">他演员标签</a>`;
    const other = document.querySelector<HTMLAnchorElement>('a');

    categoryQuickActionsManager.updateConfig({ enabled: true, showDelay: 300, hideDelay: 200 });
    await categoryQuickActionsManager.ensureInit();

    expect(other?.getAttribute('data-x-category-quick-bound')).toBeNull();
  });
});

describe('影片页零回归守卫（255/256 线行为不动）', () => {
  it('影片页 ensureInit：.panel-block 类别面板照旧绑定，字典外跳过', async () => {
    window.history.pushState({}, '', '/v/NQ6pPb');
    document.body.innerHTML = `
      <div class="panel-block">
        <strong class="panel-heading-icon">類別:</strong>
        <span class="panel-block-stat">
          <a href="/tags?c4=17">素人女</a>
          <a href="/tags?c4=999999">字典外条目</a>
        </span>
      </div>`;
    const [inDict, outOfDict] = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));

    categoryQuickActionsManager.updateConfig({ enabled: true, showDelay: 300, hideDelay: 200 });
    await categoryQuickActionsManager.ensureInit();

    expect(inDict.getAttribute('data-x-category-quick-bound')).toBe('true');
    expect(inDict.getAttribute('data-x-category-entry-key')).toBe('c4=17');
    expect(outOfDict.getAttribute('data-x-category-quick-bound')).toBeNull();
  });
});
