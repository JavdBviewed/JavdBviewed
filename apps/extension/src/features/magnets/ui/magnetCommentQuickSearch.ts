/**
 * @file magnetCommentQuickSearch.ts
 * @description 磁力区「短評」评论区选文快速搜索：选中文本后在选区末端弹出 🔎 浮标，点击新标签页站内搜索
 * @module features/magnets
 *
 * 作用域与门控见 `../application/commentQuickSearch`（纯逻辑，可单测）。
 * 真机侦察（javdb575 /v/4VBXZ，2026-09-29）确认评论区为纯 DOM（0 iframe / 0 canvas / 0 shadowRoot），
 * `selectionchange` 可覆盖懒加载的「短評」页签，无需 MutationObserver 逐节点绑定。
 *
 * 零开销约束：开关关闭时 `initialize()` 直接返回，不注册任何监听、不注入任何样式。
 */
import {
  COMMENT_QUICK_SEARCH_SCOPE_SELECTOR,
  buildCommentQuickSearchUrl,
  computeCommentQuickSearchPosition,
  decideCommentQuickSearch,
  normalizeCommentQuickSearchQuery,
  type CommentQuickSearchRect,
} from '../application/commentQuickSearch';

export const MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID = 'jdb-magnet-comment-quick-search-styles';
export const MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID = 'jdb-magnet-comment-quick-search-float';

/** 浮标尺寸/间距，需与注入 CSS 保持一致（定位计算用） */
const FLOAT_WIDTH = 28;
const FLOAT_HEIGHT = 28;
const FLOAT_GAP = 8;
const FLOAT_MARGIN = 8;

/** 点击浮标后短暂抑制 selectionchange，避免同一次交互重复开窗 */
const POST_CLICK_SUPPRESS_MS = 400;

export interface MagnetCommentQuickSearchConfig {
  enabled: boolean;
}

export class MagnetCommentQuickSearchManager {
  private config: MagnetCommentQuickSearchConfig = { enabled: false };
  private installed = false;
  private floatEl: HTMLButtonElement | null = null;
  private pendingUrl = '';
  private dragging = false;
  private suppressUntil = 0;

  private readonly handleSelectionChange = (): void => {
    this.evaluateSelection();
  };

  private readonly handlePointerDown = (event: PointerEvent | MouseEvent): void => {
    if (this.isFloatTarget(event.target)) return;
    // 选区被点击打断：先隐藏，拖拽期间不再复现，保证浮标不挡后续选择操作
    this.dragging = true;
    this.hide();
  };

  private readonly handlePointerUp = (): void => {
    this.dragging = false;
    // 拖拽期间的 selectionchange 被抑制（避免浮标追着光标闪），
    // 抬手时必须补一次评估，否则「拖选完成」这一最常见的入口永远不出浮标（09-29 真机红绿实证）。
    this.evaluateSelection();
  };

  /**
   * 指针流被中断：必须解除拖拽闭锁，否则闭锁永久卡死，浮标直到下一次成功抬手前都不会再出现。
   *
   * 触发场景（09-29 真机时序取证，javdb575 /v/4VBXZ）：在**已有选区内**再次按下并拖动时，Chrome 转入
   * 原生文本拖放，事件序列为 `dragstart → pointercancel → drag×N → dragend`，**不发 pointerup/mouseup/click**，
   * 只靠 `handlePointerUp` 解锁会永远等不到。窗口失焦（鼠标在窗口外松开）同理。
   */
  private readonly handlePointerAbort = (): void => {
    this.dragging = false;
    this.hide();
  };

  private readonly handleDragStart = (): void => {
    // 拖放期间不展示浮标（避免浮标跟着拖拽影像跑）
    this.dragging = true;
    this.hide();
  };

  private readonly handleDragEnd = (): void => {
    this.dragging = false;
    // 原生拖放结束后原选区通常依然有效：按当前选区重新判定，该复现就复现（不挡后续选择操作）
    this.evaluateSelection();
  };

  private readonly handleViewportShift = (): void => {
    this.hide();
  };

