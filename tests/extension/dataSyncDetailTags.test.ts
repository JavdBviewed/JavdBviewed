/**
 * @file dataSyncDetailTags.test.ts
 * @description 数据同步详情页标签解析回归测试
 * @module tests/extension
 */
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../../apps/extension/src/dashboard/dataSync/api';
import type { VideoRecord } from '../../apps/extension/src/types';

type ApiClientDetailParser = {
  parseVideoDetailFromHTML(html: string, urlVideoId: string): Partial<VideoRecord> | null;
};

describe('data sync detail tag parsing', () => {
  it('同步想看详情时只保存详情类别区块，不保存列表页默认标签', () => {
    const html = `
      <html>
        <head><title>SSIS-795 测试标题 | JavDB</title></head>
        <body>
          <div class="movie-list">
            <div class="tags">
              <a href="/genres/uncensored">无码</a>
              <a href="/genres/western">欧美</a>
              <a href="/genres/fc2">FC2</a>
              <a href="/genres/anime">动漫</a>
            </div>
          </div>
          <div class="movie-panel-info">
            <div class="panel-block first-block">
              <h2 class="title is-4"><strong>SSIS-795</strong></h2>
            </div>
            <div class="panel-block genre">
              <strong>類別：</strong>
              <span class="value">
                <a href="/tags?c=1">劇情</a>
                <a href="/tags?c=2">中文字幕</a>
              </span>
            </div>
          </div>
        </body>
      </html>
    `;
    const client = new ApiClient() as unknown as ApiClientDetailParser;

    const parsed = client.parseVideoDetailFromHTML(html, 'abc123');

    expect(parsed?.tags).toEqual(['劇情', '中文字幕']);
  });
});
