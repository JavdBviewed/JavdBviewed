/**
 * @file recordsBatchDropdownZIndex.test.ts
 * @description 记录页批量操作下拉必须绘制在后续兄弟容器之上（视频列表卡背景），
 * 保证展开后 4 个操作按钮可点击（修复 #batchActionsDropdown 被覆盖报障）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/records.css');

describe('records page batch operations dropdown stacking', () => {
  it('lifts .batch-operations above its .records-page > * siblings so the dropdown stays clickable', () => {
    const css = readFileSync(cssPath, 'utf8');

    // 前提锁定：.records-page 直接子均为 z-index:1 独立层叠上下文（本修复不改该全局规则）
    expect(css).toMatch(/\.records-page\s*>\s*\*\s*\{\s*position:\s*relative;\s*z-index:\s*1;/s);
    // 批量操作块须整体抬升到兄弟之上（>1；下拉框自身 z-index:1000 只在 #batchOperations 上下文内有效）
    expect(css).toMatch(/\.records-page\s+\.batch-operations\s*\{[^}]*z-index:\s*10;/s);
  });
});
