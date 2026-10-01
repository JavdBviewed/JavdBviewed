/**
 * @file settingsNavModel.test.ts
 * @description 设置导航目录纯函数测试
 * @module apps/dashboard/pages/settings
 */
import { describe, expect, it } from 'vitest';
import {
  filterSettingsNavItems,
  resolveSettingsSubpageMeta,
  SETTINGS_NAV_ITEMS,
  settingsNavHref,
} from './settingsNavModel';

describe('settingsNavModel', () => {
  it('has a stable non-empty catalog including the media library and update entries', () => {
    expect(SETTINGS_NAV_ITEMS.length).toBeGreaterThanOrEqual(10);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.id === 'media-library-settings')).toBe(true);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.id === 'update-settings')).toBe(true);
  });

  it('drops the global-actions card after merging it into advanced settings', () => {
    // 2026-10-03 IA 裁决：全局操作三区块并入高级配置页，设置索引少一张卡
    // 2026-10-03 252 线新增 new-works-settings 卡：14→15
    expect(SETTINGS_NAV_ITEMS).toHaveLength(15);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.id === 'global-actions')).toBe(false);
    const advanced = SETTINGS_NAV_ITEMS.find((i) => i.id === 'advanced-settings');
    expect(advanced?.title).toBe('高级配置');
    expect(advanced?.description).toBe('原始配置编辑与全局数据操作');
    expect(
      filterSettingsNavItems(SETTINGS_NAV_ITEMS, '全局').some((i) => i.id === 'advanced-settings'),
    ).toBe(true);
  });

  it('renames the emby card to media-library-settings with the media library copy', () => {
    // 2026-10-03 IA 裁决：emby-settings → media-library-settings，零数据迁移
    expect(SETTINGS_NAV_ITEMS.some((i) => i.id === 'emby-settings')).toBe(false);
    const card = SETTINGS_NAV_ITEMS.find((i) => i.id === 'media-library-settings');
    expect(card?.title).toBe('媒体库设置');
    expect(card?.description).toBe('Emby/Jellyfin 媒体服务器配置');
    expect(card?.icon).toBe('fa-film');
    expect(card?.beta).toBe(true);
  });

  it('builds settings hash', () => {
    expect(settingsNavHref('enhancement-settings')).toBe('#tab-settings/enhancement-settings');
  });

  it('drops the display-settings entry after the IA migration', () => {
    // 2026-09-27 IA 裁决：显示设置整页迁入功能增强 · 列表页增强，入口卡片随之移除
    expect(SETTINGS_NAV_ITEMS.some((i) => i.id === 'display-settings')).toBe(false);
  });

  it('filters by title description or id', () => {
    const hits = filterSettingsNavItems(SETTINGS_NAV_ITEMS, 'webdav');
    expect(hits.some((i) => i.id === 'webdav-settings')).toBe(true);
    expect(filterSettingsNavItems(SETTINGS_NAV_ITEMS, '不存在的词')).toEqual([]);
  });

  it('includes cloud multi-end sync entry distinct from webdav backup', () => {
    expect(SETTINGS_NAV_ITEMS.some((i) => i.id === 'cloud-settings')).toBe(true);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.id === 'webdav-settings')).toBe(true);
    const cloudHits = filterSettingsNavItems(SETTINGS_NAV_ITEMS, 'cloud');
    expect(cloudHits.some((i) => i.id === 'cloud-settings')).toBe(true);
  });
});
