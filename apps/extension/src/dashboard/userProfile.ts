import { logAsync } from './logger';
import { showMessage } from './ui/toast';
import type { UserProfile } from '../types';
import { userService } from './services/userService';
import { emit } from './services/eventBus';
import { getSettings, saveSettings } from '../utils/storage';
import { getDrive115V2Service, type Drive115V2UserInfo, type Drive115V2QuotaInfo } from '../features/drive115/v2';
import { describe115Error } from '../features/drive115/v2/errorCodes';
import { showToast } from '../platform/browser/toast';
import { normalizeDrive115Settings, isDrive115EnabledState } from '../features/drive115/app';
import { buildDrive115UserInfoFailureCopy } from './userProfileDrive115Feedback';
import { getJavDBRoute } from '../features/routeManagement';

// 115 加载并发保护
let isLoadingDrive115 = false;

// 重新导出用户服务的方法，保持向后兼容
export const fetchUserProfile = () => userService.fetchUserProfile();
export const saveUserProfile = (profile: UserProfile) => userService.saveUserProfile(profile);
export const getUserProfile = () => userService.getUserProfile();
export const clearUserProfile = () => userService.clearUserProfile();


// 本地“刚刚同步”覆盖：用于在刷新后1分钟内仍显示“刚刚同步”
const LOCAL_SYNC_OVERRIDE_UNTIL = 'userProfile:serverSyncLocalOverrideUntil';
let _syncOverrideTimer: number | null = null;

function scheduleSyncOverrideExpiry(): void {
    try {
        const until = Number(localStorage.getItem(LOCAL_SYNC_OVERRIDE_UNTIL) || '0') || 0;
        if (!until) return;
        const now = Date.now();
        const msLeft = until - now;
        if (msLeft <= 0) {
            // 已过期，立即清理并刷新文案
            localStorage.removeItem(LOCAL_SYNC_OVERRIDE_UNTIL);
            getUserProfile().then(latest => updateServerStats(latest?.serverStats)).catch(() => {});
            return;
        }
        if (_syncOverrideTimer) {
            clearTimeout(_syncOverrideTimer);
            _syncOverrideTimer = null;
        }
        _syncOverrideTimer = window.setTimeout(() => {
            try { localStorage.removeItem(LOCAL_SYNC_OVERRIDE_UNTIL); } catch {}
            getUserProfile().then(latest => updateServerStats(latest?.serverStats)).catch(() => {});
            _syncOverrideTimer = null;
        }, msLeft);
    } catch {}
}


/**
 * 初始化用户账号信息区域
 */
