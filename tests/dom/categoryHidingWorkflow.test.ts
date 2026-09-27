/**
 * @file categoryHidingWorkflow.test.ts
 * @description 类别黑名单隐藏 DOM 测试（08-29-actor-passthrough-category-filter P1）：
 * data-hidden-by-category / data-hide-src-category / data-hide-reason=CATEGORY_BLACKLIST
 * 的隐藏、恢复与 actor 来源无串扰。
 * @module tests/dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearListItemCategoryHiding,
  hideListItemByCategory,
  hideListItemByActor,
  clearListItemActorHiding,
} from '../../apps/extension/src/features/listEnhancement/application/actorHidingWorkflow';
import { STATE } from '../../apps/extension/src/features/contentState';

function makeItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = '<div class="video-title"><strong>ABC-123</strong></div>';
  document.body.appendChild(item);
  return item;
}

function setSettings(settings: unknown): void {
  STATE.settings = settings as never;
}

describe('category blacklist hiding (DOM)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    STATE.settings = null;
  });

  it('开关开+黑名单非空：命中 → 隐藏且带 CATEGORY_BLACKLIST reason 与来源属性', () => {
    setSettings({
      listEnhancement: {
        enableCategoryFilter: true,
        categoryFilter: { black: ['c4=17'] },
      },
    });
    const item = makeItem();
    hideListItemByCategory(item);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hidden-by-category')).toBe('true');
    expect(item.getAttribute('data-hide-src-category')).toBe('true');
    expect(item.getAttribute('data-hide-reason')).toBe('CATEGORY_BLACKLIST');
    expect(item.hasAttribute('data-hidden-by-default')).toBe(true);
  });

  it('开关关闭：即便打标记也不隐藏（默认 off 零变化）', () => {
    setSettings({
      listEnhancement: {
        enableCategoryFilter: false,
        categoryFilter: { black: ['c4=17'] },
      },
    });
    const item = makeItem();
    hideListItemByCategory(item);
    expect(item.style.display).not.toBe('none');
    expect(item.hasAttribute('data-hide-reason')).toBe(false);
  });

  it('取消勾选（开关仍开但黑名单为空）：恢复显示', () => {
    setSettings({
      listEnhancement: {
        enableCategoryFilter: true,
        categoryFilter: { black: ['c4=17'] },
      },
    });
    const item = makeItem();
    hideListItemByCategory(item);
    expect(item.style.display).toBe('none');

    // 黑名单清空后重算（settings-updated → recompute 路径的等价判定）
    setSettings({
      listEnhancement: {
        enableCategoryFilter: true,
        categoryFilter: { black: [] },
      },
    });
    clearListItemCategoryHiding(item);
    expect(item.style.display).not.toBe('none');
    expect(item.hasAttribute('data-hidden-by-category')).toBe(false);
    expect(item.hasAttribute('data-hide-src-category')).toBe(false);
  });

  it('与 actor 隐藏互不串扰：清类别仍被 actor 隐藏，清 actor 才恢复', () => {
    setSettings({
      listEnhancement: {
        hideBlacklistedActorsInList: true,
        enableCategoryFilter: true,
        categoryFilter: { black: ['c7=28'] },
      },
    });
    const item = makeItem();
    hideListItemByActor(item, 'ACTOR_BLACKLISTED');
    hideListItemByCategory(item);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('ACTOR,CATEGORY_BLACKLIST');

    clearListItemCategoryHiding(item);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('ACTOR');

    clearListItemActorHiding(item);
    expect(item.style.display).not.toBe('none');
    expect(item.hasAttribute('data-hide-reason')).toBe(false);
  });

  it('clearListItemCategoryHiding 幂等：无标记时不抛错、不改状态', () => {
    setSettings({
      listEnhancement: {
        enableCategoryFilter: true,
        categoryFilter: { black: ['c4=17'] },
      },
    });
    const item = makeItem();
    expect(() => clearListItemCategoryHiding(item)).not.toThrow();
    expect(item.style.display).not.toBe('none');
  });
});
