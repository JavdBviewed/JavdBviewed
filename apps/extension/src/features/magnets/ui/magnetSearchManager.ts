/**
 * @file magnetSearchManager.ts
 * @description magnetSearchManager
 * @module features/magnets
 */
// src/features/magnets/ui/magnetSearchManager.ts
// 磁力搜索功能

import { log } from '../../contentState';
import { showToast } from '../../../platform/browser/toast';
import { extractVideoIdFromPage } from '../../../platform/browser';
import { defaultHttpClient } from '../../../platform/network/httpClient';
import { handlePushToDrive115 } from '../../drive115/content';
import { performanceOptimizer } from '../../../platform/tasks';
import { dbMagnetsQuery, dbMagnetsUpsert } from '../../../platform/storage/dbRuntimeClient';
import { getOrFetchSessionResult } from '../../../platform/storage/sessionResultCache';
import {
  appendMagnetResults,
  getResultSources,
} from '../application/resultMerge';
import {
  buildMagnetPaginationState,
} from '../application/pagination';
import {
  buildMagnetSourceTagView,
  countUniqueResultsBySource,
  getMagnetSourceLabel,
} from '../application/sourceTagState';
import {
  describeMagnetSourceBackoff,
  filterMagnetSourcesByBackoff,
  recordMagnetSourceFailure,
  recordMagnetSourceSuccess,
  type MagnetSourceBackoffEntry,
  type MagnetSourceBackoffState,
} from '../application/sourceBackoff';
import {
  deduplicateMagnetResults,
  detectMagnetQuality,
  detectMagnetSubtitle,
  extractHashFromMagnet,
  isValidMagnetResultName,
  normalizeMagnetDate,
  parseSizeToBytes,
} from '../application/resultMetadata';
import { normalizeMagnetSortMode, sortMagnetResultsByMode } from '../application/resultSort';
import {
  buildJavbusAjaxUrl,
  extractJavbusAjaxParams,
  getJavbusResponseDiagnostics,
  parseJavbusFallbackMagnets,
  parseJavbusMagnetRows,
} from '../adapters/javbus/source';
import type {
  MagnetSourceKey,
  MagnetSourceSearchState,
  MagnetResult,
  MagnetSearchConfig,
  MagnetSourceRunState,
  MagnetExternalSearchResult,
} from '../domain/types';
import { fetchJavbusAjaxViaRuntime } from '../../../platform/browser/javbusRuntimeClient';
import { injectMagnetSourceTagStyles, injectUnifiedMagnetListStyles } from './magnetStyles';
import { renderMagnetPaginationControls } from './magnetPaginationControls';
import {
  filterMagnetResultsBySource,
  getMagnetSourceFilterOptions,
  renderMagnetSourceFilterBar,
} from './magnetSourceFilterControls';
import { decorateNativeMagnetRow } from './nativeMagnetRows';
import { createUnifiedMagnetItem } from './unifiedMagnetItem';
import { writeResourceTagIndexFromMagnetResults } from '../../listEnhancement';

// 磁链缓存 TTL（默认 7 天）
const MAGNET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface MagnetSearchRunOptions {
  manual?: boolean;
}

type MagnetSearchSource = { name: string; key: MagnetSourceKey; fn: () => Promise<MagnetResult[]> };

export type {
  MagnetExternalSearchResult,
  MagnetResult,
  MagnetSearchConfig,
  MagnetSourceRunState,
};

export class MagnetSearchManager {
  private config: MagnetSearchConfig;
  private isInitialized = false;
  private currentVideoId: string | null = null;
  private baseMagnetWidth = 0;
  private currentMagnetResults: MagnetResult[] = [];
  private currentMagnetDisplayResults: MagnetResult[] = [];
  private currentMagnetPage = 1;
  private currentMagnetSourceFilter = 'all';
  private nativeMagnetPage = 1;
  private searchRunId = 0;
  private sourceTagStates: Partial<Record<MagnetSourceKey, MagnetSourceSearchState>> = {};
  private sourceTagLatestResultCounts: Partial<Record<MagnetSourceKey, number>> = {};
  private sourceBackoffState: MagnetSourceBackoffState = {};

  constructor(config: Partial<MagnetSearchConfig> = {}) {
    const mergedConfig: MagnetSearchConfig = {
      enabled: true,
      showInlineResults: true,
      showFloatingButton: true,
      autoSearch: false,
      blockMojContent: true,
      sources: {
        sukebei: true,
        btdig: true,
        btsow: true,
        torrentz2: false,
        javbus: false,
        custom: [],
      },
      maxResults: 20,
      timeout: 15000, // 增加超时时间
      sortMode: 'default',
      ...config,
    };
    this.config = {
      ...mergedConfig,
      sortMode: normalizeMagnetSortMode(mergedConfig.sortMode),
    };
  }

  private clampMagnetContainerWidth(): void {
    try {
      const el = document.querySelector('#magnets-content') as HTMLElement | null;
      if (!el) return;
      if (!this.baseMagnetWidth || this.baseMagnetWidth < 600 || this.baseMagnetWidth > 2000) {
        this.baseMagnetWidth = el.clientWidth || 1344;
      }
      el.style.maxWidth = `${Math.round(this.baseMagnetWidth)}px`;
      el.style.width = '100%';
      el.style.marginLeft = 'auto';
      el.style.marginRight = 'auto';
      el.style.boxSizing = 'border-box';
    } catch {}
  }

  private debugOverflow(): void {
    try {
      const container = document.querySelector('#magnets-content') as HTMLElement | null;
      if (!container) return;
      const cw = container.clientWidth;
      const sw = container.scrollWidth;
      if (sw <= cw) return;
      let culprit: HTMLElement | null = null;
      let max = 0;
      container.querySelectorAll<HTMLElement>('*').forEach(el => {
        const w = el.scrollWidth;
        if (w > cw && w > max) {
          max = w;
          culprit = el;
        }
      });
      if (culprit) {
        try { (culprit as HTMLElement).style.outline = '2px solid #e74c3c'; } catch {}
        console.log('[Magnet Overflow] container', { clientWidth: cw, scrollWidth: sw, culprit, culpritWidth: max, style: getComputedStyle(culprit) });
      } else {
        console.log('[Magnet Overflow] container', { clientWidth: cw, scrollWidth: sw, note: 'no explicit culprit found' });
      }
    } catch {}
  }

