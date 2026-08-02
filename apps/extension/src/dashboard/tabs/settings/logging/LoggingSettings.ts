/**
 * 日志设置面板
 * 日志记录配置、日志级别设置、日志查看和管理
 */

import { STATE } from '../../../state';
import { BaseSettingsPanel } from '../base/BaseSettingsPanel';
import { showMessage } from '../../../ui/toast';
import { onSettingsChanged, log } from '../../../../utils/logController';
import type { ExtensionSettings } from '../../../../types';
import type { SettingsValidationResult, SettingsSaveResult } from '../types';
import { saveSettings } from '../../../../utils/storage';

/**
 * 日志设置面板类
 */
export class LoggingSettings extends BaseSettingsPanel {
    // 日志配置元素 - 使用HTML中实际存在的元素ID
    private maxLogEntries!: HTMLInputElement;
    private maxMagnetPushEntries!: HTMLInputElement;
    private verboseMode!: HTMLInputElement;
    private showPrivacyLogs!: HTMLInputElement;
    private showStorageLogs!: HTMLInputElement;
    private retentionDays!: HTMLInputElement; // 可选：日志按天数保留
    // 统一控制台代理 - 控件
    private consoleLevel!: HTMLSelectElement;
    private consoleShowTimestamp!: HTMLInputElement;
    private consoleShowMilliseconds!: HTMLInputElement;
    private consoleShowSource!: HTMLInputElement;
    private consoleColor!: HTMLInputElement;
    private consoleTimeZone!: HTMLInputElement;
    
    // 新的模块化日志开关
    private logModuleCore!: HTMLInputElement;
    private logModuleOrchestrator!: HTMLInputElement;
    private logModuleStorage!: HTMLInputElement;
    private logModuleActor!: HTMLInputElement;
    private logModuleMagnet!: HTMLInputElement;
    private logModuleSync!: HTMLInputElement;
    private logModuleNewWorks!: HTMLInputElement;
    private logModuleDrive115!: HTMLInputElement;
    private logModulePrivacy!: HTMLInputElement;
    private logModuleAI!: HTMLInputElement;
    private logModuleEnhancement!: HTMLInputElement;
    private logModuleUpdate!: HTMLInputElement;
    private logModuleHelp!: HTMLInputElement;
    private logModuleSettings!: HTMLInputElement;
    private logModuleGeneral!: HTMLInputElement;
    private logModuleDebug!: HTMLInputElement;

    // 快捷按钮
    private consoleMuteAllBtn!: HTMLButtonElement;
    private consoleEnableAllBtn!: HTMLButtonElement;
    private consoleResetDefaultBtn!: HTMLButtonElement;
    
    // 抑制控制台输出开关
    private suppressConsoleOutput!: HTMLInputElement;

    constructor() {
        super({
            panelId: 'log-settings',
            panelName: '日志设置',
            autoSave: true,
            saveDelay: 1000,
            requireValidation: true
        });
    }

