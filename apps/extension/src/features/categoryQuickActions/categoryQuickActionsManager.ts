/**
 * @file categoryQuickActionsManager.ts
 * @description 影片页「类别」栏类别链接的悬浮快捷操作面板（09-30-video-category-quick-actions）。
 *
 * 需求（用户已定稿）：类别链接 hover 出面板，只含两个**排除类**动作：
 *  1. 屏蔽（列表页）= 写 settings.listEnhancement.categoryFilter.black；
 *  2. 新作品不入库 = 写 new_works_config.filters.categoryBlackFilters；
 *  按钮 toggle 态：值已在集合中 → 翻「取消屏蔽」/「恢复入库」，点击移除（面板保持打开，便于就地撤销）。
 *  白名单 / 订阅类动作**不做**（coord 裁决）。
 *
 * 骨架照抄 features/actorEnhancement/actorQuickActionsManager.ts（hover 300ms / hide 200ms、
 * tooltip 面板、按钮状态着色、MutationObserver、样式单次注入）；该文件**一行未改**（红线）。
 * CSS 命名空间独立为 x-category-quick-*，不复用 x-actor-quick-*。
 *
 * 不可用链接（per-link 解析失败 / cN 非法 / id 不在字典）= 面板与按钮完全不出现，不置灰（裁决 3）。
 * @module features/categoryQuickActions
 */
import { newWorksManager } from '../newWorks';
import { showToast } from '../../platform/browser/toast';
import { getSettings, getValue, saveSettings } from '../../utils/storage';
import { STORAGE_KEYS } from '../../utils/config';
import { saveSettingsSectionDelta } from '../../utils/settingsDelta';
import type { NewWorksGlobalConfig } from '../../types';
import {
  currentBaseHref,
  findActorTagLinkElements,
  findCategoryLinkElements,
  type CategoryLinkCandidate,
} from './domain/entryKeyResolution';
import {
  buttonView,
  buildListEnhancementDelta,
  buildNewWorksFiltersPatch,
  containsEntryKey,
  listBlockToastText,
  resolveActionIntent,
  CATEGORY_QUICK_ACTION_SPECS,
  categoryLinkMarkPlan,
  CATEGORY_STATE_LIST_BLOCKED_COLOR,
  CATEGORY_STATE_LIST_BLOCKED_TEXT_DECORATION,
  CATEGORY_STATE_NEW_WORKS_ICON,
  type CategoryQuickActionId,
  type CategoryQuickActionContext,
  type CategoryQuickActionState,
  type CategoryLinkMarkPlan,
} from './domain/categoryQuickActionsModel';

interface CategoryQuickActionsConfig {
  enabled: boolean;
  showDelay: number;
  hideDelay: number;
}

/** 面板动作所需的两集合当前值（打开面板时一次性读取）。 */
interface CategoryActionStateSnapshot {
  listBlack: string[];
  newWorksBlack: string[];
}

const DEFAULT_SNAPSHOT: CategoryActionStateSnapshot = { listBlack: [], newWorksBlack: [] };

// ── 类别链接文字级状态标记（09-30-category-link-state） ─────────────────────────
// 与悬浮面板同子开关门控、同生灭：面板能出现的链接才可能被打标，destroy 时全清。

/** 已绑定（=可标记）链接的选择器：标记重绘/回收都以绑定态为准。 */
const BOUND_LINK_SELECTOR = 'a[data-x-category-quick-bound="true"]';

/** 禁止图标类名（x-category-quick-* 命名空间内；幂等识别用）。 */
const STATE_ICON_CLASS = 'x-category-quick-state-icon';
const STATE_ICON_DATA_ATTR = 'data-x-category-quick-state-icon';

class CategoryQuickActionsManager {
  private config: CategoryQuickActionsConfig = {
    enabled: true,
    showDelay: 300,
    hideDelay: 200,
  };