  /**
   * 初始化磁力搜索功能
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled || this.isInitialized) {
      return;
    }

    try {
      log('Initializing magnet search functionality...');

      this.currentVideoId = extractVideoIdFromPage();

      if (!this.currentVideoId) {
        log('No video ID found, skipping magnet search initialization');
        return;
      }

      // 检查是否存在磁力列表区域
      const magnetContent = document.querySelector('#magnets-content');
      if (!magnetContent) {
        log('No magnet content area found, skipping magnet search initialization');
        return;
      }

      // 记录并钳制磁力容器的基线宽度，避免触发搜索后整体变宽
      try {
        const cw = (magnetContent as HTMLElement).clientWidth;
        if (cw && cw >= 600 && cw <= 2000) {
          this.baseMagnetWidth = cw;
        }
        this.clampMagnetContainerWidth();
      } catch {}

      // 注入统一样式，确保磁力列表布局不会溢出
      injectUnifiedMagnetListStyles();

      // 添加搜索源标签
      this.addSearchSourceTags();

      // 屏蔽磁力区域广告
      if (this.config.blockMojContent) {
        document.querySelectorAll<HTMLElement>('.moj-content').forEach(el => {
          el.classList.add('jdb-hidden-moj-content');
          el.style.display = 'none';
        });
      }

      this.applyNativeMagnetPresentation();

      // 检查影片是否已看
      const isViewed = await this.checkIfVideoViewed();

      if (!this.config.autoSearch) {
        // 自动加载关闭：始终显示手动按钮
        this.showManualSearchButton(false);
      } else if (isViewed) {
        // 自动加载开启但已看：显示手动按钮
        log('Video is viewed, showing manual search button instead of auto-search');
        this.showManualSearchButton(true);
      } else {
        // 自动加载开启且未看：自动搜索
        setTimeout(() => {
          this.searchMagnets(this.currentVideoId!);
        }, 2000);
      }

      this.isInitialized = true;
      log('Magnet search functionality initialized');
    } catch (error) {
      log('Error initializing magnet search:', error);
    }
  }

  /**
   * 搜索磁力链接
   */
  async searchMagnets(videoId: string, options: MagnetSearchRunOptions = {}): Promise<void> {
    try {
      const runId = ++this.searchRunId;
      log(`Searching magnets for: ${videoId}`);

      // 收集所有磁力数据（包括JavDB原生 + 搜索结果）
      const allMagnetResults: MagnetResult[] = [];
      let discoveredCount = 0;

      const appendAndCountResults = (results: MagnetResult[]): number => {
        discoveredCount += results.length;
        return appendMagnetResults(allMagnetResults, results);
      };

      // 优先尝试从缓存加载并快速展示
      try {
        const cached = await this.loadCachedMagnets(videoId);
        if (cached.length > 0) {
          log(`Loaded ${cached.length} magnets from cache for ${videoId}`);
          appendAndCountResults(cached);
          this.processAndDisplayAllMagnets(allMagnetResults, { notify: false, discoveredCount });
        }
      } catch (e) {
        log('Load cached magnets failed:', e);
      }

      // 1. 首先收集JavDB原生磁力数据
      const javdbMagnets = this.collectJavdbMagnets();
      appendAndCountResults(javdbMagnets);
      log(`Collected ${javdbMagnets.length} JavDB native magnets`);

      // 提前渲染：JavDB 原生磁力加入缓存结果后立即参与排序显示
      if (javdbMagnets.length > 0) {
        this.processAndDisplayAllMagnets(allMagnetResults, { notify: false, discoveredCount });
      }

      // 2. 搜索外部源
      const allSearchSources = this.buildExternalSearchSources(videoId);
      const { runnable: searchSources, skipped } = this.filterSourcesByBackoff(allSearchSources, options);
      skipped.forEach(({ source, entry }) => {
        log(`${source.name} search skipped by backoff:`, describeMagnetSourceBackoff(entry));
        this.setSourceTagState(source.key, 'failed', allMagnetResults);
      });

      log(`Starting search on ${searchSources.length} sources: ${searchSources.map(s => s.name).join(', ')}`);

      // 4. 如果没有外部搜索源，直接显示JavDB结果
      if (allSearchSources.length === 0) {
        log('No external sources configured, displaying JavDB results only');
        this.processAndDisplayAllMagnets(allMagnetResults);
        this.writeResourceTagEvidence(videoId, allMagnetResults);
        return;
      }

      if (searchSources.length === 0) {
        log('All external sources are temporarily in backoff, displaying local results only');
        this.processAndDisplayAllMagnets(allMagnetResults, { discoveredCount });
        this.writeResourceTagEvidence(videoId, allMagnetResults);
        return;
      }

      // 5. 使用性能优化器限制并发搜索，避免同时发起过多网络请求
      const searchPromises = searchSources.map(source => {
        // 设置搜索中状态
        this.setSourceTagState(source.key, 'searching', allMagnetResults);

        // 使用性能优化器调度网络请求，自动限制并发数量
        return performanceOptimizer.scheduleRequest(async () => {
          return source.fn();
        }, 9000) // 适度延长，给外部源更多完成机会
        .then(sourceResults => {
          if (runId !== this.searchRunId) return sourceResults;
          log(`${source.name} search completed: ${sourceResults.length} results`);
          recordMagnetSourceSuccess(this.sourceBackoffState, source.key);
          if (sourceResults.length > 0) {
            appendAndCountResults(sourceResults);
            log(`Merged ${source.name} results, total collected: ${allMagnetResults.length}`);
            this.processAndDisplayAllMagnets(allMagnetResults, { notify: false, discoveredCount });
            this.upsertMagnetsToCache(videoId, sourceResults).catch(err => log(`${source.name} cache upsert failed:`, err));
          }
          this.setSourceTagState(source.key, 'success', allMagnetResults, sourceResults.length);
          return sourceResults;
        }).catch(error => {
          if (runId !== this.searchRunId) return [];
          log(`${source.name} search failed:`, error);
          recordMagnetSourceFailure(this.sourceBackoffState, source.key, error);
          this.setSourceTagState(source.key, 'failed', allMagnetResults);
          return []; // 返回空数组而不是抛出错误
        });
      });

      // 6. 等待所有搜索完成（包括超时的）
      Promise.all(searchPromises).then(() => {
        if (runId !== this.searchRunId) return;
        log(`All searches completed, total results: ${allMagnetResults.length}`);

        // 最终刷新一次总列表，并给出完成提示
        this.processAndDisplayAllMagnets(allMagnetResults, { discoveredCount });

        // 异步写入缓存（带 TTL）
        this.upsertMagnetsToCache(videoId, allMagnetResults).catch(err => log('Upsert magnets cache failed:', err));
        this.writeResourceTagEvidence(videoId, allMagnetResults);
      }).catch(error => {
        if (runId !== this.searchRunId) return;
        // 这个catch理论上不会被触发，因为我们已经在每个promise中处理了错误
        log('Unexpected error in Promise.all:', error);
        this.processAndDisplayAllMagnets(allMagnetResults, { discoveredCount });
        this.upsertMagnetsToCache(videoId, allMagnetResults).catch(err => log('Upsert magnets cache failed:', err));
        this.writeResourceTagEvidence(videoId, allMagnetResults);
      });
    } catch (error) {
      log('Error searching magnets:', error);
      showToast('搜索磁力链接时发生错误', 'error');
    }
  }

