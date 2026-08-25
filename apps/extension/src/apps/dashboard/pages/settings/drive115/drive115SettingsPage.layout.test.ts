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
const handlersSource = readFileSync(
  join(here, '../../../../../features/drive115/mediaLibrary/handlers.ts'),
  'utf8',
);
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

  it('uses the shared settings page frame section navigation instead of a 115-only nav', () => {
    // 快速导航统一由共享外框 SettingsPageFrame 渲染（单一导航，不再页面内手动嵌套）。
    expect(pageSource).toContain("from '../shared/settingsPageFrame'");
    expect(pageSource).toContain('sectionNavItems={sectionNavItems}');
    expect(pageSource).not.toContain('<SettingsSectionNavLayout');
    expect(pageSource).toContain('SettingsSectionNavItem');
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

  it('exposes the default download directory and the manual-picker opt-out control', () => {
    expect(pageSource).toContain('label="默认下载目录"');
    expect(pageSource).toContain('id="drive115SkipManualPushDirectoryPicker"');
    expect(pageSource).toContain("update('skipManualPushDirectoryPicker'");
    expect(legacyPartialSource).toContain('默认下载目录');
    expect(legacyPartialSource).toContain('id="drive115SkipManualPushDirectoryPicker"');
    expect(legacyPaneSource).toContain('skipManualPushDirectoryPicker');
  });

  it('refreshes the default-directory controls after external settings changes', () => {
    expect(pageSource).toContain('prev.downloadDir === mapped.downloadDir');
    expect(pageSource).toContain('prev.skipManualPushDirectoryPicker === mapped.skipManualPushDirectoryPicker');
  });

  it('exposes an index result detail window fed by the report storage key', () => {
    expect(pageSource).toContain('id="drive115ViewLastIndexReport"');
    expect(pageSource).toContain('Drive115IndexReportModal');
    expect(pageSource).toContain('STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT');
    // 跳过原因分组标签存在
    expect(pageSource).toContain('SKIP_REASON_LABELS');
  });

  it('renders index history without the broken full-screen overlay and supports indexed entry search', () => {
    const modalStart = pageSource.indexOf('function Drive115IndexReportModal');
    const modalEnd = pageSource.indexOf('type Drive115GroupProps');
    const reportModalSource = pageSource.slice(modalStart, modalEnd);

    expect(reportModalSource).not.toContain('<Modal');
    expect(reportModalSource).toContain('role="dialog"');
    expect(reportModalSource).toContain('搜索入库明细');
    expect(reportModalSource).toContain('detailQuery');
    expect(reportModalSource).toContain('filteredIndexed');
  });

  it('keeps completed index errors in an index history dialog instead of the main status panel', () => {
    expect(pageSource).toContain('索引记录');
    expect(pageSource).toContain('STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_HISTORY');
    expect(handlersSource).toContain('INDEX_HISTORY_LIMIT = 20');
    expect(pageSource).toContain('id="drive115ViewLastIndexReport"');
    expect(pageSource).toContain('id="drive115ViewIndexHistory"');
    expect(pageSource).toContain('上次记录');
    expect(pageSource).toContain('索引历史');
    expect(pageSource).not.toContain('单次最多 300 个影片文件夹');
  });

  it('does not render the previous report as current skip details while indexing', () => {
    expect(pageSource).toContain('!indexRunActive && indexReport && indexReport.skippedTotal > 0');
    expect(pageSource).toContain('!indexRunActive && indexReport ?');
  });

  it('keeps each skip reason together with its matching folder details', () => {
    expect(pageSource).toContain('skippedByReason');
    expect(pageSource).toContain('跳过项目');
    expect(pageSource).toContain('report.skipped.filter((item) => item.reason === row.reason)');
    expect(pageSource).not.toContain('<h3 className="text-[13px] font-semibold">跳过原因</h3>');
    expect(pageSource).not.toContain('<span>跳过明细</span>');
  });

  it('shows the concrete directory listing failure under the affected folder', () => {
    expect(pageSource).toContain('item.failureMessage');
    expect(pageSource).toContain('请求原因');
  });

  it('makes a rate-limit checkpoint visible as a resumable index state', () => {
    expect(pageSource).toContain('indexResumePending');
    expect(pageSource).toContain('indexResumeAt');
    expect(pageSource).toContain('DRIVE115_LIBRARY_INDEX_CHECKPOINT');
    expect(pageSource).toContain('window.setInterval');
    expect(pageSource).toContain('等待继续');
    expect(pageSource).toContain('将在');
    expect(pageSource).toContain('可以关闭此管理页面');
    expect(pageSource).toContain('关闭浏览器或关机不会丢失进度');
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
