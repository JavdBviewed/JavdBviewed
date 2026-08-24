/**
 * Emby/Jellyfin 增强功能
 * 在 Emby/Jellyfin 等媒体服务器页面中识别番号并转换为可点击的链接
 */

import { STATE, log } from '../../contentState';
import { extractVideoId } from '../../../platform/browser';
import { showToast } from '../../../platform/browser/toast';
import { getEffectiveEmbyMatchUrls, matchesEmbyUrlPattern } from '../domain/matchUrls';
import { extractVideoCodesFromText } from '../../../shared/utils/videoCodeExtractor';
import { isEmbyRecognitionEnabled } from '../../../utils/config';

interface EmbyConfig {
    enabled: boolean;
    matchUrls: string[];
    mediaServers?: unknown;
    videoCodePatterns: string[];
    linkBehavior: 'javdb-direct' | 'javdb-search';
    enableAutoDetection: boolean;
    highlightStyle: {
        backgroundColor: string;
        color: string;
        borderRadius: string;
        padding: string;
    };
    // 右侧悬浮快捷按钮显示控制
    showQuickSearchCode?: boolean;
    showQuickSearchActor?: boolean;
}

interface VideoLinkTarget {
    raw: string;
    videoId: string;
    index: number;
    end: number;
}

/**
 * Emby/Jellyfin 增强管理器
 */
class EmbyEnhancementManager {
    private isInitialized = false;
    private observer: MutationObserver | null = null;
    private processedElements = new WeakSet<Element>();
    private config: EmbyConfig | null = null;
    private quickActions: HTMLElement | null = null;

    private _onHashChange = () => {
        this.renderQuickActions();
    };

    // 兜底：轮询检测 URL 变化（应对 Emby 不触发 hashchange 的情况）
    private _urlWatchTimer: ReturnType<typeof setInterval> | null = null;
    private _lastUrl = '';

    private startUrlWatch(): void {
        this._lastUrl = window.location.href;
        this._urlWatchTimer = setInterval(() => {
            const current = window.location.href;
            if (current !== this._lastUrl) {
                this._lastUrl = current;
                this.renderQuickActions();
            }
        }, 500);
    }

    private stopUrlWatch(): void {
        if (this._urlWatchTimer) {
            clearInterval(this._urlWatchTimer);
            this._urlWatchTimer = null;
        }
    }

    /**
     * 初始化 Emby/Jellyfin 增强功能
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            await this.loadConfig();

            if (!isEmbyRecognitionEnabled(this.config)) {
                log('Emby enhancement is disabled');
                return;
            }

            if (!this.isCurrentPageMatched()) {
                log('Current page does not match Emby URL patterns');
                return;
            }

            this.setupMutationObserver();
            this.processExistingContent();
            this.renderQuickActions();
            // 监听 hash/popstate 变化 + 轮询兜底（Emby SPA 路由）
            window.addEventListener('hashchange', this._onHashChange);
            window.addEventListener('popstate', this._onHashChange);
            this.startUrlWatch();
            this.isInitialized = true;

            log('Emby enhancement initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Emby enhancement:', error);
        }
    }

    /**
     * 销毁 Emby/Jellyfin 增强功能
     */
    destroy(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        window.removeEventListener('hashchange', this._onHashChange);
        window.removeEventListener('popstate', this._onHashChange);
        this.stopUrlWatch();
        this.isInitialized = false;
        this.processedElements = new WeakSet();
        this.removeQuickActions();
        log('Emby enhancement destroyed');
    }

    /**
     * 加载配置
     */
    private async loadConfig(): Promise<void> {
        this.config = STATE.settings?.emby || null;
    }

    /**
     * 检查当前页面是否匹配媒体服务器地址或额外匹配地址
     */
    private isCurrentPageMatched(): boolean {
        const matchUrls = getEffectiveEmbyMatchUrls(this.config);
        if (matchUrls.length === 0) return false;

        const currentUrl = window.location.href;

        return matchUrls.some(pattern => matchesEmbyUrlPattern(currentUrl, pattern));
    }

