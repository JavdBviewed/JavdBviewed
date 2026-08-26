/**
 * @file bootstrap.ts
 * @description bootstrap
 * @module apps/content
 */
// src/apps/content/bootstrap.ts

import { getSettings, getValue } from '../../utils/storage';
import { STORAGE_KEYS, isEmbyRecognitionEnabled } from '../../utils/config';
import type { EmbyLibraryState } from '../../features/embyLibrary/types';
import type { GlobalTaskVisibilityPolicy } from '../../shared/taskCenterTypes';
import { STATE, SELECTORS, log, currentFaviconState, currentTitleStatus } from '../../features/contentState';
import { processVisibleItems, setupObserver } from '../../features/listEnhancement/content/itemProcessor';
import {
    getAutomaticHeavyTaskVisibilityPolicy,
    handleVideoDetailPage,
    getVideoDetailTaskBlueprints,
    normalizeVideoEnhancementSchedulingMode,
} from '../../features/videoDetail';
import { checkAndUpdateVideoStatus } from '../../features/videoStatus';
import { initExportFeature } from '../../features/pageExport/content';
import { initDrive115Features } from '../../features/drive115/content';
import { defaultDataAggregator } from '../../features/dataAggregator';
import { contentFilterManager } from '../../features/contentFilter';
import { keyboardShortcutsManager } from '../../features/keyboardShortcuts';
import { magnetSearchManager, normalizeMagnetSortMode } from '../../features/magnets';
import { anchorOptimizationManager } from '../../features/anchorOptimization/content';
import { listEnhancementManager } from '../../features/listEnhancement';
import { actorEnhancementManager, actorQuickActionsManager } from '../../features/actorEnhancement';
import { embyEnhancementManager } from '../../features/embyEnhancement/content';
import { exposePreviewVolumeDebug, installPreviewVolumeControl } from '../../features/previews';
import { initOrchestrator, type InitPhase } from './orchestrator';
import { initInsightsCollector } from '../../features/insights';
import {
    CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS,
    countContentPerformanceEvent,
    installContentPerformanceDiagnostics,
    performanceOptimizer,
    startContentPerformanceSpan,
} from '../../platform/tasks';
import { actorExtraInfoService } from '../../features/actorRemarks';
import { buildActorRemarksNode, cleanActorRemarksNodes } from '../../features/actorRemarks/actorPageEnhancer';
import { waitForElement } from '../../platform/browser/domUtils';
import { createTaskTimeoutGuard, isTaskTimeoutError } from '../../platform/tasks';
import { PasswordHelper } from '../../features/passwordHelper/content';
import { showEnhancementLoading } from '../../platform/browser/enhancementLoadingIndicator';
import {
    applyOnlineAvailabilitySitePreferences,
    DEFAULT_ONLINE_AVAILABILITY_SITES,
    onlineAvailabilityManager,
} from '../../features/onlineAvailability';
import { initializeSuperRankingNav, isSuperRankingSupportedHost } from '../../features/rankings';
import { installContentConsoleSettingsBridge } from './consoleSettingsBridge';
import { exposeContentDebugManagers, installContentLifecycleHandlers } from './contentLifecycle';
import { installContentMessageRouter } from './contentMessageRouter';
import { installContentTelemetryErrorReporter } from './errorReporter';
import { installOrchestratorStateBridge } from './orchestratorStateBridge';
import { injectNavbarBadge, removeUnwantedButtons } from './pageChrome';
import { getEffectiveEmbyMatchUrls, matchesEmbyUrlPattern } from '../../features/embyEnhancement/domain/matchUrls';
import { shouldInstallStandaloneListObserver } from './listObserverPolicy';
import { loadCurrentPageRecordState } from '../../features/contentState/recordCache';
import { extractVideoIdFromPage } from '../../platform/browser';
import { isJavdbAppearanceSupportedHost, siteAppearanceManager } from '../../features/siteAppearance';
import {
    ContentScreenshotBlurController,
    getContentPageKind,
    resolveContentScreenshotSettings,
} from '../../features/privacy/content/contentScreenshotBlur';

