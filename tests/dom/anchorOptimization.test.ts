/**
 * @file anchorOptimization.test.ts
 * @description AnchorOptimizationManager themed floating buttons 测试
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorOptimizationManager } from '../../apps/extension/src/features/anchorOptimization/content';
import { showToast } from '../../apps/extension/src/platform/browser/toast';

vi.mock('../../apps/extension/src/platform/browser/toast', () => ({
  showToast: vi.fn(),
}));

describe('AnchorOptimizationManager themed floating buttons', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    (window as any).__JDB_VERBOSE = false;
    delete (window as any).chrome;
    vi.mocked(showToast).mockClear();
  });

  it('uses theme variables for floating anchor button colors', () => {
    const manager = new AnchorOptimizationManager() as any;

    const button = manager.createButton({
      id: 'magnet-links',
      label: '磁鏈下載',
      icon: 'M',
      target: '#magnet-links',
      enabled: true,
      order: 1,
    }) as HTMLElement;

    const styleText = document.getElementById('optimized-anchor-button-styles')?.textContent || '';

    expect(styleText).toContain('--jdb-anchor-btn-bg');
    expect(styleText).toContain('html[data-theme="dark"] .optimized-anchor-buttons');
    expect(button.style.background).toBe('');
    expect(button.style.border).toBe('');
    expect(button.style.color).toBe('');
    expect(button.classList.contains('optimized-anchor-btn')).toBe(true);
  });

  it('renders four default buttons as icon-only with hover titles and no label spans', () => {
    document.body.innerHTML =
      '<div class="tile-images"><img src="x.png"></div>' +
      '<a href="magnet:?xt=urn:btih:abc">magnet</a>';
    const manager = new AnchorOptimizationManager() as any;
    manager.createOptimizedButtons();

    const container = document.querySelector('.optimized-anchor-buttons') as HTMLElement;
    expect(container).not.toBeNull();

    const buttons = Array.from(container.querySelectorAll('a.optimized-anchor-btn')) as HTMLElement[];
    expect(buttons).toHaveLength(4);
    expect(buttons.map(b => b.getAttribute('data-target'))).toEqual([
      '.preview-images, .tile-images',
      '#magnet-links',
      'top',
      'close-current',
    ]);

    const titles = ['預覽圖', '磁鏈下載', 'TOP', '關閉當前頁面'];
    buttons.forEach((b, i) => {
      expect(b.title, 'button ' + i + ' title').toBe(titles[i]);
      expect(b.classList.contains('optimized-anchor-btn-icon-only')).toBe(true);
      // 纯图标：唯一子节点=icon span，无 label span
      expect(b.children).toHaveLength(1);
      expect(b.children[0].className).toBe('optimized-anchor-btn-icon');
      // 40x40 近正方形
      expect(b.style.width).toBe('40px');
      expect(b.style.height).toBe('40px');
      expect(b.style.padding).toBe('0px');
    });

    // icon 18px 锁（CSS 族）
    const styleText = document.getElementById('optimized-anchor-button-styles')?.textContent || '';
    expect(styleText).toContain('.optimized-anchor-btn-icon-only .optimized-anchor-btn-icon');
    expect(styleText).toContain('font-size: 18px');
  });

  it('keeps custom buttons (no iconOnly) with label span and 80px min-width form', () => {
    const manager = new AnchorOptimizationManager() as any;
    const button = manager.createButton({
      id: 'custom-x',
      label: '自訂',
      icon: 'X',
      target: '#x',
      enabled: true,
      order: 9,
    }) as HTMLElement;

    expect(button.title).toBe('');
    expect(button.classList.contains('optimized-anchor-btn-icon-only')).toBe(false);
    expect(button.children).toHaveLength(2);
    expect(button.children[0].className).toBe('optimized-anchor-btn-icon');
    expect(button.children[1].textContent).toBe('自訂');
    expect(button.style.minWidth).toBe('80px');
  });

  it('close-current click sends CLOSE_CURRENT_TAB to background', async () => {
    const manager = new AnchorOptimizationManager() as any;
    const button = manager.createButton({
      id: 'close-current',
      label: '關閉當前頁面',
      icon: '✖️',
      target: 'close-current',
      enabled: true,
      order: 4,
      iconOnly: true,
    }) as HTMLElement;
    document.body.appendChild(button);

    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    (window as any).chrome = { runtime: { sendMessage } };

    button.click();
    await new Promise(r => setTimeout(r, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'CLOSE_CURRENT_TAB' });
  });

  it('close-current failure shows error toast', async () => {
    const manager = new AnchorOptimizationManager() as any;
    const button = manager.createButton({
      id: 'close-current',
      label: '關閉當前頁面',
      icon: '✖️',
      target: 'close-current',
      enabled: true,
      order: 4,
      iconOnly: true,
    }) as HTMLElement;
    document.body.appendChild(button);

    const sendMessage = vi.fn().mockRejectedValue(new Error('nope'));
    (window as any).chrome = { runtime: { sendMessage } };

    button.click();
    await new Promise(r => setTimeout(r, 0));

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('關閉當前頁面失敗', 'error');
  });
});