export function initUserProfileSection(): void {
    const container = document.getElementById('user-profile-section');
    if (!container) return;

    // 添加登录按钮和用户信息显示区域
    container.innerHTML = `
        <div class="user-profile-container">
            <h4 class="user-profile-card-title">账号信息</h4>
            <div id="user-profile-info" class="user-profile-info" style="display: none;">
                <div class="user-basic-info">
                    <div class="user-details">
                        <div class="user-top-row">
                            <div class="user-identity user-identity--primary">
                                <i class="fas fa-user"></i>
                                <span id="user-name-text" data-sensitive>-</span>
                            </div>
                            <div class="user-actions">
                                <button id="refresh-profile-btn" class="refresh-btn" title="刷新账号信息">
                                    <i class="fas fa-sync-alt"></i>
                                </button>
                                <button id="logout-btn" class="logout-btn" title="退出登录">
                                    <i class="fas fa-sign-out-alt"></i>
                                </button>
                            </div>
                        </div>
                        <div class="user-meta-row">
                            <div class="user-type-badge">
                                <i class="fas fa-crown"></i>
                                <span id="user-type-text">-</span>
                            </div>
                            <span id="user-email-badge" class="user-email-badge" data-sensitive title="邮箱：-">
                                <i class="fas fa-envelope"></i>
                                <span class="badge-text">邮箱</span>
                            </span>
                        </div>
                    </div>
                </div>
                <div class="user-server-stats" id="user-server-stats" style="display: none;">
                    <div class="stats-title">
                        <i class="fas fa-server"></i>
                        <span>服务器数据</span>
                        <i class="fas fa-question-circle" title="仅数量展示，不具有完整数据同步功能；完整数据同步请前往“数据同步”页面进行操作"></i>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-item want-stat">
                            <i class="fas fa-star"></i>
                            <div class="stat-content">
                                <span class="stat-label">想看</span>
                                <span class="stat-value" id="server-want-count">-</span>
                            </div>
                        </div>
                        <div class="stat-item watched-stat">
                            <i class="fas fa-check"></i>
                            <div class="stat-content">
                                <span class="stat-label">看过</span>
                                <span class="stat-value" id="server-watched-count">-</span>
                            </div>
                        </div>
                    </div>
                    <div class="stats-sync-time">
                        <i class="fas fa-clock"></i>
                        <span id="stats-sync-time-text">-</span>
                    </div>
                </div>
            </div>
            <div id="user-login-prompt" class="user-login-prompt">
                <div class="login-icon">
                    <i class="fas fa-user-slash"></i>
                </div>
                <div class="login-text">
                    <p>未登录 JavDB 账号</p>
                    <p class="login-notice">登录信息仅用于同步数据使用</p>
                    <button id="login-btn" class="login-btn">
                        <i class="fas fa-sign-in-alt"></i>
                        登录获取账号信息
                    </button>
                </div>
            </div>
        </div>
        <!-- 115 用户信息独立容器（与 JavDB 并列） -->
<div class="drive115-profile-container" style="margin-top:10px;">
            <!-- 未启用/未登录提示 -->
            <div id="drive115-empty-state" class="user-login-prompt" style="display:none; justify-content:center; text-align:center;">
                <div class="login-icon">
                    <img src="../assets/115-logo.svg" alt="115" style="width:32px;height:32px;opacity:0.5;"/>
                </div>
                <div class="login-text" style="text-align:center;">
                    <p style="margin:0 0 8px 0; font-size:14px; color:var(--drive115-title-color); font-weight:500;">未配置 115 网盘账号</p>
                    <p style="margin:0 0 12px 0; font-size:12px; color:var(--text-secondary); font-weight:400;">配置后可使用一键推送等功能</p>
                    <button id="drive115-goto-settings" class="login-btn" style="margin:0 auto;">
                        <i class="fas fa-cog"></i>
                        前往设置
                    </button>
                </div>
            </div>
            <!-- 已登录状态 -->
            <div id="drive115-user-info" class="drive115-user-info" style="display:none;">
                <div class="stats-title" style="display:flex; align-items:center; gap:6px;">
                    <img src="../assets/115-logo.svg" alt="115" style="width:16px;height:16px;"/>
                    <span>115 账号</span>
                    <span id="drive115-user-status" style="margin-left:auto; font-size:12px; color:#888;"></span>
                    <button id="drive115-refresh-btn" class="refresh-btn" title="刷新 115 账号信息" style="margin-left:8px;">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
                <div id="drive115-user-box" class="card" style="padding:8px; border:1px solid #eee; border-radius:6px; margin-top:6px;">
                    <p style="margin:0; color:#888;">未加载</p>
                </div>
            </div>
        </div>
    `;

    // 绑定事件
    bindUserProfileEvents();
    
    // 加载已保存的用户信息
    loadUserProfile();
    // 加载 115 用户信息（仅渲染缓存，不触发网络刷新）
    loadDrive115UserInfo({ allowNetwork: false });
    // 页面初始化时，如果存在“刚刚同步”的本地覆盖，则安排在到期时自动恢复相对时间
    scheduleSyncOverrideExpiry();
}

/**
 * 绑定用户账号相关事件
 */
function bindUserProfileEvents(): void {
    const loginBtn = document.getElementById('login-btn');
    const refreshBtn = document.getElementById('refresh-profile-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const drive115RefreshBtn = document.getElementById('drive115-refresh-btn');
    const drive115GotoSettingsBtn = document.getElementById('drive115-goto-settings');

    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', handleRefresh);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    if (drive115RefreshBtn) {
        drive115RefreshBtn.addEventListener('click', handleDrive115Refresh);
    }

    if (drive115GotoSettingsBtn) {
        drive115GotoSettingsBtn.addEventListener('click', () => {
            // 使用 hash 导航到设置页面的 115 网盘设置
            window.location.hash = '#tab-settings/drive115-settings';
        });
    }

    // 监听来自设置页的用户信息刷新事件（settings 页刷新后同步更新侧边栏）
    window.addEventListener('drive115:refreshUserInfo', () => {
        loadDrive115UserInfo({ allowNetwork: true });
    });
}

/**
 * 处理登录按钮点击
 */
async function handleLogin(): Promise<void> {
    const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
    if (!loginBtn) return;

    try {
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 获取中...';
        
        const profile = await fetchUserProfile();
        if (profile && profile.email && profile.email.trim()) {
            // 成功获取到邮箱，说明登录成功
            await saveUserProfile(profile);
            displayUserProfile(profile);
            showMessage('账号信息获取成功！', 'success');

            // 发送用户登录状态变化事件
            emit('user-login-status-changed', {
                isLoggedIn: true,
                profile
            });
        } else if (profile && (!profile.email || !profile.email.trim())) {
            // 获取到了 profile 但没有邮箱，说明可能未登录或信息不完整
            showMessage('未能获取完整账号信息，请确保已在 JavDB 登录', 'warning');
        } else {
            await openJavDBLoginPage();
            showMessage('已打开 JavDB 登录页，请登录后再次点击此按钮', 'info');
        }
    } catch (error: any) {
        showMessage('获取账号信息时发生错误', 'error');
        logAsync('ERROR', '登录处理失败', { error: error.message });
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 登录获取账号信息';
    }
}

