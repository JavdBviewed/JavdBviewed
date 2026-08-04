// src/dashboard/tabs/navigation.ts
// 负责 Dashboard 9C 导航渲染、Tab 切换、预取、hash 解析与初始化

import { initializeTabById, prefetchModuleById } from './registry';
import { mountTabIfNeeded } from './mount';
import {
  DASHBOARD_NAV_GROUPS,
  buildDashboardNavHash,
  resolveDashboardNavState,
  type DashboardNavGroup,
  type DashboardNavItem,
  type DashboardNavState,
} from './navModel';
import { prefetchedTabs, prefetchTabResources } from './resources';
import { createLatestActivationScheduler } from './activationScheduler';

type NavigationRuntime = {
  mainTabsRoot: HTMLElement;
  sectionNavRoot: HTMLElement;
  contents: HTMLElement[];
};

type ActivateOptions = {
  updateHash: boolean;
};

function findGroup(groupId: string): DashboardNavGroup | null {
  return DASHBOARD_NAV_GROUPS.find(group => group.id === groupId) ?? null;
}

function findItem(group: DashboardNavGroup, itemId: string): DashboardNavItem | null {
  return group.items.find(item => item.id === itemId) ?? null;
}

function getDefaultItem(group: DashboardNavGroup): DashboardNavItem | null {
  return findItem(group, group.defaultItemId) ?? group.items[0] ?? null;
}

function createState(group: DashboardNavGroup, item: DashboardNavItem, subPath?: string): DashboardNavState {
  const state: DashboardNavState = {
    groupId: group.id,
    itemId: item.id,
    tabId: item.tabId,
  };

  const nextSubPath = subPath ?? item.subPath;
  if (nextSubPath) {
    state.subPath = nextSubPath;
  }

  return state;
}

function collectRuntime(): NavigationRuntime | null {
  const mainTabsRoot = document.getElementById('dashboard-main-tabs');
  const sectionNavRoot = document.getElementById('dashboard-section-nav');
  const contents = Array.from(document.querySelectorAll<HTMLElement>('.tab-content'));

  if (!mainTabsRoot) {
    console.warn('[Navigation] 未找到 Dashboard 一级导航容器');
    return null;
  }
  if (!sectionNavRoot) {
    console.warn('[Navigation] 未找到 Dashboard 二级导航容器');
    return null;
  }
  if (contents.length === 0) {
    console.warn('[Navigation] 未找到标签页内容元素');
    return null;
  }

  return { mainTabsRoot, sectionNavRoot, contents };
}

function prefetchTab(tabId: string): void {
  if (!tabId || prefetchedTabs.has(tabId)) {
    return;
  }

  prefetchModuleById(tabId).catch(() => {});
  prefetchTabResources(tabId).catch(() => {});
}


