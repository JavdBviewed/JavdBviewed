/**
 * @vitest-environment jsdom
 * @file EnhancementFeatureCard.test.tsx
 * @description 功能增强卡片通用壳的渲染契约（含 alwaysExpanded 常显语义，09-28 listtab merge）
 * @module apps/dashboard/pages/settings/enhancement
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnhancementFeatureCard } from './EnhancementFeatureCard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EnhancementFeatureCard', () => {
  it('renders the master control and each detail child exactly once', () => {
    const html = renderToStaticMarkup(
      createElement(
        EnhancementFeatureCard,
        {
          title: '测试卡片',
          meta: { icon: '✨', status: '可用', tone: 'available', effect: '测试效果' },
        },
        createElement('button', { id: 'master-control', type: 'button' }, '开关'),
        createElement('div', { id: 'detail-control' }, '配置'),
      ),
    );

    expect(html.match(/id="master-control"/g)).toHaveLength(1);
    expect(html.match(/id="detail-control"/g)).toHaveLength(1);
    expect(html).toContain('data-enhancement-feature="测试卡片"');
    expect(html).toContain('enhancement-feature-status available');
  });

  it('places usage help in the header as an icon-only disclosure control', () => {
    const html = renderToStaticMarkup(
      createElement(EnhancementFeatureCard, {
        title: '媒体库匹配',
        meta: {
          icon: '📚',
          status: '可用',
          tone: 'available',
          usageHelp: ['先完成媒体库索引。'],
        },
      }, createElement('button', { type: 'button' }, '开关')),
    );

    expect(html).toContain('enhancement-feature-card__header-actions');
    expect(html).toContain('enhancement-feature-card__help-popover');
    expect(html).toContain('title="使用帮助"');
    expect(html).toContain('fas fa-question-circle');
    expect(html).not.toContain('<summary>使用帮助</summary>');
  });
});

describe('EnhancementFeatureCard alwaysExpanded（09-28 listtab merge）', () => {
  let container: HTMLDivElement;
  let root: Root;

  function mount(node: ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(node);
    });
  }

  function renderCard(alwaysExpanded?: boolean) {
    mount(
      createElement(
        EnhancementFeatureCard,
        {
          title: '测试卡片',
          meta: { icon: '✨', status: '可用', tone: 'available', effect: '测试效果' },
          alwaysExpanded,
        },
        createElement('button', { id: 'master-control', type: 'button' }, '开关'),
        createElement('div', { id: 'detail-control' }, '配置'),
      ),
    );
    const section = container.querySelector<HTMLElement>('section.enhancement-feature-card');
    if (!section) throw new Error('card section not rendered');
    return section;
  }

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('alwaysExpanded：初渲染即常显（无 hover 可见），主开关仍居卡头', () => {
    const section = renderCard(true);
    const details = section.querySelector<HTMLElement>('.enhancement-feature-card__details');
    expect(details).not.toBeNull();
    expect(details!.className).toContain('is-open');
    expect(details!.getAttribute('aria-hidden')).toBe('false');
    expect(section.getAttribute('data-expanded')).toBe('1');
    // 首子节点（主开关）仍在卡头而非 details
    expect(section.querySelector('.enhancement-feature-card__master #master-control')).not.toBeNull();
    expect(details!.querySelector('#master-control')).toBeNull();
  });

  it('alwaysExpanded：mouseenter/mouseleave 全时序后仍不收拢（跳过 hover 定时器）', () => {
    vi.useFakeTimers();
    const section = renderCard(true);
    act(() => {
      section.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(300);
      section.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(5000);
    });
    const details = section.querySelector<HTMLElement>('.enhancement-feature-card__details');
    expect(details!.className).toContain('is-open');
    expect(section.getAttribute('data-expanded')).toBe('1');
  });

  it('负向：无 alwaysExpanded 的其他卡片维持 hover 抽屉（初收拢→hover 展开→离开收拢）', () => {
    vi.useFakeTimers();
    const section = renderCard(false);
    const details = section.querySelector<HTMLElement>('.enhancement-feature-card__details');
    expect(section.getAttribute('data-expanded')).toBe('0');
    expect(details.className).not.toContain('is-open');
    expect(details.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      section.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(300);
    });
    expect(details.className).toContain('is-open');
    expect(section.getAttribute('data-expanded')).toBe('1');
    act(() => {
      section.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(5000);
    });
    expect(details.className).not.toContain('is-open');
    expect(section.getAttribute('data-expanded')).toBe('0');
  });
});