async function openJavDBLoginPage(): Promise<void> {
    let loginUrl = 'https://javdb.com/login';
    try {
        const route = await getJavDBRoute();
        const origin = new URL(route).origin;
        loginUrl = `${origin}/login`;
    } catch {
        // 线路读取失败时使用主域名登录页。
    }

    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url: loginUrl, active: true });
        return;
    }

    window.open(loginUrl, '_blank', 'noopener,noreferrer');
}

/**
 * 处理刷新按钮点击
 */
async function handleRefresh(): Promise<void> {
    const refreshBtn = document.getElementById('refresh-profile-btn') as HTMLButtonElement;
    if (!refreshBtn) return;

    try {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const profile = await fetchUserProfile();
        if (profile && profile.email && profile.email.trim()) {
            // 成功获取到邮箱，说明刷新成功
            await saveUserProfile(profile);
            displayUserProfile(profile);
            showMessage('账号信息已更新', 'success');

            // 刷新完成后，立即更新左侧“服务器数据”的刷新时间显示，避免仍显示旧的“X天前”
            try {
                // 设置1分钟的本地覆盖，页面刷新也生效
                localStorage.setItem(LOCAL_SYNC_OVERRIDE_UNTIL, String(Date.now() + 60_000));
                const syncTimeElement = document.getElementById('stats-sync-time-text');
                if (syncTimeElement) {
                    syncTimeElement.textContent = '刚刚同步';
                }
                // 1分钟后恢复相对时间显示
                setTimeout(async () => {
                    try { localStorage.removeItem(LOCAL_SYNC_OVERRIDE_UNTIL); } catch {}
                    try {
                        const latest = await getUserProfile();
                        updateServerStats(latest?.serverStats);
                    } catch {}
                }, 60_000);
            } catch {}
        } else if (profile && (!profile.email || !profile.email.trim())) {
            // 获取到了 profile 但没有邮箱
            showMessage('未能获取完整账号信息，请确保已在 JavDB 登录', 'warning');
        } else {
            // 可能是未登录或被风控拦截，给出更明确的提示
            showMessage('刷新账号信息失败：请先在 JavDB 登录后再试；如已登录仍失败，可能触发安全防护，请稍后重试', 'error');
        }
        // 同步刷新 115 用户信息（不触发网络刷新，仅更新缓存展示）
        await loadDrive115UserInfo({ allowNetwork: false });
    } catch (error: any) {
        showMessage('刷新账号信息时发生错误：请确认已登录 JavDB，或稍后再试', 'error');
        logAsync('ERROR', '刷新处理失败', { error: error.message });
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }
}
/**
 * 处理 115 刷新按钮点击
 */
async function handleDrive115Refresh(): Promise<void> {
  const btn = document.getElementById('drive115-refresh-btn') as HTMLButtonElement | null;
  if (!btn) return;
  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    await loadDrive115UserInfo({ allowNetwork: true }); // 仅手动触发时允许网络刷新
    // 由 loadDrive115UserInfo 内部负责根据结果展示成功/失败/提示，避免重复或误导性提示
    // 刷新完成后，触发侧栏配额的刷新以保持 UI 一致
    try {
    } catch {}
  } catch (error: any) {
    const msg = describe115Error(error) || error?.message || '刷新 115 账号信息时发生错误';
    showToast(msg, 'error');
    logAsync('ERROR', '115 刷新处理失败', { error: error?.message });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
  }
}

/**
 * 处理退出登录按钮点击
 */
async function handleLogout(): Promise<void> {
    try {
        await clearUserProfile();
        showLoginPrompt();
        showMessage('已退出登录', 'info');

        // 发送用户退出登录事件
        emit('user-logout', {});
        emit('user-login-status-changed', {
            isLoggedIn: false
        });
    } catch (error: any) {
        showMessage('退出登录时发生错误', 'error');
        logAsync('ERROR', '退出登录失败', { error: error.message });
    }
}

/**
 * 加载并显示用户账号信息
 */
async function loadUserProfile(): Promise<void> {
    try {
        const profile = await getUserProfile();
        if (profile && profile.isLoggedIn) {
            displayUserProfile(profile);
        } else {
            showLoginPrompt();
        }
    } catch (error: any) {
        logAsync('ERROR', '加载用户账号信息失败', { error: error.message });
        showLoginPrompt();
    }
}

/**
 * 显示用户账号信息
 */
