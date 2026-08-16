/**
 * 隐私保护设置面板
 * 截图模式和私密模式配置，保护用户隐私
 */

import { BaseSettingsPanel } from '../base/BaseSettingsPanel';
import { showMessage } from '../../../ui/toast';
import { getSettings, saveSettings } from '../../../../utils/storage';
import { getPrivacyManager, getPasswordService, getRecoveryService } from '../../../../features/privacy';
import type { ExtensionSettings } from '../../../../types';
import type { SettingsValidationResult, SettingsSaveResult } from '../types';

/**
 * 隐私保护设置面板类
 */
export class PrivacySettings extends BaseSettingsPanel {
    // 截图模式元素
    private screenshotEnabled!: HTMLInputElement;
    private blurIntensity!: HTMLInputElement;
    private blurIntensityValue!: HTMLSpanElement;
    private autoBlurTrigger!: HTMLSelectElement;
    private blurAreaCheckboxes!: NodeListOf<HTMLInputElement>;
    private contentPagesScreenshotEnabled!: HTMLInputElement;

    // 私密模式元素
    private privateModeEnabled!: HTMLInputElement;
    private requirePassword!: HTMLInputElement;
    private sessionTimeout!: HTMLInputElement;
    private lockOnTabLeave!: HTMLInputElement;
    private lockOnExtensionClose!: HTMLInputElement;

    // 按钮元素
    private setPasswordBtn!: HTMLButtonElement;
    private changePasswordBtn!: HTMLButtonElement;
    private removePasswordBtn!: HTMLButtonElement;
    private setupSecurityQuestionsBtn!: HTMLButtonElement;
    private generateBackupCodeBtn!: HTMLButtonElement;

    constructor() {
        super({
            panelId: 'privacy-settings',
            panelName: '隐私保护设置',
            autoSave: false, // 隐私设置需要特殊处理，不自动保存
            requireValidation: true
        });
    }

    /**
     * 初始化DOM元素
     */
    protected initializeElements(): void {
        // 截图模式元素
        this.screenshotEnabled = document.getElementById('screenshotModeEnabled') as HTMLInputElement;
        this.blurIntensity = document.getElementById('blurIntensity') as HTMLInputElement;
        this.blurIntensityValue = document.getElementById('blurIntensityValue') as HTMLSpanElement;
        this.autoBlurTrigger = document.getElementById('autoBlurTrigger') as HTMLSelectElement;
        this.blurAreaCheckboxes = document.querySelectorAll('[data-area]') as NodeListOf<HTMLInputElement>;
        this.contentPagesScreenshotEnabled = document.getElementById('contentPagesScreenshotEnabled') as HTMLInputElement;

        // 私密模式元素
        this.privateModeEnabled = document.getElementById('privateModeEnabled') as HTMLInputElement;
        this.requirePassword = document.getElementById('requirePassword') as HTMLInputElement;
        this.sessionTimeout = document.getElementById('sessionTimeout') as HTMLInputElement;
        this.lockOnTabLeave = document.getElementById('lockOnTabLeave') as HTMLInputElement;
        this.lockOnExtensionClose = document.getElementById('lockOnExtensionClose') as HTMLInputElement;

        // 按钮元素
        this.setPasswordBtn = document.getElementById('setPasswordBtn') as HTMLButtonElement;
        this.changePasswordBtn = document.getElementById('changePasswordBtn') as HTMLButtonElement;
        this.removePasswordBtn = document.getElementById('removePasswordBtn') as HTMLButtonElement;
        this.setupSecurityQuestionsBtn = document.getElementById('setupSecurityQuestionsBtn') as HTMLButtonElement;
        this.generateBackupCodeBtn = document.getElementById('generateBackupCodeBtn') as HTMLButtonElement;

        if (!this.screenshotEnabled || !this.privateModeEnabled) {
            throw new Error('隐私保护设置相关的DOM元素未找到');
        }
    }

