import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'UpdateSettingsPage.tsx'), 'utf-8');

describe('UpdateSettingsPage 产品入口', () => {
  it('按系列产品展示当前使用、测试中和开发中的客户端', () => {
    expect(source).toContain('JavdBviewed 系列产品');
    expect(source).toContain('浏览器扩展');
    expect(source).toContain('JavdBviewed Cloud');
    expect(source).toContain('桌面端');
    expect(source).toContain('Android');
    expect(source).toContain('当前使用');
    expect(source).toContain('测试中');
    expect(source).toContain('开发中');
  });

  it('为项目提供 GitHub Star 支持入口', () => {
    expect(source).toContain('喜欢这个项目？欢迎在 GitHub 点个 Star 支持我们');
    expect(source).toContain('data-product-support="star"');
    expect(source).toContain('给项目一个 Star');
  });

  it('uses the shared floating section navigation for every update page group', () => {
    expect(source).toContain("from '../shared/SettingsSectionNav'");
    expect(source).toContain('UPDATE_SECTION_NAV_ITEMS');
    expect(source).toContain('sectionNavItems={UPDATE_SECTION_NAV_ITEMS}');
    expect(source).toContain('update-section-version');
    expect(source).toContain('update-section-automatic');
    expect(source).toContain('update-section-products');
    expect(source).toContain('update-section-community');
    expect(source).toContain('update-section-details');
  });

  it('提供 Cloud 部署文档，并拆出社区与文档入口', () => {
    expect(source).toContain('https://docs.we-together.club/download/#cloud-deploy');
    expect(source).toContain('社区与文档');
    expect(source).toContain('https://github.com/JavdBviewed/JavdBviewed');
    expect(source).toContain('https://t.me/javdbviewed');
    expect(source).toContain('https://docs.we-together.club/');
  });

  it('不为尚未发布的桌面端和 Android 提供假下载链接', () => {
    expect(source).not.toContain('桌面端下载');
    expect(source).not.toContain('Android 下载');
  });
});
