/**
 * @file index.ts
 * @description JavDB 页面外观包的可回收样式和替换提示展开管理器
 * @module features/siteAppearance
 */
import type { SiteAppearanceSettings } from '../../types';

const STYLE_ID = 'x-javdb-site-appearance';
const ROOT_ATTRIBUTE = 'data-x-javdb-appearance';

/** 判断当前域名是否属于外观包支持的 JavDB 主站。 */
export function isJavdbAppearanceSupportedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'javdb.com' || normalized.endsWith('.javdb.com');
}

function normalizeSettings(input: Partial<SiteAppearanceSettings> | undefined): SiteAppearanceSettings {
  return {
    enabled: input?.enabled === true,
    listCards: input?.listCards !== false,
    detailAndRelated: input?.detailAndRelated !== false,
    magnetList: input?.magnetList !== false,
    previewImages: input?.previewImages !== false,
    autoExpandReplaceTip: input?.autoExpandReplaceTip === true,
  };
}

/** 生成仅含皮肤属性的命名空间 CSS，供内容脚本与布局回归共用。 */
export function buildAppearanceCss(settings: SiteAppearanceSettings): string {
  const selector = `[${ROOT_ATTRIBUTE}="1"]`;
  const sections: string[] = [];

  if (settings.listCards) {
    sections.push(`
${selector} .movie-list .item .box {
  background: color-mix(in srgb, var(--background-color, #fff) 94%, #2f7d72 6%);
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  box-shadow: 0 2px 10px rgb(0 0 0 / 8%);
}
${selector} .movie-list .item .video-title {
  color: inherit;
  font-weight: 600;
  line-height: 1.45;
}`);
  }

  if (settings.detailAndRelated) {
    sections.push(`
${selector} .movie-panel-info .panel-block,
${selector} .section-container .box {
  background: color-mix(in srgb, var(--background-color, #fff) 96%, #2f7d72 4%);
  border-color: color-mix(in srgb, currentColor 14%, transparent);
}
${selector} .tile-images .tile-item {
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  box-shadow: 0 2px 8px rgb(0 0 0 / 7%);
}`);
  }

  if (settings.magnetList) {
    sections.push(`
${selector} .magnet-list .item,
${selector} .magnets .item {
  background: color-mix(in srgb, var(--background-color, #fff) 97%, #2f7d72 3%);
  border-color: color-mix(in srgb, currentColor 12%, transparent);
}
${selector} .magnet-list .name,
${selector} .magnets .name {
  font-weight: 600;
}`);
  }

  if (settings.previewImages) {
    sections.push(`
${selector} .preview-images img,
${selector} .tile-images img {
  background: color-mix(in srgb, var(--background-color, #fff) 92%, #2f7d72 8%);
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 4px;
}`);
  }

  return sections.join('\n');
}

/** 管理单页的外观样式及独立替换提示观察器。 */
export class SiteAppearanceManager {
  private readonly document: Document;
  private replaceTipObserver: MutationObserver | null = null;
  private expandedTips = new WeakSet<HTMLElement>();
  private replaceTipExpansionEnabled = false;

  constructor(documentRef?: Document) {
    if (!documentRef) {
      throw new Error('SiteAppearanceManager requires a document');
    }
    this.document = documentRef;
  }

  apply(input: Partial<SiteAppearanceSettings> | undefined): void {
    const settings = normalizeSettings(input);
    this.applyStyles(settings);
    this.updateReplaceTipExpansion(settings.autoExpandReplaceTip);
  }

  destroy(): void {
    this.removeStyles();
    this.stopReplaceTipExpansion();
  }

  private applyStyles(settings: SiteAppearanceSettings): void {
    const css = settings.enabled ? buildAppearanceCss(settings) : '';
    if (!css) {
      this.removeStyles();
      return;
    }

    this.document.documentElement.setAttribute(ROOT_ATTRIBUTE, '1');
    let style = this.document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = this.document.createElement('style');
      style.id = STYLE_ID;
      this.document.head.append(style);
    }
    style.textContent = css;
  }

  private removeStyles(): void {
    this.document.getElementById(STYLE_ID)?.remove();
    this.document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
  }

  private updateReplaceTipExpansion(enabled: boolean): void {
    if (enabled === this.replaceTipExpansionEnabled) return;
    this.stopReplaceTipExpansion();
    if (!enabled) return;

    this.replaceTipExpansionEnabled = true;
    this.expandReplaceTips(this.document);
    const root = this.document.body || this.document.documentElement;
    this.replaceTipObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          this.expandReplaceTips(node);
        }
      }
    });
    this.replaceTipObserver.observe(root, { childList: true, subtree: true });
  }

  private stopReplaceTipExpansion(): void {
    this.replaceTipObserver?.disconnect();
    this.replaceTipObserver = null;
    this.expandedTips = new WeakSet<HTMLElement>();
    this.replaceTipExpansionEnabled = false;
  }

  private expandReplaceTips(root: Node): void {
    if (root instanceof HTMLElement && root.matches('.replace_tip')) {
      this.expandReplaceTip(root);
    }
    if (root instanceof Document || root instanceof DocumentFragment || root instanceof Element) {
      root.querySelectorAll<HTMLElement>('.replace_tip').forEach((tip) => this.expandReplaceTip(tip));
    }
  }

  private expandReplaceTip(tip: HTMLElement): void {
    if (this.expandedTips.has(tip) || !tip.querySelector('.icon-expand')) return;
    this.expandedTips.add(tip);
    tip.click();
  }
}

export const siteAppearanceManager = typeof document === 'undefined'
  ? null
  : new SiteAppearanceManager(document);