  /**
   * 搜索外部磁力源，只返回结果，不读取或写入详情页 DOM。
   */
  async searchExternalSources(videoId: string, options: MagnetSearchRunOptions = {}): Promise<MagnetExternalSearchResult> {
    const force = options.manual === true;
    const sourcesKey = Object.entries(this.config.sources || {})
      .filter(([, enabled]) => !!enabled)
      .map(([k]) => k)
      .sort()
      .join(',');
    const cacheIdentity = `${String(videoId || '').trim()}|${sourcesKey || 'none'}`;

    const { data, fromCache } = await getOrFetchSessionResult(
      'magnetsExternal',
      cacheIdentity,
      () => this.searchExternalSourcesNetwork(videoId, options),
      { force },
    );
    if (fromCache) {
      log(`[Magnets] external cache-hit videoId=${videoId}`);
    }
    return data;
  }

  private async searchExternalSourcesNetwork(
    videoId: string,
    options: MagnetSearchRunOptions = {},
  ): Promise<MagnetExternalSearchResult> {
    const allResults: MagnetResult[] = [];
    const sourceStates: Partial<Record<MagnetSourceKey, MagnetSourceRunState>> = {};
    const allSearchSources = this.buildExternalSearchSources(videoId);
    const { runnable: searchSources, skipped } = this.filterSourcesByBackoff(allSearchSources, options);

    this.currentVideoId = videoId;

    skipped.forEach(({ source, entry }) => {
      sourceStates[source.key] = {
        status: 'failed',
        resultCount: 0,
        error: describeMagnetSourceBackoff(entry),
      };
    });

    if (allSearchSources.length === 0 || searchSources.length === 0) {
      return {
        discoveredCount: 0,
        duplicateCount: 0,
        uniqueResults: [],
        sourceStates,
      };
    }

    const searchPromises = searchSources.map(async (source) => {
      sourceStates[source.key] = { status: 'searching' };
      try {
        const sourceResults = await performanceOptimizer.scheduleRequest(() => source.fn(), 9000);
        appendMagnetResults(allResults, sourceResults);
        recordMagnetSourceSuccess(this.sourceBackoffState, source.key);
        sourceStates[source.key] = { status: 'success', resultCount: sourceResults.length };
        return sourceResults;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`${source.name} external search failed:`, error);
        recordMagnetSourceFailure(this.sourceBackoffState, source.key, error);
        sourceStates[source.key] = { status: 'failed', resultCount: 0, error: message };
        return [];
      }
    });

    const sourceResults = await Promise.all(searchPromises);
    const discoveredCount = sourceResults.reduce((total, results) => total + results.length, 0);
    const uniqueResults = sortMagnetResultsByMode(
      deduplicateMagnetResults(allResults),
      this.config.sortMode,
    );