function displayUserProfile(profile: UserProfile): void {
    const infoContainer = document.getElementById('user-profile-info');
    const loginPrompt = document.getElementById('user-login-prompt');

    if (!infoContainer || !loginPrompt) return;

    // 更新用户信息
    const emailBadge = document.getElementById('user-email-badge');
    const nameElement = document.getElementById('user-name-text');
    const typeElement = document.getElementById('user-type-text');

    // 兜底显示（后端未解析出时，避免显示 “-”）
    const emailText = (profile.email && profile.email.trim()) ? profile.email : '未公开';
    const usernameText = (profile.username && profile.username.trim()) ? profile.username : 'JavDB 账号';
    const userTypeText = (profile.userType && profile.userType.trim()) ? profile.userType : '已登录';

    if (emailBadge) {
        emailBadge.setAttribute('title', `邮箱：${emailText}`);
        emailBadge.setAttribute('aria-label', `邮箱：${emailText}`);
        const emailTextElement = emailBadge.querySelector<HTMLElement>('.badge-text');
        if (emailTextElement) emailTextElement.textContent = emailText;
    }
    if (nameElement) nameElement.textContent = usernameText;
    if (typeElement) typeElement.textContent = userTypeText;

    // 更新服务器统计数据
    updateServerStats(profile.serverStats);

    // 显示用户信息，隐藏登录提示
    infoContainer.style.display = 'block';
    loginPrompt.style.display = 'none';

    // 刷新数据同步区域
    refreshDataSyncSection();
    // 自动展示 115 用户信息的缓存（不阻塞，不触发网络刷新）
    setTimeout(() => { loadDrive115UserInfo({ allowNetwork: false }); }, 0);
}

/**
 * 更新服务器统计数据显示
 */
function updateServerStats(serverStats?: any): void {
    const statsContainer = document.getElementById('user-server-stats');
    const wantCountElement = document.getElementById('server-want-count');
    const watchedCountElement = document.getElementById('server-watched-count');
    const syncTimeElement = document.getElementById('stats-sync-time-text');

    if (!statsContainer) return;

    if (serverStats && wantCountElement && watchedCountElement && syncTimeElement) {
        // 更新统计数据
        wantCountElement.textContent = formatCount(serverStats.wantCount || 0);
        watchedCountElement.textContent = formatCount(serverStats.watchedCount || 0);

        // 更新同步时间（支持本地“刚刚同步”覆盖，跨刷新保留1分钟）
        let syncTimeText: string;
        try {
            const until = Number(localStorage.getItem(LOCAL_SYNC_OVERRIDE_UNTIL) || '0') || 0;
            const now = Date.now();
            if (until > now) {
                syncTimeText = '刚刚同步';
            } else {
                syncTimeText = serverStats.lastSyncTime ? formatSyncTime(serverStats.lastSyncTime) : '未同步';
                if (until) { try { localStorage.removeItem(LOCAL_SYNC_OVERRIDE_UNTIL); } catch {} }
            }
        } catch {
            syncTimeText = serverStats.lastSyncTime ? formatSyncTime(serverStats.lastSyncTime) : '未同步';
        }
        syncTimeElement.textContent = syncTimeText;

        // 强制移除背景色 - 通过内联样式覆盖
        const statItems = statsContainer.querySelectorAll('.stat-item');
        statItems.forEach(item => {
            const element = item as HTMLElement;
            element.style.background = 'transparent';
            element.style.border = 'none';
            element.style.backgroundColor = 'transparent';
        });

        // 强制移除 stat-value 元素的背景色
        const statValues = statsContainer.querySelectorAll('.stat-value');
        statValues.forEach(value => {
            const element = value as HTMLElement;
            element.style.background = 'transparent';
            element.style.backgroundColor = 'transparent';
        });

        // 显示统计数据容器
        statsContainer.style.display = 'block';
    } else {
        // 隐藏统计数据容器
        statsContainer.style.display = 'none';
    }
}

/**
 * 格式化数量显示（显示详细数字）
 */
function formatCount(count: number): string {
    // 添加千位分隔符，显示完整数字
    return count.toLocaleString('zh-CN');
}

/**
 * 格式化同步时间显示
 */
function formatSyncTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) { // 1分钟内
        return '刚刚同步';
    } else if (diff < 3600000) { // 1小时内
        const minutes = Math.floor(diff / 60000);
        return `${minutes}分钟前`;
    } else if (diff < 86400000) { // 24小时内
        const hours = Math.floor(diff / 3600000);
        return `${hours}小时前`;
    } else {
        const days = Math.floor(diff / 86400000);
        return `${days}天前`;
    }
}

/**
 * 显示登录提示
 */
function showLoginPrompt(): void {
    const infoContainer = document.getElementById('user-profile-info');
    const loginPrompt = document.getElementById('user-login-prompt');

    if (!infoContainer || !loginPrompt) return;

    // 隐藏用户信息，显示登录提示
    infoContainer.style.display = 'none';
    loginPrompt.style.display = 'block';

    // 刷新数据同步区域
    refreshDataSyncSection();
}

/**
 * 刷新数据同步区域（使用事件总线避免循环依赖）
 */
function refreshDataSyncSection(): void {
    try {
        // 使用事件总线通知数据同步模块刷新
        emit('data-sync-refresh-requested', {});
        // logAsync('DEBUG', '已发送数据同步刷新请求');
    } catch (error: any) {
        logAsync('ERROR', '发送数据同步刷新请求失败', { error: error.message });
    }
}

/**
 * 加载并显示 115 v2 用户信息
 */
