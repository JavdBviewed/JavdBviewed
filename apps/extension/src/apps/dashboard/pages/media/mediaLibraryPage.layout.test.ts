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
    expect(source).toContain('STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS');
  });

  it('监听本地观看证据变化以刷新 115 续看和所有卡片进度', () => {
    expect(source).toContain('STORAGE_KEYS.MEDIA_WATCH_EVIDENCE');
    expect(source).toContain('reportDrive115Evidence');
    expect(source).toContain('await reportDrive115Evidence');
  });

  it('stores 115 playback progress under the catalog code and keeps no-duration resume evidence', () => {
    expect(source).toContain('resolveDrive115PlaybackItem');
    expect(source).toContain('normalizeVideoCodeCandidate(stream.query || candidate.fileName || \'\')');
    expect(source).toContain('const code = matchedItem?.code || extractedCode');
    expect(source).toContain('parseDrive115RuntimeSeconds');
    expect(source).toContain('if (streamSnap && (duration > 0 || position > 0))');
    expect(source).not.toContain('if (duration <= 0) return;\n\n    if (info.ended)');
  });

  it('变更回调走防抖后调用目录刷新', () => {
    // 防抖调度 + 复用既有 reloadCatalogFromStorage
    expect(source).toMatch(/setTimeout\([\s\S]*reloadCatalogFromStorage/);
    expect(source).toContain('clearTimeout');
    expect(source).toContain('catalogReloadInFlightRef');
    expect(source).toContain('pendingDrive115CatalogRefreshRef');
  });

  it('does not map a complete media index twice just to check whether it is empty', () => {
    expect(source).not.toContain('hasLibraryIndex(state) ? mapLibraryStateToBrowseItems(state)');
    expect(source).not.toContain('hasDrive115LibraryIndex(drive115State)');
    expect(source).toContain('const embyItems = mapLibraryStateToBrowseItems(state)');
    expect(source).toContain('const drive115Items = mapDrive115LibraryStateToBrowseItems(drive115State');
  });

  it('defers watch-evidence catalog rebuilds while a player is open', () => {
    expect(source).toContain('const playbackActive = Boolean(embyStreamRef.current || drive115StreamRef.current)');
    expect(source).toContain('pendingCatalogReloadRef.current = true');
  });

  it('仅响应 local 区且命中监听键', () => {
    expect(source).toContain("areaName !== 'local'");
    expect(source).toContain('watchedKeys.some');
    expect(source).toContain('if (settingsChanged)');
    expect(source).toContain('reloadSyncTargetsFromSettings');
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

  it('keeps self-hosted media-server details ahead of 115 NFO fallback metadata', () => {
    const detailSource = readFileSync(join(here, 'MediaItemDetailPanel.tsx'), 'utf-8');
    expect(detailSource).toContain('getPreferredDetailSourceCopy');
    expect(detailSource).toContain('is115Detail');
    expect(detailSource).toContain("if (!is115Detail) return undefined;");
  });

  it('shows every aggregated physical copy in the detail window', () => {
    const detailSource = readFileSync(join(here, 'MediaItemDetailPanel.tsx'), 'utf-8');
    const detailCss = readFileSync(join(here, 'mediaItemDetail.css'), 'utf-8');
    expect(detailSource).toContain('data-media-source-copies="1"');
    expect(detailSource).toContain('可用来源');
    expect(detailSource).toContain('item.copies');
    expect(detailCss).toContain('.ml-detail-copy-list');
  });

  it('shows a compact source count on cards with multiple physical copies', () => {
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('data-media-copy-count');
    expect(source).toContain('const hasMultipleSources = sourceCopyCount > 1');
    expect(source).toContain('个来源');
    expect(mediaCss).toContain('.ml-card-copy-count');
  });

  it('keeps vertical wheel scrolling chained to the detail overlay over horizontal rows', () => {
    const detailCss = readFileSync(join(here, 'mediaItemDetail.css'), 'utf-8');
    const scrollerSource = readFileSync(join(here, 'useHorizontalScroller.ts'), 'utf-8');
    expect(detailCss).toContain('overscroll-behavior-y: auto;');
    expect(detailCss).not.toContain('overscroll-behavior-y: none;');
    expect(scrollerSource).toContain('if (e.shiftKey && absY > 0)');
    expect(scrollerSource).toContain('普通竖向滚轮：完全不拦截');
    expect(scrollerSource).toContain("closest('button,a,[role=button],input,select,textarea')");
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
    expect(source).not.toContain('librarySyncMessage');
    expect(source).not.toContain('setSyncMessage');
    expect(source).not.toMatch(/setLibrarySyncMessage\([^)]*stream\.message/);
    expect(source).toContain("void toast(stream.message, 'info')");
    expect(panelSource).toContain('className="ml-115-msg"');
    expect(panelSource).toContain('\u5df2\u901a\u8fc7\u7d22\u5f15 pick_code \u83b7\u53d6\u64ad\u653e\u5730\u5740\uff0c\u6b63\u5728\u6253\u5f00\u64ad\u653e\u5668\u2026');
  });

  it('uses a persistent toast for media sync feedback instead of toolbar inline text', () => {
    expect(source).toContain('showPersistentMessage');
    expect(source).toContain('正在同步 ${selectedTargets.length} 个媒体来源…');
    expect(source).not.toContain('ml-sync-msg-inline');
  });

  it('renders Emby-style card overlay with progress and corner actions', () => {
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('className="ml-card-overlay"');
    expect(source).toContain('className="ml-card-overlay-play"');
    expect(source).toContain('className="ml-card-overlay-actions"');
    expect(source).toContain('在 115 搜索并播放');
    expect(source).toContain('ml-card-overlay-icon-text');
    expect(source).toContain('className="ml-card-progress"');
    expect(source).toContain('data-card-size={viewSettings.cardSize}');
    expect(mediaCss).toContain('.ml-card-overlay');
    expect(mediaCss).toContain('.ml-card-overlay-icon-text');
    expect(mediaCss).toContain('.ml-card-progress-fill');
    expect(mediaCss).toContain('.ml-card:focus-within .ml-card-overlay');
  });

  it('keeps progress bars on every media card while excluding hero cards', () => {
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('className="ml-card-progress"');
    expect(source).toContain('progressBarPercent');
    expect(source).not.toMatch(/ml-hero[\s\S]{0,160}ml-card-progress/);
    expect(mediaCss).toContain('.ml-card-progress');
    expect(mediaCss).not.toContain('.ml-hero-progress');
  });

  it('resolves 115 covers in continue watching cards with the same lazy cover hook as grid cards', () => {
    expect(source).toContain('function ResumeMediaCard');
    expect(source).toContain('d115ResumeCoverRef');
    expect(source).toContain('d115ResumeCover');
    expect(source).toContain('ref={d115ResumeCoverRef}');
    expect(source).toContain("item.source === '115' && d115ResumeCover ? d115ResumeCover : resumeCover");
  });

  it('keeps the card surface as the detail entry and reserves more for actions', () => {
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('className="ml-card-hit"');
    expect(source).toContain('onClick={() => onOpenDetail?.(item)}');
    expect(source).toContain('setShowActionMenu(true)');
    expect(source).toContain('title="更多操作"');
    expect(source).not.toContain('title="更多"\n              aria-label="更多"\n              onClick={(e) => {\n                e.preventDefault();\n                e.stopPropagation();\n                onOpenDetail?.(item);');
    expect(mediaCss).toContain('pointer-events: none;');
    expect(mediaCss).toContain('.ml-card-overlay button');
    expect(mediaCss).toContain('pointer-events: auto;');
  });

  it('adds an Emby-like media view settings dialog for card fields', () => {
    expect(source).toContain('showViewSettings');
    expect(source).toContain('title="视图设置"');
    expect(source).toContain('卡片外观');
    expect(source).toContain('显示内容');
    expect(source).toContain('图像大小');
    expect(source).toContain('恢复默认');
    expect(source).toContain('完成');
    expect(source).toContain('resetMediaViewSettings');
    expect(source).toContain('writeMediaViewSettings');
    expect(source).toContain('DEFAULT_MEDIA_VIEW_FIELDS');
  });

  it('uses a compact media command bar with clear summary and view copy', () => {
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('className="ml-view-shell"');
    expect(source).toContain('className="ml-view-summary"');
    expect(source).toContain('className="ml-view-controls"');
    expect(source).toContain('className="ml-view-command-group"');
    expect(source).toContain('视图');
    expect(source).toContain('同步媒体库与播放状态');
    expect(source).toContain('同步媒体库');
    expect(source).toContain('媒体库工具');
    expect(source).toContain('115 手动播放');
    expect(source).toContain('已看影片整理');
    expect(source).not.toContain('title="从本地索引刷新列表"');
    expect(source).not.toContain('title="打开 115 播放面板"');
    expect(source).not.toContain('title="打开/关闭 115 清理清单"');
    expect(source).not.toContain('媒体库同步说明');
    expect(mediaCss).toContain('.ml-view-shell');
    expect(mediaCss).toContain('.ml-view-summary');
    expect(mediaCss).toContain('.ml-view-command-group');
    expect(mediaCss).toContain('.ml-command-panel');
    expect(mediaCss).toContain('.ml-command-panel-item');
    expect(mediaCss).toContain('.ml-view-settings-footer');
  });

  it('renders the media grid progressively instead of mounting every card at once', () => {
    const gridSource = readFileSync(join(here, 'ProgressiveMediaGrid.tsx'), 'utf-8');
    expect(source).toContain('ProgressiveMediaGrid');
    expect(source).not.toMatch(/<div className="ml-grid"[\s\S]{0,400}\{list\.map\(/);
    expect(gridSource).toContain('index < visibleCount');
    expect(gridSource).toContain('IntersectionObserver');
    expect(gridSource).toContain('PROGRESSIVE_MEDIA_BATCH_SIZE');
    expect(gridSource).toContain('priorityItem');
  });

  it('exposes the unbounded carousel step for stable transition diagnostics', () => {
    expect(source).toContain('data-hero-step={heroStep}');
    expect(source).toContain('window.setTimeout(() =>');
    expect(source).toContain('}, [heroStep, heroes.length]);');
  });

  it('uses the 115 cover loader for carousel items instead of only static metadata', () => {
    expect(source).toContain('MediaHeroCard');
    expect(source).toContain('useDrive115Cover(item)');
    expect(source).toContain('d115HeroCover');
  });

  it('renders source filters from configured media channels instead of fixed source types', () => {
    expect(source).toContain('buildMediaSourceChannels');
    expect(source).toContain('sourceChannels.map');
    expect(source).toContain('channel.label');
    expect(source).not.toContain('const FILTERS:');
    expect(source).not.toContain("{ id: 'emby', label: 'Emby' }");
    expect(source).not.toContain("{ id: 'jellyfin', label: 'Jellyfin' }");
  });


  it('opens media tools in an overlay panel instead of a toolbar dropdown', () => {
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('showToolsPanel');
    expect(source).toContain('title="媒体库工具"');
    expect(source).toContain('data-media-tools-panel="1"');
    expect(source).toContain('115 手动播放');
    expect(source).toContain('已看影片整理');
    expect(source).not.toContain('showMediaTools');
    expect(source).not.toContain('mediaToolWrapRef');
    expect(source).not.toContain("document.addEventListener('pointerdown'");
    expect(source).not.toContain('data-media-tool-menu');
    expect(source).not.toContain('data-media-tool-trigger');
    expect(mediaCss).toContain('.ml-command-panel');
    expect(mediaCss).toContain('.ml-command-panel-list');
    expect(mediaCss).toContain('.ml-command-panel-item');
    expect(mediaCss).not.toContain('.ml-tool-wrap');
    expect(mediaCss).not.toContain('.ml-tool-menu');
  });

  it('opens watched media organizer with scanning, user-facing tabs, and safe confirmation', () => {
    const cleanupSource = readFileSync(join(here, 'MediaCleanupPanel.tsx'), 'utf-8');
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('title="已看影片整理"');
    expect(source).toContain('data-media-cleanup-overlay="1"');
    expect(source).toContain('onScan={scanWatchedMedia}');
    expect(cleanupSource).toContain('查找已看影片');
    expect(cleanupSource).toContain('待处理');
    expect(cleanupSource).toContain('处理失败');
    expect(cleanupSource).toContain('操作记录');
    expect(cleanupSource).toContain('删除选中的文件');
    expect(cleanupSource).toContain('data-media-cleanup-card="1"');
    expect(cleanupSource).toContain('选择 ${item.code} 的全部来源文件');
    expect(cleanupSource).toContain('本页全选');
    expect(cleanupSource).toContain('已看影片整理分页');
    expect(cleanupSource).toContain('115 文件会移入回收站');
    expect(cleanupSource).toContain('本地媒体文件可能被直接删除');
    expect(cleanupSource).toContain('确认删除');
    expect(cleanupSource).not.toContain('window.confirm');
    expect(cleanupSource).not.toContain('跨来源清理');
    expect(cleanupSource).not.toContain('真实已看');
    expect(cleanupSource).not.toContain('副本');
    expect(mediaCss).toContain('.ml-cleanup-scan-card');
    expect(mediaCss).toContain('.ml-cleanup-card-grid');
    expect(mediaCss).toContain('.ml-cleanup-card');
  });

  it('supports all-source and multi-selected Emby/Jellyfin/115 synchronization', () => {
    const mediaCss = readFileSync(join(here, 'mediaPage.css'), 'utf-8');
    expect(source).toContain('MediaSyncTarget');
    expect(source).toContain('syncTargets');
    expect(source).toContain('selectedSyncTargetKeys');
    expect(source).toContain('showSyncPanel');
    expect(source).toContain('title="同步媒体库"');
    expect(source).toContain('data-media-sync-panel="1"');
    expect(source).toContain('同步全部来源');
    expect(source).toContain('同步已选来源（');
    expect(source).toContain('serverIds');
    expect(source).toContain('rootCids');
    expect(source).toContain('DRIVE115_MEDIA_LIBRARY_INDEX');
    expect(source).toContain('type="checkbox"');
    expect(source).toContain('全选');
    expect(source).not.toContain('只同步某一个 Emby/Jellyfin 服务器');
    expect(source).not.toContain('showSyncMenu');
    expect(source).not.toContain('syncMenuWrapRef');
    expect(source).not.toContain('data-media-sync-menu');
    expect(source).not.toContain('data-media-sync-trigger');
    expect(source).not.toContain("{ type: 'EMBY_LIBRARY_SYNC', manual: true },");
    expect(mediaCss).toContain('.ml-command-panel-meta');
    expect(mediaCss).toContain('.ml-command-panel-empty');
    expect(mediaCss).not.toContain('.ml-sync-menu');
    expect(mediaCss).not.toContain('.ml-sync-split-btn');
  });

  it('uses one playback request path and opens a source chooser for aggregated titles', () => {
    expect(source).toContain('resolvePlaybackChoice');
    expect(source).toContain('requestPlayback');
    expect(source).toContain('data-media-source-choice="1"');
    expect(source).toContain('选择播放来源');
    expect(source).toContain('不可播放的副本会保留在列表中，并说明原因');
  });

  it('closes detail before opening the shared player from an exact source copy', () => {
    const detailSource = readFileSync(join(here, 'MediaItemDetailPanel.tsx'), 'utf-8');
    expect(detailSource).toContain('ml-detail-play-menu');
    expect(detailSource).toContain('选择播放来源');
    expect(detailSource).toContain('setShowPlaybackMenu');
    expect(detailSource).toContain('onPlayCopy?.(copy');
    expect(source).toContain('data-media-source-choice="1"');
    expect(source).toContain('setDetailItem(null);\n              playResolvedItem(mediaCopyToBrowseItem(it, copy)');
  });

  it('lists all card sources and lets the detail panel play an exact source copy', () => {
    expect(source).toContain('getMediaSourceLabels(item)');
    expect(source).toContain('ml-card-source-row');
    expect(source).toContain('onPlayCopy');
    expect(source).toContain('mediaCopyToBrowseItem');
  });

  it('uses dashboard toast feedback for card actions instead of blocking alert', () => {
    expect(source).toContain('void toast(`标记失败：${msg}`, \'error\')');
    expect(source).toContain("void toast(e instanceof Error ? e.message : String(e), 'error')");
    expect(source).not.toContain('window.alert(');
  });


});
