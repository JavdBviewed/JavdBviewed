/**
 * @file dataSyncDetailTags.test.ts
 * @description 数据同步详情页标签解析回归测试
 * @module tests/extension
 */
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../../apps/extension/src/dashboard/dataSync/api';
import { extractDetailCategoryTagsFromHTML } from '../../apps/extension/src/dashboard/dataSync/detailCategoryTags';
import { getApiClient as getLegacyApiClient } from '../../apps/extension/src/dashboard/dataSync/legacy/api';
import type { VideoRecord } from '../../apps/extension/src/types';

type ApiClientDetailParser = {
  parseVideoDetailFromHTML(html: string, urlVideoId: string): Partial<VideoRecord> | null;
};

describe('data sync detail tag parsing', () => {
  it('同步想看详情时只保存详情类别区块，不保存列表页默认标签', () => {
    const html = `
      <html>
        <head><title>SSIS-795 测试标题 | JavDB</title></head>
        <body>
          <div class="movie-list">
            <div class="tags">
              <a href="/genres/uncensored">无码</a>
              <a href="/genres/western">欧美</a>
              <a href="/genres/fc2">FC2</a>
              <a href="/genres/anime">动漫</a>
            </div>
          </div>
          <div class="movie-panel-info">
            <div class="panel-block first-block">
              <h2 class="title is-4"><strong>SSIS-795</strong></h2>
            </div>
            <div class="panel-block genre">
              <strong>類別：</strong>
              <span class="value">
                <a href="/tags?c=1">劇情</a>
                <a href="/tags?c=2">中文字幕</a>
              </span>
            </div>
          </div>
        </body>
      </html>
    `;
    const client = new ApiClient() as unknown as ApiClientDetailParser;

    const parsed = client.parseVideoDetailFromHTML(html, 'abc123');

    expect(parsed?.tags).toEqual(['劇情', '中文字幕']);
  });

  it('旧同步入口同样不应把列表默认标签当成详情标签', () => {
    const html = `
      <html>
        <head><title>SSIS-795 测试标题 | JavDB</title></head>
        <body>
          <div class="movie-list">
            <div class="tags">
              <a href="/tags/default-uncensored">无码</a>
              <a href="/tags/default-western">欧美</a>
              <a href="/tags/default-fc2">FC2</a>
              <a href="/tags/default-anime">动漫</a>
            </div>
          </div>
          <div class="movie-panel-info">
            <div class="panel-block first-block">
              <h2 class="title is-4"><strong>SSIS-795</strong></h2>
            </div>
            <div class="panel-block genre">
              <strong>類別：</strong>
              <span class="value">
                <a href="/tags?c=1">劇情</a>
                <a href="/tags?c=2">中文字幕</a>
              </span>
            </div>
          </div>
        </body>
      </html>
    `;
    const client = getLegacyApiClient() as unknown as ApiClientDetailParser;

    const parsed = client.parseVideoDetailFromHTML(html, 'abc123');

    expect(parsed?.tags).toEqual(['劇情', '中文字幕']);
  });

  it('详情类别区块缺少類別文案时仍可通过 genre class 识别', () => {
    const html = `
      <div class="movie-list">
        <a href="/tags/default-uncensored">无码</a>
      </div>
      <div class="panel-block genre">
        <strong>Genres:</strong>
        <span class="value">
          <a href="/genres/drama">劇情</a>
          <a href="/genres/subtitle">中文字幕</a>
        </span>
      </div>
    `;

    const tags = extractDetailCategoryTagsFromHTML(html);

    expect(tags).toEqual(['劇情', '中文字幕']);
  });
});

// ---------------------------------------------------------------------------
// 10-06-mk-dir-sync-pagination：片商/導演收藏分页失控修复
// 真机锁定结构（2026-10-06 :12 侦察）：
//   - 收藏条目容器 = div#makers / div#directors（.section-container），条目 = 容器内 .box
//   - 空态 = 容器内一个无实体链接的 .box（「暫無內容」）
//   - 页面骨架（顶部导航）恒有 /makers/uncensored、/makers/N73g?f=download 等
//     带 ID 段的 /makers/<id> 链接（zone=nav，容器外）——整页 fallback 锚点扫描会抓入
//   - 越界页（?page>N）= 200 同模板，容器仅空态 box；单页收藏无容器内分页
// ---------------------------------------------------------------------------

const MKD_NAV_SKELETON = `
  <nav class="navbar">
    <a href="/makers/uncensored" title="無碼">無碼</a>
    <a href="/makers/N73g?f=download">麻豆傳媒映畫</a>
    <a href="/directors/skel-d1">骨架導演</a>
  </nav>`;

