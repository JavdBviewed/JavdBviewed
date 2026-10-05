/**
 * 确认弹窗组件
 */

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'info' | 'warning' | 'danger';
    isHtml?: boolean; // 是否将 message 作为 HTML 渲染
    className?: string;
}

export class ConfirmModal {
    private modal: HTMLElement | null = null;
    private onConfirmCallback: (() => void) | null = null;
    private onCancelCallback: (() => void) | null = null;
    /** 10-05 F-1：当前未收口 show() 的 resolve（新 show() 到达时以 false 自动放弃旧弹窗，防旧 Promise 永久悬挂） */
    private pendingResolve: ((value: boolean) => void) | null = null;

    /**
     * 显示确认弹窗
     */
    show(options: ConfirmOptions): Promise<boolean> {
        return new Promise((resolve) => {
            // 10-05 F-1：上一弹窗未收口即来新确认 → 旧弹窗按「放弃」收口（resolve false），
            // 旧调用方走既有 cancel 分支正常收口（如新作品确认流程发「已放弃本次 N 条」既有 toast），
            // 不再永久悬挂（悬挂会导致旧批次被新终态覆盖/清盘后静默丢失）。已收口时幂等无操作。
            this.resolvePending(false);
            this.pendingResolve = resolve;
            this.onConfirmCallback = () => this.resolvePending(true);
            this.onCancelCallback = () => this.resolvePending(false);
            this.createModal(options);
            this.showModal();
        });
    }

    /** 收口当前未 resolve 的 show() Promise（幂等：已收口则无操作） */
    private resolvePending(value: boolean): void {
        if (this.pendingResolve) {
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            resolve(value);
        }
    }

    /**
     * 创建弹窗
     */
    private createModal(options: ConfirmOptions): void {
        // 移除已存在的弹窗
        this.removeModal();

        const {
            title = '确认操作',
            message,
            confirmText = '确认',
            cancelText = '取消',
            type = 'info',
            isHtml = false,
            className = ''
        } = options;

        this.modal = document.createElement('div');
        this.modal.className = `confirm-modal ${className}`.trim();
        this.modal.setAttribute('data-type', type); // 添加类型属性用于 CSS 选择

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const content = document.createElement('div');
        content.className = 'modal-content confirm-modal-content';

        const header = document.createElement('div');
        header.className = 'modal-header';
        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        header.appendChild(titleEl);

        const body = document.createElement('div');
        body.className = 'modal-body';
        if (isHtml) {
            body.innerHTML = message;
        } else {
            const messageEl = document.createElement('p');
            messageEl.className = 'confirm-message';
            messageEl.textContent = message;
            body.appendChild(messageEl);
        }

        const footer = document.createElement('div');
        footer.className = 'modal-footer';

        const cancelButton = document.createElement('button');
        cancelButton.className = 'btn-secondary';
        cancelButton.id = 'confirmCancel';
        cancelButton.textContent = cancelText;

        const confirmButton = document.createElement('button');
        confirmButton.className = `btn-${type === 'danger' ? 'danger' : 'primary'}`;
        confirmButton.id = 'confirmOk';
        confirmButton.textContent = confirmText;

        footer.append(cancelButton, confirmButton);
        content.append(header, body, footer);
        overlay.appendChild(content);
        this.modal.appendChild(overlay);

        document.body.appendChild(this.modal);
        this.setupEventListeners();
    }

    /**
     * 设置事件监听器
     */
    private setupEventListeners(): void {
        if (!this.modal) return;

        // 确认按钮
        const confirmBtn = this.modal.querySelector('#confirmOk');
        confirmBtn?.addEventListener('click', () => this.handleConfirm());

        // 取消按钮
        const cancelBtn = this.modal.querySelector('#confirmCancel');
        cancelBtn?.addEventListener('click', () => this.handleCancel());

        // ESC键关闭
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.handleCancel();
                document.removeEventListener('keydown', handleKeyDown);
            }
            if (e.key === 'Enter') {
                this.handleConfirm();
                document.removeEventListener('keydown', handleKeyDown);
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        // 点击遮罩关闭
        const overlay = this.modal.querySelector('.modal-overlay');
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.handleCancel();
            }
        });
    }

    /**
     * 处理确认
     */
    private handleConfirm(): void {
        if (this.onConfirmCallback) {
            this.onConfirmCallback();
        }
        this.hideModal();
    }

    /**
     * 处理取消
     */
    private handleCancel(): void {
        if (this.onCancelCallback) {
            this.onCancelCallback();
        }
        this.hideModal();
    }

    /**
     * 显示弹窗
     */
    private showModal(): void {
        if (this.modal) {
            this.modal.style.display = 'block';
            document.body.style.overflow = 'hidden';

            // 添加visible类以显示弹窗
            const overlay = this.modal.querySelector('.modal-overlay');
            if (overlay) {
                overlay.classList.add('visible');
            }
        }
    }

    /**
     * 隐藏弹窗
     */
    private hideModal(): void {
        if (this.modal) {
            const overlay = this.modal.querySelector('.modal-overlay');
            if (overlay) {
                overlay.classList.remove('visible');
            }

            // 等待动画完成后移除弹窗
            setTimeout(() => {
                this.removeModal();
            }, 300);
        }
    }

    /**
     * 移除弹窗
     */
    private removeModal(): void {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
            document.body.style.overflow = '';
        }
    }
}

// 全局实例
let globalConfirmModal: ConfirmModal | null = null;

/**
 * 显示确认弹窗的便捷函数
 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
    if (!globalConfirmModal) {
        globalConfirmModal = new ConfirmModal();
    }
    return globalConfirmModal.show(options);
}

/**
 * 显示信息弹窗的便捷函数
 */
export function showInfo(message: string, title?: string): Promise<boolean> {
    return showConfirm({
        title: title || '信息',
        message,
        confirmText: '确定',
        cancelText: '关闭',
        type: 'info'
    });
}

/**
 * 显示警告弹窗的便捷函数
 */
export function showWarning(message: string, title?: string): Promise<boolean> {
    return showConfirm({
        title: title || '警告',
        message,
        confirmText: '确定',
        cancelText: '取消',
        type: 'warning'
    });
}

/**
 * 显示危险操作确认弹窗的便捷函数
 */
export function showDanger(message: string, title?: string): Promise<boolean> {
    return showConfirm({
        title: title || '危险操作',
        message,
        confirmText: '确定删除',
        cancelText: '取消',
        type: 'danger'
    });
}
