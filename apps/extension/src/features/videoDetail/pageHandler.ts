/**
 * @file pageHandler.ts
 * @description pageHandler
 * @module features/videoDetail
 */
import { VIDEO_STATUS } from '../../utils/config';
import { safeUpdateStatus } from '../videoStatus';
import type { VideoRecord } from '../../types';
import { STATE, SELECTORS, log, setSuspendEarlyFaviconSync } from '../contentState';
import { extractVideoIdFromPage } from '../../platform/browser';
import { concurrencyManager, storageManager } from '../records/content';
import { showToast } from '../../platform/browser/toast';
import { waitForElement } from '../../platform/browser/domUtils';
import {
    CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS,
    createTaskTimeoutGuard,
    createManagedTaskDescriptor,
    runChunkedWork,
    runManagedTask,
    saveSubtaskDetail,
    startContentPerformanceSpan,
    yieldToMainThread,
} from '../../platform/tasks';
import { updateFaviconForStatus } from '../videoStatus';
import { initOrchestrator } from '../../apps/content/orchestrator';
import { showEnhancementLoading } from '../../platform/browser/enhancementLoadingIndicator';
import { renderDetailSearchLinks } from '../externalSearch';
import { renderDetailLibraryStatus } from '../embyLibrary/content/statusBadges';
import { ensureDetailEnhancementPanel } from '../detailEnhancementPanel';

import type { InitPhase } from '../../apps/content/orchestrator';
import type { GlobalTaskVisibilityPolicy } from '../../shared/taskCenterTypes';
import { actorManager } from '../actors';
import { newWorksManager } from '../newWorks';
import { actorExtraInfoService } from '../actorRemarks';
import { videoDetailEnhancer } from './enhancer';
import { videoFavoriteRatingEnhancer } from './favoriteRating';
import { localListInSourceModalEnhancer } from './localListInSourceModal';
import { isRelevantStatusMutation, resolveLibraryStatusFromPageStatus } from './statusSyncPolicy';
import {
    getAutomaticHeavyTaskVisibilityPolicy,
    normalizeVideoEnhancementSchedulingMode,
} from './schedulingMode';

function getActorRemarksTaskTimeoutMs(settings: any): number {
    const seconds = Number(settings?.videoEnhancement?.actorRemarksTaskTimeoutSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return 12000;
    return Math.max(1000, Math.round(seconds * 1000));
}

function getEnhancedDataTaskTimeoutMs(settings: any): number {
    // BlogJav may use an 8s request, one 1s backoff, then one retry.
    return settings?.dataEnhancement?.enableMultiSource === true ? 18000 : 10000;
}

function getActorRemarksPerActorTimeoutMs(taskTimeoutMs: number, actorCount: number): number {
    const safeActorCount = Math.max(1, actorCount || 1);
    const budgetByCount = Math.floor(taskTimeoutMs / safeActorCount);
    return Math.max(2500, Math.min(4500, budgetByCount));
}

// 全局变量：状态监听器
let statusObserver: MutationObserver | null = null;
let lastDetectedStatus: typeof VIDEO_STATUS[keyof typeof VIDEO_STATUS] | null = null;
let statusCheckTimer: number | null = null;
let statusCheckAllowsExplicitClear = false;
let statusClickContainer: Element | null = null;
let statusClickListener: ((event: Event) => void) | null = null;
const WANT_SYNC_BOUND_ATTR = 'data-jdb-want-sync-bound';
const WANT_SYNC_CONFIRM_DELAYS_MS = [800, 1600, 3000] as const;

function isWantSyncEnabled(): boolean {
    return STATE.settings?.videoEnhancement?.enableWantSync !== false;
}

function isPageConfirmedWantStatus(): boolean {
    return detectPageUserStatus() === VIDEO_STATUS.WANT;
}

function scheduleStatusCheck(videoId: string, delayMs = 500, allowExplicitClear = false): void {
    if (statusCheckTimer !== null) {
        window.clearTimeout(statusCheckTimer);
    }

    statusCheckAllowsExplicitClear = statusCheckAllowsExplicitClear || allowExplicitClear;

    statusCheckTimer = window.setTimeout(() => {
        statusCheckTimer = null;
        const canClear = statusCheckAllowsExplicitClear;
        statusCheckAllowsExplicitClear = false;
        void checkAndUpdateStatusIfChanged(videoId, canClear);
    }, delayMs);
}

// 识别当前详情页中用户对该影片的账号状态（我看過/我想看）
// 返回 VIDEO_STATUS.VIEWED / VIDEO_STATUS.WANT / null
function detectPageUserStatus(): typeof VIDEO_STATUS[keyof typeof VIDEO_STATUS] | null {
    try {
        // 方案1：通过用户区块的链接快速判断
        const watchedAnchor = document.querySelector<HTMLAnchorElement>(
            '.review-title a[href="/users/watched_videos"], .review-title a[href*="/users/watched_videos"]'
        );
        if (watchedAnchor) {
            // 文本或内部tag文本包含“我看過這部影片”
            const text = watchedAnchor.textContent?.trim() || '';
            const tagText = watchedAnchor.querySelector('span.tag')?.textContent?.trim() || '';
            if (text.includes('我看過這部影片') || tagText.includes('我看過這部影片')) {
                return VIDEO_STATUS.VIEWED;
            }

        }

        const wantAnchor = document.querySelector<HTMLAnchorElement>(
            '.review-title a[href="/users/want_watch_videos"], .review-title a[href*="/users/want_watch_videos"]'
        );
        if (wantAnchor) {
            const text = wantAnchor.textContent?.trim() || '';
            const tagText = wantAnchor.querySelector('span.tag')?.textContent?.trim() || '';
            if (text.includes('我想看這部影片') || tagText.includes('我想看這部影片')) {
                return VIDEO_STATUS.WANT;
            }
        }

        // 方案2：全局搜寻 tag 文本（结构变动时兜底）
        const tagSpans = Array.from(document.querySelectorAll<HTMLSpanElement>('span.tag'));
        if (tagSpans.some(s => (s.textContent || '').includes('我看過這部影片'))) {
            return VIDEO_STATUS.VIEWED;
        }
        if (tagSpans.some(s => (s.textContent || '').includes('我想看這部影片'))) {
            return VIDEO_STATUS.WANT;
        }
    } catch {
        // 忽略识别错误，返回 null
    }
    return null;
}

/**
 * 设置状态变化监听器
 * 监听页面上"看过"/"想看"按钮的变化，自动更新插件状态
 */
function setupStatusChangeObserver(videoId: string): void {
    try {
        cleanupStatusObserver();

        // 初始化最后检测的状态
        lastDetectedStatus = detectPageUserStatus();
        log(`[StatusObserver] Initial status: ${lastDetectedStatus || 'null'}`);

        // Only observe the small source-page status control. Observing the
        // whole detail panel made unrelated enhancement DOM work look like a
        // status update and repeatedly scanned the page while it was loading.
        const statusControls = document.querySelector('.review-buttons, .review-title, #edit_review');
        if (!statusControls) {
            log('[StatusObserver] Review container not found, skipping observer setup');
            return;
        }

        statusClickContainer = statusControls;
        statusClickListener = (event: Event) => {
            const target = event.target as Element | null;
            if (!target) {
                return;
            }

            const actionElement = target.closest(
                'a[data-method="delete"], form[action*="/reviews/want_to_watch"] button, #review-watched, .modal-button'
            );

            if (!actionElement) {
                return;
            }

            const isExplicitClear = actionElement.matches('a[data-method="delete"]');
            scheduleStatusCheck(videoId, 1600, isExplicitClear);
        };
        statusControls.addEventListener('click', statusClickListener, true);

        // Restrict mutation handling to the status control itself. Actor
        // badges, search links and detail panels must not trigger status work.
        statusObserver = new MutationObserver((mutations) => {
            if (mutations.some((mutation) => isRelevantStatusMutation(mutation.target, statusControls))) {
                scheduleStatusCheck(videoId, 500);
            }
        });

        statusObserver.observe(statusControls, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: false,
        });

        log('[StatusObserver] Status change observer setup complete');
    } catch (error) {
        log('[StatusObserver] Failed to setup observer:', error);
    }
}

/**
 * 检查状态是否变化，如果变化则更新
 */
async function checkAndUpdateStatusIfChanged(videoId: string, allowExplicitClear = false): Promise<void> {
    try {
        const currentStatus = detectPageUserStatus();

        // 如果状态没有变化，不做任何操作
        if (currentStatus === lastDetectedStatus) {
            return;
        }

        log(`[StatusObserver] Status changed from ${lastDetectedStatus || 'null'} to ${currentStatus || 'null'}`);
        lastDetectedStatus = currentStatus;

        const existing = STATE.records[videoId];
        if (!existing) {
            if (currentStatus === VIDEO_STATUS.WANT && isWantSyncEnabled()) {
                await upsertWantStatus(videoId);
            }
            return;
        }

        const nextLibraryStatus = resolveLibraryStatusFromPageStatus(
            existing.status,
            currentStatus,
            allowExplicitClear,
        );
        if (nextLibraryStatus) {
            if (existing.status === nextLibraryStatus) {
                return;
            }
            await updateVideoStatus(videoId, nextLibraryStatus);
        }
    } catch (error) {
        log('[StatusObserver] Error checking status change:', error);
    }
}

/**
 * 更新视频状态到数据库
 */
