/**
 * @file detailSearchPanel.ts
 * @description detailSearchPanel
 * @module features/externalSearch
 */
import { isSubtitleCatLink, isXunleiSubtitleLink, openSubtitleCatModal, openXunleiSubtitleModal } from '../../subtitles';
import { buildDetailSearchLinks } from '../application/buildDetailSearchLinks';
import type { DetailSearchInsertionTarget, DetailSearchLink, RenderDetailSearchLinksOptions } from '../domain/types';
import { injectDetailSearchStyles } from './detailSearchStyles';

export function findDetailSearchInsertionTarget(): DetailSearchInsertionTarget | null {
  const onlinePanel = document.getElementById('jdb-online-availability-panel');
  if (onlinePanel?.parentElement) {
    return { parent: onlinePanel.parentElement, before: onlinePanel.nextSibling };
  }

  const moviePanel = document.querySelector('.movie-panel-info');
  const directReviewButtons = moviePanel
    ? Array.from(moviePanel.children).find(child => child.classList.contains('review-buttons'))
    : null;
  if (directReviewButtons?.parentElement) {
    return { parent: directReviewButtons.parentElement, before: directReviewButtons.nextSibling };
  }

  const reviewButtons = document.querySelector('.review-buttons');
  if (reviewButtons?.parentElement) {
    return { parent: reviewButtons.parentElement, before: reviewButtons.nextSibling };
  }

  const firstBlock = moviePanel?.querySelector('.panel-block.first-block')
    || moviePanel?.querySelector('.panel-block');

  if (firstBlock?.parentElement) {
    return { parent: firstBlock.parentElement, before: firstBlock.nextSibling };
  }

  return null;
}

export function renderDetailSearchLinks(
  videoId: string,
  searchEngines: unknown,
  options: RenderDetailSearchLinksOptions = {},
): HTMLElement | null {
  document.getElementById('jdb-external-search-panel')?.remove();
  document.getElementById('jdb-subtitle-search-panel')?.remove();

  if (options.enabled === false) return null;

  const allLinks = buildDetailSearchLinks(videoId, searchEngines);
  const showExternalSearch = options.showExternalSearch !== false;
  const externalLinks = showExternalSearch ? allLinks.filter(link => link.category !== 'subtitle') : [];
  const subtitleLinks = allLinks.filter(link => link.category === 'subtitle');
  const showSubtitleSearch = options.showSubtitleSearch !== false;

  if (externalLinks.length === 0 && (!showSubtitleSearch || subtitleLinks.length === 0)) return null;

  const target = findDetailSearchInsertionTarget();
  if (!target) return null;

  const firstPanel = externalLinks.length > 0
    ? createDetailSearchPanel('jdb-external-search-panel', '外部搜索:', externalLinks, videoId)
    : null;
  const subtitlePanel = showSubtitleSearch && subtitleLinks.length > 0
    ? createDetailSearchPanel('jdb-subtitle-search-panel', '字幕搜索:', subtitleLinks, videoId)
    : null;

  let before = target.before;
  if (firstPanel) {
    target.parent.insertBefore(firstPanel, before);
    before = firstPanel.nextSibling;
  }
  if (subtitlePanel) {
    target.parent.insertBefore(subtitlePanel, before);
  }

  injectDetailSearchStyles();
  return firstPanel || subtitlePanel;
}

function createDetailSearchPanel(id: string, labelText: string, links: DetailSearchLink[], videoId: string): HTMLElement {
  const panel = document.createElement('div');
  panel.id = id;
  panel.className = 'panel-block jdb-external-search-panel';

  const label = document.createElement('strong');
  label.textContent = labelText;
  panel.appendChild(label);

  const value = document.createElement('span');
  value.className = 'value jdb-external-search-links';
  value.style.marginLeft = '0.5rem';

  links.forEach((item) => {
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'tag is-info is-light is-small jdb-external-search-link';
    if (isXunleiSubtitleLink(item)) {
      link.classList.add('jdb-xunlei-subtitle-trigger');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openXunleiSubtitleModal(videoId, item.url);
      });
    } else if (isSubtitleCatLink(item)) {
      link.classList.add('jdb-subtitlecat-subtitle-trigger');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openSubtitleCatModal(videoId, item.url);
      });
    }

    const icon = document.createElement('img');
    icon.className = 'jdb-external-search-icon';
    icon.src = item.icon;
    icon.alt = '';
    icon.onerror = () => {
      icon.src = chrome.runtime.getURL('assets/alternate-search.png');
    };

    const text = document.createElement('span');
    text.textContent = item.name;

    link.appendChild(icon);
    link.appendChild(text);
    value.appendChild(link);
  });

  panel.appendChild(value);
  return panel;
}
