/**
 * @file legacySettingsSectionNav.test.ts
 * @description ???? partial ??????????
 * @module apps/dashboard/pages/settings/shared
 */
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareLegacySettingsSectionNav } from './legacySettingsSectionNav';

const PANEL_HTML = `
<div class="settings-page" id="ai-settings">
  <div class="settings-page-header"><h2>AI??</h2></div>
  <div class="settings-page-body">
    <div class="settings-card settings-section"><h4><i class="fas fa-cog"></i> ????</h4><input id="aiApiKey"></div>
    <div class="settings-card settings-section"><h4>????</h4></div>
    <div class="settings-card settings-section hidden"><h4>????</h4></div>
    <div class="settings-card settings-section"><h4>????</h4></div>
  </div>
</div>
`;

describe('prepareLegacySettingsSectionNav', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    vi.stubGlobal('document', dom.window.document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts visible legacy settings sections and injects stable anchors without changing field ids', () => {
    const prepared = prepareLegacySettingsSectionNav(PANEL_HTML, 'ai-settings');

    expect(prepared.items.map((item) => item.label)).toEqual(['????', '????', '????']);
    expect(prepared.items[0]?.id).toBe('ai-settings-section-0');
    expect(prepared.panelHtml).toContain('id="ai-settings-section-0"');
    expect(prepared.panelHtml).toContain('class="settings-section-anchor"');
    expect(prepared.panelHtml).toContain('id="aiApiKey"');
    expect(prepared.panelHtml).not.toContain('data-section-nav-target');
  });

  it('does not enable navigation for short legacy pages', () => {
    const html = `
<div class="settings-page" id="display-settings">
  <div class="settings-page-body">
    <div class="display-settings-column"><h4>????</h4></div>
    <div class="display-settings-column"><h4>????</h4></div>
  </div>
</div>`;

    const prepared = prepareLegacySettingsSectionNav(html, 'display-settings');

    expect(prepared.items).toEqual([]);
    expect(prepared.panelHtml).toBe(html);
  });

  it('extracts titles from nested legacy card headers', () => {
    const html = `
<div class="settings-page" id="advanced-settings">
  <div class="settings-page-body">
    <div class="settings-section settings-card"><div class="advanced-tool-header"><div><h4>Raw logs</h4></div></div></div>
    <div class="settings-section settings-card"><div class="action-tile-header"><div><h4>Cache</h4></div></div></div>
    <div class="settings-section privacy-card"><div class="privacy-section-header"><h4>Privacy</h4></div></div>
  </div>
</div>`;

    const prepared = prepareLegacySettingsSectionNav(html, 'advanced-settings');

    expect(prepared.items.map((item) => item.label)).toEqual(['Raw logs', 'Cache', 'Privacy']);
    expect(prepared.panelHtml).toContain('advanced-settings-section-0');
  });

  it('uses preceding section comments for legacy groups without visible heading elements', () => {
    const html = `
<div class="settings-page" id="enhancement-settings">
  <div class="settings-page-body">
    <!-- Data -->
    <div class="settings-section"><div class="form-group"><input id="dataToggle"><span>row</span></div></div>
    <!-- UX -->
    <div class="settings-section"><div class="form-group"><button id="uxButton">row</button></div></div>
    <!-- Other -->
    <div class="settings-section"><div class="form-group"><input id="otherToggle"><span>row</span></div></div>
    <!-- Empty -->
    <div class="settings-section"></div>
  </div>
</div>`;

    const prepared = prepareLegacySettingsSectionNav(html, 'enhancement-settings');

    expect(prepared.items.map((item) => item.label)).toEqual(['Data', 'UX', 'Other']);
    expect(prepared.panelHtml).toContain('id="dataToggle"');
  });

});