async function updateVideoStatus(
    videoId: string,
    newStatus: typeof VIDEO_STATUS[keyof typeof VIDEO_STATUS]
): Promise<void> {
    const opId = await concurrencyManager.startProcessingVideo(`${videoId}-status-update`);
    if (!opId) {
        log('[StatusObserver] Another operation in progress, skipping status update');
        return;
    }

    try {
        const descriptor = createManagedTaskDescriptor({
            label: 'videoStatus:update',
            phase: 'high',
            priority: 9,
            cost: 'light',
            visibilityPolicy: 'foreground_first',
            timeoutMs: 5000,
            retryLimit: 2,
            resumePolicy: 'restart',
        });
        await runManagedTask(descriptor, async () => {
        const now = Date.now();
        const existing = STATE.records[videoId];

        if (existing) {
            // 更新现有记录
            const result = await storageManager.updateRecord(
                videoId,
                (current) => {
                    const cur = current[videoId];
                    if (!cur) {
                        throw new Error(`Record ${videoId} not found`);
                    }
                    const updated = { ...cur } as VideoRecord;
                    // 保留主升级策略；仅当显式要求回落到已浏览时执行回落
                    updated.status = newStatus === VIDEO_STATUS.BROWSED
                        ? VIDEO_STATUS.BROWSED as any
                        : safeUpdateStatus(cur.status, newStatus);
                    updated.updatedAt = now;
                    return updated;
                },
                opId
            );

            if (result.success) {
                log(`[StatusObserver] Status updated to ${newStatus} for ${videoId}`);
                updateFaviconForStatus(newStatus);

                // 显示状态名称
                const statusName = newStatus === VIDEO_STATUS.VIEWED ? '已观看' :
                                 newStatus === VIDEO_STATUS.WANT ? '我想看' : '已浏览';
                showToast(`状态已自动更新为「${statusName}」`, 'success');
            } else {
                log(`[StatusObserver] Failed to update status: ${result.error}`);
            }
        } else {
            log('[StatusObserver] No existing record found, status update skipped');
        }
        });
    } catch (error) {
        log('[StatusObserver] Error updating status:', error);
    } finally {
        concurrencyManager.finishProcessingVideo(`${videoId}-status-update`, opId);
    }
}

/**
 * 清理状态监听器
 */
function cleanupStatusObserver(): void {
    if (statusCheckTimer !== null) {
        window.clearTimeout(statusCheckTimer);
        statusCheckTimer = null;
    }

    if (statusObserver) {
        statusObserver.disconnect();
        statusObserver = null;
    }
    if (statusClickContainer && statusClickListener) {
        statusClickContainer.removeEventListener('click', statusClickListener, true);
    }
    statusClickContainer = null;
    statusClickListener = null;
    statusCheckAllowsExplicitClear = false;
    log('[StatusObserver] Observer cleaned up');
}

/**
 * 导出清理函数供外部调用
 */
export function cleanupVideoDetailObservers(): void {
    cleanupStatusObserver();
}

// --- Page-Specific Logic ---

/**
 * 检查页面是否正常加载（通过navbar-item元素检测）
 * 如果页面被安全拦截或请求频繁，navbar-item元素可能不存在
 * 这是防止在异常页面状态下进行数据回写的安全措施
 */
export function isPageProperlyLoaded(): boolean {
    try {
        // 优先检查JavDB品牌logo - 这是最可靠的页面正常加载标志
        const javdbLogoSelectors = [
            'a.navbar-item[href="https://javdb.com"] svg',  // JavDB logo SVG
            'a.navbar-item[href*="javdb.com"] svg',         // 包含javdb.com的logo
            '.navbar-item svg[viewBox="0 0 326 111"]',      // 特定viewBox的JavDB SVG
        ];

        for (const selector of javdbLogoSelectors) {
            const logoElements = document.querySelectorAll(selector);
            if (logoElements.length > 0) {
                log(`Page properly loaded - found JavDB logo with selector: ${selector}`);
                return true;
            }
        }

        // 备用检查：通用导航栏元素
        const fallbackSelectors = [
            '.navbar-item',           // 标准导航项
            '.navbar .navbar-item',   // 嵌套在navbar中的导航项
            'nav .navbar-item',       // 在nav标签中的导航项
            '.navbar-brand',          // 导航栏品牌区域
            '.navbar-menu',           // 导航栏菜单
        ];

        for (const selector of fallbackSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                log(`Page properly loaded - found ${elements.length} elements with fallback selector: ${selector}`);
                return true;
            }
        }

        // 如果没有找到导航栏元素，可能页面被拦截或加载异常
        log('Page may be blocked or loading failed - no JavDB logo or navbar elements found');
        return false;
    } catch (error) {
        log('Error checking page load status:', error);
        return false;
    }
}

type VideoDetailTaskBlueprint = {
    phase: InitPhase;
    label: string;
    priority?: number;
    timeout?: number;
    visibilityPolicy?: GlobalTaskVisibilityPolicy;
    dependsOn?: string[];
};

export function getVideoDetailTaskBlueprints(settings: any): VideoDetailTaskBlueprint[] {
    const blueprints: VideoDetailTaskBlueprint[] = [];
    const enableVideoEnhancement = settings?.videoEnhancement?.enabled === true;
    const enableMultiSource = settings?.dataEnhancement?.enableMultiSource;
    const enableTranslation = settings?.dataEnhancement?.enableTranslation;
    const enableCurrentTitleTranslation = enableTranslation && (settings?.translation?.targets ? settings.translation.targets.currentTitle !== false : true);
    const enableActorNameMarks = (settings as any)?.videoEnhancement?.enableActorNameMarks !== false;
    const enableRelatedLists = enableVideoEnhancement && (settings as any)?.videoEnhancement?.enableRelatedLists !== false;
    const enableLocalListInSourceModal = enableVideoEnhancement && (settings as any)?.videoEnhancement?.enableLocalListInSourceModal !== false;
    const actorRemarksTaskTimeoutMs = getActorRemarksTaskTimeoutMs(settings as any);
    const schedulingMode = normalizeVideoEnhancementSchedulingMode(
        settings?.videoEnhancement?.schedulingMode,
    );
    const heavyTaskVisibilityPolicy = getAutomaticHeavyTaskVisibilityPolicy(schedulingMode);

    log('[VideoDetailBlueprints] gates', {
        enableVideoEnhancement,
        enableMultiSource,
        enableTranslation,
        enableCurrentTitleTranslation,
        translationTargets: settings?.translation?.targets,
        enableActorNameMarks,
        enableActorRemarks: (settings as any)?.videoEnhancement?.enableActorRemarks === true,
        enableRelatedLists,
        enableLocalListInSourceModal,
    });

    blueprints.push({ phase: 'critical', label: 'videoStatus:initialSync', priority: 12, visibilityPolicy: 'background_allowed' });
    if (enableVideoEnhancement || enableMultiSource || enableCurrentTitleTranslation) {
        // clickEnhancement 无独立 managed 执行路径，不预注册虚假 label
        blueprints.push(
            { phase: 'high', label: 'videoEnhancement:initCore', priority: 8, visibilityPolicy: 'background_allowed', dependsOn: ['videoStatus:initialSync'] },
            { phase: 'deferred', label: 'videoEnhancement:loadData', timeout: getEnhancedDataTaskTimeoutMs(settings), dependsOn: ['videoStatus:initialSync'] },
            { phase: 'idle', label: 'videoEnhancement:runCover', dependsOn: ['videoStatus:initialSync'] },
            { phase: 'idle', label: 'videoEnhancement:runTitle', dependsOn: ['videoStatus:initialSync'] },
            { phase: 'idle', label: 'videoEnhancement:runFC2Breaker', dependsOn: ['videoStatus:initialSync'] },
            { phase: 'high', label: 'videoEnhancement:finish', priority: 8, visibilityPolicy: 'background_allowed', dependsOn: ['videoEnhancement:loadData'] },
        );
    }

    if (enableCurrentTitleTranslation) {
        blueprints.push({ phase: 'deferred', label: 'videoEnhancement:titleTranslateBtn', timeout: 5000, dependsOn: ['videoStatus:initialSync'] });
    }

    if (enableVideoEnhancement && (settings as any)?.videoEnhancement?.enableActorRemarks === true) {
        blueprints.push({ phase: 'idle', label: 'actorRemarks:run', timeout: actorRemarksTaskTimeoutMs, dependsOn: ['videoStatus:initialSync'] });
    }

    if (enableVideoEnhancement && (settings as any)?.videoEnhancement?.enableReviewBreaker === true) {
        blueprints.push({ phase: 'idle', label: 'videoEnhancement:runReviewBreaker', dependsOn: ['videoStatus:initialSync'] });
    }

    if (enableRelatedLists) {
        blueprints.push({ phase: 'idle', label: 'videoEnhancement:runRelatedLists', dependsOn: ['videoStatus:initialSync', 'videoEnhancement:initCore'] });
    }

    if (enableVideoEnhancement && (settings as any)?.videoEnhancement?.enableVideoFavoriteRating === true) {
        blueprints.push({ phase: 'high', label: 'videoFavoriteRating:init', priority: 4, visibilityPolicy: heavyTaskVisibilityPolicy, dependsOn: ['videoStatus:initialSync'] });
    }

    if (enableLocalListInSourceModal) {
        blueprints.push({ phase: 'idle', label: 'localListInSourceModal:init', dependsOn: ['videoStatus:initialSync'] });
    }

    if (enableActorNameMarks) {
        blueprints.push({ phase: 'idle', label: 'actorMarks:page', visibilityPolicy: heavyTaskVisibilityPolicy, dependsOn: ['videoStatus:initialSync'] });
    }

    return blueprints;
}

