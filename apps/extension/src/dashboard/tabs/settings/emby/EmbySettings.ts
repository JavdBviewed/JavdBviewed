/**
 * Emby/Jellyfin 增强设置面板
 * 配置 Emby/Jellyfin 等媒体服务器的番号识别和跳转功能
 */

import { STATE } from '../../../state';
import { BaseSettingsPanel } from '../base/BaseSettingsPanel';
import { saveSettings } from '../../../../utils/storage';
import { showMessage } from '../../../ui/toast';
import { buildMediaItemUrl } from '../../../../features/embyLibrary/domain/libraryIndex';
import type { SettingsValidationResult, SettingsSaveResult } from '../types';
import type { ExtensionSettings } from '../../../../types';
import type { EmbyLibraryIndexEntry, EmbyMediaServer } from '../../../../features/embyLibrary/types';

interface LibrarySyncServerResult {
    serverId?: string;
    serverType?: string;
    serverName?: string;
    success?: boolean;
    itemCount?: number;
    indexedCount?: number;
    error?: string;
}

interface LibrarySyncResponse {
    success?: boolean;
    synced?: number;
    failed?: number;
    skipped?: boolean;
    error?: string;
    serverResults?: LibrarySyncServerResult[];
}

interface LibrarySyncDiagnosis {
    title: string;
    description: string;
}

interface LibraryCheckResponse {
    success?: boolean;
    error?: string;
    matches?: Record<string, EmbyLibraryIndexEntry[]>;
}

/**
 * Emby/Jellyfin 设置面板类
 */
export class EmbySettings extends BaseSettingsPanel {
    private enabledToggle!: HTMLInputElement;
    private matchUrlsList!: HTMLDivElement;
    private addUrlBtn!: HTMLButtonElement;
    private linkBehaviorSelect!: HTMLSelectElement;
    private showQuickSearchCodeToggle!: HTMLInputElement;
    private showQuickSearchActorToggle!: HTMLInputElement;
    private libraryStatusEnabledToggle!: HTMLInputElement;
    private libraryShowListToggle!: HTMLInputElement;
    private libraryShowDetailToggle!: HTMLInputElement;
    private realtimeCheckEnabledToggle!: HTMLInputElement;
    private syncIntervalInput!: HTMLInputElement;
    private mediaServerList!: HTMLDivElement;
    private addMediaServerBtn!: HTMLButtonElement;
    private syncLibraryBtn!: HTMLButtonElement;
    private syncStatusEl!: HTMLDivElement;
    private libraryCheckCodeInput!: HTMLInputElement;
    private testLibraryCheckBtn!: HTMLButtonElement;
    private libraryCheckResultEl!: HTMLDivElement;
    private isCreatingMediaServer = false;

    constructor() {
        super({
            panelId: 'emby-settings',
            panelName: 'Emby/Jellyfin 增强设置',
            autoSave: true,
            saveDelay: 1000,
            requireValidation: true
        });
    }

    protected initializeElements(): void {
        this.enabledToggle = document.getElementById('emby-enabled') as HTMLInputElement;
        this.matchUrlsList = document.getElementById('emby-match-urls-list') as HTMLDivElement;
        this.addUrlBtn = document.getElementById('add-emby-url') as HTMLButtonElement;
        this.linkBehaviorSelect = document.getElementById('emby-link-behavior') as HTMLSelectElement;
        this.showQuickSearchCodeToggle = document.getElementById('emby-show-quick-search-code') as HTMLInputElement;
        this.showQuickSearchActorToggle = document.getElementById('emby-show-quick-search-actor') as HTMLInputElement;
        this.libraryStatusEnabledToggle = document.getElementById('emby-library-status-enabled') as HTMLInputElement;
        this.libraryShowListToggle = document.getElementById('emby-library-show-list') as HTMLInputElement;
        this.libraryShowDetailToggle = document.getElementById('emby-library-show-detail') as HTMLInputElement;
        this.realtimeCheckEnabledToggle = document.getElementById('emby-library-realtime-enabled') as HTMLInputElement;
        this.syncIntervalInput = document.getElementById('emby-library-sync-interval') as HTMLInputElement;
        this.mediaServerList = document.getElementById('emby-media-server-list') as HTMLDivElement;
        this.addMediaServerBtn = document.getElementById('add-emby-media-server') as HTMLButtonElement;
        this.syncLibraryBtn = document.getElementById('sync-emby-library') as HTMLButtonElement;
        this.syncStatusEl = document.getElementById('emby-library-sync-status') as HTMLDivElement;
        this.libraryCheckCodeInput = document.getElementById('emby-library-check-code') as HTMLInputElement;
        this.testLibraryCheckBtn = document.getElementById('test-emby-library-check') as HTMLButtonElement;
        this.libraryCheckResultEl = document.getElementById('emby-library-check-result') as HTMLDivElement;

        if (!this.enabledToggle || !this.matchUrlsList || !this.addUrlBtn ||
            !this.linkBehaviorSelect ||
            !this.showQuickSearchCodeToggle || !this.showQuickSearchActorToggle ||
            !this.libraryStatusEnabledToggle || !this.libraryShowListToggle ||
            !this.libraryShowDetailToggle || !this.realtimeCheckEnabledToggle ||
            !this.syncIntervalInput || !this.mediaServerList ||
            !this.addMediaServerBtn || !this.syncLibraryBtn || !this.syncStatusEl ||
            !this.libraryCheckCodeInput || !this.testLibraryCheckBtn || !this.libraryCheckResultEl) {
            throw new Error('Emby/Jellyfin 设置相关的DOM元素未找到');
        }
    }

