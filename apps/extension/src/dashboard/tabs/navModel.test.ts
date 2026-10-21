/**
 * @file navModel.test.ts
 * @description Dashboard 9C 导航模型测试
 * @module dashboard/tabs
 */
import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_NAV_GROUPS,
  buildDashboardNavHash,
  getDefaultNavState,
  resolveDashboardNavState,
} from './navModel';

describe('Dashboard 9C navigation model', () => {
  it('defines the accepted top-level groups with full second-level labels', () => {
    expect(DASHBOARD_NAV_GROUPS.map(group => group.label)).toEqual([
      '首页',
      '信息库',
      '媒体库',
      '任务与备份',
      '报告与日志',
      '设置',
    ]);

    const library = DASHBOARD_NAV_GROUPS.find(group => group.id === 'library');
    expect(library?.items.map(item => item.label)).toEqual([
      '番号库',
      '演员库',
      '新作品',
      '收藏中心',
      '回收站',
    ]);

    const analysis = DASHBOARD_NAV_GROUPS.find(group => group.id === 'analysis');
    expect(analysis?.items.map(item => item.label)).toEqual(['报告', '日志']);

    const sync = DASHBOARD_NAV_GROUPS.find(group => group.id === 'sync');
    expect(sync?.defaultItemId).toBe('sync');
    expect(sync?.items.map(item => item.label)).toEqual(['数据同步', '115任务', '备份与恢复']);
  });

  it('resolves old direct tab hashes to the correct group and item', () => {
    expect(resolveDashboardNavState('#tab-records')).toMatchObject({
      groupId: 'library',
      itemId: 'records',
      tabId: 'tab-records',
    });

    expect(resolveDashboardNavState('#tab-drive115-tasks')).toMatchObject({
      groupId: 'sync',
      itemId: 'drive115-tasks',
      tabId: 'tab-drive115-tasks',
    });

    expect(resolveDashboardNavState('#tab-backup')).toMatchObject({
      groupId: 'sync',
      itemId: 'backup',
      tabId: 'tab-backup',
    });

    expect(resolveDashboardNavState('#tab-insights')).toMatchObject({
      groupId: 'analysis',
      itemId: 'insights',
      tabId: 'tab-insights',
    });

    expect(resolveDashboardNavState('#tab-logs')).toMatchObject({
      groupId: 'analysis',
      itemId: 'logs',
      tabId: 'tab-logs',
    });
  });

  it('resolves media source hashes to the single media entry while keeping the source subpath', () => {
    expect(resolveDashboardNavState('#tab-media/emby')).toEqual({
      groupId: 'media',
      itemId: 'media-library',
      tabId: 'tab-media',
      subPath: 'emby',
    });

    expect(resolveDashboardNavState('#tab-media')).toEqual({
      groupId: 'media',
      itemId: 'media-library',
      tabId: 'tab-media',
    });

    expect(buildDashboardNavHash({ tabId: 'tab-media', subPath: 'jellyfin' })).toBe('#tab-media/jellyfin');
  });

  it('keeps settings subpage hashes under the settings group', () => {
    expect(resolveDashboardNavState('#tab-settings/drive115-settings')).toEqual({
      groupId: 'settings',
      itemId: 'settings-center',
      tabId: 'tab-settings',
      subPath: 'drive115-settings',
    });
  });

  it('falls back to the home overview state for empty or unknown hashes', () => {
    expect(resolveDashboardNavState('')).toEqual(getDefaultNavState());
    expect(resolveDashboardNavState('#unknown-tab')).toEqual(getDefaultNavState());
  });
});
