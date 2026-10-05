/**
 * @file collectionQuickActionsManager.ts
 * @description 影片页 .movie-panel-info 四实体（番号/導演/片商/系列）hover 快捷收藏（10-05-collection-makers-directors）
 *   - 对齐演员 hover 快捷窗口模式：悬浮实体值链接 300ms 出浮窗，点击=站点收藏 POST，不常显图标
 *   - POST /{entity}/{id}/collect，CSRF 三段 fallback，X-Requested-With，credentials include
 *   - best-effort：成功置「已收藏」态；失败轻 toast 且保留可重试；永不自动取消（无取消入口）
 *   - 站点侧动作，不写本地 ListRecord（本地集合以同步整替为唯一更新路径，避免脏态）
 * @module features/collectionQuick
 */
import { buildCollectUrl, extractCSRFToken, parseEntityLink } from './entityCollect';
import type { ParsedEntityLink } from './entityCollect';
import { showToast } from '../../platform/browser/toast';

export const COLLECTION_QUICK_ACTIONS_BOUND_ATTR = 'data-x-collection-quick-bound';
export const COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR = '.x-collection-quick-tooltip';

const TOOLTIP_CLASS = 'x-collection-quick-tooltip';
const TOOLTIP_STYLE_ID = 'x-collection-quick-tooltip-style';
const SHOW_DELAY_MS = 300;
const PANEL_LINK_SELECTOR =
    '.movie-panel-info a[href*="/video_codes/"],' +
    '.movie-panel-info a[href*="/directors/"],' +
    '.movie-panel-info a[href*="/makers/"],' +
    '.movie-panel-info a[href*="/series/"]';

const ENTITY_LABELS: Record<ParsedEntityLink['entity'], string> = {
    code: '番号',
    director: '導演',
    maker: '片商',
    series: '系列',
};

const TOOLTIP_TEXT = {
    collect: '收藏',
    collected: '已收藏',
    failed: '收藏失败，请稍后重试',
};

const TOOLTIP_CSS = `
.${TOOLTIP_CLASS} { position: fixed; z-index: 2147483000; display: flex; align-items: center; gap: 8px;
    background: rgba(24, 26, 32, 0.96); color: #f5f6f8; padding: 6px 10px; border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28); font-size: 12px; line-height: 1.4; white-space: nowrap; }
.${TOOLTIP_CLASS}-label { opacity: 0.85; }
.${TOOLTIP_CLASS}-btn { border: 0; border-radius: 6px; padding: 3px 10px; cursor: pointer;
    background: #4f8cff; color: #fff; font-size: 12px; }
.${TOOLTIP_CLASS}-btn:hover { background: #3d7bf0; }
.${TOOLTIP_CLASS}-btn:disabled { background: #3a4150; color: #9aa4b2; cursor: default; }
`;

interface BoundLink {
    link: HTMLAnchorElement;
    target: ParsedEntityLink;
}

class CollectionQuickActionsManager {
    private boundLinks = new Set<BoundLink>();
    private tooltip: HTMLElement | null = null;
    private showTimer: ReturnType<typeof setTimeout> | null = null;
    private observer: MutationObserver | null = null;
    private styleEl: HTMLStyleElement | null = null;
    private initDone = false;

