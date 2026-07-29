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
const driveCssSource = readFileSync(
  join(here, '../../../../../dashboard/styles/05-pages/settings/drive115.css'),
  'utf8',
);
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
    expect(pageSource).toContain('<Drive115Group title="媒体库" navId={DRIVE115_SECTION_IDS.mediaLibrary} beta>');
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


  it('aligns the React container width with the shared SettingsPageFrame content width', () => {
    expect(driveCssSource).toContain("#drive115-settings[data-drive115-settings-react='1'].settings-page");
    expect(driveCssSource).toContain('max-width: 1200px;');
    expect(driveCssSource).toContain('padding: 0 4px 32px;');
    expect(driveCssSource).toContain("#drive115-settings[data-drive115-settings-react='1'] .drive115-settings-container");
    expect(driveCssSource).toContain('max-width: none;');
  });

  it('uses the shared settings section navigation instead of a 115-only nav', () => {
    expect(pageSource).toContain("from '../shared/SettingsSectionNav'");
    expect(pageSource).toContain('<SettingsSectionNavLayout items={sectionNavItems}>');
    expect(pageSource).toContain('type SettingsSectionNavItem');
  });

  it('declares stable section anchors for settings navigation without replacing field ids', () => {
    expect(pageSource).toContain('drive115-section-mode');
    expect(pageSource).toContain('drive115-section-openlist-manual');
    expect(pageSource).toContain('drive115-section-pkce');
    expect(pageSource).toContain('drive115-section-credentials');
    expect(pageSource).toContain('drive115-section-download');
    expect(pageSource).toContain('drive115-section-media-library');
    expect(pageSource).toContain('drive115-section-logs');
    expect(pageSource).toContain('id="drive115MediaLibraryScanDepth"');
    expect(pageSource).toContain('id="drive115CancelMediaLibraryIndex"');
  });

  it('exposes an index result detail window fed by the report storage key', () => {
    expect(pageSource).toContain('id="drive115ViewIndexReport"');
    expect(pageSource).toContain('Drive115IndexReportModal');
    expect(pageSource).toContain('STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT');
    // 跳过原因分组标签存在
    expect(pageSource).toContain('SKIP_REASON_LABELS');
  });

  it('uses keptPrevious response message instead of previous stats in the final toast', () => {
    expect(pageSource).toContain('resp?.keptPrevious');
    expect(pageSource).toContain('未发现可入库影片，已保留上一份索引');
    expect(pageSource).toMatch(/resp\?\.keptPrevious[\s\S]*resp\.message[\s\S]*stats/);
  });
});

it('renders indexed metadata diagnostics in the report modal', () => {
  expect(pageSource).toContain('封面');
  expect(pageSource).toContain('NFO');
  expect(pageSource).toContain('hasCoverPickCode');
  expect(pageSource).toContain('hasNfoPickCode');
});
