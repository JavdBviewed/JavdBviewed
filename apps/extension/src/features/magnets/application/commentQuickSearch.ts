/**
 * @file commentQuickSearch.ts
 * @description 磁力区「短評」评论区选文快速搜索的纯逻辑（作用域/长度门控、站内搜索 URL、浮标定位）
 * @module features/magnets
 *
 * 设计约束（09-29 侦察定案，见 .trellis/tasks/09-29-magnet-comment-quicksearch/research/）：
 * - 评论正文选择器同时覆盖站点原生短評与扩展破解注入的长評（两者同构：`.review-item .content`）；
 * - 搜索 URL 必须基于**当前镜像域名**（window.location.origin），严禁硬编码 javdb.com；
 * - 本模块不触碰 DOM，全部为可单测的纯函数。
 */

/** 选中文本最小长度（字符，按 Unicode 码点计数） */
export const COMMENT_QUICK_SEARCH_MIN_LENGTH = 1;

/** 选中文本最大长度（字符，按 Unicode 码点计数）；超出视为「划了整段」而非检索意图 */
export const COMMENT_QUICK_SEARCH_MAX_LENGTH = 30;

/**
 * 磁力区评论区正文作用域选择器。
 *
 * 真机实测（javdb575 /v/4VBXZ，2026-09-29）评论区结构：
 * `div#tabs-container > div#reviews[data-movie-tab-target="reviews"] > article.message.video-panel
 *  > div.message-body > dl.review-items > dt.review-item > div.content > p`
 * 扩展破解注入的评论为 `dt.review-item.jhs-review-item > div.content.jdb-review-content > p.jdb-review-text`，
 * 同样命中 `.review-item .content`，故一套选择器覆盖两种来源。
 */
export const COMMENT_QUICK_SEARCH_SCOPE_SELECTORS: readonly string[] = [
  '#tabs-container [data-movie-tab-target="reviews"] .review-item .content',
  '#reviews .review-item .content',
];

/** 合并后的作用域选择器（供 `Element.closest` / `querySelector` 直接使用） */
export const COMMENT_QUICK_SEARCH_SCOPE_SELECTOR = COMMENT_QUICK_SEARCH_SCOPE_SELECTORS.join(', ');

/** 浮标不展示的原因（用于日志与单测断言，不外露给用户） */
export type CommentQuickSearchRejectReason =
  | 'empty-selection'
  | 'out-of-comment-area'
  | 'too-long'
  | 'unknown-origin';

export type CommentQuickSearchDecision =
  | { show: true; query: string; url: string }
  | { show: false; reason: CommentQuickSearchRejectReason };

export interface CommentQuickSearchInput {
  /** `window.getSelection().toString()` 的原始文本（可含换行与首尾空白） */
  selectedText: string | null | undefined;
  /** 选区公共祖先是否命中评论区作用域（由调用方用 `Element.closest` 计算后传入） */
  inCommentArea: boolean;
  /** 当前页面 `window.location.origin`，例如 `https://javdb575.com` */
  origin: string | null | undefined;
}

/** 视口内矩形（`DOMRect` 的结构子集，便于纯函数化与单测） */
export interface CommentQuickSearchRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface CommentQuickSearchViewport {
  width: number;
  height: number;
}

export interface CommentQuickSearchFloatMetrics {
  /** 浮标宽度（px） */
  width: number;
  /** 浮标高度（px） */
  height: number;
  /** 浮标与选区末端的间距（px） */
  gap: number;
  /** 浮标与视口边缘的最小留白（px） */
  margin: number;
}

export interface CommentQuickSearchPosition {
  top: number;
  left: number;
  /** 选区末端不在视口内时为 false（调用方应隐藏浮标，而不是把它钉在屏幕边缘） */
  visible: boolean;
  /** 右侧放不下时翻到选区左侧 */
  flipped: boolean;
}

/**
 * 归一化选中文本：合并所有空白（含跨 `<p>` 选择产生的换行）为单个空格并去首尾空白。
 */