    protected bindEvents(): void {
        const signal = this.createEventBindingSignal();
        this.enabledToggle.addEventListener('change', this.handleEnabledChange.bind(this), { signal });
        this.addUrlBtn.addEventListener('click', this.handleAddUrl.bind(this), { signal });
        this.matchUrlsList.addEventListener('click', this.handleUrlListClick.bind(this), { signal });
        this.matchUrlsList.addEventListener('input', this.handleUrlListInput.bind(this), { signal });
        this.linkBehaviorSelect.addEventListener('change', this.handleSettingsChange.bind(this), { signal });
        this.showQuickSearchCodeToggle.addEventListener('change', this.handleSettingsChange.bind(this), { signal });
        this.showQuickSearchActorToggle.addEventListener('change', this.handleSettingsChange.bind(this), { signal });
        this.libraryStatusEnabledToggle.addEventListener('change', this.handleLibraryStatusChange.bind(this), { signal });
        this.libraryShowListToggle.addEventListener('change', this.handleSettingsChange.bind(this), { signal });
        this.libraryShowDetailToggle.addEventListener('change', this.handleSettingsChange.bind(this), { signal });
        this.realtimeCheckEnabledToggle.addEventListener('change', this.handleSettingsChange.bind(this), { signal });
        this.syncIntervalInput.addEventListener('input', this.handleSettingsChange.bind(this), { signal });
        this.addMediaServerBtn.addEventListener('click', this.handleAddMediaServer.bind(this), { signal });
        this.syncLibraryBtn.addEventListener('click', this.handleManualLibrarySync.bind(this), { signal });
        this.testLibraryCheckBtn.addEventListener('click', this.handleTestLibraryCheck.bind(this), { signal });
        this.libraryCheckCodeInput.addEventListener('keydown', this.handleLibraryCheckKeydown.bind(this), { signal });
        this.mediaServerList.addEventListener('input', this.handleMediaServerListInput.bind(this), { signal });
        this.mediaServerList.addEventListener('change', this.handleMediaServerListChange.bind(this), { signal });
        this.mediaServerList.addEventListener('click', this.handleMediaServerListClick.bind(this), { signal });
        this.mediaServerList.addEventListener('keydown', this.handleMediaServerListKeydown.bind(this), { signal });
    }

    protected unbindEvents(): void {
        this.unbindManagedEvents();
    }

    protected async doLoadSettings(): Promise<void> {
        const settings = STATE.settings;
        const embyConfig = settings?.emby;

        if (embyConfig) {
            this.enabledToggle.checked = embyConfig.enabled;
            this.linkBehaviorSelect.value = embyConfig.linkBehavior;
            this.showQuickSearchCodeToggle.checked = embyConfig.showQuickSearchCode !== false;
            this.showQuickSearchActorToggle.checked = embyConfig.showQuickSearchActor !== false;
            this.libraryStatusEnabledToggle.checked = embyConfig.libraryStatus?.enabled === true;
            this.libraryShowListToggle.checked = embyConfig.libraryStatus?.showOnList !== false;
            this.libraryShowDetailToggle.checked = embyConfig.libraryStatus?.showOnDetail !== false;
            this.realtimeCheckEnabledToggle.checked = embyConfig.realtimeCheck?.enabled === true;
            this.syncIntervalInput.value = String(Math.max(5, Number(embyConfig.syncIntervalMinutes || 60)));

            this.renderMatchUrls();
            this.renderMediaServers();
            this.updateUIState();
        }
    }

