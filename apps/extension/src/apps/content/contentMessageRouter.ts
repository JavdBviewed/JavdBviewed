/**
 * @file contentMessageRouter.ts
 * @description contentMessageRouter
 * @module apps/content
 */
import { getSettings, getValue } from '../../utils/storage';
import { STORAGE_KEYS } from '../../utils/config';
import { STATE, log } from '../../features/contentState';
import { processVisibleItems } from '../../features/listEnhancement/content/itemProcessor';
import { showToast } from '../../platform/browser/toast';
import { extractVideoIdFromPage } from '../../platform/browser';
import { videoDetailEnhancer } from '../../features/videoDetail';
import { refreshActorMarksOnPage, runActorRemarksQuick } from '../../features/videoDetail';
import { contentFilterManager } from '../../features/contentFilter';
import { listEnhancementManager } from '../../features/listEnhancement';
import { actorEnhancementManager } from '../../features/actorEnhancement';
import { embyEnhancementManager } from '../../features/embyEnhancement/content';
import { renderDetailLibraryStatus } from '../../features/embyLibrary/content/statusBadges';
import type { EmbyLibraryState } from '../../features/embyLibrary/types';
import { destroySuperRankingNav, initializeSuperRankingNav, isSuperRankingSupportedHost } from '../../features/rankings';
import { isJavdbAppearanceSupportedHost, siteAppearanceManager } from '../../features/siteAppearance';

