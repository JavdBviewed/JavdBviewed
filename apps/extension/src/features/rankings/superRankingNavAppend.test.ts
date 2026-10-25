/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://javdb570.com/advanced_search?handleTop=1&handleType=all&type_value=&page=1" }
 * @file superRankingNavAppend.test.ts
 * @description appendSuperRankingTop250Page 返回新增卡片节点数组（滚动翻页 manager 对新卡增强的输入）
 * @module features/rankings
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/network/clientFetch', () => ({
  bgFetchJSON: vi.fn(),
}));
vi.mock('../reviewUnlock', () => ({
  ReviewBreakerService: { generateSignature: vi.fn(async () => 'sig') },
}));

import { appendSuperRankingTop250Page } from './superRankingNav';
import { bgFetchJSON } from '../../platform/network/clientFetch';

const MOVIES = [
  { id: '1', number: 'S-001', origin_title: '第一部', release_date: '2026-01-01', cover_url: '' },
  { id: '2', number: 'S-002', origin_title: '第二部', release_date: '2026-01-02' },
];

beforeEach(() => {
  document.body.innerHTML =
    '<div id="jdb-super-ranking-page"><div class="jdb-super-ranking-grid"></div><div class="jdb-super-ranking-pagination"></div></div>';
  localStorage.setItem('jb_appAuthorization', 'tok');
  (bgFetchJSON as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    // bgFetchJSON 结果 = BgFetchJSONResult 包裹 API body；API body 自身再带 success/data（双层）
    success: true,
    status: 200,
    data: { success: 1, data: { movies: MOVIES } },
  });
});

describe('appendSuperRankingTop250Page 返回面', () => {
  it('追加后返回新增卡片节点数组（items 非空、与 DOM 顺序一致、结构可被 extract 消费）', async () => {
    const result = await appendSuperRankingTop250Page(2);
    expect(result.handled).toBe(true);
    expect(result.appended).toBe(2);
    expect(result.page).toBe(2);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items!.length).toBe(2);

    const grid = document.querySelector('.jdb-super-ranking-grid') as HTMLElement;
    expect(grid.children.length).toBe(2);
    expect(result.items![0]).toBe(grid.children[0]);
    expect(result.items![1]).toBe(grid.children[1]);

    const first = result.items![0] as HTMLAnchorElement;
    // 超排卡结构契约：卡片自身即 a[href*="/v/"]，子树无 a，code 在 strong
    expect(first.matches('a[href*="/v/"]')).toBe(true);
    expect(first.querySelector('a')).toBeNull();
    expect(first.querySelector('div.video-title > strong')?.textContent).toBe('S-001');
  });
});
