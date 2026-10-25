/**
 * @vitest-environment jsdom
 * @file listItemDom.test.ts
 * @description 列表卡片视频信息提取：普通卡（后代 a）+ 超排卡（卡片自身即 a[href*="/v/"]）
 * @module features/listEnhancement
 */
import { describe, expect, it } from 'vitest';
import { extractListItemVideoInfo } from './listItemDom';

function makeNormalCard(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = '<div class="video-title"><strong>ABC-123</strong> 普通标题</div><a href="/v/ABC-123">cover</a>';
  return item;
}

/** 超排卡结构：卡片自身是 a[href*="/v/"]，子树无 a（renderMovieListHtml 同构）。 */
function makeSuperRankingCard(): HTMLElement {
  const item = document.createElement('a');
  item.className = 'box item jdb-super-ranking-movie';
  item.href = '/v/42';
  item.innerHTML = '<div class="cover"></div><div class="video-title"><strong>TOP-001</strong> 超排标题</div><div class="meta">2026-01-01</div>';
  return item;
}

describe('extractListItemVideoInfo', () => {
  it('普通列表卡：从后代 a 取 url（既有语义不变）', () => {
    const info = extractListItemVideoInfo(makeNormalCard());
    expect(info).not.toBeNull();
    expect(info!.code).toBe('ABC-123');
    expect(info!.title).toBe('普通标题');
    expect(info!.url).toContain('/v/ABC-123');
  });

  it('超排卡（卡片自身即 a）：回退取卡片自身 href，code 仍取 strong', () => {
    const info = extractListItemVideoInfo(makeSuperRankingCard());
    expect(info).not.toBeNull();
    expect(info!.code).toBe('TOP-001');
    expect(info!.title).toBe('超排标题');
    expect(info!.url).toContain('/v/42');
  });

  it('缺 title 或缺链接均返回 null', () => {
    const noTitle = document.createElement('div');
    noTitle.className = 'item';
    noTitle.innerHTML = '<a href="/v/x">x</a>';
    expect(extractListItemVideoInfo(noTitle)).toBeNull();

    const noLink = document.createElement('div');
    noLink.className = 'item';
    noLink.innerHTML = '<div class="video-title"><strong>X-1</strong> t</div>';
    expect(extractListItemVideoInfo(noLink)).toBeNull();
  });
});
