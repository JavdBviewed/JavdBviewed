/**
 * @file listEnhancementManagerAppendWiring.test.ts
 * @description 源码锁：滚动翻页 onItemsAppended 必须对新卡补跑 enhanceItem（幂等）+ processListItems。
 * 超排页（.jdb-super-ranking-grid）无 MutationObserver 覆盖，该回调是新卡增强的唯一补齐入口；
 * fetched 分支 observer 亦覆盖，重复调用由 data-list-enhanced 守卫幂等。
 * manager 直接实例化依赖 chrome API（jsdom 不可用），按仓内 source-lock 先例锁接线存在性。
 * @module features/listEnhancement
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(fileURLToPath(new URL('./listEnhancementManager.ts', import.meta.url)), 'utf8');

describe('onItemsAppended 新卡补齐接线（source lock）', () => {
  it('事件 items 走 listSorting + enhanceItem + processListItems（extract 过滤）', () => {
    const idx = SRC.indexOf('onItemsAppended:');
    expect(idx, 'manager 未接线 onItemsAppended').toBeGreaterThan(-1);
    const seg = SRC.slice(idx, idx + 600);
    expect(seg).toContain('listSortingController.handleItemsAppended(event)');
    expect(seg).toContain('this.enhanceItem(');
    expect(seg).toContain('processListItems(');
    expect(seg).toContain('extractListItemVideoInfo');
  });
});
