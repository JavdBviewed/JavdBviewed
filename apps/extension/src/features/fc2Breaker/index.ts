/**
 * @file index.ts
 * @description FC2 评论解锁统一导出
 * @module features/fc2Breaker
 */
// src/features/fc2Breaker/index.ts
// FC2拦截破解功能 - 基于JAV-JHS的实现

import { log, STATE } from '../contentState';
import { getJavdbTheme, type JavdbTheme } from '../../platform/browser/domUtils';
import { bgFetchJSON } from '../../platform/network/clientFetch';
import { ReviewBreakerService } from '../reviewUnlock';
import { dbViewedPut } from '../../platform/storage/dbRuntimeClient';
import { getSessionResult, setSessionResult } from '../../platform/storage/sessionResultCache';
import type { VideoRecord } from '../../types';
import {
  appendMagnetResults,
  buildMagnetSourceTagView,
  countUniqueResultsBySource,
  getResultSources,
  MagnetSearchManager,
  type MagnetExternalSearchResult,
  type MagnetResult,
  type MagnetSourceKey,
  type MagnetSourceSearchState,
} from '../magnets';

export interface FC2VideoInfo {
  movieId: string;
  title: string;
  carNum: string;
  releaseDate: string;
  score: string;
  duration: number;
  actors: FC2ActorInfo[];
  images: string[];
  watchedCount: number;
  magnets?: FC2MagnetInfo[];
  reviews?: FC2ReviewInfo[];
  coverUrl?: string;
}

export interface FC2ActorInfo {
  id: string;
  name: string;
  gender: number; // 0=女, 1=男
}

export interface FC2MagnetInfo {
  hash: string;
  name: string;
  size: number; // 单位：MB
  files_count: number;
  created_at: string;
  hd: boolean;
  cnsub: boolean;
}

export interface FC2ReviewInfo {
  id: string;
  content: string;
  score: number;
  created_at: string;
  user_name: string;
}

export interface FC2Response {
  success: boolean;
  data?: FC2VideoInfo;
  error?: string;
}

/**
 * FC2拦截破解服务
 * 使用JavDB API获取FC2视频信息
 */
export class FC2BreakerService {
  private static readonly API_BASE = 'https://jdforrepam.com/api';

  /**
   * 更新图片服务器URL（与JAV-JHS保持一致）
   */
  private static updateImgServer(originalUrl: string): string {
    return originalUrl.replace(/https:\/\/.*?\/rhe951l4q/g, 'https://c0.jdbstatic.com');
  }

  /**
   * 检查是否为FC2视频
   */
  static isFC2Video(videoId: string): boolean {
    return videoId.toUpperCase().startsWith('FC2-') || 
           videoId.toUpperCase().includes('FC2PPV');
  }

