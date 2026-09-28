/**
 * @file renderActorRow.ts
 * @description 在列表卡片日期右侧渲染演员行：常显前 3 位女演员链接，超出时显示「+N」展开控件
 * （点击展开全部、再点收起）；展开态为 UI 瞬态（按卡片内存保留、不持久化、刷新即复位）。
 * 使用扩展专属 class/data 属性（x-ap- 前缀），不改写原站标签或卡片导航。
 * @module features/listEnhancement/actorPenetration
 */
import type { DetailActor } from './parseDetailActors';

const ROW_CLASS = 'x-ap-actor-row';
const ROW_CONTAINER_CLASS = 'x-ap-actor-row-container';
const ROW_DATA_ATTR = 'data-x-ap-actor-row';

/** 演员行默认（未展开）显示的演员数；穿透缓存与渲染层共用此口径。 */
export const ACTOR_ROW_MAX_VISIBLE = 3;

export interface ActorRowControlModel {
  /** expand=展示「+N 展开」；collapse=展示「收起」。 */
  kind: 'expand' | 'collapse';
  /** expand 态下被折叠隐藏的演员数；collapse 态恒为 0。 */
  moreCount: number;
}

export interface ActorRowModel {
  /** 行内实际渲染的演员列表。 */
  visible: DetailActor[];
  /** 展开/收起控件；无超出（或展开态下总数≤上限）时为 null。 */
  control: ActorRowControlModel | null;
}

/**
 * 纯函数：按展开态决定演员行模型。
 * - collapsed：取前 ACTOR_ROW_MAX_VISIBLE；有超出时给 expand 控件；
 * - expanded：全量展示；总数超过上限时给 collapse 控件。
 */
export function buildActorRowModel(actors: DetailActor[], expanded: boolean): ActorRowModel {
  if (expanded) {
    return {
      visible: actors,
      control: actors.length > ACTOR_ROW_MAX_VISIBLE
        ? { kind: 'collapse', moreCount: 0 }
        : null,
    };
  }
  const visible = actors.slice(0, ACTOR_ROW_MAX_VISIBLE);
  const moreCount = actors.length - visible.length;
  return {
    visible,
    control: moreCount > 0 ? { kind: 'expand', moreCount } : null,
  };
}

/**
 * 展开态（UI 瞬态）：按卡片元素内存保留，不持久化、不跨卡片共享、页面刷新即复位；
 * 同一卡片重渲染（数据刷新）时保留，避免丢失用户已展开的状态。
 */
const expandedCards = new WeakSet<HTMLElement>();

export function isActorRowExpanded(item: HTMLElement): boolean {
  return expandedCards.has(item);
}

export function setActorRowExpanded(item: HTMLElement, expanded: boolean): void {
  if (expanded) {
    expandedCards.add(item);
  } else {
    expandedCards.delete(item);
  }
}

/** JavDB 列表卡片日期元素选择器（新版 .video-date，旧版 .date / .meta）。 */
export const AP_DATE_SELECTORS = [
  '.video-date',
  '.date',
  '.meta',
].join(',');

export type ActorLinkMark = {
  /** 状态：blacklisted（黑名单）/ collected（已收藏）/ subscribed（已订阅） */
  status: 'blacklisted' | 'collected' | 'subscribed';
  /** 悬浮提示文本 */
  title?: string;
};

export interface ActorRowRenderInput {
  item: HTMLElement;
  actors: DetailActor[];
  /** 绑定演员链接的快捷操作（可选；由 manager 注入）。 */
  bindQuickActions?: (link: HTMLAnchorElement) => void;
  /**
   * 演员名称标识（可选；仅当设置“演员名称标识”开启时由 manager 注入）。
   * 返回该演员链接应呈现的状态着色/悬浮提示；返回 undefined 表示无标识。
   */
  getActorMark?: (actorId: string, actorName: string) => ActorLinkMark | undefined;
}

/**
 * 渲染（或重建）卡片演员行。成功前不插入占位行：
 * 若 actors 为空则移除已存在的行。
 *
 * 位置：卡片日期元素（.video-date / .date / .meta）右侧，与日期同行；
 * 找不到日期时回退到标题之后。字号缩小，名字之间留空隙。
 */
export function renderActorRow(input: ActorRowRenderInput): void {
  const { item, actors, bindQuickActions, getActorMark } = input;
  removeActorRow(item);
  // 清理上一轮渲染遗留的孤儿徽章（链接已随旧行移除，避免 pending 映射累积）
  pendingSubBadges.forEach((_, link) => {
    if (!link.isConnected) pendingSubBadges.delete(link);
  });

  if (actors.length === 0) return;

  const expanded = isActorRowExpanded(item);
  const model = buildActorRowModel(actors, expanded);

  const container = document.createElement('div');
  container.className = ROW_CONTAINER_CLASS;
  container.setAttribute(ROW_DATA_ATTR, 'true');

  const row = document.createElement('div');
  row.className = ROW_CLASS;
  row.setAttribute(ROW_DATA_ATTR, 'true');

  // 行首标签，便于识别这一行是演员
  const label = document.createElement('span');
  label.className = 'x-ap-actor-row-label';
  label.textContent = '女演员：';
  label.title = '演员';
  row.appendChild(label);

  model.visible.forEach(actor => {
    const name = actor.name;
    if (!name) return;
    const link = document.createElement('a');
    link.className = 'x-ap-actor';
    link.textContent = name;
    // 悬浮名称提示（默认提示；若提供标识则用其 title 覆盖）
    link.title = name;
    if (actor.href) {
      link.href = actor.href;
    }
    if (actor.id) {
      link.setAttribute('data-actor-id', actor.id);
    }
    if (bindQuickActions) {
      bindQuickActions(link);
    }
    // 标识在快捷操作绑定之后应用：绑定可能重写链接节点，保证着色/标记落在最终节点上
    if (getActorMark && actor.id) {
      applyActorMarkToLink(link, getActorMark(actor.id, name));
    }
    row.appendChild(link);
  });

  if (model.control) {
    row.appendChild(buildActorRowToggle(item, input, actors, model.control));
  }

  container.appendChild(row);
  insertRowNearDate(item, container);
  flushSubBadges(row);
}

