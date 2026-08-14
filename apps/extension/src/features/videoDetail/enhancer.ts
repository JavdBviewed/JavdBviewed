/**
 * @file enhancer.ts
 * @description enhancer
 * @module features/videoDetail
 */
// 视频详情页增强功能

import { defaultDataAggregator } from '../dataAggregator';
import { aiService } from '../ai';
import { showToast } from '../../platform/browser/toast';
import { VideoMetadata, ImageData } from '../dataAggregator/types';
import { STATE, log } from '../contentState';
import { extractVideoIdFromPage } from '../../platform/browser';
import { reviewBreakerService, ReviewData } from '../reviewUnlock';
import { relatedListsService, RelatedListItem } from '../relatedLists';
import { fc2BreakerService, FC2VideoInfo } from '../fc2Breaker';
import { saveSubtaskDetail, yieldToMainThread } from '../../platform/tasks';
import { initOrchestrator } from '../../apps/content/orchestrator';
import { getUserTriggeredHeavyTaskScheduling } from './schedulingMode';
import { showEnhancementDone } from '../../platform/browser/enhancementLoadingIndicator';
import { getJavdbTheme, isDarkTheme, type JavdbTheme } from '../../platform/browser/domUtils';
import { addTaskUrlsV2 } from '../drive115/router';
import { enhanceReviewCodeRecognition as enhanceReviewCodeRecognitionInRoot } from './ui/reviewCodeRecognition';
import {
  activatePreviewVideoPreload,
  releasePreviewVideoMedia,
  attachNativeJavdbPreview,
  isAttachedNativeJavdbPreview,
  restoreNativeJavdbPreview,
  createPreviewCacheEntry,
  getPreviewSourceType,
  isKnownBadVbgflPreviewUrl,
  isVbgflPondoCode,
  normalizePreviewUrl,
  parsePreviewCacheEntry,
  serializePreviewCacheEntry,
  type PreviewSourceName,
} from '../previews';

const RELATED_LISTS_PAGE_SIZE = 10;

export interface EnhancementOptions {
  enableCoverImage: boolean;
  enableTranslation: boolean;
  showLoadingIndicator: boolean;
  enableReviewBreaker: boolean;
  enableFC2Breaker: boolean;
  enableReviewEnhancement: boolean;
  enableReviewMagnetLinkify: boolean;
  enableReviewPush115: boolean;
  enableRelatedLists: boolean;
  enableVideoPreview: boolean; // 🆕 视频预览功能
}

export class VideoDetailEnhancer {
  private videoId: string | null = null;
  private enhancedData: VideoMetadata | null = null;
  private options: EnhancementOptions;
  private translationCache = new Map<string, { translated: string; ts: number }>();
  private static readonly TITLE_TRANSLATION_TTL_MS = 24 * 60 * 60 * 1000;
  private coreInitialized = false;
  private coreInitializedForVideoId: string | null = null;
  // 🆕 视频预览相关属性
  private previewTimer: number | null = null;
  private currentPlayingVideo: HTMLVideoElement | null = null;
  

