import { describe, expect, it } from 'vitest';
import { isReactFullSettingsPage } from './reactFullPageIds';
import { LEGACY_SETTINGS_SUBSECTION_ALIASES, normalizeSettingsSubSectionId } from './settingsRouteAliases';
import { SETTINGS_NAV_ITEMS } from '../settingsNavModel';

describe('React full settings pages', () => {
  it('mounts update-settings through the React page so product entries are visible', () => {
    expect(isReactFullSettingsPage('update-settings')).toBe(true);
  });

  it('includes the first remaining settings batch in the React full-page allowlist', () => {
    for (const pageId of ['search-engine-settings', 'ai-settings', 'privacy-settings']) {
      expect(isReactFullSettingsPage(pageId), pageId).toBe(true);
    }
  });

  it('drops display-settings from the allowlist after the IA migration to enhancement list tab', () => {
    // 2026-09-27 IA 裁决：显示设置整页迁入功能增强 · 列表页增强，旧 hash 在 mount 层重定向
    expect(isReactFullSettingsPage('display-settings')).toBe(false);
  });

  it('includes the second remaining settings batch in the React full-page allowlist', () => {
    for (const pageId of ['webdav-settings', 'sync-settings', 'insights-settings', 'log-settings']) {
      expect(isReactFullSettingsPage(pageId), pageId).toBe(true);
    }
  });

  it('includes the final remaining settings batch in the React full-page allowlist', () => {
    for (const pageId of ['advanced-settings', 'network-test-settings', 'update-settings']) {
      expect(isReactFullSettingsPage(pageId), pageId).toBe(true);
    }
  });

  it('drops global-actions and emby-settings from the allowlist after the IA consolidation', () => {
    // 2026-10-03 IA 裁决：全局操作并入 advanced-settings，emby-settings 改名 media-library-settings
    expect(isReactFullSettingsPage('global-actions')).toBe(false);
    expect(isReactFullSettingsPage('emby-settings')).toBe(false);
    expect(isReactFullSettingsPage('media-library-settings')).toBe(true);
  });

  it('aliases every retired id onto a page that stays on the React full-page allowlist', () => {
    for (const legacyId of Object.keys(LEGACY_SETTINGS_SUBSECTION_ALIASES)) {
      expect(isReactFullSettingsPage(legacyId), legacyId).toBe(false);
      expect(isReactFullSettingsPage(normalizeSettingsSubSectionId(legacyId)), legacyId).toBe(true);
    }
  });

  it('keeps every settings navigation entry on a complete React page', () => {
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(isReactFullSettingsPage(item.id), item.id).toBe(true);
    }
  });
});
