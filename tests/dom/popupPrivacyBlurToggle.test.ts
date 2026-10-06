/**
 * @file popupPrivacyBlurToggle.test.ts
 * @description 线 10-06-site-privacy-blur：popup「隐私模糊」总开关结构/样式/接线源码锁。
 *   总开关与音量同行（音量 full-row 加 full-row-split 标记、音量卡收窄、隐私模糊卡 230px 定宽），
 *   不新增 full-row（既有 popupMoreFiltersTitleLink「full-row 恰 2 个」断言保持绿）；
 *   生效链=content 侧 storage.onChanged → controller.update 单链路，bootstrap 侧
 *   负锁 tabs.reload / sendMessage（即时生效不刷新）。
 * @module tests/dom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const popupHtmlPath = resolve(process.cwd(), 'apps/extension/src/popup/popup.html');
const popupCssPath = resolve(process.cwd(), 'apps/extension/src/popup/popup.css');
const bootstrapPath = resolve(process.cwd(), 'apps/extension/src/apps/popup/bootstrap.ts');

function parsePopupHtml(): Document {
  return new DOMParser().parseFromString(readFileSync(popupHtmlPath, 'utf8'), 'text/html');
}

describe('popup privacy-blur master toggle (10-06-site-privacy-blur)', () => {
  it('renders the privacy-blur card on the same full-row as volume (no extra full-row)', () => {
    const doc = parsePopupHtml();
    const section = doc.querySelector('.privacy-blur-section');
    expect(section, 'privacy-blur-section 必须在位').not.toBeNull();
    expect(section?.textContent).toContain('隐私模糊');
    expect(section?.querySelector('.control-header'), 'control-header 在位').not.toBeNull();
    expect(section?.querySelector('.help-icon-btn'), '帮助图标按钮在位').not.toBeNull();

    const container = doc.querySelector('#privacyBlurToggleContainer');
    expect(container, '#privacyBlurToggleContainer 必须在位').not.toBeNull();
    expect(doc.querySelectorAll('#privacyBlurToggleContainer').length, '容器唯一').toBe(1);
    expect(container?.closest('.privacy-blur-section'), '容器在隐私模糊卡内').not.toBeNull();

    const volume = doc.querySelector('.volume-control-section');
    expect(volume, '音量卡在位').not.toBeNull();
    expect(section?.parentElement, '隐私模糊卡与音量卡同父（full-row）').toBe(volume?.parentElement);
    expect(volume?.parentElement?.className, '父行仍是 full-row').toContain('full-row');
    expect(volume?.parentElement?.className, '父行带 full-row-split 标记').toContain('full-row-split');

    // 既有断言兼容：full-row 数量不变（音量行 + 列表显示行，恰 2 个）
    const fullRows = Array.from(doc.querySelectorAll('.main-grid > .full-row'));
    expect(fullRows.length, 'full-row 数量不变').toBe(2);
  });

  it('narrows volume and pins privacy-blur width, reusing the shared card styles', () => {
    const css = readFileSync(popupCssPath, 'utf8');

    const splitRule = css.match(/\.main-grid\s*\.full-row\.full-row-split\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(splitRule, '.full-row-split flex 行规则在位').toContain('display: flex');
    expect(splitRule).toContain('gap: 12px');

    const volumeFlex = css.match(/\.full-row-split\s*\.volume-control-section\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(volumeFlex, '音量收窄规则在位').toContain('flex: 1 1 0');

    const privacyFlex = css.match(/\.full-row-split\s*\.privacy-blur-section\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(privacyFlex, '隐私模糊卡定宽规则在位').toContain('flex: 0 0 230px');

    const light = css.match(/\.main-controls\s*,[^{]*\{/)?.[0] ?? '';
    expect(light, '共享卡 light 选择器列表含 .privacy-blur-section').toContain('.privacy-blur-section');
    const dark = css.match(/\[data-theme="dark"\]\s*\.main-controls\s*,[^{]*\{/)?.[0] ?? '';
    expect(dark, '共享卡 dark 选择器列表含 .privacy-blur-section').toContain('.privacy-blur-section');
  });

  it('wires createPrivacyBlurToggle without tabs.reload/sendMessage (immediate via content storage.onChanged)', () => {
    const src = readFileSync(bootstrapPath, 'utf8');
    const fnIdx = src.indexOf('async function createPrivacyBlurToggle(');
    expect(fnIdx, 'createPrivacyBlurToggle 在位').toBeGreaterThan(-1);
    const helpIdx = src.indexOf('// Help Panel', fnIdx);
    expect(helpIdx, '锚点 // Help Panel 在位').toBeGreaterThan(fnIdx);
    const body = src.slice(fnIdx, helpIdx);

    expect(body, '读 contentPages.enabled').toContain('contentPages');
    expect(body, 'saveSettings 持久化').toContain('saveSettings(');
    expect(body, '无 tab 刷新（即时生效）').not.toContain('tabs.reload');
    expect(body, '无消息广播（即时生效）').not.toContain('sendMessage');
    expect(body, 'aria 状态文案').toContain('隐私模糊');

    expect(src, '容器声明在位').toContain("getElementById('privacyBlurToggleContainer')");
    expect(/createPrivacyBlurToggle\(\s*privacyBlurToggleContainer\s*\)/.test(src), 'initialize 接线在位').toBe(true);
  });
});