const makersPageHtml = (inner: string, pagination = ''): string => `
  <html><head><title>JavDB 成人影片數據庫</title></head><body>
  ${MKD_NAV_SKELETON}
  <section class="section"><div class="container"><div class="columns user-container">
    <div class="column is-10"><div class="section-container" id="makers">${inner}</div></div>
    ${pagination}
  </div></div></section>
  </body></html>`;

const makersItemBox = (id: string, name: string, movies?: number, withIdPrefix = true): string => `
  <div class="box"${withIdPrefix ? ` id="makers-${id}"` : ''}>
    <strong>${name}</strong>
    <a href="/makers/${id}">${movies != null ? `<span>${movies}</span>` : ''}</a>
  </div>`;

const MAKERS_EMPTY_BOX = `<div class="box"><a href="/login">暫無內容</a></div>`;

type MkdParser = {
  parseCollectionItemsFromHTML(html: string, mode: 'series' | 'labels' | 'makers' | 'directors'):
    Array<{ id: string; name: string; moviesCount?: number }>;
};

describe('data sync makers/directors collection parsing (10-06)', () => {
  it('makers：容器内条目解析，容器外导航骨架链接不入结果', () => {
    const html = makersPageHtml(
      makersItemBox('AEO', '某片商', 12) + makersItemBox('bb7x', '另一片商', undefined, false)
    );
    const client = new ApiClient() as unknown as MkdParser;
    const items = client.parseCollectionItemsFromHTML(html, 'makers');
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'AEO', name: '某片商', moviesCount: 12 });
    expect(items[1]).toEqual({ id: 'bb7x', name: '另一片商', moviesCount: undefined });
    expect(items.map((i) => i.id)).not.toContain('uncensored');
    expect(items.map((i) => i.id)).not.toContain('N73g');
  });

  it('makers：空态页（容器仅「暫無內容」box）+ 导航骨架 → 0 条目', () => {
    const html = makersPageHtml(MAKERS_EMPTY_BOX);
    const client = new ApiClient() as unknown as MkdParser;
    expect(client.parseCollectionItemsFromHTML(html, 'makers')).toEqual([]);
  });

  it('makers：#makers 容器缺失（结构漂移）→ fail-closed 0 条目，不整页回退', () => {
    const html = `<html><body>${MKD_NAV_SKELETON}<main>无容器页面</main></body></html>`;
    const client = new ApiClient() as unknown as MkdParser;
    expect(client.parseCollectionItemsFromHTML(html, 'makers')).toEqual([]);
  });

  it('directors：容器内条目解析，容器外骨架导演链接不入结果', () => {
    const html = `
      <html><body>${MKD_NAV_SKELETON}
      <div class="columns user-container"><div class="section-container" id="directors">
        <div class="box" id="directors-dekM"><strong>某導演</strong><a href="/directors/dekM"><span>8</span></a></div>
      </div></div>
      </body></html>`;
    const client = new ApiClient() as unknown as MkdParser;
    const items = client.parseCollectionItemsFromHTML(html, 'directors');
    expect(items).toEqual([{ id: 'dekM', name: '某導演', moviesCount: 8 }]);
  });

  it('series 回归：容器 primary 解析行为不变（容器外 /series/ 骨架不入结果）', () => {
    const html = `
      <html><body><nav><a href="/series/evil1">骨架系列</a></nav>
      <div id="series"><div class="box" id="series-eb7x"><strong>S系列</strong><a href="/series/eb7x"><span>3</span></a></div></div>
      </body></html>`;
    const client = new ApiClient() as unknown as MkdParser;
    const items = client.parseCollectionItemsFromHTML(html, 'series');
    expect(items).toEqual([{ id: 'eb7x', name: 'S系列', moviesCount: 3 }]);
  });
});

type MkdLoopClient = {
  fetchWithRetry(url: string, init?: RequestInit): Promise<Response>;
  delay(ms: number): Promise<void>;
  replaceCollectionListRecords(type: string, records: unknown[]): Promise<void>;
  syncUserMakers(userProfile: unknown, onProgress?: (p: unknown) => void, abortSignal?: AbortSignal): Promise<unknown>;
  syncUserDirectors(userProfile: unknown, onProgress?: (p: unknown) => void, abortSignal?: AbortSignal): Promise<unknown>;
};

