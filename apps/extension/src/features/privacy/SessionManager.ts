/**
 * 会话管理器
 */

import { ISessionManager, SessionInfo, PrivacyEvent, PrivacyEventType } from '../../types/privacy';
import { getPrivacyStorage } from './utils/storage';
import { SessionValidator } from './utils/validation';

export class SessionManager implements ISessionManager {
    private static instance: SessionManager;
    private storage = getPrivacyStorage();
    private sessionInfo: SessionInfo | null = null;
    private timeoutId: number | null = null;
    private activityTimeoutId: number | null = null;
    private eventListeners: Map<PrivacyEventType, ((event: PrivacyEvent) => void)[]> = new Map();

    // 默认配置
    private defaultTimeout = 30; // 30分钟
    private activityCheckInterval = 60000; // 1分钟检查一次活动
    private maxIdleTime = 10; // 10分钟无活动自动锁定

    private constructor() {
        this.setupActivityMonitoring();
    }

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    /**
     * 开始会话
     */
    async startSession(timeoutMinutes?: number, idleTimeoutMinutes?: number): Promise<void> {
        try {
            const timeout = timeoutMinutes || this.defaultTimeout;
            const idleTimeout = idleTimeoutMinutes || this.maxIdleTime;
            const now = Date.now();

            this.sessionInfo = {
                startTime: now,
                lastActivity: now,
                timeoutDuration: timeout * 60 * 1000,
                remainingTime: timeout * 60 * 1000,
                isValid: true
            };

            // 更新无操作超时配置
            this.maxIdleTime = idleTimeout;

            // 保存会话信息
            await this.storage.saveSessionInfo(this.sessionInfo);

            // 设置超时定时器（基于无操作超时）
            this.setupIdleTimeout();

            // 触发会话开始事件
            this.emitEvent('authenticated', { sessionInfo: this.sessionInfo });

            console.log('[Privacy] Session started with idle timeout:', idleTimeout, 'minutes');
        } catch (error) {
            console.error('[Privacy] Failed to start session:', error);
            throw new Error('启动会话失败');
        }
    }

    /**
     * 结束会话
     */
    async endSession(): Promise<void> {
        try {
            // 即使内存尚无会话，也要撤销磁盘上的残留会话。
            // 清除定时器
            this.clearTimeouts();

            // 清除会话信息
            this.sessionInfo = null;
            await this.storage.saveSessionInfo(null);

            console.log('[Privacy] Session ended');
        } catch (error) {
            console.error('[Privacy] Failed to end session:', error);
            throw new Error('结束会话失败');
        }
    }

    /**
     * 检查会话是否有效
     */
    isSessionValid(): boolean {
        if (!this.sessionInfo) {
            return false;
        }

        return SessionValidator.isSessionValid(this.sessionInfo, this.defaultTimeout);
    }

    /**
     * 刷新会话
     */
    async refreshSession(): Promise<void> {
        if (!this.sessionInfo) {
            throw new Error('没有活动会话');
        }

        try {
            const now = Date.now();
            this.sessionInfo.lastActivity = now;
            // 无操作超时模式下，不需要计算剩余时间

            // 保存更新的会话信息
            await this.storage.saveSessionInfo(this.sessionInfo);

            console.log('[Privacy] Session activity updated');
        } catch (error) {
            console.error('[Privacy] Failed to refresh session:', error);
            throw new Error('刷新会话失败');
        }
    }

    /**
     * 获取会话信息
     */
    getSessionInfo(): SessionInfo {
        if (!this.sessionInfo) {
            return {
                startTime: 0,
                lastActivity: 0,
                timeoutDuration: 0,
                remainingTime: 0,
                isValid: false
            };
        }

        // 更新剩余时间
        const now = Date.now();
        const elapsed = now - this.sessionInfo.startTime;
        this.sessionInfo.remainingTime = Math.max(0, this.sessionInfo.timeoutDuration - elapsed);
        this.sessionInfo.isValid = this.sessionInfo.remainingTime > 0;

        return { ...this.sessionInfo };
    }

    /**
     * 更新活动时间
     */
    async updateActivity(): Promise<void> {
        if (!this.sessionInfo) {
            return;
        }

        try {
            const now = Date.now();
            this.sessionInfo.lastActivity = now;
            await this.storage.saveSessionInfo(this.sessionInfo);
        } catch (error) {
            console.error('[Privacy] Failed to update activity:', error);
        }
    }

    /**
     * 检查是否空闲过久
     */
    isIdleTooLong(): boolean {
        if (!this.sessionInfo) {
            return false;
        }

        return !SessionValidator.isActivityRecent(this.sessionInfo.lastActivity, this.maxIdleTime);
    }

