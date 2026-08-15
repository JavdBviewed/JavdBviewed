/**
 * 115网盘内容脚本集成
 */

import { isDrive115Enabled, addTaskUrlsV2, downloadOffline as routerDownloadOffline } from '../router';
import { addLogV2 } from '../v2/logs';
// getDrive115V2Service 已移除，配额功能已迁移至dashboard
import { waitForElement } from '../../../platform/browser/domUtils';
// extractVideoIdFromPage 已集成到推送按钮逻辑中
import { showToast } from '../../../platform/browser/toast';
import { log, setContentRecord } from '../../contentState';
import { extractVideoIdFromPage } from '../../../platform/browser';
import { getSettings, saveSettings } from '../../../utils/storage';
import {
    getDefaultManualPushDirectory,
    getManualPushInitialDirectory,
    resolveManualPushDirectory,
    shouldUseDefaultDirectoryForManualPush,
    type Drive115FolderSelection,
} from '../ui/manualPushDirectory';
import { completeManagedTask, createManagedTaskDescriptor, ensureManagedTaskRegistered, failManagedTask, progressManagedTask, requestTaskLease, runChunkedWork, saveSubtaskDetail, waitForTaskLease, yieldToMainThread } from '../../../platform/tasks';
import { getPageContext } from '../../../platform/browser';

type Drive115PushSettingsCache = {
    enabled: boolean;
    downloadDir: string;
    downloadDirName: string;
    downloadDirPath: string;
    lastManualPushDirectory: string;
    skipManualPushDirectoryPicker: boolean;
    autoMarkWatchedAfter115: boolean;
    autoMarkWatchedStars: number;
};

let drive115PushSettingsCache: Drive115PushSettingsCache | null = null;

async function refreshDrive115PushSettingsCache(): Promise<Drive115PushSettingsCache> {
    const [enabled, settings] = await Promise.all([
        isDrive115Enabled(),
        getSettings(),
    ]);

    const cache: Drive115PushSettingsCache = {
        enabled,
        downloadDir: ((settings as any)?.drive115?.downloadDir ?? (settings as any)?.drive115?.defaultWpPathId ?? '').toString().trim(),
        downloadDirName: ((settings as any)?.drive115?.downloadDirName ?? '').toString().trim(),
        downloadDirPath: ((settings as any)?.drive115?.downloadDirPath ?? '').toString().trim(),
        lastManualPushDirectory: ((settings as any)?.drive115?.lastManualPushDirectory ?? '').toString().trim(),
        skipManualPushDirectoryPicker: (settings as any)?.drive115?.skipManualPushDirectoryPicker === true,
        autoMarkWatchedAfter115: (settings as any)?.videoEnhancement?.autoMarkWatchedAfter115 !== false,
        autoMarkWatchedStars: (settings as any)?.videoEnhancement?.autoMarkWatchedStars ?? 4,
    };

    drive115PushSettingsCache = cache;
    return cache;
}

async function getDrive115PushSettingsCached(): Promise<Drive115PushSettingsCache> {
    if (drive115PushSettingsCache) {
        return drive115PushSettingsCache;
    }
    return refreshDrive115PushSettingsCache();
}

// 统一的网络请求超时与重试封装（用于对抗临时的网络抖动/连接重置）
async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeoutRetry(
    url: string,
    options: RequestInit,
    opts: { retries?: number; timeoutMs?: number; backoffBaseMs?: number; retryOnHttpStatuses?: number[] } = {}
): Promise<Response> {
    const {
        retries = 2,
        timeoutMs = 8000,
        backoffBaseMs = 600,
        retryOnHttpStatuses = [408, 429, 500, 502, 503, 504, 520, 522, 524]
    } = opts;

    let lastError: any = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!resp.ok && retryOnHttpStatuses.includes(resp.status) && attempt < retries) {
                const sleepMs = backoffBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
                log(`[Network] HTTP ${resp.status}，准备重试 ${attempt + 1}/${retries}: ${url}`);
                await delay(sleepMs);
                continue;
            }
            return resp;
        } catch (err: any) {
            clearTimeout(timeoutId);
            lastError = err;
            if (attempt < retries) {
                const isAbort = err?.name === 'AbortError';
                const sleepMs = backoffBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
                log(`[Network] 请求异常（${isAbort ? '超时' : '网络错误'}），准备重试 ${attempt + 1}/${retries}: ${url}`);
                await delay(sleepMs);
                continue;
            }
            throw err;
        }
    }
    throw lastError ?? new Error('网络请求失败');
}


