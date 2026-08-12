/**
 * @file ProgressiveMediaGrid.test.tsx
 * @description 媒体库渐进挂载批次与完整加载回归测试
 * @module apps/dashboard/pages/media
 */
/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProgressiveMediaGrid,
  PROGRESSIVE_MEDIA_BATCH_SIZE,
  PROGRESSIVE_MEDIA_INITIAL_BATCH_SIZE,
} from './ProgressiveMediaGrid';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('ProgressiveMediaGrid', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('首批只挂载受控数量，继续加载后仍能显示全部条目', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const items = Array.from({ length: 27 }, (_, index) => index);

    expect(PROGRESSIVE_MEDIA_INITIAL_BATCH_SIZE).toBe(12);
    expect(PROGRESSIVE_MEDIA_BATCH_SIZE).toBe(24);

    await act(async () => {
      root.render(createElement(ProgressiveMediaGrid<number>, {
        items,
        itemKey: (item) => String(item),
        renderItem: (item) => createElement('span', { 'data-media-item': item }, String(item)),
      }));
    });

    expect(host.querySelectorAll('[data-media-item]')).toHaveLength(12);

    const loadMore = host.querySelector<HTMLButtonElement>('.ml-grid-load-more-button');
    expect(loadMore).not.toBeNull();
    await act(async () => {
      loadMore?.click();
    });

    expect(host.querySelectorAll('[data-media-item]')).toHaveLength(items.length);
    await act(async () => {
      root.unmount();
    });
  });
});
