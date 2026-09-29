// @vitest-environment jsdom
/**
 * @file itemProcessorSummaryRace.test.ts
 * @description 09-29-liststatus-recompute-fix：状态过滤（hideViewed/hideBrowsed/hideWant）×滚动补卡批次的竞态契约。
 *
 * 真机缺陷（/tmp/scrollfilter/FINDINGS.md 缺陷①，s2-want 4/4 轮全漏）：
 * 滚动补卡时 scrollPaging 的 processVisibleItems 与列表增强观察器的 processListItems 并发。
 * 前者发现摘要缺失 → 同步写入 'untracked' 占位 → 触发 IDB 加载并 early return；
 * 后者紧接着到达时看到 missing=0（占位已写）→ 按 'untracked' 判定“未看过/未想看”→ 打上 data-processed。
 * 真实摘要落地后没有任何重算路径（非 force 的复处理会跳过 data-processed），卡片永久可见。
 *
 * 不变量（修复后）：
 * 1. 占位摘要在途期间，任何一次 processListItems 都不得给卡片定型（不打 data-processed）；
 * 2. 真实摘要落地后，本批卡片被复处理一次，状态来源标记与显隐按真实状态生效；
 * 3. 复处理不带 force：不重置 data-filter-processed（不干扰内容筛选维度）。
 * @module features/listEnhancement
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE } from '../../contentState';
import { VIDEO_STATUS } from '../../../utils/config';
import type { ViewedStatusSummary } from '../../../types';
import { dbViewedStatusGetMany } from '../../../platform/storage/dbRuntimeClient';
import { processListItems } from './itemProcessor';

vi.mock('../../../platform/storage/dbRuntimeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/storage/dbRuntimeClient')>();
  return { ...actual, dbViewedGet: vi.fn(), dbViewedStatusGetMany: vi.fn() };
});

function buildItem(code: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <a href="/v/${code}" class="box" title="${code} placeholder title">
      <div class="video-title x-ellipsis x-title"><strong>${code}</strong> <span>placeholder title</span></div>
      <div class="tags has-addons"></div>
    </a>
  `;
  return item;
}

const flushAsync = (ms = 30): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const stampedCount = (items: readonly HTMLElement[]): number =>
  items.filter(item => item.hasAttribute('data-processed')).length;

describe('processListItems 状态摘要竞态（09-29-liststatus-recompute-fix）', () => {
  const originalState = {
    settings: STATE.settings,
    records: STATE.records,
    recordSummaries: STATE.recordSummaries,
    isSearchPage: STATE.isSearchPage,
  };
  let resolveDb: ((summaries: ViewedStatusSummary[]) => void) | null = null;

  function deferSummaryLoad(): void {
    resolveDb = null;
    vi.mocked(dbViewedStatusGetMany).mockImplementation(
      () => new Promise<ViewedStatusSummary[]>((resolve) => { resolveDb = resolve; }),
    );
  }

  function setupList(codes: readonly string[]): HTMLElement[] {
    const list = document.createElement('div');
    list.className = 'movie-list';
    codes.forEach((code) => list.appendChild(buildItem(code)));
    document.body.appendChild(list);
    return Array.from(document.querySelectorAll<HTMLElement>('.movie-list .item'));
  }

  beforeEach(() => {
    STATE.settings = { display: { hideWant: true }, listEnhancement: { showStatusBadge: false } } as never;
    STATE.records = {};
    STATE.recordSummaries = {};
    STATE.isSearchPage = false;
    document.body.innerHTML = '';
    deferSummaryLoad();
  });

  afterEach(() => {
    STATE.settings = originalState.settings;
    STATE.records = originalState.records;
    STATE.recordSummaries = originalState.recordSummaries;
    STATE.isSearchPage = originalState.isSearchPage;
  });

  it('占位摘要在途时并发的第二次调用不得按 untracked 定型；真实摘要落地后本批复处理并按 hideWant 隐藏', async () => {
    const codes = ['RACE-001', 'RACE-002', 'RACE-003'];
    const items = setupList(codes);

    // ① scrollPaging 补卡后的 processVisibleItems：发现摘要缺失 → 写占位 + 触发加载 + early return
    processListItems(items);
    expect(vi.mocked(dbViewedStatusGetMany)).toHaveBeenCalledTimes(1);
    expect(stampedCount(items)).toBe(0);

    // ② 列表增强观察器（MutationObserver 微任务）对同一批新卡的并发调用：
    //    占位已写 → missing=0 → 修复前会在此按 'untracked' 定型（3/3 打 data-processed）
    processListItems(items);
    expect(stampedCount(items)).toBe(0);

    // ③ 真实摘要落地：RACE-002 为“我想看”
    expect(resolveDb).not.toBeNull();
    resolveDb?.([{ id: 'RACE-002', status: VIDEO_STATUS.WANT, isFavorite: false }]);
    await flushAsync();

    // ④ 本批被复处理一次：全部定型，want 卡按来源标记隐藏，其余保持可见
    expect(stampedCount(items)).toBe(3);
    expect(items[1].style.display).toBe('none');
    expect(items[1].getAttribute('data-hide-reason')).toContain('WANT');
    expect(items[0].style.display).not.toBe('none');
    expect(items[2].style.display).not.toBe('none');

    // ⑤ 幂等：摘要已落地后再次调用不重复处理
    processListItems(items);
    await flushAsync();
    expect(vi.mocked(dbViewedStatusGetMany)).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.item[data-hide-src-want]').length).toBe(1);
  });

  it('摘要加载失败时本批仍被复处理（不因等待而永久滞留未处理）', async () => {
    const items = setupList(['FAIL-001', 'FAIL-002']);
    vi.mocked(dbViewedStatusGetMany).mockRejectedValueOnce(new Error('idb unavailable'));

    processListItems(items);
    processListItems(items);
    expect(stampedCount(items)).toBe(0);

    await flushAsync(60);
    expect(stampedCount(items)).toBe(2);
    expect(items[0].style.display).not.toBe('none');
  });

  it('复处理不带 force：不重置内容筛选标记 data-filter-processed', async () => {
    const items = setupList(['FILT-001']);
    items[0].setAttribute('data-filter-processed', 'true');

    processListItems(items);
    processListItems(items);
    resolveDb?.([]);
    await flushAsync();

    expect(stampedCount(items)).toBe(1);
    expect(items[0].getAttribute('data-filter-processed')).toBe('true');
  });
});
