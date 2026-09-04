/**
 * @file contentFilterManager.ts
 * @description contentFilterManager
 * @module features/contentFilter
 */
// src/features/contentFilter/contentFilterManager.ts
// 内容过滤系统

import { STATE, log } from '../contentState';
import { showToast } from '../../platform/browser/toast';
import type { KeywordFilterRule, ContentFilterConfig } from '../../types';
import { countContentPerformanceEvent, recordContentPerformanceDuration, runChunkedWork, saveSubtaskDetail, yieldToMainThread } from '../../platform/tasks';

// 重新导出类型以保持向后兼容性
export type { KeywordFilterRule, ContentFilterConfig };

export class ContentFilterManager {
  private config: ContentFilterConfig;
  private filteredElements: Map<HTMLElement, KeywordFilterRule> = new Map();
  private observer: MutationObserver | null = null;
  private isInitialized = false;
  private filterStats = {
    hidden: 0,
    highlighted: 0,
    blurred: 0,
    marked: 0,
  };
  private lastApplyTime = 0; // 防止并发重入
  private isApplyingFilters = false; // 防止无限循环
  private filterDebounceTimer: ReturnType<typeof setTimeout> | null = null; // 防抖计时器
  private pendingRerun = false; // 过滤执行中有新条目进来时标记
  private pendingItems: Set<HTMLElement> = new Set(); // 动态列表中待处理的新卡片

  constructor(config: Partial<ContentFilterConfig> = {}) {
    this.config = {
      enabled: true,
      showFilteredCount: true,
      hideEnabled: true,
      keywordRules: [],
      ...config,
    };
  }