/**
 * 构造展开/收起控件（button，行内风格与演员链接一致）：
 * - expand：「+N」，title 列出被隐藏的演员名，点击展开全部；
 * - collapse：「收起」，点击回到前 3 位。
 * a11y：aria-expanded + aria-label 含当前态。
 */
function buildActorRowToggle(
  item: HTMLElement,
  input: ActorRowRenderInput,
  actors: DetailActor[],
  control: ActorRowControlModel,
): HTMLButtonElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'x-ap-actor-more';
  if (control.kind === 'expand') {
    toggle.textContent = `+${control.moreCount}`;
    toggle.title = actors.slice(ACTOR_ROW_MAX_VISIBLE).map(a => a.name).filter(Boolean).join('、');
    toggle.setAttribute('aria-label', `展开剩余 ${control.moreCount} 位女演员`);
  } else {
    toggle.textContent = '收起';
    toggle.title = `只保留前 ${ACTOR_ROW_MAX_VISIBLE} 位`;
    toggle.setAttribute('aria-label', '收起演员列表');
  }
  toggle.setAttribute('aria-expanded', String(control.kind === 'collapse'));
  toggle.addEventListener('click', event => {
    // 阻断冒泡：卡片级点击（站点行为）不应被展开控件触发
    event.preventDefault();
    event.stopPropagation();
    setActorRowExpanded(item, !isActorRowExpanded(item));
    renderActorRow(input);
  });
  return toggle;
}

/**
 * 定位演员行：优先放在卡片日期元素右侧（同容器内、日期之后）；
 * 找不到日期时回退到标题之后，再无则追加到卡片末尾。
 */
function insertRowNearDate(item: HTMLElement, container: HTMLElement): void {
  const date = item.querySelector<HTMLElement>(AP_DATE_SELECTORS);
  if (date && date.isConnected) {
    // 与日期同容器、排在日期之后（若日期被其它 wrapper 包裹则包在该 wrapper 之后）
    const wrap = date.closest('.emby-status-wrap');
    const anchor = (wrap && wrap.parentElement === date.parentElement) ? wrap : date;
    anchor.insertAdjacentElement('afterend', container);
    return;
  }
  const title = item.querySelector('.video-title');
  if (title) {
    title.insertAdjacentElement('afterend', container);
    return;
  }
  item.appendChild(container);
}

/** 暂存“仅订阅”🔔 徽章（链接尚未入行时），挂入行后由 flushSubBadges 落到链接之后。 */
const pendingSubBadges = new Map<HTMLAnchorElement, HTMLSpanElement>();

/** 把行内暂存的 🔔 徽章挂到对应链接之后（幂等；徽章未挂则跳过）。 */
function flushSubBadges(row: HTMLElement): void {
  pendingSubBadges.forEach((badge, link) => {
    if (badge.parentElement !== null) {
      pendingSubBadges.delete(link);
      return;
    }
    if (link.parentElement !== row) return;
    link.insertAdjacentElement('afterend', badge);
    pendingSubBadges.delete(link);
  });
}

/** 把演员名称标识（着色 + 悬浮提示）应用到演员链接。 */
export function applyActorMarkToLink(link: HTMLAnchorElement, mark?: ActorLinkMark): void {
  if (!mark) return;
  // 与影片页 markActorsOnPage 一致：黑名单红 + 删除线；收藏绿；订阅另加 🔔
  if (mark.status === 'blacklisted') {
    link.style.color = '#d32f2f';
    link.style.textDecoration = 'line-through';
    link.title = mark.title || '黑名单';
  } else if (mark.status === 'collected') {
    link.style.color = '#2e7d32';
    link.style.textDecoration = 'none';
    link.title = mark.title || '已收藏';
  }
  // 仅订阅（未收藏）时追加 🔔；已收藏+已订阅用合并 title 表达，避免重复标记
  if (mark.status === 'subscribed') {
    const badge = document.createElement('span');
    badge.className = 'x-ap-actor-sub';
    badge.textContent = '🔔';
    badge.title = '已订阅';
    badge.setAttribute('aria-label', '已订阅');
    // 链接此时尚未插入行：先把徽章暂存到 pending 映射，行挂入卡片后再落到链接之后
    pendingSubBadges.set(link, badge);
  }
}

/** 移除扩展创建的演员行（幂等）。 */
export function removeActorRow(item: HTMLElement): void {
  item.querySelectorAll(`.${ROW_CONTAINER_CLASS}, [${ROW_DATA_ATTR}]`).forEach(el => el.remove());
}
