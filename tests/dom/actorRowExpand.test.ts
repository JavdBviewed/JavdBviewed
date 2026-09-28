/**
 * @file actorRowExpand.test.ts
 * @description 列表演员行「展开更多」DOM 测试（09-29-actor-penetration-expand）：
 * 常显前 3 位 + 「+N」展开控件（button，a11y 完整）→ 点击全量展开 → 再点收起；
 * 展开态跨同卡片重渲染保留；≤3 人无控件；removeActorRow 清理。
 * @module tests/dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTOR_ROW_MAX_VISIBLE,
  buildActorRowModel,
  removeActorRow,
  renderActorRow,
} from '../../apps/extension/src/features/listEnhancement/actorPenetration/renderActorRow';
import type { DetailActor } from '../../apps/extension/src/features/listEnhancement/actorPenetration/parseDetailActors';

const ACTORS: DetailActor[] = Array.from({ length: 6 }, (_, i) => ({
  id: `a${i + 1}`,
  name: `女演员${i + 1}`,
  href: `/actors/a${i + 1}`,
  gender: 'female',
}));

function renderItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <div class="video-title"><a class="video-title-link" href="/v/abc123">ABC-123</a></div>
    <span class="video-date">2026-09-29</span>
  `;
  document.body.appendChild(item);
  return item;
}

const visibleLinks = (item: HTMLElement): string[] =>
  [...item.querySelectorAll('a.x-ap-actor')].map(l => l.textContent);

describe('列表演员行展开更多（常显 3 + 点击展开）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('常显前 3 位 + 「+N」控件（button），a11y 含当前态', () => {
    const item = renderItem();
    renderActorRow({ item, actors: ACTORS });
    expect(visibleLinks(item)).toEqual(['女演员1', '女演员2', '女演员3']);
    const toggle = item.querySelector('button.x-ap-actor-more');
    expect(toggle).toBeTruthy();
    expect(toggle?.textContent).toBe(`+${ACTORS.length - ACTOR_ROW_MAX_VISIBLE}`);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('展开剩余 3 位女演员');
    expect(toggle?.title).toBe('女演员4、女演员5、女演员6');
  });

  it('点击展开 → 全量 6 位 + 「收起」控件', () => {
    const item = renderItem();
    renderActorRow({ item, actors: ACTORS });
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(visibleLinks(item)).toEqual(ACTORS.map(a => a.name));
    const toggle = item.querySelector('button.x-ap-actor-more')!;
    expect(toggle.textContent).toBe('收起');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('收起演员列表');
    // 行容器唯一，无重复节点
    expect(item.querySelectorAll('.x-ap-actor-row-container').length).toBe(1);
  });

  it('再点收起 → 回到前 3 位 + 「+N」', () => {
    const item = renderItem();
    renderActorRow({ item, actors: ACTORS });
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(visibleLinks(item).length).toBe(6);
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(visibleLinks(item)).toEqual(['女演员1', '女演员2', '女演员3']);
    expect(item.querySelector('button.x-ap-actor-more')?.textContent).toBe('+3');
  });

  it('展开态跨同卡片重渲染保留；其他卡片默认收拢', () => {
    const item = renderItem();
    const other = renderItem();
    renderActorRow({ item, actors: ACTORS });
    renderActorRow({ item: other, actors: ACTORS });
    item.querySelector('button.x-ap-actor-more')!.click();
    renderActorRow({ item, actors: ACTORS }); // 模拟穿透缓存刷新重渲染
    renderActorRow({ item: other, actors: ACTORS });
    expect(visibleLinks(item).length).toBe(6);
    expect(visibleLinks(other)).toEqual(['女演员1', '女演员2', '女演员3']);
  });

  it('≤ 3 位演员：无展开控件', () => {
    for (const n of [1, 2, 3]) {
      const item = renderItem();
      renderActorRow({ item, actors: ACTORS.slice(0, n) });
      expect(item.querySelector('.x-ap-actor-more')).toBeNull();
      expect(visibleLinks(item).length).toBe(n);
      item.remove();
    }
  });

  it('展开控件点击不触发卡片级点击', () => {
    const item = renderItem();
    const clicked: string[] = [];
    item.addEventListener('click', () => clicked.push('card'));
    renderActorRow({ item, actors: ACTORS });
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(clicked).toEqual([]);
  });

  it('removeActorRow 清理展开控件（展开态下同样生效）', () => {
    const item = renderItem();
    renderActorRow({ item, actors: ACTORS });
    item.querySelector('button.x-ap-actor-more')!.click();
    expect(visibleLinks(item).length).toBe(6);
    removeActorRow(item);
    expect(item.querySelector('.x-ap-actor-row-container')).toBeNull();
    expect(item.querySelector('button.x-ap-actor-more')).toBeNull();
  });

  it('buildActorRowModel 纯函数口径与渲染一致', () => {
    expect(buildActorRowModel(ACTORS, false)).toMatchObject({
      visible: ACTORS.slice(0, 3),
      control: { kind: 'expand', moreCount: 3 },
    });
    expect(buildActorRowModel(ACTORS, true)).toMatchObject({
      visible: ACTORS,
      control: { kind: 'collapse', moreCount: 0 },
    });
    expect(buildActorRowModel(ACTORS.slice(0, 3), false).control).toBeNull();
  });
});
