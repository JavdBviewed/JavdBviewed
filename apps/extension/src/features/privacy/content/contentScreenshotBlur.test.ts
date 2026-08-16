// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
    ContentScreenshotBlurController,
    getContentPageBlurSelectors,
    getContentPageKind,
    isContentScreenshotEnabled,
    resolveContentScreenshotSettings,
} from './contentScreenshotBlur';

describe('content screenshot privacy', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.querySelector('#jdb-content-privacy-blur-style')?.remove();
    });

    it('recognizes JavDB detail pages and their outer content containers', () => {
        const location = new URL('https://javdb.com/v/abc123');

        expect(getContentPageKind(location)).toBe('javdb-detail');
        expect(getContentPageBlurSelectors(location)).toContain('.video-detail');
        expect(getContentPageBlurSelectors(location)).toContain('.movie-panel-info');
    });

    it('recognizes JavBus content pages without matching unrelated hosts', () => {
        expect(getContentPageKind(new URL('https://www.javbus.com/ABP-123'))).toBe('javbus-detail');
        expect(getContentPageKind(new URL('https://javdb570.com/v/abc123'))).toBe('javdb-detail');
        expect(getContentPageKind(new URL('https://seejav.cyou/ABP-123'))).toBe('javbus-detail');
        expect(getContentPageKind(new URL('https://example.com/v/abc123'))).toBeNull();
        expect(getContentPageBlurSelectors(new URL('https://www.javbus.com/ABP-123'))).toContain('.movie');
    });

    it('keeps content screenshot blur disabled by default', () => {
        expect(isContentScreenshotEnabled({})).toBe(false);
        expect(isContentScreenshotEnabled({ enabled: false, sites: { javdb: true, javbus: true } })).toBe(false);
    });

    it('requires the global screenshot mode and the content-page scope', () => {
        expect(resolveContentScreenshotSettings({ privacy: { screenshotMode: { enabled: false, contentPages: { enabled: true } } } }).enabled).toBe(false);
        expect(resolveContentScreenshotSettings({ privacy: { screenshotMode: { enabled: true, contentPages: { enabled: true } } } }).enabled).toBe(true);
    });

    it('does not protect DOM when the scope is disabled', () => {
        document.body.innerHTML = '<div class="video-detail">secret</div>';
        const controller = new ContentScreenshotBlurController(document, new URL('https://javdb.com/v/abc123'));

        controller.initialize({ enabled: false, sites: { javdb: true, javbus: true } });

        expect(document.querySelector('.video-detail')?.classList.contains('jdb-content-privacy-blur')).toBe(false);
        expect(document.querySelector('#jdb-content-privacy-blur-style')).toBeNull();
        controller.destroy();
    });

    it('protects existing and dynamically appended content, then cleans it up', async () => {
        document.body.innerHTML = '<div class="video-detail">secret</div>';
        const controller = new ContentScreenshotBlurController(document, new URL('https://javdb.com/v/abc123'));

        controller.initialize({ enabled: true, sites: { javdb: true, javbus: false } });
        expect(document.querySelector('.video-detail')?.classList.contains('jdb-content-privacy-blur')).toBe(true);

        const appended = document.createElement('div');
        appended.className = 'preview-images';
        document.body.appendChild(appended);
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(appended.classList.contains('jdb-content-privacy-blur')).toBe(true);

        controller.destroy();
        expect(document.querySelector('.video-detail')?.classList.contains('jdb-content-privacy-blur')).toBe(false);
        expect(appended.classList.contains('jdb-content-privacy-blur')).toBe(false);
        expect(document.querySelector('#jdb-content-privacy-blur-style')).toBeNull();
    });

    it('uses offline JavDB detail structure without initializing private mode', () => {
        document.body.innerHTML = `
            <div class="video-detail" data-controller="movie-detail">
                <div class="video-cover"></div>
                <nav class="panel movie-panel-info"><div class="panel-block">ABP-123</div></nav>
                <div class="sample-waterfall"></div>
            </div>`;
        const controller = new ContentScreenshotBlurController(document, new URL('https://javdb.com/v/fixture'));

        controller.initialize({ enabled: true, sites: { javdb: true, javbus: true } });

        expect(document.querySelectorAll('.jdb-content-privacy-blur').length).toBe(1);
        expect(document.querySelector('#privacy-lock-screen')).toBeNull();
        controller.destroy();
    });
});
