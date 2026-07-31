/**
 * @file enhancementSettingsPage.layout.test.ts
 * @description 功能增强设置页布局回归测试
 * @module apps/dashboard/pages/settings/enhancement
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'EnhancementSettingsPage.tsx'), 'utf8');
const sharedStyleSource = readFileSync(
  join(here, '..', 'shared', 'settingsHighlightNotice.css'),
  'utf8',
);

describe('EnhancementSettingsPage layout', () => {
  it('uses the shared highlight notice style for the beta warning', () => {
    expect(pageSource).toContain('SettingsHighlightNotice');
    expect(pageSource).toContain('功能增强仍在测试中');
    expect(pageSource).toContain('GitHub Issues');
    expect(pageSource).toContain('https://github.com/lmixture/JavdBviewed/issues');
    expect(sharedStyleSource).toContain('.settings-highlight-notice');
  });
});
