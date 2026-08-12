/**
 * @file contentLifecycle.ts
 * @description contentLifecycle
 * @module apps/content
 */
import { STATE, log } from '../../features/contentState';
import { cleanupVideoDetailObservers } from '../../features/videoDetail';
import { keyboardShortcutsManager } from '../../features/keyboardShortcuts';
import { embyEnhancementManager } from '../../features/embyEnhancement/content';
import { performanceOptimizer } from '../../platform/tasks';
import { contentFilterManager } from '../../features/contentFilter';
import { magnetSearchManager, normalizeMagnetSortMode } from '../../features/magnets';
import { listEnhancementManager } from '../../features/listEnhancement';
import { actorEnhancementManager } from '../../features/actorEnhancement';
import { stopPreviewVideoWatcher } from '../../features/previews';
import { initOrchestrator } from './orchestrator';

type ContentLifecycleCleanup = () => void;

export function exposeContentDebugManagers(): void {
    if (typeof window === 'undefined') return;

    (window as any).listEnhancementManager = listEnhancementManager;
    (window as any).actorEnhancementManager = actorEnhancementManager;
}

export function installContentLifecycleHandlers(cleanups: ContentLifecycleCleanup[] = []): void {
    window.addEventListener('beforeunload', () => {
        try {
            initOrchestrator.dispose();
            cleanups.splice(0).forEach((cleanup) => cleanup());
            stopPreviewVideoWatcher();
            cleanupVideoDetailObservers();
            performanceOptimizer?.cleanup();
            contentFilterManager?.destroy();
            keyboardShortcutsManager?.destroy?.();
            embyEnhancementManager?.destroy();
            magnetSearchManager?.destroy?.();

            log('Resources cleaned up on page unload');
        } catch (error) {
            log('Error during cleanup:', error);
        }
    });

    if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onConnect.addListener((port) => {
            port.onDisconnect.addListener(() => {
                if (chrome.runtime.lastError) {
                    log('[Context] Extension context may be invalidated:', chrome.runtime.lastError.message);
                    performanceOptimizer?.cleanup();
                }
            });
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            log('[Performance] Page hidden, reducing resource usage');
            performanceOptimizer?.updateConfig({
                maxConcurrentRequests: 1,
                domBatchSize: 2,
                domThrottleDelay: 200,
                enableMemoryCleanup: true,
                memoryCleanupInterval: 20000,
            });
            try {
                magnetSearchManager.updateConfig({
                    sources: { sukebei: true, btdig: true, btsow: false, torrentz2: false, javbus: false, custom: [] },
                    maxResults: 8,
                    timeout: 5000,
                });
            } catch {}
        } else {
            log('[Performance] Page visible, restoring normal resource usage');
            try {
                const s = STATE.settings as any;
                const mc = (s?.magnetSearch?.concurrency?.pageMaxConcurrentRequests ?? 2) as number;
                performanceOptimizer?.updateConfig({
                    maxConcurrentRequests: mc,
                    domBatchSize: 5,
                    domThrottleDelay: 100,
                });
                const magnetSearchConfig = s?.magnetSearch || {};
                const sources = magnetSearchConfig.sources || {};
                magnetSearchManager.updateConfig({
                    sources: {
                        sukebei: sources.sukebei !== false,
                        btdig: sources.btdig !== false,
                        btsow: sources.btsow !== false,
                        torrentz2: sources.torrentz2 || false,
                        javbus: sources.javbus === true,
                        custom: [],
                    },
                    sortMode: normalizeMagnetSortMode(magnetSearchConfig.sortMode),
                    maxResults: (magnetSearchConfig.maxResults ?? 15),
                    timeout: (magnetSearchConfig.timeoutMs ?? 8000),
                });
            } catch {
                performanceOptimizer?.updateConfig({ maxConcurrentRequests: 2, domBatchSize: 5, domThrottleDelay: 100 });
            }
        }
    });
}
