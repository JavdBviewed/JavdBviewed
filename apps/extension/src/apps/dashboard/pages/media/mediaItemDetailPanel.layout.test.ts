/**
 * @file mediaItemDetailPanel.layout.test.ts
 * @description 自建媒体服务器详情入口与相关作品交互回归
 * @module apps/dashboard/pages/media
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'MediaItemDetailPanel.tsx'), 'utf8');
const css = readFileSync(join(here, 'mediaItemDetail.css'), 'utf8');

describe('MediaItemDetailPanel 自建媒体服务器入口', () => {
  it('为 Emby/Jellyfin 详情提供新标签页打开入口', () => {
    expect(source).toContain('buildServerOpenUrl');
    expect(source).toContain('data-media-external-server-link="1"');
    expect(source).toContain('target="_blank"');
    expect(source).toContain('在媒体服务器中打开');
    expect(css).toContain('.ml-detail-btn-link');
  });

  it('相关作品点击优先打开扩展详情，没有回调时回退到媒体服务器网页', () => {
    expect(source).toContain('if (onOpenItem)');
    expect(source).toContain('detail?.serverUrl || detailServerUrl');
    expect(source).toContain('data-media-related-item="1"');
  });
});
