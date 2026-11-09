/**
 * 隐私管理器 - 核心管理类
 */

import { 
    IPrivacyManager, 
    PrivacyState, 
    PasswordVerificationResult,
    RestrictedFeature,
    PrivacyEvent,
    PrivacyEventType
} from '../../types/privacy';
import { getSettings, saveSettings } from '../../utils/storage';
import { getPasswordService } from './PasswordService';
import { getSessionManager } from './SessionManager';
import { getBlurController } from './BlurController';
import { getLockScreen } from './LockScreen';
import { log } from '../../utils/logController';
import { getPrivacyStorage } from './utils/storage';

export class PrivacyManager implements IPrivacyManager {
    private static instance: PrivacyManager;
    private passwordService = getPasswordService();
    private sessionManager = getSessionManager();
    private blurController = getBlurController();
    private lockScreen = getLockScreen();
    private storage = getPrivacyStorage();
    
    private currentState: PrivacyState = {
        isBlurred: false,
        isLocked: false,
        isAuthenticated: false,
        sessionStartTime: 0,
        lastActivity: Date.now(),
        temporaryViewActive: false,
        temporaryViewEndTime: 0
    };

    private eventListeners: Map<PrivacyEventType, ((event: PrivacyEvent) => void)[]> = new Map();
    private isInitialized = false;
    private idleCheckIntervalId: number | null = null;
    private lastUserActivity: number = Date.now();
    private idleThresholdMs: number = 2 * 60 * 1000; // 默认2分钟

    private constructor() {}

    public static getInstance(): PrivacyManager {
        if (!PrivacyManager.instance) {
            PrivacyManager.instance = new PrivacyManager();
        }
        return PrivacyManager.instance;
    }

    

    /**
     * 初始化隐私管理器
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            log.privacy('Initializing Privacy Manager...');

            // 加载隐私状态
            await this.loadPrivacyState();

            // 设置事件监听
            this.setupEventListeners();

            // 恢复会话（如果有效）
            // 显式锁定优先于可能因存储删除失败而残留的会话。
            const sessionRestored = !this.currentState.isLocked && await this.sessionManager.restoreSession();
            this.currentState.isAuthenticated = sessionRestored;
            this.currentState.sessionStartTime = sessionRestored ? this.sessionManager.getSessionInfo().startTime : 0;

            // 根据配置应用初始状态
            await this.applyInitialState();

            this.isInitialized = true;
            log.privacy('Privacy Manager initialized successfully');
        } catch (error) {
            console.error('[Privacy] Failed to initialize Privacy Manager:', error);
            throw new Error('隐私管理器初始化失败');
        }
    }

    /**
     * 测试模糊效果：确保启用截图模式后，临时取消模糊再自动恢复
     */
    async testBlurEffect(): Promise<void> {
        try {
            const settings = await getSettings();
            // 如果当前未处于模糊状态，先启用截图模式
            if (!this.currentState.isBlurred) {
                await this.enableScreenshotMode();
            }

            const duration = settings.privacy.screenshotMode.temporaryViewDuration || 10;
            await this.blurController.showTemporaryView(duration);

            // 结束后状态仍保持为截图模式生效
            this.currentState.isBlurred = true;
            await this.savePrivacyState();
            this.emitEvent('blur-applied', { mode: 'screenshot-test' });
        } catch (error) {
            console.error('[Privacy] Failed to test blur effect:', error);
            throw new Error('测试模糊效果失败');
        }
    }

