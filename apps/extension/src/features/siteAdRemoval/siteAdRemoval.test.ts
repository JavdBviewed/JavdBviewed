/**
 * @file siteAdRemoval.test.ts
 * @description 去除原站广告：归一化/回填/CSS 生成 单测
 * @module features/siteAdRemoval
 */
import { describe, expect, it } from 'vitest';

import {
  backfillSiteAdRemovalSettings,
  buildSiteAdRemovalCss,
  normalizeSiteAdRemovalSettings,
} from './index';

describe('normalizeSiteAdRemovalSettings', () => {
  it('defaults: 主开关/推广按钮默认开，额外广告位默认关', () => {
    expect(normalizeSiteAdRemovalSettings(undefined)).toEqual({
      enabled: true,
      removePromoButtons: true,
      removeExtraAds: false,
    });
    expect(normalizeSiteAdRemovalSettings(null)).toEqual({
      enabled: true,
      removePromoButtons: true,
      removeExtraAds: false,
    });
    expect(normalizeSiteAdRemovalSettings({})).toEqual({
      enabled: true,
      removePromoButtons: true,
      removeExtraAds: false,
    });
  });

  it('preserves explicit user values', () => {
    expect(
      normalizeSiteAdRemovalSettings({ enabled: false, removePromoButtons: false, removeExtraAds: true }),
    ).toEqual({
      enabled: false,
      removePromoButtons: false,
      removeExtraAds: true,
    });
  });
});

describe('backfillSiteAdRemovalSettings（裁决 2026-09-26 方案 a：默认开）', () => {
  it('存量数据无 siteAdRemoval 键且无 magnetSearch → 回填 enabled=true（钉死断言）', () => {
    expect(backfillSiteAdRemovalSettings({})).toEqual({
      siteAdRemoval: { enabled: true, removePromoButtons: true, removeExtraAds: false },
    });
  });

  it('存量数据无 siteAdRemoval 键但磁力开着（未动过子开关）→ 回填 enabled=true（行为不回归）', () => {
    expect(
      backfillSiteAdRemovalSettings({ userExperience: { enableMagnetSearch: true } }),
    ).toEqual({
      siteAdRemoval: { enabled: true, removePromoButtons: true, removeExtraAds: false },
    });
  });

  it('存量数据显式关过 blockMojContent === false → 回填 enabled=false', () => {
    expect(
      backfillSiteAdRemovalSettings({ magnetSearch: { blockMojContent: false } }),
    ).toEqual({
      siteAdRemoval: { enabled: false, removePromoButtons: true, removeExtraAds: false },
    });
  });

  it('存量数据显式 blockMojContent === true → 回填 enabled=true', () => {
    expect(
      backfillSiteAdRemovalSettings({ magnetSearch: { blockMojContent: true } }),
    ).toEqual({
      siteAdRemoval: { enabled: true, removePromoButtons: true, removeExtraAds: false },
    });
  });

  it('已有 siteAdRemoval 键 → 返回 null（幂等，不覆盖用户已保存值）', () => {
    expect(
      backfillSiteAdRemovalSettings({ siteAdRemoval: { enabled: false }, magnetSearch: { blockMojContent: true } }),
    ).toBeNull();
  });

  it('stored 为 null/undefined → 返回 null', () => {
    expect(backfillSiteAdRemovalSettings(null)).toBeNull();
    expect(backfillSiteAdRemovalSettings(undefined)).toBeNull();
  });
});

describe('buildSiteAdRemovalCss', () => {
  it('主开关关 → 空串（不产生任何样式）', () => {
    expect(buildSiteAdRemovalCss({ enabled: false, removePromoButtons: true, removeExtraAds: true })).toBe('');
  });

  it('主开关开（默认子开关）→ .moj-content 隐藏 + 塌缩兜底 + 推广按钮 CSS', () => {
    const css = buildSiteAdRemovalCss({ enabled: true, removePromoButtons: true, removeExtraAds: false });
    expect(css).toContain('.moj-content');
    expect(css).toContain('display: none !important');
    expect(css).toContain('.top-meta .moj-content');
    expect(css).toContain('a[href*="app.javdb"]');
    expect(css).toContain('a[href*="t.me/javdbnews"]');
    // 额外广告位默认关：不出现
    expect(css).not.toContain('.sub-header');
    expect(css).not.toContain('.app-desktop-banner');
  });

  it('主开关开 → 磁力区推广块 #magnets-content .sda-content 一并隐藏（批 0 定案：归主开关，scoped 保守口径）', () => {
    const css = buildSiteAdRemovalCss({ enabled: true, removePromoButtons: true, removeExtraAds: false });
    expect(css).toContain('#magnets-content .sda-content');
    expect(css).toMatch(/#magnets-content \.sda-content \{\s*display: none !important;\s*\}/);
  });

  it('主开关关 → 磁力区推广块选择器不出现（CSS 为空串）', () => {
    const css = buildSiteAdRemovalCss({ enabled: false, removePromoButtons: true, removeExtraAds: false });
    expect(css).toBe('');
  });

  it('removeExtraAds 开 → 追加 .sub-header 与 .app-desktop-banner', () => {
    const css = buildSiteAdRemovalCss({ enabled: true, removePromoButtons: false, removeExtraAds: true });
    expect(css).toContain('.sub-header');
    expect(css).toContain('.app-desktop-banner');
    // 推广按钮子开关关：不出现
    expect(css).not.toContain('app.javdb');
    expect(css).toContain('.moj-content');
  });
});
