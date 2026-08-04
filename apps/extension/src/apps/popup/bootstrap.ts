/**
 * @file bootstrap.ts
 * @description bootstrap
 * @module apps/popup
 */
import { getSettings, saveSettings } from '../../utils/storage';
import type { ExtensionSettings } from '../../types';
import { getDisplayVersionInfo } from '../../shared/utils/versionInfo';
import { openOrFocusDashboardTab } from './dashboardTab';

const DOCS_URL = 'https://docs.we-together.club/';

// 安全获取设置，带重试机制
async function getSettingsSafely(maxRetries = 3): Promise<ExtensionSettings | null> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // 等待一小段时间，让 Service Worker 初始化
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
            }
            return await getSettings();
        } catch (error) {
            console.warn(`[Popup] Failed to get settings (attempt ${i + 1}/${maxRetries}):`, error);
            if (i === maxRetries - 1) {
                return null;
            }
        }
    }
    return null;
}

// 获取主题
async function getTheme(): Promise<'light' | 'dark'> {
    try {
        const result = await chrome.storage.local.get('theme_preference');
        const theme = result.theme_preference;
        if (theme === 'light' || theme === 'dark') {
            return theme;
        }
        return 'light';
    } catch (error) {
        console.error('[Popup] Failed to get theme:', error);
        return 'light';
    }
}

// 保存主题
async function saveTheme(theme: 'light' | 'dark'): Promise<void> {
    try {
        await chrome.storage.local.set({ theme_preference: theme });
        console.log('[Popup] Theme saved:', theme);
    } catch (error) {
        console.error('[Popup] Failed to save theme:', error);
        throw error;
    }
}

// 初始化主题
async function initTheme() {
    try {
        const theme = await getTheme();
        console.log('[Popup] Theme loaded:', theme);
        document.documentElement.setAttribute('data-theme', theme);
        console.log('[Popup] data-theme attribute set to:', document.documentElement.getAttribute('data-theme'));
        
        // 更新主题切换按钮图标
        updateThemeSwitcherIcon(theme);
        // 更新标题 logo
        updateTitleLogo(theme);
    } catch (error) {
        console.error('[Popup] Failed to init theme:', error);
        document.documentElement.setAttribute('data-theme', 'light');
        updateThemeSwitcherIcon('light');
        updateTitleLogo('light');
    }
}

// 监听storage变化，实现跨页面主题同步
function setupThemeSync() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.theme_preference) {
            const newTheme = changes.theme_preference.newValue;
            if (newTheme === 'light' || newTheme === 'dark') {
                console.log('[Popup] Theme changed from storage:', newTheme);
                document.documentElement.setAttribute('data-theme', newTheme);
                updateThemeSwitcherIcon(newTheme);
                updateTitleLogo(newTheme);
            }
        }
    });
}

// 更新主题切换按钮图标
function updateThemeSwitcherIcon(theme: 'light' | 'dark') {
    const themeSwitcherBtn = document.getElementById('theme-switcher-btn');
    const icon = themeSwitcherBtn?.querySelector('.theme-icon');
    
    if (icon) {
        if (theme === 'light') {
            icon.className = 'fas fa-sun theme-icon';
            themeSwitcherBtn!.title = '切换到深色模式';
        } else {
            icon.className = 'fas fa-moon theme-icon';
            themeSwitcherBtn!.title = '切换到浅色模式';
        }
    }
}

// 切换主题
async function toggleTheme() {
    const themeSwitcherBtn = document.getElementById('theme-switcher-btn');
    if (!themeSwitcherBtn) return;
    
    try {
        // 添加切换动画
        themeSwitcherBtn.classList.add('switching');
        
        // 获取当前主题
        const currentTheme = await getTheme();
        const newTheme: 'light' | 'dark' = currentTheme === 'light' ? 'dark' : 'light';
        
        // 保存新主题
        await saveTheme(newTheme);
        
        // 应用新主题
        document.documentElement.setAttribute('data-theme', newTheme);
        updateThemeSwitcherIcon(newTheme);
        updateTitleLogo(newTheme);
        
        console.log('[Popup] Theme switched to:', newTheme);
        
        // 移除动画类
        setTimeout(() => {
            themeSwitcherBtn.classList.remove('switching');
        }, 500);
    } catch (error) {
        console.error('[Popup] Failed to toggle theme:', error);
        themeSwitcherBtn.classList.remove('switching');
    }
}