async function inject115ButtonsIntoNativeMagnetList(): Promise<void> {
    const container = await waitForElement('#magnets-content', 1500, 120);
    if (!container) return;
    const videoId = extractVideoIdFromPage() || 'unknown';

    const items = Array.from(container.querySelectorAll('.item')) as HTMLElement[];
    await runChunkedWork(items, {
        batchSize: 3,
        parentLabel: 'drive115:init:video',
        yieldAfterBatch: async () => {
            await yieldToMainThread(0);
        },
        onBatchComplete: async ({ batchIndex, itemCount, processed }) => {
            saveSubtaskDetail({
                label: 'drive115:init:video:inject-buttons',
                parentLabel: 'drive115:init:video',
                subtaskLabel: 'inject-buttons',
                batchIndex,
                itemCount,
                detail: `processed=${processed}`,
                phase: 'idle',
                status: 'done',
                durationMs: 0,
            });
        },
        onItem: async (item) => {
            if (item.querySelector('.drive115-push-btn')) return;
            const magnetLink = item.querySelector('a[href^="magnet:"]') as HTMLAnchorElement | null;
            if (!magnetLink) return;
            const nameEl = item.querySelector('.magnet-name .name') as HTMLElement | null;
            const magnetName = (nameEl?.textContent || magnetLink.textContent || 'magnet').trim();

            const btn = document.createElement('button');
            btn.className = 'button is-success is-small drive115-push-btn';
            (btn as HTMLButtonElement).style.marginLeft = '5px';
            btn.innerHTML = '&nbsp;推送115&nbsp;';
            btn.addEventListener('click', () => {
                log(`[Drive115] Push button clicked: ${videoId} | ${magnetName}`);
                const force = btn.dataset.drive115Force === '1';
                if (force) delete btn.dataset.drive115Force;
                void handlePushToDrive115(btn, videoId, magnetLink.href, magnetName, { force }).catch((error) => {
                    log('[Drive115] Push click handler failed:', error);
                });
            });

            let buttonsCol = item.querySelector('.buttons');
            if (!buttonsCol) {
                buttonsCol = document.createElement('div');
                (buttonsCol as HTMLElement).className = 'buttons column';
                (buttonsCol as HTMLElement).style.display = 'flex';
                (buttonsCol as HTMLElement).style.alignItems = 'center';
                (buttonsCol as HTMLElement).style.gap = '6px';
                item.appendChild(buttonsCol);
            }
            (buttonsCol as HTMLElement).appendChild(btn);
        }
    });
}

/**
 * 初始化115功能
 */
