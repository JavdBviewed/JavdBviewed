/**
 * @vitest-environment jsdom
 * @file renderActorRow.test.ts
 * @description 卡片演员行渲染/清理测试
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildActorRowModel,
  isActorRowExpanded,
  removeActorRow,
  renderActorRow,
  setActorRowExpanded,
} from './renderActorRow';
import type { DetailActor } from './parseDetailActors';

function makeItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  const title = document.createElement('div');
  title.className = 'video-title';
  const strong = document.createElement('strong');
  strong.textContent = 'ABC-123';
  title.appendChild(strong);
  item.appendChild(title);
  const date = document.createElement('div');
  date.className = 'video-date';
  date.textContent = '2026-08-20';
  item.appendChild(date);
  document.body.appendChild(item);
  return item;
}

const actors = (n: number): DetailActor[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i + 1}`,
    name: `演员${i + 1}`,
    href: `/actors/a${i + 1}`,
    gender: 'female' as const,
  }));

describe('renderActorRow', () => {
  it('常显前 3 个演员链接，超出显示「+N」展开控件（button），行首带"女演员："标签', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(5) });
    const label = item.querySelector('.x-ap-actor-row-label');
    expect(label).toBeTruthy();
    expect(label?.textContent).toBe('女演员：');
    const links = item.querySelectorAll('a.x-ap-actor');
    const more = item.querySelector('button.x-ap-actor-more');
    expect(links.length).toBe(3);
    expect([...links].map(l => l.textContent)).toEqual(['演员1', '演员2', '演员3']);
    expect(more).toBeTruthy();
    expect(more?.textContent).toBe('+2');
    expect(more?.title).toBe('演员4、演员5');
    expect(more?.getAttribute('aria-expanded')).toBe('false');
    expect(more?.getAttribute('aria-label')).toBe('展开剩余 2 位女演员');
  });

  it('点击「+N」展开全部演员，控件变为「收起」', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(5) });
    const more = item.querySelector('button.x-ap-actor-more')!;
    more.click();
    const links = item.querySelectorAll('a.x-ap-actor');
    expect(links.length).toBe(5);
    expect(item.querySelector('.x-ap-actor-row-container')).toBeTruthy();
    const collapse = item.querySelector('button.x-ap-actor-more')!;
    expect(collapse.textContent).toBe('收起');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.getAttribute('aria-label')).toBe('收起演员列表');
    expect(item.querySelectorAll('.x-ap-actor-row-container').length).toBe(1);
  });

  it('再次点击「收起」回到前 3 位 + 「+N」', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(5) });
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(5);
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(3);
    const more = item.querySelector('button.x-ap-actor-more')!;
    expect(more.textContent).toBe('+2');
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('演员数 ≤ 3 时不显示展开控件', () => {
    for (const n of [1, 2, 3]) {
      const item = makeItem();
      renderActorRow({ item, actors: actors(n) });
      expect(item.querySelector('.x-ap-actor-more')).toBeNull();
      expect(item.querySelectorAll('a.x-ap-actor').length).toBe(n);
      item.remove();
    }
  });

  it('展开态跨同卡片重渲染保留（数据刷新不丢失），新卡片默认收拢', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(5) });
    item.querySelector('button.x-ap-actor-more')!.click();
    // 模拟缓存刷新后的重渲染：同一 item 再渲染一次
    renderActorRow({ item, actors: actors(5) });
    expect(isActorRowExpanded(item)).toBe(true);
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(5);
    // 新卡片不受影响（默认收拢）
    const other = makeItem();
    renderActorRow({ item: other, actors: actors(5) });
    expect(isActorRowExpanded(other)).toBe(false);
    expect(other.querySelectorAll('a.x-ap-actor').length).toBe(3);
  });

  it('setActorRowExpanded(false) 后重渲染回到收拢态', () => {
    const item = makeItem();
    setActorRowExpanded(item, true);
    renderActorRow({ item, actors: actors(4) });
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(4);
    setActorRowExpanded(item, false);
    renderActorRow({ item, actors: actors(4) });
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(3);
    expect(item.querySelector('button.x-ap-actor-more')?.textContent).toBe('+1');
  });

  it('展开控件点击不冒泡到卡片（stopPropagation）', () => {
    const item = makeItem();
    const cardClick = vi.fn();
    item.addEventListener('click', cardClick);
    renderActorRow({ item, actors: actors(4) });
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(cardClick).not.toHaveBeenCalled();
  });

  it('演员行插入在日期右侧（同行）', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(2) });
    const date = item.querySelector('.video-date')!;
    const container = item.querySelector('.x-ap-actor-row-container')!;
    expect(date.nextElementSibling).toBe(container);
  });

  it('无日期元素时回退到标题之后', () => {
    const item = makeItem();
    item.querySelector('.video-date')!.remove();
    renderActorRow({ item, actors: actors(2) });
    const title = item.querySelector('.video-title')!;
    const container = item.querySelector('.x-ap-actor-row-container')!;
    expect(title.nextElementSibling).toBe(container);
  });

  it('提供 getActorMark 时对演员链接着色并加悬浮提示', () => {
    const item = makeItem();
    const getActorMark = vi.fn((id: string) =>
      id === 'a2' ? { status: 'collected', title: '已收藏' } : undefined,
    );
    renderActorRow({ item, actors: actors(3), getActorMark });
    const links = item.querySelectorAll('a.x-ap-actor');
    // 默认悬浮名称
    expect(links[0].title).toBe('演员1');
    // 被标识的链接：绿色 + 收藏提示
    expect((links[1] as HTMLElement).style.color).toBe('rgb(46, 125, 50)');
    expect(links[1].title).toBe('已收藏');
  });

  it('订阅标识追加 🔔 标记', () => {
    const item = makeItem();
    const getActorMark = vi.fn((id: string) =>
      id === 'a1' ? { status: 'subscribed', title: '已订阅' } : undefined,
    );
    renderActorRow({ item, actors: actors(3), getActorMark });
    const badge = item.querySelector('.x-ap-actor-sub');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('🔔');
  });

  it('空演员列表不插入行，并清理已有行', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(3) });
    expect(item.querySelector('.x-ap-actor-row-container')).toBeTruthy();
    renderActorRow({ item, actors: [] });
    expect(item.querySelector('.x-ap-actor-row-container')).toBeNull();
  });

  it('重新渲染时先清理旧行，避免重复节点', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(3) });
    renderActorRow({ item, actors: actors(4) });
    expect(item.querySelectorAll('.x-ap-actor-row-container').length).toBe(1);
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(3);
  });

  it('展开后重渲染清理旧行的残留徽章暂存（无孤儿 pending）', () => {
    const item = makeItem();
    const getActorMark = (id: string) =>
      id === 'a4' ? { status: 'subscribed', title: '已订阅' } : undefined;
    renderActorRow({ item, actors: actors(5), getActorMark });
    // 收拢态：a4 被折叠，徽章暂存于 pending 映射
    expect(item.querySelector('.x-ap-actor-sub')).toBeNull();
    item.querySelector('button.x-ap-actor-more')!.click();
    // 展开后 a4 的 🔔 徽章落到新链接之后
    const links = [...item.querySelectorAll('a.x-ap-actor')];
    const a4 = links.find(l => l.getAttribute('data-actor-id') === 'a4')!;
    expect(a4.nextElementSibling?.textContent).toBe('🔔');
  });

  it('为每个演员链接绑定快捷操作', () => {
    const item = makeItem();
    const bind = vi.fn();
    renderActorRow({ item, actors: actors(3), bindQuickActions: bind });
    expect(bind).toHaveBeenCalledTimes(3);
  });

  it('removeActorRow 幂等', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(3) });
    removeActorRow(item);
    removeActorRow(item);
    expect(item.querySelector('[data-x-ap-actor-row]')).toBeNull();
  });
});

describe('buildActorRowModel（纯函数）', () => {
  it('收拢态：取前 3，超出给 expand 控件', () => {
    const model = buildActorRowModel(actors(5), false);
    expect(model.visible.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(model.control).toEqual({ kind: 'expand', moreCount: 2 });
  });

  it('收拢态：≤ 3 人无控件', () => {
    for (const n of [0, 1, 3]) {
      const model = buildActorRowModel(actors(n), false);
      expect(model.visible.length).toBe(n);
      expect(model.control).toBeNull();
    }
  });

  it('展开态：全量展示，超 3 人给 collapse 控件', () => {
    const model = buildActorRowModel(actors(5), true);
    expect(model.visible.length).toBe(5);
    expect(model.control).toEqual({ kind: 'collapse', moreCount: 0 });
  });

  it('展开态：≤ 3 人无控件（防御：无超出不可达展开）', () => {
    const model = buildActorRowModel(actors(3), true);
    expect(model.visible.length).toBe(3);
    expect(model.control).toBeNull();
  });
});