    /**
     * 设置DOM变化监听器
     */
    private setupMutationObserver(): void {
        this.observer = new MutationObserver((mutations) => {
            if (!this.config?.enableAutoDetection) return;

            let shouldProcess = false;

            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            shouldProcess = true;
                        }
                    });
                }
            });

            if (shouldProcess) {
                this.processExistingContent();
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * 处理现有内容
     */
    private processExistingContent(): void {
        if (!this.config) return;

        // 查找所有文本节点
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    // 跳过已处理的元素
                    if (node.parentElement && this.processedElements.has(node.parentElement)) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // 跳过脚本和样式标签
                    const parent = node.parentElement;
                    if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // 跳过已经是链接的元素
                    if (parent && parent.closest('a')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const textNodes: Text[] = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node as Text);
        }

        textNodes.forEach(textNode => this.processTextNode(textNode));
    }

    /**
     * 处理文本节点
     */
    private processTextNode(textNode: Text): void {
        if (!this.config || !textNode.textContent) return;

        const text = textNode.textContent;
        const targets = this.extractVideoLinkTargets(text);

        if (targets.length === 0) return;

        // 标记父元素为已处理
        if (textNode.parentElement) {
            this.processedElements.add(textNode.parentElement);
        }

        const parentNode = textNode.parentNode;
        if (!parentNode) return;

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        targets.forEach(target => {
            if (target.index < cursor) return;
            if (target.index > cursor) {
                fragment.appendChild(document.createTextNode(text.slice(cursor, target.index)));
            }
            fragment.appendChild(this.createVideoLinkElement(target.videoId));
            cursor = target.end;
        });
        if (cursor < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
        }

        parentNode.replaceChild(fragment, textNode);
    }

    /**
     * 从文本中提取番号
     */
    private extractVideoIds(text: string): string[] {
        return this.extractVideoLinkTargets(text).map(target => target.videoId);
    }

    /**
     * 从文本中提取可链接番号命中，保留原始文本位置用于安全替换
     */
    private extractVideoLinkTargets(text: string): VideoLinkTarget[] {
        const targets: VideoLinkTarget[] = extractVideoCodesFromText(text).map(code => ({
            raw: code.raw,
            videoId: code.normalized,
            index: code.index,
            end: code.index + code.raw.length,
        }));
        const seenVideoIds = new Set(targets.map(target => target.videoId));
        const patterns = this.config?.videoCodePatterns || [];

        patterns.forEach(pattern => {
            try {
                const regex = new RegExp(pattern, 'gi');
                for (const match of text.matchAll(regex)) {
                    const raw = match[0];
                    if (!raw || match.index === undefined) continue;
                    const cleanId = extractVideoId(raw);
                    if (!cleanId || seenVideoIds.has(cleanId)) continue;

                    const index = match.index;
                    const end = index + raw.length;
                    if (this.hasTargetOverlap(targets, index, end)) continue;

                    targets.push({
                        raw,
                        videoId: cleanId,
                        index,
                        end,
                    });
                    seenVideoIds.add(cleanId);
                }
            } catch (error) {
                console.warn('Invalid regex pattern:', pattern, error);
            }
        });

        return targets.sort((a, b) => a.index - b.index);
    }

    private hasTargetOverlap(targets: VideoLinkTarget[], index: number, end: number): boolean {
        return targets.some(target => index < target.end && target.index < end);
    }

    /**
     * 创建视频链接
     */
    private createVideoLinkElement(videoId: string): HTMLAnchorElement {
        const link = document.createElement('a');
        const url = this.generateVideoUrl(videoId);
        const style = this.config?.highlightStyle;

        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'emby-video-link';
        link.title = `点击跳转到JavDB查看 ${videoId}`;
        link.textContent = videoId;

        if (style) {
            link.style.backgroundColor = style.backgroundColor;
            link.style.color = style.color;
            link.style.borderRadius = style.borderRadius;
            link.style.padding = style.padding;
        }
        link.style.textDecoration = 'none';
        link.style.cursor = 'pointer';

        this.bindVideoLinkEvents(link);
        return link;
    }

    /**
     * 生成视频URL
     */
    private generateVideoUrl(videoId: string): string {
        if (!this.config) return '#';

        if (this.config.linkBehavior === 'javdb-direct') {
            // 尝试从本地记录中查找直接链接
            const record = STATE.records?.[videoId];
            if (record?.javdbUrl && record.javdbUrl !== '#') {
                return record.javdbUrl;
            }
        }

        // 使用搜索引擎进行搜索
        const searchEngines = STATE.settings?.searchEngines || [];
        const javdbEngine = searchEngines.find((engine: any) => engine.id === 'javdb');

        if (javdbEngine) {
            return javdbEngine.urlTemplate.replace('{{ID}}', encodeURIComponent(videoId));
        }

        // 默认使用JavDB搜索
        return `https://javdb.com/search?q=${encodeURIComponent(videoId)}&f=all`;
    }

    /**
     * 应用链接样式
     */
    private bindVideoLinkEvents(link: HTMLAnchorElement): void {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const videoId = link.textContent?.trim();
            if (!videoId) return;

            log(`User clicked on video link: ${videoId}`);

            // 优先：直达详情（需要本地有直链或可即时刷新获取）
            if (this.config?.linkBehavior === 'javdb-direct') {
                const local = STATE.records?.[videoId];
                if (local?.javdbUrl && local.javdbUrl !== '#') {
                    window.open(local.javdbUrl, '_blank');
                    return;
                }
                try {
                    chrome.runtime.sendMessage({ type: 'refresh-record', videoId }, (resp: any) => {
                        if ((typeof chrome !== 'undefined') && chrome.runtime && chrome.runtime.lastError) {
                            const url = this.generateVideoUrl(videoId);
                            window.open(url, '_blank');
                            return;
                        }
                        const updatedUrl = resp?.record?.javdbUrl;
                        if (resp?.success && updatedUrl && updatedUrl !== '#') {
                            window.open(updatedUrl, '_blank');
                        } else {
                            const url = this.generateVideoUrl(videoId);
                            window.open(url, '_blank');
                        }
                    });
                } catch {
                    const url = this.generateVideoUrl(videoId);
                    window.open(url, '_blank');
                }
                return;
            }

            // 回退：统一走搜索
            const url = this.generateVideoUrl(videoId);
            window.open(url, '_blank');
        });

        // 添加悬停效果
        link.addEventListener('mouseenter', () => {
            link.style.opacity = '0.8';
        });

        link.addEventListener('mouseleave', () => {
            link.style.opacity = '1';
        });
    }

    /**
     * 手动触发内容处理
     */
    async refresh(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
            return;
        }

        await this.loadConfig();

        if (!isEmbyRecognitionEnabled(this.config) || !this.isCurrentPageMatched()) {
            this.destroy();
            return;
        }

        this.processedElements = new WeakSet();
        this.processExistingContent();
        this.renderQuickActions();
        log('Emby enhancement refreshed');
    }

    /**
     * 获取当前状态
     */
    getStatus(): { initialized: boolean; enabled: boolean; matched: boolean } {
        return {
            initialized: this.isInitialized,
            enabled: isEmbyRecognitionEnabled(this.config),
            matched: this.isCurrentPageMatched()
        };
    }

    /** 渲染右侧悬浮快捷框（搜番号 / 搜演员） */
    private renderQuickActions(): void {
        if (!this.config || !isEmbyRecognitionEnabled(this.config) || !this.isCurrentPageMatched()) return;

        // 视频播放界面（videoosd）隐藏快捷按钮
        if (window.location.href.includes('videoosd')) {
            this.removeQuickActions();
            return;
        }

        // 根据配置判断是否需要显示
        const showCode = this.config.showQuickSearchCode !== false;
        const showActor = this.config.showQuickSearchActor !== false;
        // 如果两个都隐藏，则直接移除并返回
        if (!showCode && !showActor) {
            this.removeQuickActions();
            return;
        }

        this.removeQuickActions();
        const container = document.createElement('div');
        container.className = 'emby-quick-actions';
        container.style.cssText = `
          position: fixed;
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        if (showCode) {
        const btnSearchCode = this.createActionButton('search-code', '搜番号', '🔎', async () => {
            try {
                let id = this.getFirstVideoIdFromPage();
                if (!id) {
                    const sel = (window.getSelection()?.toString() || '').trim();
                    const idsFromSel = sel ? this.extractVideoIds(sel) : [];
                    id = idsFromSel[0] || extractVideoId(sel || '');
                }
                if (!id) {
                    showToast('未检测到番号，请先在页面中出现或选中番号文本', 'warning');
                    return;
                }

                // 链接行为：优先直达（若未有直链，尝试后台刷新），否则搜索
                if (this.config?.linkBehavior === 'javdb-direct') {
                    const local = STATE.records?.[id];
                    if (local?.javdbUrl && local.javdbUrl !== '#') {
                        window.open(local.javdbUrl, '_blank');
                        showToast(`已打开详情：${id}`,'success');
                        return;
                    }
                    chrome.runtime.sendMessage({ type: 'refresh-record', videoId: id }, (resp: any) => {
                        if ((typeof chrome !== 'undefined') && chrome.runtime && chrome.runtime.lastError) {
                            const url = this.generateVideoUrl(id);
                            window.open(url, '_blank');
                            showToast(`未找到直链，已改为搜索：${id}`,'info');
                            return;
                        }
                        const updatedUrl = resp?.record?.javdbUrl;
                        if (resp?.success && updatedUrl && updatedUrl !== '#') {
                            try { (STATE.records as any)[id] = resp.record; } catch {}
                            window.open(updatedUrl, '_blank');
                            showToast(`已打开详情：${id}`,'success');
                        } else {
                            const url = this.generateVideoUrl(id);
                            window.open(url, '_blank');
                            showToast(`未找到直链，已改为搜索：${id}`,'info');
                        }
                    });
                    return;
                }

                const url = this.generateVideoUrl(id);
                window.open(url, '_blank');
                showToast(`已在新标签页搜索番号：${id}`, 'success');
            } catch (e) {
                showToast('搜索番号失败', 'error');
            }
        });
        container.appendChild(btnSearchCode);
        }

        if (showActor) {
        const btnSearchActor = this.createActionButton('search-actor', '搜演员', '👤', async () => {
            try {
                let name = this.findActorNameFromPage();
                if (!name) {
                    const sel = (window.getSelection()?.toString() || '').trim();
                    if (sel) name = sel;
                }
                if (!name) {
                    const input = prompt('请输入演员名（也可先选中文本再点击按钮）', '');
                    name = (input || '').trim();
                }
                if (!name) {
                    showToast('未获取到演员名', 'warning');
                    return;
                }
                const url = this.generateSearchUrl(name);
                window.open(url, '_blank');
                showToast(`已在新标签页搜索演员：${name}`, 'success');
            } catch (e) {
                showToast('搜索演员失败', 'error');
            }
        });
        container.appendChild(btnSearchActor);
        }

        // 若至少有一个按钮添加，则挂载容器
        document.body.appendChild(container);
        this.quickActions = container;
    }

    /** 移除悬浮快捷框 */
    private removeQuickActions(): void {
        if (this.quickActions) {
            this.quickActions.remove();
            this.quickActions = null;
        }
    }

    /** 创建样式统一的按钮 */
    private createActionButton(id: string, label: string, icon: string, onClick: () => void): HTMLElement {
        const btn = document.createElement('a');
        btn.className = `emby-quick-action-btn ${id}`;
        btn.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 80px;
          height: 40px;
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid #ddd;
          border-radius: 20px;
          color: #333;
          text-decoration: none;
          font-size: 12px;
          font-weight: 500;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
          cursor: pointer;
          padding: 0 12px;
          gap: 6px;
          backdrop-filter: blur(10px);
        `;
        const i = document.createElement('span');
        i.textContent = icon;
        i.style.fontSize = '14px';
        const t = document.createElement('span');
        t.textContent = label;
        btn.appendChild(i);
        btn.appendChild(t);
        btn.addEventListener('mouseenter', () => {
            (btn as HTMLElement).style.background = 'rgba(255, 255, 255, 1)';
            (btn as HTMLElement).style.transform = 'scale(1.05)';
            (btn as HTMLElement).style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        });
        btn.addEventListener('mouseleave', () => {
            (btn as HTMLElement).style.background = 'rgba(255, 255, 255, 0.95)';
            (btn as HTMLElement).style.transform = 'scale(1)';
            (btn as HTMLElement).style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            onClick();
        });
        return btn;
    }

    /** 从页面中尝试获取第一个番号 */
    private getFirstVideoIdFromPage(): string | null {
        try {
            const text = (document.body?.innerText || document.body?.textContent || '');
            const ids = this.extractVideoIds(text || '');
            return ids[0] || null;
        } catch {
            return null;
        }
    }

    /** 从页面尝试提取演员名（优先已选中文本） */
    private findActorNameFromPage(): string | null {
        // 1. 先看选中文本
        const sel = (window.getSelection()?.toString() || '').trim();
        if (sel) return sel;
        // 2. 常见 Emby/Jellyfin 人员链接
        const personLink = document.querySelector('a[href*="/Persons/"]') || document.querySelector('a[href*="/persons/"]');
        if (personLink && personLink.textContent) {
            const name = personLink.textContent.trim();
            if (name) return name;
        }
        // 3. 类名包含 person/actor 的元素
        const personEl = document.querySelector('[class*="person"], [class*="actor"]');
        if (personEl && personEl.textContent) {
            const name = personEl.textContent.trim().split(/[\n,，|]/)[0].trim();
            if (name) return name;
        }
        // 4. 失败则返回 null，由调用方提示/弹窗
        return null;
    }

    /** 构造通用搜索URL（默认 JavDB search?q=...&f=all） */
    private generateSearchUrl(query: string): string {
        const searchEngines = STATE.settings?.searchEngines || [];
        const javdbEngine = searchEngines.find((engine: any) => engine.id === 'javdb');
        if (javdbEngine?.urlTemplate) {
            return javdbEngine.urlTemplate.replace('{{ID}}', encodeURIComponent(query));
        }
        return `https://javdb.com/search?q=${encodeURIComponent(query)}&f=all`;
    }
}

// 创建全局实例
export const embyEnhancementManager = new EmbyEnhancementManager();

// 监听设置变化
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === 'settings-updated' && message.settings?.emby) {
        embyEnhancementManager.refresh().catch(error => {
            console.error('Failed to refresh Emby enhancement:', error);
        });
    }
});