    /** 绑定单个实体链接（幂等；非实体链接零绑定） */
    public enhanceEntityLink(link: HTMLElement): void {
        if (!(link instanceof HTMLAnchorElement)) return;
        if (link.hasAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR)) return;
        const target = parseEntityLink(link.getAttribute('href') || '', window.location.href);
        if (!target) return;
        link.setAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR, 'true');
        const entry: BoundLink = { link, target };
        this.boundLinks.add(entry);
        link.addEventListener('mouseenter', () => this.scheduleShow(entry));
        link.addEventListener('mouseleave', () => this.hide());
    }

    /** 页面初始化：扫描既有实体链接 + MutationObserver 跟踪新增（每页只判一次） */
    public ensureInit(): void {
        if (this.initDone) return;
        this.initDone = true;
        if (typeof document === 'undefined' || !document.body) return;
        document.querySelectorAll(PANEL_LINK_SELECTOR).forEach((a) => this.enhanceEntityLink(a as HTMLAnchorElement));
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type !== 'childList') continue;
                for (const node of Array.from(mutation.addedNodes)) this.bindNode(node);
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    /** 释放全部绑定/浮窗/observer/样式（beforeunload 调用） */
    public destroy(): void {
        if (this.showTimer !== null) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
        this.observer?.disconnect();
        this.observer = null;
        this.removeTooltip();
        for (const { link } of this.boundLinks) {
            link.removeAttribute(COLLECTION_QUICK_ACTIONS_BOUND_ATTR);
        }
        this.boundLinks.clear();
        this.styleEl?.remove();
        this.styleEl = null;
        this.initDone = false;
    }

    private bindNode(node: Node): void {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        if (typeof el.matches === 'function' && el.matches(PANEL_LINK_SELECTOR)) {
            this.enhanceEntityLink(el as HTMLAnchorElement);
        }
        if (typeof el.querySelectorAll === 'function') {
            el.querySelectorAll(PANEL_LINK_SELECTOR).forEach((a) => this.enhanceEntityLink(a as HTMLAnchorElement));
        }
    }

    private scheduleShow(entry: BoundLink): void {
        if (this.showTimer !== null) clearTimeout(this.showTimer);
        this.showTimer = setTimeout(() => {
            this.showTimer = null;
            this.showTooltip(entry);
        }, SHOW_DELAY_MS);
    }

    private hide(): void {
        if (this.showTimer !== null) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
        this.removeTooltip();
    }

    private removeTooltip(): void {
        this.tooltip?.remove();
        this.tooltip = null;
    }

    private injectStyles(): void {
        if (this.styleEl || typeof document === 'undefined') return;
        const style = document.createElement('style');
        style.id = TOOLTIP_STYLE_ID;
        style.textContent = TOOLTIP_CSS;
        document.head.appendChild(style);
        this.styleEl = style;
    }

    private showTooltip(entry: BoundLink): void {
        this.removeTooltip();
        this.injectStyles();
        const { target, link } = entry;
        const name = link.textContent?.trim() || target.id;

        const tip = document.createElement('div');
        tip.className = TOOLTIP_CLASS;

        const label = document.createElement('span');
        label.className = `${TOOLTIP_CLASS}-label`;
        label.textContent = `${ENTITY_LABELS[target.entity]}：${name}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${TOOLTIP_CLASS}-btn`;
        btn.textContent = TOOLTIP_TEXT.collect;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void this.collect(entry, btn);
        });

        tip.appendChild(label);
        tip.appendChild(btn);
        document.body.appendChild(tip);
        this.tooltip = tip;
        this.positionTooltip(tip, link);
    }

    private positionTooltip(tip: HTMLElement, link: HTMLAnchorElement): void {
        try {
            const rect = link.getBoundingClientRect();
            const width = tip.offsetWidth || 120;
            const left = Math.max(8, Math.min(rect.right - width, (window.innerWidth || 9999) - width - 8));
            const top = rect.bottom + 6;
            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        } catch {
            // 定位失败不阻塞浮窗展示
        }
    }

    /** 站点收藏 POST（best-effort）；成功=已收藏态，失败=轻 toast 保留可重试 */
    private async collect(entry: BoundLink, btn: HTMLButtonElement): Promise<void> {
        if (btn.disabled) return;
        const { target, link } = entry;
        let origin: string;
        try {
            origin = new URL(link.getAttribute('href') || '', window.location.href).origin;
        } catch {
            showToast(TOOLTIP_TEXT.failed, 'error');
            return;
        }
        const token = extractCSRFToken();
        const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
        if (token) headers['X-CSRF-Token'] = token;
        let resp: Response;
        try {
            resp = await fetch(buildCollectUrl(target.entity, target.id, origin), {
                method: 'POST',
                credentials: 'include',
                headers,
            });
        } catch {
            showToast(TOOLTIP_TEXT.failed, 'error');
            return;
        }
        if (resp.ok) {
            btn.textContent = TOOLTIP_TEXT.collected;
            btn.disabled = true;
        } else {
            showToast(TOOLTIP_TEXT.failed, 'error');
        }
    }
}

export const collectionQuickActionsManager = new CollectionQuickActionsManager();
