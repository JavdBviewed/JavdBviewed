/**
 * @file listItemDom.ts
 * @description listItemDom
 * @module features/listEnhancement
 */
import type { ListPreviewVideoInfo } from '../../previews';

export function extractListItemVideoInfo(item: HTMLElement): ListPreviewVideoInfo | null {
  const titleElement = item.querySelector('div.video-title > strong');
  if (!titleElement) return null;
  // 超排卡（renderMovieListHtml）：卡片自身即 a[href*="/v/"]、子树无 a，回退取卡片自身 href；
  // 普通列表卡：仍取后代 a（既有语义不变）。
  const selfAnchor =
    typeof item.matches === 'function' && item.matches('a[href*="/v/"]')
      ? (item as HTMLAnchorElement)
      : null;
  const linkElement = selfAnchor ?? item.querySelector('a[href*="/v/"]');

  if (!linkElement) return null;

  const code = titleElement.textContent?.trim() || '';
  const title = item.querySelector('div.video-title')?.textContent?.replace(code, '').trim() || '';
  const url = (linkElement as HTMLAnchorElement).href;

  return { code, title, url };
}

export function optimizeListItemTitle(item: HTMLElement, videoInfo: ListPreviewVideoInfo): void {
  const titleElement = item.querySelector('div.video-title') as HTMLElement | null;
  if (!titleElement) return;

  if (!titleElement.querySelector('.x-btn')) {
    const button = document.createElement('span');
    button.className = 'x-btn';
    button.title = '列表功能';
    button.setAttribute('data-code', videoInfo.code);
    button.setAttribute('data-title', videoInfo.title);

    titleElement.insertAdjacentElement('afterbegin', button);
  }

  if (item.querySelector('.tags')) {
    titleElement.classList.add('x-ellipsis');
  }
  titleElement.classList.add('x-title');
}
