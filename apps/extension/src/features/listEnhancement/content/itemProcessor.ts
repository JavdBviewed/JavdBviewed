/**
 * @file itemProcessor.ts
 * @description itemProcessor
 * @module features/listEnhancement
 */
// src/features/listEnhancement/content/itemProcessor.ts

import { VIDEO_STATUS } from '../../../utils/config';
import { STATE, SELECTORS, getContentRecord, log } from '../../contentState';
import { loadContentRecordSummaries } from '../../contentState/recordCache';
import { ensureListTagContainer, renderLibraryStatusBadges } from '../../embyLibrary/content/statusBadges';
import { renderDrive115LibraryStatusBadge } from '../../drive115/content/libraryStatusBadges';
import { normalizeVideoCode } from '../../embyLibrary/domain/libraryIndex';
import { buildRealtimeCheckConfig, embyLibraryRealtimeCheckQueue } from '../../embyLibrary/content/realtimeCheck';
import { isPageProperlyLoaded } from '../../videoDetail';
import { countContentPerformanceEvent } from '../../../platform/tasks';
import { renderListFavoriteQuickAction } from './favoriteQuickAction';
import { renderResourceTagsForItems } from './resourceTags';
import { renderListStatusQuickActions } from './statusQuickActions';
import {
    selectListItemsByCodes,
    selectListItemsForProcessing,
    type ListProcessingOptions,
} from './listProcessingPolicy';

export function processVisibleItems(options: ListProcessingOptions = {}): void {
    // 首先检查页面是否正常加载
    if (!isPageProperlyLoaded()) {
        log('Page not properly loaded (no navbar-item found), skipping list processing to avoid data corruption');
        return;
    }

    const items = document.querySelectorAll<HTMLElement>(SELECTORS.MOVIE_LIST_ITEM);

    // 只在没有找到项目时输出调试信息
    if (items.length === 0) {
        log(`Found ${items.length} items with selector: ${SELECTORS.MOVIE_LIST_ITEM}`);
        log('No items found, checking page structure...');
        const movieList = document.querySelector('.movie-list');
        if (movieList) {
            log('Found .movie-list container, children:', movieList.children.length);
        } else {
            log('No .movie-list container found');
        }
    }

    processListItems([...items], options);
}

/**
 * 处理一个由列表增强观察器刚发现的影片卡片。
 * 列表增强启用时由它接管动态卡片，避免再启动第二套全列表观察器。
 */
export function processListItem(item: HTMLElement, options: ListProcessingOptions = {}): void {
    processListItems([item], options);
}

export function processListItems(items: readonly HTMLElement[], options: ListProcessingOptions = {}, skipSummaryLoad = false): void {
    countContentPerformanceEvent('list.processBatch');
    countContentPerformanceEvent('list.processItems', items.length);
    const requestedCodes = options.codes?.length
        ? new Set(options.codes.map(code => normalizeVideoCode(code)).filter((code): code is string => Boolean(code)))
        : null;
    const scopedItems = selectListItemsByCodes(items, requestedCodes, item => {
            const rawCode = item.querySelector<HTMLElement>(SELECTORS.VIDEO_ID)?.textContent || '';
            return normalizeVideoCode(rawCode);
        });

    if (options.force === true) {
        // 只有状态/配置显式刷新时才失效全量标记；普通增量更新不能重置内容筛选状态。
        scopedItems.forEach(item => {
            item.removeAttribute('data-processed');
            item.removeAttribute('data-filter-processed');
        });
    }

    const itemsToProcess = selectListItemsForProcessing(scopedItems, options);

    if (!skipSummaryLoad) {
        const ids = itemsToProcess
            .map(item => item.querySelector<HTMLElement>(SELECTORS.VIDEO_ID)?.textContent?.trim() || '')
            .filter(Boolean);
        const missing = ids.filter(id => !STATE.records[id] && !STATE.recordSummaries[id]);
        if (missing.length > 0) {
            void loadContentRecordSummaries(missing)
                .catch((error) => log('Failed to load list record summaries:', error))
                .finally(() => processListItems(items, options, true));
            return;
        }
    }

    const visibleCodes: string[] = [];
    itemsToProcess.forEach((item) => {
        const videoId = processItem(item);
        if (videoId && item.style.display !== 'none') {
            visibleCodes.push(videoId);
        }
    });

    embyLibraryRealtimeCheckQueue.enqueue(
        visibleCodes,
        buildRealtimeCheckConfig(STATE.settings),
    );

    const resourceTagsEnabled = (STATE.settings as any)?.listEnhancement?.resourceTags === true;
    void renderResourceTagsForItems(
        itemsToProcess.map((item) => ({
            item,
            videoId: item.querySelector<HTMLElement>(SELECTORS.VIDEO_ID)?.textContent?.trim() || '',
        })).filter(({ videoId }) => Boolean(videoId)),
        resourceTagsEnabled,
    ).catch((error) => log('Failed to render list resource tags:', error));
}