async function syncVideoStatusPersistCore(
    videoId: string,
    record: VideoRecord | undefined,
    now: number,
    currentUrl: string,
    operationId: string
): Promise<VideoRecord | undefined> {
    const endDiagnosticSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoStatusInitialSyncPersist);
    try {
        if (record) {
            await handleExistingRecord(videoId, record, now, currentUrl, operationId, { light: true });
            return record;
        }
        return await handleNewRecord(videoId, now, currentUrl);
    } finally {
        endDiagnosticSpan();
    }
}

async function syncVideoStatusFinalize(
    videoId: string,
    record: VideoRecord | undefined,
    now: number,
    currentUrl: string,
    operationId: string
): Promise<VideoRecord | undefined> {
    const endDiagnosticSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoStatusInitialSyncFinalize);
    try {
        const currentRecord = record || STATE.records[videoId];
        const pageDetectedStatus = detectPageUserStatus();
        const finalStatus = pageDetectedStatus || currentRecord?.status || null;

        if (currentRecord) {
            const desiredStatus = resolveLibraryStatusFromPageStatus(currentRecord.status, pageDetectedStatus);
            if (desiredStatus && desiredStatus !== currentRecord.status) {
                try {
                    const result = await storageManager.updateRecordDirect(
                        videoId,
                        (latestRecord) => {
                            const sourceRecord = latestRecord || currentRecord;
                            return {
                                ...sourceRecord,
                                status: desiredStatus,
                                updatedAt: now,
                                javdbUrl: currentUrl,
                            };
                        },
                        operationId,
                        { backupToStorage: false, verifyAfterWrite: true }
                    );
                    if (result.success && result.record) {
                        Object.assign(currentRecord, result.record);
                    }
                } catch (error) {
                    log(`syncVideoStatusFinalize update failed for ${videoId}:`, error);
                }
            } else {
                currentRecord.javdbUrl = currentUrl;
            }
        }

        updateFaviconForStatus(finalStatus);
        setSuspendEarlyFaviconSync(false);
        return currentRecord;
    } finally {
        endDiagnosticSpan();
    }
}

async function syncVideoStatusFullRefresh(
    videoId: string,
    record: VideoRecord | undefined,
    now: number,
    currentUrl: string,
    operationId: string
): Promise<VideoRecord | undefined> {
    const currentRecord = record || STATE.records[videoId];
    if (!currentRecord) {
        return undefined;
    }

    const extractedData = await extractVideoData(videoId, { light: false });
    if (!extractedData) {
        return currentRecord;
    }

    const pageDetectedStatus = detectPageUserStatus();
    const desiredStatus = resolveLibraryStatusFromPageStatus(currentRecord.status, pageDetectedStatus);
    const nextStatus = desiredStatus || currentRecord.status;
    const mergedRecord = {
        ...currentRecord,
        ...extractedData,
        status: nextStatus,
        updatedAt: now,
        javdbUrl: currentUrl,
    };

    const changedKeys = Object.keys(mergedRecord).filter((key) => {
        const typedKey = key as keyof typeof mergedRecord;
        return mergedRecord[typedKey] !== currentRecord[typedKey];
    });

    if (changedKeys.length === 0) {
        return currentRecord;
    }

    const result = await storageManager.putRecord(
        mergedRecord,
        operationId,
        {
            backupToStorage: false,
            verifyAfterWrite: true,
            // IndexedDB messages cannot be canceled safely. Keep the same
            // refresh operation exclusive until its database write returns.
            dbTimeoutBehavior: 'diagnostic',
        }
    );

    if (!result.success) {
        throw new Error(result.error || `Failed to refresh record ${videoId}`);
    }

    Object.assign(currentRecord, STATE.records[videoId] || mergedRecord);
    log(`[videoStatus:fullRefresh] Refreshed ${videoId} fields:`, changedKeys);
    return currentRecord;
}

export async function handleVideoDetailPage(): Promise<void> {
    // 首先检查页面是否正常加载
    if (!isPageProperlyLoaded()) {
        log('Page not properly loaded (no navbar-item found), skipping video detail processing to avoid data corruption');
        return;
    }

    // 静默分析视频详情页
    log('Page properly loaded, proceeding with video detail processing');

    const videoId = extractVideoIdFromPage();
    if (!videoId) {
        log('Could not find video ID using any method. Aborting.');
        return;
    }

    const endPreLeaseSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoDetailPreLease);
    try {
        const endLibraryStatusSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoDetailLibraryStatus);
        try {
            renderDetailLibraryStatus(videoId);
        } catch (e) {
            log('renderDetailLibraryStatus failed:', e as any);
        } finally {
            endLibraryStatusSpan();
        }

        const endSearchLinksSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoDetailSearchLinks);
        try {
            const videoEnhancement = (STATE.settings as any)?.videoEnhancement || {};
            renderDetailSearchLinks(videoId, STATE.settings?.searchEngines || [], {
                enabled: videoEnhancement.enableExternalEntryPanel !== false,
                showExternalSearch: videoEnhancement.enableExternalSearch !== false,
                showSubtitleSearch: videoEnhancement.enableSubtitleSearch !== false,
            });
        } catch (e) {
            log('renderDetailSearchLinks failed:', e as any);
        } finally {
            endSearchLinksSpan();
        }
    } finally {
        endPreLeaseSpan();
    }

    setSuspendEarlyFaviconSync(true);

    // 并发控制：检查是否已经在处理这个视频
    const endAcquireOperationSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoDetailAcquireOperation);
    const operationId = await concurrencyManager.startProcessingVideo(videoId);
    endAcquireOperationSpan();
    if (!operationId) {
        return;
    }

    try {
        const shouldShowIndicator = (STATE.settings as any)?.videoEnhancement?.showLoadingIndicator !== false;
        if (shouldShowIndicator) {
            showEnhancementLoading('video');
        }
    } catch {}

    try {
        const record = STATE.records[videoId];
        const now = Date.now();
        const currentUrl = window.location.href;

        let currentRecord: VideoRecord | undefined = record;
        try {
            currentRecord = await new Promise<VideoRecord | undefined>((resolve) => {
                initOrchestrator.add('critical', async () => {
                    const persistStartedAt = Date.now();
                    const nextRecord = await syncVideoStatusPersistCore(videoId, currentRecord, now, currentUrl, operationId);
                    await saveSubtaskDetail({
                        label: 'videoStatus:initialSync:persist',
                        parentLabel: 'videoStatus:initialSync',
                        subtaskLabel: 'persist',
                        phase: 'critical',
                        status: 'done',
                        pageUrl: currentUrl,
                        durationMs: Math.max(0, Date.now() - persistStartedAt),
                        registrationSource: 'blueprint',
                    });

                    const finalizeStartedAt = Date.now();
                    const finalizedRecord = await syncVideoStatusFinalize(videoId, nextRecord, now, currentUrl, operationId);
                    await saveSubtaskDetail({
                        label: 'videoStatus:initialSync:finalize',
                        parentLabel: 'videoStatus:initialSync',
                        subtaskLabel: 'finalize',
                        phase: 'critical',
                        status: 'done',
                        pageUrl: currentUrl,
                        durationMs: Math.max(0, Date.now() - finalizeStartedAt),
                        registrationSource: 'blueprint',
                    });

                    resolve(finalizedRecord);
                }, { label: 'videoStatus:initialSync', delayMs: 0, priority: 12, visibilityPolicy: 'background_allowed' });
            });
        } catch (e) {
            log('videoStatus:initialSync scheduling failed:', e as any);
            currentRecord = await syncVideoStatusPersistCore(videoId, currentRecord, now, currentUrl, operationId);
            currentRecord = await syncVideoStatusFinalize(videoId, currentRecord, now, currentUrl, operationId);
        }

        try {
            initOrchestrator.add('deferred', async () => {
                await syncVideoStatusFullRefresh(videoId, currentRecord, now, currentUrl, operationId);
            }, {
                label: 'videoStatus:fullRefresh',
                idle: true,
                idleTimeout: 3000,
                delayMs: 1200,
                timeout: 12000,
                timeoutBehavior: 'diagnostic',
                dependsOn: ['videoStatus:initialSync'],
            });
        } catch (e) {
            log('videoStatus:fullRefresh scheduling failed:', e as any);
        }

        try {
            const schedulingMode = normalizeVideoEnhancementSchedulingMode(
                STATE.settings?.videoEnhancement?.schedulingMode,
            );
            const heavyTaskVisibilityPolicy = getAutomaticHeavyTaskVisibilityPolicy(schedulingMode);
            log('[VideoDetail] scheduling enhancement tasks', {
                schedulingMode,
                enableCurrentTitleTranslation: STATE.settings?.dataEnhancement?.enableTranslation && (STATE.settings?.translation?.targets ? STATE.settings.translation.targets.currentTitle !== false : true),
                enableActorNameMarks: (STATE.settings as any)?.videoEnhancement?.enableActorNameMarks !== false,
                enableActorRemarks: (STATE.settings as any)?.videoEnhancement?.enableActorRemarks === true,
                enableReviewBreaker: (STATE.settings as any)?.videoEnhancement?.enableReviewBreaker === true,
                enableRelatedLists: (STATE.settings as any)?.videoEnhancement?.enabled === true
                    && (STATE.settings as any)?.videoEnhancement?.enableRelatedLists !== false,
                enableVideoFavoriteRating: (STATE.settings as any)?.videoEnhancement?.enableVideoFavoriteRating === true,
                enableLocalListInSourceModal: (STATE.settings as any)?.videoEnhancement?.enabled === true
                    && (STATE.settings as any)?.videoEnhancement?.enableLocalListInSourceModal !== false,
            });

            initOrchestrator.add('high', async () => {
                await videoDetailEnhancer.initCore();
            }, {
                label: 'videoEnhancement:initCore',
                priority: 8,
                visibilityPolicy: 'background_allowed',
                dependsOn: ['videoStatus:initialSync'],
                delayMs: 50,
            });

            initOrchestrator.add('deferred', async () => {
                await videoDetailEnhancer.loadEnhancedData();
            }, {
                label: 'videoEnhancement:loadData',
                timeout: getEnhancedDataTaskTimeoutMs(STATE.settings),
                dependsOn: ['videoStatus:initialSync'],
            });

            if (STATE.settings?.dataEnhancement?.enableTranslation && (STATE.settings?.translation?.targets ? STATE.settings.translation.targets.currentTitle !== false : true)) {
                initOrchestrator.add('deferred', async () => {
                    await videoDetailEnhancer.insertTranslationPlaceholder();
                }, {
                    label: 'videoEnhancement:titleTranslateBtn',
                    timeout: 5000,
                    dependsOn: ['videoStatus:initialSync'],
                });
            }

            initOrchestrator.add('idle', async () => {
                await videoDetailEnhancer.runCover();
            }, {
                label: 'videoEnhancement:runCover',
                idle: true,
                idleTimeout: 5000,
                dependsOn: ['videoStatus:initialSync'],
            });

            initOrchestrator.add('idle', async () => {
                await videoDetailEnhancer.runTitle();
            }, {
                label: 'videoEnhancement:runTitle',
                idle: true,
                idleTimeout: 5000,
                dependsOn: ['videoStatus:initialSync'],
            });

            initOrchestrator.add('idle', async () => {
                await videoDetailEnhancer.runFC2Breaker();
            }, {
                label: 'videoEnhancement:runFC2Breaker',
                idle: true,
                idleTimeout: 5000,
                dependsOn: ['videoStatus:initialSync'],
            });

            initOrchestrator.add('high', () => {
                videoDetailEnhancer.finish();
            }, {
                label: 'videoEnhancement:finish',
                priority: 8,
                visibilityPolicy: 'background_allowed',
                dependsOn: ['videoEnhancement:loadData'],
            });

            if ((STATE.settings as any)?.videoEnhancement?.enableReviewBreaker === true) {
                initOrchestrator.add('idle', async () => {
                    await videoDetailEnhancer.runReviewBreaker();
                }, {
                    label: 'videoEnhancement:runReviewBreaker',
                    idle: true,
                    idleTimeout: 5000,
                    dependsOn: ['videoStatus:initialSync'],
                });
            }

            if ((STATE.settings as any)?.videoEnhancement?.enabled === true && (STATE.settings as any)?.videoEnhancement?.enableRelatedLists !== false) {
                initOrchestrator.add('idle', async () => {
                    await videoDetailEnhancer.runRelatedLists();
                }, {
                    label: 'videoEnhancement:runRelatedLists',
                    idle: true,
                    idleTimeout: 5000,
                    dependsOn: ['videoStatus:initialSync', 'videoEnhancement:initCore'],
                });
            }

            if ((STATE.settings as any)?.videoEnhancement?.enableActorRemarks === true) {
                initOrchestrator.add('idle', async () => {
                    await runActorRemarksQuick();
                }, {
                    label: 'actorRemarks:run',
                    idle: true,
                    idleTimeout: 5000,
                    timeout: getActorRemarksTaskTimeoutMs(STATE.settings as any),
                    dependsOn: ['videoStatus:initialSync'],
                });
            }

            if ((STATE.settings as any)?.videoEnhancement?.enableActorNameMarks !== false) {
                scheduleMarkActorsOnPage(0, heavyTaskVisibilityPolicy);
            }

            if ((STATE.settings as any)?.videoEnhancement?.enableVideoFavoriteRating === true) {
                initOrchestrator.add('high', async () => {
                    await videoFavoriteRatingEnhancer.init();
                }, {
                    label: 'videoFavoriteRating:init',
                    priority: 4,
                    visibilityPolicy: heavyTaskVisibilityPolicy,
                    dependsOn: ['videoStatus:initialSync'],
                    delayMs: 80,
                });
            }

            if ((STATE.settings as any)?.videoEnhancement?.enabled === true
                && (STATE.settings as any)?.videoEnhancement?.enableLocalListInSourceModal !== false) {
                initOrchestrator.add('idle', async () => {
                    await localListInSourceModalEnhancer.init();
                }, {
                    label: 'localListInSourceModal:init',
                    idle: true,
                    idleTimeout: 5000,
                    dependsOn: ['videoStatus:initialSync'],
                });
            }
        } catch (e) {
            log('video enhancement scheduling failed:', e as any);
        }

        try {
            bindWantSyncOnClick(videoId);
        } catch (e) { log('bindWantSyncOnClick error:', e as any); }

        try {
            setupStatusChangeObserver(videoId);
            try {
                chrome.runtime.sendMessage({
                    type: 'orchestrator:event',
                    event: 'task:done',
                    payload: {
                        phase: 'high',
                        label: 'videoStatus:observer',
                        ts: performance.now(),
                        relativeTs: 0,
                        durationMs: 1,
                    },
                    pageUrl: window.location.href,
                });
            } catch {}
        } catch (e) { log('setupStatusChangeObserver error:', e as any); }
    } catch (error) {
        log(`Error processing video ${videoId}:`, error);
        showToast(`处理失败: ${videoId}`, 'error');
    } finally {
        concurrencyManager.finishProcessingVideo(videoId, operationId);
    }
}

