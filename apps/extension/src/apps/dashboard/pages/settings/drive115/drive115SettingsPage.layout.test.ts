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
const legacyPartialSource = readFileSync(
  join(here, '../../../../../dashboard/partials/tabs/settings-drive115.html'),
  'utf8',
);
const legacyPaneSource = readFileSync(
  join(here, '../../../../../dashboard/tabs/settings/drive115/Drive115V2Pane.ts'),
  'utf8',
);

describe('Drive115SettingsPage layout', () => {
  it('marks the media library group as beta', () => {
    expect(pageSource).toContain('<Drive115Group title="\u5a92\u4f53\u5e93" beta>');
    expect(pageSource).toContain('<Badge tone="warning" className="shrink-0">');
    expect(pageSource).toContain('Beta</Badge>');
  });

  it('exposes media library scan depth and cancellation controls', () => {
    expect(pageSource).toContain('id="drive115MediaLibraryScanDepth"');
    expect(pageSource).toContain("update('mediaLibraryScanDepth', depth)");
    expect(pageSource).toContain('id="drive115CancelMediaLibraryIndex"');
    expect(pageSource).toContain('DRIVE115_MEDIA_LIBRARY_CANCEL_INDEX');
  });

  it('keeps legacy media library controls in sync', () => {
    expect(legacyPartialSource).toContain('id="drive115MediaLibraryScanDepth"');
    expect(legacyPartialSource).toContain('id="drive115CancelMediaLibraryIndex"');
    expect(legacyPaneSource).toContain('mediaLibraryScanDepth');
    expect(legacyPaneSource).toContain('DRIVE115_MEDIA_LIBRARY_CANCEL_INDEX');
    expect(legacyPaneSource).toContain('sendRuntimeMessage');
  });

  it('exposes an index result detail window fed by the report storage key', () => {
    expect(pageSource).toContain('id="drive115ViewIndexReport"');
    expect(pageSource).toContain('Drive115IndexReportModal');
    expect(pageSource).toContain('STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT');
    // 跳过原因分组标签存在
    expect(pageSource).toContain('SKIP_REASON_LABELS');
  });

});