async function loadDrive115UserInfo(opts?: { allowNetwork?: boolean }): Promise<void> {
    if (isLoadingDrive115) {
        console.debug('[drive115v2-ui] 忽略重复的 115 加载请求（上一次尚未完成）');
        return;
    }
    isLoadingDrive115 = true;
    const block = document.getElementById('drive115-user-info') as HTMLDivElement | null;
    const emptyState = document.getElementById('drive115-empty-state') as HTMLDivElement | null;
    const box = document.getElementById('drive115-user-box') as HTMLDivElement | null;
    if (!block || !box || !emptyState) {
        isLoadingDrive115 = false;
        return;
    }

    try {
        // 确保基础与配额区域常驻（避免后续 innerHTML 覆盖导致配额块消失）
        const ensureAreas = () => {
            if (!box.querySelector('#drive115-user-basic') || !box.querySelector('#drive115-quota-box')) {
                box.innerHTML = `
                  <div id="drive115-user-basic"></div>
                  <div id="drive115-quota-box" style="margin-top:10px;"></div>
                `;
            }
        };
        ensureAreas();
        const basic = box.querySelector('#drive115-user-basic') as HTMLDivElement | null;

        // 读取设置（仅判断开关）
        const settings = await getSettings();
        const s = normalizeDrive115Settings((settings as any)?.drive115 || {});
        // 初始化/刷新“刷新按钮”的悬浮提示（上次刷新、最小间隔、剩余冷却、2小时次数）
        try { updateRefreshTitleFromSettings(s); } catch {}
        const enabled = isDrive115EnabledState(s);

        if (!enabled) {
            // 显示空状态提示
            block.style.display = 'none';
            emptyState.style.display = 'block';
            isLoadingDrive115 = false;
            return;
        }

        // 隐藏空状态，显示用户信息
        emptyState.style.display = 'none';
        block.style.display = 'block';
        // 若存在已缓存的用户信息，先行展示，避免刷新/离线时为空
        const cachedUser = (s as any).v2UserInfo as Drive115V2UserInfo | undefined;
        const cachedExpired = !!(s as any).v2UserInfoExpired;
        if (cachedUser && Object.keys(cachedUser).length > 0) {
            render115User(cachedUser, (s as any)?.v2UserInfoUpdatedAt);
            set115Status(cachedExpired ? '已过期（缓存）' : '已缓存', cachedExpired ? 'warn' : 'info');
        } else {
            set115Status('加载中…', 'info');
            if (basic) basic.innerHTML = '<p style="margin:0; color:#888;">加载中…</p>';
        }

        // 同步展示已缓存的配额（若有）：优先使用设置镜像；若没有则先渲染占位为 0
        try {
            const quotaCache = (s as any)?.quotaCache;
            if (quotaCache && quotaCache.data) {
                render115Quota(quotaCache.data as any);
            } else {
                // 占位默认 0，避免空白
                render115Quota({} as any);
            }
        } catch {}

        // 如果不允许网络请求，则到此为止（仅展示缓存）
        if (!(opts?.allowNetwork === true)) {
            // 仅展示缓存：已在上方尝试渲染 quotaCache
            return;
        }

        // 检查 refresh_token 状态
        const rtStatus = s?.v2RefreshTokenStatus;
        const rtLastError = s?.v2RefreshTokenLastError;
        if (rtStatus === 'invalid' || rtStatus === 'expired') {
            const feedback = buildDrive115UserInfoFailureCopy(rtLastError || 'refresh_token 需要重新授权');
            set115Status(feedback.inlineStatus, 'warn');
            renderDrive115BasicMessage(basic, feedback.inlineMessage, '#ef6c00', feedback.action);
            showToast(feedback.toastMessage, feedback.toastType);
            return;
        }

        const svc = getDrive115V2Service();
        // 仅在允许网络时才真实获取 115 用户信息
        console.debug('[drive115v2-ui] 调用 fetchUserInfoAuto() 获取 115 用户信息（手动）');
        const userAuto = await svc.fetchUserInfoAuto({ forceAutoRefresh: true });
        if (!userAuto.success || !userAuto.data) {
            console.debug('[drive115v2-ui] 获取 115 用户信息失败', { message: userAuto.message, raw: (userAuto as any).raw });
            const emsg = describe115Error((userAuto as any).raw) || userAuto.message || '获取用户信息失败';
            const feedback = buildDrive115UserInfoFailureCopy(emsg);
            set115Status(feedback.inlineStatus, 'warn');
            renderDrive115BasicMessage(basic, feedback.inlineMessage, '#ef6c00', feedback.action);
            showToast(feedback.toastMessage, feedback.toastType);
            const newSettings: any = { ...settings };
            newSettings.drive115 = { ...(settings as any).drive115, v2UserInfoExpired: true };
            await saveSettings(newSettings);
            try { await refreshBtnTooltipFromStorage(); } catch {}

        } else {
            set115Status('已更新', 'ok');
            showToast('已更新 115 用户信息', 'success');
            render115User(userAuto.data, Date.now());
            // 持久化用户信息与时间戳，并清除过期标记
            const newSettings: any = { ...settings };
            newSettings.drive115 = {
                ...(settings as any).drive115,
                v2UserInfo: userAuto.data,
                v2UserInfoUpdatedAt: Date.now(),
                v2UserInfoExpired: false,
            };
            await saveSettings(newSettings);
            try { await refreshBtnTooltipFromStorage(); } catch {}
        }

        // helper moved to module scope

    } catch (e: any) {
        const msg = describe115Error(e) || e?.message || '加载失败';
        const feedback = buildDrive115UserInfoFailureCopy(msg);
        set115Status(feedback.inlineStatus, 'warn');
        const basic = box.querySelector('#drive115-user-basic') as HTMLDivElement | null;
        renderDrive115BasicMessage(basic, feedback.inlineMessage, '#ef6c00', feedback.action);
        showToast(feedback.toastMessage, feedback.toastType);
    } finally {
        isLoadingDrive115 = false;
        try { await refreshBtnTooltipFromStorage(); } catch {}
    }
}

