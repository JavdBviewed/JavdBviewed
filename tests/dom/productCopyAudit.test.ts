/**
 * @file productCopyAudit.test.ts
 * @description 用户可见文案巡检回归测试
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const auditedFiles = [
  'apps/extension/src/apps/dashboard/pages/media/MediaLibraryPage.tsx',
  'apps/extension/src/dashboard/tabs/insights/samplePreviewModel.ts',
  'apps/extension/src/dashboard/tabs/insights/reportExportModel.ts',
  'apps/extension/src/dashboard/tabs/insights/reportGenerationModel.ts',
  'apps/extension/src/dashboard/tabs/settings/sync/SyncSettings.ts',
];

function readAuditedSource(): string {
  return auditedFiles
    .map(file => readFileSync(resolve(process.cwd(), file), 'utf8'))
    .join('\n');
}

describe('product copy audit', () => {
  it('keeps internal task wording out of audited user-visible copy', () => {
    const source = readAuditedSource();

    expect(source).not.toContain('当前页面不会读取');
    expect(source).not.toContain('避免用户误以为');
    expect(source).not.toContain('先把入口放出来');
    expect(source).not.toContain('真实报告会');
    expect(source).not.toContain('AI 文案');
    expect(source).not.toContain('（占位）');
    expect(source).not.toContain('该导出为占位');
    expect(source).not.toContain('解析测试功能正在开发中');
  });

  it('uses product-side guidance for preview and pending surfaces', () => {
    const source = readAuditedSource();

    expect(source).toContain('媒体库');
    // 媒体库首次使用引导应明确告诉用户下一步，而不是暴露内部预览实现。
    expect(source).toContain('尚未同步媒体库');
    expect(source).toContain('生成自己的月报时');
    expect(source).toContain('Markdown 导出还在整理中，目前可先导出 HTML 报告');
    expect(source).toContain('解析测试暂未开放');
  });
});
