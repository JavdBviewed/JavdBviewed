/**
 * @file settingsIndexPage.layout.test.ts
 * @description 设置首页布局回归测试
 * @module apps/dashboard/pages/settings
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'SettingsIndexPage.tsx'), 'utf8');
const styleSource = readFileSync(join(here, 'settingsIndexPage.css'), 'utf8');

describe('SettingsIndexPage layout', () => {
  it('does not render an extra entry-card filter', () => {
    expect(pageSource).not.toContain('si-filter');
    expect(pageSource).not.toContain('筛选下方入口卡片');
    expect(pageSource).not.toContain('filterSettingsNavItems');
    expect(styleSource).not.toContain('.si-filter');
  });
});