function playNavClickRipple(button: HTMLButtonElement, event: MouseEvent): void {
  if (!document.body) {
    return;
  }

  const rect = button.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'dashboard-nav-click-ripple';
  if (button.classList.contains('dashboard-sub-tab')) {
    ripple.classList.add('dashboard-nav-click-ripple--sub');
  }

  const size = Math.max(rect.width, rect.height) * 1.85;
  const originX = event.clientX > 0 ? event.clientX - rect.left : rect.width / 2;
  const originY = event.clientY > 0 ? event.clientY - rect.top : rect.height / 2;

  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${rect.left + originX - size / 2}px`;
  ripple.style.top = `${rect.top + originY - size / 2}px`;

  document.body.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  window.setTimeout(() => ripple.remove(), 700);
}

function createMainButton(group: DashboardNavGroup, activeGroupId: string, onActivate: (group: DashboardNavGroup) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dashboard-main-tab';
  button.dataset.navGroupId = group.id;
  button.textContent = group.label;
  button.setAttribute('aria-pressed', group.id === activeGroupId ? 'true' : 'false');

  if (group.id === activeGroupId) {
    button.classList.add('active');
  }

  button.addEventListener('mouseenter', () => {
    const defaultItem = getDefaultItem(group);
    if (defaultItem) {
      prefetchTab(defaultItem.tabId);
    }
  });
  button.addEventListener('click', event => {
    playNavClickRipple(button, event);
    onActivate(group);
  });

  return button;
}

function createSubButton(
  group: DashboardNavGroup,
  item: DashboardNavItem,
  activeState: DashboardNavState,
  onActivate: (state: DashboardNavState) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dashboard-sub-tab';
  button.dataset.navGroupId = group.id;
  button.dataset.navItemId = item.id;
  button.dataset.tab = item.tabId;
  button.textContent = item.label;

  const isActive = activeState.groupId === group.id && activeState.itemId === item.id;
  if (isActive) {
    button.classList.add('active');
  }
  button.setAttribute('aria-pressed', isActive ? 'true' : 'false');

  button.addEventListener('mouseenter', () => prefetchTab(item.tabId));
  button.addEventListener('click', event => {
    playNavClickRipple(button, event);
    onActivate(createState(group, item));
  });

  return button;
}

function renderMainTabs(runtime: NavigationRuntime, activeState: DashboardNavState, onActivate: (group: DashboardNavGroup) => void): void {
  runtime.mainTabsRoot.textContent = '';

  for (const group of DASHBOARD_NAV_GROUPS) {
    runtime.mainTabsRoot.appendChild(createMainButton(group, activeState.groupId, onActivate));
  }
}

function renderSectionTabs(runtime: NavigationRuntime, activeState: DashboardNavState, onActivate: (state: DashboardNavState) => void): void {
  runtime.sectionNavRoot.textContent = '';

  const group = findGroup(activeState.groupId);
  if (!group) {
    runtime.sectionNavRoot.hidden = true;
    return;
  }

  if (group.items.length <= 1) {
    runtime.sectionNavRoot.hidden = true;
    return;
  }

  runtime.sectionNavRoot.hidden = false;

  const tabs = document.createElement('div');
  tabs.className = 'dashboard-sub-tabs';

  for (const item of group.items) {
    tabs.appendChild(createSubButton(group, item, activeState, onActivate));
  }

  runtime.sectionNavRoot.appendChild(tabs);
}

function placeSectionTabsInActivePage(runtime: NavigationRuntime, tabId: string): void {
  const activeContent = document.getElementById(tabId);
  if (!activeContent) {
    return;
  }

  if (runtime.sectionNavRoot.parentElement === activeContent) {
    return;
  }

  activeContent.insertBefore(runtime.sectionNavRoot, activeContent.firstChild);
}

function updateHash(state: DashboardNavState): void {
  const nextHash = buildDashboardNavHash(state);
  if (window.location.hash === nextHash) {
    return;
  }

  if (history.pushState) {
    history.pushState(null, '', nextHash);
    return;
  }

  window.location.hash = nextHash;
}

function dispatchTabEvent(name: 'tab:hide' | 'tab:show', tabId: string): void {
  window.dispatchEvent(new CustomEvent(name, { detail: { tabId } }));
}

function switchTabContent(runtime: NavigationRuntime, tabId: string): boolean {
  const previousActive = document.querySelector<HTMLElement>('.tab-content.active');
  const previousTabId = previousActive?.id ?? null;
  const nextContent = document.getElementById(tabId);

  if (!nextContent) {
    console.warn('[Navigation] 未找到目标标签页内容:', tabId);
    return false;
  }

  if (previousTabId && previousTabId !== tabId) {
    dispatchTabEvent('tab:hide', previousTabId);
  }

  runtime.contents.forEach(content => content.classList.remove('active'));
  nextContent.classList.add('active');
  dispatchTabEvent('tab:show', tabId);

  return true;
}

type ScheduleActivation = (state: DashboardNavState, options: ActivateOptions) => Promise<void>;

async function activateState(
  runtime: NavigationRuntime,
  state: DashboardNavState,
  options: ActivateOptions,
  scheduleActivation: ScheduleActivation,
): Promise<void> {
  const group = findGroup(state.groupId);
  if (!group) {
    return;
  }

  const item = findItem(group, state.itemId) ?? getDefaultItem(group);
  if (!item) {
    return;
  }

  const resolvedState = createState(group, item, state.subPath);
  renderMainTabs(runtime, resolvedState, groupToActivate => {
    const defaultItem = getDefaultItem(groupToActivate);
    if (!defaultItem) {
      return;
    }

    void scheduleActivation(createState(groupToActivate, defaultItem), { updateHash: true });
  });
  const switched = switchTabContent(runtime, resolvedState.tabId);
  if (!switched) {
    return;
  }

  if (options.updateHash) {
    updateHash(resolvedState);
  }

  await mountTabIfNeeded(resolvedState.tabId);
  placeSectionTabsInActivePage(runtime, resolvedState.tabId);
  renderSectionTabs(runtime, resolvedState, nextState => {
    void scheduleActivation(nextState, { updateHash: true });
  });
  await initializeTabById(resolvedState.tabId);

  if (resolvedState.tabId === 'tab-home') {
    window.dispatchEvent(new CustomEvent('home:init-required'));
  }
}

type ActivationRequest = {
  runtime: NavigationRuntime;
  state: DashboardNavState;
  options: ActivateOptions;
};

export async function initTabs(): Promise<void> {
  try {
    const runtime = collectRuntime();
    if (!runtime) {
      return;
    }

    const initialState = resolveDashboardNavState(window.location.hash);

    const activationScheduler = createLatestActivationScheduler(async ({ runtime: nextRuntime, state, options }: ActivationRequest) => {
      await activateState(nextRuntime, state, options, scheduleActivation);
    });
    const scheduleActivation: ScheduleActivation = (state, options) =>
      activationScheduler.schedule({ runtime, state, options });

    window.addEventListener('hashchange', () => {
      const nextState = resolveDashboardNavState(window.location.hash);
      void scheduleActivation(nextState, { updateHash: false });
    });

    await scheduleActivation(initialState, { updateHash: true });
  } catch (error) {
    console.error('初始化标签页时出错:', error);
  }
}