function formatTsToYMD(tsSec: number): string {
    try {
        if (!tsSec || isNaN(tsSec as any)) return '';
        const d = new Date(tsSec * 1000);
        const y = d.getFullYear();
        const m = `${d.getMonth() + 1}`.padStart(2, '0');
        const day = `${d.getDate()}`.padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch { return ''; }
}

function renderDrive115BasicMessage(
    container: HTMLElement | null,
    message: string,
    color: string,
    action?: { hash: string; label: string }
): void {
    if (!container) return;
    container.textContent = '';
    const paragraph = document.createElement('p');
    paragraph.style.margin = '0';
    paragraph.style.color = color;
    paragraph.textContent = message;
    container.appendChild(paragraph);
    if (!action) return;

    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'drive115-inline-settings-btn';
    actionButton.title = action.label;
    actionButton.setAttribute('aria-label', action.label);
    actionButton.innerHTML = '<i class="fas fa-external-link-alt" aria-hidden="true"></i>';
    actionButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        window.location.hash = action.hash;
    });
    paragraph.appendChild(actionButton);
}

// ===== 模块级工具函数：避免块级声明导致的作用域/提升问题 =====
function set115Status(msg: string, kind: 'ok'|'error'|'info'|'warn' = 'info') {
    const el = document.getElementById('drive115-user-status') as HTMLSpanElement | null;
    if (!el) return;
    el.textContent = msg;
    const color = kind === 'ok' ? '#2e7d32' : kind === 'error' ? '#c62828' : kind === 'warn' ? '#ef6c00' : '#888';
    (el as any).style && ((el as any).style.color = color);
}

