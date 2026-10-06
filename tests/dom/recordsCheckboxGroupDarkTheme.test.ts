/**
 * @file recordsCheckboxGroupDarkTheme.test.ts
 * @description 影片编辑弹窗「收藏此影片」checkbox-group 的日夜切换（修复 #edit-is-favorite 块暗态样式不生效）。
 * 根因：全仓 dashboard CSS 无 color-scheme 声明 → 原生 <input type=checkbox> 在暗态下
 * 保持 light scheme（未勾选白盒/勾选默认蓝 accent 不随主题）。
 * 修复面：records.css [data-theme="dark"] 区为 .checkbox-group input[type="checkbox"] 加 color-scheme: dark。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/records.css');

describe('records edit modal checkbox-group dark theme', () => {
  it('sets color-scheme: dark on .checkbox-group input[type="checkbox"] in the dark theme section', () => {
    const css = readFileSync(cssPath, 'utf8');
    // 正锁：暗色区必须为 checkbox-group 的原生 checkbox 声明 dark scheme
    expect(css).toMatch(
      /\[data-theme="dark"\]\s+\.checkbox-group\s+input\[type="checkbox"\]\s*\{[^}]*color-scheme:\s*dark;/s
    );
  });

  it('keeps the light-theme .checkbox-group four rules intact (no accidental deletion)', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.checkbox-group\s*\{\s*flex-direction:\s*row;\s*align-items:\s*center;\s*\}/s);
    expect(css).toMatch(/\.checkbox-group label\s*\{[^}]*gap:\s*8px;[^}]*cursor:\s*pointer;/s);
    expect(css).toMatch(/\.checkbox-group input\[type="checkbox"\]\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    expect(css).toMatch(/\.checkbox-group i\s*\{\s*font-size:\s*16px;\s*\}/s);
  });

  it('keeps .form-group label text color on the theme variable in both themes (text was not the fault surface)', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.form-group label\s*\{[^}]*color:\s*var\(--text-primary\);/s);
    expect(css).toMatch(/\[data-theme="dark"\]\s+\.form-group label\s*\{\s*color:\s*var\(--text-primary\);\s*\}/s);
  });
});
