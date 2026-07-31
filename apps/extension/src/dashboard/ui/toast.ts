export type ToastType = 'info' | 'warn' | 'warning' | 'error' | 'success';

export type ToastHandle = {
    update: (message: string, type?: ToastType, duration?: number) => void;
    close: () => void;
};

type ToastOptions = {
    duration?: number;
    persistent?: boolean;
};

function normalizeToastType(type: ToastType): Exclude<ToastType, 'warn'> {
    return (type === 'warn' || type === 'warning') ? 'warning' : type;
}

function resolveToastIcon(type: ToastType): string {
    if (type === 'success') return 'fas fa-check-circle';
    if (type === 'error') return 'fas fa-exclamation-circle';
    if (type === 'warn' || type === 'warning') return 'fas fa-exclamation-triangle';
    return 'fas fa-info-circle';
}

function applyToastContent(div: HTMLDivElement, icon: HTMLElement, message: string, type: ToastType): void {
    const displayType = normalizeToastType(type);
    div.className = `toast toast-${displayType}`;
    if (message.includes('\n')) {
        div.style.whiteSpace = 'pre-line';
        div.style.textAlign = 'left';
    } else {
        div.style.whiteSpace = '';
        div.style.textAlign = '';
    }
    icon.className = resolveToastIcon(type);
    div.textContent = message;
    div.prepend(icon);
}

function createToast(message: string, type: ToastType, options: ToastOptions): ToastHandle | null {
    const container = document.getElementById('messageContainer');
    if (!container) {
        console.error('Message container not found!');
        return null;
    }

    const div = document.createElement('div');
    const icon = document.createElement('i');
    let timeoutId: number | null = null;
    let remainingTime = Math.max(0, Number(options.duration ?? 5000) || 0);
    let startTime = Date.now();
    let isPersistent = options.persistent === true;

    const close = () => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        div.classList.remove('show');
        div.addEventListener('transitionend', () => div.remove(), { once: true });
    };

    const startTimer = () => {
        if (isPersistent || remainingTime <= 0) return;
        startTime = Date.now();
        timeoutId = window.setTimeout(close, remainingTime);
    };

    const pauseTimer = () => {
        if (isPersistent) return;
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            remainingTime -= Date.now() - startTime;
            timeoutId = null;
        }
    };

    const resumeTimer = () => {
        if (timeoutId === null && remainingTime > 0) {
            startTimer();
        }
    };

    const update = (nextMessage: string, nextType: ToastType = type, duration?: number) => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        applyToastContent(div, icon, nextMessage, nextType);
        if (duration != null) {
            remainingTime = Math.max(0, Number(duration) || 0);
            isPersistent = false;
            startTimer();
        }
    };

    applyToastContent(div, icon, message, type);
    container.appendChild(div);

    setTimeout(() => {
        div.classList.add('show');
    }, 10);

    div.addEventListener('mouseenter', pauseTimer);
    div.addEventListener('mouseleave', resumeTimer);
    startTimer();

    return { update, close };
}

export function showMessage(
    message: string,
    type: ToastType = 'info',
    duration: number = 5000
): void {
    createToast(message, type, { duration });
}

/**
 * 显示等待结果返回的常驻 Toast，由调用方在成功/失败后 update 或 close。
 */
export function showPersistentMessage(message: string, type: ToastType = 'info'): ToastHandle {
    const handle = createToast(message, type, { persistent: true, duration: 0 });
    if (handle) return handle;
    return {
        update: () => {},
        close: () => {},
    };
}
