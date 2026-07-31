import type { UserProfile } from '../../types';
import { initUserProfileSection } from '../userProfile';
import { userService } from '../services/userService';

const HELP_URL = 'https://docs.we-together.club/';
const GITHUB_URL = 'https://github.com/JavdBviewed/JavdBviewed';
const TELEGRAM_URL = 'https://t.me/javdbviewed';

let boundRoot: HTMLElement | null = null;
let cleanupMenuEvents: (() => void) | null = null;

export function initDashboardUserMenu(): void {
  const root = document.getElementById('dashboard-user-menu-root');
  if (!root) return;
  if (boundRoot === root && root.dataset.userMenuInitialized === 'true') return;

  cleanupMenuEvents?.();
  cleanupMenuEvents = null;
  if (boundRoot) {
    delete boundRoot.dataset.userMenuInitialized;
  }

  root.innerHTML = `
    <div class="dashboard-user-menu" data-open="false">
      <button id="dashboard-user-menu-trigger" class="dashboard-user-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" title="账号与信息：未登录">
        <span class="dashboard-user-menu-avatar" aria-hidden="true"><i class="fas fa-user-circle"></i></span>
        <span id="dashboard-user-menu-name" class="dashboard-user-menu-name">未登录</span>
        <span class="dashboard-user-menu-caret" aria-hidden="true"><i class="fas fa-chevron-down"></i></span>
      </button>
      <div id="dashboard-user-menu-popover" class="dashboard-user-menu-popover" role="menu" aria-labelledby="dashboard-user-menu-trigger" hidden>
        <div class="dashboard-user-menu-scroll">
          <div id="user-profile-section"></div>
          <div class="dashboard-user-menu-actions" aria-label="快捷入口">
            <button type="button" class="dashboard-user-menu-action" data-user-menu-action="settings">
              <i class="fas fa-cog"></i><span>设置中心</span>
            </button>
            <button type="button" class="dashboard-user-menu-action" data-user-menu-action="drive115">
              <img src="../assets/115-logo.svg" alt="" /><span>115 设置</span>
            </button>
            <button type="button" class="dashboard-user-menu-action" data-user-menu-action="about">
              <i class="fas fa-code-branch"></i><span>版本与关于</span>
            </button>
            <button type="button" class="dashboard-user-menu-action" data-user-menu-action="help">
              <i class="fas fa-question-circle"></i><span>帮助文档</span>
            </button>
          </div>
          <div class="dashboard-user-menu-links" aria-label="项目链接">
            <button type="button" class="dashboard-user-menu-link" data-user-menu-action="github" title="打开 GitHub 项目">
              <i class="fab fa-github"></i><span>GitHub</span>
            </button>
            <button type="button" class="dashboard-user-menu-link" data-user-menu-action="telegram" title="加入 Telegram 群组">
              <i class="fab fa-telegram"></i><span>Telegram</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  cleanupMenuEvents = bindMenuEvents(root);
  initUserProfileSection();
  root.dataset.userMenuInitialized = 'true';
  boundRoot = root;
}

function bindMenuEvents(root: HTMLElement): () => void {
  const host = root.querySelector<HTMLElement>('.dashboard-user-menu');
  const trigger = root.querySelector<HTMLButtonElement>('#dashboard-user-menu-trigger');
  const popover = root.querySelector<HTMLElement>('#dashboard-user-menu-popover');
  if (!host || !trigger || !popover) return () => {};

  const setOpen = (open: boolean) => {
    host.dataset.open = open ? 'true' : 'false';
    popover.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const handleTriggerClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(popover.hidden);
  };

  const handleDocumentClick = (event: MouseEvent) => {
    const clickedInsideMenu = event.composedPath().includes(root);
    if (!clickedInsideMenu) {
      setOpen(false);
    }
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !popover.hidden) {
      setOpen(false);
      trigger.focus();
    }
  };

  const handleRootClick = (event: MouseEvent) => {
    // 菜单内的刷新、退出等操作可能会同步重绘自身 DOM。
    // 先截断冒泡，避免 document click 在目标节点被移除后误判为外部点击并关闭菜单。
    event.stopPropagation();

    const actionElement = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-user-menu-action]');
    const action = actionElement?.dataset.userMenuAction;
    if (!action) return;

    if (action === 'settings') {
      window.location.hash = '#tab-settings';
      setOpen(false);
      return;
    }
    if (action === 'drive115') {
      window.location.hash = '#tab-settings/drive115-settings';
      setOpen(false);
      return;
    }
    if (action === 'about') {
      window.location.hash = '#tab-settings/update-settings';
      setOpen(false);
      return;
    }
    if (action === 'help') {
      window.open(HELP_URL, '_blank', 'noopener,noreferrer');
      setOpen(false);
      return;
    }
    if (action === 'github') {
      window.open(GITHUB_URL, '_blank', 'noopener,noreferrer');
      setOpen(false);
      return;
    }
    if (action === 'telegram') {
      window.open(TELEGRAM_URL, '_blank', 'noopener,noreferrer');
      setOpen(false);
    }
  };

  const userName = root.querySelector<HTMLElement>('#dashboard-user-menu-name');
  const updateTriggerProfile = (profile: UserProfile | null) => {
    applyTriggerProfileState(trigger, userName, profile);
  };
  const unsubscribeProfile = userService.subscribe(updateTriggerProfile);
  updateTriggerProfile(userService.getCurrentUserProfile());
  userService.getUserProfile()
    .then(updateTriggerProfile)
    .catch(() => updateTriggerProfile(null));

  trigger.addEventListener('click', handleTriggerClick);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleDocumentKeydown);
  root.addEventListener('click', handleRootClick);

  return () => {
    unsubscribeProfile();
    trigger.removeEventListener('click', handleTriggerClick);
    document.removeEventListener('click', handleDocumentClick);
    document.removeEventListener('keydown', handleDocumentKeydown);
    root.removeEventListener('click', handleRootClick);
  };
}

function applyTriggerProfileState(
  trigger: HTMLButtonElement,
  nameElement: HTMLElement | null,
  profile: UserProfile | null
): void {
  const label = getTriggerProfileLabel(profile);
  const isLoggedIn = profile?.isLoggedIn === true;

  trigger.title = `账号与信息：${label}`;
  trigger.dataset.loggedIn = isLoggedIn ? 'true' : 'false';

  if (!nameElement) return;
  nameElement.textContent = label;
  if (isLoggedIn) {
    nameElement.setAttribute('data-sensitive', '');
  } else {
    nameElement.removeAttribute('data-sensitive');
  }
}

function getTriggerProfileLabel(profile: UserProfile | null): string {
  if (profile?.isLoggedIn !== true) {
    return '未登录';
  }

  const username = profile.username?.trim();
  if (username) {
    return username;
  }

  const email = profile.email?.trim();
  if (email) {
    return email;
  }

  return '已登录';
}