    /**
     * 启用截图模式
     */
    async enableScreenshotMode(): Promise<void> {
        try {
            const settings = await getSettings();
            settings.privacy.screenshotMode.enabled = true;
            
            // 根据blurAreas生成protectedElements（如果blurAreas存在）
            if (settings.privacy.screenshotMode.blurAreas && settings.privacy.screenshotMode.blurAreas.length > 0) {
                const { getSelectorsForAreas } = await import('./blurAreaMapper');
                settings.privacy.screenshotMode.protectedElements = getSelectorsForAreas(settings.privacy.screenshotMode.blurAreas);
            }
            
            await saveSettings(settings);

            log.privacy('Enabling screenshot mode with elements:', settings.privacy.screenshotMode.protectedElements);
            await this.blurController.applyBlur(settings.privacy.screenshotMode.protectedElements);

            this.currentState.isBlurred = true;
            await this.savePrivacyState();

            this.emitEvent('blur-applied', { mode: 'screenshot' });
            log.privacy('Screenshot mode enabled');
        } catch (error) {
            console.error('[Privacy] Failed to enable screenshot mode:', error);
            throw new Error('启用截图模式失败');
        }
    }

    /**
     * 禁用截图模式
     */
    async disableScreenshotMode(): Promise<void> {
        try {
            const settings = await getSettings();
            settings.privacy.screenshotMode.enabled = false;
            await saveSettings(settings);

            await this.blurController.removeBlur();

            this.currentState.isBlurred = false;
            await this.savePrivacyState();

            this.emitEvent('blur-removed', { mode: 'screenshot' });
            log.privacy('Screenshot mode disabled');
        } catch (error) {
            console.error('[Privacy] Failed to disable screenshot mode:', error);
            throw new Error('禁用截图模式失败');
        }
    }

    /**
     * 强制重新应用截图模式（用于修复遗漏的元素）
     */
    async forceReapplyScreenshotMode(): Promise<void> {
        try {
            const settings = await getSettings();
            if (!settings.privacy.screenshotMode.enabled) {
                log.privacy('Screenshot mode not enabled, skipping force reapply');
                return;
            }

            // 根据blurAreas重新生成protectedElements
            if (settings.privacy.screenshotMode.blurAreas && settings.privacy.screenshotMode.blurAreas.length > 0) {
                const { getSelectorsForAreas } = await import('./blurAreaMapper');
                settings.privacy.screenshotMode.protectedElements = getSelectorsForAreas(settings.privacy.screenshotMode.blurAreas);
            }

            log.privacy('Force reapplying screenshot mode...');
            await this.blurController.forceReapplyBlur(settings.privacy.screenshotMode.protectedElements);

            this.currentState.isBlurred = true;
            await this.savePrivacyState();

            this.emitEvent('blur-applied', { mode: 'screenshot-force' });
            log.privacy('Screenshot mode force reapplied successfully');
        } catch (error) {
            console.error('[Privacy] Failed to force reapply screenshot mode:', error);
            throw new Error('强制重新应用截图模式失败');
        }
    }

    /**
     * 更新截图模式设置
     */
    async updateScreenshotSettings(updates: Partial<{
        blurIntensity: number;
        autoBlurTrigger: string;
        showEyeIcon: boolean;
        temporaryViewDuration: number;
        blurAreas: string[];
    }>): Promise<void> {
        try {
            const settings = await getSettings();

            // 更新设置
            if (updates.blurIntensity !== undefined) {
                settings.privacy.screenshotMode.blurIntensity = updates.blurIntensity;
                // 立即更新模糊控制器的强度
                this.blurController.setBlurIntensity(updates.blurIntensity);
            }

            if (updates.autoBlurTrigger !== undefined) {
                settings.privacy.screenshotMode.autoBlurTrigger = updates.autoBlurTrigger as any;
            }

            if (updates.showEyeIcon !== undefined) {
                settings.privacy.screenshotMode.showEyeIcon = updates.showEyeIcon;
            }

            if (updates.temporaryViewDuration !== undefined) {
                settings.privacy.screenshotMode.temporaryViewDuration = updates.temporaryViewDuration;
            }

            if (updates.blurAreas !== undefined) {
                settings.privacy.screenshotMode.blurAreas = updates.blurAreas as any;
                // 根据选择的区域更新protectedElements
                const { getSelectorsForAreas } = await import('./blurAreaMapper');
                settings.privacy.screenshotMode.protectedElements = getSelectorsForAreas(updates.blurAreas as any);
            }

            // 保存设置
            await saveSettings(settings);

            // 如果截图模式已启用，重新应用模糊效果以使用新设置
            if (settings.privacy.screenshotMode.enabled && this.currentState.isBlurred) {
                await this.blurController.forceReapplyBlur(settings.privacy.screenshotMode.protectedElements);
            }

            log.privacy('Screenshot settings updated:', updates);
        } catch (error) {
            console.error('[Privacy] Failed to update screenshot settings:', error);
            throw new Error('更新截图设置失败');
        }
    }