export function setupObserver(): void {
    const targetNode = document.querySelector('.movie-list');
    if (!targetNode) return;

    STATE.observer = new MutationObserver(mutations => {
        countContentPerformanceEvent('observer.listEnhancement.callback');
        countContentPerformanceEvent('observer.listEnhancement.mutations', mutations.length);
        let hasNewVideoItems = false;
        const newVideoItems = new Set<HTMLElement>();

        mutations.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                // 检查是否有真正的新视频项目节点
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const element = node as Element;
                        // 只有当添加的是视频项目或包含视频项目的容器时才处理
                        if (element.matches('.item') || element.querySelector('.item')) {
                            hasNewVideoItems = true;
                            if (element.matches('.item')) {
                                newVideoItems.add(element as HTMLElement);
                            } else {
                                element.querySelectorAll<HTMLElement>('.item').forEach(item => newVideoItems.add(item));
                            }
                        }
                    }
                }
            }
        });

        if (hasNewVideoItems) {
            // 使用防抖来避免频繁处理
            if (STATE.debounceTimer) clearTimeout(STATE.debounceTimer);
            STATE.debounceTimer = window.setTimeout(() => {
                log('Observer detected new video items, processing...');
                processListItems([...newVideoItems]);
            }, 300);
        }
    });

    STATE.observer.observe(targetNode, { childList: true, subtree: true });
}

function shouldHide(videoId: string): boolean {
    if (STATE.isSearchPage || !STATE.settings) {
        return false;
    }

    // 在“想看/已看”聚合页禁用状态隐藏，避免影响数据查看
    try {
        const p = window.location.pathname;
        if (p.startsWith('/users/want_watch_videos') || p.startsWith('/users/watched_videos')) {
            return false;
        }
    } catch {}

    const { hideViewed, hideBrowsed, hideWant } = STATE.settings.display as any;
    const record = getContentRecord(videoId);

    if (!record) {
        return false;
    }

    const isViewed = record.status === VIDEO_STATUS.VIEWED;
    const isBrowsed = record.status === VIDEO_STATUS.BROWSED;
    const isWant = record.status === VIDEO_STATUS.WANT;

    if (hideViewed && isViewed) {
        return true;
    }
    if (hideBrowsed && isBrowsed) {
        return true;
    }
    if (hideWant && isWant) {
        return true;
    }

    return false;
}

function getHideReason(videoId: string): string {
    if (STATE.isSearchPage || !STATE.settings) {
        return '';
    }

    // 在“想看/已看”聚合页不返回隐藏原因（即不隐藏）
    try {
        const p = window.location.pathname;
        if (p.startsWith('/users/want_watch_videos') || p.startsWith('/users/watched_videos')) {
            return '';
        }
    } catch {}

    const { hideViewed, hideBrowsed, hideWant } = (STATE.settings.display as any);
    const record = getContentRecord(videoId);

    if (!record) {
        return '';
    }

    const isViewed = record.status === VIDEO_STATUS.VIEWED;
    const isBrowsed = record.status === VIDEO_STATUS.BROWSED;
    const isWant = record.status === VIDEO_STATUS.WANT;

    if (hideViewed && isViewed) {
        return 'VIEWED';
    }
    if (hideBrowsed && isBrowsed) {
        return 'BROWSED';
    }
    if (hideWant && isWant) {
        return 'WANT';
    }

    return '';
}

