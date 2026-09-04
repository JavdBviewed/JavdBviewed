/**
 * @file listEnhancementManager.ts
 * @description listEnhancementManager
 * @module features/listEnhancement
 */
// src/features/listEnhancement/listEnhancementManager.ts

import { log } from '../contentState';
import { showToast } from '../../platform/browser/toast';
import { actorManager } from '../actors';
import { actorQuickActionsManager } from '../actorEnhancement/actorQuickActionsManager';
import { newWorksManager } from '../newWorks';
import { processListItems, processVisibleItems } from './content/itemProcessor';
import {
  appendSuperRankingTop250Page,
  getSuperRankingTop250PageInfo,
} from '../rankings';
import {
  activatePreviewVideoPreload,
  loadListPreviewVideo,
  releasePreviewVideoMedia,
} from '../previews';
import {
  createDefaultListEnhancementConfig,
  type ListDisplayControlConfig,
  type ListEnhancementConfig,
  type ListSortingConfig,
} from './domain/config';
import {
  createActorDataCache,
  extractActorsFromListItem,
  renderActorWatermark,
} from './application/actorWatermark';
import { matchActorsFromTitle } from './application/actorMatching';
import {
  applyActorBasedHiding,
  clearListItemActorHiding,
  hideListItemByActor,
} from './application/actorHidingWorkflow';
import {
  createListScrollPagingController,
  type ListScrollPagingController,
} from './application/scrollPaging';
import {
  buildPopularityEffectAttributes,
  parseRatingStatsText,
} from './application/popularityEffects';
import {
  buildPopularityStyles,
  LIST_ENHANCEMENT_BASE_STYLES,
} from './ui/styles';
import {
  applyListDisplayControl,
  processListDisplayContainers,
} from './ui/listDisplayControl';
import {
  createPreviewHoverController,
  type PreviewHoverController,
} from './ui/previewHoverController';
import {
  createListClickEnhancementDelegator,
} from './ui/clickEnhancement';
import {
  extractListItemVideoInfo,
  optimizeListItemTitle,
} from './ui/listItemDom';
import {
  observeListItems,
} from './ui/listItemObserver';
import {
  createListScrollStateController,
  type ListScrollStateController,
} from './ui/listScrollState';
import {
  createListSortingController,
  type ListSortingController,
} from './ui/listSortingControls';
import { createActorWorkQueue, type ActorWorkQueue } from './application/actorWorkQueue';
import { createActorPenetrationRuntime, resolveActorLinkMark } from './actorPenetration';
import { createActorVisibilityGate } from './application/actorVisibilityGate';
import { countContentPerformanceEvent } from '../../platform/tasks';
import { recomputeListHiding, readListHidingEnablement } from '../list-hiding';
import { STATE as _STATE } from '../contentState';

export type { ListEnhancementConfig } from './domain/config';

function normalizeListSortingConfig(config?: ListSortingConfig): ListSortingConfig {
  return {
    enabled: config?.enabled === true,
    appendStrategy: config?.appendStrategy === 'auto-resort' ? 'auto-resort' : 'prompt',
    autoResortPosition: config?.autoResortPosition === 'top' ? 'top' : 'preserve',
  };
}

class ListEnhancementManager {
  private config: ListEnhancementConfig = createDefaultListEnhancementConfig();
  private hasInitialized = false;
  
  // 保存上一次的列表显示控制配置，用于检测变化
  private lastDisplayControl: ListDisplayControlConfig | null = null;