  private readonly handleFloatClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const url = this.pendingUrl;
    if (!url) return;
    this.suppressUntil = Date.now() + POST_CLICK_SUPPRESS_MS;
    this.hide();
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // 弹窗被拦截时静默放弃：浮标只是便捷入口，站点搜索仍可从地址栏进入
    }
  };

  /**
   * 更新开关；关闭时立即卸载监听与浮标（回到零开销状态）。
   */
  updateConfig(config: Partial<MagnetCommentQuickSearchConfig>): void {
    if (typeof config.enabled === 'boolean') {
      this.config = { ...this.config, enabled: config.enabled };
    }
    if (!this.config.enabled && this.installed) {
      this.destroy();
    }
  }

  /**
   * 挂载入口：仅在开关开启时注册监听。可重复调用（幂等）。
   */
  initialize(): void {
    if (!this.config.enabled) return;
    if (typeof document === 'undefined') return;
    this.install();
  }

  /**
   * 卸载全部监听、浮标节点与注入样式。
   */
  destroy(): void {
    if (!this.installed) return;
    this.installed = false;
    this.dragging = false;
    this.pendingUrl = '';

    document.removeEventListener('selectionchange', this.handleSelectionChange);
    document.removeEventListener('pointerdown', this.handlePointerDown, true);
    document.removeEventListener('mousedown', this.handlePointerDown, true);
    document.removeEventListener('pointerup', this.handlePointerUp, true);
    document.removeEventListener('mouseup', this.handlePointerUp, true);
    document.removeEventListener('pointercancel', this.handlePointerAbort, true);
    document.removeEventListener('dragstart', this.handleDragStart, true);
    document.removeEventListener('dragend', this.handleDragEnd, true);
    window.removeEventListener('blur', this.handlePointerAbort);
    window.removeEventListener('scroll', this.handleViewportShift, true);
    window.removeEventListener('resize', this.handleViewportShift);
    document.removeEventListener('visibilitychange', this.handleViewportShift);

    this.floatEl?.remove();
    this.floatEl = null;
    document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID)?.remove();
  }

  /** 测试/诊断用：浮标当前是否可见 */
  isFloatVisible(): boolean {
    return Boolean(this.floatEl && !this.floatEl.hidden);
  }

  /** 测试/诊断用：浮标当前指向的搜索 URL */
  getPendingUrl(): string {
    return this.pendingUrl;
  }

  private install(): void {
    if (this.installed) return;
    this.installed = true;

    injectMagnetCommentQuickSearchStyles();
    this.ensureFloat();

    document.addEventListener('selectionchange', this.handleSelectionChange);
    // capture + 浮标自身例外：点击页面别处（含浮标以外的任何位置）立即隐藏
    document.addEventListener('pointerdown', this.handlePointerDown, true);
    document.addEventListener('mousedown', this.handlePointerDown, true);
    document.addEventListener('pointerup', this.handlePointerUp, true);
    document.addEventListener('mouseup', this.handlePointerUp, true);
    // 原生拖放 / 指针流中断：解除拖拽闭锁的兜底（详见 handlePointerAbort 注释）
    document.addEventListener('pointercancel', this.handlePointerAbort, true);
    document.addEventListener('dragstart', this.handleDragStart, true);
    document.addEventListener('dragend', this.handleDragEnd, true);
    window.addEventListener('blur', this.handlePointerAbort);
    window.addEventListener('scroll', this.handleViewportShift, true);
    window.addEventListener('resize', this.handleViewportShift);
    document.addEventListener('visibilitychange', this.handleViewportShift);
  }

  private ensureFloat(): HTMLButtonElement {
    const existing = document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID) as HTMLButtonElement | null;
    if (existing) {
      this.floatEl = existing;
      existing.hidden = true;
      return existing;
    }

    const float = document.createElement('button');
    float.type = 'button';
    float.id = MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID;
    float.className = 'jdb-mcqs-float';
    float.hidden = true;
    float.textContent = '🔎';
    float.setAttribute('aria-label', '在新标签页搜索选中文本');
    float.addEventListener('click', this.handleFloatClick);
    // 浮标自身按下时不清空选区、不触发隐藏
    float.addEventListener('pointerdown', (event) => event.stopPropagation());
    float.addEventListener('mousedown', (event) => event.stopPropagation());
    document.body.appendChild(float);
    this.floatEl = float;
    return float;
  }

  private isFloatTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Node)) return false;
    return target === this.floatEl || Boolean(this.floatEl?.contains(target));
  }

  private evaluateSelection(): void {
    if (!this.installed) return;
    if (this.dragging) return;
    if (Date.now() < this.suppressUntil) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.hide();
      return;
    }

    const range = selection.getRangeAt(0);
    const scope = resolveCommentScope(range.commonAncestorContainer);
    const decision = decideCommentQuickSearch({
      selectedText: selection.toString(),
      inCommentArea: Boolean(scope),
      origin: window.location?.origin ?? '',
    });

    if (!decision.show) {
      this.hide();
      return;
    }

    const anchorRect = resolveSelectionEndRect(range);
    if (!anchorRect) {
      this.hide();
      return;
    }

    const position = computeCommentQuickSearchPosition(
      anchorRect,
      { width: window.innerWidth, height: window.innerHeight },
      { width: FLOAT_WIDTH, height: FLOAT_HEIGHT, gap: FLOAT_GAP, margin: FLOAT_MARGIN },
    );
    if (!position.visible) {
      this.hide();
      return;
    }

    this.show(decision.url, decision.query, position.top, position.left);
  }

  private show(url: string, query: string, top: number, left: number): void {
    const float = this.ensureFloat();
    this.pendingUrl = url;
    float.title = `搜索「${query}」`;
    float.dataset.jdbMcqsQuery = normalizeCommentQuickSearchQuery(query);
    float.style.top = `${Math.round(top)}px`;
    float.style.left = `${Math.round(left)}px`;
    float.hidden = false;
  }

  private hide(): void {
    this.pendingUrl = '';
    if (this.floatEl) {
      this.floatEl.hidden = true;
      delete this.floatEl.dataset.jdbMcqsQuery;
    }
  }
}

