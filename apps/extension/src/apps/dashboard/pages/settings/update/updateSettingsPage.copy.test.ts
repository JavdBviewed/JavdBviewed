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

  it('展示 JavScribe 已上线产品入口（系列产品第 5 张卡，指向 GitHub 仓库）', () => {
    const productsSection = source.slice(
      source.indexOf('id={UPDATE_SECTION_IDS.products}'),
      source.indexOf('id={UPDATE_SECTION_IDS.community}'),
    );
    expect(productsSection).toContain('JavScribe');
    expect(productsSection).toContain('data-product="javscribe"');
    expect(productsSection).toContain('href="https://github.com/JavdBviewed/JavScribe"');
    expect(productsSection).toContain('target="_blank"');
    expect(productsSection).toContain('rel="noopener noreferrer"');
    expect(productsSection).toContain('JAV 视频字幕自动生成（ja→zh，.zh.srt 原位落位）');
    expect(productsSection).toContain('已上线');
    // 卡片总数 5 张，既有 4 卡顺序与文案零改动
    expect((productsSection.match(/className="flex min-h-\[74px\]/g) ?? [])).toHaveLength(5);
    const order = ['浏览器扩展', 'JavdBviewed Cloud', '桌面端', 'Android', 'JavScribe'];
    const positions = order.map((name) => productsSection.indexOf(name));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
    // 新卡是唯一带 data-product 标记的产品卡（其余 4 卡未被顺手改造）
    expect((productsSection.match(/data-product="/g) ?? [])).toHaveLength(1);
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

  it('遥测数据区块：只展示示例 body 与说明文案，无事件分类/地址/重新生成/复制', () => {
    expect(source).toContain('遥测数据');
    expect(source).toContain('update-section-telemetry');
    expect(source).toContain("label: '遥测数据'");
    expect(source).toContain('shortLabel: \'遥测\'');
    expect(source).toContain('toggleTelemetryPayload');
    expect(source).toContain('telemetryPayloadBody');
    expect(source).toContain('telemetryPayloadPanel');
    expect(source).toContain('aria-expanded');
    expect(source).toContain('展开查看上报数据');
    expect(source).toContain('telemetryPurposeNote');
    expect(source).toContain('telemetryDeviceIdNote');
    expect(source).toContain('telemetryPayloadStatus');
    expect(source).toContain('telemetryPayloadMeta');
    expect(source).toContain('TELEMETRY_PURPOSE_NOTE');
    expect(source).toContain('TELEMETRY_DEVICE_ID_NOTE');
    expect(source).toContain('TELEMETRY_DATA_INCLUDED_ITEMS');
    expect(source).toContain('TELEMETRY_DATA_EXCLUDED_ITEMS');
    expect(source).toContain('mapTelemetryViewFromSettings');
    expect(source).toContain('loadTelemetryPreview');
    expect(source).toContain("loadTelemetryPayload('heartbeat')");
    // 展开前不渲染 body 内容，展开后等宽完整展示
    expect(source).toContain('font-mono');
    // 简化：前端不写上报地址、不区分上报事件类别、不提供重新生成与复制
    expect(source).not.toContain('复制 JSON');
    expect(source).not.toContain('重新生成');
    expect(source).not.toContain('copyTelemetryPayloadJson');
    expect(source).not.toContain('telemetryViewerEvent');
    expect(source).not.toContain('telemetryViewerEndpoint');
    expect(source).not.toContain('formatTelemetryPreviewTime');
    expect(source).not.toContain('上报地址');
    expect(source).toMatch(/共\{' '\}/);
    expect(source).not.toMatch(/启动上报|心跳上报|错误上报/);
  });

  it('遥测区块不出现误导性的关闭承诺，也不触碰真实上报与状态写入', () => {
    // 2026-10-03 10-11 线：上报恒启用，页面不得残留指向关闭开关的指引句
    expect(source).not.toContain('上报开关在「高级设置 · 使用情况统计」');
    // 查看器只读展示：不得在页面里发送遥测或写客户端状态
    expect(source).not.toContain('sendTelemetry');
    expect(source).not.toContain('getTelemetryClientState');
    expect(source).not.toContain('writeTelemetryClientState');
    expect(source).not.toContain('buildTelemetryReportUrl');
  });

  it('不为尚未发布的桌面端和 Android 提供假下载链接', () => {
    expect(source).not.toContain('桌面端下载');
    expect(source).not.toContain('Android 下载');
  });
});
