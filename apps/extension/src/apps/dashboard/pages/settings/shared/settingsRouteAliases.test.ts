/**
 * @file settingsRouteAliases.test.ts
 * @description 设置子页旧路由 id 归一化纯函数测试（2026-10-03 IA 合并/改名线）
 * @module apps/dashboard/pages/settings/shared
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_SETTINGS_SUBSECTION_ALIASES,
  normalizeSettingsSubSectionId,
} from './settingsRouteAliases';

describe('legacy settings route aliases', () => {
  it('maps the retired route ids to their surviving pages', () => {
    // 全局操作并入高级配置；emby-settings 改名 media-library-settings
    expect(normalizeSettingsSubSectionId('global-actions')).toBe('advanced-settings');
    expect(normalizeSettingsSubSectionId('emby-settings')).toBe('media-library-settings');
  });

  it('keeps the alias table to exactly the two retired ids', () => {
    expect(Object.keys(LEGACY_SETTINGS_SUBSECTION_ALIASES).sort()).toEqual([
      'emby-settings',
      'global-actions',
    ]);
  });

  it('leaves surviving ids and the display-settings special case untouched', () => {
    // display-settings 走 mount 层自身的整页迁移分支（带子标签目标），不入本表
    for (const id of [
      'advanced-settings',
      'media-library-settings',
      'enhancement-settings',
      'display-settings',
    ]) {
      expect(normalizeSettingsSubSectionId(id), id).toBe(id);
    }
  });

  it('tolerates missing values like the React full-page predicate does', () => {
    expect(normalizeSettingsSubSectionId(undefined)).toBe('');
    expect(normalizeSettingsSubSectionId(null)).toBe('');
    expect(normalizeSettingsSubSectionId('')).toBe('');
  });

  it('trims surrounding whitespace before lookup', () => {
    expect(normalizeSettingsSubSectionId('  emby-settings  ')).toBe('media-library-settings');
  });
});