export async function initDrive115Features(): Promise<void> {
    const parentLabel = window.location.pathname.startsWith('/v/') ? 'drive115:init:video' : 'drive115:init:list';
    try {
        const steps: Array<() => Promise<void>> = [
            async () => {
                await refreshDrive115PushSettingsCache();
            },
            async () => {
        // 通过统一路由判断是否启用115功能（屏蔽 v1/v2 差异）
                const { enabled } = await getDrive115PushSettingsCached();
                if (!enabled) {
                    throw new Error('drive115-disabled');
                }
            },
            async () => {

        // 在详情页为原生磁力列表注入 115 按钮（不依赖磁力搜索）
                if (window.location.pathname.startsWith('/v/')) {
                    try { await inject115ButtonsIntoNativeMagnetList(); } catch {}
                }
            },
            async () => {

        // 优化：并行等待容器元素，避免串行等待导致耗时累加
        // 列表页可能没有这些元素，缩短超时时间避免长时间阻塞
                const isDetailPage = window.location.pathname.startsWith('/v/');
                const timeout = isDetailPage ? 1500 : 800;
        
                const [userBox, userStatus] = await Promise.all([
                    waitForElement('#drive115-user-box', timeout, 150),
                    waitForElement('#drive115-user-status', timeout, 150)
                ]);
        
                if (!userBox || !userStatus) {
                    log('[Drive115] Required containers not found, continue without quota UI');
                }
            },
            async () => {

        // 简化初始化，避免调用不存在的函数
                log('[Drive115] Containers found, initialization completed');
                try {
                    const refreshBtn = document.getElementById('drive115-refresh-btn');
                    if (refreshBtn && !(refreshBtn as any)._bound_drive115_quota_refresh) {
                        (refreshBtn as any)._bound_drive115_quota_refresh = true;
                        refreshBtn.addEventListener('click', async (e) => {
                            e.preventDefault();
                            try {
                                log('[Drive115] Refresh button clicked - functionality temporarily disabled');
                            } catch (err) {
                                console.warn('[Drive115] 点击刷新配额异常：', err);
                            }
                        });
                    }
                } catch {}
            },
        ];

        await runChunkedWork(steps, {
            batchSize: 1,
            parentLabel,
            yieldAfterBatch: async () => {
                await yieldToMainThread(0);
            },
            onBatchComplete: async ({ batchIndex }) => {
                saveSubtaskDetail({
                    label: `${parentLabel}:step`,
                    parentLabel,
                    subtaskLabel: 'step',
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

        // 静默完成115功能初始化
    } catch (error) {
        if (error instanceof Error && error.message === 'drive115-disabled') {
            return;
        }
        console.error('初始化115功能失败:', error);
    }
}

// 刷新115配额UI功能已移至dashboard模块

// renderQuotaSection 已移至dashboard模块

// formatBytesSmart 已移至dashboard模块

// addDrive115ButtonToDetailPage 功能已集成到主流程

// findMagnetSection 已集成到推送按钮逻辑中

// addPushButtonsToMagnetItems 功能已集成到主流程中

/**
 * 处理推送到115网盘（新的跨域实现）- 导出供其他模块使用
 */
export async function handlePushToDrive115(
    button: HTMLButtonElement,
    videoId: string,
    magnetUrl: string,
    magnetName: string,
    options: { force?: boolean } = {},
): Promise<void> {
    const pageContext = getPageContext();
    const correlationId = `drive115-push:${videoId}:${Date.now()}`;
    const traceId = correlationId;
    let rootTask: Awaited<ReturnType<typeof ensureManagedTaskRegistered>> | null = null;
    const getRootTask = () => {
        if (!rootTask) {
            throw new Error('drive115-push-task-not-ready');
        }
        return rootTask;
    };
    const originalText = button.innerHTML;
    log(`[Drive115] handlePushToDrive115 start: ${videoId} | ${magnetName} | ${pageContext.pageInstanceId}`);
    const stageStartTimes = new Map<string, number>();
    const beginStage = async (stage: string, detail: string, progressPct: number) => {
        const now = Date.now();
        stageStartTimes.set(stage, now);
        const task = getRootTask();
        await progressManagedTask(task.taskId, { stage, detail, progressPct, stageStartedAt: now });
    };
    const endStage = (stage: string, status: 'done' | 'error', detail: string, error?: string) => {
        const startedAt = stageStartTimes.get(stage) || Date.now();
        const durationMs = Date.now() - startedAt;
        const task = getRootTask();
        saveSubtaskDetail({
            label: `drive115:push:${stage}`,
            taskId: `${task.taskId}:${stage}`,
            parentTaskId: task.taskId,
            rootTaskId: task.rootTaskId || task.taskId,
            correlationId,
            parentLabel: task.label,
            subtaskLabel: stage,
            pageUrl: pageContext.pageUrl,
            pageType: pageContext.pageType,
            mainId: pageContext.mainId,
            pageInstanceId: pageContext.pageInstanceId,
            phase: 'critical',
            status,
            durationMs,
            detail,
            error,
        });
        void progressManagedTask(task.taskId, { stage, detail, stageStartedAt: startedAt, stageDurationMs: durationMs });
    };
    try {
        const cachedSettings = await getDrive115PushSettingsCached();
        const enabled = cachedSettings.enabled;
        if (!enabled) {
            showToast('115网盘功能未启用，请先在设置中启用', 'error');
            return;
        }

        button.disabled = true;
        button.innerHTML = '&nbsp;选择目录...&nbsp;';
        let directorySelection: Drive115FolderSelection | null;
        try {
            directorySelection = shouldUseDefaultDirectoryForManualPush(
                cachedSettings.skipManualPushDirectoryPicker,
                cachedSettings.downloadDir,
            )
                ? getDefaultManualPushDirectory(
                    cachedSettings.downloadDir,
                    cachedSettings.downloadDirName,
                    cachedSettings.downloadDirPath,
                )
                : await resolveManualPushDirectory(
                    getManualPushInitialDirectory(cachedSettings.lastManualPushDirectory, cachedSettings.downloadDir),
                    cachedSettings.downloadDir,
                );
        } catch (error) {
            log('[Drive115] Manual directory picker failed:', error);
            showToast('加载 115 目录失败，请重试', 'error');
            button.innerHTML = originalText;
            button.disabled = false;
            return;
        }
        if (!directorySelection) {
            button.innerHTML = originalText;
            button.disabled = false;
            return;
        }
        const shouldPersistSelection = directorySelection.cid !== cachedSettings.lastManualPushDirectory
            || directorySelection.setAsDefault === true
            || directorySelection.skipManualDirectoryPicker === true;
        if (shouldPersistSelection) {
            const settings = await getSettings();
            const nextDrive115Settings = {
                ...(settings.drive115 || {}),
                lastManualPushDirectory: directorySelection.cid,
            } as Record<string, unknown>;
            if (directorySelection.setAsDefault) {
                nextDrive115Settings.downloadDir = directorySelection.cid;
                nextDrive115Settings.downloadDirName = directorySelection.name;
                nextDrive115Settings.downloadDirPath = directorySelection.path;
                delete nextDrive115Settings.defaultWpPathId;
                cachedSettings.downloadDir = directorySelection.cid;
                cachedSettings.downloadDirName = directorySelection.name;
                cachedSettings.downloadDirPath = directorySelection.path;
            }
            if (directorySelection.skipManualDirectoryPicker) {
                nextDrive115Settings.skipManualPushDirectoryPicker = true;
                cachedSettings.skipManualPushDirectoryPicker = true;
            }
            const nextSettings = {
                ...settings,
                drive115: nextDrive115Settings,
            };
            await saveSettings(nextSettings);
            cachedSettings.lastManualPushDirectory = directorySelection.cid;
        }

        // 跨页同磁链同动作合并；force 时追加唯一后缀绕过 dedupe
        const actionDedupeKey = options.force
            ? `drive115:push:${videoId}:${magnetUrl}:force:${Date.now()}`
            : `drive115:push:${videoId}:${magnetUrl}`;
        rootTask = await ensureManagedTaskRegistered(createManagedTaskDescriptor({
            label: 'drive115:push',
            phase: 'critical',
            priority: 95,
            cost: 'medium',
            visibilityPolicy: 'background_allowed',
            timeoutMs: 30000,
            retryLimit: 1,
            resumePolicy: 'resume',
            dedupeKey: actionDedupeKey,
            shareScope: 'dedupe-by-action',
            executionClass: 'on-demand',
            correlationId,
        }));
        log(`[Drive115] task registered: ${rootTask.taskId}`);

        // 命中已完成/失败的共享任务：直接复用结果，避免重复真实推送
        if (rootTask.reused && (rootTask.status === 'done' || rootTask.status === 'error')) {
            const reusedStatus = rootTask.status;
            if (reusedStatus === 'done') {
                button.innerHTML = '已推送';
                button.className = 'button is-success is-small drive115-push-btn';
                showToast(`${magnetName} 已在其他页面推送成功`, 'success');
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.disabled = false;
                    button.className = 'button is-success is-small drive115-push-btn';
                    // 成功复用后允许用户主动 force 重推
                    button.dataset.drive115Force = '1';
                }, 3000);
            } else {
                button.innerHTML = '推送失败';
                button.className = 'button is-danger is-small drive115-push-btn';
                // 失败复用：立即标记 force，避免再次点击仍命中 error 终态
                button.dataset.drive115Force = '1';
                showToast(`${magnetName} 此前推送失败，可强制重推`, 'error');
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.disabled = false;
                    button.className = 'button is-success is-small drive115-push-btn';
                    button.dataset.drive115Force = '1';
                }, 3000);
            }
            return;
        }

        // 命中进行中的共享任务：本页只展示状态，不重复发起 API
        if (rootTask.reused && ['registered', 'queued', 'leased', 'running', 'paused'].includes(String(rootTask.status || ''))) {
            button.disabled = true;
            button.innerHTML = '&nbsp;推送中...&nbsp;';
            button.className = 'button is-warning is-small drive115-push-btn is-loading';
            showToast(`${magnetName} 已在其他页面推送中`, 'info');
            // 进行中复用不阻塞永久：稍后恢复按钮，再次点击仍会命中共享 in-flight 任务
            setTimeout(() => {
                button.innerHTML = originalText || '&nbsp;推送115&nbsp;';
                button.disabled = false;
                button.className = 'button is-success is-small drive115-push-btn';
            }, 5000);
            return;
        }

        button.disabled = true;
        button.innerHTML = '&nbsp;推送中...&nbsp;';
        button.className = 'button is-warning is-small drive115-push-btn is-loading';

        await progressManagedTask(rootTask.taskId, { stage: 'queue', detail: 'waiting-for-lease', progressPct: 1 });

        const immediateLease = await requestTaskLease(rootTask.taskId);
        const lease = immediateLease?.granted
            ? immediateLease
            : await waitForTaskLease(rootTask.taskId, 12000, 250);
        if (!lease?.granted) {
            throw new Error(lease?.waitReason || 'drive115-push-lease-denied');
        }

        button.disabled = true;
        button.innerHTML = '&nbsp;推送中...&nbsp;';
        button.className = 'button is-warning is-small drive115-push-btn is-loading';

        log(`推送磁链到115网盘: ${magnetName} (${videoId})`);

        // 单版本：统一走 v2 应用服务
        let result: { success: boolean; data?: any; error?: string };
        const urls = magnetUrl;
        try {
            await beginStage('prepare', `videoId=${videoId}`, 5);
            await addLogV2({ timestamp: Date.now(), level: 'info', message: `内容脚本：发起 115 推送，videoId=${videoId}，name=${magnetName}，magnet=${magnetUrl}，page=${window.location.href}` });
            const wpPathId = directorySelection.cid;

            endStage('prepare', 'done', 'request prepared');
            await beginStage('push-api', `wpPathId=${wpPathId ?? 'root'}`, 40);
            const task = getRootTask();
            console.info('[115Trace] content:addTaskUrls:start', {
                traceId,
                correlationId,
                taskId: task.taskId,
                videoId,
                magnetName,
                wpPathId,
                pageUrl: window.location.href,
            });
            const res = await addTaskUrlsV2({ urls, wp_path_id: wpPathId, context: { source: 'detail', videoId, magnetName, pageUrl: window.location.href, wpPathId, taskId: task.taskId, correlationId, traceId } as any });
            console.info('[115Trace] content:addTaskUrls:end', {
                traceId,
                correlationId,
                taskId: task.taskId,
                videoId,
                success: res.success,
                message: res.message,
                returned: Array.isArray(res.data) ? res.data.length : 0,
            });
            result = { success: res.success, data: res.data, error: res.message };
            if (res.success) {
                endStage('push-api', 'done', `returned=${Array.isArray(res.data) ? res.data.length : 0}`);
                const returned = Array.isArray(res.data) ? res.data.length : 0;
                await addLogV2({ timestamp: Date.now(), level: 'info', message: `内容脚本：推送成功，返回 ${returned} 项，videoId=${videoId}` });
                const task = getRootTask();
                await progressManagedTask(task.taskId, { stage: 'push-api', detail: 'push complete', progressPct: 70 });
            } else {
                endStage('push-api', 'error', res.message || 'push failed', res.message || 'push failed');
                await addLogV2({ timestamp: Date.now(), level: 'error', message: `内容脚本：推送失败：${res.message || '未知错误'}，videoId=${videoId}，magnet=${magnetUrl}` });
            }
        } catch (e: any) {
            result = { success: false, error: e?.message || '推送失败' };
            endStage('push-api', 'error', e?.message || 'push exception', e?.message || 'push exception');
            await addLogV2({ timestamp: Date.now(), level: 'error', message: `内容脚本：推送异常：${e?.message || e || '未知异常'}，videoId=${videoId}，magnet=${magnetUrl}，page=${window.location.href}` });
        }

        if (result.success) {
            // 成功状态
            button.innerHTML = '推送成功';
            button.className = 'button is-success is-small drive115-push-btn';
            showToast(`${magnetName} 推送到115网盘成功`, 'success');



            // 推送成功后自动标记为已看（受设置控制）
            try {
                const autoMark = cachedSettings.autoMarkWatchedAfter115;
                const stars = cachedSettings.autoMarkWatchedStars;
                if (autoMark) {
                    await beginStage('mark-watched', `stars=${stars}`, 80);
                    log('开始标记视频为已看...');
                    console.log('[JavDB Ext] 开始标记视频为已看...');
                    const task = getRootTask();
                    await progressManagedTask(task.taskId, { stage: 'mark-watched', detail: `stars=${stars}`, progressPct: 85 });
                    await markVideoAsWatched(videoId, stars);
                    endStage('mark-watched', 'done', `stars=${stars}`);
                    log('markVideoAsWatched函数执行完毕');
                    console.log('[JavDB Ext] markVideoAsWatched函数执行完毕');

                    // 由于markVideoAsWatched内部会刷新页面，不需要恢复按钮状态
                    await progressManagedTask(task.taskId, { stage: 'done', detail: 'push + mark complete', progressPct: 100 });
                    await completeManagedTask(task.taskId);
                    return;
                }
            } catch (error) {
                endStage('mark-watched', 'error', error instanceof Error ? error.message : String(error), error instanceof Error ? error.message : String(error));
                console.warn('自动标记已看失败或被关闭:', error);
                console.error('[JavDB Ext] 自动标记已看失败或被关闭:', error);
                try {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    showToast(`已推送到115。自动标记已看：${errMsg || '已关闭'}`, 'info');
                } catch {}

                // 关闭或失败时，仍然恢复按钮状态
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.disabled = false;
                    button.className = 'button is-success is-small drive115-push-btn';
                    button.dataset.drive115Force = '1';
                }, 3000);
            }
            const task = getRootTask();
            await progressManagedTask(task.taskId, { stage: 'done', detail: 'push complete', progressPct: 100 });
            await completeManagedTask(task.taskId);
            // 成功后恢复按钮并允许 force 重推（绕过 done 终态复用）
            setTimeout(() => {
                button.innerHTML = originalText || '&nbsp;推送115&nbsp;';
                button.disabled = false;
                button.className = 'button is-success is-small drive115-push-btn';
                button.dataset.drive115Force = '1';
            }, 3000);
        } else {
            throw new Error(result.error || '推送失败');
        }
    } catch (error) {
        if (rootTask) {
            await failManagedTask(rootTask.taskId, error instanceof Error ? error.message : String(error));
        }
        console.error('推送到115网盘失败:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';

        // 错误状态
        button.innerHTML = '推送失败';
        button.className = 'button is-danger is-small drive115-push-btn';

        showToast(`推送失败: ${errorMessage}`, 'error');

        // 3秒后恢复原状态；再次点击可 force 重推
        setTimeout(() => {
            button.innerHTML = originalText || '&nbsp;推送115&nbsp;';
            button.disabled = false;
            button.className = 'button is-success is-small drive115-push-btn';
            button.dataset.drive115Force = '1';
        }, 3000);
    }
}

