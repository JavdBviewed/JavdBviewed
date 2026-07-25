/**
 * @file drive115SettingsPage.layout.test.ts
 * @description Drive115 settings page layout regression tests
 * @module apps/dashboard/pages/settings/drive115
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'Drive115SettingsPage.tsx'), 'utf8');

describe('Drive115SettingsPage layout', () => {
  it('marks the media library group as beta', () => {
    expect(pageSource).toContain('<Drive115Group title="\u5a92\u4f53\u5e93" beta>');
    expect(pageSource).toContain('<Badge tone="warning" className="shrink-0">');
    expect(pageSource).toContain('Beta</Badge>');
  });
});
