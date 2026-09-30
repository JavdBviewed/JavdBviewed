/**
 * @file categoryQuickActionsManager.ts
 * @description 影片页「類別」栏类别链接的悬浮快捷操作面板（09-30-video-category-quick-actions）。
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
  type CategoryQuickActionId,
  type CategoryQuickActionContext,
  type CategoryQuickActionState,
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

  /** 扫描当前文档的类别链接并绑定（幂等；不可用链接不返回=不绑定）。 */
  private scanAndBind(root: Document | HTMLElement = document): number {
    const base = currentBaseHref();
    const found = findCategoryLinkElements(root, base);
    found.forEach(({ element, candidate }) => this.enhanceCategoryLink(element, candidate));
    return found.length;
  }

  /** 幂等初始化（仅影片详情页；重复调用直接返回）。 */
  async ensureInit(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.inited) return;
    this.inited = true;

    this.injectStyles();
    const count = this.scanAndBind(document);
    console.log(`🏷️ 类别快捷操作增强已启用（找到 ${count} 个可用类别链接）`);

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

  /** 仅在影片详情页（/v/...）初始化。 */
  async init(): Promise<void> {
    if (!/\/v\/\w+/.test(window.location.pathname)) return;
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
    this.inited = false;
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
