/**
 * 网络配置设置面板
 * 配置网络加速和测试网络连通性，帮助诊断连接问题
 */

import { getRepoRawUrl } from '../../../../shared/repoIdentity';
import { mergeJavdbRoutesForPull, stampJavdbRouteEdit } from '../../../../shared/javdbRouteSync';
import { BaseSettingsPanel } from '../base/BaseSettingsPanel';
import { showMessage } from '../../../ui/toast';
import type { ExtensionSettings } from '../../../../types';
import type { SettingsValidationResult, SettingsSaveResult } from '../types';
import {
    getAllEnabledDomains,
    getDomainsByCategory,
    EXTENSION_DOMAINS,
    saveDomainConfig,
    loadDomainConfig,
    type DomainInfo
} from '../../../../features/networkTest';

/**
 * 网络配置设置面板类
 * 基于原始network.ts的简化实现，新增网络加速配置
 */
export class NetworkTestSettings extends BaseSettingsPanel {
    // 网络加速相关元素
    private enableGithubProxyCheckbox!: HTMLInputElement;
    private githubProxyServiceSelect!: HTMLSelectElement;
    private customProxyUrlInput!: HTMLInputElement;
    private customProxyUrlGroup!: HTMLDivElement;
    private testGithubProxyBtn!: HTMLButtonElement;
    private proxyTestResultsDiv!: HTMLDivElement;

    // 线路管理相关元素
    private javdbRoutesListDiv!: HTMLDivElement;
    private javdbNewRouteUrlInput!: HTMLInputElement;
    private javdbNewRouteDescInput!: HTMLInputElement;
    private addJavdbRouteBtn!: HTMLButtonElement;
    private testAllRoutesBtn!: HTMLButtonElement;
    private updateRoutesFromGithubBtn!: HTMLButtonElement;
    private resetDefaultRoutesBtn!: HTMLButtonElement;

    // 手动测试相关元素
    private manualTestBtn!: HTMLButtonElement;
    private manualUrlInput!: HTMLInputElement;
    private manualResultsDiv!: HTMLDivElement;
    private resultsContainerWrapper!: HTMLDivElement;

    // 批量测试元素
    private testAllDomainsBtn!: HTMLButtonElement;
    private testCoreDomainsBtn!: HTMLButtonElement;
    private toggleDomainConfigBtn!: HTMLButtonElement;
    private clearBatchResultsBtn!: HTMLButtonElement;
    private selectAllDomainsBtn!: HTMLButtonElement;
    private deselectAllDomainsBtn!: HTMLButtonElement;
    private resetDefaultDomainsBtn!: HTMLButtonElement;

    // 上次测试时间的存储键
    private readonly LAST_TEST_TIME_KEY = 'network_test_last_time';

    constructor() {
        super({
            panelId: 'network-test-settings',
            panelName: '网络配置设置',
            autoSave: true, // 改为自动保存
            requireValidation: false
        });
    }

    /**
     * 初始化DOM元素
     */
    protected initializeElements(): void {
            console.log('[NetworkTestSettings] [DEBUG] 初始化元素引用');

            // 检查面板 DOM 是否存在
            const panelElement = document.getElementById(this.config.panelId);
            if (!panelElement) {
                console.error('[NetworkTestSettings] [DEBUG] 面板 DOM 不存在，无法初始化元素');
                return;
            }

            // 网络加速相关元素
            this.enableGithubProxyCheckbox = document.getElementById('enable-github-proxy') as HTMLInputElement;
            this.githubProxyServiceSelect = document.getElementById('github-proxy-service') as HTMLSelectElement;
            this.customProxyUrlInput = document.getElementById('custom-proxy-url') as HTMLInputElement;
            this.customProxyUrlGroup = document.getElementById('custom-proxy-url-group') as HTMLDivElement;
            this.testGithubProxyBtn = document.getElementById('test-github-proxy') as HTMLButtonElement;
            this.proxyTestResultsDiv = document.getElementById('proxy-test-results') as HTMLDivElement;

            // 线路管理相关元素
            this.javdbRoutesListDiv = document.getElementById('javdb-routes-list') as HTMLDivElement;
            this.javdbNewRouteUrlInput = document.getElementById('javdb-new-route-url') as HTMLInputElement;
            this.javdbNewRouteDescInput = document.getElementById('javdb-new-route-desc') as HTMLInputElement;
            this.addJavdbRouteBtn = document.getElementById('add-javdb-route') as HTMLButtonElement;
            this.testAllRoutesBtn = document.getElementById('test-all-routes') as HTMLButtonElement;
            this.updateRoutesFromGithubBtn = document.getElementById('update-routes-from-github') as HTMLButtonElement;
            this.resetDefaultRoutesBtn = document.getElementById('reset-default-routes') as HTMLButtonElement;

            // 使用HTML中实际存在的元素ID（基于原始network.ts实现）
            this.manualTestBtn = document.getElementById('start-ping-test') as HTMLButtonElement;
            this.manualUrlInput = document.getElementById('ping-url') as HTMLInputElement;
            this.manualResultsDiv = document.getElementById('ping-results') as HTMLDivElement;
            this.resultsContainerWrapper = document.getElementById('ping-results-container') as HTMLDivElement;

            // 批量测试按钮
            this.testAllDomainsBtn = document.getElementById('test-all-domains') as HTMLButtonElement;
            this.testCoreDomainsBtn = document.getElementById('test-core-domains') as HTMLButtonElement;
            this.toggleDomainConfigBtn = document.getElementById('toggle-domain-config') as HTMLButtonElement;
            this.clearBatchResultsBtn = document.getElementById('clear-batch-results') as HTMLButtonElement;
            this.selectAllDomainsBtn = document.getElementById('select-all-domains') as HTMLButtonElement;
            this.deselectAllDomainsBtn = document.getElementById('deselect-all-domains') as HTMLButtonElement;
            this.resetDefaultDomainsBtn = document.getElementById('reset-default-domains') as HTMLButtonElement;

            // 检查必需元素是否存在（不抛出错误，只记录警告）
            if (!this.manualTestBtn || !this.manualUrlInput || !this.manualResultsDiv || !this.resultsContainerWrapper ||
                !this.testAllDomainsBtn || !this.testCoreDomainsBtn || !this.toggleDomainConfigBtn || !this.clearBatchResultsBtn ||
                !this.selectAllDomainsBtn || !this.deselectAllDomainsBtn || !this.resetDefaultDomainsBtn) {
                console.warn('[NetworkTestSettings] [DEBUG] 部分DOM元素未找到，可能是因为页面还未完全加载');
                return;
            }

            console.log('[NetworkTestSettings] [DEBUG] 元素引用初始化完成');
        }


