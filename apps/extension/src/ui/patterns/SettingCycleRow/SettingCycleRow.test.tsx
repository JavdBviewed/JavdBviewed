/**
 * @vitest-environment jsdom
 * @file SettingCycleRow.test.tsx
 * @description SettingCycleRow 循环行契约（09-29：三态/多态通用循环控件）
 * @module ui/patterns
 */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingCycleRow, type SettingCycleOption } from './SettingCycleRow';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mode = 'off' | 'whitelist' | 'blacklist';
const OPTIONS: SettingCycleOption<Mode>[] = [
  { value: 'off', label: '空' },
  { value: 'whitelist', label: '候选' },
  { value: 'blacklist', label: '减去' },
];

describe('SettingCycleRow pattern', () => {
  it('renders label, description, stable id and current-state button', () => {
    const html = renderToStaticMarkup(
      createElement(SettingCycleRow, {
        id: 'categoryFilterMode',
        label: '影片类别过滤',
        description: '空=不过滤；候选=仅保留；减去=命中隐藏',
        options: OPTIONS,
        value: 'blacklist' as Mode,
        onChange: () => {},
      }),
    );
    expect(html).toContain('data-ui-pattern="setting-cycle-row"');
    // id 稳定：落在循环按钮上，label 通过 htmlFor 关联
    expect(html).toContain('<button id="categoryFilterMode"');
    expect(html).toContain('for="categoryFilterMode"');
    expect(html).toContain('影片类别过滤');
    expect(html).toContain('空=不过滤；候选=仅保留；减去=命中隐藏');
    // 按钮文案=当前态 label
    expect(html).toContain('>减去</button>');
  });

  it('aria-label 含当前态（可被读屏识别）', () => {
    const html = renderToStaticMarkup(
      createElement(SettingCycleRow, {
        id: 'mode',
        label: '模式',
        options: OPTIONS,
        value: 'whitelist' as Mode,
        onChange: () => {},
      }),
    );
    expect(html).toContain('aria-label="模式 当前：候选"');
  });
});

describe('SettingCycleRow 交互（jsdom）', () => {
  let container: HTMLDivElement;
  let root: Root;
  let calls: Mode[] = [];

  function mount(node: ReturnType<typeof createElement>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(node);
    });
  }

  /** 受控包装：把 onChange 的 next 写回 state，模拟真实受控消费方 */
  function StatefulRow(props: { initial: Mode; disabled?: boolean }) {
    const [value, setValue] = useState<Mode>(props.initial);
    return createElement(SettingCycleRow, {
      id: 'mode',
      label: '模式',
      options: OPTIONS,
      value,
      disabled: props.disabled,
      onChange: (next: Mode) => {
        calls.push(next);
        setValue(next);
      },
    });
  }

  function getButton(): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>('button#mode');
    if (!button) throw new Error('cycle button not rendered');
    return button;
  }

  function click() {
    act(() => {
      getButton().click();
    });
  }

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    calls = [];
    vi.useRealTimers();
  });

  it('循环顺序 off→whitelist→blacklist→off（回绕）', () => {
    mount(createElement(StatefulRow, { initial: 'off' }));
    expect(getButton().textContent).toBe('空');
    click();
    expect(getButton().textContent).toBe('候选');
    click();
    expect(getButton().textContent).toBe('减去');
    click();
    expect(getButton().textContent).toBe('空');
    expect(calls).toEqual(['whitelist', 'blacklist', 'off']);
  });

  it('从中间态起跳同样按序循环（blacklist→off）', () => {
    mount(createElement(StatefulRow, { initial: 'blacklist' }));
    click();
    expect(getButton().textContent).toBe('空');
    expect(calls).toEqual(['off']);
  });

  it('disabled：点击 no-op（不触发 onChange，按钮 disabled）', () => {
    mount(createElement(StatefulRow, { initial: 'off', disabled: true }));
    expect(getButton().disabled).toBe(true);
    click();
    expect(calls).toEqual([]);
    expect(getButton().textContent).toBe('空');
  });
});