export function normalizeCommentQuickSearchQuery(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * 按 Unicode 码点计数，避免中日韩/emoji 被 `length`（UTF-16 单元）高估。
 */
export function countCommentQuickSearchChars(text: string): number {
  return Array.from(text).length;
}

/**
 * 长度门控：归一化后 1~30 字（含端点）。
 */
export function isCommentQuickSearchLengthAllowed(text: string): boolean {
  const count = countCommentQuickSearchChars(normalizeCommentQuickSearchQuery(text));
  return count >= COMMENT_QUICK_SEARCH_MIN_LENGTH && count <= COMMENT_QUICK_SEARCH_MAX_LENGTH;
}

/**
 * 构造站内搜索 URL —— **始终基于传入的 origin（当前镜像域名）**。
 *
 * origin 非法（空、相对路径、非 http/https 协议如 `chrome-extension:`）时返回 null，
 * 由调用方放弃展示浮标；这里刻意不提供任何站点兜底，避免把用户搜索发到错误域名。
 */
export function buildCommentQuickSearchUrl(
  origin: string | null | undefined,
  query: string | null | undefined,
): string | null {
  const normalizedQuery = normalizeCommentQuickSearchQuery(query);
  if (!normalizedQuery) return null;

  const rawOrigin = typeof origin === 'string' ? origin.trim() : '';
  if (!rawOrigin) return null;

  let base: URL;
  try {
    base = new URL(rawOrigin);
  } catch {
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;

  return `${base.origin}/search?q=${encodeURIComponent(normalizedQuery)}&f=all`;
}

/**
 * 单一门控入口：作用域 + 非空 + 长度 + origin 合法性，一次判定是否展示浮标。
 */
export function decideCommentQuickSearch(input: CommentQuickSearchInput): CommentQuickSearchDecision {
  if (!input.inCommentArea) return { show: false, reason: 'out-of-comment-area' };

  const query = normalizeCommentQuickSearchQuery(input.selectedText);
  if (!query) return { show: false, reason: 'empty-selection' };
  if (countCommentQuickSearchChars(query) > COMMENT_QUICK_SEARCH_MAX_LENGTH) {
    return { show: false, reason: 'too-long' };
  }

  const url = buildCommentQuickSearchUrl(input.origin, query);
  if (!url) return { show: false, reason: 'unknown-origin' };

  return { show: true, query, url };
}

/**
 * 依据选区末端矩形计算浮标的 `position: fixed` 坐标，并做视口裁剪。
 *
 * - 默认放在选区**右侧**（末端 rect 的 right + gap），垂直方向与末端行居中对齐；
 * - 右侧放不下时翻到左侧；仍放不下则贴边（margin）；
 * - 末端 rect 完全在视口外（懒加载评论区常位于折叠线以下）→ `visible: false`，调用方隐藏浮标。
 */
export function computeCommentQuickSearchPosition(
  rect: CommentQuickSearchRect,
  viewport: CommentQuickSearchViewport,
  metrics: CommentQuickSearchFloatMetrics,
): CommentQuickSearchPosition {
  const inViewport =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < viewport.height &&
    rect.right > 0 &&
    rect.left < viewport.width;

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max < min ? min : max);

  const minLeft = metrics.margin;
  const maxLeft = Math.max(minLeft, viewport.width - metrics.margin - metrics.width);
  const minTop = metrics.margin;
  const maxTop = Math.max(minTop, viewport.height - metrics.margin - metrics.height);

  let left = rect.right + metrics.gap;
  let flipped = false;
  if (left + metrics.width > viewport.width - metrics.margin) {
    const flippedLeft = rect.left - metrics.gap - metrics.width;
    if (flippedLeft >= minLeft) {
      left = flippedLeft;
      flipped = true;
    }
  }
  left = clamp(left, minLeft, maxLeft);

  const centeredTop = rect.top + rect.height / 2 - metrics.height / 2;
  const top = clamp(centeredTop, minTop, maxTop);

  return { top, left, visible: inViewport, flipped };
}

/**
 * 生效口径（开关 × 页面类型）——**唯一真源**。
 *
 * `bootstrap` 首屏初始化与 `contentMessageRouter` 的 `settings-updated` live reapply 必须共用本函数：
 * 两处门控一旦漂移，就会出现「只有刷新才生效」或「关不掉」这类只在单侧复现的缺陷
 * （09-29 真机红绿取证：live 开关不生效正是因为 router 侧完全缺失该维度）。
 */
export interface CommentQuickSearchActivationInput {
  /** `settings.userExperience.enableMagnetCommentQuickSearch`（默认 false，需容忍脏值） */
  enabled: unknown;
  /** 当前页面是否影片详情页（`location.pathname.startsWith('/v/')`） */
  isVideoPage: boolean;
}

/** 开关严格为 `true` 且当前为影片详情页时才生效（其余页面保持零开销）。 */
export function isCommentQuickSearchActive(input: CommentQuickSearchActivationInput): boolean {
  return input.enabled === true && input.isVideoPage === true;
}