function processItem(item: HTMLElement): string | null {
    // 检查是否已经处理过这个项目
    if (item.hasAttribute('data-processed')) {
        return null;
    }

    const videoIdElement = item.querySelector<HTMLElement>(SELECTORS.VIDEO_ID);
    if (!videoIdElement) {
        return null;
    }

    const videoId = videoIdElement.textContent?.trim();
    if (!videoId) {
        return null;
    }

    // 标记为已处理
    item.setAttribute('data-processed', 'true');

    // 减少日志输出，只在需要时记录
    // log(`Processing item: ${videoId}`);

    // 清除旧的状态标签
    item.querySelectorAll('.custom-status-tag').forEach(tag => tag.remove());
    item.querySelectorAll('.emby-library-status-tag').forEach(tag => tag.remove());

    // 检查是否启用状态标签显示功能
    const showStatusBadge = STATE.settings?.listEnhancement?.showStatusBadge !== false; // 默认启用
    
    if (showStatusBadge) {
        // 尝试多个可能的标签容器位置
        let tagContainer = item.querySelector<HTMLElement>(SELECTORS.TAGS_CONTAINER);
        
        // 如果找不到 .tags.has-addons，尝试其他位置
        if (!tagContainer) {
            // 尝试找到 .tags 容器
            tagContainer = item.querySelector<HTMLElement>('.tags');
        }
        
        // 如果还是找不到，创建一个新的标签容器
        if (!tagContainer) {
            const videoTitle = item.querySelector('.video-title');
            if (videoTitle) {
                tagContainer = document.createElement('div');
                tagContainer.className = 'tags has-addons';
                videoTitle.appendChild(tagContainer);
            }
        }

        if (tagContainer) {
            const record = getContentRecord(videoId);

            if (record) {
                log(`Found record for ${videoId}: status=${record.status}`);
                switch (record.status) {
                    case VIDEO_STATUS.VIEWED:
                        addTag(tagContainer, '已观看', 'is-success');
                        break;
                    case VIDEO_STATUS.WANT:
                        addTag(tagContainer, '我想看', 'is-info');
                        break;
                    case VIDEO_STATUS.BROWSED:
                        addTag(tagContainer, '已浏览', 'is-warning');
                        break;
                }
            }
        }
    }

    renderListStatusQuickActions(item, videoId, STATE.settings);
    renderListFavoriteQuickAction(item, videoId, STATE.settings);

    const aggregateLibraryMatchStatus = (STATE.settings as any)?.libraryMatchStatus
        ?? (STATE.settings as any)?.listEnhancement?.libraryMatchStatus;
    const aggregateEmbyEnabled = aggregateLibraryMatchStatus?.enabled === true
        && aggregateLibraryMatchStatus.sources?.emby !== false;
    const aggregateDrive115Enabled = aggregateLibraryMatchStatus?.enabled === true
        && aggregateLibraryMatchStatus.sources?.drive115 !== false;

    if ((STATE.settings as any)?.emby?.libraryStatus?.enabled === true || aggregateEmbyEnabled) {
        const tagContainer = ensureListTagContainer(item);
        if (tagContainer) {
            renderLibraryStatusBadges(tagContainer, videoId, 'list');
        }
    }
    if (aggregateDrive115Enabled || (STATE.settings as any)?.listEnhancement?.drive115LibraryStatus?.enabled === true) {
        const tagContainer = ensureListTagContainer(item);
        if (tagContainer) void renderDrive115LibraryStatusBadge(tagContainer, videoId, STATE.settings as Record<string, unknown>);
    }

    // 检查VR标签 - 改进检测逻辑，参考油猴脚本
    const vrTag = item.querySelector('.tag.is-link');
    const isVR = vrTag?.textContent?.trim() === 'VR';

    // 也检查data-title属性中是否包含VR标识（参考油猴脚本）
    const dataTitleElement = item.querySelector('div.video-title > span.x-btn');
    const dataTitle = dataTitleElement?.getAttribute('data-title') || '';
    const isVRInDataTitle = dataTitle.includes('【VR】');

    // 兜底：在未注入 data-title 前，从标题文本或 a[title] 中识别 VR 标记
    const titleContainer = item.querySelector('.video-title') as HTMLElement | null;
    const rawTitleText = titleContainer?.textContent?.trim() || '';
    const linkWithTitle = item.querySelector('a[title]') as HTMLAnchorElement | null;
    const linkTitleText = linkWithTitle?.getAttribute('title')?.trim() || '';
    const mergedTitleText = linkTitleText || rawTitleText;
    const isVRInTitleText = /(?:【\s*VR\s*】|\bVR\b)/i.test(mergedTitleText);

    const finalIsVR = isVR || isVRInDataTitle || isVRInTitleText;

    if (!STATE.isSearchPage && STATE.settings?.display.hideVR && finalIsVR) {
        log(`Hiding VR video: ${videoId}`);
        item.style.display = 'none';
        // 添加标记，表示被默认功能隐藏
        item.setAttribute('data-hidden-by-default', 'true');
        item.setAttribute('data-hide-reason', 'VR');
        return videoId;
    }

    if (shouldHide(videoId)) {
        log(`Hiding video based on status: ${videoId}`);
        item.style.display = 'none';
        // 添加标记，表示被默认功能隐藏
        item.setAttribute('data-hidden-by-default', 'true');
        item.setAttribute('data-hide-reason', getHideReason(videoId));
        return videoId;
    }

    if (item.hasAttribute('data-hidden-by-actor')) {
        item.style.display = 'none';
        return videoId;
    }

    // 确保显示未被隐藏的项目
    item.style.display = '';
    // 移除默认隐藏标记
    item.removeAttribute('data-hidden-by-default');
    item.removeAttribute('data-hide-reason');
    return videoId;
}

function addTag(container: HTMLElement, text: string, style: string): void {
    const tag = document.createElement('span');
    tag.className = `tag ${style} is-light custom-status-tag`;
    tag.textContent = text;
    container.appendChild(tag);
}
