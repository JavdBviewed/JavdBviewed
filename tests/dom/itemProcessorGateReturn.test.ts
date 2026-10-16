/**
 * @file itemProcessorGateReturn.test.ts
 * @description processVisibleItems 页面就绪门控返回值契约锁（10-15-media-hide-ingested-ghost A1-1 判别性用例）。
 *
 * 背景：EMBY_LIBRARY_STATE_UPDATED 广播 re-mark 路径（contentMessageRouter）调用
 * processVisibleItems({ force: true })；当广播落在「页面未就绪」窗，门控
 * （isPageProperlyLoaded，navbar/logo 缺失）使整批静默跳过且无重试无兜底 →
 * 「隐藏已入库」概率性幻视。调用方必须能判别「本次 pass 未执行」才能调度有界重试，
 * 故 processVisibleItems 需显式返回 boolean（门控拦截=false / 执行=true）。
 *
 * 门控走真实实现（不 mock isPageProperlyLoaded），以 DOM navbar 元素存在性驱动。
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE } from '../../apps/extension/src/features/contentState';
import { processVisibleItems } from '../../apps/extension/src/features/listEnhancement/content/itemProcessor';

function appendCard(videoId: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `<div class="video-title"><strong>${videoId}</strong></div>`;
  document.querySelector('.movie-list')!.appendChild(item);
  return item;
}

describe('processVisibleItems 页面就绪门控返回值（A1-1 判别锁）', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="movie-list"></div>';
    STATE.settings = {
      display: {
        hideViewed: false,
        hideBrowsed: false,
        hideWant: false,
        hideVR: false,
      },
      listEnhancement: {
        showStatusBadge: true,
      },
    } as any;
    STATE.records = {};
    STATE.isSearchPage = false;
    STATE.observer?.disconnect();
    STATE.observer = null;
  });

  afterEach(() => {
    STATE.observer?.disconnect();
    STATE.observer = null;
    document.body.innerHTML = '';
  });

  it('门控未通过（navbar 缺失）→ 返回 false 且不做任何处理（现状 void 静默返回不可判别）', () => {
    const item = appendCard('AAA-001');

    const ran = processVisibleItems({ force: true });

    expect(ran).toBe(false);
    expect(item.hasAttribute('data-processed')).toBe(false);
  });

  it('门控通过（JavDB logo 在位）→ 返回 true 且处理照常', async () => {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<a class="navbar-item" href="https://javdb.com"><svg></svg></a>',
    );
    const item = appendCard('AAA-002');

    const ran = processVisibleItems({ force: true });

    expect(ran).toBe(true);
    await vi.waitFor(() => {
      expect(item.getAttribute('data-processed')).toBe('true');
    });
  });
});
