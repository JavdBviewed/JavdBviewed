/**
 * @vitest-environment jsdom
 * @file EnhancementFeatureCard.test.tsx
 * @description 功能增强卡片通用壳的渲染契约与默认 hover 抽屉行为（09-29：alwaysExpanded 机制已整体移除）
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

describe('EnhancementFeatureCard 默认 hover 抽屉（09-29：alwaysExpanded 机制移除后全部卡片的契约）', () => {
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

  function renderCard() {
    mount(
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

  it('默认收拢（data-expanded=0）→ hover 展开 → 离开收拢', () => {
    vi.useFakeTimers();
    const section = renderCard();
    const details = section.querySelector<HTMLElement>('.enhancement-feature-card__details');
    expect(section.getAttribute('data-expanded')).toBe('0');
    expect(details.className).not.toContain('is-open');
    expect(details.getAttribute('aria-hidden')).toBe('true');
    // 首子节点（主开关）在卡头而非 details
    expect(section.querySelector('.enhancement-feature-card__master #master-control')).not.toBeNull();
    expect(details!.querySelector('#master-control')).toBeNull();
    act(() => {
      section.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(300);
    });
    expect(details.className).toContain('is-open');
    expect(section.getAttribute('data-expanded')).toBe('1');
    expect(details.getAttribute('aria-hidden')).toBe('false');
    act(() => {
      section.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(5000);
    });
    expect(details.className).not.toContain('is-open');
    expect(section.getAttribute('data-expanded')).toBe('0');
  });
});

describe('EnhancementFeatureCard 调度优先级徽章（10-25-enhancement-priority-badge）', () => {
  it('提供 priorityBadge 时卡头渲染 phase 徽章（与 status 徽章同排）', () => {
    const html = renderToStaticMarkup(
      createElement(
        EnhancementFeatureCard,
        {
          title: '快捷操作',
          meta: { icon: '⚡', status: '可用', tone: 'available' },
          priorityBadge: {
            phase: 'critical',
            labels: ['list:observe:init', 'listEnhancement:init'],
            tooltip: '调度中心优先级：critical。对应任务：列表页观察器初始化（list:observe:init）、列表增强初始化（listEnhancement:init）',
          },
        },
        createElement('button', { type: 'button' }, '开关'),
      ),
    );
    expect(html).toContain('enhancement-feature-priority is-critical');
    expect(html).toMatch(/>critical</);
    // 徽章位于标题容器内（与 status 徽章同排）
    const titleIdx = html.indexOf('enhancement-feature-title');
    const badgeIdx = html.indexOf('enhancement-feature-priority');
    const statusIdx = html.indexOf('enhancement-feature-status');
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(badgeIdx).toBeGreaterThan(titleIdx);
    expect(statusIdx).toBeGreaterThan(titleIdx);
  });

  it('默认不渲染优先级徽章（video/actor/other 子页零影响）', () => {
    const html = renderToStaticMarkup(
      createElement(
        EnhancementFeatureCard,
        {
          title: '磁力资源搜索',
          meta: { icon: '🧲', status: '可用', tone: 'available' },
        },
        createElement('button', { type: 'button' }, '开关'),
      ),
    );
    expect(html).not.toContain('enhancement-feature-priority');
  });
});