/**
 * 处理批量下载（通过统一路由逐个推送）
 */
export async function handleBatchDownload(
    button: HTMLButtonElement,
    videoId: string,
    magnetLinks: Array<{ name: string; url: string }>
): Promise<void> {
    try {
        button.disabled = true;
        // 按钮原文本未使用，移除以消除警告
        button.textContent = '批量下载中...';

        const enabled = await isDrive115Enabled();
        if (!enabled) {
            showToast('115网盘功能未启用，请先在设置中启用', 'error');
            return;
        }

        let successCount = 0;
        for (const item of magnetLinks) {
            try {
                const res = await routerDownloadOffline({
                    videoId,
                    magnetUrl: item.url,
                    autoVerify: false,
                });
                if (res.success) successCount++;
            } catch (e) {
                // 单条失败不阻断后续
                console.warn('批量项下载失败:', e);
            }
        }

        showToast(`批量下载完成，成功 ${successCount}/${magnetLinks.length}`, successCount > 0 ? 'success' : 'info');
        button.textContent = successCount > 0 ? '批量完成' : '批量失败';
    } catch (error) {
        console.error('批量下载失败:', error);
        showToast('批量下载失败', 'error');
        button.textContent = '批量失败';
    } finally {
        setTimeout(() => {
            button.disabled = false;
            button.textContent = '批量下载全部';
        }, 3000);
    }
}

