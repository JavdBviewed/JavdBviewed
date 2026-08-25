/**
 * @vitest-environment jsdom
 * @file renderActorRow.test.ts
 * @description 卡片演员行渲染/清理测试
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it, vi } from 'vitest';
import { removeActorRow, renderActorRow } from './renderActorRow';
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
  it('最多渲染 3 个演员链接，超出显示省略标识', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(5) });
    const links = item.querySelectorAll('a.x-ap-actor');
    const more = item.querySelector('.x-ap-actor-more');
    expect(links.length).toBe(3);
    expect([...links].map(l => l.textContent)).toEqual(['演员1', '演员2', '演员3']);
    expect(more?.textContent).toBe('+2');
    expect(more?.title).toBe('演员4、演员5');
  });

  it('演员行插入在标题之后', () => {
    const item = makeItem();
    renderActorRow({ item, actors: actors(2) });
    const title = item.querySelector('.video-title')!;
    const container = item.querySelector('.x-ap-actor-row-container')!;
    expect(title.nextElementSibling).toBe(container);
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