    /**
     * 切换模糊效果
     */
    async toggleBlur(): Promise<void> {
        if (this.currentState.isBlurred) {
            await this.disableScreenshotMode();
        } else {
            await this.enableScreenshotMode();
        }
    }

    /**
     * 启用私密模式
     */
    async enablePrivateMode(): Promise<void> {
        try {
            const settings = await getSettings();
            
            // 检查是否设置了密码
            if (settings.privacy.privateMode.requirePassword && !settings.privacy.privateMode.passwordHash) {
                throw new Error('请先设置密码');
            }

            settings.privacy.privateMode.enabled = true;
            await saveSettings(settings);

            // 如果需要密码验证，立即锁定要求验证
            if (settings.privacy.privateMode.requirePassword) {
                // 清除认证状态，强制重新验证
                this.currentState.isAuthenticated = false;
                await this.lock();
            }

            log.privacy('Private mode enabled');
        } catch (error) {
            console.error('[Privacy] Failed to enable private mode:', error);
            throw error;
        }
    }

    /**
     * 禁用私密模式
     */
    async disablePrivateMode(): Promise<void> {
        try {
            const settings = await getSettings();
            settings.privacy.privateMode.enabled = false;
            await saveSettings(settings);

            // 解锁并隐藏锁定屏幕
            this.currentState.isLocked = false;
            this.currentState.isAuthenticated = false; // 清除认证状态
            this.lockScreen.hide();
            await this.savePrivacyState();

            // 触发私密模式禁用事件（而不是 unlocked）
            this.emitEvent('privateModeDisabled', { mode: 'private' });
            log.privacy('Private mode disabled');
        } catch (error) {
            console.error('[Privacy] Failed to disable private mode:', error);
            throw new Error('禁用私密模式失败');
        }
    }

    /**
     * 更新私密模式设置
     */
    async updatePrivateModeSettings(updates: Partial<{
        sessionTimeout: number;
        idleTimeout: number;
        lockOnTabLeave: boolean;
        lockOnExtensionClose: boolean;
        requirePassword: boolean;
    }>): Promise<void> {
        try {
            const settings = await getSettings();

            // 更新设置
            if (updates.sessionTimeout !== undefined) {
                settings.privacy.privateMode.sessionTimeout = updates.sessionTimeout;
            }

            if (updates.idleTimeout !== undefined) {
                // 保存无操作超时时间（新增）
                (settings.privacy.privateMode as any).idleTimeout = updates.idleTimeout;
            }

            // 如果会话正在运行，重新配置会话管理器
            if (this.currentState.isAuthenticated && (updates.sessionTimeout !== undefined || updates.idleTimeout !== undefined)) {
                const sessionTimeout = updates.sessionTimeout || settings.privacy.privateMode.sessionTimeout;
                const idleTimeout = updates.idleTimeout || (settings.privacy.privateMode as any).idleTimeout || 10;
                this.sessionManager.configureSession(sessionTimeout, idleTimeout);
                await this.sessionManager.startSession(sessionTimeout, idleTimeout);
            }

            if (updates.lockOnTabLeave !== undefined) {
                settings.privacy.privateMode.lockOnTabLeave = updates.lockOnTabLeave;
            }

            if (updates.lockOnExtensionClose !== undefined) {
                settings.privacy.privateMode.lockOnExtensionClose = updates.lockOnExtensionClose;
            }

            if (updates.requirePassword !== undefined) {
                settings.privacy.privateMode.requirePassword = updates.requirePassword;
            }

            // 保存设置
            await saveSettings(settings);

            log.privacy('Private mode settings updated:', updates);
        } catch (error) {
            console.error('[Privacy] Failed to update private mode settings:', error);
            throw new Error('更新私密模式设置失败');
        }
    }

