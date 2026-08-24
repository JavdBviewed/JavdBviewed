/**
 * @file EnhancementFeatureCard.test.tsx
 * @description 功能增强卡片通用壳的渲染契约
 * @module apps/dashboard/pages/settings/enhancement
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EnhancementFeatureCard } from './EnhancementFeatureCard';

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
