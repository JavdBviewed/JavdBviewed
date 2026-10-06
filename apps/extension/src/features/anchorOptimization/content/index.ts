/**
 * @file index.ts
 * @description 锚点优化（详情页快速跳转按钮）统一导出
 * @module features/anchorOptimization
 */
// src/features/anchorOptimization/content/index.ts
// 锚点优化功能 - 优化页面快捷按钮位置和添加预览图快捷方式

import { log } from '../../contentState';
import { showToast } from '../../../platform/browser/toast';

export interface AnchorOptimizationConfig {
  enabled: boolean;
  showPreviewButton: boolean;
  buttonPosition: 'right-center' | 'right-bottom';
  customButtons: AnchorButton[];
}

export interface AnchorButton {
  id: string;
  label: string;
  icon?: string;
  target: string; // CSS selector or anchor
  enabled: boolean;
  order: number;
  iconOnly?: boolean; // 纯图标按钮（无文字 label，title 悬浮显示文案）；默认 false 保持原 label 形态
}

export class AnchorOptimizationManager {
  private config: AnchorOptimizationConfig;
  private optimizedButtons: HTMLElement | null = null;
  private originalButtons: HTMLElement | null = null;
  private isInitialized = false;

  constructor(config: Partial<AnchorOptimizationConfig> = {}) {
    this.config = {
      enabled: true,
      showPreviewButton: true,
      buttonPosition: 'right-center',
      customButtons: [],
      ...config,
    };
  }

  /**
   * 初始化锚点优化功能
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled || this.isInitialized) {
      return;
    }

    // 检查是否在详情页
    if (!this.isDetailPage()) {
      log('Anchor optimization skipped: not on detail page');
      return;
    }

    try {
      log('Initializing anchor optimization on detail page...');

      // 调试：记录页面上的可用锚点
      this.logAvailableAnchors();

      // 查找原始按钮
      this.findOriginalButtons();

      if (this.originalButtons) {
        // 创建优化后的按钮
        this.createOptimizedButtons();

        // 隐藏原始按钮
        this.hideOriginalButtons();
      } else {
        // 即使没有原始按钮，也创建优化按钮
        this.createOptimizedButtons();
      }

      this.isInitialized = true;
      log('Anchor optimization initialized on detail page');
    } catch (error) {
      log('Error initializing anchor optimization:', error);
    }
  }

  /**
   * 检查是否在详情页
   */
  private isDetailPage(): boolean {
    // 检查URL是否为详情页格式 (/v/xxx)
    const isDetailUrl = /\/v\/[^\/]+/.test(window.location.pathname);

    // 检查页面是否有详情页特有的元素
    const hasDetailElements = !!(
      document.querySelector('.movie-panel-info') ||
      document.querySelector('.video-detail') ||
      document.querySelector('.movie-info') ||
      document.querySelector('.preview-images') ||
      document.querySelector('.tile-images') ||
      document.querySelector('[href^="magnet:"]')
    );

    const isDetailPage = isDetailUrl || hasDetailElements;

    if (!isDetailPage) {
      log(`Not a detail page - URL: ${window.location.pathname}, hasDetailElements: ${hasDetailElements}`);
    }

    return isDetailPage;
  }

  /**
   * 记录页面上可用的锚点（调试用）
   */
  private logAvailableAnchors(): void {
    const anchors: string[] = [];

    // 查找所有带ID的元素
    const elementsWithId = document.querySelectorAll('[id]');
    elementsWithId.forEach(el => {
      if (el.id) {
        anchors.push(`#${el.id}`);
      }
    });

    // 查找所有带name的锚点
    const namedAnchors = document.querySelectorAll('a[name]');
    namedAnchors.forEach(el => {
      const name = el.getAttribute('name');
      if (name) {
        anchors.push(`#${name}`);
      }
    });

    log('Available anchors on page:', anchors);

    // 特别检查磁链和预览图相关元素
    const magnetElements = document.querySelectorAll('[href^="magnet:"], [class*="magnet"], [id*="magnet"]');
    const previewElements = document.querySelectorAll('[class*="preview"], [class*="tile"], img[src*="sample"]');

    log('Magnet-related elements found:', magnetElements.length);
    log('Preview-related elements found:', previewElements.length);
  }