  /**
   * 初始化关键字过滤系统
   */
  private injectHighlightStyles(): void {
    if (document.getElementById('content-filter-highlight-styles')) return;
    const style = document.createElement('style');
    style.id = 'content-filter-highlight-styles';
    style.textContent = `
      @keyframes cf-amber-pulse {
        0%   { box-shadow: 0 0  6px 1px rgba(255,193,7,0.45), inset 0 0 0 2px rgba(255,193,7,0.25); }
        50%  { box-shadow: 0 0 18px 4px rgba(255,193,7,0.75), inset 0 0 0 2px rgba(255,193,7,0.55); }
        100% { box-shadow: 0 0  6px 1px rgba(255,193,7,0.45), inset 0 0 0 2px rgba(255,193,7,0.25); }
      }
      .content-filter-highlighted {
        outline: 2px solid rgba(255,193,7,0.85) !important;
        outline-offset: -2px !important;
        border-radius: 8px !important;
        animation: cf-amber-pulse 2.4s ease-in-out infinite !important;
        background-color: transparent !important;
        border: none !important;
        transform: none !important;
        transition: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled || this.isInitialized) {
      return;
    }

    try {
      log('Initializing keyword filter system...');

      await runChunkedWork([
        async () => {
          this.injectHighlightStyles();
          if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
          }
        },
        async () => {
          this.loadDefaultKeywordRules();
        },
        async () => {
          await this.applyFilters();
        },
        async () => {
          this.observePageChanges();
        },
        async () => {
          if (this.config.showFilteredCount) {
            this.showFilterStats();
          }
        }
      ], {
        batchSize: 1,
        parentLabel: 'contentFilter:initialize',
        yieldAfterBatch: async () => {
          await yieldToMainThread(0);
        },
        onBatchComplete: async ({ batchIndex }) => {
          const subtaskLabels = ['reset-observer', 'load-rules', 'apply-filters', 'observe-page', 'show-stats'];
          saveSubtaskDetail({
            label: `contentFilter:initialize:${subtaskLabels[batchIndex] || 'step'}`,
            parentLabel: 'contentFilter:initialize',
            subtaskLabel: subtaskLabels[batchIndex] || 'step',
            batchIndex,
            itemCount: 1,
            phase: 'idle',
            status: 'done',
            durationMs: 0,
          });
        },
        onItem: async (step) => {
          await step();
        }
      });

      this.isInitialized = true;
      log('Keyword filter system initialized');
    } catch (error) {
      log('Error initializing keyword filter:', error);
    }
  }

  /**
   * 加载默认关键字过滤规则
   */
  private loadDefaultKeywordRules(): void {
    // 从全局 STATE.settings 中加载已保存的规则（由设置面板管理与持久化）
    try {
      const rules = STATE.settings?.contentFilter?.keywordRules || [];
      this.config.keywordRules = Array.isArray(rules) ? rules : [];
      log(`Loaded ${this.config.keywordRules.length} keyword filter rules from settings`);
    } catch (e) {
      log('Failed to load keyword rules from settings:', e);
      // 兜底：保持现有配置中的规则（若有）
      log(`Loaded ${this.config.keywordRules.length} keyword filter rules (fallback)`);
    }
  }

  /**
   * 应用过滤规则
   */
  private async applyFilters(items?: readonly HTMLElement[]): Promise<void> {
    const applyStartedAt = performance.now();
    try {
      // 防止并发重入
      if (this.isApplyingFilters) {
        log('[ContentFilter] applyFilters skipped — already running, setting pendingRerun=true');
        if (items) {
          for (const item of items) {
            this.pendingItems.add(item);
          }
        }
        this.pendingRerun = true;
        return;
      }

      // 防止极短时间内重复触发（仅防并发，不做长冷却）
      const now = Date.now();
      if (now - this.lastApplyTime < 50) {
        log(`[ContentFilter] applyFilters skipped — too soon (${now - this.lastApplyTime}ms since last run)`);
        return;
      }
      this.lastApplyTime = now;
      this.isApplyingFilters = true;
      countContentPerformanceEvent('contentFilter.apply');
      log(`[ContentFilter] applyFilters START at ${new Date().toISOString()}`);

      // 检查是否在详情页，如果是则不应用过滤器
      if (this.isDetailPage()) {
        log('Content filter skipped: on detail page');
        // 清理详情页可能存在的过滤效果
        this.clearDetailPageFilters();
        return;
      }

      // 重置统计
      this.filterStats = { hidden: 0, highlighted: 0, blurred: 0, marked: 0 };

      // 首次初始化或显式配置变更才扫描完整页面；动态列表只处理 observer 收集的新卡片。
      const videoItems = items ? Array.from(new Set(items)).filter(item => item.isConnected) : this.findVideoItems();
      const unprocessed = videoItems.filter(i => !i.hasAttribute('data-filter-processed'));
      const alreadyProcessed = videoItems.length - unprocessed.length;
      countContentPerformanceEvent('contentFilter.items', videoItems.length);
      log(`[ContentFilter] found ${videoItems.length} items total: ${unprocessed.length} new, ${alreadyProcessed} already processed`);

      // 简化日志输出
      const activeRules = this.config.keywordRules.filter(r => r.enabled);
      if (activeRules.length > 0) {
        log(`Content filter: ${activeRules.length} active rules, ${videoItems.length} items`);
      }

      await runChunkedWork(videoItems, {
        batchSize: 8,
        parentLabel: 'contentFilter:initialize',
        yieldAfterBatch: async () => {
          await yieldToMainThread(0);
        },
        onBatchComplete: async ({ batchIndex, itemCount, processed }) => {
          saveSubtaskDetail({
            label: 'contentFilter:initialize:apply-batch',
            parentLabel: 'contentFilter:initialize',
            subtaskLabel: 'apply-batch',
            batchIndex,
            itemCount,
            detail: `processed=${processed}`,
            phase: 'idle',
            status: 'done',
            durationMs: 0,
          });
        },
        onItem: async (item) => {
          this.applyFiltersToItem(item);
        }
      });

      log(`[ContentFilter] applyFilters DONE — hidden:${this.filterStats.hidden} highlighted:${this.filterStats.highlighted} blurred:${this.filterStats.blurred} marked:${this.filterStats.marked}`);
    } catch (error) {
      log('Error applying filters:', error);
    } finally {
      // 重置标志，允许下次应用
      this.isApplyingFilters = false;
      recordContentPerformanceDuration('contentFilter.apply', performance.now() - applyStartedAt);
      // 若执行期间有新条目进来，立即补跑一次
      if (this.pendingRerun) {
        this.pendingRerun = false;
        log('[ContentFilter] pendingRerun=true — triggering follow-up applyFilters');
        void this.applyFilters(this.takePendingItems()).catch(error => {
          log('Error in pending rerun of filters:', error);
        });
      }
    }
  }

  /**
   * 对单个项目应用关键字过滤规则
   */
  private applyFiltersToItem(item: HTMLElement): void {
    try {
      // 检查是否已经处理过
      if (item.hasAttribute('data-filter-processed')) {
        return; // 已处理，静默跳过
      }

      // 清除之前的过滤效果。
      // 注意：状态/VR/演员等“内置隐藏”不再由本模块接管，
      // 统一交由 list-hiding 依据各自开关重算，避免与它们互相覆盖。
      this.clearItemFilters(item);

      // 提取项目信息
      const itemData = this.extractItemData(item);

      // 简化调试：只在需要时输出
      // if (this.filterStats.hidden + this.filterStats.highlighted < 3) {
      //   log(`Item ${this.filterStats.hidden + this.filterStats.highlighted + 1} data:`, itemData);
      // }

      // 应用启用的关键字规则
      const enabledRules = this.config.keywordRules.filter(rule => rule.enabled);

      // 应用匹配的规则
      for (const rule of enabledRules) {
        if (this.evaluateKeywordRule(rule, itemData)) {
          log(`Applying rule "${rule.name}" (${rule.action}) to item: ${itemData.title}`);
          this.applyRuleAction(item, rule);
          this.filteredElements.set(item, rule);
          break; // 只应用第一个匹配的规则
        }
      }

      // 标记为已处理
      item.setAttribute('data-filter-processed', 'true');
    } catch (error) {
      log('Error applying filters to item:', error);
    }
  }

  /**
   * 检查是否在详情页
   */
  private isDetailPage(): boolean {
    // 检查URL是否为详情页格式 (/v/xxx)。
    // 注意：仅当路径“整体”是 /v/xxx 时才视为详情页；
    // 列表页（/、/tags 等）内卡片链接 a[href="/v/..."] 不算。
    let isDetailUrl = false;
    try {
      isDetailUrl = /^\/v\/[^\/]+$/.test(window.location.pathname);
    } catch {
      isDetailUrl = false;
    }

    // 检查页面是否有详情页特有的元素
    const hasDetailElements = !!(
      document.querySelector('.movie-panel-info') ||
      document.querySelector('.video-detail') ||
      document.querySelector('.movie-info') ||
      document.querySelector('.preview-images') ||
      document.querySelector('.tile-images') ||
      document.querySelector('[href^="magnet:"]')
    );

    return isDetailUrl || hasDetailElements;
  }

  /**
   * 清理详情页的过滤效果
   */
  private clearDetailPageFilters(): void {
    try {
      // 查找所有可能被过滤的元素
      const filteredElements = document.querySelectorAll('[data-filter-applied], .content-filter-highlighted, .content-filter-hidden, .content-filter-blurred, .content-filter-marked');

      filteredElements.forEach(element => {
        const htmlElement = element as HTMLElement;

        // 移除过滤相关的类
        htmlElement.classList.remove('content-filter-highlighted', 'content-filter-hidden', 'content-filter-blurred', 'content-filter-marked');

        // 移除过滤相关的属性
        htmlElement.removeAttribute('data-filter-applied');
        htmlElement.removeAttribute('data-filtered-by');
        htmlElement.removeAttribute('data-filter-type');
        htmlElement.removeAttribute('data-filter-processed');

        // 清理样式
        const stylesToClear = ['backgroundColor', 'border', 'borderRadius', 'boxShadow', 'transform', 'transition', 'filter', 'opacity', 'display'];
        stylesToClear.forEach(style => {
          htmlElement.style.removeProperty(style);
        });
      });

      log(`Cleared filter effects from ${filteredElements.length} elements on detail page`);
    } catch (error) {
      log('Error clearing detail page filters:', error);
    }
  }

  /**
   * 查找视频项目元素
   */
  private findVideoItems(root: ParentNode = document): HTMLElement[] {
    // 仅选择具体的卡片元素，避免误选列表容器
    const selectors = [
      '.movie-list .item',
      '.video-list .item',
      '.movie-item',
      '.video-item',
      '.item',
      '.grid-item'
    ];

    const items: HTMLElement[] = [];

    selectors.forEach(selector => {
      const elements = root.querySelectorAll(selector);
      elements.forEach(node => {
        let el = node as HTMLElement;

        // 如果命中的是容器，跳过
        if (el.matches('.movie-list, .video-list, .videos, .movies, .list, .grid, .grid-list')) {
          return;
        }

        // 如果命中的是子元素，提升到最近的卡片元素
        const card = el.closest('.item, .movie-item, .video-item, .grid-item') as HTMLElement || el;

        // 如果卡片本身仍是容器（极端情况），跳过
        if (card.matches('.movie-list, .video-list, .videos, .movies, .list, .grid, .grid-list')) {
          return;
        }

        // 仅当确认为视频卡片，且不包含其它卡片（避免对容器应用样式）
        if (this.isVideoItem(card)) {
          items.push(card);
        }
      });
    });

    // querySelectorAll 不会包含 root 自身；动态 observer 直接收到卡片节点时需要补上它。
    if (root instanceof HTMLElement && this.isVideoItem(root)) {
      items.push(root);
    }

    // 去重
    return Array.from(new Set(items));
  }

  /**
   * 判断是否为视频项目
   */
  private isVideoItem(element: HTMLElement): boolean {
    // 明确排除列表/网格容器
    if (element.matches('.movie-list, .video-list, .videos, .movies, .list, .grid, .grid-list')) {
      return false;
    }

    // 必须是卡片类或其本身有链接到详情页
    const isCardClass = element.matches('.item, .movie-item, .video-item, .grid-item');
    const hasLink = !!element.querySelector('a[href*="/v/"], a[href*="/movie/"]');

    // 若该元素内部仍包含其它卡片，视为容器而非单个卡片
    const containsCards = !!element.querySelector('.item, .movie-item, .video-item, .grid-item');

    if (containsCards) {
      return false;
    }

    // 简化条件：是卡片类，或具备到详情页的链接
    return isCardClass || hasLink;
  }

  /**
   * 提取项目数据
   */
  private extractItemData(item: HTMLElement): Record<string, string> {
    const data: Record<string, string> = {};

    try {
      // 提取标题 - JavDB列表页结构分析
      // 在JavDB列表页，标题信息通常在以下位置：
      // 1. a[title] 属性中包含完整标题
      // 2. .video-title 中的文本内容
      // 3. 链接的title属性

      let titleText = '';

      // 方法1: 从链接的title属性获取（最可靠）
      const linkWithTitle = item.querySelector('a[title]');
      if (linkWithTitle) {
        titleText = linkWithTitle.getAttribute('title')?.trim() || '';
        if (titleText && titleText.length > 10) {
          data.title = titleText;
        }
      }

      // 方法2: 如果没有找到，尝试从data-title属性获取
      if (!data.title) {
        const elementWithDataTitle = item.querySelector('[data-title]');
        if (elementWithDataTitle) {
          titleText = elementWithDataTitle.getAttribute('data-title')?.trim() || '';
          if (titleText && titleText.length > 10) {
            data.title = titleText;
          }
        }
      }

      // 方法3: 从.video-title或类似容器获取
      if (!data.title) {
        const titleSelectors = [
          '.video-title',
          '.movie-title',
          '.item-title',
          '.title'
        ];

        for (const selector of titleSelectors) {
          const titleElement = item.querySelector(selector);
          if (titleElement) {
            titleText = titleElement.textContent?.trim() || '';
            // 过滤掉看起来像番号的文本（通常是字母+数字的组合）
            if (titleText && titleText.length > 10 && !titleText.match(/^[A-Z]+-\d+$/)) {
              data.title = titleText;
              break;
            }
          }
        }
      }

      // 方法4: 智能文本提取 - 从所有文本中找到最像标题的内容
      if (!data.title) {
        const allText = item.textContent?.trim() || '';
        const lines = allText.split('\n').map(line => line.trim()).filter(Boolean);

        for (const line of lines) {
          // 跳过番号格式的文本
          if (line.match(/^[A-Z]+-\d+$/)) continue;
          // 跳过纯数字
          if (line.match(/^\d+$/)) continue;
          // 跳过太短的文本
          if (line.length < 10) continue;
          // 跳过太长的文本（可能是描述）
          if (line.length > 200) continue;
          // 跳过包含特殊标记的文本
          if (line.includes('含磁鏈') || line.includes('今日新種')) continue;

          // 找到合适的标题
          data.title = line;
          break;
        }
      }

      // 如果仍然没有找到，至少记录番号作为标识
      if (!data.title) {
        const codeElement = item.querySelector('.video-title strong:first-child, .code, .video-code');
        if (codeElement) {
          const code = codeElement.textContent?.trim();
          if (code) {
            data['video-code'] = code;
            // 临时使用番号，但标记为需要改进
            data.title = `[${code}] - 标题提取失败`;
          }
        }
      }

      // 提取视频ID
      const linkElement = item.querySelector('a[href*="/v/"], a[href*="/movie/"]');
      if (linkElement) {
        const href = (linkElement as HTMLAnchorElement).href;
        const match = href.match(/\/v\/([^\/\?]+)/);
        if (match) {
          data['video-id'] = match[1];
        }
        data.url = href;
      }

      // 提取演员信息
      const actorElements = item.querySelectorAll('.actor, .cast, .performer');
      if (actorElements.length > 0) {
        data.actor = Array.from(actorElements)
          .map(el => el.textContent?.trim())
          .filter(Boolean)
          .join(', ');
      }

      // 提取制作商
      const studioElement = item.querySelector('.studio, .maker');
      if (studioElement) {
        data.studio = studioElement.textContent?.trim() || '';
      }

      // 提取类别/标签
      const genreElements = item.querySelectorAll('.genre, .tag, .category');
      if (genreElements.length > 0) {
        data.genre = Array.from(genreElements)
          .map(el => el.textContent?.trim())
          .filter(Boolean)
          .join(', ');
      }

      // 提取发行日期
      const dateSelectors = [
        '.meta',
        '.date',
        '.release-date',
        '.video-meta-panel .value'
      ];

      for (const selector of dateSelectors) {
        const dateElement = item.querySelector(selector);
        if (dateElement) {
          const dateText = dateElement.textContent?.trim() || '';
          // 匹配日期格式：YYYY-MM-DD 或 YYYY/MM/DD
          const dateMatch = dateText.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
          if (dateMatch) {
            // 标准化为 YYYY-MM-DD 格式
            const year = dateMatch[1];
            const month = dateMatch[2].padStart(2, '0');
            const day = dateMatch[3].padStart(2, '0');
            data['release-date'] = `${year}-${month}-${day}`;
            break;
          }
        }
      }

    } catch (error) {
      log('Error extracting item data:', error);
    }

    // 简化调试：只在标题提取失败时输出警告
    if (!data.title || data.title.includes('标题提取失败')) {
      log('Warning: Title extraction failed for item');
    }

    return data;
  }

  /**
   * 清除项目的过滤效果
   */
  private clearItemFilters(item: HTMLElement): void {
    // 本模块只管理“关键字过滤规则”的隐藏，
    // 不触碰 list-hiding（状态/VR/演员）维护的默认隐藏标记，
    // 避免清除掉由开关控制、来源不同的隐藏状态。
    if (item.classList.contains('content-filter-hidden')) {
      item.style.display = '';
      item.classList.remove('content-filter-hidden');
      item.removeAttribute('data-hidden-by-filter');
    }

    // 清除智能过滤相关的样式
    item.style.backgroundColor = '';
    item.style.color = '';
    item.style.border = '';
    item.style.opacity = '';
    item.style.filter = '';

    // 移除智能过滤相关的CSS类
    item.classList.remove('content-filter-marked', 'content-filter-hidden', 'content-filter-highlighted', 'content-filter-blurred');

    // 移除智能过滤相关的属性
    item.removeAttribute('data-filter-applied');
    item.removeAttribute('data-filtered-by');
    item.removeAttribute('data-filter-type');
    item.removeAttribute('data-hidden-by-filter');
    item.removeAttribute('data-filter-processed');

    // 移除过滤消息
    const filterMessage = item.querySelector('.filter-message');
    if (filterMessage) {
      filterMessage.remove();
    }
  }

  /**
   * 评估关键字过滤规则
   */
  private evaluateKeywordRule(rule: KeywordFilterRule, itemData: Record<string, string>): boolean {
    try {
      // 首先检查发行日期范围（如果启用）
      if (rule.releaseDateRange?.enabled) {
        const releaseDate = itemData['release-date'];
        if (releaseDate) {
          const isInDateRange = this.checkDateRange(
            releaseDate,
            rule.releaseDateRange
          );
          
          if (!isInDateRange) {
            // 如果不在日期范围内，直接返回 false
            return false;
          }
          
          // 如果在日期范围内，继续检查其他字段
          log(`✓ Rule "${rule.name}" date range matched: ${releaseDate}`);
        } else {
          // 如果没有发行日期信息，且启用了日期过滤，则不匹配
          return false;
        }
      }

      // 检查指定字段中是否有匹配的关键字
      for (const field of rule.fields) {
        const fieldValue = itemData[field] || '';
        const isMatch = this.matchKeyword(rule.keyword, fieldValue, rule.isRegex, rule.caseSensitive);

        // 只在匹配成功时输出日志
        if (isMatch) {
          log(`✓ Rule "${rule.name}" matched: "${rule.keyword}" in ${field}="${fieldValue}"`);
        }

        if (isMatch) {
          return true;
        }
      }
      return false;
    } catch (error) {
      log('Error evaluating keyword rule:', error);
      return false;
    }
  }

  /**
   * 检查日期是否在指定范围内
   */
  private checkDateRange(dateStr: string, dateRange: NonNullable<KeywordFilterRule['releaseDateRange']>): boolean {
    try {
      const date = new Date(dateStr);
      
      if (isNaN(date.getTime())) {
        return false;
      }

      const comparison = dateRange.comparison || 'between';

      switch (comparison) {
        case 'between':
          // 在范围内（包含边界）
          if (dateRange.startDate) {
            const start = new Date(dateRange.startDate);
            if (date < start) {
              return false;
            }
          }
          if (dateRange.endDate) {
            const end = new Date(dateRange.endDate);
            if (date > end) {
              return false;
            }
          }
          return true;

        case 'before':
          // 早于指定日期
          if (dateRange.exactDate) {
            const target = new Date(dateRange.exactDate);
            return date < target;
          } else if (dateRange.endDate) {
            const target = new Date(dateRange.endDate);
            return date < target;
          }
          return false;

        case 'after':
          // 晚于指定日期
          if (dateRange.exactDate) {
            const target = new Date(dateRange.exactDate);
            return date > target;
          } else if (dateRange.startDate) {
            const target = new Date(dateRange.startDate);
            return date > target;
          }
          return false;

        case 'exact':
          // 精确匹配日期
          if (dateRange.exactDate) {
            const target = new Date(dateRange.exactDate);
            return date.toDateString() === target.toDateString();
          }
          return false;

        default:
          return false;
      }
    } catch (error) {
      log('Error checking date range:', error);
      return false;
    }
  }

  /**
   * 匹配关键字
   */
  private matchKeyword(keyword: string, text: string, isRegex: boolean, caseSensitive: boolean): boolean {
    try {
      if (isRegex) {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(keyword, flags);
        return regex.test(text);
      } else {
        const searchText = caseSensitive ? text : text.toLowerCase();
        const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();
        return searchText.includes(searchKeyword);
      }
    } catch (error) {
      log('Error matching keyword:', error);
      return false;
    }
  }



  /**
   * 应用规则动作
   */
  private applyRuleAction(item: HTMLElement, rule: KeywordFilterRule): void {
    const shouldSkipHideActions = this.shouldSkipHideActionsOnCurrentPage();

    switch (rule.action) {
      case 'hide':
        if (shouldSkipHideActions) {
          break;
        }
        // 隐藏动作受开关控制：全局“隐藏开关”(config.hideEnabled) 或单规则 hideEnabled。
        // 任一为 false 时匹配后不隐藏，卡片保持原样。
        const hideAllowed = this.config.hideEnabled !== false && rule.hideEnabled !== false;
        if (hideAllowed) {
          item.style.display = 'none';
          item.classList.add('content-filter-hidden');
          item.setAttribute('data-filter-applied', 'hide');
          item.setAttribute('data-hidden-by-filter', 'true');
          this.filterStats.hidden++;
        }
        break;

      case 'highlight':
        if (rule.style) {
          Object.assign(item.style, rule.style);
        }
        item.classList.add('content-filter-highlighted');
        item.setAttribute('data-filter-applied', 'highlight');
        this.filterStats.highlighted++;
        break;

      case 'blur':
        item.style.filter = rule.style?.filter || 'blur(5px)';
        if (rule.style?.opacity !== undefined) {
          item.style.opacity = rule.style.opacity.toString();
        } else {
          item.style.opacity = '0.6';
        }
        item.classList.add('content-filter-blurred');
        item.setAttribute('data-filter-applied', 'blur');
        this.filterStats.blurred++;
        break;

      case 'mark':
        if (rule.style) {
          Object.assign(item.style, rule.style);
        } else {
          // 默认标记样式 - 红色边框
          item.style.border = '2px solid #dc3545';
          item.style.borderRadius = '6px';
        }
        item.classList.add('content-filter-marked');
        item.setAttribute('data-filter-applied', 'mark');
        if (rule.message) {
          this.addFilterMessage(item, rule.message);
        }
        this.filterStats.marked++;
        break;
    }

    // 添加过滤标记
    item.setAttribute('data-filtered-by', rule.id);
    item.setAttribute('data-filter-type', rule.action);
  }

  /**
   * 添加过滤消息
   */
  private addFilterMessage(item: HTMLElement, message: string): void {
    const messageElement = document.createElement('div');
    messageElement.className = 'filter-message';
    messageElement.textContent = message;
    messageElement.style.cssText = `
      position: absolute;
      top: 5px;
      right: 5px;
      background: rgba(255, 193, 7, 0.9);
      color: #333;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      z-index: 10;
    `;

    // 确保父元素有相对定位
    if (getComputedStyle(item).position === 'static') {
      item.style.position = 'relative';
    }

    item.appendChild(messageElement);
  }

  private shouldSkipHideActionsOnCurrentPage(): boolean {
    try {
      const p = window.location.pathname;
      return p.startsWith('/users/want_watch_videos') || p.startsWith('/users/watched_videos');
    } catch {
      return false;
    }
  }

  /**
   * 从项目元素中提取视频ID
   */
  private extractVideoId(item: HTMLElement): string | null {
    try {
      // 尝试从链接href中提取
      const link = item.querySelector('a[href*="/v/"]') as HTMLAnchorElement;
      if (link) {
        const match = link.href.match(/\/v\/([^/?]+)/);
        if (match) {
          return match[1];
        }
      }

      // 尝试从data-code属性中提取
      const codeElement = item.querySelector('[data-code]');
      if (codeElement) {
        return codeElement.getAttribute('data-code');
      }

      return null;
    } catch (error) {
      log('Error extracting video ID:', error);
      return null;
    }
  }





  /**
   * 添加关键字规则
   */
  addKeywordRule(keyword: string, action: 'hide' | 'highlight', isRegex: boolean, caseSensitive: boolean): void {
    const rule: KeywordFilterRule = {
      id: `keyword-${action}-${Date.now()}`,
      name: `${action === 'hide' ? '隐藏' : '高亮'}: ${keyword}`,
      keyword,
      isRegex,
      caseSensitive,
      action,
      enabled: true,
      fields: ['title', 'actor', 'studio', 'video-id'],
    };

    if (action === 'highlight') {
      rule.style = {
        backgroundColor: '#fff3cd',
        border: '2px solid #ffc107',
      };
    }

    this.config.keywordRules.push(rule);
  }

  /**
   * 重置过滤器
   */
  resetFilters(): void {
    // 清除所有关键字规则
    this.config.keywordRules = [];

    // 清除所有过滤效果
    this.clearAllFilters();

    this.showFilterStats();
    showToast('关键字过滤已重置', 'info');
  }

  /**
   * 清除所有过滤效果
   */
  private clearAllFilters(): void {
    this.cleanupDetachedFilteredElements();
    this.filteredElements.forEach((_, element) => {
      // 只恢复“关键字过滤规则”造成的隐藏，
      // 不触碰 list-hiding（状态/VR/演员）维护的默认隐藏状态。
      if (element.classList.contains('content-filter-hidden')) {
        element.style.display = '';
        element.classList.remove('content-filter-hidden');
        element.removeAttribute('data-hidden-by-filter');
      }

      // 清除智能过滤相关的样式
      element.style.backgroundColor = '';
      element.style.color = '';
      element.style.border = '';
      element.style.opacity = '';
      element.style.filter = '';

      // 移除智能过滤相关的类和属性
      element.classList.remove('content-filter-marked', 'content-filter-hidden', 'content-filter-highlighted', 'content-filter-blurred');
      element.removeAttribute('data-filtered-by');
      element.removeAttribute('data-filter-type');
      element.removeAttribute('data-filter-applied');
      element.removeAttribute('data-hidden-by-filter');
      element.removeAttribute('data-filter-processed');

      // 移除过滤消息
      const message = element.querySelector('.filter-message');
      if (message) {
        message.remove();
      }
    });

    this.filteredElements.clear();
  }

  /** 清理已从页面移除的节点，避免 Map 长期持有 DOM 引用。 */
  private cleanupDetachedFilteredElements(): void {
    for (const element of this.filteredElements.keys()) {
      if (!element.isConnected) {
        this.filteredElements.delete(element);
      }
    }
  }

  /**
   * 显示过滤统计
   */
  private showFilterStats(): void {
    if (!this.config.showFilteredCount) return;

    const total = this.filterStats.hidden + this.filterStats.highlighted + 
                 this.filterStats.blurred + this.filterStats.marked;

    if (total > 0) {
      const message = `过滤: 隐藏${this.filterStats.hidden} 高亮${this.filterStats.highlighted} 模糊${this.filterStats.blurred} 标记${this.filterStats.marked}`;
      showToast(message, 'info');
    }
  }

  /**
   * 监听页面变化
   */
  private observePageChanges(): void {
    this.observer = new MutationObserver((mutations) => {
      countContentPerformanceEvent('observer.contentFilter.callback');
      countContentPerformanceEvent('observer.contentFilter.mutations', mutations.length);
      let hasNewVideoItems = false;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;

        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          this.removeDetachedItems(node as HTMLElement);
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const items = this.findVideoItems(node as HTMLElement);
          for (const item of items) {
            if (!item.hasAttribute('data-filter-processed')) {
              this.pendingItems.add(item);
              hasNewVideoItems = true;
            }
          }
        }
      }

      this.cleanupDetachedFilteredElements();

      if (hasNewVideoItems) {
        // 防抖：重置计时器，确保最后一批条目加载完后才执行过滤
        if (this.filterDebounceTimer !== null) {
          clearTimeout(this.filterDebounceTimer);
          log('[ContentFilter] debounce reset — new items arrived before previous timer fired');
        }
        log('[ContentFilter] new video items detected, scheduling debounced applyFilters (500ms)');
        this.filterDebounceTimer = setTimeout(() => {
          this.filterDebounceTimer = null;
          const pendingItems = this.takePendingItems();
          log(`[ContentFilter] debounce fired — processing ${pendingItems.length} new items`);
          this.applyFilters(pendingItems).catch(error => {
            log('Error reapplying filters after mutation:', error);
          });
        }, 500);
      }
    });

    const observationRoot = document.querySelector<HTMLElement>(
      '.movie-list, .video-list, .videos, .movies, .list, .grid, .grid-list',
    ) || document.body;
    this.observer.observe(observationRoot, {
      childList: true,
      subtree: true,
      // 不监听属性变化，减少触发频率
      attributes: false,
      characterData: false,
    });
  }

  private takePendingItems(): HTMLElement[] {
    const items = Array.from(this.pendingItems);
    this.pendingItems.clear();
    return items;
  }

  private removeDetachedItems(root: HTMLElement): void {
    for (const element of this.filteredElements.keys()) {
      if (element === root || root.contains(element)) {
        this.filteredElements.delete(element);
      }
    }
    for (const item of this.pendingItems) {
      if (item === root || root.contains(item)) {
        this.pendingItems.delete(item);
      }
    }
  }

  /**
   * 强制重新扫描整个列表页：清除 data-filter-processed 标记后重跑过滤。
   * 用于开关类配置变更（如 hideEnabled），此时已处理卡片的动作需要重新裁定。
   */
  rescan(): void {
    if (!this.isInitialized) return;
    document
      .querySelectorAll<HTMLElement>('[data-filter-processed]')
      .forEach(item => item.removeAttribute('data-filter-processed'));
    void this.applyFilters().catch(error => {
      log('Error rescan filters:', error);
    });
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ContentFilterConfig>): void {
    const previous = this.config;
    this.config = { ...this.config, ...newConfig };

    if (this.isInitialized) {
      // 重新应用过滤规则
      this.clearAllFilters();
      // applyFilters 只处理未标记卡片；hideEnabled 变化或规则变化时需重扫已处理卡片
      if (
        newConfig.hideEnabled !== undefined &&
        newConfig.hideEnabled !== previous.hideEnabled
      ) {
        this.rescan();
      } else {
        void this.applyFilters().catch(error => {
          log('Error reapplying filters after config update:', error);
        });
      }
    }
  }

  /**
   * 更新关键字规则
   */
  updateKeywordRules(keywordRules: KeywordFilterRule[]): void {
    this.config.keywordRules = keywordRules;

    if (this.isInitialized) {
      // 重新应用过滤规则
      this.clearAllFilters();
      void this.applyFilters().catch(error => {
        log('Error reapplying filters after keyword update:', error);
      });
      log(`Updated ${keywordRules.length} keyword filter rules`);
    }
  }

  /**
   * 销毁过滤系统
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.filterDebounceTimer !== null) {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = null;
    }

    this.pendingItems.clear();
    this.clearAllFilters();
    this.isInitialized = false;
    this.isApplyingFilters = false;
    this.pendingRerun = false;
  }
}

// 导出默认实例
export const contentFilterManager = new ContentFilterManager();
