/**
 * @file listItemObserver.test.ts
 * @description list item observer 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  observeListItems,
  processExistingListItems,
} from '../../apps/extension/src/features/listEnhancement/ui/listItemObserver';

describe('list item observer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('processes existing list items', () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    list.innerHTML = '<div class="item" id="a"></div><div class="item" id="b"></div>';
    document.body.appendChild(list);

    const processed: string[] = [];
    processExistingListItems(document, item => processed.push(item.id));

    expect(processed).toEqual(['a', 'b']);
  });

  it('observes direct and nested newly added list items', async () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    document.body.appendChild(list);

    const processed: string[] = [];
    const newItemBatches: string[][] = [];
    const observer = observeListItems({
      document,
      enhanceItem: item => processed.push(item.id),
      onNewItems: items => {
        newItemBatches.push(items.map(item => item.id));
      },
    });

    const direct = document.createElement('div');
    direct.className = 'item';
    direct.id = 'direct';
    list.appendChild(direct);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="item" id="nested"></div>';
    list.appendChild(wrapper);

    await new Promise(resolve => setTimeout(resolve, 0));
    observer?.disconnect();

    expect(processed).toEqual(['direct', 'nested']);
    expect(newItemBatches).toEqual([['direct', 'nested']]);
  });

  it('returns null when no movie list exists', () => {
    const processed: HTMLElement[] = [];
    const observer = observeListItems({
      document,
      enhanceItem: item => processed.push(item),
      onNewItems: () => {},
    });

    expect(observer).toBeNull();
    expect(processed).toEqual([]);
  });
});
