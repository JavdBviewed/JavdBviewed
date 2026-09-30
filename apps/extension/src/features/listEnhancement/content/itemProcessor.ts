/**
 * @file itemProcessor.ts
 * @description itemProcessor
 * @module features/listEnhancement
 */
// src/features/listEnhancement/content/itemProcessor.ts

import { VIDEO_STATUS, isEmbyLibraryEnabled } from '../../../utils/config';
import { STATE, SELECTORS, getContentRecord, log } from '../../contentState';
import {
    loadContentRecordSummaries,
    pickPendingContentRecordIds,
    waitForContentRecordSummaries,
} from '../../contentState/recordCache';
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
import {
    recomputeListHiding,
    setHidingSource,
    readListHidingEnablement,
    isStatusAggregatePage,
    markMediaLibraryHiding,
    markDrive115LibraryHiding,
} from '../../list-hiding';
import {
    DEFAULT_EXISTING_ITEMS_CHUNK_SIZE,
    defaultScheduleIdle,
} from './existingItemsScheduler';

/** processListItems per-card 同步段分块大小（S1-2a，与 S1-1b 冷启动 enhance 分块同值）。 */
const LIST_PROCESS_CHUNK_SIZE = DEFAULT_EXISTING_ITEMS_CHUNK_SIZE;

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
                .catch((error) => log('Failed to load list record summaries:', error));
        }
        // 09-29-liststatus-recompute-fix：占位摘要在途（本批刚触发，或并发批次已触发）时不能按 'untracked' 定型。
        // 滚动补卡时 scrollPaging 的 processVisibleItems 与列表增强观察器的 processListItems 会并发：
        // 后到的一次看到 missing=0（占位已写）就会把卡片判为“未看过/未想看”并打上 data-processed，
        // 真实摘要落地后再无重算路径 ⇒ hideViewed/hideBrowsed/hideWant 对补卡批次永久漏网。
        // 因此本批等占位落地后再复处理一次（仅本批 items，不带 force，不重置内容筛选标记）。
        const pendingIds = pickPendingContentRecordIds(ids);
        if (pendingIds.length > 0) {
            void waitForContentRecordSummaries(pendingIds)
                .catch((error) => log('Failed to await list record summaries:', error))
                .finally(() => processListItems(items, options, true));
            return;
        }
    }

    const resourceTagsEnabled = (STATE.settings as any)?.listEnhancement?.resourceTags === true;

    // S1-2a：per-card 同步段分块。processItem 每张卡约 30 次 DOM 读写（清旧标签/状态标签/
    // 快捷操作/库徽章/VR 检测/显隐重算），24 张同步循环在 16 tab 争用下被拉伸成 0.3-2.4s
    // 长帧（s6 实测）。首块同步保持确定性，后续块 rIC(500ms 兜底)让出主线程。
    // emby 实时检查走 Set+600ms debounce 队列、资源标签索引按批读，逐块增量提交语义不变。
    let chunkIndex = 0;
    const processChunk = (): void => {
        const end = Math.min(chunkIndex + LIST_PROCESS_CHUNK_SIZE, itemsToProcess.length);
        const chunkItems = itemsToProcess.slice(chunkIndex, end);
        chunkIndex = end;

        const visibleCodes: string[] = [];
        chunkItems.forEach((item) => {
            const videoId = processItem(item);
            if (videoId && item.style.display !== 'none') {
                visibleCodes.push(videoId);
            }
        });

        embyLibraryRealtimeCheckQueue.enqueue(
            visibleCodes,
            buildRealtimeCheckConfig(STATE.settings),
        );

        void renderResourceTagsForItems(
            chunkItems.map((item) => ({
                item,
                videoId: item.querySelector<HTMLElement>(SELECTORS.VIDEO_ID)?.textContent?.trim() || '',
            })).filter(({ videoId }) => Boolean(videoId)),
            resourceTagsEnabled,
        ).catch((error) => log('Failed to render list resource tags:', error));

        if (chunkIndex < itemsToProcess.length) {
            defaultScheduleIdle(processChunk);
        }
    };

    processChunk();
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

/** 当前是否处于“想看/已看”聚合页（这些页面不应用任何隐藏，含类别黑名单）。 */
function isStatusHiddenPage(): boolean {
    try {
        return isStatusAggregatePage(window.location.pathname);
    } catch {
        return false;
    }
}

/**
 * 返回该影片记录对应隐藏来源（viewed/browsed/want）。
 * 仅根据记录状态判断“来源”，是否真正隐藏由对应开关决定（见 recomputeListHiding）。
 */
function getStatusHideSource(videoId: string): 'viewed' | 'browsed' | 'want' | null {
    if (!STATE.settings || isStatusHiddenPage()) {
        return null;
    }
    const record = getContentRecord(videoId);
    if (!record) {
        return null;
    }
    if (record.status === VIDEO_STATUS.VIEWED) return 'viewed';
    if (record.status === VIDEO_STATUS.BROWSED) return 'browsed';
    if (record.status === VIDEO_STATUS.WANT) return 'want';
    return null;
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

    if (isEmbyLibraryEnabled((STATE.settings as any)?.emby) || aggregateEmbyEnabled) {
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

    // 记录隐藏“来源”标记（来源 ≠ 开关）。
    // 是否真正隐藏由 recomputeListHiding 依据当前开关统一裁定，
    // 这样每个隐藏动作都有独立开关，且开关切换可即时生效。
    // 搜索页豁免=产品预期（2026-09-27 用户裁决）：搜索时用户可能正是想找已看/已浏览的番，
    // 不在搜索页打状态/VR 来源标记（演员过滤无此门控，搜索页同样生效）。
    if (!STATE.isSearchPage) {
        if (finalIsVR) {
            setHidingSource(item, 'vr', true);
            log(`Marked VR video: ${videoId}`);
        }
        const statusSource = getStatusHideSource(videoId);
        if (statusSource) {
            setHidingSource(item, statusSource, true);
            log(`Marked status source ${statusSource} for: ${videoId}`);
        }
        // 09-30-media-library-hide-filter：媒体库来源同步侧（Emby/JF 索引内存判定；
        // 两开关全关时内部直接返回，零成本；搜索页/聚合页豁免在函数内复核）
        markMediaLibraryHiding(item, videoId, STATE.settings);
    }

    // 依据开关统一重算显隐（整合 VR / 状态 / 演员 所有来源）。
    // 聚合页（想看/已看列表）豁免：强制显示，不应用任何内置隐藏。
    const enablement = readListHidingEnablement(STATE.settings);
    if (isStatusHiddenPage()) {
        item.style.display = '';
    } else {
        recomputeListHiding(item, enablement);
    }

    // 09-30-media-library-hide-filter：115 网盘索引异步侧——resolve 后打标记 + 重算，
    // 不阻塞首屏；hideInMediaLibrary 关闭时内部直接返回（无 storage 读）。
    void markDrive115LibraryHiding(item, videoId, STATE.settings);

    return videoId;
}

function addTag(container: HTMLElement, text: string, style: string): void {
    const tag = document.createElement('span');
    tag.className = `tag ${style} is-light custom-status-tag`;
    tag.textContent = text;
    container.appendChild(tag);
}