    /**
     * 恢复会话（从存储中加载）
     */
    async restoreSession(): Promise<boolean> {
        try {
            const storedSession = await this.storage.loadSessionInfo();
            if (!storedSession) {
                return false;
            }

            // 检查会话是否仍然有效
            if (!SessionValidator.isSessionValid(storedSession, this.defaultTimeout)) {
                await this.storage.saveSessionInfo(null);
                return false;
            }

            this.sessionInfo = storedSession;
            this.setupSessionTimeout();

            console.log('[Privacy] Session restored:', this.sessionInfo);
            return true;
        } catch (error) {
            console.error('[Privacy] Failed to restore session:', error);
            return false;
        }
    }

    /**
     * 设置会话超时（已废弃，改用无操作超时）
     */
    private setupSessionTimeout(): void {
        // 不再使用固定时间超时，改用无操作超时
        this.setupIdleTimeout();
    }

    /**
     * 设置无操作超时检查
     */
    private setupIdleTimeout(): void {
        this.clearTimeouts();

        if (!this.sessionInfo) {
            return;
        }

        // 每30秒检查一次是否超过无操作时间
        this.activityTimeoutId = window.setInterval(() => {
            // 再次检查会话是否存在，防止已结束的会话继续检查
            if (!this.sessionInfo) {
                this.clearTimeouts();
                return;
            }
            
            if (this.isIdleTooLong()) {
                console.log('[Privacy] Session idle timeout - no activity detected');
                this.handleSessionTimeout();
            }
        }, 30 * 1000);
    }

    /**
     * 处理会话超时
     */
    private async handleSessionTimeout(): Promise<void> {
        // 防止重复触发
        if (!this.sessionInfo) {
            return;
        }

        console.log('[Privacy] Session timeout occurred');
        
        // 先清除会话信息，防止循环触发
        this.sessionInfo = null;
        
        // 清除定时器
        this.clearTimeouts();
        
        // 触发超时事件
        this.emitEvent('session-expired', {});
        
        // 清除存储
        try {
            await this.storage.saveSessionInfo(null);
        } catch (error) {
            console.error('[Privacy] Failed to clear session info:', error);
        }
    }

    /**
     * 设置活动监控
     */
    private setupActivityMonitoring(): void {
        // 监听用户活动
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        
        const activityHandler = () => {
            this.updateActivity();
        };

        events.forEach(event => {
            document.addEventListener(event, activityHandler, true);
        });

        // 无操作超时检查已在 setupIdleTimeout 中实现
    }

    /**
     * 清除定时器
     */
    private clearTimeouts(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        if (this.activityTimeoutId) {
            clearTimeout(this.activityTimeoutId);
            this.activityTimeoutId = null;
        }
    }

    /**
     * 配置会话设置
     */
    configureSession(timeoutMinutes: number, maxIdleMinutes: number): void {
        this.defaultTimeout = Math.max(5, timeoutMinutes); // 最少5分钟
        this.maxIdleTime = Math.max(1, maxIdleMinutes); // 最少1分钟
    }

    /**
     * 添加事件监听器
     */
    addEventListener(type: PrivacyEventType, listener: (event: PrivacyEvent) => void): void {
        if (!this.eventListeners.has(type)) {
            this.eventListeners.set(type, []);
        }
        this.eventListeners.get(type)!.push(listener);
    }

    /**
     * 移除事件监听器
     */
    removeEventListener(type: PrivacyEventType, listener: (event: PrivacyEvent) => void): void {
        const listeners = this.eventListeners.get(type);
        if (listeners) {
            const index = listeners.indexOf(listener);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * 触发事件
     */
    private emitEvent(type: PrivacyEventType, data?: any): void {
        const listeners = this.eventListeners.get(type);
        if (listeners) {
            const event: PrivacyEvent = {
                type,
                timestamp: Date.now(),
                data
            };

            listeners.forEach(listener => {
                try {
                    listener(event);
                } catch (error) {
                    console.error('[Privacy] Event listener error:', error);
                }
            });
        }
    }

    /**
     * 获取会话统计信息
     */
    getSessionStats(): {
        totalTime: number;
        activeTime: number;
        idleTime: number;
        isActive: boolean;
    } {
        if (!this.sessionInfo) {
            return {
                totalTime: 0,
                activeTime: 0,
                idleTime: 0,
                isActive: false
            };
        }

        const now = Date.now();
        const totalTime = now - this.sessionInfo.startTime;
        const idleTime = now - this.sessionInfo.lastActivity;
        const activeTime = totalTime - idleTime;

        return {
            totalTime,
            activeTime,
            idleTime,
            isActive: idleTime < this.maxIdleTime * 60 * 1000
        };
    }
}

/**
 * 获取会话管理器实例
 */
export function getSessionManager(): SessionManager {
    return SessionManager.getInstance();
}
