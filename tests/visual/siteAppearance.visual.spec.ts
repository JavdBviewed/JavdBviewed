/**
 * @file siteAppearance.visual.spec.ts
 * @description 外观包不得改变相关作品四列网格的浏览器回归
 * @module tests/visual
 */
import { expect, test } from '@playwright/test';
import { buildAppearanceCss } from '../../apps/extension/src/features/siteAppearance';

test('site appearance preserves four related-work columns', async ({ page }) => {
  const appearanceCss = buildAppearanceCss({
    enabled: true,
    listCards: true,
    detailAndRelated: true,
    magnetList: true,
    previewImages: true,
    autoExpandReplaceTip: false,
  });

  await page.setContent(`
    <style>
      .tile-images { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; width: 960px; }
      .tile-item { box-sizing: border-box; height: 160px; }
      ${appearanceCss}
    </style>
    <main data-x-javdb-appearance="1">
      <section class="tile-images">
        <a class="tile-item">1</a><a class="tile-item">2</a><a class="tile-item">3</a><a class="tile-item">4</a>
      </section>
    </main>
  `);

  const cards = page.locator('.tile-item');
  await expect(cards).toHaveCount(4);
  const boxes = await Promise.all([0, 1, 2, 3].map((index) => cards.nth(index).boundingBox()));
  expect(boxes.every((box) => box !== null)).toBe(true);
  const first = boxes[0];
  if (!first) return;
  expect(boxes.every((box) => box?.y === first.y)).toBe(true);
  expect(boxes.map((box) => box?.width)).toEqual([first.width, first.width, first.width, first.width]);
});