/**
 * 判定选区是否落在磁力区评论区正文内。
 * 用 `commonAncestorContainer` 的元素化祖先做 `closest`，跨 `<p>`/跨内联链接（如番号识别生成的
 * `.jdb-review-code-link`）的选区同样能命中。
 */
export function resolveCommentScope(node: Node | null | undefined): Element | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element || typeof element.closest !== 'function') return null;
  return element.closest(COMMENT_QUICK_SEARCH_SCOPE_SELECTOR);
}

/**
 * 取选区**末端**的可视矩形：优先 `getClientRects()` 的最后一个非空矩形（跨行选择时才是真正的末端），
 * 退化到 `getBoundingClientRect()`。矩形全空（例如选区仅含折叠节点）时返回 null。
 */
export function resolveSelectionEndRect(range: Range): CommentQuickSearchRect | null {
  const rects = Array.from(range.getClientRects?.() ?? []);
  const last = [...rects].reverse().find(rect => rect.width > 0 || rect.height > 0);
  const rect = last ?? range.getBoundingClientRect();
  if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function injectMagnetCommentQuickSearchStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID;
  style.textContent = `
    .jdb-mcqs-float {
      --jdb-mcqs-bg: #ffffff;
      --jdb-mcqs-fg: #0f172a;
      --jdb-mcqs-border: rgba(15, 23, 42, 0.14);
      --jdb-mcqs-hover-bg: #eff6ff;
      --jdb-mcqs-shadow: 0 6px 18px rgba(15, 23, 42, 0.20);
      position: fixed;
      z-index: 2147483000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: ${FLOAT_WIDTH}px;
      height: ${FLOAT_HEIGHT}px;
      margin: 0;
      padding: 0;
      border: 1px solid var(--jdb-mcqs-border);
      border-radius: 999px;
      background: var(--jdb-mcqs-bg);
      color: var(--jdb-mcqs-fg);
      box-shadow: var(--jdb-mcqs-shadow);
      font-family: "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      -webkit-appearance: none;
      appearance: none;
      pointer-events: auto;
      transition: transform 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
    }

    .jdb-mcqs-float:hover {
      background: var(--jdb-mcqs-hover-bg);
      transform: scale(1.08);
    }

    .jdb-mcqs-float:active {
      transform: scale(0.96);
    }

    .jdb-mcqs-float[hidden] {
      display: none !important;
    }

    html[data-theme="dark"] .jdb-mcqs-float {
      --jdb-mcqs-bg: #1f2937;
      --jdb-mcqs-fg: #f8fafc;
      --jdb-mcqs-border: rgba(148, 163, 184, 0.28);
      --jdb-mcqs-hover-bg: #1d4ed8;
      --jdb-mcqs-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    }
  `;
  document.head.appendChild(style);
}

/** 兜底导出：外部（诊断脚本）可基于当前 origin 直接构造站内搜索 URL */
export { buildCommentQuickSearchUrl };

export const magnetCommentQuickSearchManager = new MagnetCommentQuickSearchManager();
