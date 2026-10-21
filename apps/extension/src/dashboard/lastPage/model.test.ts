/**
 * @file model.test.ts
 * @description 上次页面模型单元测试
 * @module dashboard/lastPage
 */
import { describe, expect, it } from 'vitest';
import {
  buildLastPageRecord,
  normalizeDashboardHash,
  parseLastPageRecord,
  resolveLastPageTitle,
  shouldShowLastPageResume,
} from './model';

describe('dashboard last page model', () => {
  it('normalizes empty hash to default home', () => {
    expect(normalizeDashboardHash('')).toBe('#tab-home');
    expect(normalizeDashboardHash('#')).toBe('#tab-home');
    expect(normalizeDashboardHash('tab-new-works')).toBe('#tab-new-works');
  });

  it('resolves readable titles for nav and settings subpages', () => {
    expect(resolveLastPageTitle('#tab-new-works')).toBe('信息库 · 新作品');
    expect(resolveLastPageTitle('#tab-settings/drive115-settings')).toBe('设置 · 115网盘设置');
    // 媒体库为单入口；旧 hash 子路径（如 jellyfin）规范化后仍解析为「媒体库」
    expect(resolveLastPageTitle('#tab-media')).toBe('媒体库 · 媒体库');
    expect(resolveLastPageTitle('#tab-media/jellyfin')).toBe('媒体库 · 媒体库');
    expect(resolveLastPageTitle('#tab-home')).toBe('首页总览');
  });

  it('only shows resume prompt when last page differs from current', () => {
    const record = buildLastPageRecord('#tab-new-works', 1);
    expect(shouldShowLastPageResume(record, '#tab-home')).toBe(true);
    expect(shouldShowLastPageResume(record, '#tab-new-works')).toBe(false);
    expect(shouldShowLastPageResume(null, '#tab-home')).toBe(false);
  });

  it('parses stored records and rebuilds title when missing', () => {
    expect(parseLastPageRecord({ hash: 'tab-actors' })?.title).toBe('信息库 · 演员库');
    expect(parseLastPageRecord({ foo: 1 })).toBeNull();
    expect(parseLastPageRecord(null)).toBeNull();
  });
});