    return {
      discoveredCount,
      duplicateCount: Math.max(0, discoveredCount - uniqueResults.length),
      uniqueResults,
      sourceStates,
    };
  }

  private buildExternalSearchSources(videoId: string): MagnetSearchSource[] {
    const searchSources: MagnetSearchSource[] = [];

    if (this.config.sources.sukebei) {
      searchSources.push({ name: 'Sukebei', key: 'sukebei', fn: () => this.searchSukebei(videoId) });
    }

    if (this.config.sources.btdig) {
      searchSources.push({ name: 'BTdig', key: 'btdig', fn: () => this.searchBtdig(videoId) });
    }

    if (this.config.sources.btsow) {
      searchSources.push({ name: 'BTSOW', key: 'btsow', fn: () => this.searchBtsow(videoId) });
    }

    if (this.config.sources.torrentz2) {
      searchSources.push({ name: 'Torrentz2', key: 'torrentz2', fn: () => this.searchTorrentz2(videoId) });
    }

    if (this.config.sources.javbus) {
      searchSources.push({ name: 'JAVBUS', key: 'javbus', fn: () => this.searchJavbus(videoId) });
    }

    return searchSources;
  }

  private filterSourcesByBackoff(
    sources: MagnetSearchSource[],
    options: MagnetSearchRunOptions,
  ): { runnable: MagnetSearchSource[]; skipped: Array<{ source: MagnetSearchSource; entry: MagnetSourceBackoffEntry }> } {
    return filterMagnetSourcesByBackoff(sources, this.sourceBackoffState, options);
  }

  /**
   * 搜索Sukebei
   */
  private async searchSukebei(videoId: string): Promise<MagnetResult[]> {
    try {
      log(`Starting Sukebei search for: ${videoId}`);
      const searchUrl = `https://sukebei.nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(videoId)}`;
      log(`Sukebei search URL: ${searchUrl}`);

      const response = await defaultHttpClient.getDocument(searchUrl, {
        timeout: this.config.timeout,
      });

      const results = this.parseSukebeiResults(response);
      log(`Sukebei search returned ${results.length} results`);
      return results;
    } catch (error) {
      log('Sukebei search failed:', error);
      throw error;
    }
  }

  /**
   * 搜索BTdig
   */
  private async searchBtdig(videoId: string): Promise<MagnetResult[]> {
    try {
      const searchUrl = `https://btdig.com/search?order=0&q=${encodeURIComponent(videoId)}`;
      const response = await defaultHttpClient.getDocument(searchUrl, {
        timeout: this.config.timeout,
        retries: 2,
      });

      return this.parseBtdigResults(response);
    } catch (error) {
      log('BTdig search failed:', error);
      throw error;
    }
  }

  /**
   * 搜索BTSOW
   */
  private async searchBtsow(videoId: string): Promise<MagnetResult[]> {
    try {
      const searchUrl = `https://btsow.com/search/${encodeURIComponent(videoId)}`;
      const response = await defaultHttpClient.getDocument(searchUrl, {
        timeout: this.config.timeout,
        retries: 2,
      });

      return this.parseBtsowResults(response);
    } catch (error) {
      log('BTSOW search failed:', error);
      throw error;
    }
  }

  /**
   * 搜索Torrentz2
   */
  private async searchTorrentz2(videoId: string): Promise<MagnetResult[]> {
    try {
      const searchUrl = `https://torrentz2.eu/search?f=${encodeURIComponent(videoId)}`;
      const response = await defaultHttpClient.getDocument(searchUrl, {
        timeout: this.config.timeout,
      });

      return this.parseTorrentz2Results(response);
    } catch (error) {
      log('Torrentz2 search failed:', error);
      throw error;
    }
  }

  /**
   * 搜索JAVBUS
   */
  private async searchJavbus(videoId: string): Promise<MagnetResult[]> {
    try {
      const pageUrl = `https://www.javbus.com/${encodeURIComponent(videoId)}`;
      const javbusHeaders = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://www.javbus.com/',
        Cookie: 'agegate=1; over18=1; existmag=all',
      };
      const pageHtml = await defaultHttpClient.get<string>(pageUrl, {
        timeout: this.config.timeout,
        retries: 1,
        responseType: 'text',
        headers: javbusHeaders,
      });
      log(`[JAVBUS] Detail page loaded for ${videoId}: ${pageHtml.length} chars`);

      const ajaxParams = extractJavbusAjaxParams(pageHtml);
      if (!ajaxParams) {
        const fallbackResults = parseJavbusFallbackMagnets(pageHtml, videoId);
        log(`[JAVBUS] Ajax params not found for ${videoId}, fallback parsed ${fallbackResults.length} results`);
        return fallbackResults;
      }
      log(`[JAVBUS] Ajax params found for ${videoId}:`, { gid: ajaxParams.gid, uc: ajaxParams.uc, hasImg: !!ajaxParams.img });

      const ajaxUrl = buildJavbusAjaxUrl(ajaxParams);
      const ajaxHtml = await defaultHttpClient.get<string>(ajaxUrl, {
        timeout: this.config.timeout,
        retries: 1,
        responseType: 'text',
        referrer: pageUrl,
        headers: {
          ...javbusHeaders,
          Referer: pageUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      log(`[JAVBUS] Ajax response loaded for ${videoId}: ${ajaxHtml.length} chars`);

      const results = parseJavbusMagnetRows(ajaxHtml, videoId);
      if (results.length > 0) {
        log(`[JAVBUS] Ajax parsed ${results.length} results for ${videoId}`);
        return results;
      }
      log(`[JAVBUS] Ajax parsed 0 diagnostics for ${videoId}:`, getJavbusResponseDiagnostics(ajaxHtml));

      try {
        log(`[JAVBUS] Ajax empty for ${videoId}, retrying in JAVBUS tab context`);
        const tabAjaxHtml = await fetchJavbusAjaxViaRuntime(pageUrl, this.config.timeout);
        log(`[JAVBUS] Tab ajax response loaded for ${videoId}: ${tabAjaxHtml.length} chars`);
        const tabResults = parseJavbusMagnetRows(tabAjaxHtml, videoId);
        if (tabResults.length > 0) {
          log(`[JAVBUS] Tab ajax parsed ${tabResults.length} results for ${videoId}`);
          return tabResults;
        }
        log(`[JAVBUS] Tab ajax parsed 0 diagnostics for ${videoId}:`, getJavbusResponseDiagnostics(tabAjaxHtml));
      } catch (tabError) {
        log(`[JAVBUS] Tab ajax retry failed for ${videoId}:`, tabError);
      }

      const fallbackResults = parseJavbusFallbackMagnets(pageHtml, videoId);
      log(`[JAVBUS] Ajax parsed 0 results for ${videoId}, fallback parsed ${fallbackResults.length} results`);
      return fallbackResults;
    } catch (error) {
      log('JAVBUS search failed:', error);
      throw error;
    }
  }

  /**
   * 解析Sukebei结果
   */
  private parseSukebeiResults(doc: Document): MagnetResult[] {
    const results: MagnetResult[] = [];

    try {
      log('Parsing Sukebei results...');
      const rows = doc.querySelectorAll('tbody tr');
      log(`Found ${rows.length} rows in Sukebei response`);

      rows.forEach((row, index) => {
        const nameElement = row.querySelector('td:nth-child(2) a[title]');
        const magnetElement = row.querySelector('a[href^="magnet:"]');
        const sizeElement = row.querySelector('td:nth-child(4)');
        const dateElement = row.querySelector('td:nth-child(5)');
        const seedersElement = row.querySelector('td:nth-child(6)');
        const leechersElement = row.querySelector('td:nth-child(7)');

        if (nameElement && magnetElement) {
          const name = (nameElement.getAttribute('title') || nameElement.textContent?.trim() || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
          const magnet = (magnetElement as HTMLAnchorElement).href.split('&')[0]; // 清理磁力链接
          const size = sizeElement?.textContent?.trim() || '';
          const date = dateElement?.textContent?.trim().split(' ')[0] || '';
          const seeders = parseInt(seedersElement?.textContent?.trim() || '0', 10);
          const leechers = parseInt(leechersElement?.textContent?.trim() || '0', 10);

          log(`Sukebei row ${index + 1}: ${name.substring(0, 50)}... (${size})`);

          // 使用改进的匹配逻辑
          const isValid = this.isValidResult(name, this.currentVideoId || '');
          log(`Sukebei row ${index + 1} valid: ${isValid}`);

          if (isValid) {
            results.push({
              name,
              magnet,
              size,
              sizeBytes: parseSizeToBytes(size),
              date: normalizeMagnetDate(date, 'Sukebei'),
              seeders,
              leechers,
              source: 'Sukebei',
              hasSubtitle: detectMagnetSubtitle(name),
              quality: detectMagnetQuality(name),
            });
          }
        } else {
          log(`Sukebei row ${index + 1}: Missing name or magnet element`);
        }
      });
    } catch (error) {
      log('Error parsing Sukebei results:', error);
    }

    return results;
  }

  /**
   * 解析BTdig结果
   */
  private parseBtdigResults(doc: Document): MagnetResult[] {
    const results: MagnetResult[] = [];

    try {
      const items = doc.querySelectorAll('.one_result');

      items.forEach(item => {
        const nameElement = item.querySelector('.torrent_name a');
        const magnetElement = item.querySelector('.torrent_magnet a');
        const sizeElement = item.querySelector('.torrent_size');
        const dateElement = item.querySelector('.torrent_age');

        if (nameElement && magnetElement) {
          const name = (nameElement.textContent?.trim() || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
          const magnet = (magnetElement as HTMLAnchorElement).href;
          const size = sizeElement?.textContent?.trim() || '';
          const date = dateElement?.textContent?.trim() || '';

          // 使用改进的匹配逻辑
          if (this.isValidResult(name, this.currentVideoId || '')) {
            results.push({
              name,
              magnet,
              size,
              sizeBytes: parseSizeToBytes(size),
              date: normalizeMagnetDate(date, 'BTdig'),
              source: 'BTdig',
              hasSubtitle: detectMagnetSubtitle(name),
              quality: detectMagnetQuality(name),
            });
          }
        }
      });
    } catch (error) {
      log('Error parsing BTdig results:', error);
    }

    return results;
  }

  /**
   * 解析BTSOW结果
   */
  private parseBtsowResults(doc: Document): MagnetResult[] {
    const results: MagnetResult[] = [];

    try {
      const items = doc.querySelectorAll('.data-list .row:not(.hidden-xs)');

      items.forEach(item => {
        const nameElement = item.querySelector('.file');
        const linkElement = item.querySelector('a');
        const sizeElement = item.querySelector('.size');
        const dateElement = item.querySelector('.date');

        if (nameElement && linkElement) {
          const name = (nameElement.textContent?.trim() || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
          const href = linkElement.getAttribute('href') || '';
          const size = sizeElement?.textContent?.trim() || '';
          const date = dateElement?.textContent?.trim() || '';

          // 从href提取hash构造磁力链接
          const hash = href.split('/').pop();
          const magnet = hash ? `magnet:?xt=urn:btih:${hash}` : '';

          // 使用改进的匹配逻辑
          if (magnet && this.isValidResult(name, this.currentVideoId || '')) {
            results.push({
              name,
              magnet,
              size,
              sizeBytes: parseSizeToBytes(size),
              date: normalizeMagnetDate(date, 'BTSOW'),
              source: 'BTSOW',
              hasSubtitle: detectMagnetSubtitle(name),
              quality: detectMagnetQuality(name),
            });
          }
        }
      });
    } catch (error) {
      log('Error parsing BTSOW results:', error);
    }

    return results;
  }

  /**
   * 解析Torrentz2结果
   */
  private parseTorrentz2Results(doc: Document): MagnetResult[] {
    const results: MagnetResult[] = [];

    try {
      const rows = doc.querySelectorAll('.results dl');

      rows.forEach(row => {
        const nameElement = row.querySelector('dt a');
        const infoElement = row.querySelector('dd');

        if (nameElement && infoElement) {
          const name = (nameElement.textContent?.trim() || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
          const href = (nameElement as HTMLAnchorElement).href;
          const infoText = infoElement.textContent?.trim() || '';

          // 从info中提取大小和日期
          const sizeMatch = infoText.match(/Size: ([^,]+)/);
          const dateMatch = infoText.match(/Age: ([^,]+)/);

          const size = sizeMatch ? sizeMatch[1] : '';
          const date = dateMatch ? dateMatch[1] : '';

          // 构造磁力链接
          const hash = href.split('/').pop();
          const magnet = hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}` : '';

          // 使用改进的匹配逻辑
          if (magnet && this.isValidResult(name, this.currentVideoId || '')) {
            results.push({
              name,
              magnet,
              size,
              sizeBytes: parseSizeToBytes(size),
              date,
              source: 'Torrentz2',
              hasSubtitle: detectMagnetSubtitle(name),
              quality: detectMagnetQuality(name),
            });
          }
        }
      });
    } catch (error) {
      log('Error parsing Torrentz2 results:', error);
    }

    return results;
  }

  /**
   * 收集JavDB原生磁力数据
   */
  private collectJavdbMagnets(): MagnetResult[] {
    const results: MagnetResult[] = [];

    try {
      const magnetContent = document.querySelector('#magnets-content');
      if (!magnetContent) {
        log('No magnet content area found');
        return results;
      }

      const magnetItems = magnetContent.querySelectorAll('.item.columns');
      log(`Found ${magnetItems.length} JavDB native magnet items`);

      magnetItems.forEach((item, index) => {
        try {
          const nameElement = item.querySelector('.magnet-name .name');
          const magnetLink = item.querySelector('a[href^="magnet:"]');
          const metaElement = item.querySelector('.meta');
          const dateElement = item.querySelector('.date .time');
          const tagsElements = item.querySelectorAll('.tags .tag');

          if (nameElement && magnetLink) {
            const name = nameElement.textContent?.trim() || '';
            const magnet = (magnetLink as HTMLAnchorElement).href;
            const meta = metaElement?.textContent?.trim() || '';
            const date = dateElement?.textContent?.trim() || '';

            // 解析文件大小
            const sizeMatch = meta.match(/([0-9.]+)\s*(GB|MB|KB|TB)/i);
            const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : '';

            // 检查标签
            let hasSubtitle = false;
            let quality = '';

            tagsElements.forEach(tag => {
              const tagText = tag.textContent?.trim() || '';
              if (tagText.includes('字幕') || tagText.includes('subtitle')) {
                hasSubtitle = true;
              }
              if (tagText.includes('高清') || tagText.includes('HD')) {
                quality = 'HD';
              }
              if (tagText.includes('1080P') || tagText.includes('1080p')) {
                quality = '1080P';
              }
              if (tagText.includes('720P') || tagText.includes('720p')) {
                quality = '720P';
              }
              if (tagText.includes('4K')) {
                quality = '4K';
              }
            });

            results.push({
              name,
              magnet,
              size,
              sizeBytes: parseSizeToBytes(size),
              date: normalizeMagnetDate(date, 'JavDB'),
              seeders: 0, // JavDB不提供种子数
              leechers: 0,
              source: 'JavDB',
              hasSubtitle,
              quality,
            });

            log(`Collected JavDB magnet ${index + 1}: ${name.substring(0, 50)}...`);
          }
        } catch (error) {
          log(`Error collecting JavDB magnet ${index + 1}:`, error);
        }
      });

      log(`Successfully collected ${results.length} JavDB native magnets`);
    } catch (error) {
      log('Error collecting JavDB magnets:', error);
    }

    return results;
  }

  /**
   * 统一处理和显示所有磁力数据
   */
  private processAndDisplayAllMagnets(allResults: MagnetResult[], options: { notify?: boolean; discoveredCount?: number } = {}): void {
    try {
      const notify = options.notify !== false;
      const discoveredCount = Math.max(options.discoveredCount ?? allResults.length, allResults.length);
      log(`Processing ${discoveredCount} discovered magnet results`);

      // 显示来源统计
      const sourceStats: Record<string, number> = {};
      allResults.forEach(result => {
        getResultSources(result).forEach((source) => {
          sourceStats[source] = (sourceStats[source] || 0) + 1;
        });
      });
      log('Source statistics:', sourceStats);

      // 去重和排序
      const uniqueResults = deduplicateMagnetResults(allResults);
      const sortedResults = sortMagnetResultsByMode(uniqueResults, this.config.sortMode);
      const displayLimit = sortedResults.length > 30 ? sortedResults.length : this.config.maxResults;
      const limitedResults = sortedResults.slice(0, displayLimit);
      const duplicateCount = Math.max(0, discoveredCount - uniqueResults.length);

      log(`After processing: ${discoveredCount} discovered, ${uniqueResults.length} unique, ${duplicateCount} deduplicated, displaying ${limitedResults.length}`);

      // 清空现有磁力列表
      this.clearMagnetList();

      // 重新显示所有磁力数据
      this.currentMagnetResults = limitedResults;
      this.currentMagnetSourceFilter = 'all';
      this.currentMagnetDisplayResults = filterMagnetResultsBySource(limitedResults, this.currentMagnetSourceFilter);
      this.currentMagnetPage = 1;
      this.displayAllMagnets(this.currentMagnetDisplayResults);

      // 更新总数显示
      this.updateTotalCount(this.currentMagnetDisplayResults.length);

      // 渲染后再次钳制容器宽度，防止新增节点导致回流拉宽
      this.clampMagnetContainerWidth();

      // 检测并标记横向溢出来源
      this.debugOverflow();

      if (notify) {
        showToast(`磁力搜索完成：发现 ${discoveredCount} 条，去重 ${duplicateCount} 条，显示 ${limitedResults.length} 条`, 'success');
      }
      log(`Successfully displayed ${limitedResults.length} total magnet results`);
    } catch (error) {
      log('Error processing all magnets:', error);
      showToast('处理磁力数据时发生错误', 'error');
    }
  }

  /**
   * 清空磁力列表（同步，供内部使用）
   */
  private clearMagnetList(): void {
    const magnetContent = document.querySelector('#magnets-content');
    if (magnetContent) {
      magnetContent.innerHTML = '';
      log('Cleared existing magnet list');
    }
  }

  /**
   * 显示所有磁力数据（统一样式）- 清空与追加在同一个 DOM 批次中执行，避免乱序
   */
  private displayAllMagnets(results: MagnetResult[], scrollToTop = false): void {
    this.currentMagnetDisplayResults = results;
    const pagination = buildMagnetPaginationState(results.length, this.currentMagnetPage);
    this.currentMagnetPage = pagination.currentPage;
    const pageResults = results.slice(pagination.startIndex, pagination.endIndex);

    // 先同步构建 DocumentFragment，不触及真实 DOM
    const fragment = document.createDocumentFragment();
    pageResults.forEach((result, index) => {
      try {
        const magnetItem = createUnifiedMagnetItem(result, pagination.startIndex + index, {
          copyMagnet: (magnet) => this.copyMagnet(magnet),
          push115: (button, magnet, name) => this.push115(button, magnet, name),
        });
        fragment.appendChild(magnetItem);
        log(`Added unified magnet item ${index + 1}: ${result.name.substring(0, 50)}...`);
      } catch (error) {
        log(`Error creating unified magnet item ${index + 1}:`, error);
      }
    });

    // 清空 + 追加在同一个调度批次内，保证原子性
    performanceOptimizer.scheduleDOMOperation(() => {
      const magnetContent = document.querySelector('#magnets-content');
      if (!magnetContent) {
        log('Magnet content area not found');
        return;
      }
      magnetContent.innerHTML = '';
      log('Cleared existing magnet list');
      if (this.currentMagnetResults.length > 0) {
        const filterOptions = getMagnetSourceFilterOptions(this.currentMagnetResults);
        const activeExists = filterOptions.some(option => option.key === this.currentMagnetSourceFilter);
        if (!activeExists) this.currentMagnetSourceFilter = 'all';
        renderMagnetSourceFilterBar(
          magnetContent,
          filterOptions,
          this.currentMagnetSourceFilter,
          (filter) => {
            this.currentMagnetSourceFilter = filter;
            this.currentMagnetPage = 1;
            const filtered = filterMagnetResultsBySource(this.currentMagnetResults, this.currentMagnetSourceFilter);
            this.displayAllMagnets(filtered, true);
            this.updateTotalCount(filtered.length);
          },
        );
      }
      magnetContent.appendChild(fragment);
      renderMagnetPaginationControls(magnetContent, pagination, results.length, page => this.goToMagnetPage(page));
      if (scrollToTop && magnetContent instanceof HTMLElement) {
        magnetContent.scrollTo({ top: 0, behavior: 'smooth' });
      }
      log(`Successfully displayed ${pageResults.length} unified magnet items`);
    });
  }

  private goToMagnetPage(page: number): void {
    if (this.currentMagnetDisplayResults.length === 0) return;
    this.currentMagnetPage = page;
    this.displayAllMagnets(this.currentMagnetDisplayResults, true);
    this.updateTotalCount(this.currentMagnetDisplayResults.length);
  }

  private addUnifiedMagnetStyles(): void {
    injectUnifiedMagnetListStyles();
  }

  private addSearchTagStyles(): void {
    injectMagnetSourceTagStyles();
  }

  private createUnifiedMagnetItem(result: MagnetResult, index: number): HTMLElement {
    return createUnifiedMagnetItem(result, index, {
      copyMagnet: (magnet) => this.copyMagnet(magnet),
      push115: (button, magnet, name) => this.push115(button, magnet, name),
    });
  }

  private applyNativeMagnetPresentation(page = this.nativeMagnetPage): void {
    const container = document.querySelector('#magnets-content');
    if (!container) return;

    const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope > .item.columns.is-desktop'));
    if (rows.length === 0) return;

    injectUnifiedMagnetListStyles();
    container.querySelector('.jdb-native-magnet-pagination')?.remove();

    const pagination = buildMagnetPaginationState(rows.length, page);
    this.nativeMagnetPage = pagination.currentPage;

    rows.forEach((row, index) => {
      decorateNativeMagnetRow(row);
      const isVisible = index >= pagination.startIndex && index < pagination.endIndex;
      row.classList.toggle('jdb-magnet-page-hidden', !isVisible);
      row.style.display = '';
    });

    renderMagnetPaginationControls(
      container,
      pagination,
      rows.length,
      pageNumber => this.applyNativeMagnetPresentation(pageNumber),
      'jdb-magnet-pagination jdb-native-magnet-pagination',
    );
  }

  private async checkIfVideoViewed(): Promise<boolean> {
    try {
      const { STATE } = await import('../../contentState');
      const videoId = this.currentVideoId;
      if (!videoId) return false;
      
      const record = STATE.records[videoId];
      const { VIDEO_STATUS } = await import('../../../utils/config');
      
      return record?.status === VIDEO_STATUS.VIEWED;
    } catch (error) {
      log('Error checking video viewed status:', error);
      return false;
    }
  }

  /**
   * 显示手动搜索按钮
   */
  private showManualSearchButton(isViewed = false): void {
    try {
      const topMeta = document.querySelector('.top-meta');
      if (!topMeta) return;

      // 检查是否已经添加过按钮
      if (document.getElementById('manual-magnet-search-btn')) return;

      // 创建按钮容器
      const buttonContainer = document.createElement('div');
      injectUnifiedMagnetListStyles();
      buttonContainer.className = 'jdb-magnet-manual-search';

      // 创建搜索按钮
      const searchButton = document.createElement('button');
      searchButton.id = 'manual-magnet-search-btn';
      searchButton.className = 'button is-info is-small jdb-magnet-manual-button';
      searchButton.innerHTML = '🧲 加载磁力资源';

      searchButton.addEventListener('click', async () => {
        searchButton.disabled = true;
        searchButton.innerHTML = '🔄 搜索中...';

        try {
          await this.searchMagnets(this.currentVideoId!, { manual: true });
          // 搜索完成后移除按钮
          buttonContainer.remove();
        } catch (error) {
          searchButton.disabled = false;
          searchButton.innerHTML = '🧲 加载磁力资源';
          showToast('搜索失败，请重试', 'error');
        }
      });

      // 创建提示文本
      const hintText = document.createElement('span');
      hintText.className = 'has-text-grey is-size-7 jdb-magnet-manual-hint';
      hintText.textContent = isViewed ? '（影片已看，点击按钮加载磁力资源）' : '（点击按钮加载磁力资源）';

      buttonContainer.appendChild(searchButton);
      buttonContainer.appendChild(hintText);

      // 插入到磁力内容区域之前
      const magnetContent = document.querySelector('#magnets-content');
      if (magnetContent && magnetContent.parentElement) {
        magnetContent.parentElement.insertBefore(buttonContainer, magnetContent);
      } else {
        topMeta.appendChild(buttonContainer);
      }

      log('Manual search button added for viewed video');
    } catch (error) {
      log('Error showing manual search button:', error);
    }
  }

  /**
   * 添加搜索源标签到标题区域
   */
  private addSearchSourceTags(): void {
    const topMeta = document.querySelector('.top-meta');
    if (!topMeta) return;
    topMeta.classList.add('jdb-magnet-meta-bar');

    // 添加动画样式
    injectMagnetSourceTagStyles();

    // 确保有tags容器
    let tagsContainer = topMeta.querySelector('.tags');
    if (!tagsContainer) {
      tagsContainer = document.createElement('div');
      tagsContainer.className = 'tags';
      topMeta.insertBefore(tagsContainer, topMeta.firstChild);
    }
    tagsContainer.classList.add('jdb-magnet-source-tags');

    // 为每个启用的搜索源添加标签
    const sources: Array<{ key: MagnetSourceKey; enabled: boolean }> = [
      { key: 'sukebei', enabled: this.config.sources.sukebei },
      { key: 'btdig', enabled: this.config.sources.btdig },
      { key: 'btsow', enabled: this.config.sources.btsow },
      { key: 'torrentz2', enabled: this.config.sources.torrentz2 },
      { key: 'javbus', enabled: this.config.sources.javbus }
    ];

    sources.forEach(source => {
      if (!source.enabled) return;
      this.sourceTagStates[source.key] = this.sourceTagStates[source.key] || 'idle';

      // 检查是否已经添加过标签
      if (tagsContainer!.querySelector(`#magnet-${source.key}-tag`)) return;

      const tag = document.createElement('span');
      tag.id = `magnet-${source.key}-tag`;
      tag.className = 'tag is-light magnet-search-tag';
      tag.textContent = `${getMagnetSourceLabel(source.key)}搜索`;
      tagsContainer!.appendChild(tag);
    });
  }

  /**
   * 更新搜索源标签状态
   */
  private setSourceTagState(
    sourceKey: MagnetSourceKey,
    status: MagnetSourceSearchState,
    currentResults: MagnetResult[],
    latestResultCount?: number,
  ): void {
    this.sourceTagStates[sourceKey] = status;
    if (typeof latestResultCount === 'number') {
      this.sourceTagLatestResultCounts[sourceKey] = latestResultCount;
    }
    if (status === 'searching' || status === 'failed') {
      delete this.sourceTagLatestResultCounts[sourceKey];
    }
    this.refreshSourceTagStatuses(currentResults);
  }

  private refreshSourceTagStatuses(currentResults: MagnetResult[]): void {
    const counts = countUniqueResultsBySource(currentResults);
    (Object.keys(this.sourceTagStates) as MagnetSourceKey[]).forEach(sourceKey => {
      this.updateSourceTagStatus(
        sourceKey,
        this.sourceTagStates[sourceKey] || 'idle',
        counts[sourceKey] || 0,
        this.sourceTagLatestResultCounts[sourceKey],
      );
    });
  }

  private updateSourceTagStatus(
    sourceKey: MagnetSourceKey,
    status: MagnetSourceSearchState,
    currentUniqueCount: number,
    latestResultCount?: number,
  ): void {
    const tag = document.querySelector(`#magnet-${sourceKey}-tag`) as HTMLElement;
    if (!tag) return;

    const view = buildMagnetSourceTagView(sourceKey, status, currentUniqueCount, latestResultCount);

    // 清除所有状态类
    tag.classList.remove('is-light', 'is-success', 'is-danger', 'is-warning', 'is-loading');
    tag.classList.add(view.className);
    tag.textContent = view.text;
    tag.title = view.title;
    tag.style.animation = status === 'searching' ? 'pulse 1.5s infinite' : '';
  }

  /**
   * 添加搜索标签样式
   */
  private updateTotalCount(totalOverride?: number): void {
    const totalElement = document.querySelector('#x-total');
    if (totalElement) {
      const count = typeof totalOverride === 'number'
        ? totalOverride
        : document.querySelectorAll('#magnets-content .item:not(.search-results-header)').length;
      totalElement.textContent = `总数 ${count}`;
    }
  }









  /**
   * 复制磁力链接
   */
  private async copyMagnet(magnet: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(magnet);
      showToast('磁力链接已复制到剪贴板', 'success');
    } catch (error) {
      log('Failed to copy magnet:', error);
      showToast('复制失败，请手动复制', 'error');
    }
  }

  /**
   * 推送磁力链接到115（直接使用详情页的完整逻辑）
   */
  private async push115(button: HTMLButtonElement, magnet: string, name: string): Promise<void> {
    try {
      log(`Pushing to 115: ${name}`);

      // 直接调用详情页的完整推送逻辑，包含所有功能：
      // - 完整的日志记录
      // - 推送成功后自动标记已看
      // - 标记已看后自动刷新页面
      // - 跨页 dedupe-by-action；失败/成功后 dataset.drive115Force 可强制重推
      const force = button.dataset.drive115Force === '1';
      if (force) delete button.dataset.drive115Force;
      await handlePushToDrive115(
        button,
        this.currentVideoId || 'unknown',
        magnet,
        name,
        { force },
      );

    } catch (error) {
      log('Error pushing to 115:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      showToast(`推送到115失败: ${errorMessage}`, 'error');
    }
  }






  /**
   * 验证搜索结果是否匹配视频ID
   */
  private isValidResult(name: string, videoId: string): boolean {
    if (!name || !videoId) return false;

    try {
      const isMatch = isValidMagnetResultName(name, videoId);
      log(`Validating result: "${name}" matches "${videoId}": ${isMatch}`);
      return isMatch;
    } catch (error) {
      log('Error validating result:', error);
      return true;
    }
  }

  /**
   * 从 IndexedDB 磁链缓存加载
   */
  private async loadCachedMagnets(videoId: string): Promise<MagnetResult[]> {
    if (!videoId) return [];
    try {
      const { items } = await dbMagnetsQuery({ videoId, orderBy: 'sizeBytes', order: 'desc' });
      return (items || []).map((m) => ({
        name: m.name,
        magnet: m.magnet,
        size: m.size || '',
        sizeBytes: m.sizeBytes || 0,
        date: m.date || '',
        seeders: m.seeders,
        leechers: m.leechers,
        source: String(m.source || 'cache'),
        quality: m.quality,
        hasSubtitle: !!m.hasSubtitle,
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * 将搜索结果写入磁链缓存（批量 upsert）
   */
  private async upsertMagnetsToCache(videoId: string, results: MagnetResult[]): Promise<void> {
    if (!videoId || !Array.isArray(results) || results.length === 0) return;
    const now = Date.now();
    const expireAt = now + MAGNET_CACHE_TTL_MS;
    const recs = results.map((r) => {
      const hash = extractHashFromMagnet(r.magnet);
      return {
        key: `${videoId}|${r.source}|${hash}`,
        videoId,
        source: r.source,
        name: r.name,
        magnet: r.magnet,
        size: r.size,
        sizeBytes: r.sizeBytes,
        date: r.date,
        seeders: r.seeders,
        leechers: r.leechers,
        hasSubtitle: r.hasSubtitle,
        quality: r.quality,
        createdAt: now,
        expireAt,
      } as any;
    });
    await dbMagnetsUpsert(recs);
  }

  /** 搜索完成后只回写可供列表使用的布尔资源证据。 */
  private writeResourceTagEvidence(videoId: string, results: MagnetResult[]): void {
    void writeResourceTagIndexFromMagnetResults(videoId, results)
      .catch((error) => log('Write list resource tag index failed:', error));
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<MagnetSearchConfig>): void {
    const mergedConfig = { ...this.config, ...newConfig };
    this.config = {
      ...mergedConfig,
      sortMode: normalizeMagnetSortMode(mergedConfig.sortMode),
    };
  }

  /**
   * 销毁磁力搜索功能
   */
  destroy(): void {
    this.isInitialized = false;
  }
}

// 导出默认实例
export const magnetSearchManager = new MagnetSearchManager();