// 在影片详情页对“演員/演员”区域内的演员链接进行标识：
// - 若为已收藏（存在于本地演员库）则标记为绿色
// - 若为黑名单（blacklisted = true）则标记为红色并添加删除线
async function markActorsOnPage(): Promise<void> {
    try {
        if ((STATE.settings as any)?.videoEnhancement?.enableActorNameMarks === false) return;
        const endSetupQuerySpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.actorMarksQuery);
        let subscriptions;
        try {
            await actorManager.initialize();
            subscriptions = await newWorksManager.getSubscriptions();
        } finally {
            endSetupQuerySpan();
        }
        const subscribedActorIds = new Set(subscriptions.map(sub => sub.actorId));

        // 查找包含“演員/演员”的信息块
        const blocks = Array.from(document.querySelectorAll<HTMLElement>('.panel-block'));
        const actorBlock = blocks.find(block => {
            const strong = block.querySelector('strong');
            const text = strong?.textContent?.trim() || '';
            return text.includes('演員') || text.includes('演员');
        });

        if (!actorBlock) {
            log('No actor panel-block found on this page.');
            return;
        }

        const linkNodes = actorBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/actors/"]');
        if (!linkNodes || linkNodes.length === 0) {
            log('No actor links found in actor panel-block.');
            return;
        }

        const colorCollected = '#2e7d32'; // 绿色（已收藏）
        const colorBlacklisted = '#d32f2f'; // 红色（黑名单）
        const subscribedColor = '#f59e0b'; // 橙黄（已订阅）
        const startedAt = Date.now();
        const maxBudgetMs = 8000;

        const actorLinks = Array.from(linkNodes);
        const batchSize = 4;
        for (let i = 0; i < actorLinks.length; i += batchSize) {
            if (Date.now() - startedAt > maxBudgetMs) {
                log(`markActorsOnPage budget exceeded after ${i} actors, stopping early`);
                break;
            }
            const batch = actorLinks.slice(i, i + batchSize);
            await Promise.all(batch.map(async (a) => {
                try {
                    const href = a.getAttribute('href') || '';
                    const idPart = href.split('/actors/')[1] || '';
                    const actorId = idPart.split('?')[0].split('#')[0];
                    if (!actorId) return;

                    const isSubscribed = subscribedActorIds.has(actorId);

                    const endActorQuerySpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.actorMarksQuery);
                    let record;
                    try {
                        record = await actorManager.getActorById(actorId);
                    } finally {
                        endActorQuerySpan();
                    }

                    const endActorDomSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.actorMarksDom);
                    try {
                        a.style.color = '';
                        a.style.textDecoration = '';
                        a.removeAttribute('title');
                        a.parentElement?.querySelector(`.actor-subscribe-badge[data-actor-id="${actorId}"]`)?.remove();

                        if (!record && !isSubscribed) return;

                        if (record?.blacklisted) {
                            a.style.color = colorBlacklisted;
                            a.style.textDecoration = 'line-through';
                            a.title = '黑名单';
                        } else if (record) {
                            a.style.color = colorCollected;
                            a.style.textDecoration = 'none';
                            a.title = '已收藏';
                        }

                        if (isSubscribed) {
                            const badge = document.createElement('span');
                            badge.className = 'actor-subscribe-badge';
                            badge.dataset.actorId = actorId;
                            badge.title = '已订阅';
                            badge.setAttribute('aria-label', '已订阅');
                            badge.textContent = '🔔';
                            badge.style.color = subscribedColor;
                            badge.style.marginRight = '4px';
                            badge.style.fontSize = '0.95em';
                            badge.style.verticalAlign = 'text-top';
                            a.insertAdjacentElement('beforebegin', badge);
                        }
                    } finally {
                        endActorDomSpan();
                    }
                } catch {
                    return;
                }
            }));
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    } catch (error) {
        log('markActorsOnPage error:', error);
    }
}

export async function refreshActorMarksOnPage(): Promise<void> {
    await markActorsOnPage();
}

export function scheduleMarkActorsOnPage(
    delayMs: number = 0,
    visibilityPolicy: GlobalTaskVisibilityPolicy = 'background_allowed',
): void {
    try {
        initOrchestrator.add('idle', async () => {
            try {
                await markActorsOnPage();
            } catch (markErr) { log('Marking actors on page failed:', markErr); }
        }, { label: 'actorMarks:page', idle: true, idleTimeout: 3000, delayMs, visibilityPolicy, dependsOn: ['videoStatus:initialSync'] });
    } catch (markErr) {
        log('Marking actors scheduling failed:', markErr);
    }
}