  /**
   * 从JavDB API获取评论信息
   */
  private static async getReviewsFromJavDB(movieId: string): Promise<FC2ReviewInfo[]> {
    const url = `${this.API_BASE}/v1/movies/${movieId}/reviews`;
    const signature = await ReviewBreakerService.generateSignature();
    
    log(`[FC2Breaker] Fetching reviews from JavDB API: ${url}`);

    try {
      const { success, status, data, error } = await bgFetchJSON({
        url: `${url}?page=1&sort_by=hotly&limit=10`,
        method: 'GET',
        timeoutMs: 15000,
        headers: {
          'jdSignature': signature,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });

      if (!success || !data) {
        log(`[FC2Breaker] Failed to fetch reviews: ${error || `HTTP ${status}`}`);
        return [];
      }

      const apiResponse = data as any;
      return apiResponse.data?.reviews || [];
    } catch (error) {
      log(`[FC2Breaker] Error fetching reviews:`, error);
      return [];
    }
  }

  /**
   * 从JavDB API获取磁链信息
   */
  private static async getMagnetsFromJavDB(movieId: string): Promise<FC2MagnetInfo[]> {
    const url = `${this.API_BASE}/v1/movies/${movieId}/magnets`;
    const signature = await ReviewBreakerService.generateSignature();
    
    log(`[FC2Breaker] Fetching magnets from JavDB API: ${url}`);

    try {
      const { success, status, data, error } = await bgFetchJSON({
        url,
        method: 'GET',
        timeoutMs: 15000,
        headers: {
          'jdSignature': signature,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });

      if (!success || !data) {
        log(`[FC2Breaker] Failed to fetch magnets: ${error || `HTTP ${status}`}`);
        return [];
      }

      const apiResponse = data as any;
      return apiResponse.data?.magnets || [];
    } catch (error) {
      log(`[FC2Breaker] Error fetching magnets:`, error);
      return [];
    }
  }
  private static async getMovieDetailFromJavDB(movieId: string): Promise<FC2VideoInfo> {
    const url = `${this.API_BASE}/v4/movies/${movieId}`;
    const signature = await ReviewBreakerService.generateSignature();
    
    log(`[FC2Breaker] Fetching movie detail from JavDB API: ${url}`);

    const { success, status, data, error } = await bgFetchJSON({
      url,
      method: 'GET',
      timeoutMs: 15000,
      headers: {
        'jdSignature': signature,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });

    if (!success || !data) {
      throw new Error(error || `HTTP ${status}`);
    }

    const apiResponse = data as any;
    
    if (!apiResponse.data) {
      throw new Error(apiResponse.message || '获取视频详情失败');
    }

    const movie = apiResponse.data.movie;
    const previewImages = movie.preview_images || [];
    const imgList: string[] = [];

    previewImages.forEach((item: any) => {
      const newSrc = this.updateImgServer(item.large_url);
      imgList.push(newSrc);
    });

    return {
      movieId: movie.id,
      actors: movie.actors || [],
      duration: movie.duration || 0,
      title: movie.origin_title || movie.title || '',
      carNum: movie.number || '',
      score: movie.score || '',
      releaseDate: movie.release_date || '',
      watchedCount: movie.watched_count || 0,
      images: imgList,
      coverUrl: movie.cover_url ? this.updateImgServer(movie.cover_url) : undefined,
    };
  }

  /**
   * 获取FC2视频完整信息（使用JavDB API）
   */
  static async getFC2VideoInfo(movieId: string): Promise<FC2Response> {
    const identity = String(movieId || '').trim();
    try {
      const cached = await getSessionResult<FC2Response>('fc2', identity);
      if (cached?.success) {
        log(`[FC2Breaker] cache-hit movieId=${identity}`);
        return cached;
      }

      const result = await this.fetchFC2VideoInfoNetwork(identity);
      if (result.success) {
        await setSessionResult('fc2', identity, result);
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      log(`[FC2Breaker] Error getting FC2 video info:`, error);
      return {
        success: false,
        error: `获取FC2视频信息失败: ${errorMsg}`,
      };
    }
  }

  private static async fetchFC2VideoInfoNetwork(movieId: string): Promise<FC2Response> {
    try {
      log(`[FC2Breaker] Getting FC2 video info for movieId: ${movieId}`);

      const videoInfo = await this.getMovieDetailFromJavDB(movieId);

      // 获取磁链信息
      const magnets = await this.getMagnetsFromJavDB(movieId);
      videoInfo.magnets = magnets;

      // 获取评论信息
      const reviews = await this.getReviewsFromJavDB(movieId);
      videoInfo.reviews = reviews;

      log(`[FC2Breaker] Successfully got FC2 video info with ${magnets.length} magnets and ${reviews.length} reviews`);

      return {
        success: true,
        data: videoInfo,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      log(`[FC2Breaker] Error getting FC2 video info:`, error);

      return {
        success: false,
        error: `获取FC2视频信息失败: ${errorMsg}`,
      };
    }
  }

  /**
   * 显示FC2视频弹窗（公开方法，供列表页调用）
   */
  static async showFC2Dialog(movieId: string, carNum: string, url: string): Promise<void> {
    try {
      log(`[FC2Breaker] Opening FC2 dialog for ${carNum} (movieId: ${movieId})`);
      
      // 显示加载提示
      const loadingModal = this.createLoadingModal(carNum);
      document.body.appendChild(loadingModal);
      
      // 使用movieId从JavDB API获取FC2视频信息
      const response = await this.getFC2VideoInfo(movieId);
      
      // 移除加载提示
      loadingModal.remove();
      
      if (!response.success || !response.data) {
        throw new Error(response.error || '获取FC2视频信息失败');
      }
      
      // 记录到番号库（状态为browsed）
      await this.recordToDatabase(carNum, response.data, url);
      
      // 显示FC2预览弹窗
      const modal = this.createFC2PreviewModal(response.data, url);
      document.body.appendChild(modal);
      
    } catch (error) {
      log(`[FC2Breaker] Error showing FC2 dialog:`, error);
      
      // 显示错误提示
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      const errorModal = this.createErrorModal(errorMsg);
      document.body.appendChild(errorModal);
      
      // 3秒后自动关闭错误提示
      setTimeout(() => errorModal.remove(), 3000);
    }
  }

  /**
   * 记录FC2视频到番号库
   */
  private static async recordToDatabase(carNum: string, videoInfo: FC2VideoInfo, url: string): Promise<void> {
    try {
      const now = Date.now();
      
      // 构建视频记录
      const record: VideoRecord = {
        id: carNum,
        title: videoInfo.title,
        status: 'browsed', // 点击查看时标记为已浏览
        tags: videoInfo.actors.map(actor => actor.name),
        createdAt: now,
        updatedAt: now,
        releaseDate: videoInfo.releaseDate,
        javdbUrl: url,
        javdbImage: videoInfo.coverUrl
      };
      
      // 保存到数据库
      await dbViewedPut(record);
      log(`[FC2Breaker] Recorded ${carNum} to database with status: browsed`);
      
    } catch (error) {
      log(`[FC2Breaker] Failed to record to database:`, error);
      // 不抛出错误，避免影响弹窗显示
    }
  }

  /**
   * 标记视频为已观看
   */
  private static async markAsViewed(carNum: string, videoInfo: FC2VideoInfo, url: string): Promise<void> {
    try {
      const now = Date.now();
      
      // 构建视频记录
      const record: VideoRecord = {
        id: carNum,
        title: videoInfo.title,
        status: 'viewed', // 115推送成功后标记为已观看
        tags: videoInfo.actors.map(actor => actor.name),
        createdAt: now,
        updatedAt: now,
        releaseDate: videoInfo.releaseDate,
        javdbUrl: url,
        javdbImage: videoInfo.coverUrl
      };
      
      // 保存到数据库
      await dbViewedPut(record);
      log(`[FC2Breaker] Marked ${carNum} as viewed after 115 push`);
      
    } catch (error) {
      log(`[FC2Breaker] Failed to mark as viewed:`, error);
    }
  }

  private static applyFC2ModalTheme(root: HTMLElement): JavdbTheme {
    const theme = getJavdbTheme();
    root.dataset.jdbTheme = theme;
    return theme;
  }

  private static bindFC2ModalTheme(root: HTMLElement): void {
    this.applyFC2ModalTheme(root);

    const existingObserver = (root as any).__jdbFc2ThemeObserver as MutationObserver | undefined;
    existingObserver?.disconnect();

    const observer = new MutationObserver(() => {
      this.applyFC2ModalTheme(root);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    (root as any).__jdbFc2ThemeObserver = observer;

    const originalRemove = root.remove.bind(root);
    root.remove = () => {
      observer.disconnect();
      originalRemove();
    };
  }

  /**
   * 创建加载提示弹窗
   */
  private static createLoadingModal(carNum: string): HTMLElement {
    this.ensureFC2ModalStyles();

    const modal = document.createElement('div');
    modal.className = 'fc2-loading-modal';
    this.bindFC2ModalTheme(modal);

    const content = document.createElement('div');
    content.className = 'fc2-loading-content';

    const spinner = document.createElement('div');
    spinner.className = 'fc2-loading-spinner';

    const text = document.createElement('div');
    text.className = 'fc2-loading-text';
    text.textContent = `正在加载 ${carNum} 的信息...`;

    content.appendChild(spinner);
    content.appendChild(text);
    modal.appendChild(content);

    return modal;
  }

  /**
   * 创建错误提示弹窗
   */
  private static createErrorModal(errorMsg: string): HTMLElement {
    this.ensureFC2ModalStyles();

    const modal = document.createElement('div');
    modal.className = 'fc2-error-modal';
    this.bindFC2ModalTheme(modal);

    const title = document.createElement('div');
    title.className = 'fc2-error-title';
    title.textContent = '❌ 加载失败';

    const message = document.createElement('div');
    message.className = 'fc2-error-message';
    message.textContent = errorMsg;

    modal.appendChild(title);
    modal.appendChild(message);

    // 点击关闭
    modal.onclick = () => modal.remove();

    return modal;
  }

  private static ensureFC2ModalStyles(): void {
    if (document.getElementById('fc2-breaker-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'fc2-breaker-modal-styles';
    style.textContent = `
      .fc2-preview-modal,
      .fc2-loading-modal,
      .fc2-error-modal {
        --fc2-overlay-bg: rgba(10, 12, 16, 0.76);
        --fc2-modal-bg: #ffffff;
        --fc2-modal-border: rgba(15, 23, 42, 0.10);
        --fc2-modal-shadow: 0 18px 50px rgba(15, 23, 42, 0.20);
        --fc2-modal-text: #1f2937;
        --fc2-modal-muted: #64748b;
        --fc2-modal-danger: #dc2626;
        --fc2-modal-spinner-track: #e5e7eb;
        --fc2-modal-accent: #3273dc;
        --fc2-magnet-panel-bg: #f7fafc;
        --fc2-magnet-card-bg: #ffffff;
        --fc2-magnet-card-border: rgba(15, 23, 42, 0.10);
        --fc2-magnet-card-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
        --fc2-magnet-title: #0f73a8;
        --fc2-magnet-text: #1f2937;
        --fc2-magnet-muted: #64748b;
        --fc2-magnet-surface: #eef2f7;
        --fc2-magnet-button-bg: #e1f5fe;
        --fc2-magnet-button-hover: #c8ecfb;
        --fc2-magnet-button-text: #0277bd;
        --fc2-magnet-success-bg: #dcfce7;
        --fc2-magnet-success-text: #166534;
        --fc2-magnet-warning-bg: #fef3c7;
        --fc2-magnet-warning-text: #92400e;
        --fc2-magnet-danger-bg: #fee2e2;
        --fc2-magnet-danger-text: #991b1b;
      }

      .fc2-preview-modal[data-jdb-theme="dark"],
      .fc2-loading-modal[data-jdb-theme="dark"],
      .fc2-error-modal[data-jdb-theme="dark"] {
        --fc2-overlay-bg: rgba(0, 0, 0, 0.82);
        --fc2-modal-bg: #1f2937;
        --fc2-modal-border: rgba(148, 163, 184, 0.22);
        --fc2-modal-shadow: 0 20px 54px rgba(0, 0, 0, 0.42);
        --fc2-modal-text: #e5e7eb;
        --fc2-modal-muted: #9ca3af;
        --fc2-modal-danger: #fca5a5;
        --fc2-modal-spinner-track: rgba(148, 163, 184, 0.24);
        --fc2-modal-accent: #7dd3fc;
        --fc2-magnet-panel-bg: #111827;
        --fc2-magnet-card-bg: #1f2937;
        --fc2-magnet-card-border: rgba(148, 163, 184, 0.22);
        --fc2-magnet-card-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
        --fc2-magnet-title: #7dd3fc;
        --fc2-magnet-text: #e5e7eb;
        --fc2-magnet-muted: #9ca3af;
        --fc2-magnet-surface: rgba(148, 163, 184, 0.12);
        --fc2-magnet-button-bg: rgba(14, 165, 233, 0.18);
        --fc2-magnet-button-hover: rgba(14, 165, 233, 0.28);
        --fc2-magnet-button-text: #bae6fd;
        --fc2-magnet-success-bg: rgba(34, 197, 94, 0.18);
        --fc2-magnet-success-text: #bbf7d0;
        --fc2-magnet-warning-bg: rgba(245, 158, 11, 0.18);
        --fc2-magnet-warning-text: #fde68a;
        --fc2-magnet-danger-bg: rgba(239, 68, 68, 0.18);
        --fc2-magnet-danger-text: #fecaca;
      }

      .fc2-preview-modal,
      .fc2-loading-modal {
        position: fixed;
        inset: 0;
        background: var(--fc2-overlay-bg);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      }

      .fc2-preview-modal {
        padding: 20px;
        cursor: default;
      }

      .fc2-preview-modal .box,
      .fc2-loading-content,
      .fc2-error-modal {
        border: 1px solid var(--fc2-modal-border);
        color: var(--fc2-modal-text);
        background: var(--fc2-modal-bg);
        box-shadow: var(--fc2-modal-shadow);
      }

      .fc2-preview-modal .title,
      .fc2-preview-modal .content,
      .fc2-preview-modal .is-size-6 {
        color: var(--fc2-modal-text);
      }

      .fc2-preview-modal .has-text-grey,
      .fc2-preview-modal .has-text-grey-light {
        color: var(--fc2-modal-muted) !important;
      }

      .fc2-loading-content {
        border-radius: 12px;
        padding: 40px;
        text-align: center;
      }

      .fc2-loading-spinner {
        width: 40px;
        height: 40px;
        margin: 0 auto 16px;
        border: 4px solid var(--fc2-modal-spinner-track);
        border-top-color: var(--fc2-modal-accent);
        border-radius: 50%;
        animation: fc2-spin 1s linear infinite;
      }

      .fc2-loading-text {
        color: var(--fc2-modal-text);
        font-size: 16px;
      }

      .fc2-error-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        z-index: 10001;
        max-width: 400px;
        padding: 24px;
        border-radius: 12px;
        transform: translate(-50%, -50%);
      }

      .fc2-error-title {
        margin-bottom: 12px;
        color: var(--fc2-modal-danger);
        font-size: 18px;
        font-weight: 700;
      }

      .fc2-error-message {
        color: var(--fc2-modal-text);
        line-height: 1.5;
      }

      @keyframes fc2-spin {
        to { transform: rotate(360deg); }
      }

      .fc2-magnet-section {
        margin-bottom: 18px;
      }

      .fc2-magnet-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .fc2-magnet-toolbar .title {
        margin-bottom: 0 !important;
      }

      .fc2-magnet-source-search {
        height: 28px;
        border-color: transparent;
        border-radius: 8px;
        color: var(--fc2-magnet-button-text);
        background: var(--fc2-magnet-button-bg);
        font-weight: 700;
      }

      .fc2-magnet-source-search:hover {
        background: var(--fc2-magnet-button-hover);
      }

      .fc2-magnet-statusbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
        margin-bottom: 8px;
        padding: 7px 9px;
        border: 1px solid var(--fc2-magnet-card-border);
        border-radius: 10px;
        color: var(--fc2-magnet-muted);
        background: var(--fc2-magnet-card-bg);
        box-shadow: var(--fc2-magnet-card-shadow);
      }

      .fc2-magnet-status {
        font-size: 12px;
        font-weight: 700;
        line-height: 1.35;
      }

      .fc2-magnet-source-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
      }

      .fc2-magnet-source-tags .tag {
        height: 22px;
        margin: 0 !important;
        padding: 0 8px;
        border-radius: 999px;
        border: 0;
        font-size: 10.5px;
        font-weight: 800;
        line-height: 22px;
      }

      .fc2-magnet-source-tags .tag.is-light {
        color: var(--fc2-magnet-muted);
        background: var(--fc2-magnet-surface);
      }

      .fc2-magnet-source-tags .tag.is-success {
        color: var(--fc2-magnet-success-text);
        background: var(--fc2-magnet-success-bg);
      }

      .fc2-magnet-source-tags .tag.is-warning {
        color: var(--fc2-magnet-warning-text);
        background: var(--fc2-magnet-warning-bg);
      }

      .fc2-magnet-source-tags .tag.is-danger {
        color: var(--fc2-magnet-danger-text);
        background: var(--fc2-magnet-danger-bg);
      }

      .fc2-magnet-list {
        max-height: 460px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 10px;
        border-radius: 12px;
        background: var(--fc2-magnet-panel-bg);
        scroll-behavior: smooth;
      }

      .fc2-magnet-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        margin-bottom: 8px;
        padding: 8px 10px;
        border: 1px solid var(--fc2-magnet-card-border);
        border-radius: 10px;
        color: var(--fc2-magnet-text);
        background: var(--fc2-magnet-card-bg);
        box-shadow: var(--fc2-magnet-card-shadow);
      }

      .fc2-magnet-row:last-child {
        margin-bottom: 0;
      }

      .fc2-magnet-main {
        flex: 1 1 auto;
        min-width: 0;
      }

      .fc2-magnet-link {
        display: block;
        min-width: 0;
        color: inherit;
        text-decoration: none;
      }

      .fc2-magnet-title {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--fc2-magnet-title);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.25;
      }

      .fc2-magnet-link:hover .fc2-magnet-title {
        text-decoration: underline;
      }

      .fc2-magnet-meta {
        display: block;
        margin-top: 2px;
        color: var(--fc2-magnet-muted);
        font-size: 12px;
        line-height: 1.2;
      }

      .fc2-magnet-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        margin: 4px 0 0 !important;
      }

      .fc2-magnet-tags .tag {
        height: 18px;
        margin: 0 !important;
        border-radius: 999px;
        font-size: 10.5px;
        line-height: 18px;
      }

      .fc2-magnet-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        white-space: nowrap;
      }

      .fc2-magnet-actions .button {
        height: 26px;
        margin: 0 !important;
        border-radius: 8px;
        font-weight: 700;
        line-height: 1;
      }

      .fc2-magnet-actions .button.is-info {
        border-color: transparent;
        color: var(--fc2-magnet-button-text);
        background: var(--fc2-magnet-button-bg);
      }

      .fc2-magnet-actions .button.is-info:hover {
        background: var(--fc2-magnet-button-hover);
      }

      .fc2-magnet-actions .button.is-success {
        border-color: transparent;
        color: var(--fc2-magnet-success-text);
        background: var(--fc2-magnet-success-bg);
      }

      .fc2-magnet-actions .button.is-warning {
        border-color: transparent;
        color: var(--fc2-magnet-warning-text);
        background: var(--fc2-magnet-warning-bg);
      }

      .fc2-magnet-date {
        flex: 0 0 auto;
      }

      .fc2-magnet-date .time {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 22px;
        padding: 2px 7px;
        border-radius: 999px;
        color: var(--fc2-magnet-muted);
        background: var(--fc2-magnet-surface);
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
      }

      .fc2-magnet-empty {
        padding: 12px;
        border: 1px dashed var(--fc2-magnet-card-border);
        border-radius: 10px;
        color: var(--fc2-magnet-muted);
        background: var(--fc2-magnet-card-bg);
        font-size: 12px;
      }

      @media (max-width: 768px) {
        .fc2-magnet-toolbar,
        .fc2-magnet-row {
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .fc2-magnet-actions {
          flex: 1 1 100%;
          flex-wrap: wrap;
        }
      }
    `;
    document.head.appendChild(style);
  }

  private static createFC2MagnetSection(videoInfo: FC2VideoInfo, url?: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'fc2-magnet-section';

    const nativeResults = this.convertFC2MagnetsToResults(videoInfo.magnets || []);
    let currentResults = this.mergeAndSortMagnetResults(nativeResults);

    const toolbar = document.createElement('div');
    toolbar.className = 'fc2-magnet-toolbar';

    const title = document.createElement('h3');
    title.className = 'title is-6';
    title.textContent = `磁力链接 (${currentResults.length})`;

    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'button is-small fc2-magnet-source-search';
    searchButton.textContent = '多源搜索';

    toolbar.appendChild(title);
    toolbar.appendChild(searchButton);

    const statusbar = document.createElement('div');
    statusbar.className = 'fc2-magnet-statusbar';

    const statusText = document.createElement('span');
    statusText.className = 'fc2-magnet-status';

    const sourceTags = document.createElement('div');
    sourceTags.className = 'fc2-magnet-source-tags';
    const enabledSources = this.getEnabledMagnetSourceKeys();
    enabledSources.forEach((sourceKey) => {
      sourceTags.appendChild(this.createFC2SourceTag(sourceKey, 'idle', 0));
    });

    statusbar.appendChild(statusText);
    statusbar.appendChild(sourceTags);

    const list = document.createElement('div');
    list.className = 'fc2-magnet-list';

    const render = (results: MagnetResult[], status: string, sourceStateResult?: MagnetExternalSearchResult) => {
      currentResults = this.mergeAndSortMagnetResults(results);
      title.textContent = `磁力链接 (${currentResults.length})`;
      statusText.textContent = status;
      this.renderFC2SourceTags(sourceTags, enabledSources, currentResults, sourceStateResult);
      this.renderFC2MagnetList(list, currentResults, videoInfo, url);
    };

    render(currentResults, `JavDB ${nativeResults.length} 条`);

    searchButton.addEventListener('click', async () => {
      const originalText = searchButton.textContent || '多源搜索';
      searchButton.disabled = true;
      searchButton.classList.add('is-loading');
      searchButton.textContent = '搜索中...';
      statusText.textContent = `正在搜索 ${videoInfo.carNum} 的多源磁力...`;
      this.renderFC2SourceTags(sourceTags, enabledSources, currentResults, undefined, 'searching');

      try {
        const manager = new MagnetSearchManager({
          enabled: true,
          showInlineResults: false,
          showFloatingButton: false,
          autoSearch: false,
          blockMojContent: false,
          sources: this.getFC2MagnetSearchSourcesConfig(),
          maxResults: this.getFC2MagnetMaxResults(),
          timeout: this.getFC2MagnetTimeout(),
        });
        const externalResult = await manager.searchExternalSources(videoInfo.carNum);
        const combinedResults = [...nativeResults, ...externalResult.uniqueResults];
        const mergedResults = this.mergeAndSortMagnetResults(combinedResults);
        const discoveredCount = nativeResults.length + externalResult.discoveredCount;
        const duplicateCount = Math.max(0, discoveredCount - mergedResults.length);

        render(
          mergedResults,
          `发现 ${discoveredCount} 条，去重 ${duplicateCount} 条，显示 ${mergedResults.length} 条`,
          externalResult,
        );

        const { showToast } = await import('../../platform/browser/toast');
        showToast(`FC2 磁力搜索完成：发现 ${discoveredCount} 条，去重 ${duplicateCount} 条，显示 ${mergedResults.length} 条`, 'success');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        statusText.textContent = `多源搜索失败：${message}`;
        const { showToast } = await import('../../platform/browser/toast');
        showToast(`FC2 多源搜索失败：${message}`, 'error');
      } finally {
        searchButton.disabled = false;
        searchButton.classList.remove('is-loading');
        searchButton.textContent = originalText;
      }
    });

    section.appendChild(toolbar);
    section.appendChild(statusbar);
    section.appendChild(list);

    return section;
  }

  private static convertFC2MagnetsToResults(magnets: FC2MagnetInfo[]): MagnetResult[] {
    return magnets
      .filter((magnet) => magnet.hash)
      .map((magnet) => {
        const size = Number.isFinite(magnet.size) ? `${(magnet.size / 1024).toFixed(2)} GB` : '';
        return {
          name: magnet.name || magnet.hash,
          magnet: `magnet:?xt=urn:btih:${magnet.hash}`,
          size,
          sizeBytes: Number.isFinite(magnet.size) ? magnet.size * 1024 * 1024 : 0,
          date: magnet.created_at || '',
          source: 'JavDB',
          sources: ['JavDB'],
          quality: magnet.hd ? '高清' : undefined,
          hasSubtitle: !!magnet.cnsub,
          seeders: 0,
          leechers: 0,
        };
      });
  }

  private static mergeAndSortMagnetResults(results: MagnetResult[]): MagnetResult[] {
    const uniqueResults: MagnetResult[] = [];
    appendMagnetResults(uniqueResults, results);
    return uniqueResults.sort((a, b) => {
      if (a.hasSubtitle !== b.hasSubtitle) return a.hasSubtitle ? -1 : 1;
      const aCracked = this.isCrackedMagnetName(a.name);
      const bCracked = this.isCrackedMagnetName(b.name);
      if (aCracked !== bCracked) return aCracked ? -1 : 1;
      if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      return bTime - aTime;
    });
  }

  private static renderFC2MagnetList(container: HTMLElement, results: MagnetResult[], videoInfo: FC2VideoInfo, url?: string): void {
    container.innerHTML = '';

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fc2-magnet-empty';
      empty.textContent = '暂无磁力链接，可尝试多源搜索。';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((result) => {
      fragment.appendChild(this.createFC2MagnetRow(result, videoInfo, url));
    });
    container.appendChild(fragment);
  }

  private static createFC2MagnetRow(result: MagnetResult, videoInfo: FC2VideoInfo, url?: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fc2-magnet-row privacy-protected';
    row.setAttribute('data-privacy-protected', 'true');
    row.setAttribute('data-source', result.source);

    const main = document.createElement('div');
    main.className = 'fc2-magnet-main';

    const link = document.createElement('a');
    link.className = 'fc2-magnet-link';
    link.href = result.magnet;
    link.title = '右键点击并选择「复制链接地址」';

    const title = document.createElement('span');
    title.className = 'fc2-magnet-title privacy-protected';
    title.setAttribute('data-privacy-protected', 'true');
    title.textContent = result.name;
    title.title = result.name;

    const meta = document.createElement('span');
    meta.className = 'fc2-magnet-meta';
    const sourceText = getResultSources(result).join(' / ');
    const metaParts = [
      result.size || '',
      sourceText ? `来源 ${sourceText}` : '',
      typeof result.seeders === 'number' && result.seeders > 0 ? `做种 ${result.seeders}` : '',
    ].filter(Boolean);
    meta.textContent = metaParts.join(' · ') || '磁力链接';

    const tags = document.createElement('div');
    tags.className = 'fc2-magnet-tags';
    getResultSources(result).forEach((source) => {
      const tag = document.createElement('span');
      tag.className = `tag ${source === 'JavDB' ? 'is-info' : 'is-danger'} is-small`;
      tag.textContent = source;
      tags.appendChild(tag);
    });

    if (result.quality) {
      const tag = document.createElement('span');
      tag.className = 'tag is-primary is-small is-light';
      tag.textContent = result.quality;
      tags.appendChild(tag);
    }

    if (result.hasSubtitle) {
      const tag = document.createElement('span');
      tag.className = 'tag is-warning is-small is-light';
      tag.textContent = '字幕';
      tags.appendChild(tag);
    }

    if (this.isCrackedMagnetName(result.name)) {
      const tag = document.createElement('span');
      tag.className = 'tag is-success is-small is-light';
      tag.textContent = '破解';
      tags.appendChild(tag);
    }

    link.appendChild(title);
    link.appendChild(meta);
    link.appendChild(tags);
    main.appendChild(link);

    const actions = document.createElement('div');
    actions.className = 'fc2-magnet-actions';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'button is-info is-small';
    copyButton.textContent = '复制';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(result.magnet);
        copyButton.textContent = '已复制';
        copyButton.className = 'button is-success is-small';
        setTimeout(() => {
          copyButton.textContent = '复制';
          copyButton.className = 'button is-info is-small';
        }, 2000);
      } catch {
        copyButton.textContent = '复制失败';
        copyButton.className = 'button is-danger is-small';
        setTimeout(() => {
          copyButton.textContent = '复制';
          copyButton.className = 'button is-info is-small';
        }, 2000);
      }
    });

    const openButton = document.createElement('a');
    openButton.className = 'button is-success is-small';
    openButton.href = result.magnet;
    openButton.textContent = '打开';

    const push115Button = document.createElement('button');
    push115Button.type = 'button';
    push115Button.className = 'button is-warning is-small';
    push115Button.textContent = '推送115';
    push115Button.title = '推送到115网盘离线下载';
    push115Button.addEventListener('click', () => {
      this.pushFC2MagnetTo115(push115Button, result, videoInfo, url);
    });

    actions.appendChild(copyButton);
    actions.appendChild(openButton);
    actions.appendChild(push115Button);

    const date = document.createElement('div');
    date.className = 'fc2-magnet-date';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = result.date || 'Unknown';
    date.appendChild(time);

    row.appendChild(main);
    row.appendChild(actions);
    row.appendChild(date);

    return row;
  }

  private static async pushFC2MagnetTo115(button: HTMLButtonElement, result: MagnetResult, videoInfo: FC2VideoInfo, url?: string): Promise<void> {
    const originalText = button.textContent || '推送115';
    button.disabled = true;
    button.classList.add('is-loading');

    try {
      const { isDrive115Enabled, addTaskUrlsV2 } = await import('../drive115/router');
      const {
        getDefaultManualPushDirectory,
        resolveManualPushDirectory,
        shouldUseDefaultDirectoryForManualPush,
      } = await import('../drive115/ui/manualPushDirectory');
      const { showToast } = await import('../../platform/browser/toast');
      const { getSettings } = await import('../../utils/storage');

      if (!(await isDrive115Enabled())) {
        showToast('115网盘功能未启用，请先在设置中启用', 'error');
        return;
      }

      const settings = await getSettings();
      const configuredDirectory = String(settings?.drive115?.downloadDir ?? settings?.drive115?.defaultWpPathId ?? '');
      const selection = shouldUseDefaultDirectoryForManualPush(
        settings?.drive115?.skipManualPushDirectoryPicker === true,
        configuredDirectory,
      )
        ? getDefaultManualPushDirectory(
          configuredDirectory,
          String(settings?.drive115?.downloadDirName ?? ''),
          String(settings?.drive115?.downloadDirPath ?? ''),
        )
        : await resolveManualPushDirectory(configuredDirectory, configuredDirectory);
      if (!selection) return;

      const pushResult = await addTaskUrlsV2({
        urls: result.magnet,
        wp_path_id: selection.cid,
        context: {
          source: 'fc2',
          videoId: videoInfo.carNum,
          magnetName: result.name,
          pageUrl: url,
          wpPathId: selection.cid,
        },
      });

      if (!pushResult.success) {
        throw new Error(pushResult.message || '推送失败');
      }

      button.classList.remove('is-loading');
      button.textContent = '已推送';
      button.className = 'button is-success is-small';
      showToast(`${result.name} 推送到115网盘成功`, 'success');

      try {
        const autoMark = settings?.videoEnhancement?.autoMarkWatchedAfter115 !== false;
        if (autoMark && url) {
          await FC2BreakerService.markAsViewed(videoInfo.carNum, videoInfo, url);
          log(`[FC2Breaker] Auto-marked ${videoInfo.carNum} as viewed after 115 push`);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        showToast(`已推送到115。自动标记已看：${errMsg || '已关闭'}`, 'info');
      }

      setTimeout(() => {
        button.textContent = originalText;
        button.className = 'button is-warning is-small';
        button.disabled = false;
      }, 3000);
    } catch (error) {
      const { showToast } = await import('../../platform/browser/toast');
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      button.classList.remove('is-loading');
      button.textContent = '推送失败';
      button.className = 'button is-danger is-small';
      showToast(`推送失败: ${errorMsg}`, 'error');

      setTimeout(() => {
        button.textContent = originalText;
        button.className = 'button is-warning is-small';
        button.disabled = false;
      }, 3000);
    }
  }

  private static renderFC2SourceTags(
    container: HTMLElement,
    enabledSources: MagnetSourceKey[],
    results: MagnetResult[],
    searchResult?: MagnetExternalSearchResult,
    overrideState?: MagnetSourceSearchState,
  ): void {
    container.innerHTML = '';
    const counts = countUniqueResultsBySource(results);

    enabledSources.forEach((sourceKey) => {
      const state = overrideState || searchResult?.sourceStates[sourceKey]?.status || 'idle';
      const resultCount = searchResult?.sourceStates[sourceKey]?.resultCount;
      container.appendChild(this.createFC2SourceTag(sourceKey, state, counts[sourceKey] || 0, resultCount));
    });
  }

  private static createFC2SourceTag(sourceKey: MagnetSourceKey, state: MagnetSourceSearchState, currentUniqueCount: number, latestResultCount?: number): HTMLElement {
    const view = buildMagnetSourceTagView(sourceKey, state, currentUniqueCount, latestResultCount);
    const tag = document.createElement('span');
    tag.className = `tag ${view.className}`;
    tag.textContent = view.text;
    tag.title = view.title;
    return tag;
  }

  private static getEnabledMagnetSourceKeys(): MagnetSourceKey[] {
    const sources = this.getFC2MagnetSearchSourcesConfig();
    return [
      ['sukebei', sources.sukebei],
      ['btdig', sources.btdig],
      ['btsow', sources.btsow],
      ['torrentz2', sources.torrentz2],
      ['javbus', sources.javbus],
    ].filter(([, enabled]) => enabled).map(([key]) => key as MagnetSourceKey);
  }

  private static getFC2MagnetSearchSourcesConfig() {
    const sources = (STATE.settings as any)?.magnetSearch?.sources || {};
    return {
      sukebei: sources.sukebei !== false,
      btdig: sources.btdig !== false,
      btsow: sources.btsow !== false,
      torrentz2: sources.torrentz2 === true,
      javbus: sources.javbus === true,
      custom: [],
    };
  }

  private static getFC2MagnetTimeout(): number {
    return Number((STATE.settings as any)?.magnetSearch?.timeoutMs || 8000);
  }

  private static getFC2MagnetMaxResults(): number {
    return Number((STATE.settings as any)?.magnetSearch?.maxResults || 20);
  }

  private static isCrackedMagnetName(name: string): boolean {
    return /破解|crack|uncensored|无码|無碼|leaked/i.test(name || '');
  }

  /**
   * 创建FC2视频预览弹窗（使用JavDB原生Bulma样式）
   */
  static createFC2PreviewModal(videoInfo: FC2VideoInfo, url?: string): HTMLElement {
    this.ensureFC2ModalStyles();

    const modal = document.createElement('div');
    modal.className = 'fc2-preview-modal';
    this.bindFC2ModalTheme(modal);
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: var(--fc2-overlay-bg);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      padding: 20px;
      cursor: default;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
      max-width: 1200px;
      width: 100%;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      background: transparent;
      cursor: default;
    `;
    
    // 阻止容器内的点击事件冒泡到modal
    container.onclick = (e) => {
      e.stopPropagation();
    };

    // 固定顶栏
    const header = document.createElement('div');
    header.className = 'box';
    header.style.cssText = `
      margin-bottom: 10px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    `;

    const headerLeft = document.createElement('div');
    headerLeft.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    `;

    const carNumBadge = document.createElement('span');
    carNumBadge.className = 'tag is-info is-medium';
    carNumBadge.textContent = videoInfo.carNum;

    const titleText = document.createElement('span');
    titleText.className = 'is-size-6';
    titleText.style.cssText = `
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    titleText.textContent = videoInfo.title;

    headerLeft.appendChild(carNumBadge);
    headerLeft.appendChild(titleText);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'delete is-medium';
    closeBtn.onclick = () => modal.remove();

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);

    // 内容区域（可滚动）
    const content = document.createElement('div');
    content.className = 'box';
    content.style.cssText = `
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      cursor: default;
    `;

    // 标题区域
    const titleSection = document.createElement('div');
    titleSection.style.cssText = `margin-bottom: 20px;`;
    
    const title = document.createElement('h2');
    title.className = 'title is-5';
    title.textContent = videoInfo.title;
    titleSection.appendChild(title);

    // 封面图片（如果有）
    let coverSection: HTMLElement | null = null;
    if (videoInfo.coverUrl) {
      coverSection = document.createElement('div');
      coverSection.style.cssText = `margin-bottom: 20px;`;
      
      const figure = document.createElement('figure');
      figure.className = 'image';
      figure.style.cssText = `max-width: 400px; margin: 0 auto;`;
      
      const img = document.createElement('img');
      img.src = videoInfo.coverUrl;
      img.alt = videoInfo.title;
      img.style.cssText = `border-radius: 8px; cursor: pointer;`;
      img.onclick = () => window.open(videoInfo.coverUrl, '_blank');
      
      figure.appendChild(img);
      coverSection.appendChild(figure);
    }

    // 基本信息（使用Bulma的columns）
    const infoSection = document.createElement('div');
    infoSection.className = 'content';
    infoSection.style.cssText = `margin-bottom: 20px;`;
    
    let infoHTML = `
      <div class="columns is-mobile is-multiline">
        <div class="column is-half-mobile is-one-third-tablet">
          <strong>番号:</strong> ${videoInfo.carNum}
        </div>
    `;
    
    if (videoInfo.releaseDate) {
      infoHTML += `
        <div class="column is-half-mobile is-one-third-tablet">
          <strong>发布日期:</strong> ${videoInfo.releaseDate}
        </div>
      `;
    }
    
    if (videoInfo.score) {
      infoHTML += `
        <div class="column is-half-mobile is-one-third-tablet">
          <strong>评分:</strong> ${videoInfo.score}
        </div>
      `;
    }
    
    if (videoInfo.duration) {
      infoHTML += `
        <div class="column is-half-mobile is-one-third-tablet">
          <strong>时长:</strong> ${videoInfo.duration} 分钟
        </div>
      `;
    }
    
    if (videoInfo.watchedCount) {
      infoHTML += `
        <div class="column is-half-mobile is-one-third-tablet">
          <strong>观看:</strong> ${videoInfo.watchedCount}
        </div>
      `;
    }
    
    const cleanId = videoInfo.carNum.replace(/^FC2-?/i, '');
    infoHTML += `
        <div class="column is-full">
          <strong>站点:</strong> 
          <a href="https://fc2ppvdb.com/articles/${cleanId}" target="_blank" class="has-text-link">fc2ppvdb</a>
          <span style="margin: 0 8px;">|</span>
          <a href="https://adult.contents.fc2.com/article/${cleanId}/" target="_blank" class="has-text-link">fc2电子市场</a>
        </div>
      </div>
    `;
    
    infoSection.innerHTML = infoHTML;

    // 操作按钮区（使用Bulma的buttons）
    const actionButtons = document.createElement('div');
    actionButtons.className = 'buttons';
    actionButtons.style.cssText = `margin-bottom: 20px;`;
    
    const subtitleBtn = document.createElement('a');
    subtitleBtn.href = `https://subtitlecat.com/index.php?search=${videoInfo.carNum}`;
    subtitleBtn.target = '_blank';
    subtitleBtn.className = 'button is-info is-small';
    subtitleBtn.innerHTML = '<span class="icon"><i class="fas fa-search"></i></span><span>字幕搜索</span>';
    actionButtons.appendChild(subtitleBtn);

    // 组装基础部分
    content.appendChild(titleSection);
    if (coverSection) content.appendChild(coverSection);
    content.appendChild(infoSection);
    content.appendChild(actionButtons);

    // 演员信息（使用Bulma的tags）
    if (videoInfo.actors && videoInfo.actors.length > 0) {
      const actorsSection = document.createElement('div');
      actorsSection.style.cssText = `margin-bottom: 20px;`;
      
      const actorsTitle = document.createElement('h3');
      actorsTitle.className = 'title is-6';
      actorsTitle.textContent = '主演演员';
      
      const actorsTags = document.createElement('div');
      actorsTags.className = 'tags';
      
      videoInfo.actors.forEach(actor => {
        const tag = document.createElement('span');
        tag.className = 'tag is-info is-light';
        tag.textContent = actor.name;
        actorsTags.appendChild(tag);
      });
      
      actorsSection.appendChild(actorsTitle);
      actorsSection.appendChild(actorsTags);
      content.appendChild(actorsSection);
    }

    // 剧照预览（使用Bulma的columns）
    if (videoInfo.images && videoInfo.images.length > 0) {
      const imagesSection = document.createElement('div');
      imagesSection.style.cssText = `margin-bottom: 20px;`;
      
      const imagesTitle = document.createElement('h3');
      imagesTitle.className = 'title is-6';
      imagesTitle.textContent = '剧照预览';
      
      const imagesGrid = document.createElement('div');
      imagesGrid.className = 'columns is-multiline is-mobile';
      
      videoInfo.images.forEach((imgUrl) => {
        const col = document.createElement('div');
        col.className = 'column is-one-quarter-desktop is-one-third-tablet is-half-mobile';
        
        const figure = document.createElement('figure');
        figure.className = 'image is-16by9';
        figure.style.cssText = `cursor: pointer; border-radius: 4px; overflow: hidden;`;
        
        const img = document.createElement('img');
        img.src = imgUrl;
        img.style.cssText = `object-fit: cover; width: 100%; height: 100%;`;
        img.onclick = () => window.open(imgUrl, '_blank');
        
        figure.appendChild(img);
        col.appendChild(figure);
        imagesGrid.appendChild(col);
      });
      
      imagesSection.appendChild(imagesTitle);
      imagesSection.appendChild(imagesGrid);
      content.appendChild(imagesSection);
    }

    content.appendChild(this.createFC2MagnetSection(videoInfo, url));

    // 评论区（使用Bulma的message组件）
    if (videoInfo.reviews && videoInfo.reviews.length > 0) {
      const reviewsSection = document.createElement('div');
      reviewsSection.style.cssText = `margin-bottom: 20px;`;
      
      const reviewsTitle = document.createElement('h3');
      reviewsTitle.className = 'title is-6';
      reviewsTitle.textContent = `用户评论 (${videoInfo.reviews.length})`;
      
      const reviewsList = document.createElement('div');
      
      videoInfo.reviews.forEach((review) => {
        const reviewBox = document.createElement('article');
        reviewBox.className = 'message';
        reviewBox.style.cssText = `margin-bottom: 12px;`;
        
        const reviewHeader = document.createElement('div');
        reviewHeader.className = 'message-header';
        
        const userName = document.createElement('span');
        userName.textContent = review.user_name || '匿名用户';
        
        const reviewMeta = document.createElement('span');
        reviewMeta.className = 'is-size-7';
        
        if (review.score) {
          const scoreSpan = document.createElement('span');
          scoreSpan.textContent = `⭐ ${review.score}`;
          reviewMeta.appendChild(scoreSpan);
          reviewMeta.appendChild(document.createTextNode(' · '));
        }
        
        reviewMeta.appendChild(document.createTextNode(review.created_at));
        
        reviewHeader.appendChild(userName);
        reviewHeader.appendChild(reviewMeta);
        
        const reviewBody = document.createElement('div');
        reviewBody.className = 'message-body';
        reviewBody.textContent = review.content;
        
        reviewBox.appendChild(reviewHeader);
        reviewBox.appendChild(reviewBody);
        reviewsList.appendChild(reviewBox);
      });
      
      reviewsSection.appendChild(reviewsTitle);
      reviewsSection.appendChild(reviewsList);
      content.appendChild(reviewsSection);
    }

    // 组装容器
    container.appendChild(header);
    container.appendChild(content);
    modal.appendChild(container);

    // 点击背景关闭
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    };

    return modal;
  }
}

export const fc2BreakerService = FC2BreakerService;