  constructor(options: Partial<EnhancementOptions> = {}) {
    this.options = {
      enableCoverImage: true,
      enableTranslation: true,
      showLoadingIndicator: true,
      enableReviewBreaker: true,
      enableFC2Breaker: true,
      enableReviewEnhancement: false,
      enableReviewMagnetLinkify: true,
      enableReviewPush115: true,
      enableRelatedLists: true,
      enableVideoPreview: true, // 🆕 默认启用视频预览
      ...options,
    };
    
    // 🆕 注入视频预览样式
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.injectVideoPreviewStyles());
      } else {
        this.injectVideoPreviewStyles();
      }
    }
  }

  /**
   * 根据当前设置更新增强选项
   */
  public applyOptionsFromSettings(): void {
    try {
      const cfg = STATE.settings?.videoEnhancement;
      if (!cfg) return;
      this.options.enableCoverImage = cfg.enableCoverImage !== false;
      this.options.enableTranslation = cfg.enableTranslation !== false;
      this.options.showLoadingIndicator = cfg.showLoadingIndicator !== false;
      this.options.enableReviewBreaker = cfg.enableReviewBreaker === true;
      this.options.enableFC2Breaker = cfg.enableFC2Breaker === true;
      this.options.enableReviewEnhancement = cfg.enableReviewEnhancement === true;
      this.options.enableReviewMagnetLinkify = cfg.enableReviewMagnetLinkify !== false;
      this.options.enableReviewPush115 = cfg.enableReviewPush115 !== false;
      this.options.enableRelatedLists = (cfg as any).enableRelatedLists !== false;
      // 🆕 从列表增强配置中读取视频预览设置（详情页专用）
      const listCfg = STATE.settings?.listEnhancement;
      this.options.enableVideoPreview = listCfg?.enableVideoPreview !== false && listCfg?.enableVideoPreviewDetail !== false;
    } catch {}
  }

  private applyTranslatedTitle(titleEl: HTMLElement, original: string, translated: string, mode: string): void {
    if (mode === 'replace') {
      titleEl.textContent = translated;
      return;
    }
    const dark = isDarkTheme();
    const existing = titleEl.parentElement?.querySelector('.enhanced-translation') as HTMLElement | null;
    if (existing) {
      const label = existing.querySelector('[data-translation-label]') as HTMLElement | null;
      const content = existing.querySelector('[data-translation-content]') as HTMLElement | null;
      if (label) label.textContent = '中文翻译';
      if (content) {
        content.textContent = translated;
        content.style.cssText = `
          font-size: 16px;
          color: ${dark ? '#e0e0e0' : '#333'};
          line-height: 1.4;
        `;
      }
      existing.style.borderLeftColor = '#4CAF50';
      existing.removeAttribute('data-translation-state');
      existing.setAttribute('data-original-title', original);
    } else {
      const container = this.createTranslationContainer(original, translated);
      titleEl.parentElement?.insertBefore(container, titleEl.nextSibling);
    }
  }

  /**
   * 针对影片详情页标题 .current-title 的定点翻译
   */
  private async translateCurrentTitleIfNeeded(): Promise<void> {
    try {
      const settings = STATE.settings;
      const enabledByGlobal = !!settings?.dataEnhancement?.enableTranslation;
      if (!enabledByGlobal) return;
      console.log('[Translation] Enable check (global only):', { enabledByGlobal });

      // 当 targets 未配置时，默认启用 currentTitle 翻译；只有明确为 false 才禁用
      const targetEnabled = settings.translation?.targets
        ? (settings.translation.targets.currentTitle !== false)
        : true;
      if (!targetEnabled) {
        log('[Translation] current-title target is disabled by settings. Skipping.');
        return;
      }

      log('[Translation] Trying to translate .current-title ...');
      saveSubtaskDetail({
        label: 'videoEnhancement:translateCurrentTitle:prepare',
        parentLabel: 'videoEnhancement:translateCurrentTitle',
        subtaskLabel: 'prepare',
        phase: 'deferred',
        status: 'done',
        durationMs: 0,
      });
      // 查找页面中的 current-title 元素（带等待重试）
      const titleEl = await this.waitForElement('h2.title.is-4 .current-title', 3000, 300) as HTMLElement | null;
      if (!titleEl) {
        log('[Translation] .current-title not found after waiting. Skip translating.');
        return;
      }

      const original = titleEl.textContent?.trim() || '';
      if (!original) return;

      // 根据 provider 选择翻译方式（AI 前置校验：是否启用且选择了模型）
      const provider = settings.translation?.provider || 'traditional';
      console.log('[Translation] Provider selected:', provider, 'Original text:', original);
      console.log('[Translation] Translation settings:', settings.translation);
      console.log('[Translation] Data enhancement settings:', settings.dataEnhancement);
      
      if (provider === 'ai') {
        const ai = aiService.getSettings();
        console.log('[Translation] AI settings check:', {
          enabled: ai.enabled,
          hasApiKey: !!ai.apiKey,
          selectedModel: ai.selectedModel
        });
        
        if (!ai.enabled) {
          console.error('[Translation] AI service not enabled');
          showToast('标题翻译失败：AI 功能未启用，请在"AI 设置"中开启', 'error');
          return;
        }
        if (!ai.apiKey) {
          console.error('[Translation] No API key configured');
          showToast('标题翻译失败：未配置 API Key，请在"AI 设置"中填写', 'error');
          return;
        }
        if (!ai.selectedModel) {
          console.error('[Translation] No model selected');
          showToast('标题翻译失败：未选择模型，请在"AI 设置"中选择模型', 'error');
          return;
        }
        console.log('[Translation] AI validation passed, proceeding with translation');
      }

      const cacheKey = `${provider}:${original}`;
      const cached = this.translationCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < VideoDetailEnhancer.TITLE_TRANSLATION_TTL_MS) {
        const mode = settings.translation?.displayMode || 'append';
        this.applyTranslatedTitle(titleEl, original, cached.translated, mode);
        return;
      }

      const existingTranslation = titleEl.parentElement?.querySelector('.enhanced-translation');
      if (existingTranslation && existingTranslation.getAttribute('data-translation-state') !== 'pending') {
        log('[Translation] existing translated title found, skip duplicate render.');
        return;
      }

      await yieldToMainThread(0);
      saveSubtaskDetail({
        label: 'videoEnhancement:translateCurrentTitle:request',
        parentLabel: 'videoEnhancement:translateCurrentTitle',
        subtaskLabel: 'request',
        phase: 'deferred',
        status: 'done',
        durationMs: 0,
      });
      console.log('[Translation] Calling translation service...');
      const resp = provider === 'ai'
        ? await defaultDataAggregator.translateTextWithAI(original)
        : await defaultDataAggregator.translateText(original);

      console.log('[Translation] Translation response:', resp);

      if (!resp.success || !resp.data?.translatedText) {
        const reason = resp.error || '翻译失败';
        console.error('[Translation] Translation failed:', reason);
        showToast(`标题翻译失败：${reason}`, 'error');
        return;
      }
      const translated = resp.data.translatedText;
      this.translationCache.set(cacheKey, { translated, ts: Date.now() });
      // 控制台输出：显示使用的提供方与引擎/模型，以及原文与译文，方便确认来源
      try {
        const engine = resp.data.service || provider;
        // 单行可读输出，避免只显示 "Object" 的情况
        console.log(
          `[Title Translation] provider=${provider} engine=${engine} source=${resp.source} cached=${resp.cached === true} original="${original}" translated="${translated}"`
        );
      } catch {}

      // 显示方式：append（保留原文，追加显示）或 replace（替换原文）
      const mode = settings.translation?.displayMode || 'append';
      await yieldToMainThread(0);
      saveSubtaskDetail({
        label: 'videoEnhancement:translateCurrentTitle:render',
        parentLabel: 'videoEnhancement:translateCurrentTitle',
        subtaskLabel: 'render',
        phase: 'deferred',
        status: 'done',
        durationMs: 0,
      });
      this.applyTranslatedTitle(titleEl, original, translated, mode);
      log('[Translation] current-title translated successfully.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showToast(`标题翻译失败：${msg}`, 'error');
      log('Error translating current-title:', error);
    }
  }

  // 等待元素出现的辅助方法
  private async waitForElement(selector: string, timeoutMs = 3000, intervalMs = 200): Promise<Element | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return null;
  }

  /**
   * 初始化详情页增强
   */
  async initialize(): Promise<void> {
    try {
      await this.initCore();
      await this.loadEnhancedData();
      await this.runCurrentTitleTranslation();
      await this.applyEnhancements();
      this.hideLoadingIndicator();
      log('Video detail enhancement completed');
    } catch (error) {
      log('Error enhancing video detail:', error);
      this.hideLoadingIndicator();
    }
  }

  /**
   * 轻量核心初始化：应用选项、解析 videoId、展示加载指示器、挂载轻量交互。
   */
  async initCore(): Promise<void> {
    this.applyOptionsFromSettings();
    const currentVideoId = extractVideoIdFromPage();
    if (!currentVideoId) {
      log('No video ID found, skipping enhancement');
      return;
    }

    this.videoId = currentVideoId;
    if (this.coreInitialized && this.coreInitializedForVideoId === currentVideoId) {
      return;
    }

    log(`Enhancing video detail page (core) for: ${this.videoId}`);

    // 相关点击增强是 initCore 内联副作用，不再伪造独立 managed 任务 label
    this.enhanceRelatedVideoClicks();
    this.prepareRelatedListsInterception();

    this.coreInitialized = true;
    this.coreInitializedForVideoId = currentVideoId;
  }

  async loadEnhancedData(): Promise<void> {
    if (!this.videoId) return;
    this.enhancedData = await defaultDataAggregator.getEnhancedVideoInfo(this.videoId);
  }

  async runCurrentTitleTranslation(): Promise<void> {
    await this.translateCurrentTitleIfNeeded();
  }

  public async insertTranslationPlaceholder(): Promise<void> {
    try {
      const settings = STATE.settings;
      if (!settings?.dataEnhancement?.enableTranslation) return;
      const targetEnabled = settings.translation?.targets
        ? (settings.translation.targets.currentTitle !== false)
        : true;
      if (!targetEnabled) return;

      const titleEl = await this.waitForElement('h2.title.is-4 .current-title', 3000, 300) as HTMLElement | null;
      if (!titleEl) return;

      if (titleEl.parentElement?.querySelector('.enhanced-translation')) return;

      const container = document.createElement('div');
      container.className = 'enhanced-translation';
      container.setAttribute('data-translation-state', 'pending');
      const dark = isDarkTheme();
      container.style.cssText = `
        margin: 10px 0;
        padding: 12px;
        background: ${dark ? 'linear-gradient(135deg, #2a2a2a 0%, #3a3a4a 100%)' : 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)'};
        border-radius: 8px;
        border-left: 4px solid #9e9e9e;
      `;

      const label = document.createElement('div');
      label.setAttribute('data-translation-label', '');
      label.textContent = '标题翻译';
      label.style.cssText = `
        font-size: 12px;
        color: ${dark ? '#aaa' : '#666'};
        margin-bottom: 5px;
        font-weight: bold;
      `;

      const linkColor = dark ? '#64b5f6' : '#1976d2';
      const linkHover = dark ? '#90caf9' : '#0d47a1';
      const btn = document.createElement('div');
      btn.setAttribute('data-translation-content', '');
      btn.textContent = '点击翻译';
      btn.style.cssText = `
        font-size: 14px;
        color: ${linkColor};
        cursor: pointer;
        display: inline-block;
        padding: 2px 0;
        border-bottom: 1px dashed ${linkColor};
        line-height: 1.4;
      `;
      btn.onmouseenter = () => { btn.style.color = linkHover; btn.style.borderBottomColor = linkHover; };
      btn.onmouseleave = () => { btn.style.color = linkColor; btn.style.borderBottomColor = linkColor; };
      btn.onclick = async () => {
        btn.textContent = '翻译中...';
        btn.style.cursor = 'default';
        btn.style.color = dark ? '#666' : '#999';
        btn.style.borderBottomColor = dark ? '#666' : '#999';
        btn.onclick = null;
        btn.onmouseenter = null;
        btn.onmouseleave = null;
        await this.runCurrentTitleTranslation();
      };

      container.appendChild(label);
      container.appendChild(btn);
      titleEl.parentElement?.insertBefore(container, titleEl.nextSibling);
    } catch (error) {
      log('Error inserting translation placeholder:', error);
    }
  }

  public async refreshTranslationFromSettings(): Promise<void> {
    this.applyOptionsFromSettings();
    // Only re-translate if a real translation is already showing; leave placeholder as-is
    const existing = document.querySelector('.enhanced-translation');
    if (existing && existing.getAttribute('data-translation-state') !== 'pending') {
      await this.runCurrentTitleTranslation();
    }
  }

  /**
   * 单独运行封面增强（供外部编排 deferred 调用）
   */
  async runCover(): Promise<void> {
    // 如果有增强数据且启用了封面增强，则处理高质量封面
    if (this.enhancedData && this.options.enableCoverImage && this.enhancedData.images) {
      await this.enhanceCoverImage(this.enhancedData.images);
    }
    
    // 🆕 即使没有增强数据，也为原生封面添加视频预览功能
    if (this.options.enableVideoPreview && this.videoId) {
      this.enhanceNativeCoverPreview();
    }
  }

  /**
   * 单独运行标题增强（聚合层译文展示，避免与定点翻译重复）
   */
  async runTitle(): Promise<void> {
    if (!this.enhancedData) return;
    if (this.options.enableTranslation && this.enhancedData.translatedTitle) {
      const alreadyHasTranslation = document.querySelector('.enhanced-translation');
      if (!alreadyHasTranslation) {
        await this.enhanceTitle(this.enhancedData.translatedTitle);
      }
    }
  }

  /**
   * 单独运行破解评论区功能
   */
  async runReviewBreaker(): Promise<void> {
    log('[ReviewBreaker] runReviewBreaker entered', {
      videoId: this.videoId,
      enabled: this.options.enableReviewBreaker,
      pathname: window.location.pathname,
    });
    if (!this.videoId || !this.options.enableReviewBreaker) return;
    
    try {
      log('[ReviewBreaker] Binding review enhancement trigger');
      await this.enhanceReviews(this.videoId);
    } catch (error) {
      log('[ReviewBreaker] Error enhancing reviews:', error);
    }
  }

  /**
   * 单独运行FC2拦截破解功能
   */
  async runFC2Breaker(): Promise<void> {
    if (!this.videoId || !this.options.enableFC2Breaker) return;
    
    if (!fc2BreakerService.isFC2Video(this.videoId)) {
      log('[FC2Breaker] Not an FC2 video, skipping');
      return;
    }

    try {
      log('[FC2Breaker] Starting FC2 enhancement');
      await this.enhanceFC2Video(this.videoId);
    } catch (error) {
      log('[FC2Breaker] Error enhancing FC2 video:', error);
    }
  }

  /**
   * 单独运行相关清单解锁功能
   */
  async runRelatedLists(): Promise<void> {
    log('[RelatedLists] runRelatedLists entered', {
      videoId: this.videoId,
      enabled: this.options.enableRelatedLists,
      pathname: window.location.pathname,
    });
    if (!this.videoId || !this.options.enableRelatedLists) return;

    try {
      await this.enhanceRelatedLists(this.videoId);
    } catch (error) {
      log('[RelatedLists] Error enhancing related lists:', error);
    }
  }

  private prepareRelatedListsInterception(): void {
    if (!this.videoId || !this.options.enableRelatedLists) return;

    const movieId = window.location.pathname.split('/').pop()?.split(/[?#]/)[0];
    if (!movieId) {
      log('[RelatedLists] prepare interception skipped: movieId not found', {
        pathname: window.location.pathname,
      });
      return;
    }

    const listTab = this.findRelatedListsTab();
    log('[RelatedLists] prepare interception', {
      movieId,
      pathname: window.location.pathname,
      tabFound: !!listTab,
      panelFound: !!document.getElementById('jdb-related-lists-panel'),
    });
    if (listTab) {
      this.neutralizeRelatedListsTab(listTab);
    }
    this.bindRelatedListsTabInterception(null, movieId);
  }

  /**
   * 外部编排结束时可显式调用，统一隐藏加载指示器
   */
  finish(): void {
    if (this.options.showLoadingIndicator) {
      showEnhancementDone();
    }
  }

  /**
   * 应用所有增强功能
   */
  private async applyEnhancements(): Promise<void> {
    if (!this.enhancedData) return;

    const promises: Promise<void>[] = [];

    if (this.options.enableCoverImage && this.enhancedData.images) {
      promises.push(this.enhanceCoverImage(this.enhancedData.images));
    }

    if (this.options.enableTranslation && this.enhancedData.translatedTitle) {
      // 如果已通过 current-title 定点翻译插入了翻译块，则避免再次使用聚合层的缓存译文，防止重复
      const alreadyHasTranslation = document.querySelector('.enhanced-translation');
      if (!alreadyHasTranslation) {
        promises.push(this.enhanceTitle(this.enhancedData.translatedTitle));
      }
    }

    await Promise.all(promises);
  }

  /**
   * 增强封面图片
   */
  private async enhanceCoverImage(images: ImageData[]): Promise<void> {
    try {
      const coverImage = images.find(img => img.type === 'cover' && img.quality === 'high') ||
                        images.find(img => img.type === 'cover') ||
                        images[0];

      if (!coverImage) return;

      // 查找现有的封面图片元素
      const existingCover = document.querySelector('.video-cover img, .cover img, .poster img, img[src*="cover"]') as HTMLImageElement;
      
      if (existingCover) {
        // 创建增强的封面图片容器
        const enhancedContainer = this.createEnhancedCoverContainer(coverImage, existingCover.src);
        
        // 替换现有封面
        const parent = existingCover.parentElement;
        if (parent) {
          parent.insertBefore(enhancedContainer, existingCover);
          existingCover.style.display = 'none';
        }
      } else {
        // 如果没有现有封面，创建新的封面区域
        this.createNewCoverArea(coverImage);
      }

      log('Cover image enhanced');
    } catch (error) {
      log('Error enhancing cover image:', error);
    }
    
    // 注意：不在这里调用 enhanceNativeCoverPreview()，由 runCover() 统一处理
  }

  /**
   * 🆕 为原生封面元素添加视频预览功能
   */
  private enhanceNativeCoverPreview(): void {
    try {
      // 查找原生的封面容器
      const nativeCoverContainer = document.querySelector('.column-video-cover') as HTMLElement;
      
      if (!nativeCoverContainer || !this.videoId) {
        return;
      }

      // 如果已经有增强容器，则跳过
      if (nativeCoverContainer.querySelector('.enhanced-cover-container')) {
        return;
      }

      // 添加预览类
      nativeCoverContainer.classList.add('x-cover', 'x-preview');
      
      // 确保容器有正确的定位和尺寸
      const computedStyle = window.getComputedStyle(nativeCoverContainer);
      if (computedStyle.position === 'static') {
        nativeCoverContainer.style.position = 'relative';
      }
      
      // 🆕 确保容器有明确的尺寸，避免视频错位
      // 获取封面图片的实际尺寸
      const coverImg = nativeCoverContainer.querySelector('img') as HTMLImageElement;
      if (coverImg) {
        // 等待图片加载完成后设置容器尺寸
        if (coverImg.complete) {
          this.setContainerSize(nativeCoverContainer, coverImg);
        } else {
          coverImg.addEventListener('load', () => {
            this.setContainerSize(nativeCoverContainer, coverImg);
          });
        }
      }

      // 添加视频预览功能
      this.enhanceVideoPreview(nativeCoverContainer, this.videoId);
      
      log('Native cover preview enhanced');
    } catch (error) {
      log('Error enhancing native cover preview:', error);
    }
  }

  /**
   * 🆕 设置容器尺寸以匹配封面图片
   */
  private setContainerSize(container: HTMLElement, img: HTMLImageElement): void {
    try {
      // 使用图片的显示尺寸（而非自然尺寸）
      const width = img.offsetWidth || img.clientWidth;
      const height = img.offsetHeight || img.clientHeight;
      
      if (width > 0 && height > 0) {
        container.style.width = `${width}px`;
        container.style.height = `${height}px`;
        container.style.overflow = 'hidden';
        log(`Container size set to: ${width}x${height}`);
      }
    } catch (error) {
      log('Error setting container size:', error);
    }
  }

  /**
   * 增强标题翻译
   */
  private async enhanceTitle(translatedTitle: string): Promise<void> {
    try {
      // 查找标题元素 - 更新为JavDB的实际结构
      const titleElements = document.querySelectorAll('h2.title.is-4 .current-title, h2.title.is-4, h1, .title, .video-title, .movie-title');
      for (let i = 0; i < titleElements.length; i++) {
        const titleElement = titleElements[i] as HTMLElement;
        const originalTitle = titleElement.textContent?.trim();
        if (originalTitle && originalTitle.length > 5) {
          const translationContainer = this.createTranslationContainer(originalTitle, translatedTitle);
          titleElement.parentElement?.insertBefore(translationContainer, titleElement.nextSibling);
          break;
        }
      }

      log('Title translation enhanced');
    } catch (error) {
      log('Error enhancing title translation:', error);
    }
  }

  /**
   * 增强评论区功能
   */
  private async enhanceReviews(_videoId: string): Promise<void> {
    try {
      this.injectReviewBreakerStyles();
      // 从URL中提取movieId（例如：https://javdb.com/v/NQ6pPb -> NQ6pPb）
      const movieId = window.location.pathname.split('/').pop()?.split(/[?#]/)[0];
      if (!movieId) {
        log('[ReviewBreaker] Failed to extract movieId from URL');
        return;
      }
      log(`[ReviewBreaker] Extracted movieId from URL: ${movieId}`);

      // 先监听短评标签的点击事件，点击时立即显示加载提示
      const reviewTab = document.querySelector([
        '.movie-panel-info a[data-movie-tab-target="reviews"]',
        'a[href="#reviews"]',
        'a[data-movie-tab-target="reviews"]',
        '.tabs a[href="#reviews"]',
        '.tab a[href="#reviews"]',
        'a[href*="reviews"]',
      ].join(', ')) as HTMLElement | null;

      log('[ReviewBreaker] review tab probe', {
        found: !!reviewTab,
        pathname: window.location.pathname,
        reviewRootExists: !!document.querySelector('#reviews, div[data-movie-tab-target="reviews"]'),
      });
      
      const scheduleReviewBreaking = (trigger: HTMLElement) => {
        const flag = '__jdb_review_breaker_scheduled__';
        if ((trigger as any)[flag]) return;
        (trigger as any)[flag] = true;
        const invokeBreaker = () => {
          const runFlag = '__jdb_review_breaker_running__';
          if ((window as any)[runFlag]) return;
          (window as any)[runFlag] = true;
          const scheduling = getUserTriggeredHeavyTaskScheduling();
          initOrchestrator.add(scheduling.phase, async () => {
            try {
              log('[ReviewBreaker] Review tab clicked, showing loading indicator immediately');
              const earlyLoadingIndicator = this.createEarlyLoadingIndicator();
              document.body.appendChild(earlyLoadingIndicator);
              const reviewsRoot = (await this.waitForElement('div[data-movie-tab-target="reviews"], #reviews', 6000, 200)) as HTMLElement | null;
              earlyLoadingIndicator.remove();
              if (!reviewsRoot) {
                log('[ReviewBreaker] Native #reviews container not found, skip.');
                return;
              }
              await this.processReviewBreaking(reviewsRoot, movieId);
            } finally {
              (window as any)[runFlag] = false;
            }
          }, {
            label: 'videoEnhancement:runReviewBreaker:click',
            priority: scheduling.priority,
            visibilityPolicy: scheduling.visibilityPolicy,
            delayMs: 0,
          });
        };

        trigger.addEventListener('click', () => {
          log('[ReviewBreaker] Review tab clicked, showing loading indicator immediately');
          invokeBreaker();
        }, { once: true });

        const observerFlag = '__jdb_review_breaker_observer__';
        if (!(window as any)[observerFlag]) {
          (window as any)[observerFlag] = true;
          const observer = new MutationObserver(() => {
            const reviewsRoot = document.querySelector('div[data-movie-tab-target="reviews"], #reviews') as HTMLElement | null;
            if (!reviewsRoot) return;
            const isVisible = reviewsRoot.offsetParent !== null || reviewsRoot.classList.contains('is-active') || reviewsRoot.getAttribute('aria-hidden') === 'false';
            if (!isVisible) return;
            const hasNativeItems = reviewsRoot.querySelectorAll('.review-item').length > 0 || /短評|评论|評論/.test(reviewsRoot.textContent || '');
            if (!hasNativeItems) return;
            log('[ReviewBreaker] Reviews container activated, invoking breaker fallback');
            observer.disconnect();
            invokeBreaker();
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
        }
      };

      if (reviewTab) {
        log('[ReviewBreaker] Found review tab, binding click trigger');
        scheduleReviewBreaking(reviewTab);
      } else {
        log('[ReviewBreaker] Review tab not found, will try alternative selectors');
        // 尝试其他可能的选择器
        const altReviewTab = document.querySelector([
          'a[href*="reviews"]',
          '.review-tab',
          '[data-tab="reviews"]',
          '[data-movie-tab-target="reviews"]',
          '#tabs-container a',
        ].join(', ')) as HTMLElement | null;
        if (altReviewTab) {
          log('[ReviewBreaker] Found alternative review tab', { text: altReviewTab.textContent?.trim(), href: (altReviewTab as HTMLAnchorElement).getAttribute?.('href') });
          scheduleReviewBreaking(altReviewTab);
        } else {
          log('[ReviewBreaker] No review tab selector matched');
        }
      }
    } catch (error) {
      log('[ReviewBreaker] Error enhancing reviews:', error);
      showToast('评论区增强失败', 'error');
    }
  }

  /**
   * 增强相关清单标签页，使用 JAV-JHS/JavdbBuddy 同源 API 解锁完整清单。
   */
  private async enhanceRelatedLists(_videoId: string): Promise<void> {
    const movieId = window.location.pathname.split('/').pop()?.split(/[?#]/)[0];
    if (!movieId) {
      log('[RelatedLists] Failed to extract movieId from URL');
      return;
    }

    const listTab = this.findRelatedListsTab();
    if (listTab) {
      this.neutralizeRelatedListsTab(listTab);
    }

    const relatedPanel = await this.ensureRelatedListsPanel();
    if (!relatedPanel) {
      log('[RelatedLists] #tabs-container not found');
      return;
    }

    this.bindRelatedListsTabInterception(relatedPanel, movieId);

    const existingRoot = document.querySelector('div[data-movie-tab-target="lists"], #lists') as HTMLElement | null;
    if (existingRoot && this.isRelatedListsPanelVisible(existingRoot)) {
      this.activateRelatedListsPanel(relatedPanel, listTab);
      await this.loadRelatedLists(relatedPanel, movieId, 1);
      return;
    }

    const observerFlag = '__jdb_related_lists_tab_observer__';
    if (!(window as any)[observerFlag]) {
      (window as any)[observerFlag] = true;
      const observer = new MutationObserver(() => {
        const nextTab = this.findRelatedListsTab();
        if (nextTab) {
          this.neutralizeRelatedListsTab(nextTab);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-action', 'data-movie-tab-target'] });
    }
  }

  private async ensureRelatedListsPanel(): Promise<HTMLElement | null> {
    const tabsContainer = await this.waitForElement('#tabs-container', 6000, 200) as HTMLElement | null;
    if (!tabsContainer) return null;

    const existing = document.getElementById('jdb-related-lists-panel') as HTMLElement | null;
    if (existing) {
      this.applyRelatedListsTheme(existing);
      this.bindRelatedListsThemeObserver(existing);
      return existing;
    }

    const panel = document.createElement('div');
    panel.id = 'jdb-related-lists-panel';
    panel.className = 'content-panel jdb-related-lists-panel';
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');
    this.applyRelatedListsTheme(panel);
    this.bindRelatedListsThemeObserver(panel);
    tabsContainer.appendChild(panel);
    return panel;
  }

  private bindRelatedListsTabInterception(panel: HTMLElement | null, movieId: string): void {
    const key = '__jdb_related_lists_click_handler__';
    const oldHandler = (window as any)[key] as ((event: MouseEvent) => void) | undefined;
    if (oldHandler) {
      document.removeEventListener('click', oldHandler, true);
    }

    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest('#jdb-related-lists-panel')) return;

      const relatedTab = this.findRelatedListsTabFromTarget(target);
      if (relatedTab) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.neutralizeRelatedListsTab(relatedTab);
        log('[RelatedLists] click intercepted', {
          movieId,
          href: (relatedTab.matches('a') ? relatedTab : relatedTab.querySelector('a'))?.getAttribute('href'),
        });
        void this.openRelatedListsPanel(panel, relatedTab, movieId);
        return;
      }

      if (this.isMovieTabClickTarget(target)) {
        const activePanel = panel || document.getElementById('jdb-related-lists-panel');
        if (activePanel) {
          this.deactivateRelatedListsPanel(activePanel);
        }
      }
    };

    document.addEventListener('click', handler, true);
    (window as any)[key] = handler;
    log('[RelatedLists] click interception installed', {
      movieId,
      eagerPanel: !!panel,
    });
  }

  private async openRelatedListsPanel(panel: HTMLElement | null, tab: HTMLElement, movieId: string): Promise<void> {
    const relatedPanel = panel || await this.ensureRelatedListsPanel();
    if (!relatedPanel) {
      log('[RelatedLists] panel missing after click', {
        movieId,
        tabsContainerFound: !!document.getElementById('tabs-container'),
      });
      return;
    }

    this.activateRelatedListsPanel(relatedPanel, tab);
    await this.loadRelatedLists(relatedPanel, movieId, 1);
  }

  private neutralizeRelatedListsTab(tab: HTMLElement): void {
    const anchors = tab.matches('a')
      ? [tab as HTMLAnchorElement]
      : Array.from(tab.querySelectorAll<HTMLAnchorElement>('a'));
    if (anchors.length > 0 && anchors.every((anchor) => anchor.dataset.jdbRelatedListsOriginalHref)) {
      return;
    }

    const relatedElements = [tab, ...Array.from(tab.querySelectorAll<HTMLElement>('[data-action], [data-movie-tab-target], a'))];
    relatedElements.forEach((el) => {
      el.removeAttribute('data-action');
      if (el.getAttribute('data-movie-tab-target') === 'lists') {
        el.removeAttribute('data-movie-tab-target');
      }
    });

    anchors.forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (href && !anchor.dataset.jdbRelatedListsOriginalHref) {
        anchor.dataset.jdbRelatedListsOriginalHref = href;
      }
      anchor.setAttribute('href', '#jdb-related-lists-panel');
      anchor.setAttribute('data-turbo', 'false');
      anchor.setAttribute('data-turbolinks', 'false');
    });
    log('[RelatedLists] tab neutralized', {
      text: tab.textContent?.trim(),
      href: anchors[0]?.dataset.jdbRelatedListsOriginalHref || anchors[0]?.getAttribute('href') || '',
    });
  }

  private findRelatedListsTabFromTarget(target: HTMLElement): HTMLElement | null {
    const candidate = target.closest<HTMLElement>('li, a, button, [role="tab"], [data-movie-tab-target]');
    if (!candidate || candidate.closest('#jdb-related-lists-panel')) return null;

    // 排除 Bulma modal 触发器按钮（如「存入清單」「看過」「想看」等），
    // 这些按钮虽然包含「清單」字样，但不应被当作 tab 拦截。
    if (this.isBulmaModalTrigger(candidate)) {
      return null;
    }

    const anchor = (candidate.matches('a') ? candidate : candidate.querySelector('a')) as HTMLAnchorElement | null;
    const href = anchor?.getAttribute('href') || '';
    const dataTarget = candidate.getAttribute('data-movie-tab-target')
      || candidate.querySelector<HTMLElement>('[data-movie-tab-target]')?.getAttribute('data-movie-tab-target')
      || '';
    const text = candidate.textContent || '';
    const inMovieTabBar = !!candidate.closest('.tabs, .movie-panel-info, [data-controller*="movie-tab"]');
    const isRelated = dataTarget === 'lists'
      || href.includes('#lists')
      || href.includes('/plans/')
      || /相关清单|相关清單|lists/i.test(text);

    return inMovieTabBar && isRelated ? candidate : null;
  }

  private isBulmaModalTrigger(el: HTMLElement): boolean {
    if (el.matches('[data-target^="modal-"], [data-haspopup="true"], [data-auth="true"]')) {
      return true;
    }
    return !!el.querySelector('[data-target^="modal-"], [data-haspopup="true"]');
  }

  private isMovieTabClickTarget(target: HTMLElement): boolean {
    const candidate = target.closest<HTMLElement>('li, a, button, [role="tab"], [data-movie-tab-target]');
    return !!candidate
      && !candidate.closest('#jdb-related-lists-panel')
      && !!candidate.closest('.tabs, .movie-panel-info, [data-controller*="movie-tab"]');
  }

  private activateRelatedListsPanel(panel: HTMLElement, tab: HTMLElement | null): void {
    this.injectRelatedListsStyles();
    this.applyRelatedListsTheme(panel);
    this.setRelatedListsPanelMode(panel, true);

    document.querySelectorAll<HTMLElement>('div[data-movie-tab-target="lists"], #lists').forEach((nativePanel) => {
      if (nativePanel === panel) return;
      nativePanel.style.display = 'none';
      nativePanel.setAttribute('aria-hidden', 'true');
      nativePanel.classList.remove('is-active');
    });

    document.querySelectorAll<HTMLElement>('.tabs li.is-active').forEach((li) => {
      li.classList.remove('is-active');
    });
    const activeTab = tab?.closest<HTMLElement>('li') || tab;
    activeTab?.classList.add('is-active');
  }

  private deactivateRelatedListsPanel(panel: HTMLElement): void {
    this.setRelatedListsPanelMode(panel, false);
  }

  private setRelatedListsPanelMode(panel: HTMLElement, active: boolean): void {
    const container = panel.parentElement;
    if (!container) return;

    Array.from(container.children).forEach((child) => {
      if (!(child instanceof HTMLElement) || child === panel) return;
      if (active) {
        if (!child.hasAttribute('data-jdb-related-lists-prev-display')) {
          child.setAttribute('data-jdb-related-lists-prev-display', child.style.display || '');
        }
        child.style.display = 'none';
      } else if (child.hasAttribute('data-jdb-related-lists-prev-display')) {
        child.style.display = child.getAttribute('data-jdb-related-lists-prev-display') || '';
        child.removeAttribute('data-jdb-related-lists-prev-display');
      }
    });

    panel.style.display = active ? 'block' : 'none';
    panel.hidden = false;
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  }

  private applyRelatedListsTheme(panel: HTMLElement): JavdbTheme {
    const theme = getJavdbTheme();
    panel.dataset.jdbTheme = theme;
    return theme;
  }

  private bindRelatedListsThemeObserver(panel: HTMLElement): void {
    const key = '__jdb_related_lists_theme_observer__';
    const oldObserver = (window as any)[key] as MutationObserver | undefined;
    oldObserver?.disconnect();

    const observer = new MutationObserver(() => {
      this.applyRelatedListsTheme(panel);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    (window as any)[key] = observer;
  }

  private findRelatedListsTab(): HTMLElement | null {
    const selectors = [
      '.movie-panel-info a[data-movie-tab-target="lists"]',
      'a[href="#lists"]',
      'a[data-movie-tab-target="lists"]',
      '.tabs a[href="#lists"]',
      '.tab a[href="#lists"]',
      '.movie-panel-info a[href*="/plans/"]',
      '.tabs a[href*="/plans/"]',
      '[data-tab="lists"]',
      '[data-movie-tab-target="lists"]',
    ];
    const direct = document.querySelector(selectors.join(', ')) as HTMLElement | null;
    if (direct) return direct;

    const candidates = Array.from(document.querySelectorAll<HTMLElement>('.tabs li, .tabs a, .tab, button, [role="tab"]'));
    return candidates.find((el) => /相关清单|相關清單|清单|清單|lists/i.test(el.textContent || '')) || null;
  }

  private isRelatedListsPanelVisible(panel: HTMLElement): boolean {
    return panel.offsetParent !== null
      || panel.classList.contains('is-active')
      || panel.getAttribute('aria-hidden') === 'false'
      || panel.style.display === 'block';
  }

  private async loadRelatedLists(panel: HTMLElement, movieId: string, page: number): Promise<void> {
    if (panel.dataset.jdbRelatedListsLoading === '1') return;
    const safePage = Math.max(1, Math.round(Number(page) || 1));
    const currentMovieId = panel.dataset.jdbRelatedListsMovieId;
    const currentPage = Number(panel.dataset.jdbRelatedListsCurrentPage || '0');
    if (currentMovieId === movieId && currentPage === safePage && panel.dataset.jdbRelatedListsLoaded === '1') return;

    this.injectRelatedListsStyles();
    this.applyRelatedListsTheme(panel);
    panel.dataset.jdbRelatedListsLoading = '1';
    panel.dataset.jdbRelatedListsMovieId = movieId;
    panel.dataset.jdbRelatedListsCurrentPage = String(safePage);
    panel.dataset.jdbRelatedListsLoaded = '0';
    panel.innerHTML = `
      <div class="jdb-related-lists-status">
        <div class="jdb-related-lists-spinner"></div>
        <span>正在获取第 ${safePage} 页相关清单...</span>
      </div>
    `;

    const startedAt = performance.now();
    log('[RelatedLists] request start', {
      movieId,
      page: safePage,
      pageSize: RELATED_LISTS_PAGE_SIZE,
    });

    try {
      const response = await relatedListsService.getRelatedLists(movieId, safePage, RELATED_LISTS_PAGE_SIZE);
      if (!response.success || !response.data) {
        log('[RelatedLists] request failed', {
          movieId,
          page: safePage,
          durationMs: Math.round(performance.now() - startedAt),
          error: response.error || 'unknown',
        });
        this.renderRelatedListsError(panel, movieId, safePage, response.error || '获取相关清单失败');
        return;
      }

      const pageItems = response.data.slice(0, RELATED_LISTS_PAGE_SIZE);
      const responsePage = response.page || safePage;
      const totalPages = response.totalPages;
      panel.dataset.jdbRelatedListsCurrentPage = String(responsePage);
      panel.innerHTML = `
        <div class="jdb-related-lists-header">
          <div class="jdb-related-lists-title">相关清单</div>
          <div class="jdb-related-lists-page-meta">${this.getRelatedListsPageText(responsePage, pageItems.length, totalPages)}</div>
        </div>
        <div class="jdb-related-lists-banner">已为您解锁全部相关清单，本页显示 ${pageItems.length} 条</div>
        <div class="jdb-related-lists"></div>
      `;

      const listContainer = panel.querySelector<HTMLElement>('.jdb-related-lists') || panel;
      if (pageItems.length === 0) {
        listContainer.innerHTML = '<div class="jdb-related-lists-empty">本页暂无相关清单</div>';
        log('[RelatedLists] request done', {
          movieId,
          page: responsePage,
          durationMs: Math.round(performance.now() - startedAt),
          itemCount: 0,
          totalPages,
        });
        panel.dataset.jdbRelatedListsLoaded = '1';
        this.renderRelatedListsFooter(panel, movieId, responsePage, false, 0, totalPages);
        return;
      }

      this.renderRelatedListItems(listContainer, pageItems, responsePage);
      log('[RelatedLists] request done', {
        movieId,
        page: responsePage,
        durationMs: Math.round(performance.now() - startedAt),
        itemCount: pageItems.length,
        totalPages,
        hasMore: response.hasMore === true,
      });
      panel.dataset.jdbRelatedListsLoaded = '1';
      this.renderRelatedListsFooter(panel, movieId, responsePage, response.hasMore === true, pageItems.length, totalPages);
    } catch (error) {
      log('[RelatedLists] request error', {
        movieId,
        page: safePage,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      this.renderRelatedListsError(panel, movieId, safePage, error instanceof Error ? error.message : String(error));
    } finally {
      panel.dataset.jdbRelatedListsLoading = '0';
    }
  }

  private getRelatedListsPageText(page: number, itemCount: number, totalPages?: number): string {
    return totalPages
      ? `第 ${page} / ${totalPages} 页 · 本页 ${itemCount} 条`
      : `第 ${page} 页 · 本页 ${itemCount} 条`;
  }

  private renderRelatedListItems(container: HTMLElement, items: RelatedListItem[], page: number): void {
    const baseIndex = (page - 1) * RELATED_LISTS_PAGE_SIZE;
    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'jdb-related-list-card';
      card.innerHTML = `
        <div class="jdb-related-list-index">#${baseIndex + index + 1}</div>
        <a class="jdb-related-list-title" href="/lists/${encodeURIComponent(item.relatedId)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(item.name)}</a>
        ${item.description ? `<div class="jdb-related-list-desc">${this.escapeHtml(item.description)}</div>` : ''}
        <div class="jdb-related-list-meta">
          <span>影片 ${item.movieCount}</span>
          <span>收藏 ${item.collectionCount}</span>
          <span>浏览 ${item.viewCount}</span>
          ${item.createTime ? `<span>创建 ${this.escapeHtml(item.createTime)}</span>` : ''}
        </div>
      `;
      container.appendChild(card);
    });
  }

  private renderRelatedListsFooter(panel: HTMLElement, movieId: string, page: number, hasMore: boolean, itemCount: number, totalPages?: number): void {
    panel.querySelector('#jdb-related-lists-footer')?.remove();
    const footer = document.createElement('div');
    footer.id = 'jdb-related-lists-footer';
    footer.className = 'jdb-related-lists-footer';

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.dataset.jdbRelatedPagePrev = '1';
    prevButton.textContent = '上一页';
    prevButton.disabled = page <= 1;
    if (page > 1) {
      prevButton.addEventListener('click', () => {
        void this.loadRelatedLists(panel, movieId, page - 1);
      });
    }

    const pageInfo = document.createElement('div');
    pageInfo.className = 'jdb-related-lists-page-info';
    const pageText = this.getRelatedListsPageText(page, itemCount, totalPages);
    pageInfo.textContent = hasMore ? pageText : `${pageText} · 已到最后一页`;

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.dataset.jdbRelatedPageNext = '1';
    nextButton.textContent = '下一页';
    nextButton.disabled = !hasMore;
    if (hasMore) {
      nextButton.addEventListener('click', () => {
        void this.loadRelatedLists(panel, movieId, page + 1);
      });
    }

    footer.appendChild(prevButton);
    footer.appendChild(pageInfo);
    footer.appendChild(nextButton);
    panel.appendChild(footer);
  }

  private renderRelatedListsError(panel: HTMLElement, movieId: string, page: number, message: string): void {
    this.applyRelatedListsTheme(panel);
    panel.innerHTML = `
      <div class="jdb-related-lists-error">
        <span>${this.escapeHtml(message)}</span>
        <div class="jdb-related-lists-error-actions">
          ${page > 1 ? '<button type="button" data-jdb-related-error-prev>上一页</button>' : ''}
          <button type="button" data-jdb-related-error-retry>重试</button>
        </div>
      </div>
    `;
    const retry = panel.querySelector<HTMLButtonElement>('[data-jdb-related-error-retry]');
    retry?.addEventListener('click', () => {
      void this.loadRelatedLists(panel, movieId, page);
    });
    const prev = panel.querySelector<HTMLButtonElement>('[data-jdb-related-error-prev]');
    prev?.addEventListener('click', () => {
      void this.loadRelatedLists(panel, movieId, page - 1);
    });
  }

  private injectRelatedListsStyles(): void {
    const styleId = 'jdb-related-lists-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .jdb-related-lists-panel[data-jdb-theme="light"] {
        --jdb-rl-panel-bg: #f7fafc;
        --jdb-rl-card-bg: #ffffff;
        --jdb-rl-card-border: rgba(15, 23, 42, 0.10);
        --jdb-rl-card-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
        --jdb-rl-text: #1f2937;
        --jdb-rl-muted: #64748b;
        --jdb-rl-title: #0f73a8;
        --jdb-rl-pill-bg: #eef7ff;
        --jdb-rl-pill-text: #176b98;
        --jdb-rl-surface: #eef2f7;
        --jdb-rl-button-bg: #e1f5fe;
        --jdb-rl-button-text: #0277bd;
        --jdb-rl-button-hover: #c8ecfb;
        --jdb-rl-disabled-bg: #e5e7eb;
        --jdb-rl-disabled-text: #94a3b8;
        --jdb-rl-spinner-track: rgba(2, 119, 189, 0.25);
      }
      .jdb-related-lists-panel[data-jdb-theme="dark"] {
        --jdb-rl-panel-bg: #111827;
        --jdb-rl-card-bg: #1f2937;
        --jdb-rl-card-border: rgba(148, 163, 184, 0.22);
        --jdb-rl-card-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
        --jdb-rl-text: #e5e7eb;
        --jdb-rl-muted: #9ca3af;
        --jdb-rl-title: #7dd3fc;
        --jdb-rl-pill-bg: rgba(14, 165, 233, 0.14);
        --jdb-rl-pill-text: #bae6fd;
        --jdb-rl-surface: rgba(148, 163, 184, 0.12);
        --jdb-rl-button-bg: rgba(14, 165, 233, 0.18);
        --jdb-rl-button-text: #bae6fd;
        --jdb-rl-button-hover: rgba(14, 165, 233, 0.28);
        --jdb-rl-disabled-bg: rgba(148, 163, 184, 0.12);
        --jdb-rl-disabled-text: #64748b;
        --jdb-rl-spinner-track: rgba(186, 230, 253, 0.25);
      }
      .jdb-related-lists-panel {
        padding: 14px;
        border-radius: 12px;
        color: var(--jdb-rl-text);
        background: var(--jdb-rl-panel-bg);
      }
      .jdb-related-lists-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .jdb-related-lists-title {
        color: var(--jdb-rl-text);
        font-size: 16px;
        font-weight: 800;
      }
      .jdb-related-lists-page-meta {
        padding: 4px 10px;
        border-radius: 999px;
        color: var(--jdb-rl-pill-text);
        background: var(--jdb-rl-pill-bg);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }
      .jdb-related-lists-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 10px;
        padding: 10px 12px;
        border: 1px solid var(--jdb-rl-card-border);
        border-radius: 10px;
        color: var(--jdb-rl-text);
        background: var(--jdb-rl-card-bg);
        box-shadow: var(--jdb-rl-card-shadow);
        font-size: 13px;
        font-weight: 700;
      }
      .jdb-related-lists-banner::before {
        content: "✓";
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        color: var(--jdb-rl-button-text);
        background: var(--jdb-rl-button-bg);
        font-size: 12px;
        line-height: 1;
      }
      .jdb-related-lists {
        display: grid;
        gap: 10px;
      }
      .jdb-related-list-card {
        position: relative;
        padding: 12px 14px;
        border: 1px solid var(--jdb-rl-card-border);
        border-radius: 10px;
        color: var(--jdb-rl-text);
        background: var(--jdb-rl-card-bg);
        box-shadow: var(--jdb-rl-card-shadow);
      }
      .jdb-related-list-index {
        position: absolute;
        right: 12px;
        top: 10px;
        color: var(--jdb-rl-muted);
        font-size: 12px;
      }
      .jdb-related-list-title {
        display: inline-block;
        max-width: calc(100% - 52px);
        color: var(--jdb-rl-title);
        font-weight: 700;
        line-height: 1.45;
        text-decoration: none;
      }
      .jdb-related-list-title:hover {
        text-decoration: underline;
      }
      .jdb-related-list-desc {
        margin-top: 6px;
        color: var(--jdb-rl-muted);
        font-size: 13px;
        line-height: 1.45;
      }
      .jdb-related-list-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-top: 8px;
        color: var(--jdb-rl-muted);
        font-size: 12px;
      }
      .jdb-related-list-meta span {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--jdb-rl-surface);
      }
      .jdb-related-lists-footer,
      .jdb-related-lists-empty,
      .jdb-related-lists-status,
      .jdb-related-lists-error {
        margin-top: 12px;
        padding: 12px;
        border-radius: 8px;
        text-align: center;
        color: var(--jdb-rl-muted);
        background: var(--jdb-rl-surface);
      }
      .jdb-related-lists-footer {
        display: grid;
        grid-template-columns: minmax(92px, 1fr) auto minmax(92px, 1fr);
        align-items: center;
        gap: 10px;
      }
      .jdb-related-lists-page-info {
        color: var(--jdb-rl-muted);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }
      .jdb-related-lists-footer button,
      .jdb-related-lists-error button {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        color: var(--jdb-rl-button-text);
        background: var(--jdb-rl-button-bg);
        font-weight: 700;
        transition: background 0.15s ease, opacity 0.15s ease;
      }
      .jdb-related-lists-footer button:hover:not(:disabled),
      .jdb-related-lists-error button:hover:not(:disabled) {
        background: var(--jdb-rl-button-hover);
      }
      .jdb-related-lists-footer button:disabled,
      .jdb-related-lists-error button:disabled {
        cursor: not-allowed;
        color: var(--jdb-rl-disabled-text);
        background: var(--jdb-rl-disabled-bg);
        opacity: 0.85;
      }
      .jdb-related-lists-error button {
        width: auto;
      }
      .jdb-related-lists-error-actions {
        display: flex;
        justify-content: center;
        gap: 10px;
        margin-top: 10px;
      }
      .jdb-related-lists-spinner {
        width: 18px;
        height: 18px;
        margin: 0 auto 8px;
        border: 2px solid var(--jdb-rl-spinner-track);
        border-top-color: var(--jdb-rl-button-text);
        border-radius: 50%;
        animation: jdb-related-lists-spin 0.8s linear infinite;
      }
      @media (max-width: 520px) {
        .jdb-related-lists-panel {
          padding: 10px;
        }
        .jdb-related-lists-header {
          align-items: flex-start;
          flex-direction: column;
        }
        .jdb-related-lists-footer {
          grid-template-columns: 1fr 1fr;
        }
        .jdb-related-lists-page-info {
          grid-column: 1 / -1;
          grid-row: 1;
        }
      }
      @keyframes jdb-related-lists-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 创建早期加载提示（在点击标签时立即显示）
   */
  private createEarlyLoadingIndicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.id = 'jhs-early-loading';
    indicator.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10000;
      padding: 24px 32px;
      background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%);
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 16px;
      animation: fadeIn 0.3s ease-out;
    `;

    // 加载动画
    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 32px;
      height: 32px;
      border: 4px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    `;

    // 文字内容
    const text = document.createElement('div');
    text.style.cssText = `
      color: white;
      font-size: 16px;
      font-weight: bold;
    `;
    text.textContent = '🔓 正在解锁评论...';

    indicator.appendChild(spinner);
    indicator.appendChild(text);

    // 添加动画样式
    if (!document.getElementById('jhs-early-loading-animations')) {
      const style = document.createElement('style');
      style.id = 'jhs-early-loading-animations';
      style.textContent = `
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `;
      document.head.appendChild(style);
    }

    return indicator;
  }

  /**
   * 处理评论破解逻辑
   */
  private async processReviewBreaking(reviewsRoot: HTMLElement, movieId: string): Promise<void> {
    try {
      // 检查是否需要破解：
      // 1. 查找评论总数（从tab标签中提取）
      // 2. 查找实际显示的评论数量
      // 3. 检查是否有VIP提示
      const reviewTab = document.querySelector('.review-tab span') as HTMLElement | null;
      const totalCountMatch = reviewTab?.textContent?.match(/短評\((\d+)\)/);
      const totalCount = totalCountMatch ? parseInt(totalCountMatch[1], 10) : 0;
      
      const nativeReviewItems = reviewsRoot.querySelectorAll('.review-item:not(.more)');
      const displayedCount = nativeReviewItems.length;
      
      const hasVipPrompt = reviewsRoot.querySelector('.review-item.more');
      
      log(`[ReviewBreaker] Review stats: total=${totalCount}, displayed=${displayedCount}, hasVipPrompt=${!!hasVipPrompt}`);
      
      // 如果显示的评论数量等于总数，且没有VIP提示，说明已经全部显示，跳过
      if (displayedCount >= totalCount && !hasVipPrompt) {
        log('[ReviewBreaker] All reviews are already displayed, skip API fetch.');
        return;
      }
      
      // 如果评论数量<=3且有VIP提示，说明需要破解
      if (displayedCount <= 3 && hasVipPrompt) {
        log('[ReviewBreaker] VIP-locked reviews detected, fetching from API...');
      } else if (displayedCount < totalCount) {
        log('[ReviewBreaker] Partial reviews displayed, fetching complete list from API...');
      } else {
        log('[ReviewBreaker] No need to fetch, all reviews visible.');
        return;
      }

      const ensureList = (): HTMLElement => {
        let dl = reviewsRoot.querySelector('dl.review-items') as HTMLElement | null;
        if (!dl) {
          const body = reviewsRoot.querySelector('.message .message-body') as HTMLElement | null
                    || reviewsRoot.querySelector('.message-body') as HTMLElement | null
                    || reviewsRoot;
          dl = document.createElement('dl');
          dl.className = 'review-items';
          body.appendChild(dl);
        }
        return dl;
      };

      const listEl = ensureList();
      const nativeParsedReviews = this.extractNativeReviews(listEl);
      
      // 移除VIP提示
      const vipPrompt = listEl.querySelector('.review-item.more');
      if (vipPrompt) {
        vipPrompt.remove();
        log('[ReviewBreaker] Removed VIP prompt');
      }
      
      const hideLoadingPlaceholders = () => {
        const nodes = Array.from(reviewsRoot.querySelectorAll('.message .message-body, .message-body, p, div, span')) as HTMLElement[];
        for (const el of nodes) {
          const t = (el.textContent || '').trim();
          if (!t) continue;
          if (t.includes('读取中') || t.includes('讀取中') || t.includes('加载中') || t.includes('加載中') || t.includes('Loading')) {
            el.style.display = 'none';
          }
        }
      };
      
      const getErrorHost = (): HTMLElement => {
        let host = reviewsRoot.querySelector('#jhs-review-error') as HTMLElement | null;
        if (!host) {
          host = document.createElement('div');
          host.id = 'jhs-review-error';
          listEl.parentElement?.insertBefore(host, listEl.nextSibling);
        }
        return host;
      };

      const injectOnce = async () => {
        // 显示加载提示
        const loadingIndicator = this.createLoadingIndicator();
        const messageBody = reviewsRoot.querySelector('.message-body') as HTMLElement | null;
        const insertTarget = messageBody || reviewsRoot;
        
        // 插入到评论列表之前
        if (listEl.parentElement) {
          listEl.parentElement.insertBefore(loadingIndicator, listEl);
        } else {
          insertTarget.insertBefore(loadingIndicator, insertTarget.firstChild);
        }
        
        // 确保加载提示至少显示500ms，让用户看到
        const minDisplayTime = 500;
        const startTime = Date.now();
        
        try {
          const resp = await reviewBreakerService.getReviews(movieId, 1, 100); // 使用movieId而不是videoId
          
          // 等待最小显示时间
          const elapsed = Date.now() - startTime;
          if (elapsed < minDisplayTime) {
            await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsed));
          }
          
          // 移除加载提示
          loadingIndicator.remove();
          
        hideLoadingPlaceholders();
        if (resp.success && resp.data) {
            const mergedReviews = this.mergeReviews(nativeParsedReviews, resp.data, totalCount);

            // 隐藏原生评论（保留DOM结构但不显示）
            const nativeReviews = listEl.querySelectorAll('.review-item:not(.jhs-review-item)');
            nativeReviews.forEach(el => {
              (el as HTMLElement).style.display = 'none';
            });
            
            // 移除所有VIP提示（包括在reviewsRoot中的所有位置）
            const vipPrompts = reviewsRoot.querySelectorAll('.review-item.more');
            vipPrompts.forEach(el => el.remove());
            log('[ReviewBreaker] Removed VIP prompts and hidden native reviews');
            
            // 添加提示横幅（插入到listEl之前）
            this.addReviewBreakerBanner(listEl, Math.max(mergedReviews.length, totalCount), totalCount);
            
            this.displayNativeReviews(mergedReviews, listEl, totalCount);
            this.enhanceExistingReviewContent();
            this.inject115ButtonsIntoReviews();
            const err = reviewsRoot.querySelector('#jhs-review-error') as HTMLElement | null;
            if (err) err.remove();
            log('[ReviewBreaker] Native reviews injected.');
          } else {
            const host = getErrorHost();
            this.renderRetryBlock(host, `评论获取失败：${resp.error || ''}`, '重试获取', async () => {
              host.innerHTML = '<div style="text-align:center;padding:16px;">正在重试...</div>';
              await injectOnce();
            });
            log('[ReviewBreaker] Failed to fetch reviews for native mount:', resp.error);
          }
        } catch (e) {
          // 等待最小显示时间
          const elapsed = Date.now() - startTime;
          if (elapsed < minDisplayTime) {
            await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsed));
          }
          
          // 移除加载提示
          loadingIndicator.remove();
          
          hideLoadingPlaceholders();
          const host = getErrorHost();
          this.renderRetryBlock(host, `评论获取失败：${e instanceof Error ? e.message : String(e)}`, '重试获取', async () => {
            host.innerHTML = '<div style="text-align:center;padding:16px;">正在重试...</div>';
            await injectOnce();
          });
          log('[ReviewBreaker] Exception while injecting native reviews:', e);
        }
      };

      await injectOnce();

      // 监听 tabs 切换导致的 DOM 重渲染，自动补回注入
      const observer = new MutationObserver(() => {
        const dl = reviewsRoot.querySelector('dl.review-items') as HTMLElement | null;
        if (!dl) return;
        
        const jhsReviews = dl.querySelectorAll('.jhs-review-item');
        const nativeReviews = dl.querySelectorAll('.review-item:not(.jhs-review-item)');
        
        // 若列表被重建且没有我们的注入项，或者原生评论又出现了，则再次注入
        if (jhsReviews.length === 0 && nativeReviews.length > 0) {
          log('[ReviewBreaker] MutationObserver detected DOM was replaced by native script');
          log(`[ReviewBreaker] Found ${nativeReviews.length} native reviews, re-injecting...`);
          
          const cachedReviews = (window as any).__JHS_REVIEWS_CACHE__ || [];
          log(`[ReviewBreaker] Cached reviews count: ${cachedReviews.length}`);
          
          if (cachedReviews.length > 0) {
            // 先隐藏原生评论
            nativeReviews.forEach(el => {
              (el as HTMLElement).style.display = 'none';
            });
            
            this.displayNativeReviews(cachedReviews, dl, totalCount);
            log('[ReviewBreaker] Re-injection completed');
          } else {
            log('[ReviewBreaker] WARNING: No cached reviews to re-inject!');
          }
        }
      });
      
      try {
        observer.observe(reviewsRoot, { childList: true, subtree: true });
        log('[ReviewBreaker] MutationObserver started monitoring reviewsRoot');
      } catch (e) {
        log('[ReviewBreaker] Failed to start MutationObserver:', e);
      }
      
      // 延迟检查：JavDB可能在我们注入后异步加载评论
      setTimeout(() => {
        const dl = reviewsRoot.querySelector('dl.review-items') as HTMLElement | null;
        if (!dl) return;
        
        const jhsReviews = dl.querySelectorAll('.jhs-review-item');
        const nativeReviews = dl.querySelectorAll('.review-item:not(.jhs-review-item)');
        
        log(`[ReviewBreaker] Delayed check (500ms): JHS=${jhsReviews.length}, Native=${nativeReviews.length}`);
        
        if (jhsReviews.length === 0 && nativeReviews.length > 0) {
          log('[ReviewBreaker] Delayed check detected DOM was replaced, re-injecting...');
          
          const cachedReviews = (window as any).__JHS_REVIEWS_CACHE__ || [];
          if (cachedReviews.length > 0) {
            nativeReviews.forEach(el => {
              (el as HTMLElement).style.display = 'none';
            });
            
            // 重新添加横幅
            this.addReviewBreakerBanner(dl, cachedReviews.length, totalCount);
            
            this.displayNativeReviews(cachedReviews, dl, totalCount);
            log('[ReviewBreaker] Delayed re-injection completed');
          }
        }
      }, 500);
      
      log('[ReviewBreaker] Reviews enhancement (native mount) ready');
    } catch (error) {
      log('[ReviewBreaker] Error enhancing reviews:', error);
      showToast('评论区增强失败', 'error');
    }
  }

  /**
   * 增强FC2视频信息
   */
  private async enhanceFC2Video(videoId: string): Promise<void> {
    try {
      const response = await fc2BreakerService.getFC2VideoInfo(videoId);
      
      if (!response.success || !response.data) {
        log('[FC2Breaker] Failed to get FC2 video info:', response.error);
        showToast(`FC2增强失败: ${response.error}`, 'error');

        // 插入占位容器 + 重试按钮（不影响其它功能）
        const targetContainer = document.querySelector('.container, .content, main');
        if (targetContainer) {
          const placeholder = document.createElement('div');
          placeholder.className = 'enhanced-fc2-info';
          placeholder.style.cssText = `
            margin: 20px 0;
            padding: 20px;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            border: 1px dashed #f0b37e;
            border-left: 4px solid #ff9800;
          `;

          const setupErrorUI = (msg: string) => {
            this.renderRetryBlock(placeholder, msg, '重试获取', async () => {
              placeholder.innerHTML = '<div style="text-align:center;padding:16px;">正在重试...</div>';
              const retry = await fc2BreakerService.getFC2VideoInfo(videoId);
              if (retry.success && retry.data) {
                const fc2Container = this.createFC2InfoContainer(retry.data);
                try { placeholder.replaceWith(fc2Container); } catch { targetContainer.appendChild(fc2Container); placeholder.remove(); }
                showToast('FC2视频信息增强成功', 'success');
              } else {
                setupErrorUI(`FC2增强失败：${retry.error || '未知错误'}`);
              }
            });
          };

          const insertPosition = targetContainer.querySelector('.video-info, .movie-info') || targetContainer.firstElementChild;
          if (insertPosition) {
            insertPosition.parentElement?.insertBefore(placeholder, insertPosition.nextSibling);
          } else {
            targetContainer.appendChild(placeholder);
          }

          setupErrorUI(`FC2增强失败：${response.error || '未知错误'}`);
        }
        return;
      }

      const fc2Info = response.data;
      
      // 创建FC2信息展示区域
      const fc2Container = this.createFC2InfoContainer(fc2Info);
      
      // 查找合适的位置插入FC2信息
      const targetContainer = document.querySelector('.container, .content, main');
      if (targetContainer) {
        const insertPosition = targetContainer.querySelector('.video-info, .movie-info') || 
                              targetContainer.firstElementChild;
        if (insertPosition) {
          insertPosition.parentElement?.insertBefore(fc2Container, insertPosition.nextSibling);
        } else {
          targetContainer.appendChild(fc2Container);
        }
      }

      log('[FC2Breaker] FC2 video enhanced successfully');
      showToast('FC2视频信息增强成功', 'success');
    } catch (error) {
      log('[FC2Breaker] Error enhancing FC2 video:', error);
      showToast('FC2增强失败', 'error');
    }
  }

  /**
   * 创建增强的封面容器
   */
  private createEnhancedCoverContainer(coverImage: ImageData, originalSrc: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'enhanced-cover-container x-cover x-preview'; // 🆕 添加预览类
    container.style.cssText = `
      position: relative;
      display: inline-block;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.3s ease;
    `;

    const img = document.createElement('img');
    img.src = coverImage.url;
    img.alt = 'Enhanced Cover';
    img.style.cssText = `
      width: 100%;
      height: auto;
      display: block;
    `;

    // 添加错误处理，回退到原图
    img.onerror = () => {
      img.src = originalSrc;
    };

    // 添加质量标识
    if (coverImage.quality === 'high') {
      const qualityBadge = document.createElement('div');
      qualityBadge.textContent = 'HD';
      qualityBadge.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(0,0,0,0.7);
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: bold;
        z-index: 5;
      `;
      container.appendChild(qualityBadge);
    }

    container.appendChild(img);
    
    // 🆕 添加视频预览功能
    if (this.options.enableVideoPreview && this.videoId) {
      this.enhanceVideoPreview(container, this.videoId);
    }
    
    return container;
  }

  /**
   * 创建新的封面区域
   */
  private createNewCoverArea(coverImage: ImageData): void {
    const coverArea = document.createElement('div');
    coverArea.className = 'enhanced-cover-area';
    coverArea.style.cssText = `
      margin: 20px 0;
      text-align: center;
    `;

    const title = document.createElement('h3');
    title.textContent = '高质量封面';
    title.style.cssText = `
      margin-bottom: 10px;
      color: #333;
      font-size: 16px;
    `;

    const container = this.createEnhancedCoverContainer(coverImage, '');
    container.style.maxWidth = '300px';

    coverArea.appendChild(title);
    coverArea.appendChild(container);

    // 插入到页面顶部
    const mainContent = document.querySelector('main, .container, .content, body');
    if (mainContent && mainContent.firstElementChild) {
      mainContent.insertBefore(coverArea, mainContent.firstElementChild);
    }
  }

  /**
   * 创建翻译容器
   */
  private createTranslationContainer(originalTitle: string, translatedTitle: string): HTMLElement {
    const dark = isDarkTheme();
    const container = document.createElement('div');
    container.className = 'enhanced-translation';
    try { container.setAttribute('data-original-title', originalTitle || ''); } catch {}
    container.style.cssText = `
      margin: 10px 0;
      padding: 12px;
      background: ${dark ? 'linear-gradient(135deg, #2a2a2a 0%, #3a3a4a 100%)' : 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)'};
      border-radius: 8px;
      border-left: 4px solid #4CAF50;
    `;

    const label = document.createElement('div');
    label.setAttribute('data-translation-label', '');
    label.textContent = '中文翻译';
    label.style.cssText = `
      font-size: 12px;
      color: ${dark ? '#aaa' : '#666'};
      margin-bottom: 5px;
      font-weight: bold;
    `;

    const translation = document.createElement('div');
    translation.setAttribute('data-translation-content', '');
    translation.textContent = translatedTitle;
    translation.style.cssText = `
      font-size: 16px;
      color: ${dark ? '#e0e0e0' : '#333'};
      line-height: 1.4;
    `;

    container.appendChild(label);
    container.appendChild(translation);
    return container;
  }


  /**
   * 在容器内渲染错误提示与重试按钮（轻量UI，不影响其它增强流程）
   */
  private renderRetryBlock(container: HTMLElement, message: string, retryText: string, onRetry: () => Promise<void>): void {
    container.innerHTML = `
      <div style="text-align: center; padding: 16px; color: var(--text-secondary, #666);">
        <div style="margin-bottom: 8px;">${message}</div>
        <button class="enhance-retry-btn" style="background: var(--bg-tertiary, #eee); border: 1px solid var(--border-primary, #ddd); padding: 6px 12px; border-radius: 4px; cursor: pointer; color: var(--text-primary, #333); transition: background 0.2s;">${retryText}</button>
      </div>
    `;
    const btn = container.querySelector('.enhance-retry-btn') as HTMLButtonElement | null;
    if (!btn) return;
    
    // 添加悬停效果
    btn.onmouseenter = () => btn.style.background = 'var(--bg-hover, #e0e0e0)';
    btn.onmouseleave = () => btn.style.background = 'var(--bg-tertiary, #eee)';
    
    btn.onclick = async () => {
      const old = btn.textContent || '重试';
      btn.disabled = true;
      btn.textContent = '重试中...';
      try {
        await onRetry();
      } catch (e) {
        // 静默失败，保持按钮可再次重试
      } finally {
        btn.textContent = old;
        btn.disabled = false;
      }
    };
  }

  private injectReviewBreakerStyles(): void {
    const styleId = 'jdb-review-breaker-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #reviews,
      div[data-movie-tab-target="reviews"] {
        --jdb-review-panel-bg: #f7fafc;
        --jdb-review-card-bg: #ffffff;
        --jdb-review-card-border: rgba(15, 23, 42, 0.10);
        --jdb-review-card-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
        --jdb-review-text: #1f2937;
        --jdb-review-muted: #64748b;
        --jdb-review-title: #0f73a8;
        --jdb-review-accent: #0ea5e9;
        --jdb-review-surface: #eef2f7;
        --jdb-review-button-bg: #e1f5fe;
        --jdb-review-button-hover: #c8ecfb;
        --jdb-review-button-text: #0277bd;
        --jdb-review-success-bg: #dcfce7;
        --jdb-review-success-text: #166534;
        --jdb-review-star: #f59e0b;
      }

      html[data-theme="dark"] #reviews,
      html[data-theme="dark"] div[data-movie-tab-target="reviews"] {
        --jdb-review-panel-bg: #111827;
        --jdb-review-card-bg: #1f2937;
        --jdb-review-card-border: rgba(148, 163, 184, 0.22);
        --jdb-review-card-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
        --jdb-review-text: #e5e7eb;
        --jdb-review-muted: #9ca3af;
        --jdb-review-title: #7dd3fc;
        --jdb-review-accent: #38bdf8;
        --jdb-review-surface: rgba(148, 163, 184, 0.12);
        --jdb-review-button-bg: rgba(14, 165, 233, 0.18);
        --jdb-review-button-hover: rgba(14, 165, 233, 0.28);
        --jdb-review-button-text: #bae6fd;
        --jdb-review-success-bg: rgba(34, 197, 94, 0.18);
        --jdb-review-success-text: #bbf7d0;
        --jdb-review-star: #fbbf24;
      }

      #reviews .review-items,
      div[data-movie-tab-target="reviews"] .review-items {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 10px;
        border-radius: 12px;
        background: var(--jdb-review-panel-bg);
      }

      #reviews .review-items > .review-item:not(.more),
      div[data-movie-tab-target="reviews"] .review-items > .review-item:not(.more) {
        display: block;
        margin: 0;
        padding: 9px 12px;
        border: 1px solid var(--jdb-review-card-border);
        border-radius: 10px;
        color: var(--jdb-review-text);
        background: var(--jdb-review-card-bg);
        box-shadow: var(--jdb-review-card-shadow);
      }

      #reviews .review-title,
      div[data-movie-tab-target="reviews"] .review-title {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px 8px;
        margin-bottom: 6px;
        color: var(--jdb-review-title);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.3;
      }

      #reviews .review-title .likes,
      div[data-movie-tab-target="reviews"] .review-title .likes {
        float: none !important;
        order: 10;
        margin-left: auto;
      }

      #reviews .review-title .likes .button,
      div[data-movie-tab-target="reviews"] .review-title .likes .button,
      #jhs-review-pagination .button {
        height: 26px;
        margin: 0;
        border-color: transparent;
        border-radius: 8px;
        color: var(--jdb-review-button-text);
        background: var(--jdb-review-button-bg);
        font-weight: 700;
      }

      #reviews .review-title .likes .button:hover,
      div[data-movie-tab-target="reviews"] .review-title .likes .button:hover,
      #jhs-review-pagination .button:hover {
        background: var(--jdb-review-button-hover);
      }

      #reviews .review-title .likes .button:disabled,
      div[data-movie-tab-target="reviews"] .review-title .likes .button:disabled {
        opacity: 1;
      }

      #reviews .jdb-review-like-count,
      div[data-movie-tab-target="reviews"] .jdb-review-like-count {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 24px;
        padding: 2px 8px;
        border-radius: 999px;
        color: var(--jdb-review-button-text);
        background: var(--jdb-review-button-bg);
        font-size: 12px;
        font-weight: 700;
      }

      #reviews .jdb-review-author,
      div[data-movie-tab-target="reviews"] .jdb-review-author {
        color: var(--jdb-review-title);
      }

      #reviews .jdb-review-meta,
      div[data-movie-tab-target="reviews"] .jdb-review-meta {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        color: var(--jdb-review-muted);
        font-size: 12px;
        font-weight: 700;
      }

      #reviews .score-stars,
      div[data-movie-tab-target="reviews"] .score-stars {
        display: inline-flex;
        gap: 2px;
        color: var(--jdb-review-star);
      }

      #reviews .score-stars .icon-star,
      div[data-movie-tab-target="reviews"] .score-stars .icon-star {
        color: var(--jdb-review-star);
      }

      #reviews .time,
      div[data-movie-tab-target="reviews"] .time {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 1px 7px;
        border-radius: 999px;
        color: var(--jdb-review-muted);
        background: var(--jdb-review-surface);
        font-size: 11px;
        font-weight: 700;
      }

      #reviews .review-item .content,
      div[data-movie-tab-target="reviews"] .review-item .content {
        margin-top: 0;
        color: var(--jdb-review-text);
      }

      #reviews .review-item .content p,
      div[data-movie-tab-target="reviews"] .review-item .content p {
        margin: 0;
        color: var(--jdb-review-text);
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }

      #reviews .review-item .content a,
      div[data-movie-tab-target="reviews"] .review-item .content a {
        color: var(--jdb-review-title);
        font-weight: 700;
        overflow-wrap: anywhere;
      }

      #reviews .jhs-review-push-115,
      div[data-movie-tab-target="reviews"] .jhs-review-push-115 {
        border-color: transparent;
        border-radius: 8px;
        color: var(--jdb-review-success-text);
        background: var(--jdb-review-success-bg);
        font-weight: 700;
      }

      #jhs-review-pagination {
        display: grid !important;
        grid-template-columns: minmax(92px, 1fr) auto minmax(92px, 1fr);
        align-items: center;
        gap: 10px;
        margin-top: 10px !important;
        padding: 10px !important;
        border-radius: 8px !important;
        color: var(--jdb-review-muted);
        background: var(--jdb-review-surface);
      }

      #jhs-page-info {
        color: var(--jdb-review-muted);
        font-size: 12px !important;
        font-weight: 700 !important;
        white-space: nowrap;
      }

      #jhs-review-banner,
      #jhs-review-loading {
        border: 1px solid var(--jdb-review-card-border) !important;
        color: var(--jdb-review-text) !important;
        background: var(--jdb-review-card-bg) !important;
        box-shadow: var(--jdb-review-card-shadow) !important;
      }

      #jhs-review-banner {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        margin: 0 0 10px 0 !important;
        padding: 10px 12px !important;
        border-radius: 10px !important;
      }

      #jhs-review-banner > div,
      #jhs-review-loading > div {
        color: var(--jdb-review-text) !important;
      }

      #jhs-review-loading > div:first-child {
        border-color: rgba(14, 165, 233, 0.22) !important;
        border-top-color: var(--jdb-review-accent) !important;
      }

      #jhs-review-banner button {
        color: var(--jdb-review-button-text) !important;
        background: var(--jdb-review-button-bg) !important;
      }

      @media (prefers-color-scheme: dark) {
        html:not([data-theme="light"]) #reviews,
        html:not([data-theme="light"]) div[data-movie-tab-target="reviews"] {
          --jdb-review-panel-bg: #111827;
          --jdb-review-card-bg: #1f2937;
          --jdb-review-card-border: rgba(148, 163, 184, 0.22);
          --jdb-review-card-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
          --jdb-review-text: #e5e7eb;
          --jdb-review-muted: #9ca3af;
          --jdb-review-title: #7dd3fc;
          --jdb-review-accent: #38bdf8;
          --jdb-review-surface: rgba(148, 163, 184, 0.12);
          --jdb-review-button-bg: rgba(14, 165, 233, 0.18);
          --jdb-review-button-hover: rgba(14, 165, 233, 0.28);
          --jdb-review-button-text: #bae6fd;
          --jdb-review-success-bg: rgba(34, 197, 94, 0.18);
          --jdb-review-success-text: #bbf7d0;
          --jdb-review-star: #fbbf24;
        }
      }

      @media (max-width: 520px) {
        #reviews .review-items,
        div[data-movie-tab-target="reviews"] .review-items {
          padding: 10px;
        }
        #reviews .review-title,
        div[data-movie-tab-target="reviews"] .review-title {
          align-items: flex-start;
          flex-direction: column;
        }
        #reviews .review-title .likes,
        div[data-movie-tab-target="reviews"] .review-title .likes {
          margin-left: 0;
          order: 10;
        }
        #jhs-review-pagination {
          grid-template-columns: 1fr 1fr;
        }
        #jhs-page-info {
          grid-column: 1 / -1;
          grid-row: 1;
          text-align: center;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 创建加载提示
   */
  private createLoadingIndicator(): HTMLElement {
    this.injectReviewBreakerStyles();
    const indicator = document.createElement('div');
    indicator.id = 'jhs-review-loading';
    indicator.className = 'jdb-review-loading';
    indicator.style.cssText = `
      margin: 0 0 16px 0;
      padding: 20px;
      background: linear-gradient(135deg, var(--info, #2196f3) 0%, var(--primary, #1976d2) 100%);
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 16px;
      animation: slideInDown 0.3s ease-out;
    `;

    // 加载动画
    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 24px;
      height: 24px;
      border: 3px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    `;

    // 文字内容
    const textContent = document.createElement('div');
    textContent.style.cssText = `
      flex: 1;
      color: white;
    `;

    const mainText = document.createElement('div');
    mainText.style.cssText = `
      font-size: 15px;
      font-weight: bold;
      margin-bottom: 4px;
    `;
    mainText.textContent = '🔓 正在解锁全部评论...';

    const subText = document.createElement('div');
    subText.style.cssText = `
      font-size: 13px;
      opacity: 0.9;
    `;
    subText.textContent = 'JavDB 助手正在为您获取完整评论内容';

    textContent.appendChild(mainText);
    textContent.appendChild(subText);

    indicator.appendChild(spinner);
    indicator.appendChild(textContent);

    // 添加旋转动画样式
    if (!document.getElementById('jhs-loading-animations')) {
      const style = document.createElement('style');
      style.id = 'jhs-loading-animations';
      style.textContent = `
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `;
      document.head.appendChild(style);
    }

    return indicator;
  }

  private hideLoadingIndicator(): void {
    const indicator = document.getElementById('enhancement-loading')
      || document.getElementById('jhs-review-loading');
    if (indicator) {
      indicator.remove();
    }
  }

  /**
   * 添加评论破解提示横幅
   */
  private addReviewBreakerBanner(listEl: HTMLElement, fetchedCount: number, totalCount: number): void {
    this.injectReviewBreakerStyles();
    // 检查是否已存在横幅
    const existingBanner = document.querySelector('#jhs-review-banner');
    if (existingBanner) {
      existingBanner.remove();
    }

    const banner = document.createElement('div');
    banner.id = 'jhs-review-banner';
    banner.className = 'jdb-review-banner';
    banner.style.cssText = `
      margin: 0 0 16px 0;
      padding: 12px 16px;
      background: linear-gradient(135deg, #4caf50 0%, #2196f3 100%);
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideInDown 0.3s ease-out;
    `;

    // 图标
    const icon = document.createElement('span');
    icon.innerHTML = '✨';
    icon.style.cssText = `
      font-size: 20px;
      flex-shrink: 0;
    `;

    // 文字内容
    const textContent = document.createElement('div');
    textContent.style.cssText = `
      flex: 1;
      color: white;
      font-size: 14px;
      line-height: 1.5;
    `;

    const mainText = document.createElement('div');
    mainText.style.fontWeight = 'bold';
    mainText.textContent = `🎉 已为您解锁全部 ${Math.max(fetchedCount, totalCount)} 条评论`;

    const subText = document.createElement('div');
    subText.style.cssText = `
      font-size: 12px;
      opacity: 0.9;
      margin-top: 2px;
    `;
    subText.textContent = `由 JavDB 助手提供 · 原本仅显示 ${Math.min(3, totalCount)} 条`;

    textContent.appendChild(mainText);
    textContent.appendChild(subText);

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
      background: rgba(255,255,255,0.2);
      border: none;
      color: white;
      font-size: 20px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
    `;
    closeBtn.onmouseover = () => {
      closeBtn.style.background = 'rgba(255,255,255,0.3)';
    };
    closeBtn.onmouseout = () => {
      closeBtn.style.background = 'rgba(255,255,255,0.2)';
    };
    closeBtn.onclick = () => {
      banner.style.animation = 'slideOutUp 0.3s ease-out';
      setTimeout(() => banner.remove(), 300);
    };

    banner.appendChild(icon);
    banner.appendChild(textContent);
    banner.appendChild(closeBtn);

    // 添加动画样式
    if (!document.getElementById('jhs-banner-animations')) {
      const style = document.createElement('style');
      style.id = 'jhs-banner-animations';
      style.textContent = `
        @keyframes slideInDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes slideOutUp {
          from {
            opacity: 1;
            transform: translateY(0);
          }
          to {
            opacity: 0;
            transform: translateY(-20px);
          }
        }
      `;
      document.head.appendChild(style);
    }

    // 插入到评论列表之前
    if (listEl.parentElement) {
      listEl.parentElement.insertBefore(banner, listEl);
    }
    
    log('[ReviewBreaker] Banner added before review list');
  }

  /**
   * 将评论渲染为原生样式并挂载到 <dl class="review-items">，支持分页
   */
  private displayNativeReviews(reviews: ReviewData[], dl: HTMLElement, expectedTotalCount?: number): void {
    this.injectReviewBreakerStyles();
    log(`[ReviewBreaker] displayNativeReviews called with ${reviews.length} reviews`);
    
    const filterKeywords = reviewBreakerService.getFilterKeywords();
    const filtered = reviews.filter(r => !reviewBreakerService.shouldFilterReview(r, filterKeywords));
    
    log(`[ReviewBreaker] After filtering: ${filtered.length} reviews (filtered out: ${reviews.length - filtered.length})`);

    // 缓存供重渲染复用
    try { (window as any).__JHS_REVIEWS_CACHE__ = filtered; } catch {}

    const resolvedTotalCount = Math.max(expectedTotalCount || 0, filtered.length);

    // 分页配置
    const pageSize = 10;
    const totalPages = Math.ceil(filtered.length / pageSize);
    let currentPage = 1;
    
    log(`[ReviewBreaker] Pagination: pageSize=${pageSize}, totalPages=${totalPages}`);

    // 隐藏所有原生评论（一次性处理，不在分页时重复）
    const hideNativeReviews = () => {
      const nativeReviews = dl.querySelectorAll('.review-item:not(.jhs-review-item)');
      log(`[ReviewBreaker] hideNativeReviews: found ${nativeReviews.length} native reviews to hide`);
      nativeReviews.forEach((el, index) => {
        (el as HTMLElement).style.display = 'none';
        log(`[ReviewBreaker] Hidden native review ${index + 1}: ${el.id}`);
      });
    };

    // 清空现有JHS评论
    const clearJhsReviews = () => {
      const existingJhsReviews = dl.querySelectorAll('.jhs-review-item');
      log(`[ReviewBreaker] clearJhsReviews: found ${existingJhsReviews.length} existing JHS reviews to remove`);
      existingJhsReviews.forEach(el => el.remove());
    };

    // 渲染指定页的评论
    const renderPage = (page: number) => {
      log(`[ReviewBreaker] renderPage called for page ${page}`);
      
      // 清空JHS评论
      clearJhsReviews();

      // 确保原生评论始终隐藏
      hideNativeReviews();

      // 计算当前页的评论范围
      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, filtered.length);
      const pageReviews = filtered.slice(startIndex, endIndex);
      
      log(`[ReviewBreaker] Rendering ${pageReviews.length} reviews (index ${startIndex} to ${endIndex})`);

      // 渲染当前页评论
      pageReviews.forEach((review, index) => {
        const element = this.createNativeReviewElement(review);
        dl.appendChild(element);
        log(`[ReviewBreaker] Appended review ${index + 1}/${pageReviews.length}: ${review.id}, element.id=${element.id}, className=${element.className}`);
      });
      
      // 检查DOM状态
      const allReviewItems = dl.querySelectorAll('.review-item');
      const jhsReviewItems = dl.querySelectorAll('.jhs-review-item');
      const nativeReviewItems = dl.querySelectorAll('.review-item:not(.jhs-review-item)');
      
      log(`[ReviewBreaker] DOM check after render:`);
      log(`[ReviewBreaker]   - Total .review-item: ${allReviewItems.length}`);
      log(`[ReviewBreaker]   - JHS reviews (.jhs-review-item): ${jhsReviewItems.length}`);
      log(`[ReviewBreaker]   - Native reviews (not .jhs-review-item): ${nativeReviewItems.length}`);
      log(`[ReviewBreaker]   - dl.children.length: ${dl.children.length}`);

      this.enhanceExistingReviewContent();
      this.inject115ButtonsIntoReviews();

      // 更新分页器状态
      updatePagination(page);
    };

    // 创建分页器
    const createPagination = (): HTMLElement => {
      const pagination = document.createElement('div');
      pagination.id = 'jhs-review-pagination';
      pagination.className = 'message-body jdb-review-pagination'; // 使用JavDB的message-body类来继承主题样式
      
      pagination.style.cssText = `
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        margin-top: 20px;
        padding: 16px;
        border-radius: 8px;
        opacity: 0.95;
      `;

      // 上一页按钮
      const prevBtn = document.createElement('button');
      prevBtn.id = 'jhs-prev-page';
      prevBtn.className = 'button is-small is-info'; // 使用Bulma的按钮样式
      prevBtn.textContent = '‹ 上一页';
      prevBtn.style.cssText = `
        margin: 0 4px;
        font-size: 14px;
      `;
      prevBtn.onclick = () => {
        if (currentPage > 1) {
          currentPage--;
          renderPage(currentPage);
          scrollToReviews();
        }
      };

      // 页码信息
      const pageInfo = document.createElement('span');
      pageInfo.id = 'jhs-page-info';
      pageInfo.style.cssText = `
        padding: 8px 16px;
        font-size: 14px;
        font-weight: 500;
      `;

      // 下一页按钮
      const nextBtn = document.createElement('button');
      nextBtn.id = 'jhs-next-page';
      nextBtn.className = 'button is-small is-info'; // 使用Bulma的按钮样式
      nextBtn.textContent = '下一页 ›';
      nextBtn.style.cssText = `
        margin: 0 4px;
        font-size: 14px;
      `;
      nextBtn.onclick = () => {
        if (currentPage < totalPages) {
          currentPage++;
          renderPage(currentPage);
          scrollToReviews();
        }
      };

      pagination.appendChild(prevBtn);
      pagination.appendChild(pageInfo);
      pagination.appendChild(nextBtn);

      return pagination;
    };

    // 更新分页器状态
    const updatePagination = (page: number) => {
      const prevBtn = document.getElementById('jhs-prev-page') as HTMLButtonElement | null;
      const nextBtn = document.getElementById('jhs-next-page') as HTMLButtonElement | null;
      const pageInfo = document.getElementById('jhs-page-info');

      if (prevBtn) {
        prevBtn.disabled = page <= 1;
        prevBtn.style.opacity = page <= 1 ? '0.5' : '1';
        prevBtn.style.cursor = page <= 1 ? 'not-allowed' : 'pointer';
      }

      if (nextBtn) {
        nextBtn.disabled = page >= totalPages;
        nextBtn.style.opacity = page >= totalPages ? '0.5' : '1';
        nextBtn.style.cursor = page >= totalPages ? 'not-allowed' : 'pointer';
      }

      if (pageInfo) {
        pageInfo.textContent = `第 ${page} / ${totalPages} 页 (共 ${resolvedTotalCount} 条评论)`;
      }
    };

    // 滚动到评论区
    const scrollToReviews = () => {
      const reviewsRoot = dl.closest('[data-movie-tab-target="reviews"], #reviews');
      if (reviewsRoot) {
        reviewsRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    // 如果评论数量超过10条，添加分页器
    if (filtered.length > pageSize) {
      log(`[ReviewBreaker] Adding pagination (${filtered.length} reviews > ${pageSize})`);
      
      // 移除旧的分页器
      const oldPagination = document.getElementById('jhs-review-pagination');
      if (oldPagination) {
        oldPagination.remove();
        log(`[ReviewBreaker] Removed old pagination`);
      }

      // 添加新的分页器
      const pagination = createPagination();
      
      // 尝试多种方式插入分页器
      if (dl.parentElement) {
        dl.parentElement.appendChild(pagination);
        log(`[ReviewBreaker] Pagination added to parent element`);
      } else if (dl.nextSibling) {
        dl.parentNode?.insertBefore(pagination, dl.nextSibling);
        log(`[ReviewBreaker] Pagination inserted after dl using nextSibling`);
      } else {
        // 如果都失败，直接插入到dl后面
        dl.insertAdjacentElement('afterend', pagination);
        log(`[ReviewBreaker] Pagination inserted using insertAdjacentElement`);
      }
    } else {
      log(`[ReviewBreaker] No pagination needed (${filtered.length} reviews <= ${pageSize})`);
    }

    // 渲染第一页
    log(`[ReviewBreaker] Starting to render first page`);
    renderPage(1);
    this.enhanceExistingReviewContent();
    this.inject115ButtonsIntoReviews();
    log(`[ReviewBreaker] displayNativeReviews completed`);
  }

  private extractNativeReviews(dl: HTMLElement): ReviewData[] {
    const nodes = Array.from(dl.querySelectorAll('.review-item:not(.jhs-review-item):not(.more)')) as HTMLElement[];
    return nodes.map(node => {
      const rawId = node.id?.replace(/^review-item-/, '') || `${Date.now()}-${Math.random()}`;
      const reviewTitle = node.querySelector('.review-title') as HTMLElement | null;
      const authorText = this.extractNativeReviewAuthor(reviewTitle);
      const content = (node.querySelector('.content p')?.textContent || '').trim();
      const time = (node.querySelector('.time')?.textContent || '').trim();
      const likesText = (node.querySelector('.likes-count')?.textContent || '0').trim();
      const rating = node.querySelectorAll('.score-stars .icon-star').length * 2;
      return {
        id: rawId,
        author: authorText || '匿名用户',
        content,
        date: time,
        likes: parseInt(likesText, 10) || 0,
        rating,
      };
    }).filter(review => review.content);
  }

  private extractNativeReviewAuthor(reviewTitle: HTMLElement | null): string {
    if (!reviewTitle) return '匿名用户';
    const cloned = reviewTitle.cloneNode(true) as HTMLElement;
    cloned.querySelectorAll('.report, .likes, .score-stars, .time, form, button').forEach(el => el.remove());
    const text = (cloned.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text || '匿名用户';
  }

  private mergeReviews(nativeReviews: ReviewData[], apiReviews: ReviewData[], expectedTotalCount: number): ReviewData[] {
    const merged = new Map<string, ReviewData>();
    const buildKey = (review: ReviewData): string => {
      const author = (review.author || '').trim().toLowerCase();
      const date = (review.date || '').trim();
      const content = (review.content || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return `${author}__${date}__${content}`;
    };

    const addReview = (review: ReviewData, source: 'native' | 'api') => {
      if (!review.content?.trim()) return;
      const key = buildKey(review);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, review);
        return;
      }

      const score = (item: ReviewData, itemSource: 'native' | 'api') => {
        let value = 0;
        if (item.id) value += 4;
        if (item.likes && item.likes > 0) value += 3;
        if (item.rating && item.rating > 0) value += 2;
        if (item.author && item.author !== '匿名用户') value += 1;
        if (itemSource === 'native') value += 2;
        return value;
      };

      if (score(review, source) > score(existing, 'api')) {
        merged.set(key, { ...existing, ...review });
      }
    };

    nativeReviews.forEach(review => addReview(review, 'native'));
    apiReviews.forEach(review => addReview(review, 'api'));

    const result = Array.from(merged.values()).sort((a, b) => {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
      return String(a.id).localeCompare(String(b.id));
    });

    log(`[ReviewBreaker] mergeReviews: native=${nativeReviews.length}, api=${apiReviews.length}, merged=${result.length}, expected=${expectedTotalCount}`);
    return result;
  }

  /**
   * 创建接近原生结构的 <dt class="review-item">，以复用站点样式
   */
  private createNativeReviewElement(review: ReviewData): HTMLElement {
    this.injectReviewBreakerStyles();
    const dt = document.createElement('dt');
    dt.className = 'review-item jhs-review-item jdb-review-card';
    dt.id = `jhs-review-${review.id}`;
    dt.setAttribute('data-source', 'jhs');

    const title = document.createElement('div');
    title.className = 'review-title jdb-review-head';

    const likesWrap = document.createElement('div');
    likesWrap.className = 'likes is-pulled-right jdb-review-likes';
    const likeCount = document.createElement('span');
    likeCount.className = 'likes-count jdb-review-like-count';
    likeCount.textContent = `贊 ${review.likes ?? 0}`;
    likesWrap.appendChild(likeCount);

    // 作者
    const author = document.createElement('span');
    author.className = 'jdb-review-author';
    author.textContent = review.author || '匿名用户';

    // 评分星星（最多5个）
    const stars = document.createElement('span');
    stars.className = 'score-stars jdb-review-stars';
    const starCount = Math.max(0, Math.min(5, Math.round(((review.rating ?? 0) as number) / 2)));
    for (let i = 0; i < starCount; i++) {
      const iEl = document.createElement('i');
      iEl.className = 'icon-star';
      stars.appendChild(iEl);
    }

    // 时间
    const time = document.createElement('span');
    time.className = 'time jdb-review-time';
    try {
      const d = new Date(review.date);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      time.textContent = `${y}-${m}-${day}`;
    } catch {
      time.textContent = review.date;
    }

    const meta = document.createElement('span');
    meta.className = 'jdb-review-meta';
    meta.appendChild(stars);
    meta.appendChild(time);

    // 标题行组装
    title.appendChild(likesWrap);
    title.appendChild(author);
    title.appendChild(meta);

    // 正文
    const contentWrap = document.createElement('div');
    contentWrap.className = 'content jdb-review-content';
    const p = document.createElement('p');
    p.className = 'jdb-review-text';
    this.renderReviewContent(p, review.content);
    contentWrap.appendChild(p);

    dt.appendChild(title);
    dt.appendChild(contentWrap);
    return dt;
  }

  private renderReviewContent(container: HTMLElement, content: string): void {
    if (!this.options.enableReviewEnhancement || !this.options.enableReviewMagnetLinkify) {
      container.textContent = (content || '').trim();
      return;
    }

    const text = (content || '').trim();
    if (!text) return;

    const fragment = document.createDocumentFragment();
    const regex = /magnet:\?[^\s\u00a0<>"']+/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const magnetText = match[0];
      const link = document.createElement('a');

      link.href = magnetText;
      link.textContent = magnetText;

      fragment.appendChild(link);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    container.textContent = '';
    container.appendChild(fragment);
  }

  private inject115ButtonsIntoReviews(): void {
    if (!this.options.enableReviewEnhancement || !this.options.enableReviewPush115) return;
    const reviewRoot = document.querySelector('div[data-movie-tab-target="reviews"], #reviews');
    if (!reviewRoot) return;

    const items = Array.from(reviewRoot.querySelectorAll('.review-item')) as HTMLElement[];
    for (const item of items) {
      if (item.querySelector('.jhs-review-push-115')) continue;
      const content = item.querySelector('.content');
      const magnetLink = content?.querySelector('a[href^="magnet:"]') as HTMLAnchorElement | null;
      if (!content || !magnetLink) continue;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button is-success is-small jhs-review-push-115';
      btn.style.marginLeft = '8px';
      btn.textContent = '推送115';
      btn.addEventListener('click', async () => {
        const videoId = this.videoId || extractVideoIdFromPage() || 'unknown';
        btn.disabled = true;
        try {
          const result = await addTaskUrlsV2({ urls: magnetLink.href, context: { source: 'detail', videoId, pageUrl: window.location.href } as any });
          showToast(result?.success ? '已提交 115 推送' : (result?.message || '115 推送失败'));
        } catch (error) {
          showToast('115 推送失败');
        } finally {
          btn.disabled = false;
        }
      });

      magnetLink.insertAdjacentElement('afterend', btn);
    }
  }

  private enhanceExistingReviewContent(): void {
    const reviewRoot = document.querySelector('div[data-movie-tab-target="reviews"], #reviews');
    if (!reviewRoot) return;

    if (this.options.enableReviewEnhancement && this.options.enableReviewMagnetLinkify) {
      const paragraphs = Array.from(reviewRoot.querySelectorAll('.review-item .content p')) as HTMLElement[];
      for (const paragraph of paragraphs) {
        if (paragraph.getAttribute('data-jhs-review-enhanced') === '1') continue;
        const text = (paragraph.textContent || '').trim();
        if (!text) continue;
        this.renderReviewContent(paragraph, text);
        paragraph.setAttribute('data-jhs-review-enhanced', '1');
      }
    }

    this.enhanceReviewCodeRecognition(reviewRoot);
  }

  private enhanceReviewCodeRecognition(reviewRoot: ParentNode): void {
    enhanceReviewCodeRecognitionInRoot(reviewRoot, {
      searchEngines: STATE.settings?.searchEngines,
      libraryState: STATE.embyLibraryState,
    });
  }

  /**
   * 创建FC2信息容器
   */
  private createFC2InfoContainer(fc2Info: FC2VideoInfo): HTMLElement {
    const container = document.createElement('div');
    container.className = 'enhanced-fc2-info';
    container.style.cssText = `
      margin: 20px 0;
      padding: 20px;
      background: var(--bg-secondary, #fff);
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border: 1px solid var(--border-primary, #e0e0e0);
      border-left: 4px solid var(--warning, #ff9800);
    `;

    const title = document.createElement('h3');
    title.textContent = 'FC2 增强信息';
    title.style.cssText = `
      margin: 0 0 15px 0;
      color: var(--text-primary, #333);
      font-size: 18px;
      border-bottom: 2px solid var(--warning, #ff9800);
      padding-bottom: 5px;
    `;

    const infoGrid = document.createElement('div');
    infoGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 15px;
    `;

    // 基本信息
    if (fc2Info.releaseDate) {
      const dateInfo = this.createInfoItem('发布日期', fc2Info.releaseDate);
      infoGrid.appendChild(dateInfo);
    }

    if (fc2Info.score) {
      const scoreInfo = this.createInfoItem('评分', fc2Info.score);
      infoGrid.appendChild(scoreInfo);
    }

    if (fc2Info.duration) {
      const durationInfo = this.createInfoItem('时长', `${fc2Info.duration} 分钟`);
      infoGrid.appendChild(durationInfo);
    }

    // 演员信息
    if (fc2Info.actors && fc2Info.actors.length > 0) {
      const actorsDiv = document.createElement('div');
      actorsDiv.style.cssText = `margin-bottom: 15px;`;
      
      const actorsTitle = document.createElement('h4');
      actorsTitle.textContent = '主演演员';
      actorsTitle.style.cssText = `margin: 0 0 10px 0; color: var(--text-primary, #333);`;
      
      const actorsList = document.createElement('div');
      actorsList.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      `;
      
      fc2Info.actors.forEach(actor => {
        const actorTag = document.createElement('span');
        actorTag.style.cssText = `
          background: var(--bg-tertiary, #f0f0f0);
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 14px;
          color: var(--text-primary, #333);
        `;
        actorTag.textContent = actor.name;
        actorsList.appendChild(actorTag);
      });
      
      actorsDiv.appendChild(actorsTitle);
      actorsDiv.appendChild(actorsList);
      container.appendChild(actorsDiv);
    }

    // 预览图片
    if (fc2Info.images && fc2Info.images.length > 0) {
      const imagesDiv = document.createElement('div');
      imagesDiv.style.cssText = `margin-bottom: 15px;`;
      
      const imagesTitle = document.createElement('h4');
      imagesTitle.textContent = '预览图片';
      imagesTitle.style.cssText = `margin: 0 0 10px 0; color: var(--text-primary, #333);`;
      
      const imagesList = document.createElement('div');
      imagesList.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px;
      `;
      
      fc2Info.images.forEach((imgSrc, index) => {
        const imgWrapper = document.createElement('a');
        imgWrapper.href = imgSrc;
        imgWrapper.target = '_blank';
        imgWrapper.style.cssText = `
          display: block;
          border-radius: 4px;
          overflow: hidden;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          transition: transform 0.2s;
          border: 1px solid var(--border-primary, #e0e0e0);
        `;
        imgWrapper.onmouseenter = () => imgWrapper.style.transform = 'scale(1.05)';
        imgWrapper.onmouseleave = () => imgWrapper.style.transform = 'scale(1)';
        
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = `预览图 ${index + 1}`;
        img.style.cssText = `
          width: 100%;
          height: auto;
          display: block;
        `;
        
        imgWrapper.appendChild(img);
        imagesList.appendChild(imgWrapper);
      });
      
      imagesDiv.appendChild(imagesTitle);
      imagesDiv.appendChild(imagesList);
      container.appendChild(imagesDiv);
    }

    container.appendChild(title);
    container.appendChild(infoGrid);

    return container;
  }

  /**
   * 创建信息项
   */
  private createInfoItem(label: string, value: string, url?: string): HTMLElement {
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 10px;
      background: var(--bg-tertiary, #f9f9f9);
      border-radius: 4px;
      border: 1px solid var(--border-primary, transparent);
    `;

    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = `
      font-size: 12px;
      color: var(--text-secondary, #666);
      margin-bottom: 4px;
      font-weight: bold;
    `;

    const valueEl = document.createElement('div');
    valueEl.style.cssText = `
      font-size: 14px;
      color: var(--text-primary, #333);
    `;

    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.textContent = value;
      link.style.cssText = `color: var(--primary, #007bff); text-decoration: none;`;
      valueEl.appendChild(link);
    } else {
      valueEl.textContent = value;
    }

    item.appendChild(labelEl);
    item.appendChild(valueEl);

    return item;
  }

  /**
   * 增强详情页相关作品列表的点击行为
   * 支持"TA(們)還出演過"和"你可能也喜歡"区域的作品卡片
   */
  private enhanceRelatedVideoClicks(): void {
    try {
      // 检查是否启用详情页点击增强
      const settings = STATE.settings;
      const enableClickEnhancement = settings?.listEnhancement?.enableClickEnhancement !== false;
      const enableClickEnhancementDetail = settings?.listEnhancement?.enableClickEnhancementDetail !== false;
      
      if (!enableClickEnhancement || !enableClickEnhancementDetail) {
        log('[RelatedVideos] Detail page click enhancement is disabled');
        return;
      }

      // 查找所有相关作品区域的视频卡片链接
      const relatedVideoLinks = document.querySelectorAll('.video-panel .tile-item[href*="/v/"]');
      
      if (relatedVideoLinks.length === 0) {
        log('[RelatedVideos] No related video links found');
        return;
      }

      log(`[RelatedVideos] Found ${relatedVideoLinks.length} related video links, enhancing...`);

      relatedVideoLinks.forEach((link) => {
        const linkElement = link as HTMLAnchorElement;
        
        // 避免重复处理
        if (linkElement.hasAttribute('data-click-enhanced')) {
          return;
        }
        linkElement.setAttribute('data-click-enhanced', 'true');

        // 左键点击：在当前标签打开
        linkElement.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = linkElement.href;
        });

        let rightClickHandled = false;
        const openInBackground = () => {
          const startedAt = performance.now();
          showToast('已在后台打开', 'success');

          void chrome.runtime.sendMessage({
            type: 'OPEN_TAB_BACKGROUND',
            url: linkElement.href
          }).then(() => {
            log(`[RelatedVideos] Background tab opened in ${Math.round(performance.now() - startedAt)}ms`);
          }).catch(err => {
            log('[RelatedVideos] Failed to open background tab:', err);
            window.open(linkElement.href, '_blank');
          });
        };

        // 右键按下：立即在后台打开，减少等待 contextmenu 的体感延迟
        linkElement.addEventListener('mousedown', (e) => {
          if (e.button !== 2) return;
          e.preventDefault();
          e.stopPropagation();
          if (rightClickHandled) return;
          rightClickHandled = true;
          openInBackground();
          window.setTimeout(() => {
            rightClickHandled = false;
          }, 800);
        });

        // 阻止右键菜单；极少数场景下兜底触发后台打开
        linkElement.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (rightClickHandled) return;
          rightClickHandled = true;
          openInBackground();
          window.setTimeout(() => {
            rightClickHandled = false;
          }, 800);
        });
      });

      log('[RelatedVideos] Related video clicks enhanced successfully');
    } catch (error) {
      log('[RelatedVideos] Error enhancing related video clicks:', error);
    }
  }

  // ==================== 🆕 视频预览功能 ====================
  
  /**
   * 注入视频预览样式
   */
  private injectVideoPreviewStyles(): void {
    const styleId = 'video-detail-preview-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* 视频详情页预览样式 */
      .column-video-cover.x-cover,
      .enhanced-cover-container.x-cover {
        position: relative;
        overflow: hidden;
      }

      .column-video-cover.x-preview,
      .enhanced-cover-container.x-preview {
        position: relative;
        display: block;
        overflow: hidden;
      }

      .column-video-cover.x-preview video,
      .enhanced-cover-container.x-preview video {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        z-index: 10;
        background-color: inherit;
        opacity: 0;
        transition: opacity 0.25s ease-in !important;
      }

      /* 加载状态 */
      .column-video-cover.x-holding::after,
      .enhanced-cover-container.x-holding::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 20px;
        height: 20px;
        margin: -10px 0 0 -10px;
        border: 2px solid #fff;
        border-top: 2px solid transparent;
        border-radius: 50%;
        animation: video-preview-spin 1s linear infinite;
        z-index: 3;
      }

      @keyframes video-preview-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;

    document.head.appendChild(style);
    log('Video preview styles injected');
  }
  
  /**
   * 为封面容器添加视频预览功能
   */
  private enhanceVideoPreview(coverElement: HTMLElement, videoCode: string): void {
    // 鼠标悬浮事件
    coverElement.addEventListener('mouseenter', () => {
      this.showPreview(coverElement, videoCode);
    });

    coverElement.addEventListener('mouseleave', (e) => {
      // 检查是否真的离开了元素
      const relatedTarget = e.relatedTarget as Node;
      if (relatedTarget && coverElement.contains(relatedTarget)) {
        return;
      }
      this.hidePreview(coverElement);
    });
  }

  /**
   * 显示视频预览
   */
  private showPreview(coverElement: HTMLElement, videoCode: string): void {
    coverElement.classList.add('x-holding');
    
    // 从设置中获取预览延迟
    const settings = STATE.settings;
    const delay = Number(settings?.listEnhancement?.previewDelay || 1000);
    
    if (delay <= 0) {
      coverElement.classList.remove('x-holding');
      return;
    }

    // 暂停之前正在播放的视频
    if (this.currentPlayingVideo && this.currentPlayingVideo.parentElement) {
      this.releasePreviewVideo(this.currentPlayingVideo);
    }

    // 如果已有视频，直接显示
    const existingVideo = coverElement.querySelector('video');
    if (existingVideo) {
      existingVideo.style.opacity = '1';
      existingVideo.play().catch(() => {});
      this.currentPlayingVideo = existingVideo;
      return;
    }

    this.previewTimer = window.setTimeout(() => {
      this.loadVideoPreview(coverElement, videoCode);
    }, delay < 100 ? 100 : delay);
  }

  /**
   * 隐藏视频预览
   */
  private hidePreview(coverElement: HTMLElement): void {
    coverElement.classList.remove('x-holding');
    
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }

    const video = coverElement.querySelector('video');
    if (!video) return;

    this.releasePreviewVideo(video);
  }

  private releasePreviewVideo(video: HTMLVideoElement): void {
    if (isAttachedNativeJavdbPreview(video)) {
      restoreNativeJavdbPreview(video);
      if (this.currentPlayingVideo === video) {
        this.currentPlayingVideo = null;
      }
      return;
    }

    try {
      video.pause();
    } catch {}

    video.style.opacity = '0';

    try {
      releasePreviewVideoMedia(video);
    } catch (error) {
      log('Failed to release preview video resources:', error);
    }

    if (this.currentPlayingVideo === video) {
      this.currentPlayingVideo = null;
    }

    try {
      video.remove();
    } catch {}
  }

  /**
   * 加载视频预览
   */
  private async loadVideoPreview(coverElement: HTMLElement, videoCode: string): Promise<void> {
    if (!coverElement.classList.contains('x-holding')) {
      return;
    }

    const existingVideo = coverElement.querySelector('video');
    if (existingVideo) {
      existingVideo.style.opacity = '1';
      existingVideo.play().catch(() => {});
      this.currentPlayingVideo = existingVideo;
      return;
    }

    const nativePreview = this.attachNativePreviewIfAvailable(coverElement);
    if (nativePreview) {
      this.currentPlayingVideo = nativePreview;
      return;
    }

    // 检查localStorage缓存
    const cacheKey = `video_preview_${videoCode}`;
    let cachedEntry = null as ReturnType<typeof parsePreviewCacheEntry> | null;
    try {
      cachedEntry = parsePreviewCacheEntry(localStorage.getItem(cacheKey));
    } catch (e) {
      log(`Failed to read from localStorage:`, e);
    }

    if (cachedEntry?.url && isKnownBadVbgflPreviewUrl(videoCode, cachedEntry.url)) {
      log(`Removing stale invalid preview URL cache for ${videoCode}: ${cachedEntry.url}`);
      try {
        localStorage.removeItem(cacheKey);
      } catch (e) {
        log(`Failed to remove invalid preview cache:`, e);
      }
      cachedEntry = null;
    }

    if (cachedEntry?.url) {
      log(`Using cached video URL for ${videoCode}: ${cachedEntry.url}`);
      const video = this.createVideoElement([{ url: cachedEntry.url, type: cachedEntry.type, source: cachedEntry.source }], {
        cacheKey,
        code: videoCode,
        onCacheError: () => this.loadVideoPreviewFromSources(coverElement, videoCode, cacheKey),
      });
      coverElement.appendChild(video);
      this.currentPlayingVideo = video;
      activatePreviewVideoPreload(video);
      return;
    }

    await this.loadVideoPreviewFromSources(coverElement, videoCode, cacheKey);
  }

  private async loadVideoPreviewFromSources(coverElement: HTMLElement, videoCode: string, cacheKey: string): Promise<void> {
    try {
      const videoSources = await this.fetchVideoPreview(videoCode);
      
      if (!coverElement.classList.contains('x-holding')) {
        return;
      }
      
      if (videoSources.length === 0) {
        log(`No preview sources found for ${videoCode}`);
        return;
      }

      const video = this.createVideoElement(videoSources, {
        cacheKey,
        code: videoCode,
      });
      coverElement.appendChild(video);
      this.currentPlayingVideo = video;
      activatePreviewVideoPreload(video);

    } catch (error) {
      log(`Failed to load video preview for ${videoCode}:`, error);
    }
  }

  /**
   * 获取视频预览源
   */
  private async fetchVideoPreview(videoCode: string): Promise<Array<VideoPreviewSource>> {
    const sources: VideoPreviewSource[] = [];

    try {
      log(`Fetching video preview for code: ${videoCode}`);

      // 获取首选来源配置
      const settings = STATE.settings;
      const preferredSource = settings?.listEnhancement?.preferredPreviewSource || 'auto';
      
      const autoOrder = ['javspyl', 'avpreview', 'vbgfl'] as const;
      const order = preferredSource === 'auto'
        ? autoOrder
        : (preferredSource === 'javdb'
          ? autoOrder
          : ([preferredSource, ...autoOrder.filter(x => x !== preferredSource)] as const));
      log(`Preview source order for ${videoCode}: ${order.join(' -> ')}`);
      
      const fetchMethods = order.map((key) => {
        switch (key) {
          case 'javspyl':
            return { name: 'JavSpyl', source: 'javspyl' as const, method: () => this.fetchFromJavSpyl(videoCode) };
          case 'avpreview':
            return { name: 'AVPreview', source: 'avpreview' as const, method: () => this.fetchFromAVPreview(videoCode) };
          case 'vbgfl':
            return { name: 'VBGFL', source: 'vbgfl' as const, method: () => this.fetchFromVBGFL(videoCode) };
          default:
            return { name: 'JavSpyl', source: 'javspyl' as const, method: () => this.fetchFromJavSpyl(videoCode) };
        }
      });

      for (const { name, source, method } of fetchMethods) {
        try {
          log(`Trying ${name} for ${videoCode}...`);
          const url = await method();

          if (url) {
            const normalizedUrl = normalizePreviewUrl(url);
            log(`${name} returned URL: ${normalizedUrl}`);
            sources.push({ url: normalizedUrl, type: getPreviewSourceType(normalizedUrl), source });
          }
        } catch (error) {
          log(`${name} failed for ${videoCode}:`, error);
        }
      }

    } catch (error) {
      log(`Error fetching video preview for ${videoCode}:`, error);
    }

    return sources;
  }

  private attachNativePreviewIfAvailable(coverElement: HTMLElement): HTMLVideoElement | null {
    const settings = STATE.settings;
    const volume = Number(settings?.listEnhancement?.previewVolume ?? 0.2);
    const video = attachNativeJavdbPreview(coverElement, volume);
    if (video) {
      log('Using native JavDB preview video on detail page');
    }
    return video;
  }

  /**
   * 从VBGFL源获取视频
   */
  private async fetchFromVBGFL(code: string): Promise<string | null> {
    try {
      const normalizedCode = code.replace(/HEYZO-/gi, "").toLowerCase();
      const urls: string[] = [];

      // Tokyo Hot
      const isTokyoHot = /^n\d{3,6}$/i.test(normalizedCode);
      if (isTokyoHot) {
        urls.push(`https://my.cdn.tokyo-hot.com/media/samples/${normalizedCode}.mp4`);
      }

      // Caribbeancom
      if (code.includes('-') && /^\d{6}-\d{3}$/.test(code)) {
        urls.push(`https://smovie.caribbeancom.com/sample/movies/${normalizedCode}/720p.mp4`);
      }

      // 1Pondo
      if (isVbgflPondoCode(code)) {
        const pondo = code.replace('-', '_').toLowerCase();
        urls.push(`https://smovie.1pondo.tv/sample/movies/${pondo}/1080p.mp4`);
      }

      // Heyzo
      if (code.toLowerCase().includes('heyzo') || /^\d{4}$/.test(normalizedCode)) {
        const heyzoCode = normalizedCode.replace('heyzo-', '');
        urls.push(`https://sample.heyzo.com/contents/3000/${heyzoCode}/heyzo_hd_${heyzoCode}_sample.mp4`);
      }

      if (urls.length > 0) {
        return urls[0];
      }
    } catch (error) {
      log(`VBGFL fetch error for ${code}:`, error);
    }
    return null;
  }

  /**
   * 从JavSpyl获取视频
   */
  private async fetchFromJavSpyl(code: string): Promise<string | null> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_JAVSPYL_PREVIEW',
        code: code
      });

      if (response?.success && response?.videoUrl) {
        return response.videoUrl;
      }
    } catch (error) {
      log(`JavSpyl fetch error for ${code}:`, error);
    }
    return null;
  }

  /**
   * 从AVPreview获取视频
   */
  private async fetchFromAVPreview(code: string): Promise<string | null> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_AVPREVIEW_PREVIEW',
        code: code
      });

      if (response?.success && response?.videoUrl) {
        return response.videoUrl;
      }
    } catch (error) {
      log(`AVPreview fetch error for ${code}:`, error);
    }
    return null;
  }

  /**
   * 创建视频元素
   */
  private createVideoElement(sources: VideoPreviewSource[], options?: VideoPreviewOptions): HTMLVideoElement {
    const video = document.createElement('video');

    // 从设置中获取音量配置
    const settings = STATE.settings;
    const volume = Number(settings?.listEnhancement?.previewVolume ?? 0.2);

    video.autoplay = true;
    video.muted = false;
    video.loop = true;
    video.playsInline = true;
    video.controls = true;
    video.preload = 'auto';
    video.volume = Math.max(0, Math.min(1, volume)); // 确保音量在 0-1 范围内
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    
    video.setAttribute('controlsList', 'nodownload noremoteplayback');
    video.className = 'fancybox-video x-preview-video';
    
    video.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 10;
      opacity: 0;
      transition: opacity 0.25s ease-in;
      background-color: inherit;
    `;

    sources.forEach(source => {
      const sourceElement = document.createElement('source');
      sourceElement.src = source.url;
      sourceElement.type = source.type;
      video.appendChild(sourceElement);
    });

    const persistPreviewCache = () => {
      if (!options || !sources[0]) return;
      try {
        const currentUrl = normalizePreviewUrl(video.currentSrc || sources[0].url);
        const source = sources.find(candidate => normalizePreviewUrl(candidate.url) === currentUrl) || sources[0];
        localStorage.setItem(options.cacheKey, serializePreviewCacheEntry(createPreviewCacheEntry(currentUrl, source.source || 'cache')));
      } catch (e) {
        log(`Failed to cache verified preview URL for ${options.code}:`, e);
      }
    };

    const retryPreview = () => {
      if (!options) return;
      try {
        localStorage.removeItem(options.cacheKey);
      } catch {}
      options.onCacheError?.();
    };

    video.addEventListener('loadeddata', () => {
      log(`Video loaded successfully: ${sources[0]?.url}`);
      persistPreviewCache();
    });

    video.addEventListener('canplay', () => {
      log(`Video canplay event triggered, parentElement: ${!!video.parentElement}`);
      persistPreviewCache();
      if (video.parentElement) {
        video.style.opacity = '1';
        video.play().catch(err => {
          log(`Video play failed in canplay: ${err.message}`);
        });
      }
    });

    video.addEventListener('loadedmetadata', () => {
      log(`Video metadata loaded: ${sources[0]?.url}`);
      persistPreviewCache();
      if (video.parentElement && video.readyState >= 2) {
        video.style.opacity = '1';
        video.play().catch(err => {
          log(`Video play failed in loadedmetadata: ${err.message}`);
        });
      }
    });

    video.addEventListener('error', () => {
      log(`Video error for ${sources[0]?.url}`);
      retryPreview();
      if (video.parentNode) {
        video.remove();
      }
    });

    return video;
  }
}

// 导出增强器实例
export const videoDetailEnhancer = new VideoDetailEnhancer();
interface VideoPreviewSource {
  url: string;
  type: string;
  source?: PreviewSourceName;
}

interface VideoPreviewOptions {
  cacheKey: string;
  code: string;
  onCacheError?: () => void;
}
