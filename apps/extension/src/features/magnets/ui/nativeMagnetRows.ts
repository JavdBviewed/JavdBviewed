/**
 * @file nativeMagnetRows.ts
 * @description Native JavDB magnet row presentation helper
 * @module features/magnets
 */
import { buildNativeMagnetResult, createMagnetQualityTag } from './qualityTag';

/**
 * 选择原生磁力行（#magnets-content 直接子节点）：
 * - 生产桌面形态：.item.columns.is-desktop（保留兼容）；
 * - SSR 列表形态（现行 markup）：.item odd / .item，带 data-rank，含 .magnet-name。
 * 过滤非磁力节点：.sda-content 广告块、.magnet-sort 排序栏、占位节点等均不命中。
 */
export function selectNativeMagnetRows(container: Element): HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(':scope > .item'));
  return candidates.filter(row =>
    row.classList.contains('columns') ||
    row.classList.contains('is-desktop') ||
    row.hasAttribute('data-rank') ||
    row.querySelector('.magnet-name') !== null
  );
}

export function decorateNativeMagnetRow(row: HTMLElement): void {
  row.classList.add('jdb-magnet-row', 'jdb-native-magnet-row', 'privacy-protected');
  row.setAttribute('data-privacy-protected', 'true');
  row.setAttribute('data-source', row.getAttribute('data-source') || 'JavDB');

  const nameColumn = row.querySelector<HTMLElement>('.magnet-name');
  nameColumn?.classList.add('jdb-magnet-main');

  const link = row.querySelector<HTMLAnchorElement>('.magnet-name a');
  link?.classList.add('jdb-magnet-link');

  const name = row.querySelector<HTMLElement>('.magnet-name .name');
  name?.classList.add('jdb-magnet-title', 'privacy-protected');
  name?.setAttribute('data-privacy-protected', 'true');

  const meta = row.querySelector<HTMLElement>('.magnet-name .meta');
  meta?.classList.add('jdb-magnet-meta');

  let tags = row.querySelector<HTMLElement>('.magnet-name .tags');
  if (!tags && link) {
    tags = document.createElement('div');
    tags.className = 'tags';
    link.appendChild(tags);
  }
  tags?.classList.add('jdb-magnet-tags');
  if (tags && !tags.querySelector('.jdb-native-source-tag')) {
    const sourceTag = document.createElement('span');
    sourceTag.className = 'tag is-info is-small jdb-native-source-tag';
    sourceTag.textContent = 'JavDB';
    tags.prepend(sourceTag);
  }
  if (tags && !tags.querySelector('.jdb-magnet-quality-tag')) {
    const qualityTag = createMagnetQualityTag(buildNativeMagnetResult(row));
    tags.appendChild(qualityTag);
  }
}

/**
 * 创建统一样式的磁力项目元素
 */
