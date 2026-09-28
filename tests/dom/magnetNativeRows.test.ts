/**
 * @file magnetNativeRows.test.ts
 * @description 原生磁力行选择与装饰（bug 1：decorate 选择器与现行 SSR markup 失配）DOM 单测。
 *   镜像 javdb575.com 真机取证（09-28-magnet 线批 0）：详情页 #magnets-content 直接子节点为
 *   class="item odd"/"item " 且带 data-rank 的 SSR 静态行（含 .magnet-name），
 *   永无 columns/is-desktop 类；本测试钉死两类形态均命中、非磁力节点不命中。
 * @module tests/dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { decorateNativeMagnetRow, selectNativeMagnetRows } from '../../apps/extension/src/features/magnets/ui/nativeMagnetRows';

/** 镜像站真实 markup 片段（批 0 v1-raw-magnets-snippet.txt 还原，含广告块/排序栏/3 条 SSR 行）。 */
const SSR_MAGNET_AREA_HTML = `
  <div id="magnets-content" class="magnet-links" data-magnet-sort-target="list">
    <div class="sda-content">
      <a rel="nofollow noopener" target="_blank" href="https://example-ad.example/"><img src="https://static.example/ads/1.jpg" /></a>
    </div>
    <div class="magnet-sort"><span class="select is-small"><select data-action="change->magnet-sort#sort"></select></span></div>
    <div class="item odd" data-rank="0" data-size="3679" data-files="2" data-date="20260920">
      <div class="magnet-name">
        <a href="magnet:?xt=urn:btih:abc" title="Right click and select &quot;Copy Link&quot;">
          <span class="name">AAA.1080p.MP4-NBQ[XC]</span>
          <div class="tags"><span class="tag is-primary is-small is-light">HD</span></div>
          <span class="meta">3.59GB, 2 file(s)</span>
        </a>
      </div>
      <div class="date"><span class="time">2026-09-20</span></div>
      <div class="buttons"><button type="button">Copy</button></div>
    </div>
    <div class="item " data-rank="1" data-size="447" data-files="1" data-date="20260716">
      <div class="magnet-name">
        <a href="magnet:?xt=urn:btih:def">
          <span class="name">BBB[720p][xFans].mp4</span>
          <span class="meta">447MB, 1 file(s)</span>
        </a>
      </div>
      <div class="date"><span class="time">2026-07-16</span></div>
      <div class="buttons"><button type="button">Copy</button></div>
    </div>
    <div class="item odd" data-rank="2" data-size="345" data-files="2" data-date="20260928">
      <div class="magnet-name">
        <a href="magnet:?xt=urn:btih:ghi"><span class="name">CCC.480p.MP4-XXX[XC]</span><span class="meta">345MB, 2 file(s)</span></a>
      </div>
      <div class="date"><span class="time">2026-09-28</span></div>
      <div class="buttons"><button type="button">Copy</button></div>
    </div>
  </div>
`;

/** 生产桌面形态（历史 markup）：.item.columns.is-desktop。 */
const LEGACY_DESKTOP_ROW_HTML = `
  <div id="magnets-content" class="magnet-links">
    <div class="item columns is-desktop" data-source="JavDB">
      <div class="column"><div class="magnet-name"><a href="magnet:?xt=urn:btih:legacy"><span class="name">LEGACY 1080p</span><span class="meta">1GB, 1 file(s)</span></a></div></div>
      <div class="column"><div class="date"><span class="time">2024-01-01</span></div></div>
    </div>
  </div>
`;

describe('selectNativeMagnetRows（bug 1：选择器与现行 SSR markup 对齐）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('SSR 形态：命中 3 条 item[data-rank] 行（含 .magnet-name），广告块/排序栏不命中', () => {
    document.body.innerHTML = SSR_MAGNET_AREA_HTML;
    const container = document.querySelector('#magnets-content')!;
    const rows = selectNativeMagnetRows(container);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.getAttribute('data-rank'))).toEqual(['0', '1', '2']);
    // 广告块与排序栏绝不被选中
    for (const row of rows) {
      expect(row.classList.contains('sda-content')).toBe(false);
      expect(row.classList.contains('magnet-sort')).toBe(false);
    }
  });

  it('生产桌面形态：.item.columns.is-desktop 仍命中（向后兼容）', () => {
    document.body.innerHTML = LEGACY_DESKTOP_ROW_HTML;
    const container = document.querySelector('#magnets-content')!;
    const rows = selectNativeMagnetRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains('is-desktop')).toBe(true);
  });

  it('混合形态 + 占位节点：仅磁力行命中', () => {
    document.body.innerHTML = `
      <div id="magnets-content" class="magnet-links">
        <div class="item odd" data-rank="0"><div class="magnet-name"><span class="name">X</span></div></div>
        <div class="item columns is-desktop"><div class="magnet-name"><span class="name">Y</span></div></div>
        <div class="item">此影片暫無網友分享磁鏈, 請耐心等待。</div>
        <div class="sda-content"><a href="https://ad.example/"></a></div>
        <div class="magnet-sort"></div>
      </div>
    `;
    const container = document.querySelector('#magnets-content')!;
    const rows = selectNativeMagnetRows(container);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.querySelector('.name')?.textContent)).toEqual(['X', 'Y']);
  });

  it('无磁力行（纯占位）→ 空数组（early return 语义保持）', () => {
    document.body.innerHTML = `
      <div id="magnets-content" class="magnet-links">
        <div class="sda-content"></div>
        <div class="placeholder">此影片暫無網友分享磁鏈, 請耐心等待。</div>
      </div>
    `;
    expect(selectNativeMagnetRows(document.querySelector('#magnets-content')!)).toHaveLength(0);
  });
});

describe('decorateNativeMagnetRow（SSR 行装饰链路）', () => {
  beforeEach(() => {
    document.body.innerHTML = SSR_MAGNET_AREA_HTML;
  });

  it('SSR 行装饰：jdb-magnet-row/jdb-native-magnet-row + 源标签 JavDB + 质量标签落位', () => {
    const container = document.querySelector('#magnets-content')!;
    for (const row of selectNativeMagnetRows(container)) {
      decorateNativeMagnetRow(row);
    }
    const rows = selectNativeMagnetRows(container);
    for (const row of rows) {
      expect(row.classList.contains('jdb-magnet-row')).toBe(true);
      expect(row.classList.contains('jdb-native-magnet-row')).toBe(true);
      expect(row.getAttribute('data-source')).toBe('JavDB');
      expect(row.querySelector('.jdb-native-source-tag')?.textContent).toBe('JavDB');
      expect(row.querySelector('.jdb-magnet-quality-tag')).not.toBeNull();
      expect(row.querySelector('.jdb-magnet-title')).not.toBeNull();
    }
    // 装饰幂等：重复调用不产生重复源标签
    for (const row of rows) {
      decorateNativeMagnetRow(row);
    }
    expect(container.querySelectorAll('.jdb-native-source-tag')).toHaveLength(3);
  });
});
