import { describe, expect, it } from 'vitest';
import type { MediaBrowseItem } from './mediaBrowseModel';
import { areMediaDetailPanelPropsEqual } from './mediaDetailRenderPolicy';

const item: MediaBrowseItem = {
  code: 'DETAIL-001',
  title: '详情测试',
  source: 'emby',
  year: '2024',
  hue: 10,
  itemId: 'item-1',
  serverUrl: 'http://emby.local',
};

describe('media detail render policy', () => {
  it('skips parent-only rerenders when item and handlers are stable', () => {
    const onPlay = () => undefined;
    const onPlayCopy = () => undefined;
    const onClose = () => undefined;
    const previous = { item, onPlay, onPlayCopy, onClose };

    expect(areMediaDetailPanelPropsEqual(previous, { ...previous })).toBe(true);
  });

  it('rerenders when detail item or an interaction handler changes', () => {
    const onPlay = () => undefined;
    const previous = { item, onPlay };

    expect(areMediaDetailPanelPropsEqual(
      previous,
      { ...previous, item: { ...item, title: '新标题' } },
    )).toBe(false);
    expect(areMediaDetailPanelPropsEqual(
      previous,
      { ...previous, onPlay: () => undefined },
    )).toBe(false);
  });
});
