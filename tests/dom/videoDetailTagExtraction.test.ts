/**
 * @file videoDetailTagExtraction.test.ts
 * @description 详情页标签抽取回归测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initOrchestrator } from '../../apps/extension/src/apps/content/orchestrator';
import { STATE, setCurrentFaviconState, setCurrentTitleStatus, setSuspendEarlyFaviconSync } from '../../apps/extension/src/features/contentState';
import { handleVideoDetailPage } from '../../apps/extension/src/features/videoDetail/pageHandler';
import { concurrencyManager, storageManager } from '../../apps/extension/src/features/records/content';
import type { VideoRecord } from '../../apps/extension/src/types';
import { DEFAULT_SETTINGS } from '../../apps/extension/src/utils/config';

vi.mock('../../apps/extension/src/apps/content/orchestrator', () => ({
  initOrchestrator: {
    add: vi.fn(),
  },
}));

vi.mock('../../apps/extension/src/features/records/content', () => ({
  concurrencyManager: {
    startProcessingVideo: vi.fn(),
    finishProcessingVideo: vi.fn(),
  },
  storageManager: {
    addRecord: vi.fn(),
    updateRecord: vi.fn(),
    updateRecordDirect: vi.fn(),
    putRecord: vi.fn(),
  },
}));

vi.mock('../../apps/extension/src/platform/tasks', () => ({
  CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS: {
    videoDetailPreLease: 'content.videoDetail.preLease',
    videoDetailLibraryStatus: 'content.videoDetail.libraryStatus',
    videoDetailSearchLinks: 'content.videoDetail.searchLinks',
    videoDetailAcquireOperation: 'content.videoDetail.acquireOperation',
  },
  createTaskTimeoutGuard: vi.fn((timeoutMs: number) => ({
    timeoutMs,
    isTimedOut: () => false,
    throwIfTimedOut: () => undefined,
  })),
  createManagedTaskDescriptor: vi.fn((descriptor: Record<string, unknown>) => ({
    ...descriptor,
    taskId: String(descriptor.label || 'task'),
  })),
  runChunkedWork: vi.fn(),
  runManagedTask: vi.fn(async (_descriptor: unknown, task: () => Promise<void>) => {
    await task();
  }),
  saveSubtaskDetail: vi.fn(async () => undefined),
  startContentPerformanceSpan: vi.fn(() => () => undefined),
  yieldToMainThread: vi.fn(async () => undefined),
}));

vi.mock('../../apps/extension/src/platform/browser/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../../apps/extension/src/platform/browser/enhancementLoadingIndicator', () => ({
  showEnhancementLoading: vi.fn(),
}));

vi.mock('../../apps/extension/src/features/externalSearch', () => ({
  renderDetailSearchLinks: vi.fn(),
}));

vi.mock('../../apps/extension/src/features/embyLibrary/content/statusBadges', () => ({
  renderDetailLibraryStatus: vi.fn(),
}));

vi.mock('../../apps/extension/src/features/videoDetail/enhancer', () => ({
  videoDetailEnhancer: {
    initCore: vi.fn(),
    loadEnhancedData: vi.fn(),
    insertTranslationPlaceholder: vi.fn(),
    runCover: vi.fn(),
    runTitle: vi.fn(),
    runFC2Breaker: vi.fn(),
    finish: vi.fn(),
    runReviewBreaker: vi.fn(),
    runRelatedLists: vi.fn(),
  },
  VideoDetailEnhancer: vi.fn(),
}));

vi.mock('../../apps/extension/src/features/videoDetail/favoriteRating', () => ({
  videoFavoriteRatingEnhancer: {
    init: vi.fn(),
  },
}));

vi.mock('../../apps/extension/src/features/actors', () => ({
  actorManager: {
    initialize: vi.fn(),
    getActorById: vi.fn(),
  },
}));

vi.mock('../../apps/extension/src/features/newWorks', () => ({
  newWorksManager: {
    getSubscriptions: vi.fn(async () => []),
  },
}));

vi.mock('../../apps/extension/src/features/actorRemarks', () => ({
  actorExtraInfoService: {
    getActorRemarks: vi.fn(),
  },
}));

function installDetailPageDom(): void {
  window.history.pushState({}, '', '/v/ssis-795');
  document.title = 'SSIS-795 测试影片 | JavDB';
  document.head.innerHTML = '<link rel="icon" href="/favicon.ico">';
  document.body.innerHTML = `
    <header>
      <a class="navbar-item" href="https://javdb.com">JavDB</a>
    </header>
    <main>
      <h2 class="title is-4"><strong>SSIS-795</strong></h2>
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block"><span class="title is-4">SSIS-795</span></div>
        <div class="panel-block genre">
          <strong>類別:</strong>
          <span class="value">
            <a href="/tags?c=1">劇情</a>
            <a href="/tags?c=2">中文字幕</a>
            <span class="jdb-detail-search-links">
              <a class="tag" href="https://wiki.example/search?q=SSIS-795">Wiki</a>
              <a class="tag" href="https://xslist.example/search?q=SSIS-795">xslist</a>
              <a class="tag" href="https://example.test/98tang/SSIS-795">98堂</a>
              <a class="tag" href="https://subtitle.example/SSIS-795">迅雷字幕</a>
            </span>
          </span>
        </div>
        <div class="panel-block">
          <strong>描述:</strong>
          <span class="value">用于让资料抽取通过二次校验。</span>
        </div>
        <div class="review-buttons"></div>
      </nav>
    </main>
  `;
}

describe('video detail tag extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentFaviconState(null);
    setCurrentTitleStatus(null);
    setSuspendEarlyFaviconSync(false);
    STATE.records = {};
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.videoEnhancement.showLoadingIndicator = false;
    settings.videoEnhancement.enableActorNameMarks = false;
    STATE.settings = settings;
    STATE.originalFaviconUrl = '/favicon.ico';

    vi.mocked(concurrencyManager.startProcessingVideo).mockResolvedValue('op-SSIS-795');
    vi.mocked(storageManager.addRecord).mockImplementation(async (videoId: string, record: VideoRecord) => {
      STATE.records = { ...STATE.records, [videoId]: record };
      return { success: true, alreadyExists: false };
    });
    vi.mocked(initOrchestrator.add).mockImplementation(async (_phase, task, options) => {
      if (options?.label === 'videoStatus:initialSync') {
        await task();
      }
    });
    installDetailPageDom();
  });

  afterEach(() => {
    STATE.settings = null;
    STATE.records = {};
    STATE.originalFaviconUrl = '';
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('只保存原站类别标签，不保存拓展注入的外部来源入口', async () => {
    await handleVideoDetailPage();

    expect(STATE.records['SSIS-795']?.tags).toEqual(['劇情', '中文字幕']);
    expect(STATE.records['SSIS-795']?.categories).toEqual(['劇情', '中文字幕']);
  });
});