  private readonly scrollStateController: ListScrollStateController = createListScrollStateController({
    document,
    window,
    restoreDelayMs: 100,
  });
  private readonly previewHoverController: PreviewHoverController = createPreviewHoverController({
    window,
    getPreviewDelay: () => Number(this.config.previewDelay || 0),
    getPreferredPreviewSource: () => this.config.preferredPreviewSource || 'auto',
    isScrolling: () => this.scrollStateController.isScrolling(),
    loadPreviewVideo: (coverElement, videoInfo, options) => loadListPreviewVideo(coverElement, videoInfo, options),
    activatePreviewVideoPreload,
    releasePreviewVideoMedia,
    runtimeSendMessage: (message) => chrome.runtime.sendMessage(message),
  });
  private readonly listClickDelegator = createListClickEnhancementDelegator();
  private readonly listSortingController: ListSortingController = createListSortingController({
    document,
    window,
    config: normalizeListSortingConfig(this.config.sorting),
    logger: (...args) => log(...args),
  });
  private readonly scrollPagingController: ListScrollPagingController = createListScrollPagingController({
    document,
    window,
    threshold: 200,
    logger: (...args) => log(...args),
    getSuperRankingPageInfo: () => getSuperRankingTop250PageInfo(),
    appendSuperRankingPage: page => appendSuperRankingTop250Page(page),
    fetchText: async url => {
      const response = await fetch(url);
      return response.text();
    },
    processVisibleItems: () => processVisibleItems(),
    clearActorCaches: () => this.clearActorCaches(),
    onItemsAppended: event => this.listSortingController.handleItemsAppended(event),
    onActorIndexCleared: () => this.invalidateActorNameMarkPrep(),
  });
  private readonly actorDataCache = createActorDataCache({
    getAllActors: () => actorManager.getAllActors(),
    getSubscriptions: () => newWorksManager.getSubscriptions(),
    logger: (...args) => log(...args),
  });
  private readonly actorWorkQueue: ActorWorkQueue = createActorWorkQueue({
    concurrency: 2,
    logger: error => log('Actor enhancement task failed:', error),
  });
  private readonly actorPenetration = createActorPenetrationRuntime({
    logger: (...args) => log(...args),
    getActorMark: (actorId) => {
      if (!this.config.enableActorNameMarks || !this.actorNameMarkPrepped) return undefined;
      return resolveActorLinkMark(
        actorId,
        this.actorDataCache.getActorByIdSync(actorId),
        { subscribedActorIds: this.subscribedActorIds },
      );
    },
  });
  private subscribedActorIds = new Set<string>();
  // 名称标识数据是否已预热完成（索引 + 订阅）
  private actorNameMarkPrepped = false;
  private readonly actorVisibilityGate = createActorVisibilityGate();
  private readonly forceActorHidingItems = new WeakSet<HTMLElement>();
  // 演员水印样式注入标记
  private watermarkStylesInjected = false;
  // 演员穿透行样式注入标记
  private actorRowStylesInjected = false;
  private popularityStylesInjected = false;

