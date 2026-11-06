/**
 * @file previewVolumeControl.ts
 * @description previewVolumeControl
 * @module features/previews
 */
import { getSettings } from '../../utils/storage';
import { log } from '../contentState';
import { activatePreviewVideoPreload, releasePreviewVideoMedia } from './previewVideoPreload';

let currentVolume = 0.2;
let previewVideoWatcherTimer: number | null = null;

export async function installPreviewVolumeControl(): Promise<void> {
    try {
        const settings = await getSettings();
        currentVolume = settings.listEnhancement?.previewVolume ?? 0.2;
        log(`🎵 Volume control init: ${Math.round(currentVolume * 100)}%`);

        const livePreviews = new WeakSet<HTMLVideoElement>();
        const restoreLiveVolume = (event: Event): void => {
            const video = event.target;
            if (!(video instanceof HTMLVideoElement) || !livePreviews.has(video)) return;
            if (!isActivePreviewVideo(video)) {
                livePreviews.delete(video);
                return;
            }
            if (event.type === 'volumechange' && video.dataset.jdbNativePreviewAttached === '1' && video.paused) return;
            if (video.muted || video.volume !== currentVolume) applyVolume(video, false);
        };
        document.addEventListener('playing', restoreLiveVolume, true);
        document.addEventListener('volumechange', restoreLiveVolume, true);

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'volume-changed') {
                currentVolume = message.volume;
                log(`🎚️ Volume updated: ${Math.round(currentVolume * 100)}%`);
                document.querySelectorAll<HTMLVideoElement>('video').forEach(video => {
                    if (!isActivePreviewVideo(video)) return;
                    livePreviews.add(video);
                    applyVolume(video, false);
                });
                sendResponse({ success: true });
                return false;
            }
            return false;
        });

        document.addEventListener('click', (e) => {
            const target = e.target as Element;
            const link = target.closest('a[data-fancybox], a[href*="preview-video"]');

            if (link) {
                log('🎬 Preview clicked!');

                setTimeout(() => handleVideos(), 500);
                setTimeout(() => handleVideos(), 1000);
                setTimeout(() => handleVideos(), 2000);
                startPreviewVideoWatcher();
            }
        });

        log('✅ Volume control ready');
    } catch (error) {
        log('❌ Volume control failed:', error);
    }
}

export function stopPreviewVideoWatcher(): void {
    if (previewVideoWatcherTimer === null) {
        return;
    }

    window.clearInterval(previewVideoWatcherTimer);
    previewVideoWatcherTimer = null;
}

export function exposePreviewVolumeDebug(): void {
    if (typeof window === 'undefined') return;

    (window as any).javdbVolumeControl = {
        checkVideos: () => {
            const videos = document.querySelectorAll('video');
            console.log(`Found ${videos.length} videos:`, videos);
            return videos;
        },
        forceApply: (volume = 0.75) => {
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
                video.muted = false;
                video.volume = volume;
                console.log(`Applied volume ${volume} to video:`, video);
            });
        },
        getCurrentVolume: () => currentVolume,
        handleVideos,
    };
}

function handleVideos(): void {
    const videos = document.querySelectorAll('video');
    log(`📹 Found ${videos.length} videos`);

    videos.forEach((video, index) => {
        const v = video as HTMLVideoElement;
        const style = getComputedStyle(v);

        log(`Video ${index + 1}: id=${v.id}, display=${style.display}, muted=${v.muted}, volume=${v.volume}`);

        if (isPreviewVideo(v) && style.display !== 'none') {
            applyVolume(v);
        }
    });
}

function startPreviewVideoWatcher(): void {
    if (previewVideoWatcherTimer !== null) {
        return;
    }

    previewVideoWatcherTimer = window.setInterval(() => {
        const previewVideos = Array.from(document.querySelectorAll('video')).filter(video => isPreviewVideo(video as HTMLVideoElement)) as HTMLVideoElement[];
        const fancyboxOpen = document.querySelector('.fancybox-is-open') !== null;

        if (previewVideos.length === 0 || !fancyboxOpen) {
            previewVideos.forEach(video => releasePreviewVideoMedia(video));
            stopPreviewVideoWatcher();
            return;
        }

        previewVideos.forEach(video => {
            if (getComputedStyle(video).display !== 'none') {
                activatePreviewVideoPreload(video);
            }
        });
    }, 500);
}

function isPreviewVideo(video: HTMLVideoElement): boolean {
    return video.id === 'preview-video' ||
           video.classList.contains('fancybox-video') ||
           video.classList.contains('x-preview-video') ||
           video.closest('.preview-video-container') !== null;
}

function isActivePreviewVideo(video: HTMLVideoElement): boolean {
    return isPreviewVideo(video) && getComputedStyle(video).display !== 'none' &&
           (video.closest('.fancybox-is-open, .preview-video-container, .x-holding') !== null ||
            video.dataset.jdbNativePreviewAttached === '1' ||
            (video.id === 'preview-video' && !video.paused));
}

function applyVolume(video: HTMLVideoElement, activateMedia = true): void {
    log(`🔧 Applying volume ${Math.round(currentVolume * 100)}% to: ${video.id}`);

    try {
        if (activateMedia) activatePreviewVideoPreload(video);
        log(`  Before: muted=${video.muted}, volume=${video.volume}`);

        video.muted = false;
        video.volume = currentVolume;

        log(`  After: muted=${video.muted}, volume=${video.volume}`);

        addVolumeIndicator(video);
    } catch (error) {
        log('❌ Apply volume error:', error);
    }
}

function addVolumeIndicator(video: HTMLVideoElement): void {
    try {
        const container = video.parentElement;
        if (!container) return;

        const existing = container.querySelector('.volume-indicator');
        if (existing) existing.remove();

        const indicator = document.createElement('div');
        indicator.className = 'volume-indicator';
        indicator.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            z-index: 9999;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        indicator.textContent = `🔊 ${Math.round(currentVolume * 100)}%`;

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        container.appendChild(indicator);

        setTimeout(() => indicator.style.opacity = '1', 100);

        setTimeout(() => {
            indicator.style.opacity = '0';
            setTimeout(() => {
                if (indicator.parentNode) indicator.remove();
            }, 300);
        }, 3000);
    } catch (error) {
        log('❌ Add indicator error:', error);
    }
}