    /**
     * 初始化DOM元素
     */
    protected initializeElements(): void {
        // 使用HTML中实际存在的元素ID
        this.maxLogEntries = document.getElementById('maxLogEntries') as HTMLInputElement;
        this.maxMagnetPushEntries = document.getElementById('maxMagnetPushEntries') as HTMLInputElement;
        this.verboseMode = document.getElementById('verboseMode') as HTMLInputElement;
        this.showPrivacyLogs = document.getElementById('showPrivacyLogs') as HTMLInputElement;
        this.showStorageLogs = document.getElementById('showStorageLogs') as HTMLInputElement;
        // 可选：ID 为 logRetentionDays 的输入框（未在旧模板中时不报错）
        this.retentionDays = document.getElementById('logRetentionDays') as HTMLInputElement;
        if (!this.retentionDays) {
            // 旧模板不存在时，动态插入一个字段，避免修改大型 HTML 文件
            try {
                const anchorField = this.maxLogEntries ? this.maxLogEntries.closest('.form-group') : null;
                if (anchorField && anchorField.parentElement) {
                    const field = document.createElement('div');
                    field.className = 'form-group';
                    field.innerHTML = `
                        <label for="logRetentionDays">日志保留天数</label>
                        <input type="number" id="logRetentionDays" class="number-input" min="0" max="3650" value="0">
                        <p class="input-description">设置为 0 表示不按天数清理，仅受最大条数限制。</p>
                    `;
                    anchorField.parentElement.insertBefore(field, anchorField.nextSibling);
                    this.retentionDays = field.querySelector('#logRetentionDays') as HTMLInputElement;
                }
            } catch (e) {
                console.warn('[LoggingSettings] 动态插入 logRetentionDays 失败：', e);
            }
        }
        // 控制台代理
        this.consoleLevel = document.getElementById('consoleLevel') as HTMLSelectElement;
        this.consoleShowTimestamp = document.getElementById('consoleShowTimestamp') as HTMLInputElement;
        this.consoleShowMilliseconds = document.getElementById('consoleShowMilliseconds') as HTMLInputElement;
        this.consoleShowSource = document.getElementById('consoleShowSource') as HTMLInputElement;
        this.consoleColor = document.getElementById('consoleColor') as HTMLInputElement;
        this.consoleTimeZone = document.getElementById('consoleTimeZone') as HTMLInputElement;
        
        // 新的模块化日志开关
        this.logModuleCore = document.getElementById('logModuleCore') as HTMLInputElement;
        this.logModuleOrchestrator = document.getElementById('logModuleOrchestrator') as HTMLInputElement;
        this.logModuleStorage = document.getElementById('logModuleStorage') as HTMLInputElement;
        this.logModuleActor = document.getElementById('logModuleActor') as HTMLInputElement;
        this.logModuleMagnet = document.getElementById('logModuleMagnet') as HTMLInputElement;
        this.logModuleSync = document.getElementById('logModuleSync') as HTMLInputElement;
        this.logModuleNewWorks = document.getElementById('logModuleNewWorks') as HTMLInputElement;
        this.logModuleDrive115 = document.getElementById('logModuleDrive115') as HTMLInputElement;
        this.logModulePrivacy = document.getElementById('logModulePrivacy') as HTMLInputElement;
        this.logModuleAI = document.getElementById('logModuleAI') as HTMLInputElement;
        this.logModuleEnhancement = document.getElementById('logModuleEnhancement') as HTMLInputElement;
        this.logModuleUpdate = document.getElementById('logModuleUpdate') as HTMLInputElement;
        this.logModuleHelp = document.getElementById('logModuleHelp') as HTMLInputElement;
        this.logModuleSettings = document.getElementById('logModuleSettings') as HTMLInputElement;
        this.logModuleGeneral = document.getElementById('logModuleGeneral') as HTMLInputElement;
        this.logModuleDebug = document.getElementById('logModuleDebug') as HTMLInputElement;

        // 快捷按钮
        this.consoleMuteAllBtn = document.getElementById('consoleMuteAll') as HTMLButtonElement;
        this.consoleEnableAllBtn = document.getElementById('consoleEnableAll') as HTMLButtonElement;
        this.consoleResetDefaultBtn = document.getElementById('consoleResetDefault') as HTMLButtonElement;
        
        // 抑制控制台输出开关
        this.suppressConsoleOutput = document.getElementById('suppressConsoleOutput') as HTMLInputElement;

        // 验证元素是否存在
        if (!this.maxLogEntries) {
            console.error('[LoggingSettings] 找不到maxLogEntries元素');
            return;
        }
        if (!this.maxMagnetPushEntries) {
            console.error('[LoggingSettings] 找不到maxMagnetPushEntries元素');
            return;
        }
        if (!this.verboseMode) {
            console.error('[LoggingSettings] 找不到verboseMode元素');
            return;
        }
        if (!this.showPrivacyLogs) {
            console.error('[LoggingSettings] 找不到showPrivacyLogs元素');
            return;
        }
        if (!this.showStorageLogs) {
            console.error('[LoggingSettings] 找不到showStorageLogs元素');
            return;
        }
        if (!this.retentionDays) console.warn('[LoggingSettings] 找不到 logRetentionDays 元素（可选）');

        // 控制台代理 - 基础校验（允许某些元素在旧模板中缺失，不中断）
        if (!this.consoleLevel) console.warn('[LoggingSettings] 找不到 consoleLevel 元素');
        if (!this.consoleShowTimestamp) console.warn('[LoggingSettings] 找不到 consoleShowTimestamp 元素');
        if (!this.consoleShowSource) console.warn('[LoggingSettings] 找不到 consoleShowSource 元素');
        if (!this.consoleShowMilliseconds) console.warn('[LoggingSettings] 找不到 consoleShowMilliseconds 元素');
        if (!this.consoleColor) console.warn('[LoggingSettings] 找不到 consoleColor 元素');
        if (!this.consoleTimeZone) console.warn('[LoggingSettings] 找不到 consoleTimeZone 元素');
        
        // 新模块化日志开关校验
        if (!this.logModuleCore) console.warn('[LoggingSettings] 找不到 logModuleCore 元素');
        if (!this.logModuleOrchestrator) console.warn('[LoggingSettings] 找不到 logModuleOrchestrator 元素');
        if (!this.logModuleStorage) console.warn('[LoggingSettings] 找不到 logModuleStorage 元素');
        if (!this.logModuleActor) console.warn('[LoggingSettings] 找不到 logModuleActor 元素');
        if (!this.logModuleMagnet) console.warn('[LoggingSettings] 找不到 logModuleMagnet 元素');
        if (!this.logModuleSync) console.warn('[LoggingSettings] 找不到 logModuleSync 元素');
        if (!this.logModuleNewWorks) console.warn('[LoggingSettings] 找不到 logModuleNewWorks 元素');
        if (!this.logModuleDrive115) console.warn('[LoggingSettings] 找不到 logModuleDrive115 元素');
        if (!this.logModulePrivacy) console.warn('[LoggingSettings] 找不到 logModulePrivacy 元素');
        if (!this.logModuleAI) console.warn('[LoggingSettings] 找不到 logModuleAI 元素');
        if (!this.logModuleEnhancement) console.warn('[LoggingSettings] 找不到 logModuleEnhancement 元素');
        if (!this.logModuleUpdate) console.warn('[LoggingSettings] 找不到 logModuleUpdate 元素');
        if (!this.logModuleHelp) console.warn('[LoggingSettings] 找不到 logModuleHelp 元素');
        if (!this.logModuleSettings) console.warn('[LoggingSettings] 找不到 logModuleSettings 元素');
        if (!this.logModuleGeneral) console.warn('[LoggingSettings] 找不到 logModuleGeneral 元素');
        if (!this.logModuleDebug) console.warn('[LoggingSettings] 找不到 logModuleDebug 元素');

        log.verbose('[LoggingSettings] DOM元素初始化完成');
    }

