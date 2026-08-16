/**
 * JavDB/JavBus 普通内容页的截图模糊保护。
 *
 * 该模块只负责页面内容的截图模糊，不初始化私密模式、密码或锁屏。
 */

export type ContentPageKind =
    | 'javdb-list'
    | 'javdb-detail'
    | 'javdb-actor'
    | 'javbus-list'
    | 'javbus-detail'
    | 'javbus-actor';

export interface ContentScreenshotSettings {
    enabled?: boolean;
    sites?: {
        javdb?: boolean;
        javbus?: boolean;
    };
    blurIntensity?: number;
}

export function resolveContentScreenshotSettings(settings: {
    privacy?: {
        screenshotMode?: {
            enabled?: boolean;
            blurIntensity?: number;
            contentPages?: ContentScreenshotSettings;
        };
    };
} | undefined): ContentScreenshotSettings {
    const screenshotMode = settings?.privacy?.screenshotMode;
    const contentPages = screenshotMode?.contentPages;
    return {
        enabled: screenshotMode?.enabled === true && contentPages?.enabled === true,
        sites: {
            javdb: contentPages?.sites?.javdb !== false,
            javbus: contentPages?.sites?.javbus !== false,
        },
        blurIntensity: screenshotMode?.blurIntensity,
    };
}

type ContentLocation = Pick<Location, 'hostname' | 'pathname'> | URL;

const BLUR_CLASS = 'jdb-content-privacy-blur';
const BLUR_ATTRIBUTE = 'data-jdb-content-privacy-blur';
const STYLE_ID = 'jdb-content-privacy-blur-style';

const SELECTORS: Record<ContentPageKind, readonly string[]> = {
    'javdb-list': ['.movie-list .item', '.grid-item', '.search-result'],
    'javdb-detail': ['.video-detail', '.movie-panel-info', '.preview-images', '.sample-waterfall'],
    'javdb-actor': ['.actor-section', '.actor-list .item', '.performer-list'],
    'javbus-list': ['.movie-box', '.item', '.search-result'],
    'javbus-detail': ['.movie', '.movie-box', '.sample-box'],
    'javbus-actor': ['.star-box', '.star-photo', '.star-info'],
};

const JAVDB_HOSTS = new Set(['javdb.com', 'javdb570.com', 'javdb36.com']);
const JAVBUS_HOSTS = new Set(['javbus.com', 'seejav.cyou', 'busjav.cyou', 'fanbus.cyou']);

function getSite(hostname: string): 'javdb' | 'javbus' | null {
    const normalized = hostname.toLowerCase().replace(/^www\./, '');
    if (JAVDB_HOSTS.has(normalized) || normalized.endsWith('.javdb.com')) return 'javdb';
    if (JAVBUS_HOSTS.has(normalized) || normalized.endsWith('.javbus.com')) return 'javbus';
    return null;
}

function getPageKind(site: 'javdb' | 'javbus', pathname: string): ContentPageKind {
    const path = pathname.toLowerCase();
    const isActor = site === 'javdb' ? path.startsWith('/actors/') : path.startsWith('/star/');
    if (isActor) return `${site}-actor`;

    const isDetail = site === 'javdb'
        ? path.startsWith('/v/')
        : path.startsWith('/movie/') || (/^\/[a-z0-9]+-[a-z0-9]+(?:[/?]|$)/i.test(path) && !path.startsWith('/search'));
    return isDetail ? `${site}-detail` : `${site}-list`;
}

export function getContentPageKind(location: ContentLocation): ContentPageKind | null {
    const site = getSite(location.hostname);
    return site ? getPageKind(site, location.pathname) : null;
}

export function getContentPageBlurSelectors(location: ContentLocation): readonly string[] {
    const pageKind = getContentPageKind(location);
    return pageKind ? SELECTORS[pageKind] : [];
}

export function isContentScreenshotEnabled(settings: ContentScreenshotSettings | undefined): boolean {
    return settings?.enabled === true;
}

export class ContentScreenshotBlurController {
    private observer: MutationObserver | null = null;
    private readonly protectedElements = new Set<HTMLElement>();
    private readonly document: Document;
    private readonly location: ContentLocation;
    private selectors: readonly string[] = [];
    private blurRadius = 8;

    constructor(doc: Document = document, location: ContentLocation = window.location) {
        this.document = doc;
        this.location = location;
    }

    initialize(settings: ContentScreenshotSettings | undefined): boolean {
        this.destroy();
        const pageKind = getContentPageKind(this.location);
        const site = pageKind?.startsWith('javdb') ? 'javdb' : pageKind?.startsWith('javbus') ? 'javbus' : null;
        const siteEnabled = site ? settings?.sites?.[site] !== false : false;
        if (!pageKind || !isContentScreenshotEnabled(settings) || !siteEnabled) return false;

        this.selectors = getContentPageBlurSelectors(this.location);
        this.blurRadius = this.getBlurRadius(settings?.blurIntensity);
        this.injectStyles();
        this.protectMatchingElements(this.document);
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof HTMLElement) this.protectMatchingElements(node);
                });
            }
        });
        this.observer.observe(this.document.documentElement, { childList: true, subtree: true });
        return true;
    }

    update(settings: ContentScreenshotSettings | undefined): boolean {
        return this.initialize(settings);
    }

    destroy(): void {
        this.observer?.disconnect();
        this.observer = null;
        for (const element of this.protectedElements) {
            element.classList.remove(BLUR_CLASS);
            element.removeAttribute(BLUR_ATTRIBUTE);
        }
        this.protectedElements.clear();
        this.document.getElementById(STYLE_ID)?.remove();
        this.selectors = [];
    }

    private protectMatchingElements(root: Document | HTMLElement): void {
        const candidates = new Set<HTMLElement>();
        for (const selector of this.selectors) {
            try {
                if (root instanceof HTMLElement && root.matches(selector)) candidates.add(root);
                root.querySelectorAll(selector).forEach((element) => {
                    if (element instanceof HTMLElement) candidates.add(element);
                });
            } catch {
                // 选择器由内置常量提供，单个无效选择器不应阻断其他保护区域。
            }
        }

        for (const element of candidates) {
            if (element.closest(`.${BLUR_CLASS}`)) continue;
            element.classList.add(BLUR_CLASS);
            element.setAttribute(BLUR_ATTRIBUTE, 'true');
            this.protectedElements.add(element);
        }
    }

    private injectStyles(): void {
        const style = this.document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `.${BLUR_CLASS} { filter: blur(${this.blurRadius}px); }`;
        (this.document.head || this.document.documentElement).appendChild(style);
    }

    private getBlurRadius(intensity: number | undefined): number {
        if (!Number.isFinite(intensity)) return 8;
        return Math.max(4, Math.min(16, Math.round(Number(intensity) * 1.6)));
    }
}