    /**
     * 绑定事件监听器
     */
    protected bindEvents(): void {
        const signal = this.createEventBindingSignal();

        // 截图模式事件
        this.screenshotEnabled?.addEventListener('change', this.handleScreenshotModeToggle.bind(this), { signal });
        this.blurIntensity?.addEventListener('input', this.handleBlurIntensityChange.bind(this), { signal });
        this.autoBlurTrigger?.addEventListener('change', this.handleAutoBlurTriggerChange.bind(this), { signal });
        this.contentPagesScreenshotEnabled?.addEventListener('change', this.handleContentPagesScreenshotToggle.bind(this), { signal });
        
        // 模糊区域选择事件
        this.blurAreaCheckboxes?.forEach(checkbox => {
            checkbox.addEventListener('change', this.handleBlurAreaChange.bind(this), { signal });
        });

        // 私密模式事件
        this.privateModeEnabled?.addEventListener('change', this.handlePrivateModeToggle.bind(this), { signal });
        this.requirePassword?.addEventListener('change', this.handleRequirePasswordToggle.bind(this), { signal });
        this.sessionTimeout?.addEventListener('change', this.handlePrivateModeSettingsChange.bind(this), { signal });
        this.lockOnTabLeave?.addEventListener('change', this.handlePrivateModeSettingsChange.bind(this), { signal });
        this.lockOnExtensionClose?.addEventListener('change', this.handlePrivateModeSettingsChange.bind(this), { signal });

        // 按钮事件
        this.setPasswordBtn?.addEventListener('click', this.handleSetPassword.bind(this), { signal });
        this.changePasswordBtn?.addEventListener('click', this.handleChangePassword.bind(this), { signal });
        this.removePasswordBtn?.addEventListener('click', this.handleRemovePassword.bind(this), { signal });
        this.setupSecurityQuestionsBtn?.addEventListener('click', this.handleSetupSecurityQuestions.bind(this), { signal });
        this.generateBackupCodeBtn?.addEventListener('click', this.handleGenerateBackupCode.bind(this), { signal });
    }

    /**
     * 解绑事件监听器
     */
    protected unbindEvents(): void {
        this.unbindManagedEvents();
    }

    /**
     * 加载设置到UI
     */
    protected async doLoadSettings(): Promise<void> {
        try {
            const settings = await getSettings();
            const privacyConfig = settings.privacy;

            // 截图模式设置
            if (this.screenshotEnabled) this.screenshotEnabled.checked = privacyConfig.screenshotMode.enabled;
            if (this.blurIntensity) {
                this.blurIntensity.value = privacyConfig.screenshotMode.blurIntensity.toString();
                if (this.blurIntensityValue) this.blurIntensityValue.textContent = privacyConfig.screenshotMode.blurIntensity.toString();
            }
            if (this.autoBlurTrigger) this.autoBlurTrigger.value = privacyConfig.screenshotMode.autoBlurTrigger;
            if (this.contentPagesScreenshotEnabled) {
                this.contentPagesScreenshotEnabled.checked = privacyConfig.screenshotMode.contentPages?.enabled === true;
            }
            
            // 加载模糊区域选择
            const enabledAreas = privacyConfig.screenshotMode.blurAreas || [];
            this.blurAreaCheckboxes?.forEach(checkbox => {
                const area = checkbox.getAttribute('data-area');
                if (area) {
                    checkbox.checked = enabledAreas.includes(area as any);
                }
            });

            // 私密模式设置
            if (this.privateModeEnabled) this.privateModeEnabled.checked = privacyConfig.privateMode.enabled;
            if (this.requirePassword) this.requirePassword.checked = privacyConfig.privateMode.requirePassword;
            if (this.sessionTimeout) {
                const idleTimeout = (privacyConfig.privateMode as any).idleTimeout || 10;
                this.sessionTimeout.value = idleTimeout.toString();
            }
            if (this.lockOnTabLeave) this.lockOnTabLeave.checked = privacyConfig.privateMode.lockOnTabLeave;
            if (this.lockOnExtensionClose) this.lockOnExtensionClose.checked = privacyConfig.privateMode.lockOnExtensionClose;

            // 更新密码状态显示
            this.updatePasswordStatus(privacyConfig.privateMode.passwordHash !== '');

            // 更新恢复选项状态
            await this.updateRecoveryOptionsStatus();

        } catch (error) {
            console.error('[Settings] Failed to load privacy settings:', error);
            throw error;
        }
    }