// 轻量版“演员备注”注入（面板模式，默认关闭，通过 settings.videoEnhancement.enableActorRemarks 开启）
export async function runActorRemarksQuick(timeoutMs?: number): Promise<void> {
    try {
        const enabled = ((STATE.settings as any)?.videoEnhancement?.enableActorRemarks === true);
        if (!enabled) return;

        const taskTimeoutMs = typeof timeoutMs === 'number' && timeoutMs > 0
            ? timeoutMs
            : getActorRemarksTaskTimeoutMs(STATE.settings as any);
        const timeoutGuard = createTaskTimeoutGuard(taskTimeoutMs);
        const mode = (((STATE.settings as any)?.videoEnhancement?.actorRemarksMode) === 'inline') ? 'inline' : 'panel';

        // 影片详情页里 /actors/ 链接很多，先锁定演员区块，再读取该区块内演员链接
        const firstActorLink = await waitForElement(
            '.movie-panel-info a[href^="/actors/"]',
            timeoutGuard.timeoutMs > 0 ? Math.min(8000, timeoutGuard.timeoutMs) : 8000,
            200,
        );
        if (!firstActorLink) {
            log('actorRemarks: no actor links found (timeout)');
            return;
        }

        const actorBlock =
            Array.from(document.querySelectorAll<HTMLElement>('.movie-panel-info .panel-block'))
                .find((block) => block.querySelector('a[href^="/actors/"]'))
            || firstActorLink.closest<HTMLElement>('.panel-block')
            || (firstActorLink.parentElement as HTMLElement | null);
        if (!actorBlock) {
            log('actorRemarks: actor container not found');
            return;
        }

        const links = Array.from(actorBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/actors/"]'))
            .filter((a) => {
                const name = (a.textContent || '').trim();
                return Boolean(name) && !['有碼', '無碼', '无码', '歐美'].includes(name);
            });
        if (!links.length) {
            log('actorRemarks: no actor links found (empty)');
            return;
        }

        log('actorRemarks: start', { mode, actors: links.length });

        const buildBadgeText = (data: any): string => {
            const parts: string[] = [];
            if (typeof data?.age === 'number') parts.push(String(data.age));
            if (typeof data?.heightCm === 'number') parts.push(`${data.heightCm}cm`);
            if (data?.cup) parts.push(String(data.cup).toUpperCase());
            let txt = parts.length ? parts.join(' / ') : '';
            if (data?.retired) txt = txt ? `${txt} / 引退` : '引退';
            return txt;
        };

        const ensurePanel = (): HTMLElement => {
            let panel = document.getElementById('enhanced-actor-remarks');
            if (panel) return panel;
            panel = document.createElement('div');
            panel.id = 'enhanced-actor-remarks';
            panel.className = 'panel-block';
            panel.style.cssText = 'margin:12px 0;padding:12px;background:#fff7ed;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:8px;color:#78350f;font-size:13px;';
            const title = document.createElement('div');
            title.textContent = '演员备注';
            title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#92400e;';
            panel.appendChild(title);

            const enhancementPanel = ensureDetailEnhancementPanel();
            if (enhancementPanel) {
                enhancementPanel.appendChild(panel);
            } else {
                actorBlock.parentElement?.insertBefore(panel, actorBlock.nextSibling);
            }
            return panel;
        };

        const processed = new Set<string>();
        let renderedCount = 0;
        const renderStartedAt = Date.now();
        const renderBudgetMs = Math.max(3000, Math.min(taskTimeoutMs, 8000));
        const perActorTimeoutMs = getActorRemarksPerActorTimeoutMs(taskTimeoutMs, links.length);

        const results: Array<{ element: HTMLAnchorElement; name: string; data: any } | null> = [];
        await runChunkedWork(links, {
            batchSize: 2,
            parentLabel: 'actorRemarks:run',
            shouldStop: () => timeoutGuard.isTimedOut() || (Date.now() - renderStartedAt > renderBudgetMs),
            yieldAfterBatch: async () => {
                await yieldToMainThread(0);
            },
            onBatchComplete: async ({ batchIndex, itemCount, processed, stopped }) => {
                saveSubtaskDetail({
                    label: 'actorRemarks:run:fetch-batch',
                    parentLabel: 'actorRemarks:run',
                    subtaskLabel: 'fetch-batch',
                    batchIndex,
                    itemCount,
                    detail: `processed=${processed}, stopped=${stopped}`,
                    phase: 'idle',
                    status: 'done',
                    durationMs: 0,
                });
            },
            onItem: async (a) => {
                const name = (a.textContent || '').trim();
                if (!name || processed.has(name)) {
                    results.push(null);
                    return;
                }
                processed.add(name);
                try {
                    const remainingMs = Math.max(0, taskTimeoutMs - (Date.now() - renderStartedAt));
                    const actorTimeoutMs = Math.max(1500, Math.min(perActorTimeoutMs, remainingMs || perActorTimeoutMs));
                    const data = await Promise.race<any>([
                        actorExtraInfoService.getActorRemarks(name, STATE.settings as any),
                        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), actorTimeoutMs)),
                    ]);
                    results.push({ element: a, name, data });
                } catch (e) {
                    log('actorRemarks: fetch failed for', name, e);
                    results.push(null);
                }
            }
        });

        timeoutGuard.throwIfTimedOut();

        for (const result of results) {
            if (Date.now() - renderStartedAt > renderBudgetMs) {
                log(`actorRemarks: render budget exceeded after ${renderedCount} actors`);
                break;
            }
            if (!result) continue;

            const { element: a, name, data } = result;
            const badgeText = data ? buildBadgeText(data) : '';

            // 兜底：抓不到字段时，展示外链入口
            const wikiUrl = data?.wikiUrl || `https://ja.wikipedia.org/wiki/${encodeURIComponent(name)}`;
            const xslistUrl = (data as any)?.xslistUrl || `https://xslist.org/search?query=${encodeURIComponent(name)}&lg=zh`;

            // 详情页始终在演员名旁边给出可见反馈；panel 模式再额外渲染汇总面板
            const existing = a.nextElementSibling as HTMLElement | null;
            if (existing?.classList?.contains('jdb-actor-remarks-inline')) existing.remove();

            const wrap = document.createElement('span');
            wrap.className = 'jdb-actor-remarks-inline';
            wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:6px;vertical-align:middle;';

            if (badgeText) {
                const infoEl = document.createElement('span');
                infoEl.textContent = badgeText;
                infoEl.style.cssText = 'background:#ffedd5;color:#7c2d12;padding:1px 6px;border-radius:999px;font-size:12px;line-height:18px;';
                wrap.appendChild(infoEl);
            } else {
                const link1 = document.createElement('a');
                link1.href = wikiUrl;
                link1.target = '_blank';
                link1.textContent = 'Wiki';
                link1.style.cssText = 'color:#b45309;text-decoration:underline;font-size:12px;';
                wrap.appendChild(link1);

                const link2 = document.createElement('a');
                link2.href = xslistUrl;
                link2.target = '_blank';
                link2.textContent = 'xslist';
                link2.style.cssText = 'color:#b45309;text-decoration:underline;font-size:12px;';
                wrap.appendChild(link2);
            }

            a.insertAdjacentElement('afterend', wrap);

            if (mode === 'panel') {
                const panel = ensurePanel();

                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;flex-wrap:wrap;';
                const nameEl = document.createElement('span');
                nameEl.textContent = name;
                nameEl.style.cssText = 'font-weight:600;';
                row.appendChild(nameEl);

                if (badgeText) {
                    const infoEl = document.createElement('span');
                    infoEl.textContent = badgeText;
                    infoEl.style.cssText = 'background:#ffedd5;color:#7c2d12;padding:2px 6px;border-radius:12px;font-size:12px;';
                    row.appendChild(infoEl);
                } else {
                    const link1 = document.createElement('a');
                    link1.href = wikiUrl;
                    link1.target = '_blank';
                    link1.textContent = 'Wiki';
                    link1.style.cssText = 'margin-left:6px;color:#b45309;text-decoration:underline;';
                    row.appendChild(link1);

                    const link2 = document.createElement('a');
                    link2.href = xslistUrl;
                    link2.target = '_blank';
                    link2.textContent = 'xslist';
                    link2.style.cssText = 'margin-left:6px;color:#b45309;text-decoration:underline;';
                    row.appendChild(link2);
                }
                panel.appendChild(row);
            }

            renderedCount += 1;
        }

        if (mode === 'panel') {
            const panel = document.getElementById('enhanced-actor-remarks');
            if (panel && renderedCount === 0) {
                panel.remove();
            }
        }

        log('actorRemarks: done', { mode, rendered: renderedCount, panelPresent: Boolean(document.getElementById('enhanced-actor-remarks')), inlinePresent: Boolean(document.querySelector('.jdb-actor-remarks-inline')) });
    } catch (e) {
        log('actorRemarks: failed', e);
    }
}