    protected async doSaveSettings(): Promise<SettingsSaveResult> {
        try {
            this.updateEmbyConfigFromUI();

            const newSettings: ExtensionSettings = {
                ...STATE.settings,
                emby: { ...STATE.settings.emby }
            };

            await saveSettings(newSettings);
            STATE.settings = newSettings;

            if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        if (tab.id) {
                            chrome.tabs.sendMessage(tab.id, {
                                type: 'settings-updated',
                                settings: newSettings
                            }).catch(() => {});
                        }
                    });
                });
            }

            return {
                success: true,
                savedSettings: { emby: newSettings.emby }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '保存设置失败'
            };
        }
    }

    protected doValidateSettings(): SettingsValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        const urls = this.getUrlsFromUI();
        for (const url of urls) {
            if (!url.trim()) {
                errors.push('额外匹配地址不能为空');
                continue;
            }
            if (!this.isValidUrlPattern(url)) {
                warnings.push(`额外匹配地址可能无效: ${url}`);
            }
        }

        const mediaServers = this.getMediaServersFromUI();
        mediaServers.forEach((server, index) => {
            if (!this.isValidServerUrl(server.url)) {
                errors.push(`媒体服务器 ${index + 1} 地址需要使用 http 或 https`);
            }
            if (!server.apiKey.trim()) {
                errors.push(`媒体服务器 ${index + 1} API Key 不能为空`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    private handleSettingsChange(): void {
        if (this.config.autoSave) {
            this.scheduleAutoSave();
        }
    }

    private handleEnabledChange(): void {
        this.updateUIState();
        this.handleSettingsChange();
    }

    private handleLibraryStatusChange(): void {
        this.updateUIState();
        this.handleSettingsChange();
    }

    private updateUIState(): void {
        const enabled = this.enabledToggle.checked;
        const elements = [
            this.matchUrlsList,
            this.addUrlBtn,
            this.linkBehaviorSelect,
            this.showQuickSearchCodeToggle,
            this.showQuickSearchActorToggle,
        ];

        elements.forEach(element => {
            if (element) {
                if ('disabled' in element) {
                    (element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = !enabled;
                }
                if (element.parentElement) {
                    element.parentElement.style.opacity = enabled ? '1' : '0.5';
                }
            }
        });

        const libraryEnabled = this.libraryStatusEnabledToggle.checked;
        [
            this.libraryShowListToggle,
            this.libraryShowDetailToggle,
            this.realtimeCheckEnabledToggle,
        ].forEach(element => {
            element.disabled = !libraryEnabled;
            if (element.parentElement) {
                element.parentElement.style.opacity = libraryEnabled ? '1' : '0.5';
            }
        });
    }

    private renderMatchUrls(): void {
        const urls = STATE.settings.emby?.matchUrls || [];

        this.matchUrlsList.innerHTML = urls.map((url: string, index: number) => `
            <div class="url-item" data-index="${index}">
                <input type="text" class="url-input" value="${url}" placeholder="备用域名或反代地址，如 https://media.example.com/*">
                <button type="button" class="remove-url-btn" title="删除">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');

        if (urls.length === 0) {
            this.addEmptyUrlInput();
        }
    }

    private addEmptyUrlInput(): void {
        const index = this.matchUrlsList.children.length;
        const urlItem = document.createElement('div');
        urlItem.className = 'url-item';
        urlItem.dataset.index = index.toString();
        urlItem.innerHTML = `
            <input type="text" class="url-input" value="" placeholder="备用域名或反代地址，如 https://media.example.com/*">
            <button type="button" class="remove-url-btn" title="删除">
                <i class="fas fa-trash"></i>
            </button>
        `;
        this.matchUrlsList.appendChild(urlItem);
    }

    private handleAddUrl(): void {
        this.addEmptyUrlInput();
    }

    private handleUrlListClick(event: Event): void {
        const target = event.target as HTMLElement;

        if (target.classList.contains('remove-url-btn') || target.closest('.remove-url-btn')) {
            const urlItem = target.closest('.url-item') as HTMLElement;
            if (urlItem) {
                urlItem.remove();
                this.handleSettingsChange();
            }
        }
    }

    private handleUrlListInput(): void {
        this.handleSettingsChange();
    }

    private renderMediaServers(): void {
        const servers = this.getStoredMediaServers();
        this.isCreatingMediaServer = false;
        this.mediaServerList.innerHTML = servers.map((server, index) => this.renderMediaServerItem(server, index)).join('');
    }

    private renderMediaServerItem(server: EmbyMediaServer, index: number): string {
        const type = server.type === 'jellyfin' ? 'jellyfin' : 'emby';
        const libraryIds = Array.isArray(server.libraryIds) ? server.libraryIds : [];
        const libraryOptions = Array.isArray(server.libraryOptions) ? server.libraryOptions : [];
        const libraryPanel = this.renderLibraryPickerHtml(libraryIds, libraryOptions);
        const userLoggedIn = Boolean(server.accessToken && server.userId);
        const userLabel = userLoggedIn
          ? `已登录：${this.escapeHtml(server.userDisplayName || server.username || server.userId || '')}`
          : '未登录用户（写回「真实已看」通常需要登录）';
        return `
            <div class="emby-media-server-item" data-index="${index}" data-server-id="${this.escapeHtml(server.id || '')}">
                <div class="emby-media-server-grid">
                    <label class="setting-label">
                        <span class="setting-title">类型</span>
                        <select class="emby-server-type setting-select">
                            <option value="emby" ${type === 'emby' ? 'selected' : ''}>Emby</option>
                            <option value="jellyfin" ${type === 'jellyfin' ? 'selected' : ''}>Jellyfin</option>
                        </select>
                    </label>
                    <label class="setting-label">
                        <span class="setting-title">名称</span>
                        <input type="text" class="emby-server-name setting-input" value="${this.escapeHtml(server.name || '')}" placeholder="主服务器">
                    </label>
                    <label class="setting-label emby-server-url-field">
                        <span class="setting-title">服务器地址</span>
                        <input type="text" class="emby-server-url setting-input" value="${this.escapeHtml(server.url || '')}" placeholder="http://192.168.1.10:8096">
                    </label>
                    <label class="setting-label emby-server-key-field">
                        <span class="setting-title">API Key</span>
                        <input type="password" class="emby-server-api-key setting-input" value="${this.escapeHtml(server.apiKey || '')}" placeholder="扫库/只读用 API Key">
                    </label>
                    <label class="setting-label emby-server-enabled-field">
                        <span class="setting-title">启用</span>
                        <span class="drive115-toggle-switch emby-server-toggle-switch">
                            <input type="checkbox" class="emby-server-enabled drive115-toggle-input" ${server.enabled !== false ? 'checked' : ''}>
                            <span class="drive115-toggle-slider"></span>
                        </span>
                    </label>
                    <button type="button" class="remove-emby-media-server remove-url-btn" title="删除服务器">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="emby-server-user-auth">
                    <div class="emby-server-libraries-head">
                        <span class="setting-title">用户登录（写回观看状态 / 更完整 UserData）</span>
                        <span class="emby-user-session-label ${userLoggedIn ? 'is-on' : ''}">${userLabel}</span>
                    </div>
                    <div class="emby-user-auth-grid">
                        <label class="setting-label">
                            <span class="setting-title">用户名</span>
                            <input type="text" class="emby-server-username setting-input" value="${this.escapeHtml(server.username || '')}" placeholder="媒体服务器用户名" autocomplete="username">
                        </label>
                        <label class="setting-label">
                            <span class="setting-title">密码</span>
                            <input type="password" class="emby-server-password setting-input" value="${this.escapeHtml(server.password || '')}" placeholder="用于登录并保存到此来源" autocomplete="current-password">
                        </label>
                        <div class="emby-user-auth-actions">
                            <button type="button" class="btn btn-primary emby-user-login-btn">登录并保存令牌</button>
                            <button type="button" class="btn btn-secondary emby-user-logout-btn" ${userLoggedIn ? '' : 'disabled'}>退出登录</button>
                        </div>
                    </div>
                    <input type="hidden" class="emby-server-access-token" value="${this.escapeHtml(server.accessToken || '')}">
                    <input type="hidden" class="emby-server-user-id" value="${this.escapeHtml(server.userId || '')}">
                    <input type="hidden" class="emby-server-user-display" value="${this.escapeHtml(server.userDisplayName || '')}">
                    <input type="hidden" class="emby-server-token-at" value="${server.tokenObtainedAt ? String(server.tokenObtainedAt) : ''}">
                    <p class="setting-description">API Key 负责扫库；用户登录后的 AccessToken 用于标记真实已看。用户名和密码会随来源配置保存，用于重新登录和同步观看状态。</p>
                </div>
                <div class="emby-server-libraries">
                    <div class="emby-server-libraries-head">
                        <span class="setting-title">同步媒体库（可多选；不选=整库，兼容旧配置）</span>
                        <button type="button" class="btn btn-secondary emby-refresh-libraries" title="从服务器拉取媒体库列表">
                            <i class="fas fa-folder-open"></i> 拉取媒体库
                        </button>
                    </div>
                    <div class="emby-library-picker">
                        ${libraryPanel}
                    </div>
                </div>
            </div>
        `;
    }

    private renderLibraryPickerHtml(
        selectedIds: string[],
        options: Array<{ id: string; name: string; collectionType?: string }>,
    ): string {
        if (!options.length) {
            const hint = selectedIds.length
                ? `已选 ${selectedIds.length} 个库 Id（请点「拉取媒体库」加载名称）`
                : '尚未拉取列表。不选任何库时同步整库；建议拉取后只勾选需要的库（类似 115 选文件夹）。';
            return `<p class="setting-description emby-library-empty-hint">${this.escapeHtml(hint)}</p>
                <input type="hidden" class="emby-library-ids-json" value="${this.escapeHtml(JSON.stringify(selectedIds))}">
                <input type="hidden" class="emby-library-options-json" value="${this.escapeHtml(JSON.stringify(options))}">`;
        }
        const selected = new Set(selectedIds.map(String));
        const checks = options.map((opt) => {
            const checked = selected.has(opt.id) ? 'checked' : '';
            const typeHint = opt.collectionType ? ` · ${this.escapeHtml(opt.collectionType)}` : '';
            return `
                <label class="emby-library-check">
                    <input type="checkbox" class="emby-library-id-checkbox" value="${this.escapeHtml(opt.id)}" ${checked}>
                    <span>${this.escapeHtml(opt.name)}${typeHint}</span>
                </label>`;
        }).join('');
        return `${checks}
            <input type="hidden" class="emby-library-ids-json" value="${this.escapeHtml(JSON.stringify(selectedIds))}">
            <input type="hidden" class="emby-library-options-json" value="${this.escapeHtml(JSON.stringify(options))}">`;
    }

    private handleAddMediaServer(): void {
        if (this.isCreatingMediaServer) {
            this.focusMediaServerCreateInput();
            return;
        }

        this.isCreatingMediaServer = true;
        this.mediaServerList.insertAdjacentHTML('beforeend', this.renderMediaServerCreateItem());
        this.focusMediaServerCreateInput();
    }

    private handleMediaServerListClick(event: Event): void {
        const target = event.target as HTMLElement;

        if (target.closest('.create-emby-media-server-confirm')) {
            this.commitMediaServerCreate();
            return;
        }

        if (target.closest('.create-emby-media-server-cancel')) {
            this.cancelMediaServerCreate();
            return;
        }

        if (target.closest('.emby-refresh-libraries')) {
            const item = target.closest('.emby-media-server-item') as HTMLElement | null;
            if (item) void this.refreshLibrariesForServerItem(item);
            return;
        }

        if (target.closest('.emby-user-login-btn')) {
            const item = target.closest('.emby-media-server-item') as HTMLElement | null;
            if (item) void this.loginUserForServerItem(item);
            return;
        }

        if (target.closest('.emby-user-logout-btn')) {
            const item = target.closest('.emby-media-server-item') as HTMLElement | null;
            if (item) this.logoutUserForServerItem(item);
            return;
        }

        const button = target.closest('.remove-emby-media-server');
        if (!button) return;
        const item = button.closest('.emby-media-server-item') as HTMLElement | null;
        const index = Number(item?.dataset.index);
        if (!Number.isInteger(index)) return;
        const servers = this.getMediaServersFromUI();
        servers.splice(index, 1);
        STATE.settings.emby = {
            ...STATE.settings.emby,
            mediaServers: servers,
        };
        this.renderMediaServers();
        this.handleSettingsChange();
    }

    private handleMediaServerListInput(event: Event): void {
        if (this.isMediaServerCreateTarget(event.target)) return;
        this.handleSettingsChange();
    }

    private handleMediaServerListChange(event: Event): void {
        if (this.isMediaServerCreateTarget(event.target)) return;
        this.handleSettingsChange();
    }

    private handleMediaServerListKeydown(event: KeyboardEvent): void {
        if (!this.isMediaServerCreateTarget(event.target)) return;

        if (event.key === 'Enter') {
            event.preventDefault();
            this.commitMediaServerCreate();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.cancelMediaServerCreate();
        }
    }

    private renderMediaServerCreateItem(): string {
        return `
            <div class="emby-media-server-create-item">
                <div class="emby-media-server-grid">
                    <label class="setting-label">
                        <span class="setting-title">类型</span>
                        <select class="emby-create-server-type setting-select">
                            <option value="emby" selected>Emby</option>
                            <option value="jellyfin">Jellyfin</option>
                        </select>
                    </label>
                    <label class="setting-label">
                        <span class="setting-title">名称</span>
                        <input type="text" class="emby-create-server-name setting-input" value="Emby" placeholder="主服务器">
                    </label>
                    <label class="setting-label emby-server-url-field">
                        <span class="setting-title">服务器地址</span>
                        <input type="text" class="emby-create-server-url setting-input" value="" placeholder="http://192.168.1.10:8096">
                    </label>
                    <label class="setting-label emby-server-key-field">
                        <span class="setting-title">API Key</span>
                        <input type="password" class="emby-create-server-api-key setting-input" value="" placeholder="媒体服务器 API Key">
                    </label>
                    <label class="setting-label emby-server-enabled-field">
                        <span class="setting-title">启用</span>
                        <span class="drive115-toggle-switch emby-server-toggle-switch">
                            <input type="checkbox" class="emby-create-server-enabled drive115-toggle-input" checked>
                            <span class="drive115-toggle-slider"></span>
                        </span>
                    </label>
                    <div class="emby-server-inline-actions">
                        <button type="button" class="create-emby-media-server-confirm emby-server-inline-btn emby-server-inline-confirm" title="确认">
                            <i class="fas fa-check"></i>
                        </button>
                        <button type="button" class="create-emby-media-server-cancel emby-server-inline-btn emby-server-inline-cancel" title="取消">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    private commitMediaServerCreate(): void {
        const item = this.mediaServerList.querySelector<HTMLElement>('.emby-media-server-create-item');
        if (!item) {
            this.isCreatingMediaServer = false;
            return;
        }

        const type: EmbyMediaServer['type'] = item.querySelector<HTMLSelectElement>('.emby-create-server-type')?.value === 'jellyfin' ? 'jellyfin' : 'emby';
        const name = item.querySelector<HTMLInputElement>('.emby-create-server-name')?.value.trim() || (type === 'jellyfin' ? 'Jellyfin' : 'Emby');
        const url = item.querySelector<HTMLInputElement>('.emby-create-server-url')?.value.trim().replace(/\/+$/, '') || '';
        const apiKey = item.querySelector<HTMLInputElement>('.emby-create-server-api-key')?.value.trim() || '';
        const enabled = item.querySelector<HTMLInputElement>('.emby-create-server-enabled')?.checked !== false;

        if (!this.isValidServerUrl(url)) {
            showMessage('媒体服务器地址需要使用 http 或 https', 'warning');
            item.querySelector<HTMLInputElement>('.emby-create-server-url')?.focus();
            return;
        }

        if (!apiKey) {
            showMessage('媒体服务器 API Key 不能为空', 'warning');
            item.querySelector<HTMLInputElement>('.emby-create-server-api-key')?.focus();
            return;
        }

        const servers = this.getMediaServersFromUI();
        servers.push({
            id: `media-server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            name,
            url,
            apiKey,
            enabled,
        });
        STATE.settings.emby = {
            ...STATE.settings.emby,
            mediaServers: servers,
        };
        this.isCreatingMediaServer = false;
        this.renderMediaServers();
        this.handleSettingsChange();
    }

    private cancelMediaServerCreate(): void {
        this.mediaServerList.querySelector('.emby-media-server-create-item')?.remove();
        this.isCreatingMediaServer = false;
    }

    private focusMediaServerCreateInput(): void {
        window.setTimeout(() => {
            const input = this.mediaServerList.querySelector<HTMLInputElement>('.emby-create-server-url');
            input?.focus();
        }, 30);
    }

    private isMediaServerCreateTarget(target: EventTarget | null): boolean {
        return target instanceof HTMLElement && Boolean(target.closest('.emby-media-server-create-item'));
    }

    private getStoredMediaServers(): EmbyMediaServer[] {
        const servers = STATE.settings.emby?.mediaServers;
        return Array.isArray(servers) ? servers.map((server: any): EmbyMediaServer => {
            const type: EmbyMediaServer['type'] = server.type === 'jellyfin' ? 'jellyfin' : 'emby';
            const libraryIds = Array.isArray(server.libraryIds)
                ? server.libraryIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
                : [];
            const libraryOptions = Array.isArray(server.libraryOptions)
                ? server.libraryOptions
                    .map((opt: any) => ({
                        id: String(opt?.id || '').trim(),
                        name: String(opt?.name || opt?.id || '').trim(),
                        collectionType: opt?.collectionType ? String(opt.collectionType) : undefined,
                    }))
                    .filter((opt: { id: string }) => opt.id)
                : undefined;
            return {
                id: String(server.id || `media-server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
                type,
                name: String(server.name || (type === 'jellyfin' ? 'Jellyfin' : 'Emby')),
                url: String(server.url || ''),
                apiKey: String(server.apiKey || ''),
                enabled: server.enabled !== false,
                libraryIds,
                ...(libraryOptions && libraryOptions.length ? { libraryOptions } : {}),
                username: server.username ? String(server.username) : undefined,
                password: server.password ? String(server.password) : undefined,
                accessToken: server.accessToken ? String(server.accessToken) : undefined,
                userId: server.userId ? String(server.userId) : undefined,
                userDisplayName: server.userDisplayName ? String(server.userDisplayName) : undefined,
                tokenObtainedAt: Number(server.tokenObtainedAt) || undefined,
            };
        }) : [];
    }

    private getMediaServersFromUI(): EmbyMediaServer[] {
        const items = Array.from(this.mediaServerList.querySelectorAll<HTMLElement>('.emby-media-server-item'));
        const storedServers = this.getStoredMediaServers();
        return items.map((item, index): EmbyMediaServer => {
            const type: EmbyMediaServer['type'] = item.querySelector<HTMLSelectElement>('.emby-server-type')?.value === 'jellyfin' ? 'jellyfin' : 'emby';
            const name = item.querySelector<HTMLInputElement>('.emby-server-name')?.value.trim() || (type === 'jellyfin' ? 'Jellyfin' : 'Emby');
            const url = item.querySelector<HTMLInputElement>('.emby-server-url')?.value.trim().replace(/\/+$/, '') || '';
            const apiKey = item.querySelector<HTMLInputElement>('.emby-server-api-key')?.value.trim() || '';
            const enabled = item.querySelector<HTMLInputElement>('.emby-server-enabled')?.checked !== false;
            const username = item.querySelector<HTMLInputElement>('.emby-server-username')?.value.trim() || undefined;
            const password = item.querySelector<HTMLInputElement>('.emby-server-password')?.value || undefined;
            const accessToken = item.querySelector<HTMLInputElement>('.emby-server-access-token')?.value.trim() || undefined;
            const userId = item.querySelector<HTMLInputElement>('.emby-server-user-id')?.value.trim() || undefined;
            const userDisplayName = item.querySelector<HTMLInputElement>('.emby-server-user-display')?.value.trim() || undefined;
            const tokenAtRaw = item.querySelector<HTMLInputElement>('.emby-server-token-at')?.value.trim();
            const tokenObtainedAt = tokenAtRaw ? Number(tokenAtRaw) : undefined;
            const existing = storedServers[index];
            const libraryIds = this.readLibraryIdsFromServerItem(item);
            const libraryOptions = this.readLibraryOptionsFromServerItem(item, existing);
            return {
                id: existing?.id || `media-server-${Date.now()}-${index}`,
                type,
                name,
                url,
                apiKey,
                enabled,
                libraryIds,
                ...(libraryOptions.length ? { libraryOptions } : {}),
                username: username || existing?.username,
                password: password ?? existing?.password,
                accessToken: accessToken || existing?.accessToken,
                userId: userId || existing?.userId,
                userDisplayName: userDisplayName || existing?.userDisplayName,
                tokenObtainedAt: tokenObtainedAt || existing?.tokenObtainedAt,
            };
        }).filter((server) => server.url || server.apiKey || server.accessToken);
    }

    private readLibraryIdsFromServerItem(item: HTMLElement): string[] {
        const checks = Array.from(item.querySelectorAll<HTMLInputElement>('.emby-library-id-checkbox'));
        if (checks.length > 0) {
            return checks.filter((c) => c.checked).map((c) => c.value.trim()).filter(Boolean);
        }
        const hidden = item.querySelector<HTMLInputElement>('.emby-library-ids-json');
        if (hidden?.value) {
            try {
                const parsed = JSON.parse(hidden.value);
                if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
            } catch { /* ignore */ }
        }
        return [];
    }

    private readLibraryOptionsFromServerItem(
        item: HTMLElement,
        existing?: EmbyMediaServer,
    ): Array<{ id: string; name: string; collectionType?: string }> {
        const hidden = item.querySelector<HTMLInputElement>('.emby-library-options-json');
        if (hidden?.value) {
            try {
                const parsed = JSON.parse(hidden.value);
                if (Array.isArray(parsed)) {
                    return parsed
                        .map((opt: any) => ({
                            id: String(opt?.id || '').trim(),
                            name: String(opt?.name || opt?.id || '').trim(),
                            collectionType: opt?.collectionType ? String(opt.collectionType) : undefined,
                        }))
                        .filter((opt: { id: string }) => opt.id);
                }
            } catch { /* ignore */ }
        }
        return Array.isArray(existing?.libraryOptions) ? existing!.libraryOptions! : [];
    }

    private async refreshLibrariesForServerItem(item: HTMLElement): Promise<void> {
        const url = item.querySelector<HTMLInputElement>('.emby-server-url')?.value.trim().replace(/\/+$/, '') || '';
        const apiKey = item.querySelector<HTMLInputElement>('.emby-server-api-key')?.value.trim() || '';
        const picker = item.querySelector<HTMLElement>('.emby-library-picker');
        if (!url || !apiKey) {
            showMessage('请先填写服务器地址和 API Key', 'warning');
            return;
        }
        if (picker) {
            picker.innerHTML = '<p class="setting-description">正在拉取媒体库列表…</p>';
        }
        try {
            const response = await this.sendRuntimeMessage<{
                success?: boolean;
                libraries?: Array<{ id: string; name: string; collectionType?: string }>;
                error?: string;
            }>({
                type: 'EMBY_LIBRARY_LIST_FOLDERS',
                serverUrl: url,
                apiKey,
            });
            if (!response?.success) {
                throw new Error(response?.error || '拉取失败');
            }
            const libraries = Array.isArray(response.libraries) ? response.libraries : [];
            const selected = this.readLibraryIdsFromServerItem(item);
            // 保留仍存在的选中项
            const idSet = new Set(libraries.map((l) => l.id));
            const nextSelected = selected.filter((id) => idSet.has(id));
            if (picker) {
                picker.innerHTML = this.renderLibraryPickerHtml(nextSelected, libraries);
            }
            // 写回 STATE，避免仅 UI 变更丢失
            const index = Number(item.dataset.index);
            if (Number.isInteger(index)) {
                const servers = this.getMediaServersFromUI();
                if (servers[index]) {
                    servers[index] = {
                        ...servers[index],
                        libraryIds: nextSelected,
                        libraryOptions: libraries,
                    };
                    STATE.settings.emby = {
                        ...STATE.settings.emby,
                        mediaServers: servers,
                    };
                }
            }
            this.handleSettingsChange();
            showMessage(
                libraries.length
                    ? `已拉取 ${libraries.length} 个媒体库，请勾选要同步的库`
                    : '未获取到媒体库列表，请检查地址与 API Key',
                libraries.length ? 'success' : 'warning',
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (picker) {
                picker.innerHTML = `<p class="setting-description">拉取失败：${this.escapeHtml(message)}</p>`;
            }
            showMessage(`拉取媒体库失败：${message}`, 'error');
        }
    }

    private async loginUserForServerItem(item: HTMLElement): Promise<void> {
        const url = item.querySelector<HTMLInputElement>('.emby-server-url')?.value.trim().replace(/\/+$/, '') || '';
        const username = item.querySelector<HTMLInputElement>('.emby-server-username')?.value.trim() || '';
        const password = item.querySelector<HTMLInputElement>('.emby-server-password')?.value || '';
        if (!url) {
            showMessage('请先填写服务器地址', 'warning');
            return;
        }
        if (!username || !password) {
            showMessage('请填写用户名和密码', 'warning');
            return;
        }
        try {
            const response = await this.sendRuntimeMessage<{
                success?: boolean;
                accessToken?: string;
                userId?: string;
                userName?: string;
                username?: string;
                tokenObtainedAt?: number;
                error?: string;
            }>({
                type: 'EMBY_USER_LOGIN',
                serverUrl: url,
                username,
                password,
            });
            if (!response?.success || !response.accessToken || !response.userId) {
                throw new Error(response?.error || '登录失败');
            }

            const setHidden = (sel: string, val: string) => {
                const el = item.querySelector<HTMLInputElement>(sel);
                if (el) el.value = val;
            };
            setHidden('.emby-server-access-token', response.accessToken);
            setHidden('.emby-server-user-id', response.userId);
            setHidden('.emby-server-user-display', response.userName || username);
            setHidden('.emby-server-token-at', String(response.tokenObtainedAt || Date.now()));

            const label = item.querySelector('.emby-user-session-label');
            if (label) {
                label.textContent = `已登录：${response.userName || username}`;
                label.classList.add('is-on');
            }
            const logoutBtn = item.querySelector<HTMLButtonElement>('.emby-user-logout-btn');
            if (logoutBtn) logoutBtn.disabled = false;

            // 立刻写回 settings
            const servers = this.getMediaServersFromUI();
            STATE.settings.emby = {
                ...STATE.settings.emby,
                mediaServers: servers,
            };
            this.handleSettingsChange();
            showMessage('用户登录成功，已保存访问令牌（可用于写回真实已看）', 'success');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showMessage(`登录失败：${message}`, 'error');
        }
    }

    private logoutUserForServerItem(item: HTMLElement): void {
        const setHidden = (sel: string, val = '') => {
            const el = item.querySelector<HTMLInputElement>(sel);
            if (el) el.value = val;
        };
        setHidden('.emby-server-access-token');
        setHidden('.emby-server-user-id');
        setHidden('.emby-server-user-display');
        setHidden('.emby-server-token-at');
        const label = item.querySelector('.emby-user-session-label');
        if (label) {
            label.textContent = '未登录用户（写回「真实已看」通常需要登录）';
            label.classList.remove('is-on');
        }
        const logoutBtn = item.querySelector<HTMLButtonElement>('.emby-user-logout-btn');
        if (logoutBtn) logoutBtn.disabled = true;

        const index = Number(item.dataset.index);
        if (Number.isInteger(index)) {
            const servers = this.getMediaServersFromUI();
            if (servers[index]) {
                const { accessToken: _a, userId: _u, userDisplayName: _d, tokenObtainedAt: _t, ...rest } = servers[index] as any;
                servers[index] = {
                    ...rest,
                    accessToken: undefined,
                    userId: undefined,
                    userDisplayName: undefined,
                    tokenObtainedAt: undefined,
                };
                STATE.settings.emby = {
                    ...STATE.settings.emby,
                    mediaServers: servers,
                };
            }
        }
        this.handleSettingsChange();
        showMessage('已退出媒体服务器用户登录', 'info');
    }

    private async handleManualLibrarySync(): Promise<void> {
        if (!this.validateSettings()) return;
        await this.saveSettings();
        this.syncLibraryBtn.disabled = true;
        this.renderLibrarySyncLoading();
        try {
            const response = await this.sendRuntimeMessage<LibrarySyncResponse>({ type: 'EMBY_LIBRARY_SYNC', manual: true });
            const synced = Number(response?.synced || 0);
            const failed = Number(response?.failed || 0);
            const serverResults = this.normalizeLibrarySyncServerResults(response?.serverResults);
            if (synced === 0 && failed === 0 && serverResults.length === 0) {
                this.renderLibrarySyncSetupHint();
                showMessage('还没有可同步的媒体服务器', 'warning');
                return;
            }

            if (response?.success) {
                this.renderLibrarySyncResult('success', `同步完成：成功 ${synced} 个服务器，失败 ${failed} 个服务器`, serverResults);
                showMessage('媒体库同步完成', 'success');
            } else {
                const error = response?.error || (failed > 0 ? `失败 ${failed} 个服务器` : '同步失败');
                this.renderLibrarySyncResult('error', `同步失败：${error}`, serverResults);
                showMessage('媒体库同步失败，请查看页面诊断信息', 'error');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.renderLibrarySyncResult('error', `同步失败：${message}`, []);
            showMessage(`媒体库同步失败：${message}`, 'error');
        } finally {
            this.syncLibraryBtn.disabled = false;
        }
    }

    private renderLibrarySyncLoading(): void {
        this.syncStatusEl.className = 'emby-library-sync-status is-loading';
        this.syncStatusEl.textContent = '正在同步媒体库...';
    }

    private renderLibrarySyncSetupHint(): void {
        this.syncStatusEl.className = 'emby-library-sync-status is-warning';
        this.syncStatusEl.innerHTML = `
            <div class="emby-library-sync-summary">
                <i class="fas fa-exclamation-triangle"></i>
                <span>还没有可同步的媒体服务器</span>
            </div>
            <div class="emby-library-sync-hint">请先添加服务器并填写 API Key，确认启用后再同步媒体库。</div>
        `;
    }

    private renderLibrarySyncResult(kind: 'success' | 'error', summary: string, serverResults: LibrarySyncServerResult[]): void {
        this.syncStatusEl.className = `emby-library-sync-status is-${kind}`;
        const icon = kind === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
        const rows = serverResults.length > 0
            ? `<div class="emby-library-sync-servers">${serverResults.map((result) => this.renderLibrarySyncServerResult(result)).join('')}</div>`
            : '';
        this.syncStatusEl.innerHTML = `
            <div class="emby-library-sync-summary">
                <i class="fas ${icon}"></i>
                <span>${this.escapeHtml(summary)}</span>
            </div>
            ${rows}
        `;
    }

    private renderLibrarySyncServerResult(result: LibrarySyncServerResult): string {
        const success = result.success === true;
        const serverName = String(result.serverName || result.serverId || '未命名服务器');
        const serverType = String(result.serverType || 'media').toUpperCase();
        if (success) {
            return `
                <div class="emby-library-sync-server is-success">
                    <div class="emby-library-sync-server-title">
                        <span>${this.escapeHtml(serverName)}</span>
                        <span>${this.escapeHtml(serverType)}</span>
                    </div>
                    <div class="emby-library-sync-server-detail">读取 ${Number(result.itemCount || 0)} 个媒体条目，索引 ${Number(result.indexedCount || 0)} 个番号。</div>
                </div>
            `;
        }

        const diagnosis = this.getLibrarySyncDiagnosis(String(result.error || '同步失败'));
        return `
            <div class="emby-library-sync-server is-error">
                <div class="emby-library-sync-server-title">
                    <span>${this.escapeHtml(serverName)}</span>
                    <span>${this.escapeHtml(serverType)}</span>
                </div>
                <div class="emby-library-sync-server-problem">${this.escapeHtml(diagnosis.title)}</div>
                <div class="emby-library-sync-server-detail">${this.escapeHtml(diagnosis.description)}</div>
            </div>
        `;
    }

    private getLibrarySyncDiagnosis(error: string): LibrarySyncDiagnosis {
        const normalized = error.trim() || '同步失败';
        if (/API Key|401/i.test(normalized)) {
            return {
                title: 'API Key 可能无效',
                description: '请在媒体服务器后台重新生成 API Key，并确认当前服务器配置已填写最新密钥。',
            };
        }
        if (/超时|timeout|AbortError/i.test(normalized)) {
            return {
                title: '服务器连接超时',
                description: '请确认服务器地址可以从当前浏览器访问，反向代理或内网地址需要保持在线。',
            };
        }
        const httpStatus = normalized.match(/\((\d{3})\)/);
        if (httpStatus) {
            return {
                title: `服务器返回 HTTP ${httpStatus[1]}`,
                description: '请确认媒体服务器地址、端口、反向代理路径和账号权限是否正常。',
            };
        }
        if (/解析/i.test(normalized)) {
            return {
                title: '媒体服务器返回内容无法解析',
                description: '请确认配置的是 Emby/Jellyfin API 地址，不是网页登录页或反向代理错误页。',
            };
        }
        return {
            title: normalized,
            description: '请检查服务器地址、API Key、网络连通性和媒体服务器运行状态。',
        };
    }

    private normalizeLibrarySyncServerResults(value: unknown): LibrarySyncServerResult[] {
        if (!Array.isArray(value)) return [];
        return value
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map((item) => ({
                serverId: typeof item.serverId === 'string' ? item.serverId : undefined,
                serverType: typeof item.serverType === 'string' ? item.serverType : undefined,
                serverName: typeof item.serverName === 'string' ? item.serverName : undefined,
                success: item.success === true,
                itemCount: typeof item.itemCount === 'number' ? item.itemCount : Number(item.itemCount || 0),
                indexedCount: typeof item.indexedCount === 'number' ? item.indexedCount : Number(item.indexedCount || 0),
                error: typeof item.error === 'string' ? item.error : undefined,
            }));
    }

    private handleLibraryCheckKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.handleTestLibraryCheck();
    }

    private async handleTestLibraryCheck(): Promise<void> {
        const code = this.libraryCheckCodeInput.value.trim();
        if (!code) {
            showMessage('请输入要测试的番号', 'warning');
            this.libraryCheckCodeInput.focus();
            return;
        }

        if (!this.validateSettings()) return;
        await this.saveSettings();

        this.testLibraryCheckBtn.disabled = true;
        this.libraryCheckResultEl.className = 'emby-library-check-result is-loading';
        this.libraryCheckResultEl.textContent = '正在检测入库状态...';

        try {
            const response = await this.sendRuntimeMessage<LibraryCheckResponse>({
                type: 'EMBY_LIBRARY_CHECK_CODES',
                codes: [code],
            });

            if (!response?.success) {
                const error = response?.error || '检测失败';
                this.renderLibraryCheckError(`检测失败：${error}`);
                showMessage(`入库检测失败：${error}`, 'error');
                return;
            }

            this.renderLibraryCheckResult(response?.matches || {});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.renderLibraryCheckError(`检测失败：${message}`);
            showMessage(`入库检测失败：${message}`, 'error');
        } finally {
            this.testLibraryCheckBtn.disabled = false;
        }
    }

    private renderLibraryCheckResult(matchesByCode: Record<string, EmbyLibraryIndexEntry[]>): void {
        const entries = Object.entries(matchesByCode)
            .flatMap(([code, entries]) => (Array.isArray(entries) ? entries : []).map((entry) => ({ code, entry })));

        if (entries.length === 0) {
            this.libraryCheckResultEl.className = 'emby-library-check-result is-empty';
            this.libraryCheckResultEl.textContent = '未检测到入库记录';
            return;
        }

        this.libraryCheckResultEl.className = 'emby-library-check-result is-success';
        this.libraryCheckResultEl.innerHTML = `
            <div class="emby-library-check-summary">
                <i class="fas fa-check-circle"></i>
                已入库：命中 ${entries.length} 个媒体条目
            </div>
            <div class="emby-library-check-matches">
                ${entries.map(({ code, entry }) => this.renderLibraryCheckMatch(code, entry)).join('')}
            </div>
        `;
    }

    private renderLibraryCheckMatch(code: string, entry: EmbyLibraryIndexEntry): string {
        const href = buildMediaItemUrl(entry);
        const coverHtml = entry.coverImageUrl
            ? `<img class="emby-library-check-cover" src="${this.escapeHtml(entry.coverImageUrl)}" alt="" loading="lazy">`
            : '';
        const matchClass = entry.coverImageUrl ? 'emby-library-check-match has-cover' : 'emby-library-check-match';
        return `
            <a class="${matchClass}" href="${this.escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
                ${coverHtml}
                <span class="emby-library-check-server">${this.escapeHtml(entry.serverName || entry.serverType)}</span>
                <span class="emby-library-check-code">${this.escapeHtml(code)}</span>
                <span class="emby-library-check-title">${this.escapeHtml(entry.itemName || entry.itemId)}</span>
            </a>
        `;
    }

    private renderLibraryCheckError(message: string): void {
        this.libraryCheckResultEl.className = 'emby-library-check-result is-error';
        this.libraryCheckResultEl.textContent = message;
    }

    private getUrlsFromUI(): string[] {
        const inputs = this.matchUrlsList.querySelectorAll('.url-input') as NodeListOf<HTMLInputElement>;
        return Array.from(inputs).map(input => input.value.trim()).filter(url => url);
    }

    private updateEmbyConfigFromUI(): void {
        if (!STATE.settings.emby) {
            STATE.settings.emby = {
                enabled: false,
                matchUrls: [],
                videoCodePatterns: [
                    '[A-Z]{2,6}-\\d{2,6}',
                    'FC2-PPV-\\d+',
                    '\\d{4,8}_\\d{1,3}',
                    '\\d{6,12}',
                    '[a-z0-9]+-\\d+_\\d+'
                ],
                linkBehavior: 'javdb-search',
                enableAutoDetection: true,
                highlightStyle: {
                    backgroundColor: '#e3f2fd',
                    color: '#1976d2',
                    borderRadius: '4px',
                    padding: '2px 4px'
                },
                showQuickSearchCode: true,
                showQuickSearchActor: true,
                mediaServers: [],
                syncIntervalMinutes: 60,
                libraryStatus: {
                    enabled: false,
                    showOnList: true,
                    showOnDetail: true,
                },
                realtimeCheck: {
                    enabled: false,
                    concurrency: 1,
                    batchSize: 20,
                    cacheTtlMinutes: 10,
                },
            };
        }

        STATE.settings.emby.enabled = this.enabledToggle.checked;
        STATE.settings.emby.matchUrls = this.getUrlsFromUI();
        STATE.settings.emby.linkBehavior = this.linkBehaviorSelect.value as 'javdb-direct' | 'javdb-search';
        STATE.settings.emby.enableAutoDetection = true; // 始终启用
        STATE.settings.emby.showQuickSearchCode = this.showQuickSearchCodeToggle.checked;
        STATE.settings.emby.showQuickSearchActor = this.showQuickSearchActorToggle.checked;
        STATE.settings.emby.mediaServers = this.getMediaServersFromUI();
        STATE.settings.emby.syncIntervalMinutes = Math.max(5, Number(this.syncIntervalInput.value || 60));
        STATE.settings.emby.libraryStatus = {
            enabled: this.libraryStatusEnabledToggle.checked,
            showOnList: this.libraryShowListToggle.checked,
            showOnDetail: this.libraryShowDetailToggle.checked,
        };
        STATE.settings.emby.realtimeCheck = {
            ...(STATE.settings.emby.realtimeCheck || {}),
            enabled: this.realtimeCheckEnabledToggle.checked,
            concurrency: 1,
            batchSize: 20,
            cacheTtlMinutes: 10,
        };
    }

    private isValidUrlPattern(pattern: string): boolean {
        try {
            const regex = pattern.replace(/\*/g, '.*').replace(/\./g, '\\.');
            new RegExp(regex);
            return true;
        } catch {
            return false;
        }
    }

    private isValidServerUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    private sendRuntimeMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(response as TResponse);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    protected doGetSettings(): Partial<ExtensionSettings> {
        return { emby: STATE.settings.emby };
    }

    protected doSetSettings(settings: Partial<ExtensionSettings>): void {
        if (settings.emby) {
            STATE.settings.emby = { ...STATE.settings.emby, ...settings.emby };
        }
    }
}