function runMakersLoop(pages: Record<number, string>) {
  const client = new ApiClient() as unknown as Record<string, any> & MkdLoopClient;
  const fetched: number[] = [];
  client.fetchWithRetry = async (url: string) => {
    const m = url.match(/[?&]page=(\d+)/);
    const page = m ? Number(m[1]) : 1;
    fetched.push(page);
    return { ok: true, status: 200, text: async () => pages[page] ?? '' } as Response;
  };
  client.delay = async () => {};
  const dbCalls: Array<{ type: string; count: number; ids: string[] }> = [];
  client.replaceCollectionListRecords = async (type: string, records: any[]) => {
    dbCalls.push({ type, count: records.length, ids: records.map((r) => String(r.id)) });
  };
  return { client, fetched, dbCalls };
}

describe('data sync makers/directors pagination termination (10-06)', () => {
  it('makers 单页收藏：第 2 页（越界空态+骨架）即终止，落库仅真实条目', async () => {
    const p1 = makersPageHtml(makersItemBox('AEO', '某片商') + makersItemBox('bb7x', '另一片商'));
    const p2 = makersPageHtml(MAKERS_EMPTY_BOX); // 越界页：容器空态 + 导航骨架
    const { client, fetched, dbCalls } = runMakersLoop({ 1: p1, 2: p2 });
    await client.syncUserMakers({ username: 't', isLoggedIn: true });
    expect(fetched).toEqual([1, 2]);
    expect(dbCalls).toHaveLength(1);
    expect(dbCalls[0]).toEqual({ type: 'maker', count: 2, ids: ['maker:AEO', 'maker:bb7x'] }); // normalizeCollectionRecord: id=<type>:<externalId>
  });

  it('makers 多页收藏：容器内分页末页为界（3 页 → 恰 3 次请求，不多取越界页）', async () => {
    const pag = `<nav class="pagination"><a href="?page=1">1</a><a href="?page=2">2</a><a href="?page=3">3</a></nav>`;
    const pages: Record<number, string> = {
      1: makersPageHtml(makersItemBox('m1', '片商一'), pag),
      2: makersPageHtml(makersItemBox('m2', '片商二'), pag),
      3: makersPageHtml(makersItemBox('m3', '片商三'), pag),
    };
    const { client, fetched, dbCalls } = runMakersLoop(pages);
    await client.syncUserMakers({ username: 't', isLoggedIn: true });
    expect(fetched).toEqual([1, 2, 3]);
    expect(dbCalls[0].ids).toEqual(['maker:m1', 'maker:m2', 'maker:m3']);
  });

  it('makers 重复页：整页条目全部已见（零新增）→ 终止', async () => {
    const p1 = makersPageHtml(makersItemBox('AEO', '某片商'));
    const p2 = makersPageHtml(makersItemBox('AEO', '某片商')); // 同条目重复出现
    const { client, fetched, dbCalls } = runMakersLoop({ 1: p1, 2: p2 });
    await client.syncUserMakers({ username: 't', isLoggedIn: true });
    expect(fetched).toEqual([1, 2]);
    expect(dbCalls[0].ids).toEqual(['maker:AEO']);
  });

  it('makers 首页即空（空态+骨架）：1 次请求终止，落库空集不写骨架垃圾', async () => {
    const p1 = makersPageHtml(MAKERS_EMPTY_BOX);
    const { client, fetched, dbCalls } = runMakersLoop({ 1: p1 });
    await client.syncUserMakers({ username: 't', isLoggedIn: true });
    expect(fetched).toEqual([1]);
    expect(dbCalls[0]).toEqual({ type: 'maker', count: 0, ids: [] });
  });

  it('directors 对称：单页收藏越界即终止，落库仅容器内真实条目', async () => {
    const nav = `<nav class="navbar"><a href="/directors/skel-d1">骨架導演</a></nav>`;
    const d1 = `<html><body>${nav}<div class="columns user-container"><div class="section-container" id="directors">
      <div class="box" id="directors-dekM"><strong>某導演</strong><a href="/directors/dekM"></a></div>
    </div></div></body></html>`;
    const d2 = `<html><body>${nav}<div class="columns user-container"><div class="section-container" id="directors">
      <div class="box"><a href="/login">暫無內容</a></div>
    </div></div></body></html>`;
    const { client, fetched, dbCalls } = runMakersLoop({ 1: d1, 2: d2 });
    await client.syncUserDirectors({ username: 't', isLoggedIn: true });
    expect(fetched).toEqual([1, 2]);
    expect(dbCalls[0]).toEqual({ type: 'director', count: 1, ids: ['director:dekM'] });
  });
});