// 绑定“想看”按钮点击事件：将本地番号库状态升级为 WANT（若无记录则创建）
function bindWantSyncOnClick(videoId: string): void {
    try {
        if (!isWantSyncEnabled()) return;

        // 兼容多种DOM：优先 form[data-remote][action*="/reviews/want_to_watch"]，回退到包含文本“想看”的按钮
        const wantForm = document.querySelector<HTMLFormElement>(
            'form.button_to[action*="/reviews/want_to_watch"], form[action*="/reviews/want_to_watch"]'
        );
        const wantButton = wantForm?.querySelector<HTMLElement>('button, input[type="submit"]')
            || Array.from(document.querySelectorAll<HTMLElement>('button')).find(btn => (btn.textContent || '').includes('想看'))
            || null;
        const target: Element | null = wantForm || wantButton || null;
        if (!target) return;

        if (target.getAttribute(WANT_SYNC_BOUND_ATTR) === 'true') return;
        target.setAttribute(WANT_SYNC_BOUND_ATTR, 'true');

        let lastInteractionAt = 0;
        const handler = (_e: Event) => {
            const now = Date.now();
            if (now - lastInteractionAt < 100) {
                return;
            }
            lastInteractionAt = now;
            scheduleWantSyncAfterInteraction(videoId);
        };

        if (wantForm) {
            wantForm.addEventListener('submit', handler, { capture: true });
            if (wantButton) {
                wantButton.addEventListener('click', handler, { capture: true });
            }
        } else if (wantButton) {
            wantButton.addEventListener('click', handler, { capture: true });
        }
    } catch (e) {
        log('bindWantSyncOnClick failed:', e as any);
    }
}

function scheduleWantSyncAfterInteraction(videoId: string): void {
    let completed = false;
    WANT_SYNC_CONFIRM_DELAYS_MS.forEach((delayMs) => {
        window.setTimeout(() => {
            if (completed) {
                return;
            }
            if (STATE.records[videoId]?.status === VIDEO_STATUS.WANT) {
                completed = true;
                return;
            }
            if (!isPageConfirmedWantStatus()) {
                return;
            }
            completed = true;
            upsertWantStatus(videoId).catch(err => log('upsertWantStatus error:', err));
        }, delayMs);
    });
}

// 将本地番号库状态升级为 WANT（若无记录则创建）
async function upsertWantStatus(videoId: string): Promise<void> {
    const opId = await concurrencyManager.startProcessingVideo(videoId).catch(() => null);
    if (!opId) {
        // 已有并发在处理，避免冲突直接返回
        return;
    }
    try {
        const now = Date.now();
        const currentUrl = window.location.href;
        const existing = STATE.records[videoId];

        if (existing) {
            // 升级现有记录状态
            const result = await storageManager.updateRecord(
                videoId,
                (current) => {
                    const cur = current[videoId];
                    const updated = { ...cur } as VideoRecord;
                    updated.status = safeUpdateStatus(cur.status, VIDEO_STATUS.WANT as any);
                    updated.updatedAt = now;
                    updated.javdbUrl = currentUrl;
                    return updated;
                },
                opId
            );
            if (result.success) {
                updateFaviconForStatus(VIDEO_STATUS.WANT);
                showToast('已同步为「我想看」', 'success');
            } else {
                showToast(`同步失败: ${result.error || '未知错误'}`, 'error');
            }
        } else {
            // 新建记录并设为 WANT
            let newRecord = await createVideoRecord(videoId, now, currentUrl);
            if (!newRecord) {
                // 兜底：最小记录
                newRecord = {
                    id: videoId,
                    title: document.title.replace(/ \| JavDB.*/, '').trim(),
                    status: VIDEO_STATUS.WANT as any,
                    tags: [],
                    createdAt: now,
                    updatedAt: now,
                    javdbUrl: currentUrl,
                } as VideoRecord;
            } else {
                newRecord.status = VIDEO_STATUS.WANT as any;
                newRecord.updatedAt = now;
            }
            const result = await storageManager.addRecord(videoId, newRecord, opId);
            if (result.success) {
                updateFaviconForStatus(VIDEO_STATUS.WANT);
                showToast('已添加到番号库并标记为「我想看」', 'success');
            } else {
                showToast(`保存失败: ${result.error || '未知错误'}`, 'error');
            }
        }
    } catch (e) {
        log('upsertWantStatus exception:', e as any);
        showToast('同步失败：出现异常', 'error');
    } finally {
        concurrencyManager.finishProcessingVideo(videoId, opId || undefined);
    }
}

async function handleExistingRecord(
    videoId: string,
    record: VideoRecord,
    now: number,
    currentUrl: string,
    operationId: string,
    options: { light?: boolean } = {}
): Promise<string | null> {
    const lightMode = options.light === true;
    const fullDetailCommitMode = lightMode;
    // 静默更新现有记录

    // 获取当前页面的最新数据
    const endExtractSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoStatusInitialSyncExtract);
    let latestData: Partial<VideoRecord> | null;
    try {
        latestData = await extractVideoData(videoId, { light: lightMode });
    } finally {
        endExtractSpan();
    }
    if (!latestData) {
        log(`Failed to extract latest data for ${videoId}`);
        return null;
    }

    // 保存原始状态用于回滚
    const oldStatus = record.status;
    const oldRecord = { ...record };
    
    // 获取锁定字段列表
    const lockedFields = new Set(record.manuallyEditedFields || []);

    // 始终更新数据字段（除了状态、时间戳和锁定字段）
    // 用户专属字段（userRating, userNotes, isFavorite）永远不会被覆盖
    if (latestData.title && !lockedFields.has('title')) record.title = latestData.title;
    if ((fullDetailCommitMode || !lightMode) && latestData.tags && !lockedFields.has('tags')) record.tags = latestData.tags;
    if ((fullDetailCommitMode || !lightMode) && latestData.releaseDate !== undefined && !lockedFields.has('releaseDate')) record.releaseDate = latestData.releaseDate;
    record.javdbUrl = currentUrl; // 始终更新URL
    if (latestData.javdbImage !== undefined) record.javdbImage = latestData.javdbImage;
    
    // 🆕 更新新增字段（跳过锁定字段）
    if (latestData.videoCode !== undefined) record.videoCode = latestData.videoCode;
    if ((fullDetailCommitMode || !lightMode) && latestData.duration !== undefined && !lockedFields.has('duration')) record.duration = latestData.duration;
    if ((fullDetailCommitMode || !lightMode) && latestData.director !== undefined && !lockedFields.has('director')) record.director = latestData.director;
    if ((fullDetailCommitMode || !lightMode) && latestData.directorUrl !== undefined) record.directorUrl = latestData.directorUrl;
    if ((fullDetailCommitMode || !lightMode) && latestData.maker !== undefined && !lockedFields.has('maker')) record.maker = latestData.maker;
    if ((fullDetailCommitMode || !lightMode) && latestData.makerUrl !== undefined) record.makerUrl = latestData.makerUrl;
    if ((fullDetailCommitMode || !lightMode) && latestData.publisher !== undefined) record.publisher = latestData.publisher;
    if ((fullDetailCommitMode || !lightMode) && latestData.publisherUrl !== undefined) record.publisherUrl = latestData.publisherUrl;
    if ((fullDetailCommitMode || !lightMode) && latestData.series !== undefined && !lockedFields.has('series')) record.series = latestData.series;
    if ((fullDetailCommitMode || !lightMode) && latestData.seriesUrl !== undefined) record.seriesUrl = latestData.seriesUrl;
    if ((fullDetailCommitMode || !lightMode) && latestData.rating !== undefined) record.rating = latestData.rating;
    if ((fullDetailCommitMode || !lightMode) && latestData.ratingCount !== undefined) record.ratingCount = latestData.ratingCount;
    if ((fullDetailCommitMode || !lightMode) && latestData.actors !== undefined && !lockedFields.has('actors')) record.actors = latestData.actors;
    if ((fullDetailCommitMode || !lightMode) && latestData.wantToWatchCount !== undefined) record.wantToWatchCount = latestData.wantToWatchCount;
    if ((fullDetailCommitMode || !lightMode) && latestData.watchedCount !== undefined) record.watchedCount = latestData.watchedCount;
    if ((fullDetailCommitMode || !lightMode) && latestData.categories !== undefined && !lockedFields.has('categories')) record.categories = latestData.categories;
    
    record.updatedAt = now;

    // 检查哪些字段发生了变化
    const changes: string[] = [];
    if (oldRecord.title !== record.title) changes.push('标题');
    if (JSON.stringify(oldRecord.tags) !== JSON.stringify(record.tags)) changes.push('标签');
    if (oldRecord.releaseDate !== record.releaseDate) changes.push('发布日期');
    if (oldRecord.javdbUrl !== record.javdbUrl) changes.push('URL');
    if (oldRecord.javdbImage !== record.javdbImage) changes.push('封面图片');
    // 🆕 检查新增字段的变化
    if (oldRecord.videoCode !== record.videoCode) changes.push('番号前缀');
    if (oldRecord.duration !== record.duration) changes.push('时长');
    if (oldRecord.director !== record.director) changes.push('导演');
    if (oldRecord.directorUrl !== record.directorUrl) changes.push('导演链接');
    if (oldRecord.maker !== record.maker) changes.push('片商');
    if (oldRecord.makerUrl !== record.makerUrl) changes.push('片商链接');
    if (oldRecord.publisher !== record.publisher) changes.push('发行商');
    if (oldRecord.publisherUrl !== record.publisherUrl) changes.push('发行商链接');
    if (oldRecord.series !== record.series) changes.push('系列');
    if (oldRecord.seriesUrl !== record.seriesUrl) changes.push('系列链接');
    if (oldRecord.rating !== record.rating) changes.push('评分');
    if (oldRecord.ratingCount !== record.ratingCount) changes.push('评分人数');
    if (JSON.stringify(oldRecord.actors) !== JSON.stringify(record.actors)) changes.push('演员');
    if (oldRecord.wantToWatchCount !== record.wantToWatchCount) changes.push('想看人数');
    if (oldRecord.watchedCount !== record.watchedCount) changes.push('看过人数');
    if (JSON.stringify(oldRecord.categories) !== JSON.stringify(record.categories)) changes.push('类别');

    log(`Updated fields for ${videoId}: [${changes.join(', ')}]`);

    const pageDetectedStatus = detectPageUserStatus();
    const desiredStatus = resolveLibraryStatusFromPageStatus(record.status, pageDetectedStatus);
    let statusChanged = false;

    if (desiredStatus && desiredStatus !== oldStatus) {
        record.status = desiredStatus;
        statusChanged = true;
        changes.push('状态');
        log(`Updated status for ${videoId} from '${oldStatus}' to '${desiredStatus}'.`);
    } else {
        log(`Status for ${videoId} remains '${record.status}' (no status change needed).`);
    }

    const buildUpdatedRecord = (currentRecord: VideoRecord): VideoRecord => {
        const updatedRecord = { ...currentRecord };
        const lockedFieldsInner = new Set(currentRecord.manuallyEditedFields || []);

        if (latestData.title && !lockedFieldsInner.has('title')) updatedRecord.title = latestData.title;
        if ((fullDetailCommitMode || !lightMode) && latestData.tags && !lockedFieldsInner.has('tags')) updatedRecord.tags = latestData.tags;
        if ((fullDetailCommitMode || !lightMode) && latestData.releaseDate !== undefined && !lockedFieldsInner.has('releaseDate')) updatedRecord.releaseDate = latestData.releaseDate;
        updatedRecord.javdbUrl = currentUrl;
        if (latestData.javdbImage !== undefined) updatedRecord.javdbImage = latestData.javdbImage;
        if (latestData.videoCode !== undefined) updatedRecord.videoCode = latestData.videoCode;
        if ((fullDetailCommitMode || !lightMode) && latestData.duration !== undefined && !lockedFieldsInner.has('duration')) updatedRecord.duration = latestData.duration;
        if ((fullDetailCommitMode || !lightMode) && latestData.director !== undefined && !lockedFieldsInner.has('director')) updatedRecord.director = latestData.director;
        if ((fullDetailCommitMode || !lightMode) && latestData.directorUrl !== undefined) updatedRecord.directorUrl = latestData.directorUrl;
        if ((fullDetailCommitMode || !lightMode) && latestData.maker !== undefined && !lockedFieldsInner.has('maker')) updatedRecord.maker = latestData.maker;
        if ((fullDetailCommitMode || !lightMode) && latestData.makerUrl !== undefined) updatedRecord.makerUrl = latestData.makerUrl;
        if ((fullDetailCommitMode || !lightMode) && latestData.publisher !== undefined) updatedRecord.publisher = latestData.publisher;
        if ((fullDetailCommitMode || !lightMode) && latestData.publisherUrl !== undefined) updatedRecord.publisherUrl = latestData.publisherUrl;
        if ((fullDetailCommitMode || !lightMode) && latestData.series !== undefined && !lockedFieldsInner.has('series')) updatedRecord.series = latestData.series;
        if ((fullDetailCommitMode || !lightMode) && latestData.seriesUrl !== undefined) updatedRecord.seriesUrl = latestData.seriesUrl;
        if ((fullDetailCommitMode || !lightMode) && latestData.rating !== undefined) updatedRecord.rating = latestData.rating;
        if ((fullDetailCommitMode || !lightMode) && latestData.ratingCount !== undefined) updatedRecord.ratingCount = latestData.ratingCount;
        if ((fullDetailCommitMode || !lightMode) && latestData.actors !== undefined && !lockedFieldsInner.has('actors')) updatedRecord.actors = latestData.actors;
        if ((fullDetailCommitMode || !lightMode) && latestData.wantToWatchCount !== undefined) updatedRecord.wantToWatchCount = latestData.wantToWatchCount;
        if ((fullDetailCommitMode || !lightMode) && latestData.watchedCount !== undefined) updatedRecord.watchedCount = latestData.watchedCount;
        if ((fullDetailCommitMode || !lightMode) && latestData.categories !== undefined && !lockedFieldsInner.has('categories')) updatedRecord.categories = latestData.categories;
        updatedRecord.updatedAt = now;

        const nextStatus = resolveLibraryStatusFromPageStatus(currentRecord.status, pageDetectedStatus);
        if (nextStatus) {
            updatedRecord.status = nextStatus;
        }
        return updatedRecord;
    };

    const updatedRecord = buildUpdatedRecord(record);

    const result = await (async () => {
        const endStorageCommitSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.videoStatusInitialSyncStorageCommit);
        try {
            return lightMode
                ? await storageManager.putRecord(updatedRecord, operationId, { backupToStorage: false, verifyAfterWrite: true })
                : await storageManager.updateRecord(
                    videoId,
                    (currentRecords) => {
                        const currentRecord = currentRecords[videoId];
                        if (!currentRecord) {
                            throw new Error(`Record ${videoId} not found in current storage`);
                        }
                        return buildUpdatedRecord(currentRecord);
                    },
                    operationId
                );
        } finally {
            endStorageCommitSpan();
        }
    })();

    if (result.success) {
        log(`Successfully saved updated record for ${videoId} (operation ${operationId})`);

        // 显示更新信息
        if (changes.length > 0) {
            if (statusChanged) {
                log(`已更新 ${videoId}: ${changes.join(', ')}`);
            } else {
                log(`已刷新 ${videoId}: ${changes.join(', ')}`);
            }
        } else {
            log(`数据无变化: ${videoId}`);
        }
        // 根据最新状态更新 favicon
        return record.status || null;

    } else {
        log(`Failed to save updated record for ${videoId} (operation ${operationId}): ${result.error}`);
        showToast(`保存失败: ${videoId} - ${result.error}`, 'error');
    }

    return record.status || null;
}

