/**
 * @vitest-environment jsdom
 * @file Checkbox.test.tsx
 * @description 通用 checkbox 组件契约（09-29-cftabs）：受控切换 / disabled / id 稳定 /
 *   label 渲染 / card 变体密度标记（视觉基准=新作品侧 checkbox）。
 * @module ui/primitives
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Checkbox', () => {
  let container: HTMLDivElement;
  let root: Root;

  function mount(node: ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(node);
    });
  }

  function renderCheckbox(props: Partial<React.ComponentProps<typeof Checkbox>> = {}) {
    mount(
      createElement(Checkbox, {
        id: 'cb-test',
        checked: false,
        onChange: vi.fn(),
        label: '测试项',
        ...props,
      }),
    );
    const label = container.querySelector<HTMLElement>('label[data-ui-pattern="checkbox"]');
    if (!label) throw new Error('checkbox label not rendered');
    return label;
  }

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a native checkbox input with stable id and label text', () => {
    renderCheckbox();
    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input).not.toBeNull();
    expect(input!.id).toBe('cb-test');
    expect(input!.hasAttribute('checked')).toBe(false);
    expect(container.textContent).toContain('测试项');
  });

  it('toggles via onChange(checked) on click (both directions)', () => {
    const calls: boolean[] = [];
    let state = false;
    const render = () =>
      createElement(Checkbox, {
        id: 'cb-toggle',
        checked: state,
        onChange: (v: boolean) => {
          calls.push(v);
          state = v;
        },
        label: '切换',
      });
    mount(render());
    const input = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => {
      input().click();
    });
    // 受控组件：父级以新 state 重渲（React 不自动更新受控 DOM）
    act(() => {
      root.render(render());
    });
    expect(calls).toEqual([true]);
    act(() => {
      input().click();
    });
    act(() => {
      root.render(render());
    });
    expect(calls).toEqual([true, false]);
  });

  it('disabled: input disabled + click no-op（onChange 不调用）', () => {
    const onChange = vi.fn();
    renderCheckbox({ disabled: true, onChange });
    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(input.disabled).toBe(true);
    act(() => {
      input.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('variant=card 打 data-checkbox-variant 标记；compact 切 card-compact', () => {
    renderCheckbox({ variant: 'card' });
    let label = container.querySelector<HTMLElement>('label[data-ui-pattern="checkbox"]');
    expect(label!.dataset.checkboxVariant).toBe('card');
    act(() => {
      root.unmount();
    });
    container.remove();
    renderCheckbox({ variant: 'card', compact: true });
    label = container.querySelector<HTMLElement>('label[data-ui-pattern="checkbox"]');
    expect(label!.dataset.checkboxVariant).toBe('card-compact');
    act(() => {
      root.unmount();
    });
    container.remove();
    renderCheckbox({});
    label = container.querySelector<HTMLElement>('label[data-ui-pattern="checkbox"]');
    expect(label!.dataset.checkboxVariant).toBe('plain');
  });

  it('title 透传到 label（悬浮提示）', () => {
    renderCheckbox({ title: '提示文本' });
    const label = container.querySelector<HTMLElement>('label[data-ui-pattern="checkbox"]');
    expect(label!.getAttribute('title')).toBe('提示文本');
  });
});
