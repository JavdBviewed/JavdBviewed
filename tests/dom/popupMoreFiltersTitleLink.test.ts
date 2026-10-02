/**
 * @file popupMoreFiltersTitleLink.test.ts
 * @description 线 10-05-popup-more-filter-title：popup「更多过滤」链接位置结构锁。
 *   链接从底部 full-row（more-row）挪到「番号过滤」区块标题行右上角（section-title 内、文字之后），
 *   右对齐机制 = .section-title 既有 display:flex + justify-content:space-between。
 *   深链行为（bootstrap 按 id 绑定 + dashboard-deep-link 协议）零改动，本锁只锁结构与样式档位。
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const popupHtmlPath = resolve(process.cwd(), 'apps/extension/src/popup/popup.html');
const popupCssPath = resolve(process.cwd(), 'apps/extension/src/popup/popup.css');

function parsePopupHtml(): Document {
  return new DOMParser().parseFromString(readFileSync(popupHtmlPath, 'utf8'), 'text/html');
}

describe('popup more-filters link lives in the 番号过滤 section title (10-05-popup-more-filter-title)', () => {
  it('renders exactly one #moreFiltersLink inside the 番号过滤 section-title, after the title text', () => {
    const doc = parsePopupHtml();
    const links = doc.querySelectorAll('#moreFiltersLink');
    expect(links.length, 'moreFiltersLink 必须唯一').toBe(1);

    const link = links[0] as HTMLAnchorElement;
    expect(link.textContent, '文案精确').toBe('更多过滤 →');
    expect(link.classList.contains('more-link'), '沿用 .more-link 样式类').toBe(true);

    const title = link.closest('.section-title');
    expect(title, '链接必须位于 section-title 内').not.toBeNull();
    expect(title?.textContent, '所在标题行 = 番号过滤').toContain('番号过滤');
    // 文字在前、链接在后（右对齐依赖顺序 + space-between）
    const titleHtml = (title as Element).innerHTML;
    expect(titleHtml.indexOf('番号过滤') < titleHtml.indexOf('moreFiltersLink'), '链接在标题文字之后').toBe(true);
    expect(title?.closest('.filters-left'), '该标题属于左列「番号过滤」区块').not.toBeNull();
  });

  it('drops the full-row more-row block; only volume + list-display full-rows remain', () => {
    const doc = parsePopupHtml();
    expect(doc.querySelector('.more-row'), 'more-row 块必须移除').toBeNull();
    const link = doc.querySelector('#moreFiltersLink');
    expect(link?.closest('.full-row'), '链接不得再位于任何 full-row 内').toBeNull();
    const fullRows = Array.from(doc.querySelectorAll('.main-grid > .full-row'));
    expect(fullRows.length, 'full-row 仅剩音量 + 列表显示两块').toBe(2);
    expect(doc.querySelector('#moreFiltersLink')?.closest('.main-grid'), '链接仍在 main-grid 内').not.toBeNull();
  });

  it('keeps the right-align mechanism and downshifts the link type scale to 11px', () => {
    const css = readFileSync(popupCssPath, 'utf8');
    expect(/\n\.more-row\s*\{/.test(`\n${css}`), '.more-row 规则必须删除').toBe(false);

    const moreLinkRule = css.match(/^\.more-link\s*\{([^}]*)\}/m)?.[1] ?? '';
    expect(moreLinkRule, '字号降为 11px').toContain('font-size: 11px');
    expect(moreLinkRule, 'flex 收缩保护：窄列下不被挤掉').toContain('flex-shrink: 0');

    // 行首锚定：必须取本体规则，不能命中 .filters-left .section-title（grid-column 那条）
    const sectionTitleRule = css.match(/^\.section-title\s*\{([^}]*)\}/m)?.[1] ?? '';
    expect(sectionTitleRule).toContain('justify-content: space-between');
    expect(sectionTitleRule).toContain('display: flex');
    expect(css).toContain('.more-link:hover');
    expect(css).toContain('.filters-left .section-title');
  });
});