const disposeContentConsoleSettingsBridge = installContentConsoleSettingsBridge();
const contentScreenshotBlurController = new ContentScreenshotBlurController();
const disposeContentScreenshotStorageListener = (() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
        if (area !== 'local' || !changes[STORAGE_KEYS.SETTINGS]) return;
        const nextSettings = changes[STORAGE_KEYS.SETTINGS].newValue as any;
        contentScreenshotBlurController.update(resolveContentScreenshotSettings(nextSettings));
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
})();
installContentPerformanceDiagnostics();
installContentTelemetryErrorReporter();
installOrchestratorStateBridge();
installContentMessageRouter();
void installPreviewVolumeControl();
exposePreviewVolumeDebug();
exposeContentDebugManagers();
installContentLifecycleHandlers([
    disposeContentConsoleSettingsBridge,
    disposeContentScreenshotStorageListener,
    () => contentScreenshotBlurController.destroy(),
    () => siteAppearanceManager?.destroy(),
]);

function getActorRemarksTaskTimeoutMs(settings: any): number {
    const seconds = Number(settings?.videoEnhancement?.actorRemarksTaskTimeoutSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return 10000;
    return Math.max(1000, Math.round(seconds * 1000));
}

function isCurrentPageMatchedByEmby(settings: any): boolean {
    const matchUrls = getEffectiveEmbyMatchUrls(settings?.emby);
    if (!isEmbyRecognitionEnabled(settings?.emby) || matchUrls.length === 0) {
        return false;
    }
    const currentUrl = window.location.href;
    return matchUrls.some((pattern) => matchesEmbyUrlPattern(currentUrl, pattern));
}

export async function runActorRemarksOnActorPage(settings: any, timeoutMs?: number): Promise<void> {
    try {
        // 门控只用自身开关：设置页中「演员备注」是独立 section，
        // 不应再依赖「状态标记增强」主开关（此前双重门控导致只开子开关时完全无效果）
        const enabled = settings?.videoEnhancement?.enableActorRemarks === true;
        if (!enabled) return;

        const taskTimeoutMs = typeof timeoutMs === 'number' && timeoutMs > 0
            ? timeoutMs
            : getActorRemarksTaskTimeoutMs(settings);
        const timeoutGuard = createTaskTimeoutGuard(taskTimeoutMs);
        const mode = (settings?.videoEnhancement?.actorRemarksMode === 'inline') ? 'inline' : 'panel';

        // 演员页标题区有别名/作品数等 meta，必须优先取 .actor-section-name（主名）
        const nameEl = (await waitForElement(
            '.actor-section-name',
            timeoutGuard.timeoutMs > 0 ? Math.min(8000, timeoutGuard.timeoutMs) : 8000,
            200
        )) as HTMLElement | null;
        if (!nameEl) {
            log('actorRemarks(actorPage): .actor-section-name not found');
            return;
        }

        let name = (nameEl.textContent || '').trim();
        name = name.replace(/\s+/g, ' ');
        if (!name) {
            log('actorRemarks(actorPage): actor name is empty');
            return;
        }

        // 骨架先行：先渲染“加载中”节点，任何后续分支都只做原地更新，
        // 保证用户始终能看到功能在运行（而不是等 5~10s 后静默成功/静默失败）
        cleanActorRemarksNodes();
        const node = buildActorRemarksNode({ mode, name, phase: 'loading' });
        nameEl.insertAdjacentElement('afterend', node);

        // 抓取截止时间：给渲染预留 1.5s，下限 2s 保证 wiki 至少有一次完整尝试
        const fetchDeadlineMs = Math.max(2000, taskTimeoutMs - 1500);
        let data: Awaited<ReturnType<typeof actorExtraInfoService.getActorRemarks>> = null;
        let failureMessage = '';
        try {
            data = await actorExtraInfoService.getActorRemarks(name, settings, fetchDeadlineMs);
        } catch (e) {
            failureMessage = e instanceof Error ? e.message : String(e);
        }

        if (timeoutGuard.isTimedOut()) {
            node.replaceWith(buildActorRemarksNode({ mode, name, phase: 'failure', failureMessage: 'timeout' }));
            log('actorRemarks(actorPage): timed out', { taskTimeoutMs });
            return;
        }

        node.replaceWith(buildActorRemarksNode({
            mode,
            name,
            phase: failureMessage ? 'failure' : 'success',
            data,
            failureMessage: failureMessage || undefined,
        }));
        log('actorRemarks(actorPage): injected', {
            mode,
            hasData: Boolean(data),
            source: data?.source,
            failure: failureMessage || undefined,
        });
    } catch (e) {
        if (isTaskTimeoutError(e)) throw e;
        log('actorRemarks(actorPage): failed', e);
    }
}

// --- Core Logic ---

async function initialize(): Promise<void> {
    countContentPerformanceEvent('lifecycle.initialize');
    log('Extension initializing...');

    // 首先初始化性能优化器
    performanceOptimizer.initialize();

    const settingsPromise = getSettings();
    const newWorksConfigPromise = getValue<any>('new_works_config', {});
    const embyLibraryStatePromise = getValue<EmbyLibraryState>(STORAGE_KEYS.EMBY_LIBRARY_STATE, { entries: {}, updatedAt: 0 });

    const settings = await settingsPromise;
    STATE.settings = settings;
    if (isJavdbAppearanceSupportedHost(window.location.hostname)) {
        siteAppearanceManager?.apply(settings.siteAppearance);
    }

    if (getContentPageKind(window.location)) {
        initOrchestrator.add('critical', () => {
            contentScreenshotBlurController.initialize(resolveContentScreenshotSettings(settings));
        }, {
            label: 'privacy:content-screenshot',
            priority: 6,
            visibilityPolicy: 'background_allowed',
        });
    }

    const path = window.location.pathname;
    const isVideoPage = path.startsWith('/v/');
    const isActorPage = path.startsWith('/actors/');
    const preregisterBlueprints: Array<{ phase: InitPhase; label: string; priority?: number; timeout?: number; visibilityPolicy?: GlobalTaskVisibilityPolicy; dependsOn?: string[] }> = [];

    if (isVideoPage) {
        const heavyTaskVisibilityPolicy = getAutomaticHeavyTaskVisibilityPolicy(
            normalizeVideoEnhancementSchedulingMode((settings.videoEnhancement as any)?.schedulingMode),
        );
        preregisterBlueprints.push(...getVideoDetailTaskBlueprints(settings as any));
        if ((settings.videoEnhancement as any)?.showLoadingIndicator !== false) {
            preregisterBlueprints.push({ phase: 'critical', label: 'enhancementUI:showLoadingIndicator', priority: 13, visibilityPolicy: 'background_allowed' });
        }
        preregisterBlueprints.push(
            { phase: 'idle', label: 'drive115:init:video', dependsOn: ['videoStatus:initialSync'] },
            { phase: 'idle', label: 'insights:collector', visibilityPolicy: heavyTaskVisibilityPolicy, dependsOn: ['videoStatus:initialSync'] },
        );
        if ((settings.videoEnhancement as any)?.enableActorQuickActions !== false) {
            preregisterBlueprints.push({ phase: 'high', label: 'actorQuickActions:init', priority: 6, visibilityPolicy: 'background_allowed', dependsOn: ['videoStatus:initialSync'] });
        }
    }

    if (isActorPage) {
        if ((settings.videoEnhancement as any)?.showLoadingIndicator !== false) {
            preregisterBlueprints.push({ phase: 'critical', label: 'enhancementUI:showLoadingIndicator', priority: 13, visibilityPolicy: 'background_allowed' });
        }
        // 与 runActorRemarksOnActorPage 门控保持一致：只用 enableActorRemarks 自身开关
        const enabledActorRemarks = (settings as any)?.videoEnhancement?.enableActorRemarks === true;
        if (enabledActorRemarks) {
            preregisterBlueprints.push({ phase: 'idle', label: 'actorRemarks:actorPage', timeout: getActorRemarksTaskTimeoutMs(settings as any) });
        }
        if (settings.userExperience.enableActorEnhancement !== false) {
            preregisterBlueprints.push({ phase: 'critical', label: 'actorEnhancement:init', visibilityPolicy: 'background_allowed' });
            if ((settings.actorEnhancement as any)?.enableActionButtons !== false) {
                preregisterBlueprints.push({ phase: 'critical', label: 'actorEnhancement:actionButtons', priority: 9, visibilityPolicy: 'background_allowed' });
            }
        }
    }

    if (settings.userExperience.enableKeyboardShortcuts) {
        preregisterBlueprints.push({ phase: 'high', label: 'ux:shortcuts:init', priority: 8 });
    }
    if (isSuperRankingSupportedHost() && (settings.userExperience as any).enableSuperRanking !== false) {
        preregisterBlueprints.push({ phase: 'critical', label: 'superRankingNav:init', priority: 9, visibilityPolicy: 'background_allowed' });
    }
    preregisterBlueprints.push({ phase: 'high', label: 'ui:remove-unwanted', priority: 3, visibilityPolicy: (isVideoPage || isActorPage) ? 'background_allowed' : 'foreground_first' });
    if (settings.userExperience.enableMagnetSearch && isVideoPage) {
        preregisterBlueprints.push({ phase: 'idle', label: 'ux:magnet:autoSearch' });
    }
    if (settings.userExperience.enableAnchorOptimization) {
        preregisterBlueprints.push({ phase: 'deferred', label: 'anchorOptimization:init' });
    }
    if (settings.userExperience.enableListEnhancement !== false && !isVideoPage && !isActorPage) {
        preregisterBlueprints.push(
            { phase: 'high', label: 'listEnhancement:init', priority: 7, visibilityPolicy: 'background_allowed' },
        );
    }
    if (isCurrentPageMatchedByEmby(settings)) {
        preregisterBlueprints.push({ phase: 'deferred', label: 'emby:badge' });
    }
    if (settings.userExperience.enablePasswordHelper) {
        preregisterBlueprints.push({ phase: 'idle', label: 'passwordHelper:init' });
    }
    if (!isVideoPage && !isActorPage) {
        preregisterBlueprints.push({ phase: 'critical', label: 'list:observe:init', visibilityPolicy: 'background_allowed' });
    }
    if (settings.userExperience.enableContentFilter) {
        preregisterBlueprints.push({ phase: 'idle', label: 'contentFilter:initialize' });
    }
    if (!isVideoPage && !isActorPage) {
        preregisterBlueprints.push({ phase: 'idle', label: 'drive115:init:list' });
    }

    await initOrchestrator.preregisterBlueprints(preregisterBlueprints);

    const [newWorksConfig, embyLibraryState] = await Promise.all([
        newWorksConfigPromise,
        embyLibraryStatePromise,
    ]);
    STATE.embyLibraryState = embyLibraryState;
    const endRecordStateSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.bootstrapRecordState);
    try {
        if (isVideoPage) {
            await loadCurrentPageRecordState({ videoId: extractVideoIdFromPage() || undefined });
        } else if (!isActorPage) {
            await loadCurrentPageRecordState({ isListPage: true });
        }
    } finally {
        endRecordStateSpan();
    }
    log(`Loaded ${Object.keys(STATE.records).length} full records and ${Object.keys(STATE.recordSummaries).length} summaries.`);
    log('Display settings:', STATE.settings.display);

    // 提前保存原始 favicon，供后续状态切换使用（优先级最高的 UI 反馈）
    const earlyFaviconLink = document.querySelector<HTMLLinkElement>(SELECTORS.FAVICON);
    if (earlyFaviconLink) {
        STATE.originalFaviconUrl = earlyFaviconLink.href;
        log(`Original favicon URL saved (early): ${STATE.originalFaviconUrl}`);
    } else {
        log('No favicon link found (early)');
    }

    const isCurrentVideoPage = window.location.pathname.startsWith('/v/');
    if (isCurrentVideoPage && (settings.videoEnhancement as any)?.showLoadingIndicator !== false) {
        showEnhancementLoading('video');
        initOrchestrator.add('critical', () => {
            showEnhancementLoading('video');
        }, { label: 'enhancementUI:showLoadingIndicator', priority: 13, visibilityPolicy: 'background_allowed' });
    }

    if (isActorPage && (settings.videoEnhancement as any)?.showLoadingIndicator !== false) {
        showEnhancementLoading('actor');
        initOrchestrator.add('critical', () => {
            showEnhancementLoading('actor');
        }, { label: 'enhancementUI:showLoadingIndicator', priority: 13, visibilityPolicy: 'background_allowed' });
    }
    if (isCurrentVideoPage) {
        initOrchestrator.add('idle', () => initDrive115Features(), { label: 'drive115:init:video', idle: true, idleTimeout: 5000, delayMs: 1500 });

        initOrchestrator.add('idle', async () => {
            await initInsightsCollector();
        }, {
            label: 'insights:collector',
            idle: true,
            idleTimeout: 5000,
            delayMs: 1800,
            visibilityPolicy: getAutomaticHeavyTaskVisibilityPolicy(
                normalizeVideoEnhancementSchedulingMode((settings.videoEnhancement as any)?.schedulingMode),
            ),
            dependsOn: ['videoStatus:initialSync'],
        });

    }

    // 应用磁力搜索的并发与超时（来源于 settings.magnetSearch）
    const magnetCfg = (settings as any).magnetSearch || {};
    const pageMaxConcurrentRequests = (magnetCfg.concurrency?.pageMaxConcurrentRequests ?? 2) as number;
    const magnetRequestTimeout = (magnetCfg.timeoutMs ?? 6000) as number;
    performanceOptimizer.updateConfig({ maxConcurrentRequests: pageMaxConcurrentRequests, requestTimeout: magnetRequestTimeout });

    // 初始化/更新数据聚合器（无论是否启用多源，都严格按设置开启/关闭各来源，避免默认配置引发不必要的网络请求）
    log('Data aggregator configured according to settings');
    defaultDataAggregator.updateConfig({
        sources: {
            // 仅当启用了多源增强时才启用 BlogJav，且降低超时与重试，避免长时间阻塞
            blogJav: {
                enabled: settings.dataEnhancement.enableMultiSource === true,
                baseUrl: 'https://blogjav.net',
                timeout: 8000,
                maxRetries: 1,
            },
            // JavLibrary 已不再使用，禁用
            javLibrary: {
                enabled: false,
                baseUrl: 'https://www.javlibrary.com',
                timeout: 12000,
                maxRetries: 1,
                language: 'en',
            },
            // 传统翻译：当 provider=traditional 且全局翻译开启时启用（方案B：单一开关）
            translator: {
                enabled: (settings.translation?.provider === 'traditional') &&
                         (settings.dataEnhancement.enableTranslation === true),
                service: settings.translation?.traditional?.service || 'google',
                apiKey: settings.translation?.traditional?.apiKey,
                timeout: 5000,
                maxRetries: 1,
                sourceLanguage: settings.translation?.traditional?.sourceLanguage || 'ja',
                targetLanguage: settings.translation?.traditional?.targetLanguage || 'zh-CN',
            },
            // 其余数据源保持关闭
            javStore: { enabled: false, baseUrl: '', timeout: 10000 },
            javSpyl: { enabled: false, baseUrl: '', timeout: 10000 },
            dmm: { enabled: false, baseUrl: '', timeout: 10000 },
            fc2: { enabled: false, baseUrl: '', timeout: 10000 },
        },
    });

    // 无论是否启用多源，都根据翻译设置初始化 AI 翻译配置，确保定点翻译可用
    if (settings.dataEnhancement.enableTranslation && settings.translation?.provider === 'ai') {
        console.log('[JavDB Extension] Initializing AI translator with settings:', {
            enableTranslation: settings.dataEnhancement.enableTranslation,
            provider: settings.translation?.provider,
            aiEnabled: settings.ai?.enabled,
            selectedModel: settings.ai?.selectedModel
        });

        defaultDataAggregator.updateAITranslatorConfig({
            enabled: true,
            useGlobalModel: true, // 已写死使用 AI 设置中的模型
            timeout: 30000,
            maxRetries: 2,
            sourceLanguage: 'ja',
            targetLanguage: 'zh-CN',
        });

        console.log('[JavDB Extension] AI translator configuration updated');
    } else {
        console.log('[JavDB Extension] AI translator not initialized:', {
            enableTranslation: settings.dataEnhancement.enableTranslation,
            provider: settings.translation?.provider,
            reason: !settings.dataEnhancement.enableTranslation ? 'Translation disabled' : 'Provider not AI'
        });
    }

    // 页面类型判断

    // 演员页：演员备注（受主开关控制）
    // 优化：缩短延迟到500ms
    try {
        const enabledActorRemarks = (settings as any)?.videoEnhancement?.enableActorRemarks === true;
        if (enabledActorRemarks && isActorPage) {
            const FLAG = '__jdb_actorRemarks_actorPage_scheduled__';
            if (!(window as any)[FLAG]) {
                (window as any)[FLAG] = true;
                const actorRemarksTaskTimeoutMs = getActorRemarksTaskTimeoutMs(settings as any);
                initOrchestrator.add('idle', async () => {
                    await runActorRemarksOnActorPage(settings as any, actorRemarksTaskTimeoutMs);
                }, { label: 'actorRemarks:actorPage', idle: true, idleTimeout: 5000, delayMs: 500, timeout: actorRemarksTaskTimeoutMs });
            }
        }
    } catch {}

    // 初始化用户体验优化功能（通过编排器注册到合适阶段）
    // 优化：添加微延迟，分批注册任务，减少瞬时压力，优先级8（高）
    if (settings.userExperience.enableKeyboardShortcuts) {
        keyboardShortcutsManager.updateConfig({
            enabled: true,
            showHelp: true,
            enableGlobalShortcuts: true,
            enablePageSpecificShortcuts: true,
        });
        initOrchestrator.add('high', () => keyboardShortcutsManager.initialize(), { label: 'ux:shortcuts:init', delayMs: 0, priority: 8 });
    }

    if (isSuperRankingSupportedHost() && (settings.userExperience as any).enableSuperRanking !== false) {
        initOrchestrator.add('critical', () => initializeSuperRankingNav(), { label: 'superRankingNav:init', priority: 9, visibilityPolicy: 'background_allowed' });
    }

    initOrchestrator.add('high', () => removeUnwantedButtons(), { label: 'ui:remove-unwanted', delayMs: 200, priority: 3, visibilityPolicy: (isVideoPage || isActorPage) ? 'background_allowed' : 'foreground_first' });

    if (settings.userExperience.enableMagnetSearch && isVideoPage) {
        console.log('[JavDB Ext] Scheduling magnet search in idle phase (last)');
        initOrchestrator.add('idle', () => {
            try {
                log('Magnet search manager deferred initialization');
                const magnetSearchConfig = (settings as any).magnetSearch || {};
                const sources = magnetSearchConfig.sources || {};
                magnetSearchManager.updateConfig({
                    enabled: true,
                    showInlineResults: true,
                    showFloatingButton: true,
                    autoSearch: magnetSearchConfig.autoSearch === true,
                    blockMojContent: magnetSearchConfig.blockMojContent !== false,
                    sortMode: normalizeMagnetSortMode(magnetSearchConfig.sortMode),
                    sources: {
                        sukebei: sources.sukebei !== false,
                        btdig: sources.btdig !== false,
                        btsow: sources.btsow !== false,
                        torrentz2: sources.torrentz2 || false,
                        javbus: sources.javbus === true,
                        custom: [],
                    },
                    maxResults: 15,
                    timeout: 8000,
                });
                magnetSearchManager.initialize();
            } catch (e) {
                log('Deferred magnet search initialization failed:', e);
            }
        }, { label: 'ux:magnet:autoSearch', idle: true, idleTimeout: 8000, delayMs: 4000 });
    }

    if (settings.userExperience.enableAnchorOptimization) {
        anchorOptimizationManager.updateConfig({
            enabled: true,
            showPreviewButton: settings.anchorOptimization?.showPreviewButton !== false,
            buttonPosition: settings.anchorOptimization?.buttonPosition || 'right-center',
            customButtons: [],
        });
        initOrchestrator.add('deferred', () => anchorOptimizationManager.initialize(), { label: 'anchorOptimization:init', idle: true, delayMs: 1000 });
    }

    const videoEnhancement = (settings as any)?.videoEnhancement || {};
    if (
        isVideoPage
        && videoEnhancement.enableExternalEntryPanel !== false
        && videoEnhancement.enableOnlineAvailability !== false
    ) {
        initOrchestrator.add('idle', async () => {
            onlineAvailabilityManager.updateConfig({
                enabled: true,
                autoCheck: true,
                showUnavailable: videoEnhancement.showOnlineAvailabilityFailures === true,
                timeoutMs: Number(videoEnhancement.onlineAvailabilityTimeoutMs || 8000),
                sites: applyOnlineAvailabilitySitePreferences(
                    DEFAULT_ONLINE_AVAILABILITY_SITES,
                    videoEnhancement.onlineAvailabilitySites,
                ),
            } as any);
            await onlineAvailabilityManager.initialize();
        }, { label: 'onlineAvailability:check', idle: true, idleTimeout: 8000, delayMs: 1800 });
    }

    // 初始化列表增强功能（列表/演员页常用）
    const listEnhancementEnabled = settings.userExperience.enableListEnhancement !== false;
    if (listEnhancementEnabled) {
        listEnhancementManager.updateConfig({
            enabled: true,
            enableClickEnhancement: settings.listEnhancement?.enableClickEnhancement !== false,
            enableClickEnhancementList: (settings.listEnhancement as any)?.enableClickEnhancementList !== false,
            enableClickEnhancementDetail: (settings.listEnhancement as any)?.enableClickEnhancementDetail !== false,
            enableVideoPreview: settings.listEnhancement?.enableVideoPreview !== false,
            enableListOptimization: settings.listEnhancement?.enableListOptimization !== false,
            enableScrollPaging: settings.listEnhancement?.enableScrollPaging === true,
            previewDelay: settings.listEnhancement?.previewDelay || 1000,
            previewVolume: settings.listEnhancement?.previewVolume ?? 0.2,
            enableRightClickBackground: settings.listEnhancement?.enableRightClickBackground !== false,
            enableActorWatermark: settings.listEnhancement?.enableActorWatermark === true,
            actorWatermarkPosition: (settings.listEnhancement as any)?.actorWatermarkPosition || 'top-right',
            actorWatermarkOpacity: (typeof (settings.listEnhancement as any)?.actorWatermarkOpacity === 'number') ? (settings.listEnhancement as any).actorWatermarkOpacity : 0.8,
            // 新增：演员过滤
            hideBlacklistedActorsInList: (settings.listEnhancement as any)?.hideBlacklistedActorsInList === true,
            hideNonFavoritedActorsInList: (settings.listEnhancement as any)?.hideNonFavoritedActorsInList === true,
            hideUnrecognizedActorsInList: (settings.listEnhancement as any)?.hideUnrecognizedActorsInList !== false, // 默认true
            treatSubscribedAsFavorited: (settings.listEnhancement as any)?.treatSubscribedAsFavorited !== false,
            enableActorPenetration: (settings.listEnhancement as any)?.enableActorPenetration === true,
            enableActorNameMarks: (settings as any)?.videoEnhancement?.enableActorNameMarks !== false,
            // 高质量封面：列表路径已弃用（JavDB 默认高清）；固定 false，配置字段仅兼容存储
            enableHighQualityCover: false,
            // 🆕 列表显示控制
            listDisplayControl: {
                enabled: (settings.listEnhancement as any)?.listDisplayControl?.enabled !== false,
                columnCount: (settings.listEnhancement as any)?.listDisplayControl?.columnCount || 4,
                containerWidth: (settings.listEnhancement as any)?.listDisplayControl?.containerWidth || 100,
                enableContainerExpansion: (settings.listEnhancement as any)?.listDisplayControl?.enableContainerExpansion === true,
            },
            // 🆕 状态标签显示
            showStatusBadge: (settings.listEnhancement as any)?.showStatusBadge !== false, // 默认启用
            popularityEffects: {
                enabled: (settings.listEnhancement as any)?.popularityEffects?.enabled === true,                minRating: Math.max(0, Math.min(5, parseFloat(String((settings.listEnhancement as any)?.popularityEffects?.minRating ?? 4)) || 4)),
                minRatingCount: Math.max(0, parseInt(String((settings.listEnhancement as any)?.popularityEffects?.minRatingCount ?? 350), 10) || 350),
            },
            sorting: {
                enabled: (settings.listEnhancement as any)?.sorting?.enabled === true,
                appendStrategy: (settings.listEnhancement as any)?.sorting?.appendStrategy === 'auto-resort' ? 'auto-resort' : 'prompt',
                autoResortPosition: (settings.listEnhancement as any)?.sorting?.autoResortPosition === 'top' ? 'top' : 'preserve',
            },
        });
        if (!isVideoPage) {
            initOrchestrator.add('high', () => listEnhancementManager.initialize(), { label: 'listEnhancement:init', delayMs: 100, priority: 7, visibilityPolicy: 'background_allowed' });
        }
    }

    // 初始化演员页增强功能（仅演员页 critical）
    if (settings.actorEnhancement?.enabled !== false && isActorPage) {
        const legacyScanButtonEnabled = (settings.actorEnhancement as any)?.enableScanNewWorks === true;
        const showActorPageScanButton = newWorksConfig?.showActorPageScanButton === true || legacyScanButtonEnabled;
        actorEnhancementManager.updateConfig({
            enabled: true,
            autoApplyTags: settings.actorEnhancement?.autoApplyTags !== false,
            defaultTags: settings.actorEnhancement?.defaultTags || ['s', 'd'],
            defaultSortType: settings.actorEnhancement?.defaultSortType || 0,
            enableActionButtons: (settings.actorEnhancement as any)?.enableActionButtons !== false,
            // 新增：演员页“影片分段显示”配置
            enableTimeSegmentationDivider: (settings.actorEnhancement as any)?.enableTimeSegmentationDivider === true,
            timeSegmentationMonths: (settings.actorEnhancement as any)?.timeSegmentationMonths || 6,
            // 新增：演员页"扫描新作品按钮"配置
            enableScanNewWorks: showActorPageScanButton,
        });
        initOrchestrator.add('critical', () => actorEnhancementManager.init(), { label: 'actorEnhancement:init', visibilityPolicy: 'background_allowed' });
    }

    // 初始化演员标记增强功能（仅影片页 high）
    if ((settings.videoEnhancement as any)?.enableActorQuickActions !== false && isVideoPage) {
        actorQuickActionsManager.updateConfig({
            enabled: true,
            showDelay: 300,
            hideDelay: 200,
        });
        initOrchestrator.add('high', () => actorQuickActionsManager.ensureInit('video'), { label: 'actorQuickActions:init', delayMs: 500, priority: 6, visibilityPolicy: 'background_allowed' });
    }

    // 初始化 Emby/Jellyfin 增强功能（延后执行）
    // 优化：缩短延迟到1500ms
    if (isCurrentPageMatchedByEmby(settings)) {
        initOrchestrator.add('deferred', async () => {
            try {
                await embyEnhancementManager.initialize();
            } catch (error) {
                log('Failed to initialize Emby enhancement:', error as any);
            }
        }, { label: 'emby:badge', idle: true, delayMs: 1500 });
    }

    // 初始化密码显示助手（全局生效）
    // 优化：缩短延迟到600ms
    if (settings.userExperience.enablePasswordHelper) {
        const passwordHelperConfig = (settings as any).passwordHelper || { showMethod: 0, waitTime: 300 };
        const passwordHelper = new PasswordHelper(
            passwordHelperConfig.showMethod || 0,
            passwordHelperConfig.waitTime || 350
        );
        initOrchestrator.add('deferred', () => {
            passwordHelper.init();
            log('Password helper initialized');
        }, { label: 'passwordHelper:init', idle: true, delayMs: 600 });
    }

    // 隐私保护功能已通过编排器在 high 阶段初始化

    // 更稳健地识别搜索结果页：不仅依赖 DOM，还检查 URL
    const url = new URL(window.location.href);
    const isSearchPath = url.pathname === '/search';
    const hasQParam = url.searchParams.has('q');
    STATE.isSearchPage = !!document.querySelector(SELECTORS.SEARCH_RESULT_PAGE) || (isSearchPath && hasQParam);
    if (STATE.isSearchPage) {
        log('Search page detected (/search?q=...), hiding functions will be disabled.');
    }

    // 注意：原始 favicon 已在上方提前保存，这里无需再次保存

    // 将列表观察初始化纳入编排器（列表/演员页 critical）
    const pathNow = window.location.pathname;
    if (
        !pathNow.startsWith('/v/')
        && !pathNow.startsWith('/actors/')
        && shouldInstallStandaloneListObserver(listEnhancementEnabled)
    ) {
        initOrchestrator.add('critical', () => {
            processVisibleItems();
            setupObserver();
        }, { label: 'list:observe:init', visibilityPolicy: 'background_allowed' });
    }

    if (settings.userExperience.enableContentFilter) {
        initOrchestrator.add('idle', async () => {
            contentFilterManager.initialize();
            log('Content filter initialized after default hide processing');
        }, { label: 'contentFilter:initialize', idle: true, idleTimeout: 5000, delayMs: 2500 });
    }

    if (!window.location.pathname.startsWith('/v/') && !window.location.pathname.startsWith('/actors/')) {
        initOrchestrator.add('idle', () => initDrive115Features(), { label: 'drive115:init:list', idle: true, idleTimeout: 5000, delayMs: 1800 });
    }

    // 启动统一编排器（处理 deferred / idle 阶段任务）
    try {
        await initOrchestrator.run();
    } catch (e) {
        log('Init orchestrator run failed:', e);
    }

    if (isCurrentVideoPage) {
        void handleVideoDetailPage().catch((e) => {
            log('Video detail bootstrap failed:', e);
        });

        checkAndUpdateVideoStatus();
        let lastStatusSignature = '';
        let stableCount = 0;
        const statusIntervalId = setInterval(() => {
            try {
                countContentPerformanceEvent('interval.videoStatusPolling');
                checkAndUpdateVideoStatus();
                const signature = `${document.title}|${currentFaviconState ?? 'null'}|${currentTitleStatus ?? 'null'}`;
                if (signature === lastStatusSignature && signature.includes('null') === false) {
                    stableCount++;
                } else {
                    stableCount = 0;
                    lastStatusSignature = signature;
                }
                if (stableCount >= 3) {
                    clearInterval(statusIntervalId);
                    log('Status appears stable. Stopping status polling.');
                }
            } catch (e) {
                log('Status polling error:', e);
            }
        }, 5000);
    }

    initExportFeature();
}

// --- Entry Point ---

// 防止重复初始化
let isInitialized = false;

export function onExecute() {
    if (isInitialized) {
        // 静默跳过重复初始化
        return;
    }
    isInitialized = true;
    // 标记已注入，供 background executeScript 检查防重复
    (window as any).__javdbExtensionInjected = true;
    // 内容脚本运行在 isolated world；用无敏感信息的 DOM 标记供隔离性能探针确认真实注入。
    if (document.documentElement) {
        document.documentElement.dataset.javdbExtensionInjected = '1';
    }
    // 立即注入顶栏标识，不等待编排器
    injectNavbarBadge();
    const endInitializeSpan = startContentPerformanceSpan(CONTENT_PERFORMANCE_DIAGNOSTIC_LABELS.bootstrapInitialize);
    initialize()
        .catch(err => console.error('[JavDB Ext] Initialization failed:', err))
        .finally(endInitializeSpan);
}
