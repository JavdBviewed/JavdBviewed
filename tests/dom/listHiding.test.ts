/**
 * @file listHiding.test.ts
 * @description 列表卡片隐藏来源标记 + 开关重算的核心逻辑测试。
 * @module tests/dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeEffectiveHiding,
  getActiveHidingSources,
  recomputeListHiding,
  readListHidingEnablement,
  setHidingSource,
} from '../../apps/extension/src/features/list-hiding';

function createItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  document.body.appendChild(item);
  return item;
}

const ALL_ON = { viewed: true, browsed: true, want: true, vr: true, actor: true };
const ALL_OFF = { viewed: false, browsed: false, want: false, vr: false, actor: false };

describe('list-hiding 来源标记与重算', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('无来源标记时保持显示', () => {
    const item = createItem();
    const effective = recomputeListHiding(item, ALL_ON);
    expect(effective).toEqual([]);
    expect(item.style.display).toBe('');
    expect(item.hasAttribute('data-hidden-by-default')).toBe(false);
  });

  it('来源标记 + 开关开启时隐藏，并写入 data-hidden-by-default 与 data-hide-reason', () => {
    const item = createItem();
    setHidingSource(item, 'viewed', true);
    setHidingSource(item, 'vr', true);
    const effective = recomputeListHiding(item, ALL_ON);
    expect(effective.sort()).toEqual(['viewed', 'vr']);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hidden-by-default')).toBe('true');
    expect(item.getAttribute('data-hide-reason')).toBe('VIEWED,VR');
  });

  it('开关关闭的来源不参与隐藏', () => {
    const item = createItem();
    setHidingSource(item, 'viewed', true);
    setHidingSource(item, 'vr', true);
    const effective = recomputeListHiding(item, { ...ALL_ON, viewed: false });
    expect(effective).toEqual(['vr']);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('VR');
  });

  it('所有开关关闭时即使存在来源标记也保持显示', () => {
    const item = createItem();
    setHidingSource(item, 'viewed', true);
    setHidingSource(item, 'actor', true);
    const effective = recomputeListHiding(item, ALL_OFF);
    expect(effective).toEqual([]);
    expect(item.style.display).toBe('');
    expect(item.hasAttribute('data-hidden-by-default')).toBe(false);
    expect(item.hasAttribute('data-hide-reason')).toBe(false);
  });

  it('getActiveHidingSources 只返回已标记的来源', () => {
    const item = createItem();
    setHidingSource(item, 'want', true);
    expect(getActiveHidingSources(item)).toEqual(['want']);
    setHidingSource(item, 'want', false);
    expect(getActiveHidingSources(item)).toEqual([]);
  });

  it('computeEffectiveHiding = 来源 ∩ 开关', () => {
    const item = createItem();
    setHidingSource(item, 'browsed', true);
    setHidingSource(item, 'want', true);
    expect(computeEffectiveHiding(item, { ...ALL_ON, want: false })).toEqual(['browsed']);
  });

  it('readListHidingEnablement 从 settings.display 与 settings.listEnhancement 读取', () => {
    const enablement = readListHidingEnablement({
      display: { hideViewed: true, hideBrowsed: false, hideWant: true, hideVR: true },
      listEnhancement: { hideBlacklistedActorsInList: true },
    });
    expect(enablement).toEqual({ viewed: true, browsed: false, want: true, vr: true, actor: true });

    const missing = readListHidingEnablement(null);
    expect(missing).toEqual({ viewed: false, browsed: false, want: false, vr: false, actor: false });
  });
});
