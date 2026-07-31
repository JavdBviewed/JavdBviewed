/**
 * @file videoDetailWantSync.test.ts
 * @description 影片详情页想看状态同步回归测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initOrchestrator } from '../../apps/extension/src/apps/content/orchestrator';
import { STATE, setCurrentFaviconState, setCurrentTitleStatus, setSuspendEarlyFaviconSync } from '../../apps/extension/src/features/contentState';
import { handleVideoDetailPage, runActorRemarksQuick } from '../../apps/extension/src/features/videoDetail/pageHandler';
import { concurrencyManager, storageManager } from '../../apps/extension/src/features/records/content';
import type { VideoRecord } from '../../apps/extension/src/types';
import { DEFAULT_SETTINGS, VIDEO_STATUS } from '../../apps/extension/src/utils/config';

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
        <div class="review-buttons">
          <form class="button_to" method="post" action="/reviews/want_to_watch" data-remote="true">
            <button type="submit" class="button is-small">想看</button>
          </form>
        </div>
      </nav>
    </main>
  `;
}

function dispatchRemoteFormClick(button: HTMLButtonElement): void {
  button.addEventListener('click', event => event.preventDefault(), { once: true });
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function applyStorageMocks(): void {
  vi.mocked(storageManager.addRecord).mockImplementation(async (videoId: string, record: VideoRecord) => {
    STATE.records = { ...STATE.records, [videoId]: record };
    return { success: true, alreadyExists: false };
  });

  vi.mocked(storageManager.updateRecord).mockImplementation(async (
    videoId: string,
    updateFn: (currentRecords: Record<string, VideoRecord>) => VideoRecord,
  ) => {
    const updated = updateFn(STATE.records);
    STATE.records = { ...STATE.records, [videoId]: updated };
    return { success: true };
  });

  vi.mocked(storageManager.updateRecordDirect).mockImplementation(async (
    videoId: string,
    updateFn: (currentRecord: VideoRecord | undefined) => VideoRecord,
  ) => {
    const updated = updateFn(STATE.records[videoId]);
    STATE.records = { ...STATE.records, [videoId]: updated };
    return { success: true, record: updated };
  });

  vi.mocked(storageManager.putRecord).mockImplementation(async (record: VideoRecord) => {
    STATE.records = { ...STATE.records, [record.id]: record };
    return { success: true };
  });
}

describe('video detail want sync', () => {
  beforeEach(() => {
    if (!('innerText' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent || ''; },
        set(value: string) { this.textContent = value; },
      });
    }
    vi.useFakeTimers();
    vi.clearAllMocks();
    setCurrentFaviconState(null);
    setCurrentTitleStatus(null);
    setSuspendEarlyFaviconSync(false);
    STATE.records = {};
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.videoEnhancement.enableWantSync = true;
    settings.videoEnhancement.showLoadingIndicator = false;
    settings.videoEnhancement.enableActorNameMarks = false;
    STATE.settings = settings;
    STATE.originalFaviconUrl = '/favicon.ico';

    let operationIndex = 0;
    vi.mocked(concurrencyManager.startProcessingVideo).mockImplementation(async (videoId: string) => {
      operationIndex += 1;
      return `op-${videoId}-${operationIndex}`;
    });

    vi.mocked(initOrchestrator.add).mockImplementation(async (_phase, task, options) => {
      if (options?.label === 'videoStatus:initialSync') {
        await task();
      }
    });

    applyStorageMocks();
    installDetailPageDom();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    STATE.settings = null;
    STATE.records = {};
    STATE.originalFaviconUrl = '';
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('点击原站想看并确认页面状态后，会创建本地想看记录并刷新 favicon', async () => {
    await handleVideoDetailPage();

    const wantButton = document.querySelector<HTMLButtonElement>('form[action*="/reviews/want_to_watch"] button');
    expect(wantButton).not.toBeNull();

    if (wantButton) {
      dispatchRemoteFormClick(wantButton);
    }
    const reviewButtons = document.querySelector<HTMLElement>('.review-buttons');
    if (reviewButtons) {
      reviewButtons.innerHTML = `
        <div class="review-title">
          <a href="/users/want_watch_videos"><span class="tag">我想看這部影片</span></a>
        </div>
      `;
    }

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4000);

    const record = STATE.records['SSIS-795'];
    const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

    expect(record?.status).toBe(VIDEO_STATUS.WANT);
    expect(record?.id).toBe('SSIS-795');
    expect(favicon?.href).toContain('assets/switch-want.png');
  });

  it('原站想看状态未确认时，不会提前写入本地番号库', async () => {
    await handleVideoDetailPage();

    const wantButton = document.querySelector<HTMLButtonElement>('form[action*="/reviews/want_to_watch"] button');
    expect(wantButton).not.toBeNull();

    if (wantButton) {
      dispatchRemoteFormClick(wantButton);
    }
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4000);

    const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

    expect(STATE.records['SSIS-795']).toBeUndefined();
    expect(favicon?.href).not.toContain('assets/switch-want.png');
  });
  it('moves actor remarks panel mode into the detail enhancement panel without moving inline remarks', async () => {
    window.history.pushState({}, '', '/v/ssis-795');
    document.body.innerHTML = `
      <main>
        <h2 class="title is-4"><strong>SSIS-795</strong></h2>
        <div class="columns is-desktop">
          <div class="column column-video-cover">cover</div>
          <div class="column">
            <nav class="panel movie-panel-info">
              <div class="panel-block first-block"><span class="title is-4">SSIS-795</span></div>
              <div class="panel-block actor-block">
                <strong>演员:</strong>
                <span class="value"><a href="/actors/abc">Alice</a></span>
              </div>
              <div class="review-buttons"></div>
            </nav>
          </div>
        </div>
      </main>
    `;
    STATE.settings = {
      ...DEFAULT_SETTINGS,
      videoEnhancement: {
        ...DEFAULT_SETTINGS.videoEnhancement,
        enableActorRemarks: true,
        actorRemarksMode: 'panel',
        actorRemarksTaskTimeoutSeconds: 1,
      },
    } as typeof DEFAULT_SETTINGS;
    const tasks = await import('../../apps/extension/src/platform/tasks');
    vi.mocked(tasks.runChunkedWork).mockImplementation(async (items: unknown[], options: any) => {
      for (const item of items) {
        await options.onItem(item);
      }
      await options.onBatchComplete?.({ batchIndex: 0, itemCount: items.length, processed: items.length, stopped: false });
    });
    const { actorExtraInfoService } = await import('../../apps/extension/src/features/actorRemarks');
    vi.mocked(actorExtraInfoService.getActorRemarks).mockResolvedValue({
      age: 28,
      heightCm: 168,
      cup: 'd',
      retired: false,
      source: 'test',
      wikiUrl: 'https://example.test/wiki/Alice',
    } as any);

    await runActorRemarksQuick(1000);

    const panel = document.getElementById('enhanced-actor-remarks');
    expect(panel?.parentElement).toBe(document.querySelector('#jdb-detail-enhancement-panel .panel'));
    expect(panel?.classList.contains('panel-block')).toBe(true);
    expect(panel?.textContent).toContain('\u6f14\u5458\u5907\u6ce8');
    expect(panel?.textContent).toContain('Alice');
    expect(document.querySelector('.movie-panel-info #enhanced-actor-remarks')).toBeNull();
    expect(document.querySelector('.actor-block .jdb-actor-remarks-inline')?.textContent).toContain('28 / 168cm / D');
  });
  it('创建详情页记录时，只保存原站类别标签，不保存拓展注入的外部来源入口', async () => {
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

    await handleVideoDetailPage();

    expect(STATE.records['SSIS-795']?.tags).toEqual(['劇情', '中文字幕']);
  });
});