/**
 * 标记视频为已看（公共方法）
 */
export async function markVideoAsWatched(videoId: string, stars: number = 4): Promise<void> {
    try {
        log(`开始标记视频为已看: ${videoId}, 星级: ${stars}`);

        // 1. 标记JavDB服务器数据为已看
        await markJavDBAsWatched(stars);

        // 2. 更新扩展番号库数据为已看
        await updateExtensionWatchedStatus(videoId);

        log(`视频 ${videoId} 已成功标记为已看`);
        console.log(`[JavDB Ext] 视频 ${videoId} 已成功标记为已看`);

        // 标记已看成功后，延迟刷新页面让用户看到提示
        log('标记已看完成，准备刷新页面');
        console.log('[JavDB Ext] 标记已看完成，准备刷新页面');

        // 延迟3秒刷新，让用户看到推送成功的提示
        setTimeout(() => {
            try {
                console.log('[JavDB Ext] 开始刷新页面');
                window.location.reload();
            } catch (reloadError) {
                console.error('[JavDB Ext] 刷新失败，尝试其他方法:', reloadError);
                try {
                    window.location.href = window.location.href;
                } catch (hrefError) {
                    console.error('[JavDB Ext] 重新导航失败:', hrefError);
                    window.location.replace(window.location.href);
                }
            }
        }, 3000); // 3秒后刷新，给用户时间看到推送成功提示

    } catch (error) {
        console.error('标记视频为已看失败:', error);
        throw error;
    }
}

