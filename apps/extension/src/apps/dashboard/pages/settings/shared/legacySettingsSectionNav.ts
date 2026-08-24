/**
 * @file legacySettingsSectionNav.ts
 * @description 遗留设置 partial 的本页分组导航自动提取与 anchor 注入
 * @module apps/dashboard/pages/settings/shared
 */
import type { SettingsSectionNavItem } from './SettingsSectionNav';

export type PreparedLegacySettingsSectionNav = {
  panelHtml: string;
  items: SettingsSectionNavItem[];
};

export const MIN_LEGACY_SECTION_NAV_ITEMS = 3;
export const LEGACY_SECTION_SELECTOR: string = [
  '.settings-card',
  '.settings-section',
  '.settings-group',
  '.webdav-section',
  '.logging-section',
  '.privacy-card',
  '.action-tile',
  '[data-ui-pattern="setting-section"]',
].join(', ');

const TITLE_SELECTOR = [
  ':scope > h2',
  ':scope > h3',
  ':scope > h4',
  ':scope > .webdav-section-header',
  ':scope > .settings-section-header',
  ':scope > .logging-section-title',
  ':scope > .privacy-section-header h4',
  ':scope > .action-tile-header h4',
  ':scope > .advanced-tool-header h4',
  ':scope > .advanced-hero-card h4',
  ':scope > .global-actions-card h4',
  ':scope > header h3',
  ':scope > [data-ui-pattern="setting-section"] header h3',
].join(', ');

function normalizeLabel(text: string | null | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function isHiddenSection(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.classList.contains('hidden')) return true;
  return element.closest('[hidden], [aria-hidden="true"], .hidden') !== null;
}

export function isInsideDialogLikeContainer(element: Element): boolean {
  return element.closest(
    '.modal, .settings-modal, .webdav-modal, .ui-modal, [role="dialog"], dialog',
  ) !== null;
}

function getPreviousCommentTitle(element: Element): string | null {
  let node = element.previousSibling;
  while (node) {
    if (node.nodeType === 8) {
      const label = normalizeLabel(node.textContent);
      if (label) return label;
    }
    if (node.nodeType === 1 || normalizeLabel(node.textContent)) return null;
    node = node.previousSibling;
  }
  return null;
}

export function getDirectSectionTitle(element: Element): string | null {
  const titleElement = element.querySelector(TITLE_SELECTOR);
  const label = normalizeLabel(titleElement?.textContent);
  if (label) return label;

  if (!normalizeLabel(element.textContent)) return null;
  return getPreviousCommentTitle(element);
}

function makeSectionAnchorId(pageId: string, index: number): string {
  const normalizedPageId = pageId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${normalizedPageId || 'settings'}-section-${index}`;
}

function injectSectionAnchor(element: Element, id: string): void {
  const existing = element.querySelector(':scope > .settings-section-anchor');
  if (existing) {
    existing.setAttribute('id', id);
    existing.setAttribute('aria-hidden', 'true');
    return;
  }

  const anchor = document.createElement('span');
  anchor.id = id;
  anchor.className = 'settings-section-anchor';
  anchor.setAttribute('aria-hidden', 'true');
  element.insertBefore(anchor, element.firstChild);
}

export type LegacySettingsSection = {
  element: Element;
  label: string;
};

/**
 * 在给定正文根下收集可用作快速导航的遗留分组（含标题，可见，非弹窗内）。
 * 供 React 全页外框直接对 live DOM 使用，避免解析 innerHTML。
 */
export function collectLegacySettingsSections(
  body: Element,
): LegacySettingsSection[] {
  if (typeof document === 'undefined') return [];
  return Array.from(body.querySelectorAll(LEGACY_SECTION_SELECTOR))
    .filter((element) => !isHiddenSection(element))
    .filter((element) => !isInsideDialogLikeContainer(element))
    .map((element) => ({ element, label: getDirectSectionTitle(element) }))
    .filter((entry): entry is LegacySettingsSection => Boolean(entry.label));
}

export function prepareLegacySettingsSectionNav(
  panelHtml: string,
  pageId: string,
): PreparedLegacySettingsSectionNav {
  if (typeof document === 'undefined') {
    return { panelHtml, items: [] };
  }

  const template = document.createElement('template');
  template.innerHTML = panelHtml;
  const panelRoot = template.content.querySelector('.settings-page') ?? template.content.firstElementChild;
  const body = panelRoot?.querySelector('.settings-page-body') ?? panelRoot;
  if (!body) return { panelHtml, items: [] };

  const titledCandidates = collectLegacySettingsSections(body);

  if (titledCandidates.length < MIN_LEGACY_SECTION_NAV_ITEMS) {
    return { panelHtml, items: [] };
  }

  const items = titledCandidates.map((entry, index) => {
    const id = makeSectionAnchorId(pageId, index);
    injectSectionAnchor(entry.element, id);
    return { id, label: entry.label } satisfies SettingsSectionNavItem;
  });

  return { panelHtml: template.innerHTML, items };
}