export function installContentMessageRouter(): void {
    try {
        window.addEventListener('actor-state-changed', async () => {
            try {
                listEnhancementManager.reapplyActorHidingForAll?.();
            } catch (e) {
                log('Failed to reapply actor-based list hiding after actor state change:', e as any);
            }

            try {
                if (window.location.pathname.startsWith('/v/')) {
                    await refreshActorMarksOnPage();
                }
            } catch (e) {
                log('Failed to refresh actor marks after actor state change:', e as any);
            }
        });
    } catch (e) {
        log('Failed to bind actor-state-changed listener:', e as any);
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'settings-updated') {
            log('Settings updated, reloading settings and reprocessing items');
            Promise.resolve((message && message.settings) || null).then(async (incomingSettings) => {
                const loadedSettings = await getSettings();
                const settings = incomingSettings
                    ? { ...loadedSettings, ...incomingSettings, emby: { ...loadedSettings.emby, ...(incomingSettings as any).emby } }
                    : loadedSettings;
                STATE.settings = settings;
                if (isJavdbAppearanceSupportedHost(window.location.hostname)) {
                    siteAppearanceManager?.apply(settings.siteAppearance);
                } else {
                    siteAppearanceManager?.destroy();
                }
                try {
                    if (isSuperRankingSupportedHost() && (settings.userExperience as any)?.enableSuperRanking !== false) {
                        initializeSuperRankingNav();
                    } else {
                        destroySuperRankingNav();
                    }
                } catch (e) {
                    log('Failed to refresh super ranking navigation after settings update:', e as any);
                }
                log('Updated display settings:', settings.display);
                log('Updated translation targets:', (STATE.settings as any)?.translation?.targets);
                processVisibleItems({ force: true });

                try {
                    listEnhancementManager.updateConfig({
                        hideBlacklistedActorsInList: (settings.listEnhancement as any)?.hideBlacklistedActorsInList === true,
                        hideNonFavoritedActorsInList: (settings.listEnhancement as any)?.hideNonFavoritedActorsInList === true,
                        hideUnrecognizedActorsInList: (settings.listEnhancement as any)?.hideUnrecognizedActorsInList !== false,
                        treatSubscribedAsFavorited: (settings.listEnhancement as any)?.treatSubscribedAsFavorited !== false,
                        listDisplayControl: {
                            enabled: (settings.listEnhancement as any)?.listDisplayControl?.enabled !== false,
                            columnCount: (settings.listEnhancement as any)?.listDisplayControl?.columnCount || 4,
                            containerWidth: (settings.listEnhancement as any)?.listDisplayControl?.containerWidth || 100,
                            enableContainerExpansion: (settings.listEnhancement as any)?.listDisplayControl?.enableContainerExpansion === true,
                        },
                        popularityEffects: {
                            enabled: (settings.listEnhancement as any)?.popularityEffects?.enabled === true,
                            minRating: Math.max(0, Math.min(5, parseFloat(String((settings.listEnhancement as any)?.popularityEffects?.minRating ?? 4)) || 4)),
                            minRatingCount: Math.max(0, parseInt(String((settings.listEnhancement as any)?.popularityEffects?.minRatingCount ?? 350), 10) || 350),
                        },
                        sorting: {
                            enabled: (settings.listEnhancement as any)?.sorting?.enabled === true,
                            appendStrategy: (settings.listEnhancement as any)?.sorting?.appendStrategy === 'auto-resort' ? 'auto-resort' : 'prompt',
                            autoResortPosition: (settings.listEnhancement as any)?.sorting?.autoResortPosition === 'top' ? 'top' : 'preserve',
                        },
                    });
                    listEnhancementManager.reapplyActorHidingForAll?.();
                } catch (e) {
                    log('Failed to reapply actor-based list hiding after settings update:', e as any);
                }

                if (settings.userExperience.enableContentFilter) {
                    setTimeout(() => {
                        const keywordRules = settings.contentFilter?.keywordRules || [];
                        contentFilterManager.updateKeywordRules(keywordRules);
                        log('Content filter reapplied after settings update');
                    }, 100);
                }

                try {
                    embyEnhancementManager.refresh?.();
                } catch (e) {
                    log('Failed to refresh Emby enhancement after settings update:', e as any);
                }

                try {
                    if (window.location.pathname.startsWith('/v/')) {
                        const videoId = extractVideoIdFromPage();
                        if (videoId) {
                            renderDetailLibraryStatus(videoId);
                        }
                        await videoDetailEnhancer.refreshTranslationFromSettings();
                        await refreshActorMarksOnPage();
                        await runActorRemarksQuick();
                        log('Video detail enhancement reapplied after settings update');
                    }
                } catch (e) {
                    log('Failed to reapply video detail enhancement after settings update:', e as any);
                }
            });
            return false;
        } else if (message.type === 'EMBY_LIBRARY_STATE_UPDATED') {
            getValue<EmbyLibraryState>(STORAGE_KEYS.EMBY_LIBRARY_STATE, { entries: {}, updatedAt: 0 })
                .then((state) => {
                    STATE.embyLibraryState = state;
                    processVisibleItems({ force: true });
                    const videoId = extractVideoIdFromPage();
                    if (videoId) {
                        renderDetailLibraryStatus(videoId);
                    }
                    sendResponse({ success: true });
                })
                .catch((error) => {
                    log('Failed to reload Emby library state:', error as any);
                    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
                });
            return true;
        } else if (message.type === 'show-toast') {
            log('Received toast message:', message.message, message.toastType);
            try {
                showToast(message.message, message.toastType || 'info');
            } catch (err) {
                console.error('[JavDB Ext] Failed to show toast:', err);
            }
            return false;
        } else if (message.type === 'UPDATE_CONTENT_FILTER') {
            if (message.keywordRules) {
                processVisibleItems({ force: true });
                setTimeout(() => {
                    contentFilterManager.updateKeywordRules(message.keywordRules);
                    log(`Content filter rules updated: ${message.keywordRules.length} rules`);
                }, 100);
            }
            return false;
        } else if (message.type === 'ACTOR_ENHANCEMENT_SAVE_FILTER') {
            actorEnhancementManager.saveCurrentTagFilter()
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch((error: any) => {
                    console.error('保存演员页过滤器失败:', error);
                    sendResponse({ success: false, error: (error && error.message) || String(error) });
                });
            return true;
        } else if (message.type === 'ACTOR_ENHANCEMENT_CLEAR_FILTERS') {
            actorEnhancementManager.clearSavedFilters()
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch((error: any) => {
                    console.error('清除演员页过滤器失败:', error);
                    sendResponse({ success: false, error: (error && error.message) || String(error) });
                });
            return true;
        } else if (message.type === 'ACTOR_ENHANCEMENT_GET_STATUS') {
            try {
                sendResponse(actorEnhancementManager.getStatus());
            } catch (error: any) {
                console.error('获取演员页状态失败:', error);
                sendResponse({ error: error.message });
            }
            return false;
        }
        return false;
    });
}
