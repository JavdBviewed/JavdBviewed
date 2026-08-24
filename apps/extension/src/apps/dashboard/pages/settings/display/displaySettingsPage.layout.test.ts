/**
 * @file displaySettingsPage.layout.test.ts
 * @description 显示设置页遗留锚点布局回归测试
 * @module apps/dashboard/pages/settings/display
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'DisplaySettingsPage.tsx'), 'utf8');

describe('DisplaySettingsPage layout', () => {
  it('keeps the legacy display-settings page anchor around the React content', () => {
    expect(pageSource).toContain('<div className="flex flex-col gap-4" id="display-settings">');
  });
});