    /**
     * 绑定事件监听器
     */
    protected bindEvents(): void {
        const signal = this.createEventBindingSignal();

        // 日志配置事件
        this.maxLogEntries?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.maxMagnetPushEntries?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.verboseMode?.addEventListener('change', this.handleVerboseModeToggle.bind(this), { signal });
        this.showPrivacyLogs?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.showStorageLogs?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        // 控制台代理设置事件
        this.consoleLevel?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.consoleShowTimestamp?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.consoleShowSource?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.consoleShowMilliseconds?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.consoleColor?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.consoleTimeZone?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        
        // 新模块化日志开关事件
        this.logModuleCore?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleOrchestrator?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleStorage?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleActor?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleMagnet?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleSync?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleNewWorks?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleDrive115?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModulePrivacy?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleAI?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleEnhancement?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleUpdate?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleHelp?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleSettings?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleGeneral?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        this.logModuleDebug?.addEventListener('change', this.handleSettingChange.bind(this), { signal });

        // 控制台快捷按钮
        this.consoleMuteAllBtn?.addEventListener('click', this.handleConsoleMuteAll.bind(this), { signal });
        this.consoleEnableAllBtn?.addEventListener('click', this.handleConsoleEnableAll.bind(this), { signal });
        this.consoleResetDefaultBtn?.addEventListener('click', this.handleConsoleResetDefault.bind(this), { signal });
        // 可选：保留天数
        this.retentionDays?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
        // 抑制控制台输出开关
        this.suppressConsoleOutput?.addEventListener('change', this.handleSettingChange.bind(this), { signal });
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
        const settings = STATE.settings;
        const logging = settings?.logging || {};

        // 日志配置设置
        this.maxLogEntries.value = String((logging as any).maxLogEntries || (logging as any).maxEntries || 10000);
        this.maxMagnetPushEntries.value = String((logging as any).maxMagnetPushEntries || 10000);
        this.verboseMode.checked = logging.verboseMode || false;
        this.showPrivacyLogs.checked = logging.showPrivacyLogs || false;
        this.showStorageLogs.checked = logging.showStorageLogs || false;
        if (this.retentionDays) this.retentionDays.value = String((logging as any).retentionDays ?? 0);

        // 控制台代理设置
        if (this.consoleLevel) this.consoleLevel.value = (logging as any).consoleLevel || 'INFO';
        const fmt = (logging as any).consoleFormat || {};
        if (this.consoleShowTimestamp) this.consoleShowTimestamp.checked = fmt.showTimestamp ?? true;
        if (this.consoleShowSource) this.consoleShowSource.checked = fmt.showSource ?? true;
        if (this.consoleShowMilliseconds) this.consoleShowMilliseconds.checked = fmt.showMilliseconds ?? false;
        if (this.consoleColor) this.consoleColor.checked = fmt.color ?? true;
        if (this.consoleTimeZone) this.consoleTimeZone.value = fmt.timeZone || 'Asia/Shanghai';
        
        // 新模块化日志开关加载（兼容旧的consoleCategories配置）
        const modules = (logging as any).logModules || {};
        const cats = (logging as any).consoleCategories || {}; // 向后兼容
        if (this.logModuleCore) this.logModuleCore.checked = modules.core ?? cats.core ?? false;
        if (this.logModuleOrchestrator) this.logModuleOrchestrator.checked = modules.orchestrator ?? cats.orchestrator ?? false;
        if (this.logModuleStorage) this.logModuleStorage.checked = modules.storage ?? cats.storage ?? false;
        if (this.logModuleActor) this.logModuleActor.checked = modules.actor ?? cats.actor ?? false;
        if (this.logModuleMagnet) this.logModuleMagnet.checked = modules.magnet ?? cats.magnet ?? false;
        if (this.logModuleSync) this.logModuleSync.checked = modules.sync ?? false;
        if (this.logModuleNewWorks) this.logModuleNewWorks.checked = modules.newworks ?? false;
        if (this.logModuleDrive115) this.logModuleDrive115.checked = modules.drive115 ?? cats.drive115 ?? false;
        if (this.logModulePrivacy) this.logModulePrivacy.checked = modules.privacy ?? cats.privacy ?? false;
        if (this.logModuleAI) this.logModuleAI.checked = modules.ai ?? false;
        if (this.logModuleEnhancement) this.logModuleEnhancement.checked = modules.enhancement ?? cats.enhancement ?? false;
        if (this.logModuleUpdate) this.logModuleUpdate.checked = modules.update ?? false;
        if (this.logModuleHelp) this.logModuleHelp.checked = modules.help ?? false;
        if (this.logModuleSettings) this.logModuleSettings.checked = modules.settings ?? false;
        if (this.logModuleGeneral) this.logModuleGeneral.checked = modules.general ?? cats.general ?? false;
        if (this.logModuleDebug) this.logModuleDebug.checked = modules.debug ?? false;
        
        // 抑制控制台输出开关
        if (this.suppressConsoleOutput) this.suppressConsoleOutput.checked = (logging as any).suppressConsoleOutput ?? false;
    }