    /**
     * 保存设置
     */
    protected async doSaveSettings(): Promise<SettingsSaveResult> {
        try {
            // 隐私设置通过专门的隐私管理器保存，不直接保存到settings
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '保存失败'
            };
        }
    }

    /**
     * 验证设置
     */
    protected doValidateSettings(): SettingsValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 验证模糊强度（1-10）
        if (this.blurIntensity) {
            const blurValue = parseInt(this.blurIntensity.value, 10);
            if (isNaN(blurValue) || blurValue < 1 || blurValue > 10) {
                errors.push('模糊强度必须在1-10之间');
            }
        }

        // 验证会话超时
        if (this.sessionTimeout) {
            const timeout = parseInt(this.sessionTimeout.value, 10);
            if (isNaN(timeout) || timeout < 5 || timeout > 1440) {
                errors.push('会话超时时间必须在5-1440分钟之间');
            }
        }

        // 验证私密模式密码要求
        if (this.privateModeEnabled?.checked && this.requirePassword?.checked) {
            // 这里可以添加密码强度验证
            warnings.push('启用密码保护后，请确保设置了强密码');
        }

        return {
            isValid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * 获取当前设置
     */
    protected doGetSettings(): Partial<ExtensionSettings> {
        // 隐私设置通过隐私管理器获取，这里返回空对象
        return {};
    }

    /**
     * 设置数据到UI
     */
    protected doSetSettings(_settings: Partial<ExtensionSettings>): void {
        // 隐私设置通过loadSettings方法处理
        this.loadSettings();
    }

    /**
     * 处理截图模式开关
     */
    private async handleScreenshotModeToggle(event: Event): Promise<void> {
        const checkbox = event.target as HTMLInputElement;
        
        try {
            const privacyManager = getPrivacyManager();
            
            if (checkbox.checked) {
                await privacyManager.enableScreenshotMode();
                showMessage('截图模式已启用', 'success');
            } else {
                await privacyManager.disableScreenshotMode();
                showMessage('截图模式已禁用', 'success');
            }
            
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to toggle screenshot mode:', error);
            checkbox.checked = !checkbox.checked; // 回滚状态
            showMessage('切换截图模式失败', 'error');
        }
    }

    /**
     * 处理模糊强度变化
     */
    private async handleBlurIntensityChange(event: Event): Promise<void> {
        const slider = event.target as HTMLInputElement;
        const value = parseInt(slider.value, 10);
        
        if (this.blurIntensityValue) {
            this.blurIntensityValue.textContent = value.toString();
        }
        
        try {
            const privacyManager = getPrivacyManager();
            await privacyManager.updateScreenshotSettings({ blurIntensity: value });
            showMessage('模糊强度已更新', 'success');
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to update blur intensity:', error);
            showMessage('更新模糊强度失败', 'error');
        }
    }

    /**
     * 处理自动模糊触发条件变化
     */
    private async handleAutoBlurTriggerChange(event: Event): Promise<void> {
        const select = event.target as HTMLSelectElement;
        
        try {
            const privacyManager = getPrivacyManager();
            await privacyManager.updateScreenshotSettings({ autoBlurTrigger: select.value });
            showMessage('自动模糊触发条件已更新', 'success');
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to update auto blur trigger:', error);
            showMessage('更新自动模糊触发条件失败', 'error');
        }
    }

    /**
     * 处理普通内容页截图模糊范围开关。
     * 该范围独立保存，不调用完整隐私管理器，避免在 content 中触发锁屏。
     */
    private async handleContentPagesScreenshotToggle(event: Event): Promise<void> {
        const checkbox = event.target as HTMLInputElement;
        try {
            const settings = await getSettings();
            settings.privacy.screenshotMode.contentPages = {
                ...settings.privacy.screenshotMode.contentPages,
                enabled: checkbox.checked,
                sites: {
                    javdb: settings.privacy.screenshotMode.contentPages?.sites?.javdb !== false,
                    javbus: settings.privacy.screenshotMode.contentPages?.sites?.javbus !== false,
                },
            };
            await saveSettings(settings);
            showMessage(checkbox.checked ? '普通内容页截图模糊已启用' : '普通内容页截图模糊已禁用', 'success');
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to toggle content-page screenshot blur:', error);
            checkbox.checked = !checkbox.checked;
            showMessage('切换普通内容页截图模糊失败', 'error');
        }
    }

    /**
     * 处理模糊区域变化
     */
    private async handleBlurAreaChange(): Promise<void> {
        try {
            const enabledAreas: string[] = [];
            this.blurAreaCheckboxes?.forEach(checkbox => {
                if (checkbox.checked) {
                    const area = checkbox.getAttribute('data-area');
                    if (area) {
                        enabledAreas.push(area);
                    }
                }
            });
            
            const privacyManager = getPrivacyManager();
            await privacyManager.updateScreenshotSettings({
                blurAreas: enabledAreas as any
            });
            showMessage('模糊区域已更新', 'success');
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to update blur areas:', error);
            showMessage('更新模糊区域失败', 'error');
        }
    }

    /**
     * 处理私密模式开关
     */
    private async handlePrivateModeToggle(event: Event): Promise<void> {
        const checkbox = event.target as HTMLInputElement;
        
        try {
            const settings = await getSettings();
            const privacyManager = getPrivacyManager();
            
            // 如果要开启私密模式
            if (checkbox.checked) {
                // 检查是否设置了密码
                if (!settings.privacy.privateMode.passwordHash) {
                    // 没有设置密码，提示用户先设置
                    checkbox.checked = false;
                    showMessage('请先设置密码才能启用私密模式', 'warning');
                    
                    // 自动打开设置密码对话框
                    setTimeout(() => {
                        this.handleSetPassword();
                    }, 500);
                    return;
                }
                
                // 已设置密码，需要验证密码
                const { showPasswordModal } = await import('../../../components/privacy/PasswordModal');
                const result = await showPasswordModal('verify');
                
                if (!result.success) {
                    checkbox.checked = false;
                    showMessage('密码验证失败，无法启用私密模式', 'error');
                    return;
                }
                
                await privacyManager.enablePrivateMode();
                showMessage('私密模式已启用', 'success');
            } else {
                // 关闭私密模式，需要验证密码
                if (settings.privacy.privateMode.passwordHash) {
                    const { showPasswordModal } = await import('../../../components/privacy/PasswordModal');
                    const result = await showPasswordModal('verify');
                    
                    if (!result.success) {
                        checkbox.checked = true;
                        showMessage('密码验证失败，无法关闭私密模式', 'error');
                        return;
                    }
                }
                
                await privacyManager.disablePrivateMode();
                showMessage('私密模式已禁用', 'success');
            }
            
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to toggle private mode:', error);
            checkbox.checked = !checkbox.checked; // 回滚状态
            showMessage('切换私密模式失败', 'error');
        }
    }

    /**
     * 处理密码要求开关
     */
    private async handleRequirePasswordToggle(event: Event): Promise<void> {
        const checkbox = event.target as HTMLInputElement;
        
        try {
            const privacyManager = getPrivacyManager();
            await privacyManager.updatePrivateModeSettings({ requirePassword: checkbox.checked });
            
            showMessage(checkbox.checked ? '已启用密码保护' : '已禁用密码保护', 'success');
            
            // 更新密码按钮状态
            this.updatePasswordButtonsState();
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to toggle password requirement:', error);
            checkbox.checked = !checkbox.checked; // 回滚状态
            showMessage('切换密码要求失败', 'error');
        }
    }

    /**
     * 处理私密模式设置变化
     */
    private async handlePrivateModeSettingsChange(): Promise<void> {
        try {
            const privacyManager = getPrivacyManager();
            const idleTimeout = parseInt(this.sessionTimeout?.value || '10', 10);
            
            await privacyManager.updatePrivateModeSettings({
                sessionTimeout: idleTimeout, // 现在sessionTimeout就是无操作超时
                idleTimeout: idleTimeout,
                lockOnTabLeave: this.lockOnTabLeave?.checked || false,
                lockOnExtensionClose: this.lockOnExtensionClose?.checked || false
            });
            showMessage('私密模式设置已更新', 'success');
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to update private mode settings:', error);
            showMessage('更新私密模式设置失败', 'error');
        }
    }

    /**
     * 处理设置密码
     */
    private async handleSetPassword(): Promise<void> {
        try {
            const passwordService = getPasswordService();
            const success = await passwordService.showSetPasswordDialog();
            
            if (success) {
                showMessage('密码设置成功', 'success');
                this.updatePasswordStatus(true);
            }
        } catch (error) {
            console.error('[Settings] Failed to set password:', error);
            showMessage('设置密码失败', 'error');
        }
    }

    /**
     * 处理修改密码
     */
    private async handleChangePassword(): Promise<void> {
        try {
            const passwordService = getPasswordService();
            const success = await passwordService.showChangePasswordDialog();
            
            if (success) {
                showMessage('密码修改成功', 'success');
            }
        } catch (error) {
            console.error('[Settings] Failed to change password:', error);
            showMessage('修改密码失败', 'error');
        }
    }

    /**
     * 处理取消密码
     */
    private async handleRemovePassword(): Promise<void> {
        try {
            // 确认对话框
            const confirmed = confirm(
                '确定要取消密码吗？\n\n' +
                '取消密码后：\n' +
                '• 私密模式将自动关闭\n' +
                '• 所有密码保护功能将失效\n' +
                '• 恢复方式（安全问题、备份码）将被保留\n\n' +
                '此操作不可撤销，确定继续吗？'
            );
            
            if (!confirmed) {
                return;
            }
            
            const settings = await getSettings();
            
            // 清除密码
            settings.privacy.privateMode.passwordHash = '';
            settings.privacy.privateMode.passwordSalt = '';
            settings.privacy.privateMode.requirePassword = false;
            settings.privacy.privateMode.enabled = false; // 自动关闭私密模式
            
            await saveSettings(settings);
            
            // 更新UI
            this.updatePasswordStatus(false);
            if (this.privateModeEnabled) {
                this.privateModeEnabled.checked = false;
            }
            
            showMessage('密码已取消，私密模式已关闭', 'success');
            this.emit('change');
        } catch (error) {
            console.error('[Settings] Failed to remove password:', error);
            showMessage('取消密码失败', 'error');
        }
    }

    /**
     * 处理设置安全问题
     */
    private async handleSetupSecurityQuestions(): Promise<void> {
        try {
            const recoveryService = getRecoveryService();
            const success = await recoveryService.showSecurityQuestionsDialog();
            
            if (success) {
                showMessage('安全问题设置成功', 'success');
                await this.updateRecoveryOptionsStatus();
            }
        } catch (error) {
            console.error('[Settings] Failed to setup security questions:', error);
            showMessage('设置安全问题失败', 'error');
        }
    }

    /**
     * 处理生成备份码
     */
    private async handleGenerateBackupCode(): Promise<void> {
        try {
            const recoveryService = getRecoveryService();
            const backupCode = await recoveryService.generateBackupCode();
            
            if (backupCode) {
                // 使用自定义弹窗显示备份码
                this.showBackupCodeModal(backupCode);

                // 刷新状态显示
                await this.updateRecoveryOptionsStatus();
            }
        } catch (error) {
            console.error('[Settings] Failed to generate backup code:', error);
            showMessage('生成备份码失败', 'error');
        }
    }

    /**
     * 显示备份码弹窗
     */
    private showBackupCodeModal(backupCode: string): void {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: Arial, sans-serif;
        `;

        overlay.innerHTML = `
            <div style="
                background: white;
                border-radius: 16px;
                padding: 40px;
                max-width: 580px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            ">
                <div style="text-align: center; padding: 20px 0;">
                    <div style="
                        width: 80px;
                        height: 80px;
                        margin: 0 auto 24px;
                        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
                    ">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                    
                    <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 24px; font-weight: 700;">备份恢复码已生成</h3>
                    <p style="color: #6b7280; margin: 0 0 32px 0; line-height: 1.6; font-size: 15px;">
                        请妥善保存此恢复码，它只会显示一次
                    </p>
                </div>

                <div style="
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border: 2px solid #e5e7eb;
                    border-radius: 16px;
                    padding: 24px;
                    margin-bottom: 24px;
                ">
                    <div style="
                        font-family: 'Courier New', monospace;
                        font-size: 24px;
                        font-weight: 700;
                        color: #111827;
                        text-align: center;
                        letter-spacing: 4px;
                        padding: 16px;
                        background: white;
                        border-radius: 12px;
                        border: 2px dashed #d1d5db;
                        user-select: all;
                        word-break: break-all;
                    " id="backup-code-display">${backupCode}</div>
                    
                    <button id="copy-backup-code-btn" style="
                        width: 100%;
                        margin-top: 16px;
                        padding: 14px;
                        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                        color: white;
                        border: none;
                        border-radius: 10px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                    ">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span id="copy-btn-text">复制到剪贴板</span>
                    </button>
                </div>

                <div style="
                    background: #dbeafe;
                    border-radius: 12px;
                    padding: 16px 18px;
                    margin-bottom: 16px;
                    display: flex;
                    gap: 12px;
                ">
                    <span style="font-size: 18px; flex-shrink: 0; line-height: 1.5;">☁️</span>
                    <div style="flex: 1;">
                        <p style="margin: 0 0 4px 0; color: #1e40af; font-size: 14px; font-weight: 600;">自动备份到 WebDAV</p>
                        <p style="margin: 0; color: #1e40af; font-size: 13px; line-height: 1.6;">
                            备份码已自动保存到 WebDAV 云端，即使本地丢失也可以从备份文件中恢复
                        </p>
                    </div>
                </div>

                <div style="
                    background: #fef3c7;
                    border-radius: 12px;
                    padding: 16px 18px;
                    margin-bottom: 24px;
                    display: flex;
                    gap: 12px;
                ">
                    <span style="font-size: 18px; flex-shrink: 0; line-height: 1.5;">⚠️</span>
                    <div style="flex: 1;">
                        <p style="margin: 0 0 8px 0; color: #92400e; font-size: 14px; font-weight: 600;">重要提示</p>
                        <ul style="margin: 0; padding-left: 20px; color: #92400e; font-size: 13px; line-height: 1.6;">
                            <li>此恢复码只显示一次，请务必保存</li>
                            <li>建议将其保存在安全的地方（如密码管理器）</li>
                            <li>使用后该恢复码将失效，需重新生成</li>
                        </ul>
                    </div>
                </div>
                
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button class="confirm-backup-btn" style="
                        padding: 12px 32px;
                        border: none;
                        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                        color: white;
                        border-radius: 10px;
                        cursor: pointer;
                        font-size: 15px;
                        font-weight: 600;
                        transition: all 0.2s;
                        box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
                    ">我已保存</button>
                </div>
            </div>
        `;

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            #copy-backup-code-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
            }
            #copy-backup-code-btn:active {
                transform: translateY(0);
            }
            .confirm-backup-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
            }
            .confirm-backup-btn:active {
                transform: translateY(0);
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(overlay);

        // 绑定事件
        const copyBtn = overlay.querySelector('#copy-backup-code-btn') as HTMLButtonElement;
        const confirmBtn = overlay.querySelector('.confirm-backup-btn') as HTMLButtonElement;
        const copyBtnText = overlay.querySelector('#copy-btn-text') as HTMLSpanElement;

        copyBtn?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(backupCode);
                copyBtnText.textContent = '✓ 已复制';
                copyBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                showMessage('备份码已复制到剪贴板', 'success');
                
                setTimeout(() => {
                    copyBtnText.textContent = '复制到剪贴板';
                    copyBtn.style.background = 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)';
                }, 2000);
            } catch (error) {
                showMessage('复制失败，请手动复制', 'error');
            }
        });

        confirmBtn?.addEventListener('click', () => {
            document.body.removeChild(overlay);
            document.head.removeChild(style);
        });

        // 点击遮罩层关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                document.head.removeChild(style);
            }
        });
    }

    /**
     * 更新密码状态显示
     */
    private updatePasswordStatus(hasPassword: boolean): void {
        const passwordStatus = document.getElementById('passwordStatus');
        if (passwordStatus) {
            passwordStatus.textContent = hasPassword ? '已设置' : '未设置';
            passwordStatus.className = hasPassword ? 'privacy-status privacy-status-success' : 'privacy-status privacy-status-warning';
        }
        
        this.updatePasswordButtonsState();
    }

    /**
     * 更新密码按钮状态
     */
    private async updatePasswordButtonsState(): Promise<void> {
        const settings = await getSettings();
        const hasPassword = !!settings.privacy.privateMode.passwordHash;
        
        if (this.setPasswordBtn) {
            this.setPasswordBtn.style.display = hasPassword ? 'none' : 'inline-block';
        }
        
        if (this.changePasswordBtn) {
            this.changePasswordBtn.style.display = hasPassword ? 'inline-block' : 'none';
        }
        
        if (this.removePasswordBtn) {
            this.removePasswordBtn.style.display = hasPassword ? 'inline-block' : 'none';
        }
    }

    /**
     * 更新恢复选项状态
     */
    private async updateRecoveryOptionsStatus(): Promise<void> {
        try {
            const recoveryService = getRecoveryService();
            const hasSecurityQuestions = await recoveryService.hasSecurityQuestions();
            const hasBackupCode = await recoveryService.hasBackupCode();
            
            const securityQuestionsStatus = document.getElementById('securityQuestionsStatus');
            if (securityQuestionsStatus) {
                securityQuestionsStatus.textContent = hasSecurityQuestions ? '已设置' : '未设置';
                securityQuestionsStatus.className = hasSecurityQuestions ? 'privacy-status privacy-status-success' : 'privacy-status privacy-status-warning';
            }
            
            const backupCodeStatus = document.getElementById('backupCodeStatus');
            if (backupCodeStatus) {
                backupCodeStatus.textContent = hasBackupCode ? '已生成' : '未生成';
                backupCodeStatus.className = hasBackupCode ? 'privacy-status privacy-status-success' : 'privacy-status privacy-status-warning';
            }

            // 更新按钮文本
            if (this.setupSecurityQuestionsBtn) {
                this.setupSecurityQuestionsBtn.textContent = hasSecurityQuestions ? '修改安全问题' : '设置安全问题';
            }
            
            if (this.generateBackupCodeBtn) {
                this.generateBackupCodeBtn.textContent = hasBackupCode ? '重置备份恢复码' : '生成备份恢复码';
            }
        } catch (error) {
            console.error('[Settings] Failed to update recovery options status:', error);
        }
    }
}
