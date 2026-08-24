/**
 * @file Modal.test.tsx
 * @description Modal 开关态渲染合约
 * @module ui/primitives
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal primitive', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        open: false,
        title: '标题',
        onClose: vi.fn(),
        children: '内容',
      }),
    );
    expect(html).toBe('');
  });

  it('renders dialog when open', () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        open: true,
        title: '确认操作',
        onClose: vi.fn(),
        children: '说明文字',
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('确认操作');
    expect(html).toContain('说明文字');
    expect(html).toContain('fa-times');
    expect(html).not.toContain('关闭遮罩');
    expect(html).not.toContain('color-overlay');
  });
});
