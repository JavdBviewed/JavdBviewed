/**
 * @file embySettingsPage.layout.test.ts
 * @description Emby/Jellyfin 设置页布局回归测试
 * @module apps/dashboard/pages/settings/emby
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'EmbySettingsPage.tsx'), 'utf8');

describe('EmbySettingsPage media server layout', () => {
  it('renders media servers as compact summary rows', () => {
    expect(pageSource).toContain('MediaServerSummaryRow');
    expect(pageSource).toContain('emby-media-server-summary');
    expect(pageSource).not.toMatch(/form.mediaServers.map[sS]{0,700}<MediaServerRow/);
  });

  it('moves server creation and editing into dialogs', () => {
    expect(pageSource).toContain('MediaServerCreateDialog');
    expect(pageSource).toContain('MediaServerEditDialog');
    expect(pageSource).toContain('emby-server-create-modal');
    expect(pageSource).toContain('emby-server-edit-modal');
  });
});