    /**
     * 绑定事件监听器
     */
    protected bindEvents(): void {
        console.log('[NetworkTestSettings] [DEBUG] 绑定事件监听器');
        const signal = this.createEventBindingSignal();

        // 网络加速事件绑定
        this.enableGithubProxyCheckbox?.addEventListener('change', () => {
            console.log('[NetworkTestSettings] [DEBUG] GitHub 代理开关变化，触发自动保存');
            this.handleGithubProxyToggle();
        }, { signal });
        this.githubProxyServiceSelect?.addEventListener('change', () => {
            console.log('[NetworkTestSettings] [DEBUG] 代理服务变化，触发自动保存');
            this.handleProxyServiceChange();
        }, { signal });
        this.testGithubProxyBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击测试 GitHub 代理按钮');
            this.handleTestGithubProxy();
        }, { signal });

        // 线路管理事件绑定
        this.addJavdbRouteBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击添加线路按钮');
            this.handleAddRoute('javdb');
        }, { signal });
        this.testAllRoutesBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击测试所有线路按钮');
            this.handleTestAllRoutes();
        }, { signal });
        this.updateRoutesFromGithubBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击从 GitHub 更新线路按钮');
            this.handleUpdateRoutesFromGithub();
        }, { signal });
        this.resetDefaultRoutesBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击恢复默认线路按钮');
            this.handleResetDefaultRoutes();
        }, { signal });

        // 基于原始network.ts的ping测试实现
        this.manualTestBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击手动测试按钮');
            this.handlePingTest();
        }, { signal });

        // 批量测试事件绑定
        this.testAllDomainsBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击测试所有域名按钮');
            this.handleTestAllDomains();
        }, { signal });
        this.testCoreDomainsBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击测试核心域名按钮');
            this.handleTestCoreDomains();
        }, { signal });
        this.toggleDomainConfigBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击切换域名配置按钮');
            this.handleToggleDomainConfig();
        }, { signal });
        this.clearBatchResultsBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击清除批量测试结果按钮');
            this.handleClearBatchResults();
        }, { signal });
        this.selectAllDomainsBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击全选域名按钮');
            this.handleSelectAllDomains();
        }, { signal });
        this.deselectAllDomainsBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击取消全选域名按钮');
            this.handleDeselectAllDomains();
        }, { signal });
        this.resetDefaultDomainsBtn?.addEventListener('click', () => {
            console.log('[NetworkTestSettings] [DEBUG] 点击恢复默认域名按钮');
            this.handleResetDefaultDomains();
        }, { signal });

        console.log('[NetworkTestSettings] [DEBUG] 事件监听器绑定完成');
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
        console.log('[NetworkTestSettings] [DEBUG] 开始加载设置到UI');

        // 加载域名配置
        loadDomainConfig();

        // 加载网络加速配置
        const settings = await this.getStoredSettings();
        console.log('[NetworkTestSettings] [DEBUG] 获取到的存储设置:', settings);

        const networkAcceleration = settings.networkAcceleration || {
            github: {
                enabled: true,
                proxyService: 'ghproxy',
                customProxyUrl: ''
            }
        };

        if (this.enableGithubProxyCheckbox) {
            this.enableGithubProxyCheckbox.checked = networkAcceleration.github.enabled;
            console.log('[NetworkTestSettings] [DEBUG] GitHub 代理开关:', networkAcceleration.github.enabled);
        }
        if (this.githubProxyServiceSelect) {
            this.githubProxyServiceSelect.value = networkAcceleration.github.proxyService;
            console.log('[NetworkTestSettings] [DEBUG] 代理服务:', networkAcceleration.github.proxyService);
        }
        if (this.customProxyUrlInput) {
            this.customProxyUrlInput.value = networkAcceleration.github.customProxyUrl || '';
        }

        // 更新自定义代理输入框显示状态
        this.updateCustomProxyVisibility();

        // 加载线路配置
        await this.loadRoutesConfig();

        // 网络测试面板初始化UI状态
        if (this.manualResultsDiv) {
            this.manualResultsDiv.innerHTML = '<p class="test-placeholder">点击上方按钮开始网络测试</p>';
        }
        if (this.resultsContainerWrapper) {
            this.resultsContainerWrapper.style.display = 'none';
        }

        // 更新域名统计信息
        this.updateDomainStats();

        // 加载上次测试时间
        this.loadLastTestTime();

        console.log('[NetworkTestSettings] [DEBUG] 设置加载完成');
    }

    /**
     * 保存设置
     */
    protected async doSaveSettings(): Promise<SettingsSaveResult> {
        console.log('[NetworkTestSettings] [DEBUG] 开始保存设置');

        try {
            const settings = await this.getStoredSettings();

            // 保存网络加速配置
            const networkAcceleration = {
                github: {
                    enabled: this.enableGithubProxyCheckbox?.checked || false,
                    proxyService: (this.githubProxyServiceSelect?.value as any) || 'ghproxy',
                    customProxyUrl: this.customProxyUrlInput?.value || ''
                }
            };

            console.log('[NetworkTestSettings] [DEBUG] 保存的网络加速配置:', networkAcceleration);

            settings.networkAcceleration = networkAcceleration;

            await this.saveStoredSettings(settings);
            console.log('[NetworkTestSettings] [DEBUG] 设置保存成功');
            return { success: true };
        } catch (error) {
            console.error('[NetworkTestSettings] [DEBUG] 保存网络配置失败:', error);
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
        // 网络测试面板不需要验证设置
        return { isValid: true };
    }

    /**
     * 获取当前设置
     */
    protected doGetSettings(): Partial<ExtensionSettings> {
        return {
            networkAcceleration: {
                github: {
                    enabled: this.enableGithubProxyCheckbox?.checked || false,
                    proxyService: (this.githubProxyServiceSelect?.value as any) || 'ghproxy',
                    customProxyUrl: this.customProxyUrlInput?.value || ''
                }
            },
            routes: this.getCurrentRoutesConfig()
        };
    }

    /**
     * 设置数据到UI
     */
    protected doSetSettings(settings: Partial<ExtensionSettings>): void {
        const networkAcceleration = settings.networkAcceleration;
        if (networkAcceleration) {
            if (this.enableGithubProxyCheckbox) {
                this.enableGithubProxyCheckbox.checked = networkAcceleration.github.enabled;
            }
            if (this.githubProxyServiceSelect) {
                this.githubProxyServiceSelect.value = networkAcceleration.github.proxyService;
            }
            if (this.customProxyUrlInput) {
                this.customProxyUrlInput.value = networkAcceleration.github.customProxyUrl || '';
            }
            this.updateCustomProxyVisibility();
        }

        // 加载线路配置
        if (settings.routes) {
            this.loadRoutesConfig();
        }
    }

    /**
     * 获取存储的设置
     */
    private async getStoredSettings(): Promise<ExtensionSettings> {
        return new Promise((resolve) => {
            chrome.storage.local.get('settings', (result) => {
                if (chrome.runtime.lastError || !result) {
                    resolve({} as ExtensionSettings);
                    return;
                }
                resolve((result.settings || {}) as ExtensionSettings);
            });
        });
    }

    /**
     * 保存设置到存储
     */
    private async saveStoredSettings(settings: ExtensionSettings): Promise<void> {
        const previous = await this.getStoredSettings();
        if (settings.routes?.javdb) {
            const merged = mergeJavdbRoutesForPull(previous, settings) as ExtensionSettings;
            settings.routes.javdb = merged.routes.javdb === previous.routes?.javdb
                ? previous.routes.javdb
                : stampJavdbRouteEdit(
                    previous.routes?.javdb || { primary: 'https://javdb.com', alternatives: [] },
                    settings.routes.javdb,
                );
        }
        return new Promise((resolve) => {
            chrome.storage.local.set({ settings }, () => {
                resolve();
            });
        });
    }

    /**
     * 处理 GitHub 代理开关切换
     */
    private handleGithubProxyToggle(): void {
        const enabled = this.enableGithubProxyCheckbox.checked;

        // 启用/禁用相关控件
        if (this.githubProxyServiceSelect) {
            this.githubProxyServiceSelect.disabled = !enabled;
        }
        if (this.customProxyUrlInput) {
            this.customProxyUrlInput.disabled = !enabled;
        }
        if (this.testGithubProxyBtn) {
            this.testGithubProxyBtn.disabled = !enabled;
        }
    }

    /**
     * 处理代理服务选择变化
     */
    private handleProxyServiceChange(): void {
        this.updateCustomProxyVisibility();
    }

    /**
     * 更新自定义代理输入框显示状态
     */
    private updateCustomProxyVisibility(): void {
        if (!this.customProxyUrlGroup || !this.githubProxyServiceSelect) return;

        const isCustom = this.githubProxyServiceSelect.value === 'custom';
        this.customProxyUrlGroup.style.display = isCustom ? 'block' : 'none';
    }

    /**
     * 处理测试 GitHub 代理
     */
    private async handleTestGithubProxy(): Promise<void> {
        if (!this.testGithubProxyBtn || !this.proxyTestResultsDiv) return;

        const buttonText = this.testGithubProxyBtn.querySelector('.button-text') as HTMLSpanElement;
        const spinner = this.testGithubProxyBtn.querySelector('.spinner') as HTMLDivElement;

        this.testGithubProxyBtn.disabled = true;
        if (buttonText) buttonText.textContent = '测试中...';
        if (spinner) spinner.classList.remove('hidden');

        this.proxyTestResultsDiv.style.display = 'block';
        this.proxyTestResultsDiv.innerHTML = '<p style="color: #666;">正在测试代理速度...</p>';

        try {
            const proxyService = this.githubProxyServiceSelect.value;
            const customUrl = this.customProxyUrlInput.value;

            // 测试文件 URL（使用本仓库的 routes.json）
            const testFileUrl = getRepoRawUrl('public/routes.json');

            // 获取代理 URL
            const proxyUrl = this.getProxyUrl(proxyService, customUrl);
            const proxiedUrl = proxyUrl + testFileUrl;

            // 测试直连速度
            const directStart = Date.now();
            let directSuccess = false;
            let directLatency = 0;
            try {
                await fetch(testFileUrl, { method: 'HEAD', cache: 'no-cache' });
                directLatency = Date.now() - directStart;
                directSuccess = true;
            } catch {
                directLatency = Date.now() - directStart;
            }

            // 测试代理速度
            const proxyStart = Date.now();
            let proxySuccess = false;
            let proxyLatency = 0;
            try {
                await fetch(proxiedUrl, { method: 'HEAD', cache: 'no-cache' });
                proxyLatency = Date.now() - proxyStart;
                proxySuccess = true;
            } catch {
                proxyLatency = Date.now() - proxyStart;
            }

            // 显示结果
            let resultHtml = '<div style="padding: 10px;">';
            resultHtml += '<h5 style="margin-bottom: 10px;">测试结果</h5>';

            resultHtml += '<div style="margin-bottom: 10px;">';
            resultHtml += `<div style="display: flex; align-items: center; margin-bottom: 5px;">`;
            resultHtml += `<i class="fas ${directSuccess ? 'fa-check-circle' : 'fa-times-circle'}" style="color: ${directSuccess ? '#4caf50' : '#f44336'}; margin-right: 8px;"></i>`;
            resultHtml += `<span><strong>直连:</strong> ${directSuccess ? `${directLatency}ms` : '失败'}</span>`;
            resultHtml += `</div>`;
            resultHtml += `<div style="display: flex; align-items: center;">`;
            resultHtml += `<i class="fas ${proxySuccess ? 'fa-check-circle' : 'fa-times-circle'}" style="color: ${proxySuccess ? '#4caf50' : '#f44336'}; margin-right: 8px;"></i>`;
            resultHtml += `<span><strong>代理:</strong> ${proxySuccess ? `${proxyLatency}ms` : '失败'}</span>`;
            resultHtml += `</div>`;
            resultHtml += '</div>';

            if (directSuccess && proxySuccess) {
                const improvement = ((directLatency - proxyLatency) / directLatency * 100).toFixed(1);
                if (proxyLatency < directLatency) {
                    resultHtml += `<p style="color: #4caf50; margin-top: 10px;"><i class="fas fa-rocket"></i> 代理加速 ${improvement}%</p>`;
                } else {
                    resultHtml += `<p style="color: #ff9800; margin-top: 10px;"><i class="fas fa-info-circle"></i> 代理较慢 ${Math.abs(parseFloat(improvement))}%</p>`;
                }
            } else if (proxySuccess && !directSuccess) {
                resultHtml += `<p style="color: #4caf50; margin-top: 10px;"><i class="fas fa-check"></i> 代理可用，直连失败</p>`;
            } else if (!proxySuccess) {
                resultHtml += `<p style="color: #f44336; margin-top: 10px;"><i class="fas fa-exclamation-triangle"></i> 代理不可用</p>`;
            }

            resultHtml += '</div>';
            this.proxyTestResultsDiv.innerHTML = resultHtml;

            showMessage(proxySuccess ? '代理测试完成' : '代理测试失败', proxySuccess ? 'success' : 'error');
        } catch (error) {
            console.error('[Settings] 测试代理失败:', error);
            this.proxyTestResultsDiv.innerHTML = `<p style="color: #f44336;">测试失败: ${error instanceof Error ? error.message : '未知错误'}</p>`;
            showMessage('代理测试失败', 'error');
        } finally {
            this.testGithubProxyBtn.disabled = false;
            if (buttonText) buttonText.textContent = '测试加速效果';
            if (spinner) spinner.classList.add('hidden');
        }
    }

    /**
     * 获取代理 URL
     */
    private getProxyUrl(service: string, customUrl: string): string {
        const proxyMap: Record<string, string> = {
            'ghproxy': 'https://ghproxy.com/',
            'mirror': 'https://mirror.ghproxy.com/',
            'api99988866': 'https://gh.api.99988866.xyz/',
            'jsdelivr': 'https://cdn.jsdelivr.net/gh/',
            'custom': customUrl
        };

        return proxyMap[service] || proxyMap['ghproxy'];
    }

    /**
     * 加载线路配置
     */
    private async loadRoutesConfig(): Promise<void> {
        const settings = await this.getStoredSettings();
        const routes = settings.routes || {
            javdb: {
                primary: 'https://javdb.com',
                alternatives: []
            }
        };

        // 合并主线路和备用线路
        const allRoutes = [
            {
                url: routes.javdb.primary,
                enabled: true,
                description: '主线路',
                isPrimary: true,
                addedAt: 0
            },
            ...routes.javdb.alternatives.map((r: any) => ({ ...r, isPrimary: false }))
        ];

        // 渲染所有线路
        this.renderRoutesList('javdb', allRoutes, routes.javdb);
    }

    /**
     * 渲染线路列表
     */
    private renderRoutesList(service: 'javdb', routes: any[], routeConfig: any): void {
        const listDiv = this.javdbRoutesListDiv;
        if (!listDiv) return;

        if (routes.length === 0) {
            listDiv.innerHTML = '<p class="routes-empty-hint">暂无线路</p>';
            return;
        }

        // 获取当前首选线路
        const preferredUrl = routeConfig.preferredUrl || routeConfig.primary;

        // 将首选线路排序到最前面
        const sortedRoutes = [...routes].sort((a, b) => {
            const aIsPreferred = a.url === preferredUrl;
            const bIsPreferred = b.url === preferredUrl;
            if (aIsPreferred && !bIsPreferred) return -1;
            if (!aIsPreferred && bIsPreferred) return 1;
            return 0;
        });

        listDiv.innerHTML = '';
        sortedRoutes.forEach((route) => {
            const routeItem = document.createElement('div');
            const isPreferred = route.url === preferredUrl;
            routeItem.className = `route-item ${isPreferred ? 'route-item-preferred' : ''}`;

            // 获取缓存的延迟信息
            const latencyInfo = this.getRouteLatency(route.url);
            const latencyHtml = latencyInfo ? this.renderLatencyBadge(latencyInfo) : '';

            routeItem.innerHTML = `
                <div class="route-info">
                    <div class="route-url">
                        ${route.url}
                        ${isPreferred ? '<span class="route-preferred-badge"><i class="fas fa-star"></i> 首选</span>' : ''}
                        ${!route.enabled && !route.isPrimary ? '<span class="route-disabled-badge"><i class="fas fa-ban"></i> 已禁用</span>' : ''}
                        ${latencyHtml}
                    </div>
                    ${route.description ? `<div class="route-description">${route.description}</div>` : ''}
                </div>
                <div class="route-actions">
                    ${!isPreferred ? `<button class="btn btn-sm btn-secondary" data-action="set-preferred" data-url="${route.url}">
                        <i class="fas fa-star"></i> 设为首选
                    </button>` : ''}
                    <button class="btn btn-sm btn-secondary" data-action="test" data-url="${route.url}">
                        <i class="fas fa-vial"></i> 测试
                    </button>
                    ${!route.isPrimary ? `<button class="btn btn-sm ${route.enabled ? 'btn-warning' : 'btn-success'}" data-action="toggle" data-url="${route.url}" data-enabled="${route.enabled}">
                        <i class="fas ${route.enabled ? 'fa-ban' : 'fa-check'}"></i> ${route.enabled ? '禁用' : '启用'}
                    </button>` : ''}
                    ${!route.isPrimary ? `<button class="btn btn-sm btn-danger" data-action="delete" data-url="${route.url}">
                        <i class="fas fa-trash"></i>
                    </button>` : ''}
                </div>
            `;

            // 禁用的线路整体变灰
            if (!route.enabled && !route.isPrimary) {
                routeItem.style.opacity = '0.5';
            }

            // 绑定禁用/启用按钮事件
            const toggleBtn = routeItem.querySelector('[data-action="toggle"]') as HTMLButtonElement;
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    const currentEnabled = toggleBtn.dataset.enabled === 'true';
                    this.handleToggleRoute(service, route.url, route.isPrimary, !currentEnabled);
                });
            }

            // 绑定设为首选按钮事件
            const preferredBtn = routeItem.querySelector('[data-action="set-preferred"]') as HTMLButtonElement;
            if (preferredBtn) {
                preferredBtn.addEventListener('click', () => {
                    this.handleSetPreferredRoute(service, route.url);
                });
            }

            // 绑定测试按钮事件
            const testBtn = routeItem.querySelector('[data-action="test"]') as HTMLButtonElement;
            testBtn.addEventListener('click', async () => {
                await this.handleTestSingleRoute(service, route.url, routeItem);
            });

            // 绑定删除按钮事件
            const deleteBtn = routeItem.querySelector('[data-action="delete"]') as HTMLButtonElement;
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    this.handleDeleteRoute(service, route.url);
                });
            }

            listDiv.appendChild(routeItem);
        });
    }

    /**
     * 渲染延迟徽章
     */
    private renderLatencyBadge(latency: number): string {
        let className = 'latency-excellent';
        let icon = 'fa-bolt';

        if (latency < 0) {
            className = 'latency-error';
            icon = 'fa-times-circle';
            return `<span class="route-latency-badge ${className}"><i class="fas ${icon}"></i> 失败</span>`;
        } else if (latency < 200) {
            className = 'latency-excellent';
            icon = 'fa-bolt';
        } else if (latency < 500) {
            className = 'latency-good';
            icon = 'fa-check-circle';
        } else if (latency < 1000) {
            className = 'latency-medium';
            icon = 'fa-exclamation-circle';
        } else {
            className = 'latency-poor';
            icon = 'fa-exclamation-triangle';
        }

        return `<span class="route-latency-badge ${className}"><i class="fas ${icon}"></i> ${latency}ms</span>`;
    }

    /**
     * 获取线路延迟（从缓存）
     */
    private getRouteLatency(url: string): number | null {
        const cacheKey = `route_latency_${url}`;
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const data = JSON.parse(cached);
            // 缓存5分钟
            if (Date.now() - data.timestamp < 5 * 60 * 1000) {
                return data.latency;
            }
        }
        return null;
    }

    /**
     * 保存线路延迟到缓存
     */
    private saveRouteLatency(url: string, latency: number): void {
        const cacheKey = `route_latency_${url}`;
        sessionStorage.setItem(cacheKey, JSON.stringify({
            latency,
            timestamp: Date.now()
        }));
    }

    /**
     * 获取当前线路配置
     */
    private getCurrentRoutesConfig(): any {
        // 从 UI 状态构建配置对象
        const javdbRoutes: any[] = [];

        // 获取 JavDB 线路
        if (this.javdbRoutesListDiv) {
            const items = this.javdbRoutesListDiv.querySelectorAll('.route-item');
            items.forEach((item) => {
                const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
                const urlDiv = item.querySelector('.route-url') as HTMLDivElement;
                const descDiv = item.querySelector('.route-description') as HTMLDivElement;
                const isPrimary = checkbox.dataset.isPrimary === 'true';

                // 提取 URL（移除首选徽章和延迟徽章）
                let urlText = urlDiv.textContent?.trim() || '';
                const badgeIndex = urlText.indexOf('首选');
                if (badgeIndex > 0) {
                    urlText = urlText.substring(0, badgeIndex).trim();
                }
                // 移除延迟信息
                const latencyMatch = urlText.match(/^(https?:\/\/[^\s]+)/);
                if (latencyMatch) {
                    urlText = latencyMatch[1];
                }

                if (!isPrimary) {
                    javdbRoutes.push({
                        url: urlText,
                        enabled: checkbox.checked,
                        description: descDiv ? descDiv.textContent?.trim() : '',
                        addedAt: Date.now()
                    });
                }
            });
        }

        return {
            javdb: {
                primary: 'https://javdb.com',
                alternatives: javdbRoutes
            }
        };
    }

    /**
     * 处理添加线路
     */
    private async handleAddRoute(service: 'javdb'): Promise<void> {
        const urlInput = this.javdbNewRouteUrlInput;
        const descInput = this.javdbNewRouteDescInput;

        const url = urlInput?.value.trim();
        if (!url) {
            showMessage('请输入线路 URL', 'warn');
            return;
        }

        // 验证 URL 格式
        try {
            new URL(url);
        } catch {
            showMessage('URL 格式不正确', 'error');
            return;
        }

        const settings = await this.getStoredSettings();
        if (!settings.routes) {
            settings.routes = {
                javdb: { primary: 'https://javdb.com', alternatives: [] },
                javbus: { primary: 'https://www.javbus.com', alternatives: [] }
            };
        }

        // 检查是否已存在（包括主线路）
        if (url === settings.routes[service].primary) {
            showMessage('该线路已存在（主线路）', 'warn');
            return;
        }

        const existingRoutes = settings.routes[service].alternatives;
        if (existingRoutes.some((r: { url: string }) => r.url === url)) {
            showMessage('该线路已存在', 'warn');
            return;
        }

        // 添加新线路
        existingRoutes.push({
            url,
            enabled: true,
            description: descInput?.value.trim() || '',
            addedAt: Date.now()
        });

        await this.saveStoredSettings(settings);
        await this.loadRoutesConfig();

        // 清空输入框
        if (urlInput) urlInput.value = '';
        if (descInput) descInput.value = '';

        showMessage('线路添加成功', 'success');
    }

    /**
     * 处理切换线路启用状态
     */
    private async handleToggleRoute(service: 'javdb', url: string, isPrimary: boolean, enabled: boolean): Promise<void> {
        if (isPrimary) {
            showMessage('主线路不能禁用', 'warn');
            return;
        }

        const settings = await this.getStoredSettings();
        if (!settings.routes) return;

        const route = settings.routes[service].alternatives.find((r: any) => r.url === url);
        if (route) {
            route.enabled = enabled;
            await this.saveStoredSettings(settings);
            await this.loadRoutesConfig();
            showMessage(enabled ? `已启用 ${url}` : `已禁用 ${url}`, 'success');
        }
    }

    /**
     * 处理设置首选线路
     */
    private async handleSetPreferredRoute(service: 'javdb', url: string): Promise<void> {
        const settings = await this.getStoredSettings();
        if (!settings.routes) return;

        settings.routes[service].preferredUrl = url;

        await this.saveStoredSettings(settings);
        await this.loadRoutesConfig();

        showMessage(`已将 ${url} 设为首选线路`, 'success');

        // 清除路由管理器的缓存，使新的首选线路立即生效
        const { getRouteManager } = await import('../../../../features/routeManagement');
        getRouteManager().clearCache(service);
    }

    /**
     * 处理删除线路
     */
    private async handleDeleteRoute(service: 'javdb', url: string): Promise<void> {
        if (!confirm('确定要删除这条线路吗？')) return;

        const settings = await this.getStoredSettings();
        if (!settings.routes) return;

        const index = settings.routes[service].alternatives.findIndex((r: any) => r.url === url);
        if (index >= 0) {
            settings.routes[service].alternatives.splice(index, 1);
            await this.saveStoredSettings(settings);
            await this.loadRoutesConfig();
            showMessage('线路已删除', 'success');
        }
    }

    /**
     * 处理测试单个线路
     */
    private async handleTestSingleRoute(service: 'javdb', url: string, routeItem: HTMLElement): Promise<void> {
        const testBtn = routeItem.querySelector('[data-action="test"]') as HTMLButtonElement;
        const originalText = testBtn.innerHTML;

        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试中';

        const startTime = Date.now();
        try {
            await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-cache' });
            const latency = Date.now() - startTime;

            // 保存延迟到缓存
            this.saveRouteLatency(url, latency);

            // 更新UI显示延迟
            const urlDiv = routeItem.querySelector('.route-url') as HTMLDivElement;
            const existingBadge = urlDiv.querySelector('.route-latency-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 创建新的延迟徽章
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this.renderLatencyBadge(latency);
            const latencyBadge = tempDiv.firstElementChild as HTMLElement;
            if (latencyBadge) {
                urlDiv.appendChild(latencyBadge);
            }

            showMessage(`线路可用，延迟 ${latency}ms`, 'success');
        } catch {
            const latency = Date.now() - startTime;

            // 保存失败状态
            this.saveRouteLatency(url, -1);

            // 更新UI显示失败
            const urlDiv = routeItem.querySelector('.route-url') as HTMLDivElement;
            const existingBadge = urlDiv.querySelector('.route-latency-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 创建新的延迟徽章
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this.renderLatencyBadge(-1);
            const latencyBadge = tempDiv.firstElementChild as HTMLElement;
            if (latencyBadge) {
                urlDiv.appendChild(latencyBadge);
            }

            showMessage(`线路不可用，耗时 ${latency}ms`, 'error');
        } finally {
            testBtn.disabled = false;
            testBtn.innerHTML = originalText;
        }
    }

    /**
     * 处理测试所有线路
     */
    private async handleTestAllRoutes(): Promise<void> {
        if (!this.testAllRoutesBtn) return;

        const buttonText = this.testAllRoutesBtn.querySelector('.button-text') as HTMLSpanElement;
        const spinner = this.testAllRoutesBtn.querySelector('.spinner') as HTMLDivElement;

        this.testAllRoutesBtn.disabled = true;
        if (buttonText) buttonText.textContent = '测试中...';
        if (spinner) spinner.classList.remove('hidden');

        const settings = await this.getStoredSettings();
        if (!settings.routes) {
            showMessage('未找到线路配置', 'error');
            this.testAllRoutesBtn.disabled = false;
            if (buttonText) buttonText.textContent = '测试所有线路';
            if (spinner) spinner.classList.add('hidden');
            return;
        }

        // 获取所有线路（包括主线路）
        const allRoutes = [
            { url: settings.routes.javdb.primary, description: '主线路' },
            ...settings.routes.javdb.alternatives
        ];

        showMessage(`开始测试 ${allRoutes.length} 条线路...`, 'info');

        // 逐个测试线路
        for (const route of allRoutes) {
            const startTime = Date.now();
            try {
                await fetch(route.url, { method: 'HEAD', mode: 'no-cors', cache: 'no-cache' });
                const latency = Date.now() - startTime;
                this.saveRouteLatency(route.url, latency);
            } catch {
                this.saveRouteLatency(route.url, -1);
            }
        }

        // 重新加载列表以显示延迟信息
        await this.loadRoutesConfig();

        this.testAllRoutesBtn.disabled = false;
        if (buttonText) buttonText.textContent = '测试所有线路';
        if (spinner) spinner.classList.add('hidden');

        showMessage('线路测试完成', 'success');
    }

    /**
     * 处理从 GitHub 更新线路配置
     */
    private async handleUpdateRoutesFromGithub(): Promise<void> {
        const btn = this.updateRoutesFromGithubBtn;
        const spinner = btn.querySelector('.spinner') as HTMLElement;
        const buttonText = btn.querySelector('.button-text') as HTMLElement;

        try {
            // 显示加载状态
            btn.disabled = true;
            spinner?.classList.remove('hidden');
            if (buttonText) buttonText.textContent = '正在更新...';

            // 动态导入 RouteManager
            const { RouteManager } = await import('../../../../features/routeManagement');
            const routeManager = RouteManager.getInstance();

            // 强制更新线路配置
            const updated = await routeManager.checkAndUpdateRoutes(true);

            if (updated) {
                showMessage('线路配置已从 GitHub 更新成功！', 'success');
                // 重新加载线路列表
                await this.loadRoutesConfig();
            } else {
                showMessage('当前已是最新版本，无需更新', 'info');
            }

        } catch (error: any) {
            console.error('[NetworkTestSettings] 更新线路配置失败:', error);
            showMessage(`更新失败: ${error?.message || '未知错误'}`, 'error');
        } finally {
            // 恢复按钮状态
            btn.disabled = false;
            spinner?.classList.add('hidden');
            if (buttonText) buttonText.textContent = '从 GitHub 更新线路';
        }
    }

    /**
     * 处理恢复默认线路
     */
    private async handleResetDefaultRoutes(): Promise<void> {
        if (!confirm('确定要恢复默认线路配置吗？这将清除所有自定义线路。')) return;

        const settings = await this.getStoredSettings();

        // 恢复默认配置（仅 JavDB）
        settings.routes = {
            javdb: {
                primary: 'https://javdb.com',
                alternatives: [
                    {
                        url: 'https://javdb570.com',
                        enabled: true,
                        description: '备用线路',
                        addedAt: Date.now()
                    },
                    {
                        url: 'https://javdb575.com',
                        enabled: true,
                        description: '备用线路2',
                        addedAt: Date.now()
                    }
                ]
            },
            javbus: {
                primary: 'https://www.javbus.com',
                alternatives: []
            }
        };

        await this.saveStoredSettings(settings);
        await this.loadRoutesConfig();

        showMessage('已恢复默认线路配置', 'success');
    }

    /**
     * 处理ping测试（基于原始network.ts实现）
     */
    private async handlePingTest(): Promise<void> {
        const urlValue = this.manualUrlInput.value.trim();
        if (!urlValue) {
            // 显示结果容器并显示错误信息
            this.resultsContainerWrapper.style.display = 'block';
            this.manualResultsDiv.innerHTML = '<div class="ping-result-item failure"><i class="fas fa-times-circle icon"></i><span>请输入一个有效的 URL。</span></div>';
            return;
        }

        // 显示结果容器
        this.resultsContainerWrapper.style.display = 'block';

        const buttonText = this.manualTestBtn.querySelector('.button-text') as HTMLSpanElement;
        const spinner = this.manualTestBtn.querySelector('.spinner') as HTMLDivElement;

        this.manualTestBtn.disabled = true;
        if (buttonText) buttonText.textContent = '测试中...';
        if (spinner) spinner.classList.remove('hidden');
        this.manualResultsDiv.innerHTML = '';

        const onProgress = (message: string, success: boolean, latency?: number) => {
            const item = document.createElement('div');
            item.classList.add('ping-result-item');
            item.classList.add(success ? 'success' : 'failure');
            const iconClass = success ? 'fa-check-circle' : 'fa-times-circle';
            let content = `<i class="fas ${iconClass} icon"></i>`;
            if (typeof latency !== 'undefined') {
                content += `<span>${message}: 时间=${latency}ms</span>`;
            } else {
                content += `<span>${message}</span>`;
            }
            item.innerHTML = content;
            this.manualResultsDiv.appendChild(item);
            this.manualResultsDiv.scrollTop = this.manualResultsDiv.scrollHeight;
        };

        const urlsToTest: string[] = [];
        if (urlValue.match(/^https?:\/\//)) {
            urlsToTest.push(urlValue);
        } else {
            urlsToTest.push(`https://${urlValue}`);
            urlsToTest.push(`http://${urlValue}`);
        }

        for (const url of urlsToTest) {
            await this.runPingTest(url, onProgress);
            // Add a separator if there are more tests to run
            if (urlsToTest.length > 1 && url !== urlsToTest[urlsToTest.length - 1]) {
                const separator = document.createElement('hr');
                separator.style.marginTop = '20px';
                separator.style.marginBottom = '20px';
                separator.style.border = 'none';
                separator.style.borderTop = '1px solid #ccc';
                this.manualResultsDiv.appendChild(separator);
            }
        }

        this.manualTestBtn.disabled = false;
        if (buttonText) buttonText.textContent = '开始测试';
        if (spinner) spinner.classList.add('hidden');
    }

    /**
     * 执行ping测试（基于原始network.ts实现）
     */
    private async runPingTest(
        url: string,
        onProgress: (message: string, success: boolean, latency?: number) => void
    ): Promise<void> {
        try {
            const latencies = await this.ping(url, onProgress, 4);

            // Remove the "Pinging..." message for this specific test
            const pingingMessage = Array.from(this.manualResultsDiv.children).find(child => {
                const txt = (child as HTMLElement).textContent || '';
                return txt.includes(`正在 Ping ${url}`);
            });
            if (pingingMessage) {
                this.manualResultsDiv.removeChild(pingingMessage);
            }

            const validLatencies = latencies.filter(l => l >= 0);
            const summaryDiv = document.createElement('div');
            summaryDiv.className = 'ping-summary';

            if (validLatencies.length > 0) {
                const sum = validLatencies.reduce((a, b) => a + b, 0);
                const avg = Math.round(sum / validLatencies.length);
                const min = Math.min(...validLatencies);
                const max = Math.max(...validLatencies);
                const loss = ((latencies.length - validLatencies.length) / latencies.length) * 100;

                summaryDiv.innerHTML = `
                    <h5>Ping 统计信息 for ${url}</h5>
                    <p><strong>数据包:</strong> 已发送 = ${latencies.length}, 已接收 = ${validLatencies.length}, 丢失 = ${latencies.length - validLatencies.length} (${loss}% 丢失)</p>
                    <p><strong>往返行程的估计时间 (ms):</strong></p>
                    <p style="margin-left: 15px;">最短 = ${min}ms, 最长 = ${max}ms, 平均 = ${avg}ms</p>
                `;
            } else {
                summaryDiv.innerHTML = `
                    <h5>Ping 统计信息 for ${url}</h5>
                    <p>所有 ping 请求均失败。请检查 URL 或您的网络连接。</p>
                `;
            }
            this.manualResultsDiv.appendChild(summaryDiv);
        } catch (error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'ping-result-item failure';
            const message = error instanceof Error ? error.message : String(error);
            errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle icon"></i><span>测试 ${url} 过程中出现错误: ${message}</span>`;
            this.manualResultsDiv.appendChild(errorDiv);
        }
    }

    /**
     * 模拟ping功能，测试到指定URL的网络延迟（基于原始network.ts实现）
     */
    private async ping(
        url: string,
        onProgress: (message: string, success: boolean, latency?: number) => void,
        count = 4
    ): Promise<number[]> {
        const latencies: number[] = [];
        const testUrl = url;

        onProgress(`正在 Ping ${testUrl} ...`, true);

        for (let i = 0; i < count; i++) {
            const startTime = Date.now();
            try {
                const cacheBuster = `?t=${new Date().getTime()}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                await fetch(testUrl + cacheBuster, {
                    method: 'HEAD',
                    mode: 'no-cors',
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                const latency = Date.now() - startTime;
                latencies.push(latency);
                onProgress(`来自 ${testUrl} 的回复`, true, latency);

                if (i < count - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                const latency = Date.now() - startTime;
                let errorMessage = '未知错误';
                if (error instanceof Error) {
                    errorMessage = error.name === 'AbortError' ? '请求超时' : error.message;
                }
                onProgress(`请求失败: ${errorMessage}`, false, latency);
                latencies.push(-1);
            }
        }
        return latencies;
    }

    /**
     * 处理测试所有域名
     */
    private async handleTestAllDomains(): Promise<void> {
        try {
            const allDomains = getAllEnabledDomains();
            if (allDomains.length === 0) {
                showMessage('没有启用的域名需要测试', 'warn');
                return;
            }

            showMessage(`开始测试 ${allDomains.length} 个域名...`, 'info');
            await this.runBatchDomainTest(allDomains, '所有域名');
        } catch (error) {
            console.error('[Settings] 测试所有域名失败:', error);
            showMessage('测试所有域名失败', 'error');
        }
    }

    /**
     * 处理测试核心域名
     */
    private async handleTestCoreDomains(): Promise<void> {
        try {
            const coreDomains = getDomainsByCategory('core');
            if (coreDomains.length === 0) {
                showMessage('没有启用的核心域名需要测试', 'warn');
                return;
            }

            showMessage(`开始测试 ${coreDomains.length} 个核心域名...`, 'info');
            await this.runBatchDomainTest(coreDomains, '核心域名');
        } catch (error) {
            console.error('[Settings] 测试核心域名失败:', error);
            showMessage('测试核心域名失败', 'error');
        }
    }

    /**
     * 处理切换域名配置面板
     */
    private handleToggleDomainConfig(): void {
        const configPanel = document.getElementById('domain-config-panel');
        if (configPanel) {
            const isHidden = configPanel.style.display === 'none' || !configPanel.style.display;

            if (isHidden) {
                // 显示配置面板前，先生成域名配置UI
                this.renderDomainConfig();
                configPanel.style.display = 'block';
                this.toggleDomainConfigBtn.innerHTML = '<i class="fas fa-cog"></i><span class="button-text">隐藏配置</span>';
            } else {
                configPanel.style.display = 'none';
                this.toggleDomainConfigBtn.innerHTML = '<i class="fas fa-cog"></i><span class="button-text">配置域名</span>';
            }
        }
    }

    /**
     * 处理清空批量测试结果
     */
    private handleClearBatchResults(): void {
        const batchResults = document.getElementById('batch-test-results');
        if (batchResults) {
            batchResults.innerHTML = `
                <div class="batch-results-placeholder">
                    <i class="fas fa-info-circle"></i>
                    <p>点击上方按钮开始批量测试</p>
                </div>
            `;
            batchResults.style.display = 'none';
        }
        showMessage('批量测试结果已清空', 'success');
    }

    /**
     * 处理全选域名
     */
    private handleSelectAllDomains(): void {
        const checkboxes = document.querySelectorAll('#domain-config-content input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            const cb = checkbox as HTMLInputElement;
            cb.checked = true;
            // 更新域名状态
            const cat = cb.dataset.category!;
            const idx = parseInt(cb.dataset.index!);
            EXTENSION_DOMAINS[cat].domains[idx].enabled = true;
        });
        this.updateDomainStats();
        saveDomainConfig();
        showMessage('已全选所有域名', 'success');
    }

    /**
     * 处理全不选域名
     */
    private handleDeselectAllDomains(): void {
        const checkboxes = document.querySelectorAll('#domain-config-content input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            const cb = checkbox as HTMLInputElement;
            cb.checked = false;
            // 更新域名状态
            const cat = cb.dataset.category!;
            const idx = parseInt(cb.dataset.index!);
            EXTENSION_DOMAINS[cat].domains[idx].enabled = false;
        });
        this.updateDomainStats();
        saveDomainConfig();
        showMessage('已取消选择所有域名', 'success');
    }

    /**
     * 处理恢复默认域名配置
     */
    private handleResetDefaultDomains(): void {
        // 重新渲染域名配置，所有域名默认启用
        Object.values(EXTENSION_DOMAINS).forEach(category => {
            category.domains.forEach(domain => {
                domain.enabled = true;
            });
        });

        this.renderDomainConfig();
        this.updateDomainStats();
        saveDomainConfig();
        showMessage('已恢复默认域名配置', 'success');
    }

    /**
     * 渲染域名配置UI
     */
    private renderDomainConfig(): void {
        const configContent = document.getElementById('domain-config-content');
        if (!configContent) return;

        configContent.innerHTML = '';

        // 遍历所有分类
        Object.entries(EXTENSION_DOMAINS).forEach(([categoryKey, category]) => {
            const categoryGroup = document.createElement('div');
            categoryGroup.className = 'domain-category-group';
            categoryGroup.dataset.category = categoryKey;

            categoryGroup.innerHTML = `
                <h6>${category.icon} ${category.name}</h6>
                <div class="domain-category-description">${category.description}</div>
                <div class="domain-checkbox-list"></div>
            `;

            const checkboxList = categoryGroup.querySelector('.domain-checkbox-list') as HTMLDivElement;

            // 添加该分类下的所有域名
            category.domains.forEach((domain, index) => {
                const checkboxItem = document.createElement('div');
                checkboxItem.className = 'domain-checkbox-item';

                const checkboxId = `domain-${categoryKey}-${index}`;

                checkboxItem.innerHTML = `
                    <input type="checkbox"
                           id="${checkboxId}"
                           ${domain.enabled ? 'checked' : ''}
                           data-category="${categoryKey}"
                           data-index="${index}">
                    <label for="${checkboxId}" class="domain-checkbox-label">
                        <div class="domain-checkbox-name">
                            <span>${domain.name}</span>
                            <span class="domain-priority-badge ${domain.priority}">${this.getPriorityText(domain.priority)}</span>
                        </div>
                        <div class="domain-checkbox-url">${domain.domain}</div>
                        <div class="domain-checkbox-description">${domain.description}</div>
                    </label>
                `;

                // 添加复选框变化事件
                const checkbox = checkboxItem.querySelector('input[type="checkbox"]') as HTMLInputElement;
                checkbox.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement;
                    const cat = target.dataset.category!;
                    const idx = parseInt(target.dataset.index!);
                    EXTENSION_DOMAINS[cat].domains[idx].enabled = target.checked;
                    // 更新统计信息
                    this.updateDomainStats();
                    // 保存配置
                    saveDomainConfig();
                });

                checkboxList.appendChild(checkboxItem);
            });

            configContent.appendChild(categoryGroup);
        });
    }

    /**
     * 批量测试域名
     */
    private async runBatchDomainTest(domains: DomainInfo[], testType: string): Promise<void> {
        const batchResults = document.getElementById('batch-test-results');
        if (!batchResults) {
            console.error('[Settings] 批量测试结果容器未找到');
            return;
        }

        // 显示结果容器
        batchResults.style.display = 'block';
        batchResults.innerHTML = `
            <div class="batch-test-header">
                <h4>正在测试${testType}...</h4>
                <div class="test-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="progress-text">0 / ${domains.length}</div>
                </div>
            </div>
            <div class="batch-test-results-grid"></div>
        `;

        const resultsGrid = batchResults.querySelector('.batch-test-results-grid') as HTMLDivElement;
        const progressFill = batchResults.querySelector('.progress-fill') as HTMLDivElement;
        const progressText = batchResults.querySelector('.progress-text') as HTMLDivElement;

        let completedCount = 0;
        let successCount = 0;
        let failureCount = 0;

        // 禁用测试按钮
        this.testAllDomainsBtn.disabled = true;
        this.testCoreDomainsBtn.disabled = true;

        // 按分类组织域名
        const domainsByCategory = this.groupDomainsByCategory(domains);

        // 测试每个域名
        for (const [categoryName, categoryDomains] of Object.entries(domainsByCategory)) {
            // 添加分类标题
            const categoryHeader = document.createElement('div');
            categoryHeader.className = 'batch-category-header';
            categoryHeader.innerHTML = `
                <h5>${categoryName}</h5>
            `;
            resultsGrid.appendChild(categoryHeader);

            // 测试该分类下的所有域名
            for (const domain of categoryDomains) {
                const result = await this.testSingleDomain(domain);

                // 创建结果项
                const resultItem = document.createElement('div');
                resultItem.className = `batch-result-item ${result.success ? 'success' : 'failure'}`;

                const statusIcon = result.success ? 'fa-check-circle' : 'fa-times-circle';
                const statusText = result.success ? '可访问' : '无法访问';
                const latencyText = result.latency >= 0 ? `${result.latency}ms` : 'N/A';

                resultItem.innerHTML = `
                    <div class="result-header">
                        <i class="fas ${statusIcon}"></i>
                        <span class="domain-name">${domain.name}</span>
                        <span class="domain-status">${statusText}</span>
                    </div>
                    <div class="result-details">
                        <div class="domain-url">${domain.domain}</div>
                        <div class="domain-info">
                            <span class="latency">延迟: ${latencyText}</span>
                            <span class="priority">优先级: ${this.getPriorityText(domain.priority)}</span>
                        </div>
                        ${domain.description ? `<div class="domain-description">${domain.description}</div>` : ''}
                        ${result.error ? `<div class="error-message">${result.error}</div>` : ''}
                    </div>
                `;

                resultsGrid.appendChild(resultItem);

                // 更新统计
                completedCount++;
                if (result.success) {
                    successCount++;
                } else {
                    failureCount++;
                }

                // 更新进度
                const progress = (completedCount / domains.length) * 100;
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `${completedCount} / ${domains.length}`;

                // 滚动到最新结果
                resultItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        // 添加测试摘要
        const summary = document.createElement('div');
        summary.className = 'batch-test-summary';
        summary.innerHTML = `
            <h5>测试完成</h5>
            <div class="summary-stats">
                <div class="stat-item">
                    <span class="stat-label">总计:</span>
                    <span class="stat-value">${domains.length}</span>
                </div>
                <div class="stat-item success">
                    <span class="stat-label">成功:</span>
                    <span class="stat-value">${successCount}</span>
                </div>
                <div class="stat-item failure">
                    <span class="stat-label">失败:</span>
                    <span class="stat-value">${failureCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">成功率:</span>
                    <span class="stat-value">${((successCount / domains.length) * 100).toFixed(1)}%</span>
                </div>
            </div>
        `;
        batchResults.insertBefore(summary, resultsGrid);

        // 重新启用测试按钮
        this.testAllDomainsBtn.disabled = false;
        this.testCoreDomainsBtn.disabled = false;

        // 显示完成消息
        const successRate = ((successCount / domains.length) * 100).toFixed(1);
        showMessage(`测试完成！成功: ${successCount}/${domains.length} (${successRate}%)`,
                    successCount === domains.length ? 'success' : 'warn');

        // 保存测试时间
        this.saveLastTestTime();
    }

    /**
     * 测试单个域名
     */
    private async testSingleDomain(domain: DomainInfo): Promise<{
        success: boolean;
        latency: number;
        error?: string;
    }> {
        const testUrl = `https://${domain.domain}`;
        const startTime = Date.now();

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            await fetch(testUrl, {
                method: 'HEAD',
                mode: 'no-cors',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const latency = Date.now() - startTime;

            return {
                success: true,
                latency
            };
        } catch (error) {
            const latency = Date.now() - startTime;
            let errorMessage = '未知错误';

            if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    errorMessage = '请求超时';
                } else {
                    errorMessage = error.message;
                }
            }

            return {
                success: false,
                latency,
                error: errorMessage
            };
        }
    }

    /**
     * 按分类组织域名
     */
    private groupDomainsByCategory(domains: DomainInfo[]): Record<string, DomainInfo[]> {
        const grouped: Record<string, DomainInfo[]> = {};

        // 遍历所有分类
        Object.entries(EXTENSION_DOMAINS).forEach(([, category]) => {
            const categoryDomains = domains.filter(domain =>
                category.domains.some(d => d.domain === domain.domain)
            );

            if (categoryDomains.length > 0) {
                grouped[`${category.icon} ${category.name}`] = categoryDomains;
            }
        });

        return grouped;
    }

    /**
     * 获取优先级文本
     */
    private getPriorityText(priority: 'high' | 'medium' | 'low'): string {
        const priorityMap = {
            high: '高',
            medium: '中',
            low: '低'
        };
        return priorityMap[priority];
    }

    /**
     * 更新域名统计信息
     */
    private updateDomainStats(): void {
        const totalDomainsEl = document.getElementById('total-domains');
        const enabledDomainsEl = document.getElementById('enabled-domains');

        if (totalDomainsEl && enabledDomainsEl) {
            let total = 0;
            let enabled = 0;

            Object.values(EXTENSION_DOMAINS).forEach(category => {
                category.domains.forEach(domain => {
                    total++;
                    if (domain.enabled) {
                        enabled++;
                    }
                });
            });

            totalDomainsEl.textContent = total.toString();
            enabledDomainsEl.textContent = enabled.toString();
        }
    }

    /**
     * 保存上次测试时间
     */
    private saveLastTestTime(): void {
        const now = new Date().toISOString();
        localStorage.setItem(this.LAST_TEST_TIME_KEY, now);
        this.updateLastTestTimeDisplay(now);
    }

    /**
     * 加载上次测试时间
     */
    private loadLastTestTime(): void {
        const lastTime = localStorage.getItem(this.LAST_TEST_TIME_KEY);
        this.updateLastTestTimeDisplay(lastTime);
    }

    /**
     * 更新上次测试时间显示
     */
    private updateLastTestTimeDisplay(isoTime: string | null): void {
        const lastTestTimeEl = document.getElementById('last-test-time');
        if (!lastTestTimeEl) return;

        if (!isoTime) {
            lastTestTimeEl.textContent = '从未';
            return;
        }

        try {
            const testDate = new Date(isoTime);
            const now = new Date();
            const diffMs = now.getTime() - testDate.getTime();
            const diffMinutes = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            let timeText = '';
            if (diffMinutes < 1) {
                timeText = '刚刚';
            } else if (diffMinutes < 60) {
                timeText = `${diffMinutes}分钟前`;
            } else if (diffHours < 24) {
                timeText = `${diffHours}小时前`;
            } else if (diffDays < 7) {
                timeText = `${diffDays}天前`;
            } else {
                // 显示具体日期
                const year = testDate.getFullYear();
                const month = String(testDate.getMonth() + 1).padStart(2, '0');
                const day = String(testDate.getDate()).padStart(2, '0');
                const hours = String(testDate.getHours()).padStart(2, '0');
                const minutes = String(testDate.getMinutes()).padStart(2, '0');
                timeText = `${year}-${month}-${day} ${hours}:${minutes}`;
            }

            lastTestTimeEl.textContent = timeText;
            lastTestTimeEl.title = testDate.toLocaleString('zh-CN');
        } catch (error) {
            console.error('[Settings] 解析测试时间失败:', error);
            lastTestTimeEl.textContent = '从未';
        }
    }

}