function render115User(u: Drive115V2UserInfo, updatedAtMs?: number) {
    const container = document.getElementById('drive115-user-basic') as HTMLDivElement | null;
    if (!container) return;
    const uid = (u as any).uid || (u as any).user_id || (u as any).id || '';
    const name = (u as any).user_name || (u as any).name || (u as any).nick || (u as any).username || (uid ? `UID ${uid}` : '-');
    const avatar = (u as any).user_face_m || (u as any).user_face_l || (u as any).user_face_s || (u as any).avatar_middle || (u as any).avatar || (u as any).avatar_small || '';
    const vipInfo = (u as any).vip_info || {};
    const vipLevelName: string = vipInfo.level_name || '';
    const vipExpireTs: number | undefined = typeof vipInfo.expire === 'number' ? vipInfo.expire : undefined;
    const vipExpireText = vipExpireTs ? formatTsToYMD(vipExpireTs) : ((u as any).vip_expire || '');
    const parseBoolVip = (val: any): boolean | null => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val > 0;
        if (typeof val === 'string') {
            const s = val.trim().toLowerCase();
            if (['1','true','yes','是','vip','年费vip','月费vip'].some(k => s.includes(k))) return true;
            if (['0','false','no','否'].some(k => s === k)) return false;
        }
        return null;
    };
    const vipRaw: any = (u as any).is_vip ?? (u as any).vip ?? (u as any).vip_status;
    const isVip = vipLevelName ? '是' : (() => {
        const b = parseBoolVip(vipRaw);
        if (b === true) return '是';
        if (b === false) return '否';
        return '-';
    })();
    const space = (u as any).rt_space_info || {};
    const totalSizeNum: number | undefined = space?.all_total?.size;
    const usedSizeNum: number | undefined = space?.all_use?.size;
    const freeSizeNum: number | undefined = space?.all_remain?.size;
    const totalText: string = space?.all_total?.size_format || formatBytes((u as any).space_total);
    const usedText: string = space?.all_use?.size_format || formatBytes((u as any).space_used);
    const freeText: string = space?.all_remain?.size_format || formatBytes((u as any).space_free);
    const pct = (() => {
        if (typeof usedSizeNum === 'number' && typeof totalSizeNum === 'number' && totalSizeNum > 0) return Math.max(0, Math.min(100, (usedSizeNum / totalSizeNum) * 100));
        if (typeof freeSizeNum === 'number' && typeof totalSizeNum === 'number' && totalSizeNum > 0) return Math.max(0, Math.min(100, ((totalSizeNum - freeSizeNum) / totalSizeNum) * 100));
        const toNumber = (x: any): number | undefined => {
            if (typeof x === 'number') return isFinite(x) ? x : undefined;
            if (typeof x === 'string') {
                const s = x.replace(/[\,\s]/g, '');
                const n = Number(s);
                return isFinite(n) ? n : undefined;
            }
            return undefined;
        };
        const totalNum = toNumber((u as any).space_total);
        const usedNum = toNumber((u as any).space_used);
        if (typeof usedNum === 'number' && typeof totalNum === 'number' && totalNum > 0) return Math.max(0, Math.min(100, (usedNum / totalNum) * 100));
        return NaN;
    })();
    const pctText = isNaN(pct as any) ? '-' : `${(pct >= 100 ? 100 : pct).toFixed(pct >= 10 ? 0 : 1)}%`;
    const barColor = isNaN(pct as any) ? '#90caf9' : (pct < 60 ? '#4caf50' : pct < 85 ? '#ff9800' : '#e53935');
    const updatedText = typeof updatedAtMs === 'number' ? new Date(updatedAtMs).toLocaleString() : '';
    const nowSec = Math.floor(Date.now() / 1000);
    const daysLeft = typeof vipExpireTs === 'number' ? Math.floor((vipExpireTs - nowSec) / 86400) : undefined;
    const expPillClass = ((): string => {
        if (typeof daysLeft !== 'number') return 'expire-normal';
        if (daysLeft <= 7) return 'expire-danger';
        if (daysLeft <= 30) return 'expire-warning';
        return 'expire-normal';
    })();
    const expireTitle = vipExpireTs ? `到期：${vipExpireText}（约剩 ${typeof daysLeft === 'number' ? daysLeft : '?'} 天）` : '';

    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        ${avatar
          ? `<img src="${avatar}" alt="avatar" data-sensitive style="width:40px; height:40px; border-radius:50%; object-fit:cover;">`
          : `<div data-sensitive style=\"width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600;\">${(name||'U').toString().trim().slice(0,2).toUpperCase()}</div>`}
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="font-weight:700; font-size:14px;" data-sensitive>${name || '-'}</div>
            ${isVip === '是' ? `
              <span title="${vipLevelName || 'VIP'}" style="margin-left:auto; display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:11px; color:#fff; background: linear-gradient(135deg,#f2b01e,#e89f0e); box-shadow:0 0 0 1px rgba(0,0,0,.06) inset;">
                <i class=\"fas fa-crown\" style=\"color:#fff; font-size:11px;\"></i>
                ${vipLevelName || 'VIP'}
              </span>
            ` : ''}
          </div>
          <div style="font-size:12px; margin-top:2px;">UID: <span data-sensitive>${uid || '-'}</span></div>
          ${vipExpireText ? `
            <div style=\"margin-top:4px; display:inline-flex; align-items:center; gap:6px; font-size:11px;\" title=\"${expireTitle}\"> 
              <span class=\"drive115-expire-pill ${expPillClass}\">
                <i class=\"fas fa-calendar-alt\"></i>
                到期 · <span data-sensitive>${vipExpireText}${typeof daysLeft === 'number' ? `（剩 ${daysLeft} 天）` : ''}</span>
              </span>
            </div>
          ` : ''}
        </div>
      </div>
      <div style="margin-top:8px; font-size:12px;">
        <div>总 <span data-sensitive>${totalText}</span> · 已用 <span data-sensitive>${usedText}</span> · 剩余 <span data-sensitive>${freeText}</span></div>
        ${(u as any).email ? `<div style=\"margin-top:2px;\">邮箱：<span data-sensitive>${(u as any).email}</span></div>` : ''}
        ${(u as any).phone ? `<div style=\"margin-top:2px;\">手机：<span data-sensitive>${(u as any).phone}</span></div>` : ''}
      </div>
      <div style="margin-top:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; font-size:12px; color:#666; margin-bottom:4px;">
          <span>空间使用</span>
          <span data-sensitive>${pctText}</span>
        </div>
        <div style="height:8px; background:#eee; border-radius:999px; overflow:hidden;">
          <div style="height:100%; width:${!isNaN(pct as any) ? pct : 0}%; background:${barColor}; transition:width .3s ease;"></div>
        </div>
      </div>
      ${updatedText ? `<div style=\"margin-top:6px; font-size:11px; color:#888;\">更新于：<span data-sensitive>${updatedText}</span></div>` : ''}
    `;
}

function render115Quota(info: Drive115V2QuotaInfo) {
    const container = document.getElementById('drive115-quota-box') as HTMLDivElement | null;
    if (!container) return;
    const toNum = (v: any): number | undefined => typeof v === 'number' && isFinite(v) ? v : undefined;
    const list = Array.isArray(info.list) ? info.list : [];
    const totalNum = toNum(info.total) ?? 0;
    const usedNum = toNum(info.used) ?? 0;
    const surplusNum = toNum(info.surplus) ?? (totalNum - usedNum >= 0 ? totalNum - usedNum : 0);
    const totalTxt = totalNum.toString();
    const usedTxt = usedNum.toString();
    const surplusTxt = surplusNum.toString();
    const rows = list.slice(0, 6).map(it => {
        const name = it.name ?? `类型${it.type ?? ''}`;
        const used = typeof it.used === 'number' ? it.used : undefined;
        const surplus = typeof it.surplus === 'number' ? it.surplus : undefined;
        const exp = it.expire_info?.expire_text || '';
        return `<div style="display:flex; justify-content:space-between; font-size:12px; color:#444;">
            <span>${name}${exp ? `（<span data-sensitive>${exp}</span>）` : ''}</span>
            <span>${used !== undefined ? `已用 <span data-sensitive>${used}</span>` : ''}${surplus !== undefined ? `${used !== undefined ? ' / ' : ''}剩余 <span data-sensitive>${surplus}</span>` : ''}</span>
        </div>`;
    }).join('');
    const summary = `<div style=\"font-size:12px; color:#666;\">总额：<span data-sensitive>${totalTxt}</span>，总已用：<span data-sensitive>${usedTxt}</span>，总剩余：<span data-sensitive>${surplusTxt}</span></div>`;
    container.innerHTML = `
      <div style="padding-top:8px; border-top:1px dashed #e0e0e0;">
        <div style="display:flex; align-items:center; gap:6px; font-weight:600; color:#333; margin-bottom:4px;">
          <i class="fas fa-ticket-alt"></i><span>离线配额</span>
          <span style="margin-left:auto; font-size:12px; color:#888;">总额：<span data-sensitive>${totalTxt}</span></span>
        </div>
        ${rows || '<div style=\"font-size:12px; color:#888;\">暂无配额明细</div>'}
        ${summary}
      </div>
    `;
}

