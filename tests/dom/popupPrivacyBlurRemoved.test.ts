/**
 * @file popupPrivacyBlurRemoved.test.ts
 * @description 线 10-23-privacy-popup-toggle-ux：popup「隐私模糊」开关整删负锁（用户拍板：不常用，去掉）。
 *   10-06-site-privacy-blur 引入的正锁文件 popupPrivacyBlurToggle.test.ts 随特性整删
 *   （机械改写为零放宽：原 3 it 正锁→本 3 it 负锁，方向翻转，无其它断言触碰）。
 *   存储键 privacy.screenshotMode.contentPages.enabled 不删不迁移（dashboard 侧仍是主控制点）。
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

describe('popup privacy-blur toggle fully removed (10-23-privacy-popup-toggle-ux)', () => {
  it('removes the privacy-blur card, container and label from popup html; volume row drops the split marker', () => {
    const doc = parsePopupHtml();
    expect(doc.querySelector('.privacy-blur-section'), '隐私模糊卡已删').toBeNull();
    expect(doc.querySelector('#privacyBlurToggleContainer'), '开关容器已删').toBeNull();
    expect(doc.body.textContent, '「隐私模糊」字面量零残留').not.toContain('隐私模糊');

    const volume = doc.querySelector('.volume-control-section');
    expect(volume, '音量卡仍在位').not.toBeNull();
    const row = volume?.parentElement;
    expect(row?.className, '音量行仍是 full-row').toContain('full-row');
    expect(row?.className, 'full-row-split 标记已删').not.toContain('full-row-split');

    // 既有断言兼容：full-row 数量不变（音量行 + 列表显示行，恰 2 个）
    const fullRows = Array.from(doc.querySelectorAll('.main-grid > .full-row'));
    expect(fullRows.length, 'full-row 数量不变').toBe(2);
  });

  it('removes every privacy-blur / split-row css rule (no dead css)', () => {
    const css = readFileSync(popupCssPath, 'utf8');
    expect(css, '.privacy-blur-section 规则零残留').not.toContain('.privacy-blur-section');
    expect(css, 'full-row-split 规则零残留').not.toContain('full-row-split');
  });

  it('removes createPrivacyBlurToggle wiring from bootstrap', () => {
    const src = readFileSync(bootstrapPath, 'utf8');
    expect(src, 'createPrivacyBlurToggle 函数已删').not.toContain('createPrivacyBlurToggle');
    expect(src, '容器取元素已删').not.toContain("getElementById('privacyBlurToggleContainer')");
    expect(src, 'aria 文案「隐私模糊」零残留').not.toContain('隐私模糊');
  });
});