    /**
     * 密码验证
     */
    async authenticate(password: string): Promise<PasswordVerificationResult> {
        try {
            const settings = await getSettings();
            const privateMode = settings.privacy.privateMode;

            if (!privateMode.passwordHash || !privateMode.passwordSalt) {
                return {
                    success: false,
                    error: '未设置密码'
                };
            }

            const result = await this.passwordService.verifyPasswordWithLimits(
                password,
                privateMode.passwordHash,
                privateMode.passwordSalt
            );

            if (result.success) {
                // 启动会话（使用无操作超时）
                // 优先使用 idleTimeout，如果没有则使用 sessionTimeout（向后兼容）
                const idleTimeout = (privateMode as any).idleTimeout || privateMode.sessionTimeout || 10;
                await this.sessionManager.startSession(idleTimeout, idleTimeout);
                
                this.currentState.isLocked = false;
                this.currentState.isAuthenticated = true;
                this.currentState.sessionStartTime = Date.now();
                
                await this.savePrivacyState();

                // 隐藏锁定屏幕
                this.lockScreen.hide();

                this.emitEvent('authenticated', {});
                log.privacy('Authentication successful');
            }

            return result;
        } catch (error) {
            console.error('[Privacy] Authentication failed:', error);
            return {
                success: false,
                error: '验证过程中发生错误'
            };
        }
    }

    /**
     * 锁定
     */
    async lock(): Promise<void> {
        console.log('[PrivacyManager] lock() called, current state:', {
            isLocked: this.currentState.isLocked,
            isAuthenticated: this.currentState.isAuthenticated
        });

        // 防止重复锁定
        if (this.currentState.isLocked) {
            log.privacy('Already locked, skipping duplicate lock');
            return;
        }

        try {
            // 先遮挡页面。会话存储失败不能阻止本次锁屏。
            this.lockScreen.show();
            this.currentState.isLocked = true;
            this.currentState.isAuthenticated = false;
            this.currentState.sessionStartTime = 0;
            await this.sessionManager.endSession();

            await this.savePrivacyState();

            this.emitEvent('locked', {});
            log.privacy('Private mode locked');
            console.log('[PrivacyManager] Lock completed successfully');
        } catch (error) {
            console.error('[Privacy] Failed to lock:', error);
            throw new Error('锁定失败');
        }
    }

    /**
     * 获取当前状态
     */
    getState(): PrivacyState {
        return { ...this.currentState };
    }