/**
 * 标记JavDB服务器数据为已看
 */
async function markJavDBAsWatched(stars: number = 4): Promise<void> {
    try {
        // 获取当前页面的URL和CSRF token
        const currentUrl = window.location.href;
        const videoPath = window.location.pathname; // 例如: /v/bKwmOv

        // 网络联机性预检查
        if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
            throw new Error('当前网络离线，无法连接 JavDB');
        }

        // 优先判断页面状态标签
        const pageStatus = detectPageUserStatusFor115();
        if (pageStatus === 'VIEWED') {
            log('页面已存在“我看過這部影片”标签，跳过标记。');
            return;
        }

        if (pageStatus === 'WANT') {
            // 已存在“我想看”标签，需要通过编辑表单改为 watched
            const formInfo = getEditReviewFormInfo();
            if (!formInfo) {
                throw new Error('未找到编辑表单或表单信息不完整（#edit_review）');
            }

            const actionPath = formInfo.action.startsWith('http') ? formInfo.action : `https://javdb.com${formInfo.action}`;
            const token = formInfo.token || extractCSRFToken();
            if (!token) {
                throw new Error('无法获取CSRF token（编辑表单）');
            }

            const formData = new URLSearchParams({
                '_method': 'put',
                'authenticity_token': token,
                'video_review[status]': 'watched',
                'video_review[score]': String(stars),
                'video_review[content]': '',
                'commit': '保存'
            });

            log(`发送编辑评论（设为已看）请求到: ${actionPath}`);
            const resp = await fetchWithTimeoutRetry(actionPath, {
                method: 'POST',
                headers: {
                    'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7,zh-HK;q=0.6',
                    'Cache-Control': 'no-cache',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Pragma': 'no-cache',
                    'X-CSRF-Token': token,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': currentUrl
                },
                body: formData,
                credentials: 'include'
            }, { retries: 2, timeoutMs: 8000 });

            if (!resp.ok) {
                throw new Error(`JavDB编辑评论失败: HTTP ${resp.status}`);
            }

            log('JavDB服务器编辑评论成功，状态已更新为已看');
            return;
        }

        // 默认：无标签，创建评论标记为已看
        const csrfToken = extractCSRFToken();
        if (!csrfToken) {
            throw new Error('无法获取CSRF token');
        }
        log(`提取到CSRF token: ${csrfToken.substring(0, 20)}...`);

        const reviewsUrl = `https://javdb.com${videoPath}/reviews`;
        const formData = new URLSearchParams({
            'authenticity_token': csrfToken,
            'video_review[score]': String(stars),
            'video_review[content]': '',
            'video_review[status]': 'watched',
            'commit': '保存'
        });
        log(`发送标记已看请求到: ${reviewsUrl}`);
        const response = await fetchWithTimeoutRetry(reviewsUrl, {
            method: 'POST',
            headers: {
                'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7,zh-HK;q=0.6',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Pragma': 'no-cache',
                'X-CSRF-Token': csrfToken,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': currentUrl
            },
            body: formData,
            credentials: 'include'
        }, { retries: 2, timeoutMs: 8000 });

        if (!response.ok) {
            throw new Error(`JavDB标记已看失败: HTTP ${response.status}`);
        }

        log('JavDB服务器标记已看成功');
    } catch (error) {
        console.error('标记JavDB为已看失败:', error);
        throw error;
    }
}

