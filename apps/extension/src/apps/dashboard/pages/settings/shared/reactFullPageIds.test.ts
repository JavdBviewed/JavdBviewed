import { describe, expect, it } from 'vitest';
import { isReactFullSettingsPage } from './reactFullPageIds';
import { SETTINGS_NAV_ITEMS } from '../settingsNavModel';

describe('React full settings pages', () => {
  it('mounts update-settings through the React page so product entries are visible', () => {
    expect(isReactFullSettingsPage('update-settings')).toBe(true);
  });

  it('includes the first remaining settings batch in the React full-page allowlist', () => {
    for (const pageId of ['display-settings', 'search-engine-settings', 'ai-settings', 'privacy-settings']) {
      expect(isReactFullSettingsPage(pageId), pageId).toBe(true);
    }
  });

  it('includes the second remaining settings batch in the React full-page allowlist', () => {
    for (const pageId of ['webdav-settings', 'sync-settings', 'insights-settings', 'log-settings']) {
      expect(isReactFullSettingsPage(pageId), pageId).toBe(true);
    }
  });

  it('includes the final remaining settings batch in the React full-page allowlist', () => {
    for (const pageId of ['advanced-settings', 'network-test-settings', 'global-actions', 'update-settings']) {
      expect(isReactFullSettingsPage(pageId), pageId).toBe(true);
    }
  });

  it('keeps every settings navigation entry on a complete React page', () => {
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(isReactFullSettingsPage(item.id), item.id).toBe(true);
    }
  });
});
