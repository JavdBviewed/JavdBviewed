/**
 * @file index.ts
 * @description 详情页扩展增强功能的统一承载容器
 * @module features/detailEnhancementPanel
 */

export interface DetailEnhancementInsertionTarget {
  parent: HTMLElement;
  before: ChildNode | null;
}

const DETAIL_ENHANCEMENT_PANEL_ID = 'jdb-detail-enhancement-panel';
const DETAIL_ENHANCEMENT_STYLES_ID = 'jdb-detail-enhancement-panel-styles';
const DETAIL_ENHANCEMENT_INNER_CLASS = 'jdb-detail-enhancement-panel-inner';

export function ensureDetailEnhancementPanel(): HTMLElement | null {
  const existing = document.getElementById(DETAIL_ENHANCEMENT_PANEL_ID);
  if (existing) {
    const existingInner = existing.querySelector<HTMLElement>(`.${DETAIL_ENHANCEMENT_INNER_CLASS}`);
    if (existingInner) {
      injectDetailEnhancementPanelStyles();
      return existingInner;
    }

    const panel = document.createElement('nav');
    panel.className = `panel ${DETAIL_ENHANCEMENT_INNER_CLASS}`;
    panel.setAttribute('aria-label', 'JavDB 扩展增强功能');
    existing.appendChild(panel);
    injectDetailEnhancementPanelStyles();
    return panel;
  }

  const anchor = findDetailEnhancementAnchor();
  if (!anchor?.parentElement) return null;

  const container = document.createElement('div');
  container.id = DETAIL_ENHANCEMENT_PANEL_ID;
  container.className = 'jdb-detail-enhancement-panel';

  const panel = document.createElement('nav');
  panel.className = `panel ${DETAIL_ENHANCEMENT_INNER_CLASS}`;
  panel.setAttribute('aria-label', 'JavDB 扩展增强功能');
  container.appendChild(panel);

  anchor.parentElement.insertBefore(container, anchor.nextSibling);
  injectDetailEnhancementPanelStyles();

  return panel;
}

export function findDetailEnhancementInsertionTarget(before?: ChildNode | null): DetailEnhancementInsertionTarget | null {
  const panel = ensureDetailEnhancementPanel();
  if (!panel) return null;

  return {
    parent: panel,
    before: before && before.parentNode === panel ? before : null,
  };
}

function findDetailEnhancementAnchor(): HTMLElement | null {
  const detailColumns = Array.from(document.querySelectorAll<HTMLElement>('.columns.is-desktop, .columns'))
    .find(columns => columns.querySelector('.column-video-cover') && columns.querySelector('.movie-panel-info'));
  if (detailColumns) return detailColumns;

  const moviePanel = document.querySelector<HTMLElement>('.movie-panel-info');
  if (moviePanel) return moviePanel.closest<HTMLElement>('.columns') || moviePanel;

  return null;
}

function injectDetailEnhancementPanelStyles(): void {
  if (document.getElementById(DETAIL_ENHANCEMENT_STYLES_ID)) return;

  const style = document.createElement('style');
  style.id = DETAIL_ENHANCEMENT_STYLES_ID;
  style.textContent = `
    .jdb-detail-enhancement-panel {
      clear: both;
      margin: 1rem 0;
    }

    .jdb-detail-enhancement-panel > .panel {
      margin-bottom: 1rem;
    }

    .jdb-detail-enhancement-panel .panel-block {
      min-height: 2.5rem;
    }
  `;
  document.head.appendChild(style);
}