  private currentTooltip: HTMLElement | null = null;
  private showTimer: number | null = null;
  private hideTimer: number | null = null;
  private stylesInjected = false;
  private observer: MutationObserver | null = null;
  private inited = false;
  /** ensureInit 时判定一次的页型（video 详情页 / actor 演员页）；存实例供 observer 的 scanAndBind 复用，不逐帧重判。 */
  private pageKind: 'video' | 'actor' | null = null;
  /**
   * 链接被本功能改写前的原值（color/textDecoration/title）。
   * ★ 用 WeakMap 而非 dataset：不把扩展自己的数据写进站点 DOM。
   */
  private readonly markOriginals = new WeakMap<HTMLAnchorElement, {
    title: string | null;
    color: string;
    textDecoration: string;
  }>();
  /** 最近一次读到的两集合快照（新增绑定链接可据此同步补画，不等异步）。 */
  private cachedSnapshot: CategoryActionStateSnapshot = DEFAULT_SNAPSHOT;
  /** chrome.storage.onChanged 监听摘除句柄。 */
  private disposeStorageWatcher: (() => void) | null = null;

  updateConfig(newConfig: Partial<CategoryQuickActionsConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /** 注入样式（单次；命名空间 x-category-quick-*）。 */
  private injectStyles(): void {
    if (this.stylesInjected) return;
    if (document.getElementById('x-category-quick-actions-styles')) {
      this.stylesInjected = true;
      return;
    }

    const style = document.createElement('style');
    style.id = 'x-category-quick-actions-styles';
    style.textContent = `
      .x-category-quick-tooltip {
        position: absolute;
        z-index: 10000;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        padding: 12px;
        min-width: 210px;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      }

      .x-category-quick-tooltip.show {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }

      .x-category-quick-header {
        display: flex;
        align-items: baseline;
        gap: 6px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e5e7eb;
      }

      .x-category-quick-name {
        font-size: 14px;
        font-weight: 600;
        color: #1f2937;
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .x-category-quick-key {
        font-size: 11px;
        color: #9ca3af;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .x-category-quick-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .x-category-quick-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        background: #f3f4f6;
        color: #374151;
        width: 100%;
        text-align: left;
      }

      .x-category-quick-btn:hover {
        background: #e5e7eb;
        transform: translateX(2px);
      }

      .x-category-quick-btn:active {
        transform: translateX(0);
      }

      .x-category-quick-btn.blocked {
        background: #fee2e2;
        color: #991b1b;
      }

      .x-category-quick-btn.blocked:hover {
        background: #fecaca;
      }

      .x-category-quick-btn.excluded {
        background: #fef3c7;
        color: #92400e;
      }

      .x-category-quick-btn.excluded:hover {
        background: #fde68a;
      }

      .x-category-quick-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
      }

      .x-category-quick-btn-icon {
        font-size: 16px;
        flex-shrink: 0;
      }

      .x-category-quick-btn-text {
        flex: 1;
      }

      .x-category-quick-loading {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: x-category-quick-spin 0.6s linear infinite;
      }

      @keyframes x-category-quick-spin {
        to { transform: rotate(360deg); }
      }

      /* 类别链接悬浮提示（面板可达性） */
      .x-category-hoverable {
        position: relative;
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);
    this.stylesInjected = true;
  }

  /**
   * 读取两个集合的当前值（面板打开时一次）。
   * 读失败按空集合处理：面板仍出现，按钮为未激活态（写入路径各自再读最新值，不受此影响）。
   */
  private async readState(): Promise<CategoryActionStateSnapshot> {
    const snapshot: CategoryActionStateSnapshot = { ...DEFAULT_SNAPSHOT };
    try {
      const raw = await getValue<Record<string, any>>(STORAGE_KEYS.SETTINGS, {});
      const listCfg = (raw?.listEnhancement || {}) as CategoryQuickActionContext & Record<string, any>;
      snapshot.listBlack = Array.isArray(listCfg.categoryFilter?.black)
        ? listCfg.categoryFilter.black.filter((k: unknown): k is string => typeof k === 'string')
        : [];
    } catch {
      snapshot.listBlack = [];
    }
    try {
      const cfg = await getValue<Partial<NewWorksGlobalConfig>>(STORAGE_KEYS.NEW_WORKS_CONFIG, {});
      const black = cfg?.filters?.categoryBlackFilters;
      snapshot.newWorksBlack = Array.isArray(black) ? black.filter((k: unknown): k is string => typeof k === 'string') : [];
    } catch {
      snapshot.newWorksBlack = [];
    }
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  /** 动作 1：列表页屏蔽集合读写（delta 只改 listEnhancement 节，写前重读原始值）。 */
  private async toggleListBlock(key: string, enable: boolean): Promise<string> {
    const staleBase = await getSettings();
    let toastText = CATEGORY_QUICK_ACTION_SPECS.listBlock.successText(enable);
    await saveSettingsSectionDelta(
      {
        readRawSettings: () => getValue<any>(STORAGE_KEYS.SETTINGS, undefined),
        saveSettings: (next: any) => saveSettings(next),
      },
      staleBase,
      'listEnhancement',
      (latestSection: Record<string, any>) => {
        const plan = buildListEnhancementDelta(latestSection as CategoryQuickActionContext, key, enable);
        toastText = listBlockToastText(enable, plan.activeAfterWrite);
        return plan.delta;
      },
    );
    return toastText;
  }

  /**
   * 动作 2：新作品不入库集合读写。
   * ★ updateGlobalConfig 为顶层**浅合并**，故 filters 必须整对象回传（见 domain 单测锁这条陷阱）。
   */
  private async toggleNewWorksBlock(key: string, enable: boolean): Promise<void> {
    const config = await newWorksManager.getGlobalConfig();
    const patch = buildNewWorksFiltersPatch(config, key, enable);
    await newWorksManager.updateGlobalConfig(patch);
  }

  /** 创建动作按钮（toggle 态在点击成功后就地翻转，面板保持打开便于撤销）。 */
  private createActionButton(
    specId: CategoryQuickActionId,
    key: string,
    active: boolean,
    onToggle: (enable: boolean) => Promise<string>,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.categoryQuickAction = specId;
    btn.dataset.categoryEntryKey = key;
    const applyView = (isActive: boolean) => {
      const view = buttonView(specId, isActive);
      btn.className = `x-category-quick-btn ${view.className}`.trim();
      btn.setAttribute('aria-pressed', String(isActive));
      const iconEl = btn.querySelector('.x-category-quick-btn-icon') as HTMLElement | null;
      const textEl = btn.querySelector('.x-category-quick-btn-text') as HTMLElement | null;
      if (iconEl) iconEl.textContent = view.icon;
      if (textEl) textEl.textContent = view.text;
      btn.title = `${view.text}（${key}）`;
    };

    const iconEl = document.createElement('span');
    iconEl.className = 'x-category-quick-btn-icon';
    const textEl = document.createElement('span');
    textEl.className = 'x-category-quick-btn-text';
    btn.appendChild(iconEl);
    btn.appendChild(textEl);
    applyView(active);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // ★ 意图解析走 domain 纯函数（勿在此处手写取反：aria-pressed 双重取反曾致首次点击反向操作）
      const { enable, nextActive } = resolveActionIntent(specId, btn.getAttribute('aria-pressed'));
      btn.disabled = true;
      const originalIcon = iconEl.textContent;
      const originalText = textEl.textContent;
      iconEl.innerHTML = '<span class="x-category-quick-loading"></span>';
      textEl.textContent = '处理中...';

      try {
        const toast = await onToggle(enable);
        applyView(nextActive);
        showToast(toast, 'success');
        // ★ 写入成功后就地翻转链接状态标记（面板保持打开，便于连续撤销；不改变按钮任何语义）
        void this.repaintLinkStates();
      } catch (err: any) {
        console.error('[CategoryQuickActions] 操作失败:', err);
        iconEl.textContent = originalIcon || '';
        textEl.textContent = originalText || '';
        showToast(`操作失败: ${err?.message || '未知错误'}`, 'error');
      } finally {
        // ★ 成功/失败都必须恢复可点击：否则一次操作后按钮永久 disabled，用户无法就地撤销
        btn.disabled = false;
      }
    });

    return btn;
  }

  /** 定位提示框（下优先、空间不足回上方，水平居中）。 */
  private positionTooltip(tooltip: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const tooltipHeight = 140; // 预估高度（两个按钮）
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow >= tooltipHeight || spaceBelow >= spaceAbove) {
      tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
    } else {
      tooltip.style.bottom = `${window.innerHeight - rect.top - window.scrollY + 8}px`;
    }

    const left = rect.left + rect.width / 2;
    tooltip.style.left = `${left}px`;
    tooltip.style.transform = 'translateX(-50%)';
  }

  /** 创建面板。 */
  private createTooltip(candidate: CategoryLinkCandidate, state: CategoryActionStateSnapshot): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'x-category-quick-tooltip';
    tooltip.dataset.categoryQuickPanel = candidate.entryKey;

    const header = document.createElement('div');
    header.className = 'x-category-quick-header';
    const nameEl = document.createElement('div');
    nameEl.className = 'x-category-quick-name';
    nameEl.textContent = candidate.label || candidate.entryKey;
    nameEl.title = nameEl.textContent || '';
    header.appendChild(nameEl);
    const keyEl = document.createElement('span');
    keyEl.className = 'x-category-quick-key';
    keyEl.textContent = candidate.entryKey;
    header.appendChild(keyEl);
    tooltip.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'x-category-quick-actions';

    const viewState: CategoryQuickActionState = {
      listBlocked: containsEntryKey(state.listBlack, candidate.entryKey),
      newWorksBlocked: containsEntryKey(state.newWorksBlack, candidate.entryKey),
    };

    actions.appendChild(
      this.createActionButton('listBlock', candidate.entryKey, viewState.listBlocked, (enable) =>
        this.toggleListBlock(candidate.entryKey, enable),
      ),
    );
    actions.appendChild(
      this.createActionButton('newWorksBlock', candidate.entryKey, viewState.newWorksBlocked, (enable) => {
        return this.toggleNewWorksBlock(candidate.entryKey, enable).then(() =>
          CATEGORY_QUICK_ACTION_SPECS.newWorksBlock.successText(enable),
        );
      }),
    );

    tooltip.appendChild(actions);
    return tooltip;
  }

  /** 显示提示框。 */
  private async showTooltip(candidate: CategoryLinkCandidate, anchor: HTMLElement): Promise<void> {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.currentTooltip) {
      this.currentTooltip.remove();
      this.currentTooltip = null;
    }

    const state = await this.readState();
    // 异步读期间鼠标已再次移开 → 不再弹出
    if (!anchor.isConnected) return;

    const tooltip = this.createTooltip(candidate, state);
    document.body.appendChild(tooltip);
    this.currentTooltip = tooltip;
    this.positionTooltip(tooltip, anchor);

    tooltip.addEventListener('mouseenter', () => {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    });
    tooltip.addEventListener('mouseleave', () => this.scheduleHide());

    requestAnimationFrame(() => tooltip.classList.add('show'));
  }

  /** 隐藏提示框。 */
  private hideTooltip(): void {
    // ★ 回收目标绑定到「发起隐藏时的那个面板」，不在定时器里回读 this.currentTooltip。
    //   旧写法（照搬演员快捷动作骨架）在 hideDelay(200) < showDelay(300) 的节奏下会这样翻车：
    //   指针从面板单跳回链接 → mouseleave 先排定旧面板回收(+200ms) → mouseenter 弹新面板(+300ms)
    //   → 到点时 this.currentTooltip 已指向**新面板** → 新面板被误删，表现为「面板移开再移回就
    //   打不开 / 一闪即没」（真机探针 E 段 openPanelE=false、tooltipTotal=0 的根因）。
    const target = this.currentTooltip;
    if (!target) return;
    this.currentTooltip = null;
    target.classList.remove('show');
    window.setTimeout(() => {
      if (target.isConnected) target.remove();
    }, this.config.hideDelay);
  }

  /** 计划隐藏提示框。 */
  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.hideTooltip();
      this.hideTimer = null;
    }, this.config.hideDelay);
  }

  /**
   * 为类别链接绑定悬浮快捷操作（幂等）。
   * 解析不到可用 entryKey 的链接在此再兜一次（调用方已过滤，双保险），命中即绑定。
   */
  public enhanceCategoryLink(anchor: HTMLAnchorElement, candidate: CategoryLinkCandidate): void {
    if (!candidate?.entryKey) return;
    if (anchor.getAttribute('data-x-category-quick-bound') === 'true') return;
    anchor.setAttribute('data-x-category-quick-bound', 'true');
    anchor.setAttribute('data-x-category-entry-key', candidate.entryKey);
    anchor.classList.add('x-category-hoverable');

    // 状态标记：绑定即入标记集（重绘走 DOM 选择器，无需额外注册表）。
    // 已有快照时同步补画，避免 MutationObserver 新增链接漏标（首绘在 ensureInit 里异步补一次）。
    this.applyLinkState(anchor, candidate.entryKey, this.cachedSnapshot);

    anchor.addEventListener('mouseenter', () => {
      if (this.showTimer) clearTimeout(this.showTimer);
      this.showTimer = window.setTimeout(() => {
        this.showTooltip(candidate, anchor);
        this.showTimer = null;
      }, this.config.showDelay);
    });

    anchor.addEventListener('mouseleave', () => {
      if (this.showTimer) {
        clearTimeout(this.showTimer);
        this.showTimer = null;
      }
      this.scheduleHide();
    });

    // 链接本身点击保持原跳转（与演员快捷操作同口径，不阻止默认行为）
  }

  // ── 链接文字级状态标记（09-30-category-link-state） ──────────────────────────

  /** 取当前文档中所有已绑定（=可标记）的类别链接。 */
  private boundLinks(): Array<{ anchor: HTMLAnchorElement; entryKey: string }> {
    const nodes = document.querySelectorAll<HTMLAnchorElement>(BOUND_LINK_SELECTOR);
    const list: Array<{ anchor: HTMLAnchorElement; entryKey: string }> = [];
    nodes.forEach((anchorEl) => {
      const entryKey = anchorEl.getAttribute('data-x-category-entry-key') || '';
      if (entryKey) list.push({ anchor: anchorEl, entryKey });
    });
    return list;
  }

  /** 找链接的禁止图标兄弟节点（只认本功能创建的、entryKey 相同的那个）。 */
  private findStateIcon(anchor: HTMLAnchorElement, entryKey: string): HTMLElement | null {
    const parent = anchor.parentElement;
    if (!parent) return null;
    const icons = parent.querySelectorAll<HTMLElement>(`.${STATE_ICON_CLASS}`);
    for (let i = 0; i < icons.length; i += 1) {
      if (icons[i].getAttribute(STATE_ICON_DATA_ATTR) === entryKey) return icons[i];
    }
    return null;
  }

  /** 创建禁止图标（★ 必须插在链接**外**做兄弟节点：放进链接内会污染 textContent，面板头部 name 会被带上图标）。 */
  private createStateIcon(entryKey: string): HTMLSpanElement {
    const icon = document.createElement('span');
    icon.className = STATE_ICON_CLASS;
    icon.setAttribute(STATE_ICON_DATA_ATTR, entryKey);
    icon.setAttribute('aria-hidden', 'true');
    icon.style.fontSize = '0.9em';
    icon.style.marginRight = '4px';
    icon.style.verticalAlign = 'text-top';
    icon.textContent = CATEGORY_STATE_NEW_WORKS_ICON;
    return icon;
  }

  /** 标记前保存站点原值（内联 color / textDecoration / title 属性），解除时按原值还原。 */
  private rememberOriginals(anchor: HTMLAnchorElement): void {
    if (this.markOriginals.has(anchor)) return;
    this.markOriginals.set(anchor, {
      title: anchor.getAttribute('title'),
      color: anchor.style.color,
      textDecoration: anchor.style.textDecoration,
    });
  }

  /** 还原链接原值并摘图标（幂等；原 title 不存在则 removeAttribute）。 */
  private restoreOriginals(anchor: HTMLAnchorElement, entryKey: string): void {
    const original = this.markOriginals.get(anchor);
    anchor.style.color = original?.color || '';
    anchor.style.textDecoration = original?.textDecoration || '';
    if (original?.title) anchor.setAttribute('title', original.title);
    else anchor.removeAttribute('title');
    this.findStateIcon(anchor, entryKey)?.remove();
  }

  /**
   * 应用单链接状态标记（幂等：重复调用不重复插图标）。
   * 屏蔽态=红 + 删除线（与演员黑名单同色同口径）；不入库态=链接前的 🚫 兄弟节点；两态可共存。
   */
  private applyLinkState(
    anchor: HTMLAnchorElement,
    entryKey: string,
    snapshot: CategoryActionStateSnapshot,
  ): void {
    const plan: CategoryLinkMarkPlan = categoryLinkMarkPlan(entryKey, snapshot.listBlack, snapshot.newWorksBlack);
    this.rememberOriginals(anchor);

    if (plan.needsStrike) {
      anchor.style.color = CATEGORY_STATE_LIST_BLOCKED_COLOR;
      anchor.style.textDecoration = CATEGORY_STATE_LIST_BLOCKED_TEXT_DECORATION;
    } else {
      anchor.style.color = this.markOriginals.get(anchor)?.color || '';
      anchor.style.textDecoration = this.markOriginals.get(anchor)?.textDecoration || '';
    }

    const existingIcon = this.findStateIcon(anchor, entryKey);
    if (plan.needsIcon) {
      // 重复插入先摘旧（幂等，且 entryKey 变化时不残留）
      if (existingIcon) existingIcon.remove();
      anchor.insertAdjacentElement('beforebegin', this.createStateIcon(entryKey));
    } else {
      existingIcon?.remove();
    }

    if (plan.titleText) {
      anchor.setAttribute('title', plan.titleText);
    } else {
      const originalTitle = this.markOriginals.get(anchor)?.title;
      if (originalTitle) anchor.setAttribute('title', originalTitle);
      else anchor.removeAttribute('title');
    }
  }

  /** 重读两集合并重画全部已绑定链接（子开关关/未初始化时不做事）。 */
  private async repaintLinkStates(): Promise<void> {
    if (!this.inited) return;
    const snapshot = await this.readState();
    this.boundLinks().forEach(({ anchor, entryKey }) => this.applyLinkState(anchor, entryKey, snapshot));
  }

  /** 清掉全部状态标记并还原站点原值（destroy / 可回收性验证用）。 */
  private clearAllLinkStates(): void {
    this.boundLinks().forEach(({ anchor, entryKey }) => this.restoreOriginals(anchor, entryKey));
  }

  /**
   * 订阅两集合的存储变化：settings（列表页隐藏集）与 new_works_config（不入库集）。
   * 只在这两键变化时重画；写侧（面板按钮/其他页设置变更）都经此同步，标记与集合始终一致。
   */
  private installStorageWatcher(): void {
    if (this.disposeStorageWatcher) return;
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== 'local') return;
      if (!changes[STORAGE_KEYS.SETTINGS] && !changes[STORAGE_KEYS.NEW_WORKS_CONFIG]) return;
      void this.repaintLinkStates();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    this.disposeStorageWatcher = () => {
      chrome.storage.onChanged.removeListener(onStorageChanged);
      this.disposeStorageWatcher = null;
    };
  }

  /** 页型判定（仅 ensureInit 时执行一次；无 window 环境按 video 兜底）。 */
  private detectPageKind(): 'video' | 'actor' {
    try {
      if (typeof window !== 'undefined' && /\/actors\/\w+/.test(window.location.pathname)) return 'actor';
    } catch {
      // ignore
    }
    return 'video';
  }

  /** 扫描当前文档的类别链接并绑定（幂等；不可用链接不返回=不绑定）。 */
  private scanAndBind(root: Document | HTMLElement = document): number {
    const base = currentBaseHref();
    // 页型在 ensureInit 判定一次（存实例）：演员页=同 pathname 标签云 t= 形态，影片页=.panel-block 类别面板
    const found = this.pageKind === 'actor'
      ? findActorTagLinkElements(root, base)
      : findCategoryLinkElements(root, base);
    found.forEach(({ element, candidate }) => this.enhanceCategoryLink(element, candidate));
    return found.length;
  }

  /** 幂等初始化（仅影片详情页；重复调用直接返回）。 */
  async ensureInit(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.inited) return;
    this.inited = true;
    this.pageKind = this.detectPageKind();

    this.injectStyles();
    const count = this.scanAndBind(document);
    console.log(`🏷️ 类别快捷操作增强已启用（${this.pageKind} 页，找到 ${count} 个可用类别链接）`);

    // 状态标记首次渲染（绑定时的同步补画用的是空快照，这里读一次真实集合重画）
    this.installStorageWatcher();
    await this.repaintLinkStates();

    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          this.scanAndBind(node as HTMLElement);
        });
      });
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  /** 仅在影片详情页（/v/...）或演员页（/actors/...）初始化（10-15-issue-53）。 */
  async init(): Promise<void> {
    if (!/\/v\/\w+|\/actors\/\w+/.test(window.location.pathname)) return;
    await this.ensureInit();
  }

  /** 销毁。 */
  destroy(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.observer?.disconnect();
    this.observer = null;
    // ★ 状态标记与面板同生灭：子开关关/卸载时全部清除并还原站点原值
    this.clearAllLinkStates();
    this.disposeStorageWatcher?.();
    this.disposeStorageWatcher = null;
    this.cachedSnapshot = DEFAULT_SNAPSHOT;
    this.inited = false;
    this.pageKind = null;
    this.hideTooltip();
  }
}

export const categoryQuickActionsManager = new CategoryQuickActionsManager();

/** 单链接绑定入口（供测试/其他路径复用）。 */
export function bindCategoryQuickActionsToLink(
  anchor: HTMLAnchorElement,
  candidate: CategoryLinkCandidate,
): void {
  categoryQuickActionsManager.enhanceCategoryLink(anchor, candidate);
}
