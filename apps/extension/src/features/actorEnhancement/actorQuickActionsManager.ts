/**
 * 演员快速操作增强
 * 在影片页悬浮演员名字时显示快速操作面板（收藏、拉黑、订阅）
 */

import { actorManager } from '../actors';
import { newWorksManager } from '../newWorks';
import { showToast } from '../../platform/browser/toast';
import type { ActorRecord } from '../../types';

interface ActorQuickActionsConfig {
  enabled: boolean;
  showDelay: number; // 悬浮延迟（毫秒）
  hideDelay: number; // 隐藏延迟（毫秒）
}

class ActorQuickActionsManager {
  private config: ActorQuickActionsConfig = {
    enabled: true,
    showDelay: 300,
    hideDelay: 200
  };

  private currentTooltip: HTMLElement | null = null;
  private showTimer: number | null = null;
  private hideTimer: number | null = null;
  private stylesInjected = false;
  private observer: MutationObserver | null = null;
  private initedPage: 'video' | 'list' | null = null;

  updateConfig(newConfig: Partial<ActorQuickActionsConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 注入样式
   */
  private injectStyles(): void {
    if (this.stylesInjected) return;
    
    const style = document.createElement('style');
    style.id = 'x-actor-quick-actions-styles';
    style.textContent = `
      .x-actor-quick-tooltip {
        position: absolute;
        z-index: 10000;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        padding: 12px;
        min-width: 200px;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      }

      .x-actor-quick-tooltip.show {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }

      .x-actor-quick-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e5e7eb;
      }

      .x-actor-quick-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
        background: #f3f4f6;
      }

      .x-actor-quick-name {
        flex: 1;
        font-size: 14px;
        font-weight: 600;
        color: #1f2937;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .x-actor-quick-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .x-actor-quick-btn {
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

      .x-actor-quick-btn:hover {
        background: #e5e7eb;
        transform: translateX(2px);
      }

      .x-actor-quick-btn:active {
        transform: translateX(0);
      }

      .x-actor-quick-btn.collected {
        background: #dbeafe;
        color: #1e40af;
      }

      .x-actor-quick-btn.collected:hover {
        background: #bfdbfe;
      }

      .x-actor-quick-btn.blacklisted {
        background: #fee2e2;
        color: #991b1b;
      }

      .x-actor-quick-btn.blacklisted:hover {
        background: #fecaca;
      }

      .x-actor-quick-btn.subscribed {
        background: #d1fae5;
        color: #065f46;
      }

      .x-actor-quick-btn.subscribed:hover {
        background: #a7f3d0;
      }

      .x-actor-quick-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
      }

      .x-actor-quick-btn-icon {
        font-size: 16px;
        flex-shrink: 0;
      }

      .x-actor-quick-btn-text {
        flex: 1;
      }

      .x-actor-quick-loading {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: x-actor-quick-spin 0.6s linear infinite;
      }

      @keyframes x-actor-quick-spin {
        to { transform: rotate(360deg); }
      }

      /* 演员名字悬浮效果 */
      .x-actor-hoverable {
        position: relative;
        cursor: pointer;
        transition: color 0.2s ease;
      }

      .x-actor-hoverable:hover {
        color: #2563eb;
      }
    `;
    
    document.head.appendChild(style);
    this.stylesInjected = true;
  }

  /**
   * 从演员链接解析演员ID
   */
  private parseActorId(actorLink: HTMLAnchorElement): string | null {
    try {
      const href = actorLink.href;
      const match = href.match(/\/actors\/(\w+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * 从演员链接解析演员名字
   */
  private parseActorName(actorLink: HTMLAnchorElement): string {
    return actorLink.textContent?.trim() || '';
  }

  /**
   * 获取演员头像URL
   */
  private async getActorAvatar(actorId: string): Promise<string | undefined> {
    try {
      const actor = await actorManager.getActorById(actorId);
      return actor?.avatarUrl;
    } catch {
      return undefined;
    }
  }

  /**
   * 创建快速操作提示框
   */
  private async createTooltip(actorId: string, actorName: string, anchorElement: HTMLElement): Promise<HTMLElement> {
    const tooltip = document.createElement('div');
    tooltip.className = 'x-actor-quick-tooltip';

    // 获取演员状态
    const actor = await actorManager.getActorById(actorId);
    const isCollected = !!actor;
    const isBlacklisted = actor?.blacklisted === true;
    const subscriptions = await newWorksManager.getSubscriptions();
    const isSubscribed = subscriptions.some(s => s.actorId === actorId);
    const avatarUrl = actor?.avatarUrl;

    // 头部
    const header = document.createElement('div');
    header.className = 'x-actor-quick-header';

    if (avatarUrl) {
      const avatar = document.createElement('img');
      avatar.className = 'x-actor-quick-avatar';
      avatar.src = avatarUrl;
      avatar.alt = actorName;
      header.appendChild(avatar);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'x-actor-quick-name';
    nameEl.textContent = actorName;
    nameEl.title = actorName;
    header.appendChild(nameEl);

    tooltip.appendChild(header);

    // 操作按钮容器
    const actions = document.createElement('div');
    actions.className = 'x-actor-quick-actions';

    // 收藏按钮
    const collectBtn = this.createActionButton(
      isCollected ? '⭐' : '☆',
      isCollected ? '取消收藏' : '收藏',
      isCollected ? 'collected' : '',
      async (btn) => {
        if (isBlacklisted) {
          showToast('该演员已在黑名单，无法收藏', 'warning');
          return;
        }

        btn.disabled = true;
        const icon = btn.querySelector('.x-actor-quick-btn-icon') as HTMLElement;
        const text = btn.querySelector('.x-actor-quick-btn-text') as HTMLElement;
        const originalIcon = icon.textContent;
        const originalText = text.textContent;
        icon.innerHTML = '<span class="x-actor-quick-loading"></span>';
        text.textContent = '处理中...';

        try {
          if (isCollected) {
            // 取消收藏
            await actorManager.deleteActor(actorId);
            showToast('已取消收藏', 'success');
            emitActorStateChanged();
          } else {
            // 收藏
            const newActor: ActorRecord = {
              id: actorId,
              name: actorName,
              aliases: [],
              gender: 'unknown',
              category: 'unknown',
              profileUrl: `${window.location.origin}/actors/${actorId}`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              syncInfo: {
                source: 'javdb',
                lastSyncAt: Date.now(),
                syncStatus: 'success'
              }
            };
            await actorManager.saveActor(newActor);
            showToast('收藏成功', 'success');
            emitActorStateChanged();
          }

          // 关闭提示框并刷新
          this.hideTooltip();
        } catch (e: any) {
          console.error('[ActorQuickActions] 收藏操作失败:', e);
          showToast(`操作失败: ${e.message || '未知错误'}`, 'error');
          icon.textContent = originalIcon || '';
          text.textContent = originalText || '';
          btn.disabled = false;
        }
      }
    );
    actions.appendChild(collectBtn);

    // 拉黑按钮
    const blacklistBtn = this.createActionButton(
      isBlacklisted ? '🤍' : '🖤',
      isBlacklisted ? '取消拉黑' : '拉黑',
      isBlacklisted ? 'blacklisted' : '',
      async (btn) => {
        btn.disabled = true;
        const icon = btn.querySelector('.x-actor-quick-btn-icon') as HTMLElement;
        const text = btn.querySelector('.x-actor-quick-btn-text') as HTMLElement;
        const originalIcon = icon.textContent;
        const originalText = text.textContent;
        icon.innerHTML = '<span class="x-actor-quick-loading"></span>';
        text.textContent = '处理中...';

        try {
          // 确保演员记录存在
          let record = await actorManager.getActorById(actorId);
          if (!record) {
            const newActor: ActorRecord = {
              id: actorId,
              name: actorName,
              aliases: [],
              gender: 'unknown',
              category: 'unknown',
              profileUrl: `${window.location.origin}/actors/${actorId}`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              syncInfo: {
                source: 'javdb',
                lastSyncAt: Date.now(),
                syncStatus: 'success'
              }
            };
            await actorManager.saveActor(newActor);
            record = newActor;
          }

          const newState = !isBlacklisted;
          await actorManager.setBlacklisted(actorId, newState);
          emitActorStateChanged();
          showToast(newState ? '已拉黑该演员' : '已取消拉黑', 'success');

          // 关闭提示框并刷新
          this.hideTooltip();
        } catch (e: any) {
          console.error('[ActorQuickActions] 拉黑操作失败:', e);
          showToast(`操作失败: ${e.message || '未知错误'}`, 'error');
          icon.textContent = originalIcon || '';
          text.textContent = originalText || '';
          btn.disabled = false;
        }
      }
    );
    actions.appendChild(blacklistBtn);

    // 订阅按钮
    const subscribeBtn = this.createActionButton(
      isSubscribed ? '🔔' : '🔕',
      isSubscribed ? '取消订阅' : '订阅新作',
      isSubscribed ? 'subscribed' : '',
      async (btn) => {
        btn.disabled = true;
        const icon = btn.querySelector('.x-actor-quick-btn-icon') as HTMLElement;
        const text = btn.querySelector('.x-actor-quick-btn-text') as HTMLElement;
        const originalIcon = icon.textContent;
        const originalText = text.textContent;
        icon.innerHTML = '<span class="x-actor-quick-loading"></span>';
        text.textContent = '处理中...';

        try {
          // 确保演员记录存在
          let record = await actorManager.getActorById(actorId);
          if (!record) {
            const newActor: ActorRecord = {
              id: actorId,
              name: actorName,
              aliases: [],
              gender: 'unknown',
              category: 'unknown',
              profileUrl: `${window.location.origin}/actors/${actorId}`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              syncInfo: {
                source: 'javdb',
                lastSyncAt: Date.now(),
                syncStatus: 'success'
              }
            };
            await actorManager.saveActor(newActor);
            record = newActor;
          }

          if (isSubscribed) {
            await newWorksManager.removeSubscription(actorId);
            showToast('已取消订阅', 'success');
            emitActorStateChanged();
          } else {
            try {
              await newWorksManager.addSubscription(actorId);
              showToast('已订阅该演员的新作品', 'success');
              emitActorStateChanged();
            } catch (e: any) {
              const msg = (e && e.message) || String(e);
              if (msg && /已经订阅/.test(msg)) {
                showToast('该演员已在订阅列表', 'info');
              } else {
                throw e;
              }
            }
          }

          // 关闭提示框并刷新
          this.hideTooltip();
        } catch (e: any) {
          console.error('[ActorQuickActions] 订阅操作失败:', e);
          showToast(`操作失败: ${e.message || '未知错误'}`, 'error');
          icon.textContent = originalIcon || '';
          text.textContent = originalText || '';
          btn.disabled = false;
        }
      }
    );
    actions.appendChild(subscribeBtn);

    tooltip.appendChild(actions);

    // 定位提示框
    this.positionTooltip(tooltip, anchorElement);

    return tooltip;
  }

  /**
   * 创建操作按钮
   */
  private createActionButton(
    icon: string,
    text: string,
    className: string,
    onClick: (btn: HTMLButtonElement) => Promise<void>
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `x-actor-quick-btn ${className}`;

    const iconEl = document.createElement('span');
    iconEl.className = 'x-actor-quick-btn-icon';
    iconEl.textContent = icon;

    const textEl = document.createElement('span');
    textEl.className = 'x-actor-quick-btn-text';
    textEl.textContent = text;

    btn.appendChild(iconEl);
    btn.appendChild(textEl);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await onClick(btn);
    });

    return btn;
  }

  /**
   * 定位提示框
   */
  private positionTooltip(tooltip: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const tooltipHeight = 200; // 预估高度
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // 优先显示在下方，空间不足时显示在上方
    if (spaceBelow >= tooltipHeight || spaceBelow >= spaceAbove) {
      tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
    } else {
      tooltip.style.bottom = `${window.innerHeight - rect.top - window.scrollY + 8}px`;
    }

    // 水平居中对齐
    const left = rect.left + rect.width / 2;
    tooltip.style.left = `${left}px`;
    tooltip.style.transform = 'translateX(-50%)';
  }

  /**
   * 显示提示框
   */
  private async showTooltip(actorId: string, actorName: string, anchor: HTMLElement): Promise<void> {
    // 清除隐藏定时器
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    // 如果已有提示框，先移除
    if (this.currentTooltip) {
      this.currentTooltip.remove();
      this.currentTooltip = null;
    }

    // 创建新提示框
    const tooltip = await this.createTooltip(actorId, actorName, anchor);
    document.body.appendChild(tooltip);
    this.currentTooltip = tooltip;

    // 添加鼠标事件监听
    tooltip.addEventListener('mouseenter', () => {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    });

    tooltip.addEventListener('mouseleave', () => {
      this.scheduleHide();
    });

    // 显示动画
    requestAnimationFrame(() => {
      tooltip.classList.add('show');
    });
  }

  /**
   * 隐藏提示框
   */
  private hideTooltip(): void {
    if (!this.currentTooltip) return;

    this.currentTooltip.classList.remove('show');
    setTimeout(() => {
      if (this.currentTooltip) {
        this.currentTooltip.remove();
        this.currentTooltip = null;
      }
    }, 200);
  }

  /**
   * 计划隐藏提示框
   */
  private scheduleHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }

    this.hideTimer = window.setTimeout(() => {
      this.hideTooltip();
      this.hideTimer = null;
    }, this.config.hideDelay);
  }

  /**
   * 为演员链接添加悬浮事件
   */
  /**
   * 为演员链接绑定悬浮快捷操作（幂等）。
   * 影片页与列表页共用该入口；通过 data 属性保证同一链接只绑定一次。
   */
  public enhanceActorLink(actorLink: HTMLAnchorElement): void {
    if (actorLink.getAttribute('data-x-actor-quick-bound') === 'true') return;
    const actorId = this.parseActorId(actorLink);
    if (!actorId) return;
    actorLink.setAttribute('data-x-actor-quick-bound', 'true');

    const actorName = this.parseActorName(actorLink);
    if (!actorName) return;

    // 添加悬浮样式类
    actorLink.classList.add('x-actor-hoverable');

    // 鼠标进入事件
    actorLink.addEventListener('mouseenter', () => {
      if (this.showTimer) {
        clearTimeout(this.showTimer);
      }

      this.showTimer = window.setTimeout(() => {
        this.showTooltip(actorId, actorName, actorLink);
        this.showTimer = null;
      }, this.config.showDelay);
    });

    // 鼠标离开事件
    actorLink.addEventListener('mouseleave', () => {
      if (this.showTimer) {
        clearTimeout(this.showTimer);
        this.showTimer = null;
      }

      this.scheduleHide();
    });

    // 点击事件：如果点击的是演员链接本身（不是提示框），允许正常跳转
    // 不需要阻止默认行为，让用户可以正常点击演员名字跳转
  }

  /**
   * 初始化
   */
  /**
   * 幂等初始化：按页面类型只初始化一次。
   * - 'video'：影片详情页（/v/...）
   * - 'list'：列表页
   * 两类互不干扰；重复调用（同类型）直接返回。影片页路径保持原行为。
   */
  async ensureInit(pageType: 'video' | 'list'): Promise<void> {
    if (!this.config.enabled) return;
    if (this.initedPage === pageType) return;
    this.initedPage = pageType;

    console.log(`🎬 演员快速操作增强已启用（${pageType} 页）`);

    this.injectStyles();

    const actorLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/actors/"]');
    console.log(`找到 ${actorLinks.length} 个演员链接`);
    actorLinks.forEach(link => this.enhanceActorLink(link));

    if (this.observer) return; // 已有监听器（另一类型先 init）则复用

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const element = node as HTMLElement;
          if (element.tagName === 'A' && element.getAttribute('href')?.includes('/actors/')) {
            this.enhanceActorLink(element as HTMLAnchorElement);
          }
          element.querySelectorAll<HTMLAnchorElement>('a[href*="/actors/"]').forEach(link => {
            if (!link.classList.contains('x-actor-hoverable')) {
              this.enhanceActorLink(link);
            }
          });
        });
      });
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  /** 兼容旧入口：等价于 ensureInit('video')，且仅在影片详情页生效（保持原行为）。 */
  async init(): Promise<void> {
    const isVideoDetailPage = /\/v\/\w+/.test(window.location.pathname);
    if (!isVideoDetailPage) return;
    await this.ensureInit('video');
  }

  /**
   * 销毁
   */
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
    this.initedPage = null;
    this.hideTooltip();

    console.log('🎬 演员快速操作增强已销毁');
  }
}

// 创建单例实例
export const actorQuickActionsManager = new ActorQuickActionsManager();

/**
 * 通用演员链接绑定入口：影片页与列表页共用。
 * 幂等——同一链接只绑定一次；解析不到演员 id 的链接（如纯文本）直接跳过。
 */
export function bindActorQuickActionsToLink(actorLink: HTMLAnchorElement): void {
  actorQuickActionsManager.enhanceActorLink(actorLink);
}
function emitActorStateChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('actor-state-changed'));
  } catch {}
}