  /**
   * 配置变化时的副作用注册表。
   * 每个 concern 自注册一条 effect：watch 判定是否变化，apply 执行重放。
   * updateConfig 只按数组顺序依次执行命中的 effect —— 新增功能不再改这个方法主体。
   * 顺序即执行顺序（如 nameMarks 重放需晚于 penetration 重置）。
   */
  private readonly configEffects: ReadonlyArray<{
    name: string;
    watch: (oldCfg: ListEnhancementConfig, cur: ListEnhancementConfig) => boolean;
    apply: () => void;
  }> = [
    {
      name: 'scrollPaging',
      watch: (o, c) => o.enableScrollPaging !== c.enableScrollPaging,
      apply: () => {
        if (this.config.enableScrollPaging && this.config.enabled) {
          this.initScrollPaging();
          log('Scroll paging enabled and initialized');
        } else {
          this.cleanupScrollPaging();
          log('Scroll paging disabled and cleaned up');
        }
      },
    },
    {
      name: 'actorFilter',
      watch: (o, c) =>
        o.hideBlacklistedActorsInList !== c.hideBlacklistedActorsInList ||
        o.hideNonFavoritedActorsInList !== c.hideNonFavoritedActorsInList ||
        o.hideUnrecognizedActorsInList !== c.hideUnrecognizedActorsInList ||
        o.treatSubscribedAsFavorited !== c.treatSubscribedAsFavorited,
      apply: () => {
        log('Actor filter config changed, reapplying filters...');
        this.recomputeAllListHiding();
        this.reapplyActorHidingForAll();
      },
    },
    {
      name: 'actorNameMarks',
      watch: (o, c) =>
        (o.enableActorNameMarks !== false) !== (c.enableActorNameMarks !== false),
      apply: () => {
        this.actorNameMarkPrepped = false;
        this.subscribedActorIds = new Set();
        if (this.config.enableActorNameMarks !== false) {
          void this.warmActorNameMarkData();
        }
      },
    },
    {
      name: 'actorPenetration',
      watch: (o, c) =>
        (o.enableActorPenetration === true) !== (c.enableActorPenetration === true),
      apply: () => {
        this.actorPenetration.reset();
        const items = document.querySelectorAll<HTMLElement>('.movie-list .item');
        if (this.config.enableActorPenetration !== true) {
          items.forEach(item => this.actorPenetration.clear(item));
        } else if (this.hasInitialized) {
          items.forEach(item => {
            const info = extractListItemVideoInfo(item);
            if (info?.code) this.enqueueActorPenetration(item, info);
          });
        }
      },
    },
    {
      name: 'actorNameMarksReplay',
      watch: (o, c) =>
        (o.enableActorNameMarks !== false) !== (c.enableActorNameMarks !== false),
      apply: () => this.reapplyActorRowMarksIfReady(),
    },
    {
      name: 'listDisplay',
      watch: (o, c) => {
        const last = this.lastDisplayControl;
        const cur = c.listDisplayControl;
        const changed = !last || (
          last.enabled !== cur?.enabled ||
          last.columnCount !== cur?.columnCount ||
          last.containerWidth !== cur?.containerWidth ||
          last.enableContainerExpansion !== cur?.enableContainerExpansion
        );
        if (changed && cur) {
          this.lastDisplayControl = {
            enabled: cur.enabled,
            columnCount: cur.columnCount,
            containerWidth: cur.containerWidth,
            enableContainerExpansion: cur.enableContainerExpansion ?? false,
          };
        }
        log('Display control changed:', changed);
        return changed;
      },
      apply: () => {
        log('Applying list display styles due to config change...');
        this.applyListDisplayStyles();
      },
    },
    {
      name: 'popularity',
      watch: (o, c) =>
        JSON.stringify(o.popularityEffects || null) !== JSON.stringify(c.popularityEffects || null),
      apply: () => {
        this.ensurePopularityStyles();
        this.reapplyPopularityEffects();
      },
    },
    {
      name: 'sorting',
      watch: (o, c) =>
        JSON.stringify(o.sorting || null) !== JSON.stringify(c.sorting || null) && this.hasInitialized,
      apply: () => this.listSortingController.updateConfig(normalizeListSortingConfig(this.config.sorting)),
    },
  ];

  updateConfig(newConfig: Partial<ListEnhancementConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    log('List enhancement config updated:', this.config);

    for (const effect of this.configEffects) {
      if (effect.watch(oldConfig, this.config)) {
        effect.apply();
      }
    }
  }

