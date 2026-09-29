/**
 * @vitest-environment jsdom
 * @file SettingTabs.test.tsx
 * @description 卡内分段 tab 容器契约（09-29-cftabs）：
 *   默认第一 pane / 点击切换 / 非活动 pane hidden 但仍在 DOM /
 *   设置搜索 reveal 事件（detail.target）落对应 tab / 无 detail 旧事件无副作用 /
 *   挂载兜底（dataset.enhancement-reveal-target：legacy init 早于 effects 派发致
 *   live 事件丢失时的切 pane 路径，含属性消费与 pane 外目标无副作用）。
 * @module ui/patterns
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingTabs } from './SettingTabs';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PANES = [
  { id: 'numeric', label: '番号过滤', render: () => createElement('input', { id: 'ctl-numeric' }) },
  { id: 'category', label: '影片类别过滤', render: () => createElement('input', { id: 'ctl-category' }) },
  { id: 'rules', label: '内容过滤', render: () => createElement('input', { id: 'ctl-rules' }) },
];

describe('SettingTabs', () => {
  let container: HTMLElement;
  let root: Root;

  function mount(node: ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(node);
    });
  }

  function renderTabs(props: Partial<React.ComponentProps<typeof SettingTabs>> = {}) {
    mount(createElement(SettingTabs, { panes: PANES, ...props }));
  }

  function paneEl(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-setting-tab-pane="${id}"]`);
    if (!el) throw new Error(`pane ${id} not rendered`);
    return el;
  }

  function tabButton(id: string): HTMLButtonElement {
    const el = container.querySelector<HTMLButtonElement>(`#tab-${id}`);
    if (!el) throw new Error(`tab button ${id} not rendered`);
    return el;
  }

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('默认第一 pane 活动；全部 pane 渲染进 DOM，非活动 pane 仅 hidden', () => {
    renderTabs();
    expect(paneEl('numeric').hidden).toBe(false);
    expect(paneEl('category').hidden).toBe(true);
    expect(paneEl('rules').hidden).toBe(true);
    // 非活动 pane 的控件仍可 querySelector 到（设置搜索可达性）
    expect(container.querySelector('#ctl-category')).not.toBeNull();
    expect(tabButton('numeric').getAttribute('aria-selected')).toBe('true');
    expect(paneEl('numeric').id).toBe('tabpanel-numeric');
    expect(paneEl('numeric').getAttribute('aria-labelledby')).toBe('tab-numeric');
  });

  it('点击 tab 切换活动 pane（hidden 互斥翻转）', () => {
    renderTabs();
    act(() => {
      tabButton('rules').click();
    });
    expect(paneEl('rules').hidden).toBe(false);
    expect(paneEl('numeric').hidden).toBe(true);
    expect(paneEl('category').hidden).toBe(true);
    expect(tabButton('rules').getAttribute('aria-selected')).toBe('true');
  });

  it('idPrefix 命名空间化 DOM id（避免与同页顶层 tab 冲突）；aria 一致、点击切换不受影响', () => {
    renderTabs({ idPrefix: 'cf-' });
    const btn = container.querySelector<HTMLButtonElement>('#cf-tab-numeric');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-controls')).toBe('cf-tabpanel-numeric');
    expect(paneEl('numeric').id).toBe('cf-tabpanel-numeric');
    expect(paneEl('numeric').getAttribute('aria-labelledby')).toBe('cf-tab-numeric');
    // data-setting-tab-pane 恒为裸 pane id（稳定选择器钩子）
    expect(paneEl('numeric').getAttribute('data-setting-tab-pane')).toBe('numeric');
    act(() => {
      container.querySelector<HTMLButtonElement>('#cf-tab-rules')!.click();
    });
    expect(paneEl('rules').hidden).toBe(false);
    expect(paneEl('numeric').hidden).toBe(true);
  });

  it('defaultId 指定初始活动 pane', () => {
    renderTabs({ defaultId: 'category' });
    expect(paneEl('category').hidden).toBe(false);
    expect(paneEl('numeric').hidden).toBe(true);
  });

  it('reveal 事件 detail.target 落在某 pane → 切到该 pane（设置搜索落 tab）', () => {
    renderTabs();
    const target = container.querySelector('#ctl-category')!;
    act(() => {
      window.dispatchEvent(
        new CustomEvent('jdb:enhancement:reveal-card', { bubbles: true, detail: { target } }),
      );
    });
    expect(paneEl('category').hidden).toBe(false);
    expect(paneEl('numeric').hidden).toBe(true);
  });

  it('无 detail 的旧 reveal 事件不改变活动 pane（向后兼容）', () => {
    renderTabs();
    act(() => {
      window.dispatchEvent(new CustomEvent('jdb:enhancement:reveal-card', { bubbles: true }));
    });
    expect(paneEl('numeric').hidden).toBe(false);
    expect(paneEl('category').hidden).toBe(true);
  });

  it('target 不在任何 pane 内 → 活动 pane 不变', () => {
    renderTabs();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('jdb:enhancement:reveal-card', { bubbles: true, detail: { target: outside } }),
      );
    });
    expect(paneEl('numeric').hidden).toBe(false);
    outside.remove();
  });

  it('非活动 pane 不得携带作者层 display class（回归锁：flex 类压过 UA 层 [hidden] → pane 假可见）', () => {
    renderTabs();
    const inactive = paneEl('category');
    expect(inactive.hidden).toBe(true);
    expect(inactive.className).not.toMatch(/\b(flex|grid|block|inline)\b/);
    const active = paneEl('numeric');
    expect(active.hidden).toBe(false);
    expect(active.className).toContain('flex');
    act(() => {
      tabButton('category').click();
    });
    expect(paneEl('category').className).toContain('flex');
    expect(paneEl('numeric').className).not.toMatch(/\b(flex|grid|block|inline)\b/);
  });

  it('挂载兜底：最近 [data-enhancement-feature] 祖先的 dataset.enhancement-reveal-target 指向某 pane 内控件 → 挂载即切到该 pane', () => {
    const card = document.createElement('div');
    card.setAttribute('data-enhancement-feature', 'content-filter');
    card.dataset.enhancementRevealTarget = '#ctl-category';
    document.body.appendChild(card);
    container = card;
    root = createRoot(card);
    act(() => {
      root.render(createElement(SettingTabs, { panes: PANES }));
    });
    expect(paneEl('category').hidden).toBe(false);
    expect(paneEl('numeric').hidden).toBe(true);
    expect(tabButton('category').getAttribute('aria-selected')).toBe('true');
  });

  it('挂载兜底：挂载后 data-enhancement-reveal-target 属性被消费移除（不残留、不重复触发）', () => {
    const card = document.createElement('div');
    card.setAttribute('data-enhancement-feature', 'content-filter');
    card.dataset.enhancementRevealTarget = '#ctl-category';
    document.body.appendChild(card);
    container = card;
    root = createRoot(card);
    act(() => {
      root.render(createElement(SettingTabs, { panes: PANES }));
    });
    expect(card.getAttribute('data-enhancement-reveal-target')).toBeNull();
  });

  it('挂载兜底：pending 目标不属于任何 pane（卡内 pane 外）→ 默认 pane 不变，属性仍被消费', () => {
    const card = document.createElement('div');
    card.setAttribute('data-enhancement-feature', 'content-filter');
    card.dataset.enhancementRevealTarget = '#ctl-outside-panes';
    document.body.appendChild(card);
    const outside = document.createElement('input');
    outside.id = 'ctl-outside-panes';
    card.appendChild(outside);
    container = card;
    root = createRoot(card);
    act(() => {
      root.render(createElement(SettingTabs, { panes: PANES }));
    });
    expect(paneEl('numeric').hidden).toBe(false);
    expect(paneEl('category').hidden).toBe(true);
    expect(card.getAttribute('data-enhancement-reveal-target')).toBeNull();
  });
});