    /**
     * 检查功能是否受限
     */
    async isFeatureRestricted(feature: RestrictedFeature): Promise<boolean> {
        // 如果未启用私密模式，不限制任何功能
        const privateEnabled = await this.isPrivateModeEnabled();
        if (!privateEnabled) {
            return false;
        }

        // 如果已认证，不限制功能
        if (this.currentState.isAuthenticated) {
            return false;
        }

        // 检查功能是否在受限列表中
        const restricted = await this.getRestrictedFeatures();
        return restricted.includes(feature);
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
     * 设置密码
     */
    async setPassword(password: string): Promise<{ success: boolean; error?: string }> {
        try {
            const strength = this.passwordService.validatePasswordStrength(password);
            if (strength.score < 40) {
                return {
                    success: false,
                    error: '密码强度不足'
                };
            }

            const { hash, salt } = await this.passwordService.hashPassword(password);
            
            const settings = await getSettings();
            settings.privacy.privateMode.passwordHash = hash;
            settings.privacy.privateMode.passwordSalt = salt;
            settings.privacy.privateMode.requirePassword = true;
            
            await saveSettings(settings);

            this.emitEvent('password-changed', {});
            log.privacy('Password set successfully');

            return { success: true };
        } catch (error) {
            console.error('Failed to set password:', error);
            return {
                success: false,
                error: '设置密码失败'
            };
        }
    }

    /**
     * 加载隐私状态
     */
    private async loadPrivacyState(): Promise<void> {
        try {
            const state = await this.storage.loadPrivacyState();
            if (state) {
                this.currentState = { ...this.currentState, ...state };
            }
        } catch (error) {
            console.error('Failed to load privacy state:', error);
        }
    }

    /**
     * 保存隐私状态
     */
    private async savePrivacyState(): Promise<void> {
        try {
            this.currentState.lastActivity = Date.now();
            await this.storage.savePrivacyState(this.currentState);
        } catch (error) {
            console.error('Failed to save privacy state:', error);
        }
    }

    /**
     * 设置事件监听
     */
    private setupEventListeners(): void {
        // 监听会话过期
        this.sessionManager.addEventListener('session-expired', async () => {
            log.privacy('Session expired event received');
            // 只有在私密模式启用且需要密码时才锁定
            const settings = await getSettings();
            if (settings.privacy.privateMode.enabled && 
                settings.privacy.privateMode.requirePassword &&
                !this.currentState.isLocked) {
                await this.lock();
            }
        });

        // 监听页面可见性变化
        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });

        // 监听窗口焦点变化
        window.addEventListener('blur', () => {
            this.handleWindowBlur();
        });

        window.addEventListener('focus', () => {
            this.handleWindowFocus();
        });

        // 监听关闭/刷新事件（尽力锁定）
        window.addEventListener('beforeunload', () => {
            this.handleBeforeUnload();
        });

        // 监听用户活动，用于 idle-timeout
        const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
        const activityHandler = () => {
            this.lastUserActivity = Date.now();
        };
        activityEvents.forEach(evt => document.addEventListener(evt, activityHandler, true));

