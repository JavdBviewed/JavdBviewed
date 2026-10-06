// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
    ContentScreenshotBlurController,
    getContentPageBlurSelectors,
    getContentPageBlurSelectorGroups,
    getContentPageKind,
    isContentScreenshotEnabled,
    resolveContentScreenshotSettings,
} from './contentScreenshotBlur';

const SITES = { javdb: true, javbus: true } as const;

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
        expect(getContentPageKind(new URL('https://javdb575.com/v/abc123'))).toBe('javdb-detail');
        expect(getContentPageKind(new URL('https://seejav.cyou/ABP-123'))).toBe('javbus-detail');
        expect(getContentPageKind(new URL('https://example.com/v/abc123'))).toBeNull();
        expect(getContentPageBlurSelectors(new URL('https://www.javbus.com/ABP-123'))).toContain('.movie');
    });

    it('keeps content screenshot blur disabled by default', () => {
        expect(isContentScreenshotEnabled({})).toBe(false);
        expect(isContentScreenshotEnabled({ enabled: false, sites: { javdb: true, javbus: true } })).toBe(false);
    });

    it('gates content-page blur on the content-page scope only (10-06: master screenshot mode no longer ANDed)', () => {
        // 10-06-site-privacy-blur 语义翻转：总闸不再 AND 内容页范围；dashboard 侧
        // blurAreas/protectedElements/autoBlurTrigger 仍随总闸（另链，零改动）。
        expect(resolveContentScreenshotSettings({ privacy: { screenshotMode: { enabled: false, contentPages: { enabled: true } } } }).enabled).toBe(true);
        expect(resolveContentScreenshotSettings({ privacy: { screenshotMode: { enabled: true, contentPages: { enabled: false } } } }).enabled).toBe(false);
        expect(resolveContentScreenshotSettings({ privacy: { screenshotMode: { enabled: true, contentPages: { enabled: true } } } }).enabled).toBe(true);
        expect(resolveContentScreenshotSettings({ privacy: {} }).enabled).toBe(false);
    });

    it('passes title/image sub-toggles through with default-on semantics', () => {
        const def = resolveContentScreenshotSettings({ privacy: { screenshotMode: { contentPages: { enabled: true } } } });
        expect(def.blurTitles).toBe(true);
        expect(def.blurImages).toBe(true);

        const off = resolveContentScreenshotSettings({ privacy: { screenshotMode: { contentPages: { enabled: true, blurTitles: false, blurImages: false } } } });
        expect(off.blurTitles).toBe(false);
        expect(off.blurImages).toBe(false);
    });

    it('exposes per-page title/image selector groups (10-06 sub-modes)', () => {
        const list = getContentPageBlurSelectorGroups(new URL('https://javdb.com/'));
        expect(list?.titles).toEqual(['.movie-list .item .video-title']);
        expect(list?.images).toEqual(['.movie-list .item .cover']);

        const detail = getContentPageBlurSelectorGroups(new URL('https://javdb570.com/v/abc123'));
        expect(detail?.titles).toEqual(['.movie-panel-info', 'h2.title.is-4']);
        expect(detail?.images).toEqual(['.preview-images', '.sample-waterfall', '.video-cover']);

        const actor = getContentPageBlurSelectorGroups(new URL('https://javdb.com/actors/1'));
        expect(actor?.titles).toEqual(['h2.title.is-4', '.movie-list .item .video-title']);
        expect(actor?.images).toEqual(['.movie-list .item .cover']);

        expect(getContentPageBlurSelectorGroups(new URL('https://example.com/v/abc'))).toBeNull();
    });

    it('keeps javbus groups identical to the legacy full set (no split, conservative)', () => {
        for (const raw of ['https://www.javbus.com/', 'https://www.javbus.com/ABP-123', 'https://www.javbus.com/star/55']) {
            const location = new URL(raw);
            const full = getContentPageBlurSelectors(location);
            const groups = getContentPageBlurSelectorGroups(location);
            expect(groups, raw).not.toBeNull();
            expect(groups?.titles, `titles=${raw}`).toEqual(full);
            expect(groups?.images, `images=${raw}`).toEqual(full);
        }
    });

    it('replaces dead javdb-actor legacy selectors with live ones', () => {
        const location = new URL('https://javdb.com/actors/1');
        const full = getContentPageBlurSelectors(location);
        // 前置核实证：旧三选择器现网全死（静默 no-op），替换为 .movie-list .item + h2.title.is-4
        expect(full).toEqual(['.movie-list .item', 'h2.title.is-4']);
        for (const dead of ['.actor-section', '.actor-list .item', '.performer-list']) {
            expect(full).not.toContain(dead);
            const groups = getContentPageBlurSelectorGroups(location)!;
            expect([...groups.titles, ...groups.images]).not.toContain(dead);
        }
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

    describe('L3 selector mode (10-06: both on = legacy full set, single = group, both off = none)', () => {
        const LIST_FIXTURE = `
            <div class="movie-list">
                <div class="item">
                    <div class="cover"></div>
                    <div class="video-title">ABP-123 title</div>
                    <div class="meta">other</div>
                </div>
                <div class="item">
                    <div class="cover"></div>
                    <div class="video-title">ABC-246 title</div>
                </div>
            </div>`;

        const DETAIL_FIXTURE = `
            <div class="video-detail">
                <div class="video-cover"></div>
                <nav class="movie-panel-info"><h2 class="title is-4">ABP-123</h2></nav>
                <div class="preview-images"></div>
                <div class="sample-waterfall"></div>
            </div>`;

        const ACTOR_FIXTURE = `
            <h2 class="title is-4">Actor name</h2>
            <div class="movie-list">
                <div class="item">
                    <div class="cover"></div>
                    <div class="video-title">ABP-123</div>
                </div>
            </div>`;

        function blurCount(selector: string): number {
            return document.querySelectorAll(`${selector}.jdb-content-privacy-blur`).length;
        }

        function makeController(location: URL): ContentScreenshotBlurController {
            return new ContentScreenshotBlurController(document, location);
        }

        it('list: both on keeps the legacy card-root full set', () => {
            document.body.innerHTML = LIST_FIXTURE;
            const controller = makeController(new URL('https://javdb.com/'));

            controller.initialize({ enabled: true, sites: SITES });

            expect(blurCount('.movie-list .item')).toBe(2);
            // 卡根命中后嵌套元素去重：blur 总数=卡根数
            expect(document.querySelectorAll('.jdb-content-privacy-blur').length).toBe(2);
            controller.destroy();
        });

        it('list: titles only blurs .video-title, not cover nor card root', () => {
            document.body.innerHTML = LIST_FIXTURE;
            const controller = makeController(new URL('https://javdb.com/'));

            controller.initialize({ enabled: true, sites: SITES, blurTitles: true, blurImages: false });

            expect(blurCount('.video-title')).toBe(2);
            expect(blurCount('.cover')).toBe(0);
            expect(blurCount('.item')).toBe(0);
            controller.destroy();
        });

        it('list: images only blurs .cover, not title nor card root', () => {
            document.body.innerHTML = LIST_FIXTURE;
            const controller = makeController(new URL('https://javdb.com/'));

            controller.initialize({ enabled: true, sites: SITES, blurTitles: false, blurImages: true });

            expect(blurCount('.cover')).toBe(2);
            expect(blurCount('.video-title')).toBe(0);
            expect(blurCount('.item')).toBe(0);
            controller.destroy();
        });

        it('list: both sub-toggles off blurs nothing', () => {
            document.body.innerHTML = LIST_FIXTURE;
            const controller = makeController(new URL('https://javdb.com/'));

            controller.initialize({ enabled: true, sites: SITES, blurTitles: false, blurImages: false });

            expect(document.querySelectorAll('.jdb-content-privacy-blur').length).toBe(0);
            controller.destroy();
        });

        it('detail: titles only blurs the info panel (nested h2 deduped)', () => {
            document.body.innerHTML = DETAIL_FIXTURE;
            const controller = makeController(new URL('https://javdb.com/v/abc123'));

            controller.initialize({ enabled: true, sites: SITES, blurTitles: true, blurImages: false });

            expect(blurCount('.movie-panel-info')).toBe(1);
            expect(blurCount('.video-detail')).toBe(0);
            expect(blurCount('.preview-images')).toBe(0);
            expect(blurCount('.sample-waterfall')).toBe(0);
            expect(blurCount('.video-cover')).toBe(0);
            expect(document.querySelectorAll('.jdb-content-privacy-blur').length).toBe(1);
            controller.destroy();
        });

        it('actor: both on blurs the actor title and work cards', () => {
            document.body.innerHTML = ACTOR_FIXTURE;
            const controller = makeController(new URL('https://javdb.com/actors/1'));

            controller.initialize({ enabled: true, sites: SITES });

            expect(blurCount('h2.title.is-4')).toBe(1);
            expect(blurCount('.movie-list .item')).toBe(1);
            controller.destroy();
        });

        it('actor: titles only blurs title + card titles, not card root or cover', () => {
            document.body.innerHTML = ACTOR_FIXTURE;
            const controller = makeController(new URL('https://javdb.com/actors/1'));

            controller.initialize({ enabled: true, sites: SITES, blurTitles: true, blurImages: false });

            expect(blurCount('h2.title.is-4')).toBe(1);
            expect(blurCount('.video-title')).toBe(1);
            expect(blurCount('.movie-list .item')).toBe(0);
            expect(blurCount('.cover')).toBe(0);
            controller.destroy();
        });
    });
});