/**
 * 从页面中提取CSRF token
 */
function extractCSRFToken(): string | null {
    try {
        // 方法1: 从meta标签中获取
        const metaToken = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement;
        if (metaToken && metaToken.content) {
            return metaToken.content;
        }

        // 方法2: 从表单中获取
        const formToken = document.querySelector('input[name="authenticity_token"]') as HTMLInputElement;
        if (formToken && formToken.value) {
            return formToken.value;
        }

        // 方法3: 从页面脚本中提取
        const scripts = document.querySelectorAll('script');
        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            const content = script.textContent || '';
            const tokenMatch = content.match(/csrf-token["']\s*content=["']([^"']+)["']/);
            if (tokenMatch) {
                return tokenMatch[1];
            }
        }

        return null;
    } catch (error) {
        console.error('提取CSRF token失败:', error);
        return null;
    }
}

/**
 * 识别当前详情页中用户对该影片的账号状态（我看過/我想看）- 供115标记逻辑使用
 * 返回 'VIEWED' / 'WANT' / null
 */
function detectPageUserStatusFor115(): 'VIEWED' | 'WANT' | null {
    try {
        // 方案1：通过用户区块的链接快速判断
        const watchedAnchor = document.querySelector<HTMLAnchorElement>(
            '.review-title a[href="/users/watched_videos"], .review-title a[href*="/users/watched_videos"]'
        );
        if (watchedAnchor) {
            const text = watchedAnchor.textContent?.trim() || '';
            const tagText = watchedAnchor.querySelector('span.tag')?.textContent?.trim() || '';
            if (text.includes('我看過這部影片') || tagText.includes('我看過這部影片')) {
                return 'VIEWED';
            }
        }

        const wantAnchor = document.querySelector<HTMLAnchorElement>(
            '.review-title a[href="/users/want_watch_videos"], .review-title a[href*="/users/want_watch_videos"]'
        );
        if (wantAnchor) {
            const text = wantAnchor.textContent?.trim() || '';
            const tagText = wantAnchor.querySelector('span.tag')?.textContent?.trim() || '';
            if (text.includes('我想看這部影片') || tagText.includes('我想看這部影片')) {
                return 'WANT';
            }
        }

        // 方案2：全局兜底搜索
        const tagSpans = Array.from(document.querySelectorAll<HTMLSpanElement>('span.tag'));
        if (tagSpans.some(s => (s.textContent || '').includes('我看過這部影片'))) {
            return 'VIEWED';
        }
        if (tagSpans.some(s => (s.textContent || '').includes('我想看這部影片'))) {
            return 'WANT';
        }
    } catch {
        // 忽略识别错误
    }
    return null;
}

