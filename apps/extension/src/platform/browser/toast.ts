/**
 * @file toast.ts
 * @description 页面 Toast 消息系统 —— 在网页右上角显示轻量通知
 * @module platform/browser
 *
 * 支持 success/error/warning/info 四种类型，自动淡出，最多同时显示 3 条。
 */

/** Toast 配置常量 */
const TOAST_CONFIG = {
    FADE_DURATION: 500,                               // 淡出动画时长（毫秒）
    DISPLAY_DURATION: 3000,                            // 显示时长（毫秒）
    MAX_MESSAGES: 3,                                   // 最大同时显示数
    Z_INDEX: 1000002                                     // 层级
};

// --- Toast Message System ---

function loadFontAwesome(): void {
    // 检查是否已经加载了Font Awesome
    if (document.querySelector('link[href*="font-awesome"]') || document.querySelector('link[href*="fontawesome"]')) {
        return;
    }

    // 使用扩展内置 Font Awesome，避免页面运行时请求外部 CDN。
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('assets/fontawesome/css/all.min.css');
    document.head.appendChild(link);
}

function createToastContainer(): HTMLElement {
    let container = document.getElementById('javdb-ext-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'javdb-ext-toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: ${TOAST_CONFIG.Z_INDEX};
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column-reverse;
            align-items: flex-end;
            gap: 8px;
        `;
        document.body.appendChild(container);
    }
    return container;
}


// 以 message+type 为 key 的活动 toast 映射，用于合并与续命
const activeToasts = new Map<string, { el: HTMLElement; count: number; timeoutId: number | null }>();

export function showToast(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
    // 确保Font Awesome已加载
    loadFontAwesome();

    const container = createToastContainer();
    const key = `${type}:${message}`;

    // 若已有同类 toast，合并并续命
    const existing = activeToasts.get(key);
    if (existing) {
        existing.count += 1;
        const countEl = existing.el.querySelector('.javdb-ext-toast-count') as HTMLElement | null;
        if (countEl) {
            countEl.textContent = `×${existing.count}`;
            countEl.style.display = existing.count > 1 ? 'inline' : 'none';
        }
        // 续命：重置自动消失计时器
        if (existing.timeoutId != null) {
            clearTimeout(existing.timeoutId);
        }
        existing.timeoutId = window.setTimeout(() => {
            fadeOutToast(existing.el);
        }, TOAST_CONFIG.DISPLAY_DURATION);
        return;
    }

    // 超过上限时，优先同步移除最旧的一条（避免 while + 异步导致死循环）
    if (container.children.length >= TOAST_CONFIG.MAX_MESSAGES) {
        const oldest = container.firstElementChild as HTMLElement | null;
        if (oldest) {
            const oldKey = oldest.getAttribute('data-toast-key') || '';
            if (oldKey && activeToasts.has(oldKey)) {
                const rec = activeToasts.get(oldKey)!;
                if (rec.timeoutId != null) clearTimeout(rec.timeoutId);
                activeToasts.delete(oldKey);
            }
            oldest.remove();
        }
    }

    // 创建新 toast
    const toast = document.createElement('div');

    // 根据类型设置渐变背景
    let backgroundGradient: string;
    let iconClass: string;

    switch (type) {
        case 'success':
            backgroundGradient = 'linear-gradient(to right, #2a9d8f, #4CAF50)';
            iconClass = 'fas fa-check-circle';
            break;
        case 'error':
            backgroundGradient = 'linear-gradient(to right, #e76f51, #d90429)';
            iconClass = 'fas fa-exclamation-circle';
            break;
        case 'warning':
            backgroundGradient = 'linear-gradient(to right, #f4a261, #e9c46a)';
            iconClass = 'fas fa-exclamation-triangle';
            break;
        case 'info':
        default:
            backgroundGradient = 'linear-gradient(to right, #2a9d8f, #264653)';
            iconClass = 'fas fa-info-circle';
            break;
    }

    toast.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 22px;
        border-radius: 10px;
        background: ${backgroundGradient};
        color: #fff;
        font-family: "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
        font-size: 15px;
        font-weight: 500;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
        min-width: 280px;
        max-width: 350px;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        word-wrap: break-word;
    `;

    // 结构：icon + 文本 + 计数
    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.style.cssText = `
        font-size: 22px;
        line-height: 1;
        flex-shrink: 0;
    `;

    const textElement = document.createElement('span');
    textElement.className = 'javdb-ext-toast-message';
    // 10-05-list-filter-toast：支持多行消息（过滤 toast 两行）；无换行消息零影响
    textElement.style.whiteSpace = 'pre-line';
    textElement.textContent = message;

    const countElement = document.createElement('span');
    countElement.className = 'javdb-ext-toast-count';
    countElement.style.cssText = `margin-left: 4px; font-weight: 600;`;
    countElement.textContent = '×1';
    countElement.style.display = 'none';

    toast.setAttribute('data-toast-key', key);

    toast.appendChild(icon);
    toast.appendChild(textElement);
    toast.appendChild(countElement);
    container.appendChild(toast);

    // 触发入场动画
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });

    // 自动消失
    const timeoutId = window.setTimeout(() => {
        fadeOutToast(toast);
    }, TOAST_CONFIG.DISPLAY_DURATION);

    // 记录到映射
    activeToasts.set(key, { el: toast, count: 1, timeoutId });
}

function fadeOutToast(toast: HTMLElement): void {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';

    setTimeout(() => {
        const key = toast.getAttribute('data-toast-key') || '';
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
        if (key) {
            activeToasts.delete(key);
        }
    }, TOAST_CONFIG.FADE_DURATION);
}