// 注意：如需展示配额提示，请通过 render115Quota 渲染或在调用位置内联提示，避免未使用函数

function formatBytes(n?: number | string): string {
    const toNum = (x: any): number | undefined => {
        if (typeof x === 'number') return isFinite(x) ? x : undefined;
        if (typeof x === 'string') {
            const s = x.replace(/[\,\s]/g, '');
            const v = Number(s);
            return isFinite(v) ? v : undefined;
        }
        return undefined;
    };
    const num = toNum(n);
    if (typeof num !== 'number') return '-';
    const units = ['B','KB','MB','GB','TB','PB'];
    let v = num; let i = 0; while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function updateRefreshTitleFromSettings(drv: any) {
    try {
        const btn = document.getElementById('drive115-refresh-btn') as HTMLButtonElement | null;
        if (!btn) return;
        const minMin = Math.max(30, Number(drv?.v2MinRefreshIntervalMin ?? 30) || 30);
        const last = Number(drv?.v2LastTokenRefreshAtSec || 0) || 0;
        const nowSec = Math.floor(Date.now() / 1000);
        const remainSec = last > 0 ? (minMin * 60 - (nowSec - last)) : 0;
        const remainMin = remainSec > 0 ? Math.ceil(remainSec / 60) : 0;
        const fmt = (ts: number) => {
            if (!ts || isNaN(ts as any)) return '-';
            const d = new Date(ts * 1000);
            const Y = d.getFullYear();
            const M = d.getMonth() + 1;
            const D = d.getDate();
            const hh = `${d.getHours()}`.padStart(2, '0');
            const mm = `${d.getMinutes()}`.padStart(2, '0');
            const ss = `${d.getSeconds()}`.padStart(2, '0');
            return `${Y}/${M}/${D}  ${hh}:${mm}:${ss}`;
        };
        const histRaw: any[] = Array.isArray(drv?.v2TokenRefreshHistorySec) ? drv.v2TokenRefreshHistorySec : [];
        const hist: number[] = histRaw.map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
        const twoHoursAgo = nowSec - 7200;
        const cnt2h = hist.filter(ts => ts >= twoHoursAgo).length;
        const max2h = Math.max(1, Number(drv?.v2MaxRefreshPer2h ?? 3) || 3);
        const text = `上次: ${last>0?fmt(last):'-'} · 最小间隔: ${minMin}m · 冷却剩余: ${remainMin>0?remainMin+'m':'无'} · 2小时: ${cnt2h}/${max2h}`;
        btn.title = text;
    } catch {}
}

async function refreshBtnTooltipFromStorage() {
    try {
        const st = await getSettings();
        const drv = (st as any)?.drive115 || {};
        updateRefreshTitleFromSettings(drv);
    } catch {}
}