/**
 * 从当前页面解析 #edit_review 表单信息
 */
function getEditReviewFormInfo(): { action: string; token: string | null } | null {
    try {
        const form = document.querySelector<HTMLFormElement>('#edit_review');
        if (!form) return null;
        const action = form.getAttribute('action') || '';
        if (!action) return null;
        const tokenInput = form.querySelector<HTMLInputElement>('input[name="authenticity_token"]');
        const token = tokenInput?.value || null;
        return { action, token };
    } catch (e) {
        return null;
    }
}

/**
 * 更新扩展番号库数据为已看
 */
async function updateExtensionWatchedStatus(videoId: string): Promise<void> {
    try {
        log(`更新扩展番号库状态: ${videoId}`);

        // 发送消息到background script更新状态
        const response = await new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('更新状态请求超时'));
            }, 5000);

            chrome.runtime.sendMessage({
                type: 'UPDATE_WATCHED_STATUS',
                videoId: videoId,
                status: 'watched'
            }, (response) => {
                clearTimeout(timeout);

                if (chrome.runtime.lastError) {
                    reject(new Error(`Chrome runtime错误: ${chrome.runtime.lastError.message}`));
                    return;
                }

                resolve(response);
            });
        });

        if (response && response.success) {
            if (response.record && typeof response.record === 'object') {
                setContentRecord(response.record);
            }
            log('扩展番号库状态更新成功');
        } else {
            throw new Error(response?.error || '更新扩展状态失败');
        }
    } catch (error) {
        console.error('更新扩展番号库状态失败:', error);
        throw error;
    }
}

/**
 * 通过跨域消息推送到115网盘（公共方法）
 */
export async function pushToDrive115ViaCrossDomain(params: {
    videoId: string;
    magnetUrl: string;
    magnetName: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
    return new Promise((resolve) => {
        const requestId = `drive115_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        log(`开始跨域推送，请求ID: ${requestId}`);

        // 发送消息到115.com页面
        chrome.runtime.sendMessage({
            type: 'DRIVE115_PUSH',
            videoId: params.videoId,
            magnetUrl: params.magnetUrl,
            magnetName: params.magnetName,
            requestId
        }, (response) => {
            log(`收到响应:`, response);
            log(`Chrome runtime lastError:`, chrome.runtime.lastError);

            if (chrome.runtime.lastError) {
                log(`Chrome runtime错误: ${chrome.runtime.lastError.message}`);
                resolve({
                    success: false,
                    error: `Chrome runtime错误: ${chrome.runtime.lastError.message}`
                });
                return;
            }

            if (!response) {
                log('没有收到任何响应');
                resolve({
                    success: false,
                    error: '没有收到115网盘的响应，请确保已登录115网盘并打开115.com页面'
                });
                return;
            }

            log(`响应类型: ${response.type}, 请求ID匹配: ${response.requestId === requestId}`);

            if (response.type === 'DRIVE115_PUSH_RESPONSE' && response.requestId === requestId) {
                resolve({
                    success: response.success,
                    data: response.data,
                    error: response.error
                });
            } else {
                resolve({
                    success: false,
                    error: `收到无效的响应: ${JSON.stringify(response)}`
                });
            }
        });

        // 30秒超时
        setTimeout(() => {
            log('推送请求超时');
            resolve({
                success: false,
                error: '推送超时，请检查网络连接或115网盘登录状态'
            });
        }, 30000);
    });
}



// renderDrive115Buttons 已优化为按钮直接添加模式

// addDrive115Styles 已集成到主样式系统



// bindDrive115Events 已集成到按钮创建逻辑中

// handleSingleDownload 功能已集成到主流程中



// extractVideoIdFromElement 已集成到videoId模块
