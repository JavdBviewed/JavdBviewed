import { expect, test } from '@playwright/test';
import path from 'node:path';

test('new works filters align as one row when space allows and wrap as a group', async ({ page }) => {
  await page.setContent(`<div class="new-works-page"><section class="new-works-list-section"><div class="list-controls"><div class="new-works-filter-bar">
    <div class="new-works-search-group"><i></i><input id="search" placeholder="搜索作品或演员..."></div>
    <div class="new-works-select-grid"><select id="filter"><option>全部作品</option></select>
    <select id="sort"><option>按发现时间排序 (最新)</option></select>
    <div class="records-per-page-selector"><label for="pageSize">每页</label><select id="pageSize"><option>10</option></select></div></div>
  </div></div></section></div>`);
  await page.addStyleTag({ path: path.resolve('apps/extension/src/dashboard/styles/05-pages/records.css') });
  await page.addStyleTag({ path: path.resolve('apps/extension/src/dashboard/styles/05-pages/newWorks.css') });
  for (const [width, sameRow] of [[1440, true], [900, false], [600, false]] as const) {
    await page.setViewportSize({ width, height: 750 });
    const boxes = await Promise.all(['#search', '#filter', '#sort', '#pageSize'].map(async selector => {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      return box ?? { x: 0, y: 0, width: 0, height: 0 };
    }));
    if (sameRow) expect(boxes.every(box => Math.abs(boxes[0].y - box.y) < 3)).toBe(true);
    if (width === 900) expect(boxes.slice(1).every(box => Math.abs(boxes[1].y - box.y) < 3)).toBe(true);
    if (width === 600) expect(boxes[1].y < boxes[2].y && boxes[2].y < boxes[3].y).toBe(true);
    for (const box of boxes) expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});
