/**
 * @file renderActorRow.ts
 * @description 在列表卡片标题下方渲染演员行：最多 3 个演员链接，超出时追加省略标识。
 * 使用扩展专属 class/data 属性（x-ap- 前缀），不改写原站标签或卡片导航。
 * @module features/listEnhancement/actorPenetration
 */
import type { DetailActor } from './parseDetailActors';

const ROW_CLASS = 'x-ap-actor-row';
const ROW_CONTAINER_CLASS = 'x-ap-actor-row-container';
const MAX_VISIBLE = 3;
const ROW_DATA_ATTR = 'data-x-ap-actor-row';

export interface ActorRowRenderInput {
  item: HTMLElement;
  actors: DetailActor[];
  /** 绑定演员链接的快捷操作（可选；由 manager 注入）。 */
  bindQuickActions?: (link: HTMLAnchorElement) => void;
}

/**
 * 渲染（或重建）卡片演员行。成功前不插入占位行：
 * 若 actors 为空则移除已存在的行。
 */
export function renderActorRow(input: ActorRowRenderInput): void {
  const { item, actors, bindQuickActions } = input;
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

  visible.forEach(actor => {
    const name = actor.name;
    if (!name) return;
    const link = document.createElement('a');
    link.className = 'x-ap-actor';
    link.textContent = name;
    if (actor.href) {
      link.href = actor.href;
    }
    if (actor.id) {
      link.setAttribute('data-actor-id', actor.id);
    }
    if (bindQuickActions) {
      bindQuickActions(link);
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
  insertRowAfterTitle(item, container);
}

/** 在标题元素后插入演员行；找不到标题时追加到卡片末尾。 */
function insertRowAfterTitle(item: HTMLElement, container: HTMLElement): void {
  const title = item.querySelector('.video-title');
  if (title && title.parentNode === item) {
    title.insertAdjacentElement('afterend', container);
  } else {
    item.appendChild(container);
  }
}

/** 移除扩展创建的演员行（幂等）。 */
export function removeActorRow(item: HTMLElement): void {
  item.querySelectorAll(`.${ROW_CONTAINER_CLASS}, [${ROW_DATA_ATTR}]`).forEach(el => el.remove());
}