    /**
     * 保存设置
     */
    protected async doSaveSettings(): Promise<SettingsSaveResult> {
        try {
            // 构建日志模块配置（安全检查，避免null引用）
            const logModules: any = {};
            if (this.logModuleCore) logModules.core = this.logModuleCore.checked;
            if (this.logModuleOrchestrator) logModules.orchestrator = this.logModuleOrchestrator.checked;
            if (this.logModuleStorage) logModules.storage = this.logModuleStorage.checked;
            if (this.logModuleActor) logModules.actor = this.logModuleActor.checked;
            if (this.logModuleMagnet) logModules.magnet = this.logModuleMagnet.checked;
            if (this.logModuleSync) logModules.sync = this.logModuleSync.checked;
            if (this.logModuleNewWorks) logModules.newworks = this.logModuleNewWorks.checked;
            if (this.logModuleDrive115) logModules.drive115 = this.logModuleDrive115.checked;
            if (this.logModulePrivacy) logModules.privacy = this.logModulePrivacy.checked;
            if (this.logModuleAI) logModules.ai = this.logModuleAI.checked;
            if (this.logModuleEnhancement) logModules.enhancement = this.logModuleEnhancement.checked;
            if (this.logModuleUpdate) logModules.update = this.logModuleUpdate.checked;
            if (this.logModuleHelp) logModules.help = this.logModuleHelp.checked;
            if (this.logModuleSettings) logModules.settings = this.logModuleSettings.checked;
            if (this.logModuleGeneral) logModules.general = this.logModuleGeneral.checked;
            if (this.logModuleDebug) logModules.debug = this.logModuleDebug.checked;

            // 构建控制台分类配置（向后兼容）
            const consoleCategories: any = {};
            if (this.logModuleCore) consoleCategories.core = this.logModuleCore.checked;
            if (this.logModuleOrchestrator) consoleCategories.orchestrator = this.logModuleOrchestrator.checked;
            if (this.logModuleDrive115) consoleCategories.drive115 = this.logModuleDrive115.checked;
            if (this.logModulePrivacy) consoleCategories.privacy = this.logModulePrivacy.checked;
            if (this.logModuleMagnet) consoleCategories.magnet = this.logModuleMagnet.checked;
            if (this.logModuleActor) consoleCategories.actor = this.logModuleActor.checked;
            if (this.logModuleStorage) consoleCategories.storage = this.logModuleStorage.checked;
            if (this.logModuleEnhancement) consoleCategories.enhancement = this.logModuleEnhancement.checked;
            if (this.logModuleGeneral) consoleCategories.general = this.logModuleGeneral.checked;

            const newSettings: ExtensionSettings = {
                ...STATE.settings,
                logging: {
                    ...STATE.settings?.logging,
                    maxLogEntries: this.maxLogEntries ? parseInt(this.maxLogEntries.value, 10) : 10000,
                    maxMagnetPushEntries: this.maxMagnetPushEntries ? parseInt(this.maxMagnetPushEntries.value, 10) : 10000,
                    verboseMode: this.verboseMode ? this.verboseMode.checked : false,
                    showPrivacyLogs: this.showPrivacyLogs ? this.showPrivacyLogs.checked : false,
                    showStorageLogs: this.showStorageLogs ? this.showStorageLogs.checked : false,
                    retentionDays: this.retentionDays ? parseInt(this.retentionDays.value || '0', 10) : (STATE.settings?.logging as any)?.retentionDays,
                    consoleLevel: (this.consoleLevel?.value as any) || 'INFO',
                    consoleFormat: {
                        showTimestamp: this.consoleShowTimestamp ? this.consoleShowTimestamp.checked : true,
                        showSource: this.consoleShowSource ? this.consoleShowSource.checked : true,
                        showMilliseconds: this.consoleShowMilliseconds ? this.consoleShowMilliseconds.checked : false,
                        color: this.consoleColor ? this.consoleColor.checked : true,
                        timeZone: this.consoleTimeZone?.value || 'Asia/Shanghai',
                    },
                    logModules: Object.keys(logModules).length > 0 ? logModules : undefined,
                    consoleCategories: Object.keys(consoleCategories).length > 0 ? consoleCategories : undefined,
                    suppressConsoleOutput: this.suppressConsoleOutput ? this.suppressConsoleOutput.checked : false,
                }
            };

            await saveSettings(newSettings);
            STATE.settings = newSettings;

            // 通知日志控制器设置已更改
            onSettingsChanged();

            return {
                success: true,
                savedSettings: { logging: newSettings.logging }
            };
        } catch (error) {
            console.error('[LoggingSettings] 保存设置失败:', error);
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

        // 验证最大日志条目数
        const maxEntries = parseInt(this.maxLogEntries.value, 10);
        if (isNaN(maxEntries) || maxEntries < 100 || maxEntries > 50000) {
            errors.push('最大保存条数必须在100-50000之间');
        }

        const magnetPushEntries = parseInt(this.maxMagnetPushEntries.value, 10);
        if (isNaN(magnetPushEntries) || magnetPushEntries < 100 || magnetPushEntries > 50000) {
            errors.push('磁力推送最大条数必须在100-50000之间');
        }

        // 验证保留天数（可选，0 表示关闭按天清理）
        if (this.retentionDays && this.retentionDays.value !== '') {
            const days = parseInt(this.retentionDays.value, 10);
            if (isNaN(days) || days < 0 || days > 3650) {
                errors.push('日志保留天数必须在0-3650之间');
            }
        }

        return {
            isValid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * 获取当前设置
     */
    protected doGetSettings(): Partial<ExtensionSettings> {
        // 构建日志模块配置（安全检查）
        const logModules: any = {};
        if (this.logModuleCore) logModules.core = this.logModuleCore.checked;
        if (this.logModuleOrchestrator) logModules.orchestrator = this.logModuleOrchestrator.checked;
        if (this.logModuleStorage) logModules.storage = this.logModuleStorage.checked;
        if (this.logModuleActor) logModules.actor = this.logModuleActor.checked;
        if (this.logModuleMagnet) logModules.magnet = this.logModuleMagnet.checked;
        if (this.logModuleSync) logModules.sync = this.logModuleSync.checked;
        if (this.logModuleNewWorks) logModules.newworks = this.logModuleNewWorks.checked;
        if (this.logModuleDrive115) logModules.drive115 = this.logModuleDrive115.checked;
        if (this.logModulePrivacy) logModules.privacy = this.logModulePrivacy.checked;
        if (this.logModuleAI) logModules.ai = this.logModuleAI.checked;
        if (this.logModuleEnhancement) logModules.enhancement = this.logModuleEnhancement.checked;
        if (this.logModuleUpdate) logModules.update = this.logModuleUpdate.checked;
        if (this.logModuleHelp) logModules.help = this.logModuleHelp.checked;
        if (this.logModuleSettings) logModules.settings = this.logModuleSettings.checked;
        if (this.logModuleGeneral) logModules.general = this.logModuleGeneral.checked;
        if (this.logModuleDebug) logModules.debug = this.logModuleDebug.checked;

        const consoleCategories: any = {};
        if (this.logModuleCore) consoleCategories.core = this.logModuleCore.checked;
        if (this.logModuleOrchestrator) consoleCategories.orchestrator = this.logModuleOrchestrator.checked;
        if (this.logModuleDrive115) consoleCategories.drive115 = this.logModuleDrive115.checked;
        if (this.logModulePrivacy) consoleCategories.privacy = this.logModulePrivacy.checked;
        if (this.logModuleMagnet) consoleCategories.magnet = this.logModuleMagnet.checked;
        if (this.logModuleActor) consoleCategories.actor = this.logModuleActor.checked;
        if (this.logModuleStorage) consoleCategories.storage = this.logModuleStorage.checked;
        if (this.logModuleEnhancement) consoleCategories.enhancement = this.logModuleEnhancement.checked;
        if (this.logModuleGeneral) consoleCategories.general = this.logModuleGeneral.checked;

        return {
            logging: {
                maxLogEntries: this.maxLogEntries ? parseInt(this.maxLogEntries.value, 10) : 10000,
                maxMagnetPushEntries: this.maxMagnetPushEntries ? parseInt(this.maxMagnetPushEntries.value, 10) : 10000,
                verboseMode: this.verboseMode ? this.verboseMode.checked : false,
                showPrivacyLogs: this.showPrivacyLogs ? this.showPrivacyLogs.checked : false,
                showStorageLogs: this.showStorageLogs ? this.showStorageLogs.checked : false,
                ...(this.retentionDays ? { retentionDays: parseInt(this.retentionDays.value || '0', 10) } : {}),
                consoleLevel: (this.consoleLevel?.value as any) || 'INFO',
                consoleFormat: {
                    showTimestamp: this.consoleShowTimestamp ? this.consoleShowTimestamp.checked : true,
                    showSource: this.consoleShowSource ? this.consoleShowSource.checked : true,
                    showMilliseconds: this.consoleShowMilliseconds ? this.consoleShowMilliseconds.checked : false,
                    color: this.consoleColor ? this.consoleColor.checked : true,
                    timeZone: this.consoleTimeZone?.value || 'Asia/Shanghai',
                },
                ...(Object.keys(logModules).length > 0 ? { logModules } : {}),
                ...(Object.keys(consoleCategories).length > 0 ? { consoleCategories } : {}),
                suppressConsoleOutput: this.suppressConsoleOutput ? this.suppressConsoleOutput.checked : false,
            }
        };
    }

    /**
     * 设置数据到UI
     */
    protected doSetSettings(settings: Partial<ExtensionSettings>): void {
        const logging = settings.logging;
        if (logging) {
            if ((logging as any).maxLogEntries !== undefined || (logging as any).maxEntries !== undefined) {
                this.maxLogEntries.value = String((logging as any).maxLogEntries ?? (logging as any).maxEntries);
            }
            if ((logging as any).maxMagnetPushEntries !== undefined) {
                this.maxMagnetPushEntries.value = String((logging as any).maxMagnetPushEntries ?? 10000);
            }
            if (logging.verboseMode !== undefined) {
                this.verboseMode.checked = logging.verboseMode;
            }
            if (logging.showPrivacyLogs !== undefined) {
                this.showPrivacyLogs.checked = logging.showPrivacyLogs;
            }
            if (logging.showStorageLogs !== undefined) {
                this.showStorageLogs.checked = logging.showStorageLogs;
            }
            if (this.retentionDays && (logging as any).retentionDays !== undefined) {
                this.retentionDays.value = String((logging as any).retentionDays ?? 0);
            }

            if ((logging as any).consoleLevel !== undefined && this.consoleLevel) this.consoleLevel.value = (logging as any).consoleLevel as any;
            const fmt = (logging as any).consoleFormat || {};
            if (this.consoleShowTimestamp && fmt.showTimestamp !== undefined) this.consoleShowTimestamp.checked = !!fmt.showTimestamp;
            if (this.consoleShowSource && fmt.showSource !== undefined) this.consoleShowSource.checked = !!fmt.showSource;
            if (this.consoleShowMilliseconds && fmt.showMilliseconds !== undefined) this.consoleShowMilliseconds.checked = !!fmt.showMilliseconds;
            if (this.consoleColor && fmt.color !== undefined) this.consoleColor.checked = !!fmt.color;
            if (this.consoleTimeZone && fmt.timeZone !== undefined) this.consoleTimeZone.value = fmt.timeZone;
            
            const modules = (logging as any).logModules || {};
            const cats = (logging as any).consoleCategories || {};
            if (this.logModuleCore && (modules.core !== undefined || cats.core !== undefined)) this.logModuleCore.checked = !!(modules.core ?? cats.core);
            if (this.logModuleOrchestrator && (modules.orchestrator !== undefined || cats.orchestrator !== undefined)) this.logModuleOrchestrator.checked = !!(modules.orchestrator ?? cats.orchestrator);
            if (this.logModuleStorage && (modules.storage !== undefined || cats.storage !== undefined)) this.logModuleStorage.checked = !!(modules.storage ?? cats.storage);
            if (this.logModuleActor && (modules.actor !== undefined || cats.actor !== undefined)) this.logModuleActor.checked = !!(modules.actor ?? cats.actor);
            if (this.logModuleMagnet && (modules.magnet !== undefined || cats.magnet !== undefined)) this.logModuleMagnet.checked = !!(modules.magnet ?? cats.magnet);
            if (this.logModuleSync && modules.sync !== undefined) this.logModuleSync.checked = !!modules.sync;
            if (this.logModuleNewWorks && modules.newworks !== undefined) this.logModuleNewWorks.checked = !!modules.newworks;
            if (this.logModuleDrive115 && (modules.drive115 !== undefined || cats.drive115 !== undefined)) this.logModuleDrive115.checked = !!(modules.drive115 ?? cats.drive115);
            if (this.logModulePrivacy && (modules.privacy !== undefined || cats.privacy !== undefined)) this.logModulePrivacy.checked = !!(modules.privacy ?? cats.privacy);
            if (this.logModuleAI && modules.ai !== undefined) this.logModuleAI.checked = !!modules.ai;
            if (this.logModuleEnhancement && (modules.enhancement !== undefined || cats.enhancement !== undefined)) this.logModuleEnhancement.checked = !!(modules.enhancement ?? cats.enhancement);
            if (this.logModuleUpdate && modules.update !== undefined) this.logModuleUpdate.checked = !!modules.update;
            if (this.logModuleHelp && modules.help !== undefined) this.logModuleHelp.checked = !!modules.help;
            if (this.logModuleSettings && modules.settings !== undefined) this.logModuleSettings.checked = !!modules.settings;
            if (this.logModuleGeneral && (modules.general !== undefined || cats.general !== undefined)) this.logModuleGeneral.checked = !!(modules.general ?? cats.general);
            if (this.logModuleDebug && modules.debug !== undefined) this.logModuleDebug.checked = !!modules.debug;
            
            // 抑制控制台输出开关
            if (this.suppressConsoleOutput && (logging as any).suppressConsoleOutput !== undefined) {
                this.suppressConsoleOutput.checked = !!(logging as any).suppressConsoleOutput;
            }
        }
    }

    /**
     * 处理详细模式开关
     */
    private handleVerboseModeToggle(): void {
        if (this.verboseMode.checked) {
            showMessage('详细日志模式已启用，将记录更多调试信息', 'info');
        } else {
            showMessage('详细日志模式已禁用', 'info');
        }
        this.emit('change');
        this.scheduleAutoSave();
    }

    /**
     * 处理设置变化
     */
    private handleSettingChange(): void {
        this.emit('change');
        this.scheduleAutoSave();
    }

    /**
     * 一键静默：将控制台级别设为 OFF，关闭所有模块
     */
    private handleConsoleMuteAll(): void {
        if (this.consoleLevel) this.consoleLevel.value = 'OFF' as any;
        if (this.logModuleCore) this.logModuleCore.checked = false;
        if (this.logModuleOrchestrator) this.logModuleOrchestrator.checked = false;
        if (this.logModuleStorage) this.logModuleStorage.checked = false;
        if (this.logModuleActor) this.logModuleActor.checked = false;
        if (this.logModuleMagnet) this.logModuleMagnet.checked = false;
        if (this.logModuleSync) this.logModuleSync.checked = false;
        if (this.logModuleNewWorks) this.logModuleNewWorks.checked = false;
        if (this.logModuleDrive115) this.logModuleDrive115.checked = false;
        if (this.logModulePrivacy) this.logModulePrivacy.checked = false;
        if (this.logModuleAI) this.logModuleAI.checked = false;
        if (this.logModuleEnhancement) this.logModuleEnhancement.checked = false;
        if (this.logModuleUpdate) this.logModuleUpdate.checked = false;
        if (this.logModuleHelp) this.logModuleHelp.checked = false;
        if (this.logModuleSettings) this.logModuleSettings.checked = false;
        if (this.logModuleGeneral) this.logModuleGeneral.checked = false;
        if (this.logModuleDebug) this.logModuleDebug.checked = false;
        showMessage('所有日志已静默', 'info');
        this.handleSettingChange();
    }

    /**
     * 一键全开：将控制台级别设为 DEBUG，打开所有模块和格式选项
     */
    private handleConsoleEnableAll(): void {
        if (this.consoleLevel) this.consoleLevel.value = 'DEBUG' as any;
        if (this.logModuleCore) this.logModuleCore.checked = true;
        if (this.logModuleOrchestrator) this.logModuleOrchestrator.checked = true;
        if (this.logModuleStorage) this.logModuleStorage.checked = true;
        if (this.logModuleActor) this.logModuleActor.checked = true;
        if (this.logModuleMagnet) this.logModuleMagnet.checked = true;
        if (this.logModuleSync) this.logModuleSync.checked = true;
        if (this.logModuleNewWorks) this.logModuleNewWorks.checked = true;
        if (this.logModuleDrive115) this.logModuleDrive115.checked = true;
        if (this.logModulePrivacy) this.logModulePrivacy.checked = true;
        if (this.logModuleAI) this.logModuleAI.checked = true;
        if (this.logModuleEnhancement) this.logModuleEnhancement.checked = true;
        if (this.logModuleUpdate) this.logModuleUpdate.checked = true;
        if (this.logModuleHelp) this.logModuleHelp.checked = true;
        if (this.logModuleSettings) this.logModuleSettings.checked = true;
        if (this.logModuleGeneral) this.logModuleGeneral.checked = true;
        if (this.logModuleDebug) this.logModuleDebug.checked = true;
        if (this.consoleShowTimestamp) this.consoleShowTimestamp.checked = true;
        if (this.consoleShowSource) this.consoleShowSource.checked = true;
        if (this.consoleColor) this.consoleColor.checked = true;
        showMessage('所有日志已启用（DEBUG级别）', 'success');
        this.handleSettingChange();
    }

    /**
     * 恢复默认：恢复推荐的日志配置
     */
    private handleConsoleResetDefault(): void {
        if (this.consoleLevel) this.consoleLevel.value = 'INFO' as any;
        if (this.maxLogEntries) this.maxLogEntries.value = '10000';
        if (this.maxMagnetPushEntries) this.maxMagnetPushEntries.value = '10000';
        if (this.logModuleCore) this.logModuleCore.checked = true;
        if (this.logModuleOrchestrator) this.logModuleOrchestrator.checked = true;
        if (this.logModuleStorage) this.logModuleStorage.checked = true;
        if (this.logModuleActor) this.logModuleActor.checked = true;
        if (this.logModuleMagnet) this.logModuleMagnet.checked = true;
        if (this.logModuleSync) this.logModuleSync.checked = true;
        if (this.logModuleNewWorks) this.logModuleNewWorks.checked = true;
        if (this.logModuleDrive115) this.logModuleDrive115.checked = true;
        if (this.logModulePrivacy) this.logModulePrivacy.checked = true;
        if (this.logModuleAI) this.logModuleAI.checked = true;
        if (this.logModuleEnhancement) this.logModuleEnhancement.checked = true;
        if (this.logModuleUpdate) this.logModuleUpdate.checked = true;
        if (this.logModuleHelp) this.logModuleHelp.checked = true;
        if (this.logModuleSettings) this.logModuleSettings.checked = true;
        if (this.logModuleGeneral) this.logModuleGeneral.checked = true;
        if (this.logModuleDebug) this.logModuleDebug.checked = false;
        if (this.consoleShowTimestamp) this.consoleShowTimestamp.checked = true;
        if (this.consoleShowSource) this.consoleShowSource.checked = true;
        if (this.consoleShowMilliseconds) this.consoleShowMilliseconds.checked = false;
        if (this.consoleColor) this.consoleColor.checked = true;
        showMessage('已恢复默认日志配置（INFO级别）', 'success');
        this.handleSettingChange();
    }

}
