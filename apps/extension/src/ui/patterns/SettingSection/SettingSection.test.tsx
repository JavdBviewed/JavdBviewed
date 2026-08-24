/**
 * @file SettingSection.test.tsx
 * @description SettingSection 基础渲染合约
 * @module ui/patterns
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingSection } from './SettingSection';

describe('SettingSection pattern', () => {
  it('renders title, description and children', () => {
    const html = renderToStaticMarkup(
      createElement(
        SettingSection,
        {
          title: '番号过滤',
          description: '控制列表中的隐藏策略',
        },
        createElement('div', null, '内容行'),
      ),
    );
    expect(html).toContain('番号过滤');
    expect(html).toContain('控制列表中的隐藏策略');
    expect(html).toContain('内容行');
    expect(html).toContain('data-ui-pattern="setting-section"');
    expect(html).toContain('bg-[var(--color-surface)]');
  });

  it('applies contentClassName on body wrapper', () => {
    const html = renderToStaticMarkup(
      createElement(
        SettingSection,
        {
          title: '演员过滤',
          contentClassName: 'sm:grid-cols-2',
        },
        createElement('span', null, 'row'),
      ),
    );
    expect(html).toContain('sm:grid-cols-2');
  });

  it('renders an optional section icon without changing the title contract', () => {
    const html = renderToStaticMarkup(
      createElement(
        SettingSection,
        {
          title: '基础配置',
          icon: createElement('i', { className: 'fas fa-cog' }),
        },
        createElement('span', null, 'row'),
      ),
    );
    expect(html).toContain('setting-section__icon');
    expect(html).toContain('fas fa-cog');
    expect(html).toContain('基础配置');
  });
});
