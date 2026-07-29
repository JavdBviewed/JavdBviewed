/**
 * @file mediaLibraryPage.layout.test.ts
 * @description 媒体库页布局/行为回归：索引变更实时刷新
 * @module apps/dashboard/pages/media
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'MediaLibraryPage.tsx'), 'utf-8');

describe('MediaLibraryPage 实时刷新', () => {
  it('订阅 chrome.storage.onChanged 以在索引写入后刷新目录', () => {
    expect(source).toContain('chrome.storage.onChanged.addListener');
    expect(source).toContain('chrome.storage.onChanged.removeListener');
  });

  it('监听 115 与 Emby 本地库状态键', () => {
    expect(source).toContain('STORAGE_KEYS.DRIVE115_LIBRARY_STATE');
    expect(source).toContain('STORAGE_KEYS.EMBY_LIBRARY_STATE');
  });

  it('变更回调走防抖后调用目录刷新', () => {
    // 防抖 setTimeout + 复用既有 reloadCatalogFromStorage
    expect(source).toMatch(/setTimeout\([\s\S]*reloadCatalogFromStorage/);
    expect(source).toContain('clearTimeout');
  });

  it('仅响应 local 区且命中监听键', () => {
    expect(source).toContain("areaName !== 'local'");
    expect(source).toContain('watchedKeys.some');
  });
  it('shows actionable 115 metadata states instead of silently swallowing missing cover/NFO', () => {
    const detailSource = readFileSync(join(here, 'MediaItemDetailPanel.tsx'), 'utf-8');
    expect(detailSource).toContain('setNfo115Error');
    expect(detailSource).toContain('该条目没有可解析的 NFO');
    expect(detailSource).toContain('索引中没有发现封面文件');
    expect(detailSource).not.toContain('.catch(() => {})');
  });

  it('renders 115 NFO metadata through the same card-style detail block as server metadata', () => {
    const detailSource = readFileSync(join(here, 'MediaItemDetailPanel.tsx'), 'utf-8');
    const detailCss = readFileSync(join(here, 'mediaItemDetail.css'), 'utf-8');
    expect(detailSource).toContain('data-detail-info-card="1"');
    expect(detailSource).toContain('NFO 信息');
    expect(detailSource).toContain('基础信息');
    expect(detailSource).toContain('infoRows.length > 0');
    expect(detailCss).toContain('.ml-detail-info-card');
    expect(detailCss).toContain('.ml-detail-info-grid');
  });

  it('routes 115 playback through the shared overlay MediaPlayer instead of an inline video', () => {
    const panelSource = readFileSync(join(here, 'Media115PlayPanel.tsx'), 'utf-8');
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(panelSource).toContain('onStreamReady');
    expect(panelSource).not.toContain('<video');
    expect(source).toContain('drive115Stream');
    expect(source).toContain('closeDrive115Player');
    expect(source).toContain('data-media-115-play-overlay="1"');
    expect(source).toContain('crossOrigin={null}');
    expect(source).toContain('play115StartTimeRef');
    expect(source).toContain('startTimeSeconds={drive115Stream.startTimeSeconds}');
    expect(source).toContain('title="115 播放"');
    expect(mediaCss).not.toContain('.ml-115-video');
  });

  it('keeps 115 playback status inside panel/toast instead of media toolbar', () => {
    const panelSource = readFileSync(join(here, 'Media115PlayPanel.tsx'), 'utf-8');
    expect(source).toContain('librarySyncMessage');
    expect(source).not.toContain('setSyncMessage');
    expect(source).not.toMatch(/setLibrarySyncMessage\([^)]*stream\.message/);
    expect(source).toContain("void toast(stream.message, 'info')");
    expect(panelSource).toContain('className="ml-115-msg"');
    expect(panelSource).toContain('\u5df2\u901a\u8fc7\u7d22\u5f15 pick_code \u83b7\u53d6\u64ad\u653e\u5730\u5740\uff0c\u6b63\u5728\u6253\u5f00\u64ad\u653e\u5668\u2026');
  });


});
