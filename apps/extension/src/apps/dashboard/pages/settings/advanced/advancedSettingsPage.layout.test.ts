/**
 * @file advancedSettingsPage.layout.test.ts
 * @description 高级配置页布局回归测试（2026-10-03 IA 裁决：全局操作并入本页）
 * @module apps/dashboard/pages/settings/advanced
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'AdvancedSettingsPage.tsx'), 'utf8');
const mountSource = readFileSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'mount.ts'), 'utf8');
const globalActionsDir = join(here, '..', 'globalActions');

const countOf = (source: string, needle: string): number => source.split(needle).length - 1;

describe('AdvancedSettingsPage merged layout', () => {
  it('renders the three original advanced sections plus the three merged global sections', () => {
    for (const title of [
      '原始配置工作台',
      '原始日志',
      '使用建议',
      '全局数据操作',
      '缓存管理',
      '系统操作',
    ]) {
      expect(pageSource, title).toContain(title);
    }
    // 2026-10-03 10-11 线：「使用情况统计」开关移除（使用即上报，用户不可关闭）
    expect(pageSource, '「使用情况统计」负锁').not.toContain('使用情况统计');
    expect(pageSource, 'telemetryEnabled 负锁').not.toContain('id="telemetryEnabled"');
    // 3 原有 + 3 并入 = 6 个分组，且不再有第二份页面外框
    expect(countOf(pageSource, '<SettingSection'), '<SettingSection 总数').toBe(6);
    expect(countOf(pageSource, '<SettingsPageFrame'), '<SettingsPageFrame 总数').toBe(1);
    expect(countOf(pageSource, '</SettingsPageFrame>'), '</SettingsPageFrame> 总数').toBe(1);
  });

  it('keeps every global action button id exactly once on the merged page', () => {
    for (const id of [
      'clearAllBtn',
      'clearCacheBtn',
      'clearTempDataBtn',
      'resetSettingsBtn',
      'reloadExtensionBtn',
    ]) {
      expect(countOf(pageSource, `id="${id}"`), id).toBe(1);
    }
    // 原高级配置按钮不得因并入而丢失
    for (const id of ['viewJsonBtn', 'editJsonBtn', 'exportJsonBtn', 'viewRawLogsBtn', 'testLogBtn']) {
      expect(countOf(pageSource, `id="${id}"`), id).toBe(1);
    }
  });

  it('keeps the advanced page identity and the merged global-actions wrapper id', () => {
    expect(pageSource).toContain('pageId="advanced-settings"');
    expect(pageSource).toContain("rootDataAttrs={{ 'data-advanced-settings-react': '1' }}");
    expect(pageSource).toContain('id="advanced-settings"');
    // 并入驻民保留原包裹层 id：fidelity CSS 间距选择器与搜索定位契约不变
    expect(pageSource).toContain('id="global-actions"');
    expect(pageSource).not.toContain('data-global-actions-react');
    expect(pageSource).not.toContain('pageId="global-actions"');
  });

  it('imports the global actions from the surviving actions module', () => {
    // 动作函数模块保留不动，只删页面与挂载文件
    expect(pageSource).toContain("'../globalActions/globalActionsActions'");
    for (const fn of [
      'clearAllLocalData',
      'clearCacheData',
      'clearTempData',
      'resetAllSettings',
      'reloadExtension',
    ]) {
      expect(pageSource, fn).toContain(fn);
    }
    expect(existsSync(join(globalActionsDir, 'globalActionsActions.ts'))).toBe(true);
  });

  it('deletes the now-unreachable global actions React page and its mount', () => {
    expect(existsSync(join(globalActionsDir, 'GlobalActionsPage.tsx'))).toBe(false);
    expect(existsSync(join(globalActionsDir, 'mountGlobalActionsPage.ts'))).toBe(false);
    expect(mountSource).not.toContain('mountGlobalActionsPage');
    expect(mountSource).not.toContain("subSection === 'global-actions'");
    expect(mountSource).toContain('mountAdvancedSettingsPage');
  });

  it('normalizes retired settings route ids before the React full-page decision', () => {
    expect(mountSource).toContain('normalizeSettingsSubSectionId');
    expect(mountSource).toContain('settingsRouteAliases');
    // 旧 hash 落页即规范为新 hash（照 display-settings 先例用 replaceState）
    expect(mountSource).toContain('history.replaceState');
  });
});
