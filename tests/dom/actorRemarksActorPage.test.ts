/**
 * @file actorRemarksActorPage.test.ts
 * @description 演员页「演员备注」节点渲染测试（骨架/成功/失败）
 * @module tests/dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildActorRemarksNode,
  cleanActorRemarksNodes,
  type ActorRemarksNodeOptions,
} from '../../apps/extension/src/features/actorRemarks/actorPageEnhancer';
import type { ActorRemarks } from '../../apps/extension/src/features/actorRemarks';

const DATA: ActorRemarks = {
  name: '祈山愛',
  age: 28,
  heightCm: 160,
  cup: 'B',
  retired: true,
  wikiUrl: 'https://ja.wikipedia.org/wiki/祈山愛',
  xslistUrl: 'https://xslist.org/a/1',
  source: 'wikipedia',
  fetchedAt: 1700000000000,
};

function inject(opts: ActorRemarksNodeOptions) {
  const nameEl = document.createElement('h1');
  nameEl.className = 'actor-section-name';
  nameEl.textContent = '祈山愛';
  document.body.appendChild(nameEl);
  const node = buildActorRemarksNode(opts);
  nameEl.insertAdjacentElement('afterend', node);
  return node;
}

describe('actor remarks actor-page node', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a loading skeleton first (panel mode)', () => {
    const node = inject({ mode: 'panel', name: '祈山愛', phase: 'loading' });
    expect(node.id).toBe('enhanced-actor-remarks-actorpage');
    expect(node.textContent).toContain('演员备注');
    expect(node.textContent).toContain('备注加载中…');
    // 骨架紧跟在演员名后面
    expect(node.previousElementSibling?.className).toBe('actor-section-name');
  });

  it('renders loading skeleton in inline mode', () => {
    const node = inject({ mode: 'inline', name: '祈山愛', phase: 'loading' });
    expect(node.className).toBe('jdb-actor-remarks-inline actor-page');
    expect(node.textContent).toContain('…');
  });

  it('renders badge on success with data (panel)', () => {
    const node = inject({ mode: 'panel', name: '祈山愛', phase: 'success', data: DATA });
    expect(node.textContent).toContain('28');
    expect(node.textContent).toContain('160cm');
    expect(node.textContent).toContain('B');
    expect(node.textContent).toContain('引退');
  });

  it('renders wiki/xslist links on success without data (panel)', () => {
    const node = inject({ mode: 'panel', name: '祈山愛', phase: 'success', data: null });
    const links = Array.from(node.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Wiki', 'xslist']);
    expect(decodeURIComponent(links[0].getAttribute('href') || '')).toBe('https://ja.wikipedia.org/wiki/祈山愛');
  });

  it('renders failure state with reason and links (panel)', () => {
    const node = inject({ mode: 'panel', name: '祈山愛', phase: 'failure', failureMessage: 'timeout' });
    expect(node.textContent).toContain('备注获取失败');
    expect(node.textContent).toContain('timeout');
    const links = Array.from(node.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Wiki', 'xslist']);
  });

  it('renders failure state with links (inline)', () => {
    const node = inject({ mode: 'inline', name: '祈山愛', phase: 'failure', failureMessage: 'HTTP 403' });
    expect(node.textContent).toContain('备注获取失败');
    const links = Array.from(node.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Wiki', 'xslist']);
  });

  it('cleanActorRemarksNodes removes both inline and panel nodes (idempotent re-injection)', () => {
    inject({ mode: 'panel', name: '祈山愛', phase: 'loading' });
    const inline = buildActorRemarksNode({ mode: 'inline', name: '祈山愛', phase: 'loading' });
    document.body.appendChild(inline);
    expect(document.getElementById('enhanced-actor-remarks-actorpage')).not.toBeNull();
    expect(document.querySelector('.jdb-actor-remarks-inline.actor-page')).not.toBeNull();

    cleanActorRemarksNodes();

    expect(document.getElementById('enhanced-actor-remarks-actorpage')).toBeNull();
    expect(document.querySelector('.jdb-actor-remarks-inline.actor-page')).toBeNull();
  });

  it('success with data does not show links in panel (badge only)', () => {
    const node = inject({ mode: 'panel', name: '祈山愛', phase: 'success', data: DATA });
    expect(node.querySelectorAll('a').length).toBe(0);
  });
});