async function handleNewRecord(
    videoId: string, 
    now: number, 
    currentUrl: string
) : Promise<VideoRecord | undefined> {
    log(`No record found for ${videoId}. Creating full record during initial sync.`);

    if (STATE.records[videoId]) {
        return STATE.records[videoId];
    }

    const newRecord = await createVideoRecord(videoId, now, currentUrl);
    if (!newRecord) {
        log(`Failed to create record for ${videoId}`);
        return undefined;
    }

    const addOperationId = `${videoId}-initial-add:${Date.now()}`;
    const result = await storageManager.addRecord(videoId, newRecord, addOperationId);

    if (result.success) {
        if (result.alreadyExists) {
            log(`${videoId} already exists during initial add. Reusing current record.`);
            return STATE.records[videoId] || newRecord;
        }
        log(`Successfully added new record for ${videoId} (${addOperationId})`, newRecord);
        return newRecord;
    }

    log(`Failed to save new record for ${videoId} (${addOperationId}): ${result.error}`);
    showToast(`保存失败: ${videoId} - ${result.error}`, 'error');
    return undefined;
}

// 提取视频数据的通用函数
async function extractVideoData(videoId: string, options: { light?: boolean } = {}): Promise<Partial<VideoRecord> | null> {
    try {
        const lightMode = options.light === true;
        const title = document.title.replace(/ \| JavDB.*/, '').trim();

        // 获取所有 panel-block 元素，用于提取各种字段
        const panelBlocks = Array.from(document.querySelectorAll<HTMLElement>('.panel-block'));
        
        // 辅助函数：根据标签名查找对应的值
        const findValueByLabel = (labels: string[]): string | undefined => {
            for (const block of panelBlocks) {
                const strongElement = block.querySelector('strong');
                const label = strongElement?.textContent?.trim() || '';
                if (labels.some(l => label.includes(l))) {
                    const valueElement = block.querySelector('.value');
                    if (valueElement) {
                        return valueElement.textContent?.trim();
                    }
                }
            }
            return undefined;
        };

        // 🆕 辅助函数：根据标签名查找对应的链接
        const findLinkByLabel = (labels: string[]): { text?: string; url?: string } | undefined => {
            for (const block of panelBlocks) {
                const strongElement = block.querySelector('strong');
                const label = strongElement?.textContent?.trim() || '';
                if (labels.some(l => label.includes(l))) {
                    const linkElement = block.querySelector<HTMLAnchorElement>('.value a');
                    if (linkElement) {
                        return {
                            text: linkElement.textContent?.trim(),
                            url: linkElement.getAttribute('href') || undefined
                        };
                    }
                }
            }
            return undefined;
        };

        // 🆕 提取番号前缀（从番号中提取，如 "JAC-229" -> "JAC"）
        const videoCode = videoId.split('-')[0] || undefined;

        // 轻量模式只取首屏关键字段
        if (lightMode) {
            let javdbImage: string | undefined;
            const coverImageElement = document.querySelector<HTMLImageElement>('.column-video-cover img.video-cover');
            if (coverImageElement && coverImageElement.src) {
                javdbImage = coverImageElement.src;
            } else {
                const fancyboxElement = document.querySelector<HTMLAnchorElement>('.column-video-cover a[data-fancybox="gallery"]');
                if (fancyboxElement && fancyboxElement.href) {
                    javdbImage = fancyboxElement.href;
                }
            }

            return {
                title,
                javdbImage,
                videoCode,
            };
        }

        // 获取发布日期
        let releaseDate = findValueByLabel(['日期', 'Date']);
        if (!releaseDate) {
            // 尝试通过正则匹配日期格式
            for (const block of panelBlocks) {
                const text = block.textContent?.trim();
                if (text) {
                    const dateMatch = text.match(/(\d{4}-\d{1,2}-\d{1,2})/);
                    if (dateMatch) {
                        releaseDate = dateMatch[1];
                        break;
                    }
                }
            }
        }
        log(`Release date: "${releaseDate || 'undefined'}"`);

        // 🆕 提取时长（分钟）
        let duration: number | undefined;
        const durationText = findValueByLabel(['時長', '时长', 'Duration']);
        if (durationText) {
            const durationMatch = durationText.match(/(\d+)/);
            if (durationMatch) {
                duration = parseInt(durationMatch[1], 10);
                log(`Duration: ${duration} minutes`);
            }
        }

        // 🆕 提取导演（名称 + 链接）
        const directorInfo = findLinkByLabel(['導演', '导演', 'Director']);
        const director = directorInfo?.text;
        const directorUrl = directorInfo?.url;
        if (director) log(`Director: "${director}"${directorUrl ? ` (${directorUrl})` : ''}`);

        // 🆕 提取片商（名称 + 链接）
        const makerInfo = findLinkByLabel(['片商', 'Maker', 'Studio']);
        const maker = makerInfo?.text;
        const makerUrl = makerInfo?.url;
        if (maker) log(`Maker: "${maker}"${makerUrl ? ` (${makerUrl})` : ''}`);

        // 🆕 提取发行商（名称 + 链接）
        const publisherInfo = findLinkByLabel(['發行', '发行', 'Publisher']);
        const publisher = publisherInfo?.text;
        const publisherUrl = publisherInfo?.url;
        if (publisher) log(`Publisher: "${publisher}"${publisherUrl ? ` (${publisherUrl})` : ''}`);

        // 🆕 提取系列（名称 + 链接）
        const seriesInfo = findLinkByLabel(['系列', 'Series']);
        const series = seriesInfo?.text;
        const seriesUrl = seriesInfo?.url;
        if (series) log(`Series: "${series}"${seriesUrl ? ` (${seriesUrl})` : ''}`);


        // 🆕 提取评分信息
        let rating: number | undefined;
        let ratingCount: number | undefined;
        const ratingText = findValueByLabel(['評分', '评分', 'Rating']);
        if (ratingText) {
            // 匹配格式如 "3.73分, 由87人評價"
            const ratingMatch = ratingText.match(/([\d.]+)分/);
            const countMatch = ratingText.match(/(\d+)人/);
            if (ratingMatch) {
                rating = parseFloat(ratingMatch[1]);
                log(`Rating: ${rating}`);
            }
            if (countMatch) {
                ratingCount = parseInt(countMatch[1], 10);
                log(`Rating count: ${ratingCount}`);
            }
        }

        // 🆕 提取演员列表
        const actors: string[] = [];
        for (const block of panelBlocks) {
            const strongElement = block.querySelector('strong');
            const label = strongElement?.textContent?.trim() || '';
            if (label.includes('演員') || label.includes('演员') || label.includes('Actor')) {
                const actorLinks = block.querySelectorAll<HTMLAnchorElement>('a[href^="/actors/"]');
                actorLinks.forEach(link => {
                    const actorName = link.textContent?.trim();
                    if (actorName && actorName !== 'N/A') {
                        actors.push(actorName);
                    }
                });
                break;
            }
        }
        if (actors.length > 0) log(`Actors: [${actors.join(', ')}]`);

        // 🆕 提取统计数据（想看人数、看过人数）
        let wantToWatchCount: number | undefined;
        let watchedCount: number | undefined;
        const statsText = findValueByLabel(['人想看', '人看過', '人看过']);
        if (statsText) {
            // 匹配格式如 "671人想看, 87人看過"
            const wantMatch = statsText.match(/(\d+)人想看/);
            const watchedMatch = statsText.match(/(\d+)人看[過过]/);
            if (wantMatch) {
                wantToWatchCount = parseInt(wantMatch[1], 10);
                log(`Want to watch count: ${wantToWatchCount}`);
            }
            if (watchedMatch) {
                watchedCount = parseInt(watchedMatch[1], 10);
                log(`Watched count: ${watchedCount}`);
            }
        }

        // 获取标签（类别）：只保留 JavDB 原生的类别链接，避免误收拓展注入的外部来源入口
        const isNativeCategoryLink = (link: HTMLAnchorElement): boolean => {
            const rawHref = link.getAttribute('href')?.trim();
            if (!rawHref) return false;

            try {
                const url = new URL(rawHref, window.location.href);
                const isSameOrigin = url.origin === window.location.origin;
                return isSameOrigin && (url.pathname.startsWith('/tags') || url.pathname.startsWith('/genres'));
            } catch {
                return rawHref.startsWith('/tags') || rawHref.startsWith('/genres');
            }
        };

        const collectTagsFromSelector = (selector: string): string[] => {
            try {
                return Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))
                    .filter(isNativeCategoryLink)
                    .map(tag => (tag.textContent || '').trim())
                    .filter(Boolean);
            } catch (error) {
                log(`Error with tag selector ${selector}:`, error);
                return [];
            }
        };

        let tags = collectTagsFromSelector(SELECTORS.VIDEO_DETAIL_TAGS);

        // 如果没有找到标签，尝试备用选择器
        if (tags.length === 0) {
            const altSelectors = [
                '.panel-block.genre span.value a',
                'div.panel-block.genre .value a',
                '.genre .value a',
                '.panel-block .value a',
                '.tags a',
                'a[href*="/genres/"]'
            ];

            for (const selector of altSelectors) {
                const altTags = collectTagsFromSelector(selector);
                if (altTags.length > 0) {
                    tags.push(...altTags);
                    break;
                }
            }
        }

        // 提取类别标签（从"類別"字段）
        const categories: string[] = [];
        for (const block of panelBlocks) {
            const strongElement = block.querySelector('strong');
            const label = strongElement?.textContent?.trim() || '';
            if (label.includes('類別') || label.includes('类别') || label.includes('Category')) {
                const categoryLinks = block.querySelectorAll<HTMLAnchorElement>('a');
                categoryLinks.forEach(link => {
                    if (!isNativeCategoryLink(link)) return;
                    const categoryName = link.textContent?.trim();
                    if (categoryName) {
                        categories.push(categoryName);
                    }
                });
                break;
            }
        }
        if (categories.length > 0) log(`Categories: [${categories.join(', ')}]`);

        // 提取描述文本，用于二次过滤
        let descriptionText: string | undefined;
        try {
            for (const block of panelBlocks) {
                const strongElement = block.querySelector('strong');
                const label = strongElement?.textContent?.trim() || '';
                if (['描述', '簡介', '简介', '說明', '说明'].some(k => label.includes(k))) {
                    const valueEl = block.querySelector<HTMLElement>('.value');
                    const text = (valueEl?.textContent || block.textContent || '').trim();
                    if (text) {
                        descriptionText = text;
                        log(`Found description text: "${descriptionText.substring(0, 50)}${(descriptionText.length > 50 ? '...' : '')}"`);
                        break;
                    }
                }
            }
        } catch (e) {
            log('Error while extracting description text:', e);
        }

        // 二次过滤：当 tags 与 描述 同时为空时，不保存
        if (tags.length === 0 && (!descriptionText || descriptionText.length === 0)) {
            log('Secondary validation failed: both tags and description are empty. Skip saving.');
            return null;
        }

        // 获取封面图片链接
        let javdbImage: string | undefined;
        const coverImageElement = document.querySelector<HTMLImageElement>('.column-video-cover img.video-cover');
        if (coverImageElement && coverImageElement.src) {
            javdbImage = coverImageElement.src;
            log(`Found cover image: ${javdbImage}`);
        } else {
            const fancyboxElement = document.querySelector<HTMLAnchorElement>('.column-video-cover a[data-fancybox="gallery"]');
            if (fancyboxElement && fancyboxElement.href) {
                javdbImage = fancyboxElement.href;
                log(`Found cover image from fancybox: ${javdbImage}`);
            }
        }

        return {
            title,
            tags,
            releaseDate,
            javdbImage,
            // 🆕 新增字段
            videoCode,
            duration,
            director,
            directorUrl,
            maker,
            makerUrl,
            publisher,
            publisherUrl,
            series,
            seriesUrl,
            rating,
            ratingCount,
            actors: actors.length > 0 ? actors : undefined,
            wantToWatchCount,
            watchedCount,
            categories: categories.length > 0 ? categories : undefined,
        };
    } catch (error) {
        log(`Error extracting video data for ${videoId}:`, error);
        return null;
    }
}

