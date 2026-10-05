/**
 * @file filterRuleDateValidation.test.tsx
 * @description 过滤规则编辑器日期校验与字段可用性说明的交互锁（10-05-contentfilter-fields-fix）：
 *   - comparison=早于/晚于/精确匹配 且指定日期空 → 保存被阻止 + warning toast「请输入指定日期」，
 *     规则不入列表（根因 A：此前可静默保存 0 命中规则）；
 *   - 补指定日期后保存成功入列表（正对照）；
 *   - between 双端均空 = 无日期约束 → 允许保存（既有语义零漂移）；
 *   - 作用字段选择器下方渲染字段可用性说明（位置=提示行紧邻下一兄弟，含两锚词）。
 *   页面渲染与 actions 层部分 mock 照 tests/dom/enhancementSaveToast.test.tsx 先例。
 * @module tests/dom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ENHANCEMENT_SETTINGS_FORM,
} from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsModel';
import {
  loadEnhancementSettingsForm,
  loadLastAppliedActorTags,
  persistEnhancementForm,
  readAiSelectedModelLabel,
} from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsActions';
import { EnhancementSettingsPage } from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/EnhancementSettingsPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 预热 toast 动态 import 链（actions 层 toast 内为动态 import，预载后按微任务决议）
await import('../../apps/extension/src/dashboard/ui/toast');

/** 部分 mock 动作层：仅替换加载/持久化缝，保留真实 toast（#messageContainer）。 */
vi.mock(
  '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsActions',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsActions')
    >();
    return {
      ...actual,
      loadEnhancementSettingsForm: vi.fn(),
      loadLastAppliedActorTags: vi.fn(),
      readAiSelectedModelLabel: vi.fn(),
      persistEnhancementForm: vi.fn(),
    };
  },
);

let host: HTMLDivElement;
let root: Root;

async function mountPageLoaded(): Promise<void> {
  await act(async () => {
    root.render(createElement(EnhancementSettingsPage));
    for (let i = 0; i < 40; i++) {
      await Promise.resolve();
    }
  });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
    }
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setMultiSelectValue(select: HTMLSelectElement, values: string[]): void {
  for (const opt of Array.from(select.options)) {
    opt.selected = values.includes(opt.value);
  }
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function lastToastOfType(type: string): string | null {
  const nodes = document.querySelectorAll(`#messageContainer .toast-${type}`);
  const node = nodes[nodes.length - 1];
  return node ? node.textContent : null;
}

/** 打开内容过滤规则编辑器（先启用内容过滤，默认关闭） */
async function openRuleEditor(): Promise<void> {
  await click(document.getElementById('enableContentFilter') as HTMLInputElement);
  const addBtn = document.getElementById('addFilterRule');
  expect(addBtn).not.toBeNull();
  await click(addBtn as HTMLElement);
  expect(document.getElementById('modalInlineRuleName')).not.toBeNull();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="messageContainer"></div>';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  loadEnhancementSettingsForm.mockResolvedValue(structuredClone(DEFAULT_ENHANCEMENT_SETTINGS_FORM));
  loadLastAppliedActorTags.mockResolvedValue([]);
  readAiSelectedModelLabel.mockResolvedValue('');
  persistEnhancementForm.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = '';
});

describe('过滤规则编辑器：日期校验与字段说明（10-05-contentfilter-fields-fix）', () => {
  it('早于 + 指定日期空：保存被阻止 + toast「请输入指定日期」且规则不入列表；补日期后保存成功（正对照）', async () => {
    vi.useFakeTimers();
    persistEnhancementForm.mockResolvedValue({ ok: true });

    await mountPageLoaded();
    await openRuleEditor();

    act(() => setInputValue(document.getElementById('modalInlineRuleName') as HTMLInputElement, '老片规则'));

    // 作用字段：仅选「发行日期」（无关键词字段 → 不触发关键词必填）
    act(() => setMultiSelectValue(document.getElementById('modalInlineRuleFields') as HTMLSelectElement, ['release-date']));

    // 对比方式 → 早于
    const cmp = document.getElementById('modalInlineRuleDateComparison') as HTMLSelectElement;
    act(() => {
      cmp.value = 'before';
      cmp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const single = document.getElementById('modalInlineRuleSingleDate');
    expect(single).not.toBeNull(); // 非 between → 指定日期输入在位

    // ① 指定日期空 → 保存被阻止
    await click(document.getElementById('saveFilterRuleBtn') as HTMLElement);
    expect(lastToastOfType('warning') ?? '').toContain('请输入指定日期');
    // 规则未入列表；弹窗仍开（未关闭）
    expect(document.getElementById('filterRulesList')!.textContent).toContain('暂无过滤规则');
    expect(document.getElementById('modalInlineRuleName')).not.toBeNull();

    // ② 补指定日期 → 保存成功，规则入列表，弹窗关闭
    act(() => setInputValue(single as HTMLInputElement, '2025-01-01'));
    await click(document.getElementById('saveFilterRuleBtn') as HTMLElement);
    expect(document.getElementById('filterRulesList')!.textContent).toContain('老片规则');
    expect(document.getElementById('modalInlineRuleName')).toBeNull();
  });

  it('between 双端均空 = 无日期约束：允许保存（既有语义零漂移）', async () => {
    vi.useFakeTimers();
    persistEnhancementForm.mockResolvedValue({ ok: true });

    await mountPageLoaded();
    await openRuleEditor();

    act(() => setInputValue(document.getElementById('modalInlineRuleName') as HTMLInputElement, '标题规则'));
    act(() => setInputValue(document.getElementById('modalInlineRuleKeyword') as HTMLInputElement, 'abc'));
    // 字段：title + 发行日期（默认 comparison=between，双端留空）
    act(() => setMultiSelectValue(document.getElementById('modalInlineRuleFields') as HTMLSelectElement, ['title', 'release-date']));

    await click(document.getElementById('saveFilterRuleBtn') as HTMLElement);
    expect(lastToastOfType('warning')).toBeNull();
    expect(document.getElementById('filterRulesList')!.textContent).toContain('标题规则');
  });

  it('作用字段选择器下方渲染字段可用性说明（位置=提示行紧邻下一兄弟，含两锚词）', async () => {
    vi.useFakeTimers();
    persistEnhancementForm.mockResolvedValue({ ok: true });

    await mountPageLoaded();
    await openRuleEditor();

    const note = document.querySelector('.enhancement-filter-rule-modal__field-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('列表卡片无');
    expect(note!.textContent).toContain('仅作用于列表页');
    // 位置：多选取提示行（Ctrl/Shift 可多选）的紧邻下一个兄弟
    const hint = Array.from(document.querySelectorAll('.enhancement-filter-rule-modal p'))
      .find((p) => (p.textContent ?? '').includes('按住 Ctrl/Shift 可多选'));
    expect(hint).toBeDefined();
    expect(hint!.nextElementSibling).toBe(note);
  });
});