  /**
   * 查找原始的浮动按钮
   */
  private findOriginalButtons(): void {
    this.originalButtons = document.querySelector('.float-buttons') as HTMLElement;
    if (!this.originalButtons) {
      log('Original float buttons not found');
    }
  }

  /**
   * 创建优化后的按钮组
   */
  private createOptimizedButtons(): void {
    this.injectOptimizedButtonStyles();
    this.optimizedButtons = document.createElement('div');
    this.optimizedButtons.className = 'optimized-anchor-buttons';
    this.optimizedButtons.style.cssText = this.getButtonContainerStyles();

    // 添加默认按钮（包括预览图、磁链、TOP、关闭当前页面）
    this.addDefaultButtons();

    // 添加自定义按钮
    this.addCustomButtons();

    // 添加到页面
    document.body.appendChild(this.optimizedButtons);
  }

  /**
   * 获取按钮容器样式
   */
  private getButtonContainerStyles(): string {
    const position = this.config.buttonPosition === 'right-center' 
      ? 'top: 50%; transform: translateY(-50%);'
      : 'bottom: 100px;';

    return `
      position: fixed;
      right: 20px;
      ${position}
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
  }

  /**
   * 添加默认按钮（预览图、磁链下载、返回顶部）
   */
  private addDefaultButtons(): void {
    const buttons: HTMLElement[] = [];

    // 1. 预览图按钮 - 优先显示，如果有预览内容
    if (this.config.showPreviewButton && this.checkPreviewContent()) {
      const previewButton = this.createButton({
        id: 'preview-images',
        label: '預覽圖',
        icon: '🖼️',
        target: '.preview-images, .tile-images',
        enabled: true,
        order: 1,
        iconOnly: true,
      });
      if (previewButton) buttons.push(previewButton);
    }

    // 2. 磁链下载按钮 - 只在有磁链内容时显示
    if (this.checkMagnetContent()) {
      const magnetButton = this.createButton({
        id: 'magnet-links',
        label: '磁鏈下載',
        icon: '🧲',
        target: '#magnet-links',
        enabled: true,
        order: 2,
        iconOnly: true,
      });
      if (magnetButton) buttons.push(magnetButton);
    }

    // 3. 返回顶部按钮 - 总是显示
    const topButton = this.createButton({
      id: 'scroll-top',
      label: 'TOP',
      icon: '⬆️',
      target: 'top',
      enabled: true,
      order: 3,
      iconOnly: true,
    });
    if (topButton) buttons.push(topButton);

    // 4. 关闭当前页面按钮 - 总是显示（纯图标，点击经 background 执行 chrome.tabs.remove）
    const closeButton = this.createButton({
      id: 'close-current',
      label: '關閉當前頁面',
      icon: '✖️',
      target: 'close-current',
      enabled: true,
      order: 4,
      iconOnly: true,
    });
    if (closeButton) buttons.push(closeButton);

    // 按顺序添加所有按钮
    buttons.forEach(button => {
      this.optimizedButtons?.appendChild(button);
    });
  }

  /**
   * 检查页面是否有磁链相关内容
   */
  private checkMagnetContent(): boolean {
    // 检查是否有磁链链接
    if (document.querySelector('[href^="magnet:"]')) {
      return true;
    }

    // 检查是否有磁链相关的文本或元素
    const magnetKeywords = ['磁链', '磁鏈', '下载', '下載', 'magnet', 'download'];
    const textContent = document.body.textContent?.toLowerCase() || '';

    return magnetKeywords.some(keyword => textContent.includes(keyword.toLowerCase()));
  }



  /**
   * 检查页面是否有预览图内容
   */
  private checkPreviewContent(): boolean {
    // 检查常见的预览图选择器
    const previewSelectors = [
      '.preview-images',
      '.tile-images',
      '.message-body .tile-images',
      '.preview-video-container',
      '[class*="preview"]',
      '[class*="tile"]',
      'img[src*="sample"]',
      'img[src*="preview"]'
    ];

    for (const selector of previewSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return true;
        }
      } catch (e) {
        // 忽略无效选择器错误
      }
    }

    // 检查是否有多张图片（可能是预览图）
    const images = document.querySelectorAll('img');
    return images.length > 3; // 如果有超过3张图片，可能包含预览图
  }

  /**
   * 添加自定义按钮
   */
  private addCustomButtons(): void {
    this.config.customButtons
      .filter(btn => btn.enabled)
      .sort((a, b) => a.order - b.order)
      .forEach(buttonConfig => {
        const button = this.createButton(buttonConfig);
        if (button) {
          this.optimizedButtons?.appendChild(button);
        }
      });
  }

  /**
   * 创建单个按钮
   */
  private createButton(config: AnchorButton): HTMLElement | null {
    this.injectOptimizedButtonStyles();
    const button = document.createElement('a');
    button.className = 'optimized-anchor-btn';
    button.setAttribute('data-target', config.target);
    
    // 设置按钮样式（iconOnly=纯图标 40x40 近正方形，title 悬浮显示文案；否则保持原 label 形态）
    if (config.iconOnly) {
      button.title = config.label;
      button.classList.add('optimized-anchor-btn-icon-only');
      button.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        min-width: 40px;
        border-radius: 12px;
        text-decoration: none;
        transition: all 0.3s ease;
        cursor: pointer;
        padding: 0;
        backdrop-filter: blur(10px);
      `;
    } else {
      button.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 80px;
        height: 40px;
        border-radius: 20px;
        text-decoration: none;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.3s ease;
        cursor: pointer;
        padding: 0 12px;
        gap: 4px;
        backdrop-filter: blur(10px);
      `;
    }

    // 添加内容（iconOnly 仅 icon span；否则 icon span + label span 原形态）
    if (config.icon) {
      const icon = document.createElement('span');
      icon.textContent = config.icon;
      icon.className = 'optimized-anchor-btn-icon';
      button.appendChild(icon);
    }

    if (!config.iconOnly) {
      const label = document.createElement('span');
      label.textContent = config.label;
      button.appendChild(label);
    }

    // 添加点击事件
    button.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleButtonClick(config.target);
    });

    return button;
  }

  private injectOptimizedButtonStyles(): void {
    const styleId = 'optimized-anchor-button-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .optimized-anchor-buttons {
        --jdb-anchor-btn-bg: rgba(255, 255, 255, 0.94);
        --jdb-anchor-btn-bg-hover: rgba(255, 255, 255, 0.99);
        --jdb-anchor-btn-border: rgba(15, 23, 42, 0.14);
        --jdb-anchor-btn-text: #1f2937;
        --jdb-anchor-btn-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
        --jdb-anchor-btn-shadow-hover: 0 10px 24px rgba(15, 23, 42, 0.18);
      }

      html[data-theme="dark"] .optimized-anchor-buttons {
        --jdb-anchor-btn-bg: rgba(31, 41, 55, 0.92);
        --jdb-anchor-btn-bg-hover: rgba(55, 65, 81, 0.96);
        --jdb-anchor-btn-border: rgba(148, 163, 184, 0.24);
        --jdb-anchor-btn-text: #e5e7eb;
        --jdb-anchor-btn-shadow: 0 8px 22px rgba(0, 0, 0, 0.34);
        --jdb-anchor-btn-shadow-hover: 0 12px 30px rgba(0, 0, 0, 0.42);
      }

      @media (prefers-color-scheme: dark) {
        html:not([data-theme="light"]) .optimized-anchor-buttons {
          --jdb-anchor-btn-bg: rgba(31, 41, 55, 0.92);
          --jdb-anchor-btn-bg-hover: rgba(55, 65, 81, 0.96);
          --jdb-anchor-btn-border: rgba(148, 163, 184, 0.24);
          --jdb-anchor-btn-text: #e5e7eb;
          --jdb-anchor-btn-shadow: 0 8px 22px rgba(0, 0, 0, 0.34);
          --jdb-anchor-btn-shadow-hover: 0 12px 30px rgba(0, 0, 0, 0.42);
        }
      }

      .optimized-anchor-btn {
        background: var(--jdb-anchor-btn-bg) !important;
        border: 1px solid var(--jdb-anchor-btn-border) !important;
        color: var(--jdb-anchor-btn-text) !important;
        box-shadow: var(--jdb-anchor-btn-shadow) !important;
        transform: scale(1);
      }

      .optimized-anchor-btn:hover {
        background: var(--jdb-anchor-btn-bg-hover) !important;
        box-shadow: var(--jdb-anchor-btn-shadow-hover) !important;
        color: var(--jdb-anchor-btn-text) !important;
        transform: scale(1.05);
      }

      .optimized-anchor-btn-icon {
        font-size: 14px;
      }

      .optimized-anchor-btn-icon-only .optimized-anchor-btn-icon {
        font-size: 18px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 处理按钮点击
   */
  private handleButtonClick(target: string): void {
    try {
      if (target === 'close-current') {
        // 关闭当前页面：content 无 chrome.tabs 权限，经 background 执行 chrome.tabs.remove
        chrome.runtime.sendMessage({ type: 'CLOSE_CURRENT_TAB' }).catch((error) => {
          log('Close current tab failed:', error);
          showToast('關閉當前頁面失敗', 'error');
        });
        return;
      }
      if (target === 'top') {
        // 返回顶部
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('已返回顶部', 'success');
      } else if (target.startsWith('#')) {
        // 锚点跳转 - 尝试多个可能的选择器
        const possibleSelectors = [
          target, // 原始目标
          target.replace('#', ''), // 移除#号
          `[id="${target.substring(1)}"]`, // 属性选择器
          `a[name="${target.substring(1)}"]`, // name属性
        ];

        let element: Element | null = null;
        for (const selector of possibleSelectors) {
          try {
            element = document.querySelector(selector);
            if (element) break;
          } catch (e) {
            // 忽略无效选择器错误
          }
        }

        if (element) {
          // 优化跳转位置 - 使用更精确的定位
          this.scrollToElementWithOffset(element, -10);
          showToast(`已跳转到目标区域`, 'success');
        } else {
          // 如果是磁链下载，尝试查找相关元素
          if (target === '#magnet-links') {
            const magnetElements = this.findMagnetLinksSection();
            if (magnetElements) {
              this.scrollToElementWithOffset(magnetElements, -10);
              showToast('已跳转到磁链下载区域', 'success');
              return;
            }
          }
          showToast(`未找到目标元素，请检查页面内容`, 'warning');
        }
      } else {
        // CSS选择器跳转 - 尝试多个可能的预览图选择器
        const previewSelectors = [
          target,
          '.preview-images',
          '.tile-images',
          '.message-body .tile-images',
          '.preview-video-container',
          '[class*="preview"]',
          '[class*="tile"]'
        ];

        let element: Element | null = null;
        for (const selector of previewSelectors) {
          try {
            const found = document.querySelector(selector);
            if (found && this.isValidPreviewElement(found)) {
              element = found;
              break;
            }
          } catch (e) {
            // 忽略无效选择器错误
          }
        }

        if (element) {
          // 尝试找到预览图区域的更好起始位置
          const betterTarget = this.findBetterPreviewTarget(element);
          const targetElement = betterTarget || element;

          // 优化跳转位置 - 使用更精确的定位
          this.scrollToElementWithOffset(targetElement, -30); // 向上偏移30px，确保标题可见
          showToast('已跳转到预览图区域', 'success');
        } else {
          showToast('当前页面未找到预览图区域', 'warning');
        }
      }
    } catch (error) {
      log('Error handling button click:', error);
      showToast('跳转失败', 'error');
    }
  }

  /**
   * 查找磁链下载区域
   */
  private findMagnetLinksSection(): Element | null {
    // 尝试多种可能的磁链区域选择器
    const magnetSelectors = [
      '#magnet-links',
      '.magnet-links',
      '[id*="magnet"]',
      '[class*="magnet"]',
      'section:has([href^="magnet:"])',
      '.movie-panel-info', // JavDB的详情面板
      '.panel-block', // JavDB的面板块
      '.message-body', // JavDB的消息体
    ];

    for (const selector of magnetSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          // 检查是否包含磁链相关内容
          const text = element.textContent?.toLowerCase() || '';
          if (text.includes('磁') || text.includes('下载') || text.includes('magnet') ||
              element.querySelector('[href^="magnet:"]')) {
            return element;
          }
        }
      } catch (e) {
        // 忽略无效选择器错误
      }
    }

    // 如果都没找到，尝试查找包含磁链的任何元素
    const magnetLinks = document.querySelectorAll('[href^="magnet:"]');
    if (magnetLinks.length > 0) {
      // 返回第一个磁链的父容器
      let parent = magnetLinks[0].parentElement;
      while (parent && parent !== document.body) {
        if (parent.offsetHeight > 100) { // 找到一个有足够高度的容器
          return parent;
        }
        parent = parent.parentElement;
      }
      return magnetLinks[0].parentElement;
    }

    return null;
  }

  /**
   * 验证是否为有效的预览图元素
   */
  private isValidPreviewElement(element: Element): boolean {
    // 检查元素是否可见
    const htmlElement = element as HTMLElement;
    if (htmlElement.offsetWidth === 0 || htmlElement.offsetHeight === 0) {
      return false;
    }

    // 检查是否包含图片
    const images = element.querySelectorAll('img');
    if (images.length > 0) {
      return true;
    }

    // 检查是否包含预览相关的类名或文本
    const className = element.className.toLowerCase();
    const textContent = element.textContent?.toLowerCase() || '';

    const previewKeywords = ['preview', 'tile', '预览', '图片', 'sample', 'gallery'];
    return previewKeywords.some(keyword =>
      className.includes(keyword) || textContent.includes(keyword)
    );
  }

  /**
   * 查找预览图区域的更好起始位置
   */
  private findBetterPreviewTarget(element: Element): Element | null {
    // 尝试找到预览图区域的标题或容器的开始位置
    let current = element;

    // 向上查找，寻找包含标题的父容器
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;

      // 检查父元素是否包含标题
      const headings = parent.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const heading of headings) {
        const headingText = heading.textContent?.toLowerCase() || '';
        if (headingText.includes('预览') || headingText.includes('图片') ||
            headingText.includes('sample') || headingText.includes('preview') ||
            headingText.includes('gallery')) {
          return heading;
        }
      }

      // 检查是否有明显的区域分隔
      const parentClass = parent.className.toLowerCase();
      if (parentClass.includes('section') || parentClass.includes('panel') ||
          parentClass.includes('container') || parentClass.includes('block')) {
        // 如果这个父容器主要包含预览内容，使用它作为目标
        const childImages = parent.querySelectorAll('img');
        const totalImages = document.querySelectorAll('img').length;
        if (childImages.length > 2 && childImages.length / totalImages > 0.3) {
          return parent;
        }
      }

      current = parent;
    }

    return null;
  }

  /**
   * 精确滚动到元素位置，支持偏移量
   */
  private scrollToElementWithOffset(element: Element, offset: number = 0): void {
    const elementRect = element.getBoundingClientRect();
    const absoluteElementTop = elementRect.top + window.pageYOffset;
    const targetPosition = absoluteElementTop + offset;

    // 确保不会滚动到页面顶部之上
    const finalPosition = Math.max(0, targetPosition);

    window.scrollTo({
      top: finalPosition,
      behavior: 'smooth'
    });

    // 添加视觉反馈 - 短暂高亮目标元素
    this.highlightElement(element);
  }

  /**
   * 短暂高亮目标元素
   */
  private highlightElement(element: Element): void {
    const htmlElement = element as HTMLElement;
    const originalStyle = {
      outline: htmlElement.style.outline,
      outlineOffset: htmlElement.style.outlineOffset,
      transition: htmlElement.style.transition
    };

    // 添加高亮效果
    htmlElement.style.transition = 'outline 0.3s ease';
    htmlElement.style.outline = '3px solid #007bff';
    htmlElement.style.outlineOffset = '2px';

    // 2秒后移除高亮效果
    setTimeout(() => {
      htmlElement.style.outline = originalStyle.outline;
      htmlElement.style.outlineOffset = originalStyle.outlineOffset;
      htmlElement.style.transition = originalStyle.transition;
    }, 2000);
  }

  /**
   * 隐藏原始按钮
   */
  private hideOriginalButtons(): void {
    if (this.originalButtons) {
      this.originalButtons.style.display = 'none';
    }
  }

  /**
   * 显示原始按钮
   */
  private showOriginalButtons(): void {
    if (this.originalButtons) {
      this.originalButtons.style.display = '';
    }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<AnchorOptimizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (this.isInitialized) {
      this.destroy();
      this.initialize();
    }
  }

  /**
   * 销毁优化功能
   */
  destroy(): void {
    if (this.optimizedButtons) {
      this.optimizedButtons.remove();
      this.optimizedButtons = null;
    }

    this.showOriginalButtons();
    this.isInitialized = false;
  }
}

// 导出默认实例
export const anchorOptimizationManager = new AnchorOptimizationManager();