function initVersionInfo() {
    const versionTag = document.getElementById('versionTag');
    if (versionTag) {
        let manifestVersion = '';
        try {
            manifestVersion = chrome?.runtime?.getManifest?.().version || '';
        } catch {}

        const versionInfo = getDisplayVersionInfo({
            manifestVersion,
            env: import.meta.env,
        });

        versionTag.textContent = `v${versionInfo.version}`;
    }
}

function updateTitleLogo(theme: 'light' | 'dark') {
    const img = document.getElementById('titleLogo') as HTMLImageElement | null;
    if (img) {
        const faviconPath = theme === 'dark'
            ? 'assets/favicons/dark/favicon-32x32.png'
            : 'assets/favicons/light/favicon-32x32.png';
        
        img.src = chrome.runtime.getURL(faviconPath);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const dashboardButton = document.getElementById('dashboard-button') as HTMLButtonElement;
    const popupLockBtn = document.getElementById('popup-lock-btn') as HTMLButtonElement;
    const themeSwitcherBtn = document.getElementById('theme-switcher-btn') as HTMLButtonElement;
    const helpBtn = document.getElementById('helpBtn') as HTMLButtonElement;
    const toggleWatchedContainer = document.getElementById('toggleWatchedContainer') as HTMLDivElement;
    const toggleViewedContainer = document.getElementById('toggleViewedContainer') as HTMLDivElement;
    const toggleVRContainer = document.getElementById('toggleVRContainer') as HTMLDivElement;
    const toggleWantContainer = document.getElementById('toggleWantContainer') as HTMLDivElement;
    const toggleHideBlacklistedActorsContainer = document.getElementById('toggleHideBlacklistedActorsContainer') as HTMLDivElement;
    const toggleHideNonFavoritedActorsContainer = document.getElementById('toggleHideNonFavoritedActorsContainer') as HTMLDivElement;
    const toggleHideUnrecognizedActorsContainer = document.getElementById('toggleHideUnrecognizedActorsContainer') as HTMLDivElement;
    const toggleTreatSubscribedContainer = document.getElementById('toggleTreatSubscribedContainer') as HTMLDivElement;
    const volumeSlider = document.getElementById('volumeSlider') as HTMLInputElement;
    const volumeValue = document.getElementById('volumeValue') as HTMLSpanElement;
    const muteBtn = document.getElementById('muteBtn') as HTMLButtonElement;
    const siteStatusTag = document.getElementById('site-status-tag') as HTMLSpanElement;
    const columnCountInput = document.getElementById('columnCountInput') as HTMLInputElement;
    const containerWidthSlider = document.getElementById('containerWidthSlider') as HTMLInputElement;
    const containerWidthValue = document.getElementById('containerWidthValue') as HTMLSpanElement;
    const resetListDisplayBtn = document.getElementById('resetListDisplayBtn') as HTMLButtonElement;

    // 检测当前网站可用性
    async function checkSiteAvailability() {
        if (!siteStatusTag) return;

        try {
            // 获取当前活动标签页
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];
            
            if (!currentTab?.url) {
                siteStatusTag.style.display = 'none';
                return;
            }

            const url = currentTab.url;
            
            // 检查是否是 JavDB 网站
            if (!url.includes('javdb')) {
                siteStatusTag.style.display = 'none';
                return;
            }

            // 显示标签并设置为检测中状态
            siteStatusTag.style.display = 'inline-flex';
            siteStatusTag.className = 'site-status-tag checking';
            siteStatusTag.querySelector('.status-text')!.textContent = '当前站点检测中';

            // 提取当前域名
            const urlObj = new URL(url);
            const currentDomain = `${urlObj.protocol}//${urlObj.host}`;

            // 尝试访问当前域名来检测可用性
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

            try {
                const response = await fetch(currentDomain, {
                    method: 'HEAD',
                    signal: controller.signal,
                    cache: 'no-cache'
                });
                
                clearTimeout(timeoutId);

                if (response.ok || response.status === 403 || response.status === 301 || response.status === 302) {
                    // 网站可访问（包括重定向和403，这些通常表示网站在线）
                    siteStatusTag.className = 'site-status-tag available';
                    siteStatusTag.querySelector('.status-text')!.textContent = '当前站点可用';
                    siteStatusTag.title = `当前线路 ${currentDomain} 可访问`;
                } else {
                    // 网站返回错误状态
                    siteStatusTag.className = 'site-status-tag unavailable';
                    siteStatusTag.querySelector('.status-text')!.textContent = '当前站点不可用';
                    siteStatusTag.title = `当前线路 ${currentDomain} 无法访问 (状态码: ${response.status})`;
                }
            } catch (error) {
                clearTimeout(timeoutId);
                
                // 网络错误或超时
                siteStatusTag.className = 'site-status-tag unavailable';
                siteStatusTag.querySelector('.status-text')!.textContent = '当前站点不可用';
                
                if (error instanceof Error && error.name === 'AbortError') {
                    siteStatusTag.title = `当前线路 ${currentDomain} 连接超时`;
                } else {
                    siteStatusTag.title = `当前线路 ${currentDomain} 无法访问`;
                }
            }
        } catch (error) {
            console.error('[Popup] 检测网站可用性失败:', error);
            if (siteStatusTag) {
                siteStatusTag.className = 'site-status-tag unknown';
                siteStatusTag.querySelector('.status-text')!.textContent = '站点状态未知';
                siteStatusTag.title = '无法检测网站状态';
            }
        }
    }

    // 初始化手动锁定按钮
    async function initPopupLockButton() {
        if (!popupLockBtn) return;

        try {
            const settings = await getSettingsSafely();
            
            // 只有在私密模式启用时才显示
            if (settings?.privacy?.privateMode?.enabled) {
                popupLockBtn.style.display = 'inline-flex';
            }

            // 点击锁定
            popupLockBtn.addEventListener('click', async () => {
                try {
                    // 发送锁定消息到background
                    chrome.runtime.sendMessage({ type: 'privacy-lock' }, (response) => {
                        // 检查 lastError
                        if (chrome.runtime.lastError) {
                            console.error('[Popup] Lock message error:', chrome.runtime.lastError);
                            alert('锁定失败，请重试');
                            return;
                        }
                        if (response?.success) {
                            window.close(); // 关闭popup
                        } else {
                            alert('锁定失败，请重试');
                        }
                    });
                } catch (error) {
                    console.error('[Popup] Failed to lock:', error);
                    alert('锁定失败，请重试');
                }
            });
        } catch (error) {
            console.error('[Popup] Failed to init popup lock button:', error);
        }
    }

    // Open Dashboard
    if (dashboardButton) {
        dashboardButton.title = '高级设置 & 数据管理';
        dashboardButton.addEventListener('click', () => {
            void openOrFocusDashboardTab({
                dashboardUrl: chrome.runtime.getURL('dashboard/dashboard.html'),
                tabs: chrome.tabs,
                windows: chrome.windows,
            }).catch((error) => {
                console.warn('[Popup] Failed to focus Dashboard tab, falling back to options page:', error);
                if (chrome.runtime.openOptionsPage) {
                    void chrome.runtime.openOptionsPage();
                } else {
                    window.open(chrome.runtime.getURL('dashboard/dashboard.html'));
                }
            });
        });
    }

    // 主题切换按钮
    if (themeSwitcherBtn) {
        themeSwitcherBtn.addEventListener('click', toggleTheme);
    }

    // Toggle Buttons
    async function createToggleButton(
        key: keyof ExtensionSettings['display'],
        container: HTMLElement,
        textShowing: string,
        textHiding: string,
        displayLabel: string
    ) {
        const button = document.createElement('button');
        button.className = 'toggle-button';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'toggle-label';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'toggle-icon';
        iconSpan.textContent = '✓';
        const textSpan = document.createElement('span');
        textSpan.textContent = displayLabel;
        labelSpan.append(iconSpan, textSpan);
        const switchSpan = document.createElement('span');
        switchSpan.className = 'toggle-switch';
        switchSpan.setAttribute('aria-hidden', 'true');
        button.replaceChildren(labelSpan, switchSpan);
        let settings: ExtensionSettings | null;

        const updateState = (isHiding: boolean) => {
            // isHiding=true means the feature is enabled (hiding content)
            // isHiding=false means the feature is disabled (showing content)
            const stateText = isHiding ? textHiding : textShowing;
            button.title = stateText;
            button.setAttribute('aria-label', `${displayLabel}，${stateText}`);
            button.setAttribute('aria-pressed', String(isHiding));
            button.classList.toggle('active', isHiding);
        };

        settings = await getSettingsSafely();
        if (settings) {
            updateState(!!settings.display[key]);
        }

        button.addEventListener('click', async () => {
            settings = await getSettingsSafely();
            if (!settings) {
                console.error('[Popup] Failed to get settings');
                return;
            }
            const current = !!settings.display[key];
            const newState = !current;
            (settings.display[key] as boolean) = newState;
            await saveSettings(settings);
            updateState(newState);

            // 发送消息通知内容脚本设置已更新
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.url?.includes('javdb')) {
                    if (tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, { type: 'settings-updated' });
                        // 仍然刷新页面以确保所有更改生效
                        chrome.tabs.reload(tabs[0].id);
                    }
                }
            });
        });

        container.innerHTML = '';
        container.appendChild(button);
    }

    // ListEnhancement Toggle Buttons
    async function createListEnhancementToggle(
        key: keyof ExtensionSettings['listEnhancement'],
        container: HTMLElement,
        textTrue: string,
        textFalse: string,
        displayLabel: string
    ) {
        const button = document.createElement('button');
        button.className = 'toggle-button';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'toggle-label';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'toggle-icon';
        iconSpan.textContent = '✓';
        const textSpan = document.createElement('span');
        textSpan.textContent = displayLabel;
        labelSpan.append(iconSpan, textSpan);
        const switchSpan = document.createElement('span');
        switchSpan.className = 'toggle-switch';
        switchSpan.setAttribute('aria-hidden', 'true');
        button.replaceChildren(labelSpan, switchSpan);

        const updateState = (flag: boolean) => {
            const stateText = flag ? textTrue : textFalse;
            button.title = stateText;
            button.setAttribute('aria-label', `${displayLabel}，${stateText}`);
            button.setAttribute('aria-pressed', String(flag));
            button.classList.toggle('active', flag);
        };

        let settings = await getSettingsSafely();
        if (settings) {
            const current = !!(settings.listEnhancement as any)?.[key];
            updateState(current);
        }

        button.addEventListener('click', async () => {
            settings = await getSettingsSafely();
            if (!settings) {
                console.error('[Popup] Failed to get settings');
                return;
            }
            if (!settings.listEnhancement) {
                settings.listEnhancement = {
                    enabled: true,
                    enableClickEnhancement: true,
                    enableVideoPreview: true,
                    enableScrollPaging: false,
                    enableListOptimization: true,
                    previewDelay: 1000,
                    previewVolume: 0.2,
                    enableRightClickBackground: true,
                } as any;
            }
            const currentVal = !!(settings.listEnhancement as any)[key];
            (settings.listEnhancement as any)[key] = !currentVal;
            await saveSettings(settings);
            updateState(!currentVal);

            // 通知内容脚本设置已更新（并刷新当前tab，保持与现有逻辑一致）
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.url?.includes('javdb')) {
                    if (tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, { type: 'settings-updated' });
                        chrome.tabs.reload(tabs[0].id);
                    }
                }
            });
        });

        container.innerHTML = '';
        container.appendChild(button);
    }

    // Help Panel
    function setupHelpPanel() {
        helpBtn.addEventListener('click', () => {
            window.open(DOCS_URL, '_blank');
        });
    }
    
    // Volume Control
    async function setupVolumeControl() {
        // 从设置对象中获取当前音量设置
        const settings = await getSettingsSafely();
        if (!settings) {
            console.error('[Popup] Failed to get settings for volume control');
            return;
        }
        // 使用 ?? 而不是 || 来处理 0 值
        const currentVolumeFloat = settings.listEnhancement?.previewVolume ?? 0.2;
        const currentVolume = Math.round(currentVolumeFloat * 100);
        
        console.log('[Popup] Initial volume from settings:', currentVolumeFloat, 'display:', currentVolume);

        // 更新滑块和显示值
        volumeSlider.value = currentVolume.toString();
        volumeValue.textContent = `${currentVolume}%`;

        // 更新静音按钮图标
        const updateMuteIcon = (volume: number) => {
            const icon = muteBtn.querySelector('i');
            if (!icon) return;
            
            if (volume === 0) {
                icon.className = 'fas fa-volume-xmark';
                muteBtn.title = '取消静音';
            } else if (volume <= 33) {
                icon.className = 'fas fa-volume-low';
                muteBtn.title = '静音';
            } else if (volume <= 66) {
                icon.className = 'fas fa-volume-low';
                muteBtn.title = '静音';
            } else {
                icon.className = 'fas fa-volume-high';
                muteBtn.title = '静音';
            }
        };

        updateMuteIcon(currentVolume);

        // 保存静音前的音量
        let volumeBeforeMute = currentVolume > 0 ? currentVolume : 50;

        // 静音按钮点击事件
        muteBtn.addEventListener('click', async () => {
            const currentVol = parseInt(volumeSlider.value);
            console.log('[Popup] Mute button clicked, current volume:', currentVol);
            
            if (currentVol === 0) {
                // 取消静音，恢复之前的音量
                const restoreVolume = volumeBeforeMute > 0 ? volumeBeforeMute : 50;
                console.log('[Popup] Unmuting, restore to:', restoreVolume);
                
                volumeSlider.value = restoreVolume.toString();
                volumeValue.textContent = `${restoreVolume}%`;
                updateMuteIcon(restoreVolume);
                
                // 保存设置
                const currentSettings = await getSettingsSafely();
                if (currentSettings?.listEnhancement) {
                    currentSettings.listEnhancement.previewVolume = restoreVolume / 100;
                    await saveSettings(currentSettings);
                    console.log('[Popup] Settings saved, volume:', restoreVolume / 100);
                    
                    // 通知内容脚本
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]?.url?.includes('javdb') && tabs[0].id) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                type: 'volume-changed',
                                volume: restoreVolume / 100
                            });
                        }
                    });
                }
            } else {
                // 静音
                volumeBeforeMute = currentVol;
                console.log('[Popup] Muting, save current volume:', volumeBeforeMute);
                
                volumeSlider.value = '0';
                volumeValue.textContent = '0%';
                updateMuteIcon(0);
                
                // 保存设置
                const currentSettings = await getSettingsSafely();
                if (currentSettings?.listEnhancement) {
                    currentSettings.listEnhancement.previewVolume = 0;
                    await saveSettings(currentSettings);
                    console.log('[Popup] Settings saved, volume: 0');
                    
                    // 通知内容脚本
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]?.url?.includes('javdb') && tabs[0].id) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                type: 'volume-changed',
                                volume: 0
                            });
                        }
                    });
                }
            }
        });

        // 监听滑块变化 - 使用防抖来避免频繁保存
        let saveTimeout: number | null = null;
        volumeSlider.addEventListener('input', (e) => {
            const volume = parseInt((e.target as HTMLInputElement).value);
            console.log('[Popup] Slider input, volume:', volume);
            volumeValue.textContent = `${volume}%`;
            updateMuteIcon(volume);

            // 如果用户手动调整音量到非0，更新volumeBeforeMute
            if (volume > 0) {
                volumeBeforeMute = volume;
            }

            // 清除之前的定时器
            if (saveTimeout !== null) {
                clearTimeout(saveTimeout);
            }

            // 延迟保存，避免频繁写入
            saveTimeout = window.setTimeout(async () => {
                console.log('[Popup] Saving volume after input:', volume);
                // 获取当前设置并更新音量
                const currentSettings = await getSettingsSafely();
                if (!currentSettings) {
                    console.error('[Popup] Failed to get settings for volume update');
                    return;
                }
                if (!currentSettings.listEnhancement) {
                    currentSettings.listEnhancement = {
                        enabled: true,
                        enableClickEnhancement: true,
                        enableVideoPreview: true,
                        enableScrollPaging: false,
                        enableListOptimization: true,
                        previewDelay: 1000,
                        previewVolume: 0.2,
                        enableRightClickBackground: true
                    };
                }
                currentSettings.listEnhancement.previewVolume = volume / 100;

                // 保存设置
                await saveSettings(currentSettings);
                console.log('[Popup] Settings saved from slider, volume:', volume / 100);

                // 通知内容脚本音量已更改
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.url?.includes('javdb')) {
                        if (tabs[0].id) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                type: 'volume-changed',
                                volume: volume / 100
                            });
                        }
                    }
                });
            }, 300); // 300ms 防抖
        });
    }

    // List Display Control
    async function setupListDisplayControl() {
        const settings = await getSettingsSafely();
        if (!settings) {
            console.error('[Popup] Failed to get settings for list display control');
            return;
        }

        // 获取当前配置
        const control = settings.listEnhancement?.listDisplayControl || {
            enabled: true,
            columnCount: 4,
            containerWidth: 100,
            enableContainerExpansion: false,
        };

        console.log('[Popup] Initial list display control:', control);

        // 更新输入框的值
        columnCountInput.value = control.columnCount.toString();
        containerWidthSlider.value = control.containerWidth.toString();
        containerWidthValue.textContent = `${control.containerWidth}%`;

        // 列数输入框变化事件（支持滚轮）
        let columnCountTimeout: number | null = null;
        const updateColumnCount = async (count: number) => {
            // 限制范围1-8
            count = Math.max(1, Math.min(8, count));
            console.log('[Popup] Column count changed:', count);
            columnCountInput.value = count.toString();

            // 获取当前容器扩展开关状态
            const currentSettings = await getSettingsSafely();
            const enableContainerExpansion = currentSettings?.listEnhancement?.listDisplayControl?.enableContainerExpansion === true;

            // 根据列数和容器扩展状态计算最大宽度限制
            let maxWidth: number;
            
            if (enableContainerExpansion) {
                // 容器扩展开启：搜索框和容器都是100%宽度
                // 公式：最大宽度 = 100 * 列数 / (列数 - 0.3)
                // 缩小范围，避免超出太多
                maxWidth = Math.floor(100 * count / (count - 0.3));
                console.log('[Popup] Container expansion enabled, max width:', maxWidth);
            } else {
                // 容器扩展关闭：搜索框和容器保持 Bulma 默认宽度（约1344px）
                // 允许更大的宽度范围，公式：最大宽度 = 100 * 列数 / (列数 - 0.8)
                maxWidth = Math.floor(100 * count / (count - 0.8));
                // 4-8列额外增加10%
                if (count >= 4 && count <= 8) {
                    maxWidth = Math.floor(maxWidth * 1.1);
                }
                console.log('[Popup] Container expansion disabled, max width:', maxWidth);
            }
            
            // 更新滑块的最大值
            containerWidthSlider.max = maxWidth.toString();
            
            console.log('[Popup] Max width updated to:', maxWidth, 'for column count:', count, 'expansion:', enableContainerExpansion);
            
            // 如果当前宽度超过新的最大值，调整到最大值
            const currentWidth = parseInt(containerWidthSlider.value);
            if (currentWidth > maxWidth) {
                containerWidthSlider.value = maxWidth.toString();
                containerWidthValue.textContent = `${maxWidth}%`;
                console.log('[Popup] Width adjusted to max:', maxWidth);
            }

            if (columnCountTimeout !== null) {
                clearTimeout(columnCountTimeout);
            }

            columnCountTimeout = window.setTimeout(async () => {
                console.log('[Popup] Saving column count:', count);
                const currentSettings = await getSettingsSafely();
                if (!currentSettings) {
                    console.error('[Popup] Failed to get settings for column count update');
                    return;
                }
                if (!currentSettings.listEnhancement) {
                    currentSettings.listEnhancement = {
                        enabled: true,
                        enableClickEnhancement: true,
                        enableVideoPreview: true,
                        enableScrollPaging: false,
                        enableListOptimization: true,
                        previewDelay: 1000,
                        previewVolume: 0.2,
                        enableRightClickBackground: true
                    };
                }
                if (!currentSettings.listEnhancement.listDisplayControl) {
                    currentSettings.listEnhancement.listDisplayControl = {
                        enabled: true,
                        columnCount: 4,
                        containerWidth: 100,
                        enableContainerExpansion: false
                    };
                }
                currentSettings.listEnhancement.listDisplayControl.columnCount = count;

                await saveSettings(currentSettings);
                console.log('[Popup] Column count saved:', count);

                // 通知内容脚本
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.url?.includes('javdb') && tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: 'settings-updated'
                        });
                    }
                });
            }, 300);
        };

        // 输入框输入事件
        columnCountInput.addEventListener('input', (e) => {
            const count = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(count)) {
                updateColumnCount(count);
            }
        });

        // 初始化时也要设置最大值（根据容器扩展状态）
        const enableContainerExpansion = control.enableContainerExpansion === true;
        let initialMaxWidth: number;
        
        if (enableContainerExpansion) {
            // 容器扩展开启时的最大宽度（更保守）
            initialMaxWidth = Math.floor(100 * control.columnCount / (control.columnCount - 0.3));
        } else {
            // 容器扩展关闭时，允许更大范围，公式：最大宽度 = 100 * 列数 / (列数 - 0.8)
            initialMaxWidth = Math.floor(100 * control.columnCount / (control.columnCount - 0.8));
            // 4-8列额外增加10%
            if (control.columnCount >= 4 && control.columnCount <= 8) {
                initialMaxWidth = Math.floor(initialMaxWidth * 1.1);
            }
        }
        
        containerWidthSlider.max = initialMaxWidth.toString();
        console.log('[Popup] Initial max width set to:', initialMaxWidth, 'for column count:', control.columnCount, 'expansion:', enableContainerExpansion);
        
        // 如果当前宽度超过最大值，调整到最大值
        if (control.containerWidth > initialMaxWidth) {
            containerWidthSlider.value = initialMaxWidth.toString();
            containerWidthValue.textContent = `${initialMaxWidth}%`;
            console.log('[Popup] Initial width adjusted to max:', initialMaxWidth);
        }

        // 容器宽度变化事件
        let containerWidthTimeout: number | null = null;
        const updateContainerWidth = async (width: number) => {
            console.log('[Popup] Container width changed:', width);
            containerWidthSlider.value = width.toString();
            containerWidthValue.textContent = `${width}%`;

            if (containerWidthTimeout !== null) {
                clearTimeout(containerWidthTimeout);
            }

            containerWidthTimeout = window.setTimeout(async () => {
                console.log('[Popup] Saving container width:', width);
                const currentSettings = await getSettingsSafely();
                if (!currentSettings) {
                    console.error('[Popup] Failed to get settings for container width update');
                    return;
                }
                if (!currentSettings.listEnhancement) {
                    currentSettings.listEnhancement = {
                        enabled: true,
                        enableClickEnhancement: true,
                        enableVideoPreview: true,
                        enableScrollPaging: false,
                        enableListOptimization: true,
                        previewDelay: 1000,
                        previewVolume: 0.2,
                        enableRightClickBackground: true
                    };
                }
                if (!currentSettings.listEnhancement.listDisplayControl) {
                    currentSettings.listEnhancement.listDisplayControl = {
                        enabled: true,
                        columnCount: 4,
                        containerWidth: 100,
                        enableContainerExpansion: false
                    };
                }
                currentSettings.listEnhancement.listDisplayControl.containerWidth = width;

                await saveSettings(currentSettings);
                console.log('[Popup] Container width saved:', width);

                // 通知内容脚本
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.url?.includes('javdb') && tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: 'settings-updated'
                        });
                    }
                });
            }, 300);
        };

        containerWidthSlider.addEventListener('input', (e) => {
            const width = parseInt((e.target as HTMLInputElement).value);
            updateContainerWidth(width);
        });

        // 还原按钮点击事件
        if (resetListDisplayBtn) {
            resetListDisplayBtn.addEventListener('click', async () => {
                console.log('[Popup] Reset list display control to default');
                
                // 默认值：列数4，宽度100
                const defaultColumnCount = 4;
                const defaultContainerWidth = 100;
                
                // 更新UI
                columnCountInput.value = defaultColumnCount.toString();
                containerWidthSlider.value = defaultContainerWidth.toString();
                containerWidthValue.textContent = `${defaultContainerWidth}%`;
                
                // 保存到设置
                const currentSettings = await getSettingsSafely();
                if (!currentSettings) {
                    console.error('[Popup] Failed to get settings for reset');
                    return;
                }
                if (!currentSettings.listEnhancement) {
                    currentSettings.listEnhancement = {
                        enabled: true,
                        enableClickEnhancement: true,
                        enableVideoPreview: true,
                        enableScrollPaging: false,
                        enableListOptimization: true,
                        previewDelay: 1000,
                        previewVolume: 0.2,
                        enableRightClickBackground: true
                    };
                }
                if (!currentSettings.listEnhancement.listDisplayControl) {
                    currentSettings.listEnhancement.listDisplayControl = {
                        enabled: true,
                        columnCount: defaultColumnCount,
                        containerWidth: defaultContainerWidth,
                        enableContainerExpansion: false
                    };
                } else {
                    currentSettings.listEnhancement.listDisplayControl.columnCount = defaultColumnCount;
                    currentSettings.listEnhancement.listDisplayControl.containerWidth = defaultContainerWidth;
                }
                
                await saveSettings(currentSettings);
                console.log('[Popup] List display control reset to default');
                
                // 通知内容脚本
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.url?.includes('javdb') && tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: 'settings-updated'
                        });
                    }
                });
            });
        }
    }

    // Initializer Function
    async function initialize() {
        createToggleButton('hideViewed', toggleWatchedContainer, '显示已看的作品', '隐藏已看的作品', '隐藏已看');
        createToggleButton('hideBrowsed', toggleViewedContainer, '显示已浏览的作品', '隐藏已浏览的作品', '隐藏已浏览');
        createToggleButton('hideVR', toggleVRContainer, '显示VR作品', '隐藏VR作品', '隐藏 VR');
        createToggleButton('hideWant', toggleWantContainer, '显示想看的作品', '隐藏想看的作品', '隐藏想看');

        // 演员过滤开关（列表）
        await createListEnhancementToggle('hideBlacklistedActorsInList', toggleHideBlacklistedActorsContainer, '隐藏含黑名单演员', '显示含黑名单演员', '黑名单演员');
        await createListEnhancementToggle('hideNonFavoritedActorsInList', toggleHideNonFavoritedActorsContainer, '隐藏未收藏演员的作品', '显示未收藏演员的作品', '未收藏演员');
        await createListEnhancementToggle('hideUnrecognizedActorsInList', toggleHideUnrecognizedActorsContainer, '隐藏无法识别演员的作品', '显示无法识别演员的作品', '无法识别');
        await createListEnhancementToggle('treatSubscribedAsFavorited', toggleTreatSubscribedContainer, '订阅视为收藏', '订阅不视为收藏', '订阅视为收藏');

        await setupVolumeControl();
        await setupListDisplayControl();
        await initPopupLockButton();

        setupHelpPanel();
    }

    await initTheme();
    setupThemeSync(); // 设置主题同步监听
    initialize();
    initVersionInfo();
    
    // 检测网站可用性
    checkSiteAvailability();
});