  private ensurePopularityStyles(): void {
    const currentConfig = this.config.popularityEffects;
    const existingStyle = document.getElementById('x-popularity-effects-style');

    if (!currentConfig?.enabled) {
      existingStyle?.remove();
      this.popularityStylesInjected = false;
      return;
    }

    if (existingStyle) {
      existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = 'x-popularity-effects-style';
    style.textContent = buildPopularityStyles();
    document.head.appendChild(style);
    this.popularityStylesInjected = true;
  }

  private reapplyPopularityEffects(): void {
    const items = document.querySelectorAll('.movie-list .item');
    items.forEach(item => this.applyPopularityEffect(item as HTMLElement));
  }

  private extractRatingStats(item: HTMLElement): { score: number | null; count: number | null } {
    const scoreText = item.querySelector('.score .value')?.textContent || item.querySelector('.score')?.textContent || '';
    return parseRatingStatsText(scoreText);
  }

  private applyPopularityEffect(item: HTMLElement): void {
    const config = this.config.popularityEffects;
    item.removeAttribute('data-popularity-effect');
    item.removeAttribute('data-popularity-level');
    item.removeAttribute('data-popularity-count');
    item.removeAttribute('data-popularity-score');

    if (!config?.enabled) {
      return;
    }

    const attrs = buildPopularityEffectAttributes(this.extractRatingStats(item), config);
    if (!attrs) {
      return;
    }

    item.setAttribute('data-popularity-count', attrs.count);
    item.setAttribute('data-popularity-score', attrs.score);
    if (attrs.effect) item.setAttribute('data-popularity-effect', attrs.effect);
    if (attrs.level) item.setAttribute('data-popularity-level', attrs.level);
  }

  // 🆕 应用列表显示样式 - 分两步实现
  private applyListDisplayStyles(): void {
    applyListDisplayControl({
      document,
      window,
      control: this.config.listDisplayControl,
      logger: (...args) => log(...args),
    });
  }
  // ====== 演员水印相关 ======
  private ensureWatermarkStyles(): void {
    if (this.watermarkStylesInjected) return;
    try {
      const style = document.createElement('style');
      style.id = 'x-actor-watermark-styles';
      style.textContent = `
        .x-actor-wm { position: absolute; display: inline-flex; flex-wrap: wrap; gap: 6px; padding: 8px; z-index: 4; pointer-events: auto; }
        .x-actor-wm.pos-top-left { top: 6px; left: 6px; }
        .x-actor-wm.pos-top-right { top: 6px; right: 6px; }
        .x-actor-wm.pos-bottom-left { bottom: 6px; left: 6px; }
        .x-actor-wm.pos-bottom-right { bottom: 6px; right: 6px; }
        .x-actor-wm .x-actor-badge { height: 16px; line-height: 16px; padding: 0 6px; border-radius: 9999px; color: #fff; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; box-shadow: 0 0 0 2px rgba(255,255,255,0.85), 0 1px 2px rgba(0,0,0,0.25); }
        .x-actor-wm .badge-red { background: #ef4444; }
        .x-actor-wm .badge-green { background: #22c55e; }
        .x-actor-wm .badge-amber { background: #f59e0b; }
        .x-actor-wm .x-actor-more { background: rgba(31,41,55,0.9); }
      `;
      document.head.appendChild(style);
      this.watermarkStylesInjected = true;
      log('Actor watermark styles injected');
    } catch (e) {
      log('Failed to inject actor watermark styles:', e);
    }
  }
  /**
   * 清除演员相关缓存
   * 在以下情况调用：
   * 1. 翻页前
   * 2. 配置变化时
   * 3. 手动刷新时
   */
  private clearActorCaches(): void {
    this.actorDataCache.clear();
  }

  /**
   * 预热演员名称标识所需的本地数据（演员索引 + 订阅集合）。
   * getActorMark 为同步读取，必须先完成异步加载；完成后重放已渲染的行，
   * 使首帧渲染时标识缺失的卡片补上着色。
   */
  private async warmActorNameMarkData(): Promise<void> {
    try {
      await Promise.all([
        this.actorDataCache.ensureActorIndex(),
        this.actorDataCache.ensureSubscriptions(),
      ]);
    } catch {
      this.subscribedActorIds = new Set();
    }
    try {
      this.subscribedActorIds = new Set(await this.actorDataCache.ensureSubscriptions());
    } catch {
      this.subscribedActorIds = new Set();
    }
  }

  /** 名称标识预热完成/失效后，重放已渲染的穿透行以补全着色。 */
  private reapplyActorRowMarksIfReady(): void {
    if (!this.config.enableActorNameMarks) return;
    if (this.config.enableActorPenetration !== true) return;
    this.reapplyActorRowMarks();
  }

  /** 演员索引被清除（翻页/刷新）时，若已重放则重置预热标记。 */
  private invalidateActorNameMarkPrep(): void {
    if (this.actorNameMarkPrepped) {
      this.actorNameMarkPrepped = false;
      this.subscribedActorIds = new Set();
    }
  }

  /** 注入演员穿透行样式（小字号、名字间距、日期同行对齐）。 */
  private ensureActorRowStyles(): void {
    if (this.actorRowStylesInjected) return;
    try {
      const style = document.createElement('style');
      style.id = 'x-ap-actor-row-styles';
      style.textContent = `
        .x-ap-actor-row-container { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: 6px; vertical-align: middle; max-width: 100%; }
        .x-ap-actor-row { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; line-height: 1.4; color: var(--color-fg-muted, #57606a); }
        .x-ap-actor-row-label { display: inline-block; color: var(--color-fg-subtle, #8c959f); user-select: none; }
        .x-ap-actor { display: inline-block; color: inherit; text-decoration: none; }
        .x-ap-actor:hover { text-decoration: underline; }
        .x-ap-actor-sub { display: inline-block; font-size: 11px; line-height: 1; vertical-align: middle; color: #f59e0b; margin-left: 2px; }
        .x-ap-actor-more { display: inline-block; color: var(--color-fg-subtle, #8c959f); }
      `;
      document.head.appendChild(style);
      this.actorRowStylesInjected = true;
    } catch (e) {
      log('Failed to inject actor row styles:', e);
    }
  }

  private async applyActorWatermark(item: HTMLElement, videoInfo: { code: string; title: string; url: string }): Promise<void> {
    try {
      this.ensureWatermarkStyles();
      const [actorIndex, subscribedActorIds] = await Promise.all([
        this.actorDataCache.ensureActorIndex(),
        this.actorDataCache.ensureSubscriptions(),
      ]);
      const coverElement = item.querySelector('.cover') as HTMLElement | null;
      if (!coverElement) return;

      // 1) 优先DOM抓取（列表/首页可靠）
      let actors = await extractActorsFromListItem(item, {
        getActorById: id => this.actorDataCache.getActorById(id),
      });
      if (actors.length === 0) {
        // 2) 回退：标题解析（快速路径A -> 加权D）
        actors = matchActorsFromTitle(videoInfo.title, actorIndex);
      }
      // 演员页兜底：若标题未能匹配到演员，则使用当前演员ID
      if ((actors.length === 0) && /^\/actors\//.test(window.location.pathname)) {
        const m = window.location.pathname.match(/\/actors\/(\w+)/);
        if (m && m[1]) {
          try {
            const rec = await this.actorDataCache.getActorById(m[1]);
            if (rec) {
              actors = [rec];
            }
          } catch {}
        }
      }
      actors = actors.slice(0, 6);
      if (actors.length === 0) return;

      const matched = actors.map(a => {
        const isBlack = !!a.blacklisted;
        const isSub = subscribedActorIds.has(a.id);
        return { actor: a, isBlack, isSub };
      });

      if (matched.length === 0) return;

      renderActorWatermark(coverElement, matched, {
        opacity: this.config.actorWatermarkOpacity ?? 0.8,
        position: this.config.actorWatermarkPosition || 'top-right',
      });
    } catch (e) {
      log('applyActorWatermark failed:', e);
    }
  }

  initialize(): void {
    if (!this.config.enabled) {
      return;
    }

    log('Initializing list enhancement features...');
    this.hasInitialized = true;
    this.initListPageActorQuickActions();

    // 初始化滚动监听（防止滚动时触发预览）
    this.scrollStateController.init();

    // 🆕 应用列表显示控制样式
    this.applyListDisplayStyles();
    
    // 保存初始配置
    if (this.config.listDisplayControl) {
      this.lastDisplayControl = {
        enabled: this.config.listDisplayControl.enabled,
        columnCount: this.config.listDisplayControl.columnCount,
        containerWidth: this.config.listDisplayControl.containerWidth,
        enableContainerExpansion: this.config.listDisplayControl.enableContainerExpansion ?? false
      };
    }

    // 处理现有的影片项目
    this.processExistingItems();

    this.listSortingController.updateConfig(normalizeListSortingConfig(this.config.sorting));
    this.listSortingController.init();

    // 监听新添加的项目
    this.observeNewItems();

    // 初始化滚动翻页功能
    if (this.config.enableScrollPaging) {
      this.initScrollPaging();
    }

    // 若启用演员水印，初始化一次样式
    if (this.config.enableActorWatermark) {
      this.ensureWatermarkStyles();
    }

    this.ensurePopularityStyles();
    this.reapplyPopularityEffects();

    log('List enhancement initialized successfully');
  }

  private processExistingItems(): void {
    const items = [...document.querySelectorAll<HTMLElement>('.movie-list .item')];
    countContentPerformanceEvent('listEnhancement.existingItems', items.length);
    items.forEach(item => this.enhanceItem(item));
    processListItems(items.filter(item => Boolean(extractListItemVideoInfo(item))));
  }

  private observeNewItems(): void {
    observeListItems({
      document,
      enhanceItem: item => this.enhanceItem(item),
      onNewItems: items => {
        this.processContainerAttributes();
        processListItems(items.filter(item => Boolean(extractListItemVideoInfo(item))));
      },
    });
  }

  // 🆕 处理容器的data属性（用于列表显示控制）
  private processContainerAttributes(): void {
    const control = this.config.listDisplayControl;
    if (!control || !control.enabled) return;

    const processed = processListDisplayContainers(document);
    if (processed > 0) {
      log('[LIST DISPLAY] Added data-x-cols-override to new container');
    }
  }

  private enhanceItem(item: HTMLElement): void {
    // 避免重复处理
    if (item.hasAttribute('data-list-enhanced')) {
      return;
    }
    item.setAttribute('data-list-enhanced', 'true');
    countContentPerformanceEvent('listEnhancement.enhanceItem');

    // 获取影片信息
    const videoInfo = extractListItemVideoInfo(item);
    if (!videoInfo) return;

    // 高质量封面（已弃用 - JavDB 现已默认使用高质量封面）
    // if (this.config.enableHighQualityCover) {
    //   this.enhanceItemCover(item);
    // }

    // 应用各种增强功能
    if (this.config.enableClickEnhancement && this.config.enableClickEnhancementList !== false) {
      this.enhanceClicks(item, videoInfo);
    }

    if (this.config.enableVideoPreview && this.config.enableVideoPreviewList !== false) {
      this.enhanceVideoPreview(item, videoInfo);
    }

    if (this.config.enableListOptimization) {
      this.optimizeListItem(item, videoInfo);
    }

    this.applyPopularityEffect(item);

    this.enqueueActorEnhancement(item, videoInfo);
    this.enqueueActorPenetration(item, videoInfo);
  }

  private enqueueActorEnhancement(
    item: HTMLElement,
    videoInfo: { code: string; title: string; url: string },
    forceActorHiding = false,
    fromVisibilityGate = false,
  ): void {
    if (!this.config.enableActorWatermark && !this.isActorHidingEnabled() && !forceActorHiding) return;

    if (
      !fromVisibilityGate &&
      !forceActorHiding &&
      this.config.enableActorWatermark &&
      !this.isActorHidingEnabled() &&
      this.actorVisibilityGate.defer(item, () => {
        this.enqueueActorEnhancement(item, videoInfo, false, true);
      })
    ) {
      countContentPerformanceEvent('listEnhancement.actorDeferred');
      return;
    }

    if (forceActorHiding) {
      this.forceActorHidingItems.add(item);
    }

    countContentPerformanceEvent('listEnhancement.actorEnqueue');
    this.actorWorkQueue.enqueue(async () => {
      try {
        if (!item.isConnected) return;
        if (this.config.enableActorWatermark) {
          await this.applyActorWatermark(item, videoInfo);
        }
        if (this.forceActorHidingItems.has(item) || this.isActorHidingEnabled()) {
          await this.applyActorBasedHiding(item, videoInfo);
        }
      } finally {
        this.forceActorHidingItems.delete(item);
      }
    }, item);
  }

  /**
   * 演员穿透：仅在功能开启时执行。
   * 通过可见性门控 + 演员工作队列，保证详情请求只发生在可见/即将可见卡片上，
   * 且受并发限制；解析成功后渲染卡片演员行。
   */
  /**
   * 列表页初始化演员悬浮快捷面板。
   * actorQuickActionsManager 默认只在影片详情页 init（MutationObserver 监听动态演员链接）；
   * 列表页的穿透演员行是 JS 插入的，需要同样的监听才能在悬浮时弹出面板。
   * 仅在列表页调用一次，不影响影片页行为。
   */
  private initListPageActorQuickActions(): void {
    try {
      const isListPage =
        document.querySelector('.movie-list') !== null ||
        window.location.pathname.match(/\/(list|new|rank|tag|search)\b/) !== null ||
        window.location.search.includes('list=1');
      if (!isListPage) return;
      // 穿透已开启（initialize 仅在 config.enabled 时调用）；
      // ensureInit 幂等，列表/影片两条路径互不重复初始化
      void actorQuickActionsManager.ensureInit('list');
    } catch (e) {
      log('initListPageActorQuickActions failed:', e);
    }
  }

  private enqueueActorPenetration(
    item: HTMLElement,
    videoInfo: { code: string; title: string; url: string },
  ): void {
    if (!this.config.enableActorPenetration) return;
    if (!videoInfo.code) return;

    this.ensureActorRowStyles();
    // 首次进入穿透时预热名称标识数据（演员索引 + 订阅），不阻塞入队；
    // 就绪后重放已渲染行，为标识缺失的卡片补全着色
    if (
      !this.actorNameMarkPrepped &&
      this.config.enableActorNameMarks !== false &&
      this.config.enableActorPenetration === true
    ) {
      this.actorNameMarkPrepped = true;
      void this.warmActorNameMarkData()
        .then(() => this.reapplyActorRowMarksIfReady())
        .catch(err => log('warmActorNameMarkData failed:', err));
    }

    const run = () => {
      if (!item.isConnected) return;
      this.actorPenetration
        .process({ item, code: videoInfo.code, detailUrl: videoInfo.url })
        .catch(err => log('actorPenetration process failed:', err));
    };

    // 复用可见性门控：卡片进入视口附近才触发详情请求
    if (this.actorVisibilityGate.defer(item, run)) {
      countContentPerformanceEvent('actorPenetration.deferred');
      return;
    }
    run();
  }

  private isActorHidingEnabled(): boolean {
    return !!this.config.hideBlacklistedActorsInList || !!this.config.hideNonFavoritedActorsInList;
  }

  /** 名称标识数据变化/预热完成后，重放已渲染的穿透行以刷新/清除着色。 */
  private reapplyActorRowMarks(): void {
    document.querySelectorAll<HTMLElement>('.movie-list .item').forEach(item => {
      const container = item.querySelector<HTMLElement>('.x-ap-actor-row-container');
      if (!container) return;
      const info = extractListItemVideoInfo(item);
      if (!info?.code) return;
      // 命中缓存时 process 不会重新 fetch，直接重渲染；未命中则走正常穿透流程
      this.actorPenetration
        .process({ item, code: info.code, detailUrl: info.url })
        .catch(err => log('actorPenetration reapply failed:', err));
    });
  }

  // ====== 基于演员的隐藏逻辑 ======
  private async applyActorBasedHiding(item: HTMLElement, videoInfo: { code: string; title: string; url: string }): Promise<void> {
    await applyActorBasedHiding({
      item,
      videoInfo,
      hideByBlacklist: !!this.config.hideBlacklistedActorsInList,
      hideByNonFavorited: !!this.config.hideNonFavoritedActorsInList,
      hideUnrecognized: this.config.hideUnrecognizedActorsInList !== false,
      treatSubscribedAsFavorited: this.config.treatSubscribedAsFavorited !== false,
      ensureActorIndex: () => this.actorDataCache.ensureActorIndex(),
      ensureSubscriptions: () => this.actorDataCache.ensureSubscriptions(),
      getActorById: id => this.actorDataCache.getActorById(id),
      hideItemByActor: hideListItemByActor,
      clearActorOnlyHiding: clearListItemActorHiding,
      logger: (...args) => log(...args),
    });
  }

  /** 依据当前开关对所有列表卡片重算隐藏（状态/VR/演员/关键字等来源）。 */
  public recomputeAllListHiding(): void {
    const enablement = readListHidingEnablement(_STATE.settings);
    document.querySelectorAll<HTMLElement>('.movie-list .item').forEach(item => {
      recomputeListHiding(item, enablement);
    });
  }

  // 对外暴露：重应用当前页面所有条目的演员隐藏规则
  public reapplyActorHidingForAll(): void {
    try {
      this.actorVisibilityGate.cancelAll();
      this.actorWorkQueue.clearPending();
      const items = document.querySelectorAll('.movie-list .item');
      items.forEach((el) => {
        const item = el as HTMLElement;
        const info = extractListItemVideoInfo(item);
        if (!info) return;
        this.enqueueActorEnhancement(item, info, true);
      });
    } catch (e) {
      log('reapplyActorHidingForAll failed:', e);
    }
  }

  private enhanceClicks(item: HTMLElement, videoInfo: { code: string; title: string; url: string }): void {
    this.listClickDelegator.attach(item, {
      videoInfo,
      enableRightClickBackground: this.config.enableRightClickBackground,
      navigateTo: url => {
        window.location.href = url;
      },
      openFc2Dialog: async (movieId, code, url) => {
        const { fc2BreakerService } = await import('../fc2Breaker');
        await fc2BreakerService.showFC2Dialog(movieId, code, url);
      },
      sendRuntimeMessage: message => chrome.runtime.sendMessage(message),
      showToast,
      openWindow: url => {
        window.open(url, '_blank');
      },
      logger: (...args) => log(...args),
      now: () => performance.now(),
      setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
    });
  }

  private enhanceVideoPreview(item: HTMLElement, videoInfo: { code: string; title: string; url: string }): void {
    const coverElement = item.querySelector('.cover') as HTMLElement;
    if (!coverElement) return;

    countContentPerformanceEvent('listEnhancement.previewAttach');
    this.previewHoverController.attach(coverElement, videoInfo);
  }

  private optimizeListItem(item: HTMLElement, videoInfo: { code: string; title: string; url: string }): void {
    optimizeListItemTitle(item, videoInfo);
  }

  private initScrollPaging(): void {
    this.scrollPagingController.init();
  }

  private cleanupScrollPaging(): void {
    this.scrollPagingController.cleanup();
  }
}

export const listEnhancementManager = new ListEnhancementManager();

// 添加必要的CSS样式
function injectStyles(): void {
  const styleId = 'list-enhancement-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = LIST_ENHANCEMENT_BASE_STYLES;

  document.head.appendChild(style);
}

// 自动注入样式
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else {
    injectStyles();
  }
}