async function createVideoRecord(videoId: string, now: number, currentUrl: string): Promise<VideoRecord | null> {
    try {
        // 使用统一的数据提取函数
        const extractedData = await extractVideoData(videoId);
        if (!extractedData) {
            log(`Failed to extract data for ${videoId}`);
            return null;
        }

        // 页面状态识别（我看過/我想看）
        const pageDetectedStatus = detectPageUserStatus();

        return {
            id: videoId,
            title: extractedData.title || document.title.replace(/ \| JavDB.*/, '').trim(),
            status: pageDetectedStatus ?? VIDEO_STATUS.BROWSED,
            createdAt: now,
            updatedAt: now,
            tags: extractedData.tags || [],
            releaseDate: extractedData.releaseDate,
            javdbUrl: currentUrl,
            javdbImage: extractedData.javdbImage,
            // 🆕 新增字段
            videoCode: extractedData.videoCode,
            duration: extractedData.duration,
            director: extractedData.director,
            directorUrl: extractedData.directorUrl,
            maker: extractedData.maker,
            makerUrl: extractedData.makerUrl,
            publisher: extractedData.publisher,
            publisherUrl: extractedData.publisherUrl,
            series: extractedData.series,
            seriesUrl: extractedData.seriesUrl,
            rating: extractedData.rating,
            ratingCount: extractedData.ratingCount,
            actors: extractedData.actors,
            wantToWatchCount: extractedData.wantToWatchCount,
            watchedCount: extractedData.watchedCount,
            categories: extractedData.categories,
        };
    } catch (error) {
        log(`Error creating video record for ${videoId}:`, error);
        return null;
    }
}