        // 启动空闲检查器
        this.startIdleChecker();
    }

    /**
     * 应用初始状态
     */
    private async applyInitialState(): Promise<void> {
        // 延迟更长时间确保DOM完全加载，特别是侧边栏的动态内容
        await new Promise(resolve => setTimeout(resolve, 1000));

        const settings = await getSettings();

        // 确保根据blurAreas生成protectedElements
        if (settings.privacy.screenshotMode.blurAreas && settings.privacy.screenshotMode.blurAreas.length > 0) {
            const { getSelectorsForAreas } = await import('./blurAreaMapper');
            settings.privacy.screenshotMode.protectedElements = getSelectorsForAreas(settings.privacy.screenshotMode.blurAreas);
            log.privacy('Generated protectedElements from blurAreas:', {
                blurAreas: settings.privacy.screenshotMode.blurAreas,
                selectorsCount: settings.privacy.screenshotMode.protectedElements.length
            });
        }

        log.privacy('Applying initial privacy state:', {
            screenshotModeEnabled: settings.privacy.screenshotMode.enabled,
            privateModeEnabled: settings.privacy.privateMode.enabled,
            requirePassword: settings.privacy.privateMode.requirePassword,
            isAuthenticated: this.currentState.isAuthenticated,
            blurAreas: settings.privacy.screenshotMode.blurAreas,
            protectedElements: settings.privacy.screenshotMode.protectedElements
        });

        // 如果启用了私密模式且需要密码但未认证，则锁定
        if (settings.privacy.privateMode.enabled &&
            settings.privacy.privateMode.requirePassword &&
            !this.currentState.isAuthenticated) {
            
            // 如果状态已经是锁定的（从持久化存储恢复），直接显示锁定界面
            if (this.currentState.isLocked) {
                console.log('[PrivacyManager] State is already locked, showing lock screen directly');
                log.privacy('State is already locked, showing lock screen directly');
                this.lockScreen.show();
            } else {
                // 否则调用 lock() 方法进行完整的锁定流程
                console.log('[PrivacyManager] Locking due to private mode requirements');
                log.privacy('Locking due to private mode requirements');
                await this.lock();
            }
        }
        // 如果启用了截图模式，应用模糊（独立于私密模式）
        else if (settings.privacy.screenshotMode.enabled) {
            // 应用初始截图模式

            // 确保使用最新的配置
            await this.blurController.applyBlur(settings.privacy.screenshotMode.protectedElements);
            this.currentState.isBlurred = true;
            await this.savePrivacyState();

            // 初始截图模式应用完成
        } else {
            // 未启用隐私模式
            // 若配置为“扩展重启自动启用截图模式”，则在启动时启用
            if (settings.privacy.screenshotMode.autoBlurTrigger === 'extension-reopen') {
                await this.enableScreenshotMode();
            }
        }
    }

    /**
     * 处理页面可见性变化
     */
    private async handleVisibilityChange(): Promise<void> {
        const settings = await getSettings();
        
        if (document.hidden) {
            // 页面隐藏时的处理
            if (settings.privacy.screenshotMode.autoBlurTrigger === 'tab-leave') {
                await this.enableScreenshotMode();
            }
            
            if (settings.privacy.privateMode.lockOnTabLeave && settings.privacy.privateMode.enabled) {
                await this.lock();
            }
        }
    }

    /**
     * 处理窗口失去焦点
     */
    private async handleWindowBlur(): Promise<void> {
        // 可以在这里添加失去焦点时的处理逻辑
    }

    /**
     * 处理窗口获得焦点
     */
    private async handleWindowFocus(): Promise<void> {
        // 可以在这里添加获得焦点时的处理逻辑
    }

    /**
     * 处理窗口关闭/刷新
     */
    private handleBeforeUnload(): void {
        // 尽力而为：无法等待异步完成
        getSettings()
            .then(settings => {
                if (settings.privacy.privateMode.enabled && settings.privacy.privateMode.lockOnExtensionClose) {
                    // 触发锁定（不等待）
                    this.lock();
                }
            })
            .catch(() => {});
    }

    /**
     * 启动空闲检测（用于 autoBlurTrigger = 'idle-timeout'）
     */
    private startIdleChecker(): void {
        if (this.idleCheckIntervalId) {
            clearInterval(this.idleCheckIntervalId);
            this.idleCheckIntervalId = null;
        }

        this.idleCheckIntervalId = window.setInterval(async () => {
            try {
                const settings = await getSettings();
                if (settings.privacy.screenshotMode.autoBlurTrigger !== 'idle-timeout') {
                    return;
                }

                const idleMs = Date.now() - this.lastUserActivity;
                if (idleMs >= this.idleThresholdMs) {
                    await this.enableScreenshotMode();
                }
            } catch {
                // 忽略错误，继续下一轮
            }
        }, 30 * 1000); // 每30秒检查一次
    }


    /**
     * 检查是否启用私密模式
     */
    private async isPrivateModeEnabled(): Promise<boolean> {
        const settings = await getSettings();
        return settings.privacy.privateMode.enabled;
    }

    /**
     * 获取受限功能列表
     */
    private async getRestrictedFeatures(): Promise<RestrictedFeature[]> {
        const settings = await getSettings();
        return settings.privacy.privateMode.restrictedFeatures;
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
                    console.error('Event listener error:', error);
                }
            });
        }
    }
}

/**
 * 获取隐私管理器实例
 */
export function getPrivacyManager(): PrivacyManager {
    return PrivacyManager.getInstance();
}
