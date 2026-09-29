/**
 * @file Tabs.test.tsx
 * @description Tabs 渲染合约
 * @module ui/primitives
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

describe('Tabs primitive', () => {
  it('renders tablist and selected tab', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        items: [
          { id: 'a', label: '甲' },
          { id: 'b', label: '乙' },
        ],
        value: 'b',
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('甲');
    expect(html).toContain('乙');
    expect(html).toContain('aria-selected="true"');
  });

  it('wires tab id / aria-controls for tabpanel association (09-29-cftabs)', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        items: [
          { id: 'numeric', label: '番号' },
          { id: 'rules', label: '规则' },
        ],
        value: 'numeric',
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain('id="tab-numeric"');
    expect(html).toContain('aria-controls="tabpanel-numeric"');
    expect(html).toContain('id="tab-rules"');
    expect(html).toContain('aria-controls="tabpanel-rules"');
  });

  it('idPrefix namespaces button id / aria-controls (09-29-cftabs 嵌套 tab 防重名)', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        items: [
          { id: 'actor', label: '演员过滤' },
        ],
        value: 'actor',
        onChange: vi.fn(),
        idPrefix: 'cf-',
      }),
    );
    expect(html).toContain('id="cf-tab-actor"');
    expect(html).toContain('aria-controls="cf-tabpanel-actor"');
    expect(html).not.toContain('id="tab-actor"');
  });
});
