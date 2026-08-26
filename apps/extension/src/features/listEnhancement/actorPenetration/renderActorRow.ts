/**
 * @file renderActorRow.ts
 * @description 在列表卡片日期右侧渲染演员行：最多 3 个演员链接，超出时追加省略标识。
 * 使用扩展专属 class/data 属性（x-ap- 前缀），不改写原站标签或卡片导航。
 * @module features/listEnhancement/actorPenetration
 */
import type { DetailActor } from './parseDetailActors';

const ROW_CLASS = 'x-ap-actor-row';
const ROW_CONTAINER_CLASS = 'x-ap-actor-row-container';
const MAX_VISIBLE = 3;
const ROW_DATA_ATTR = 'data-x-ap-actor-row';

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

  if (actors.length === 0) return;

  const visible = actors.slice(0, MAX_VISIBLE);
  const moreCount = actors.length - visible.length;

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

  visible.forEach(actor => {
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

  if (moreCount > 0) {
    const more = document.createElement('span');
    more.className = 'x-ap-actor-more';
    more.textContent = `+${moreCount}`;
    more.title = actors.slice(MAX_VISIBLE).map(a => a.name).filter(Boolean).join('、');
    row.appendChild(more);
  }

  container.appendChild(row);
  insertRowNearDate(item, container);
  flushSubBadges(row);
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
