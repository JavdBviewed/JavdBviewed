// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSiteFavoritesSync, parseSiteFavoriteTarget, reconcileSiteFavorite, type SiteFavoriteTarget } from './siteFavoritesSync';

const cases: Array<[SiteFavoriteTarget['type'], string, string, string]> = [
  ['favorite', 'QV1m87', '/users/favorite_lists', '<div id="lists"><li class="list-item" id="list-QV1m87"><a class="list-name" href="/lists/QV1m87">My list</a></li></div>'],
  ['series', 'gr8A', '/users/collection_series', '<div id="series"><div class="box" id="series-gr8A"><strong>Series</strong></div></div>'],
  ['label', 'FC2', '/users/collection_codes', '<div id="codes"><div class="box" id="code-FC2"><strong>Label</strong></div></div>'],
  ['maker', 'AEO', '/users/collection_makers', '<div id="makers"><div class="box" id="makers-AEO"><strong>Maker</strong></div></div>'],
  ['director', 'dekM', '/users/collection_directors', '<div id="directors"><div class="box" id="directors-dekM"><strong>Director</strong></div></div>'],
];

function stubRuntime(records: any[] = []) {
  const sendMessage = vi.fn((message: { type: string; payload?: { record?: any; id?: string } }, respond: (response: unknown) => void) => {
    if (message.type === 'DB:LISTS_GET_ALL') respond({ success: true, records });
    else respond({ success: true });
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return sendMessage;
}

function stubFetch(html: string, status = 200) {
  const fetcher = vi.fn(async (url: string) => ({ ok: status === 200, status, url, text: async () => html }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('站点收藏五类即时对账', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ''; });

  it.each([
    ['/lists/QV1m87', 'favorite', 'QV1m87'],
    ['/series/gr8A', 'series', 'gr8A'],
    ['/video_codes/fc2', 'label', 'fc2'],
    ['/makers/AEO', 'maker', 'AEO'],
    ['/directors/dekM', 'director', 'dekM'],
  ])('%s 页面识别正确的收藏类型', (path, type, id) => {
    expect(parseSiteFavoriteTarget(path, 'https://javdb.com', 'test')).toMatchObject({ type, id });
  });

  it('原生收藏按钮点击后只在站点索引确认时写入，卸载后不响应', async () => {
    const sendMessage = stubRuntime();
    stubFetch(cases[0][3]);
    document.body.innerHTML = '<h1>My list</h1><button id="button-collect-list">收藏</button>';
    vi.useFakeTimers();
    const dispose = installSiteFavoritesSync(document, { pathname: '/lists/QV1m87', origin: 'https://javdb.com' } as Location);
    document.querySelector<HTMLButtonElement>('#button-collect-list')?.click();
    await vi.advanceTimersByTimeAsync(800);
    expect(sendMessage.mock.calls.filter(([msg]) => msg.type === 'DB:LISTS_PUT')).toHaveLength(1);
    dispose();
    document.querySelector<HTMLButtonElement>('#button-collect-list')?.click();
    await vi.advanceTimersByTimeAsync(800);
    expect(sendMessage.mock.calls.filter(([msg]) => msg.type === 'DB:LISTS_PUT')).toHaveLength(1);
  });

  it('站点实际使用的 .button-collect class 点击后同步收藏', async () => {
    const sendMessage = stubRuntime();
    stubFetch(cases[0][3]);
    document.body.innerHTML = '<button class="button-collect"><span>收藏</span></button>';
    vi.useFakeTimers();
    const dispose = installSiteFavoritesSync(document, { pathname: '/lists/QV1m87', origin: 'https://javdb.com' } as Location);
    document.querySelector<HTMLSpanElement>('.button-collect span')?.click();
    await vi.advanceTimersByTimeAsync(800);
    dispose();
    expect(sendMessage.mock.calls.filter(([msg]) => msg.type === 'DB:LISTS_PUT')).toHaveLength(1);
  });

  it('站点实际使用的 .button-uncollect class 点击后移除站点镜像', async () => {
    const old = { id: 'QV1m87', name: 'list', type: 'favorite', source: 'javdb', createdAt: 1, updatedAt: 2 };
    const sendMessage = stubRuntime([old]);
    stubFetch('<div id="lists"><li class="list-item" id="list-other"><a href="/lists/other">Other</a></li></div>');
    document.body.innerHTML = '<button class="button-uncollect"><span>取消收藏</span></button>';
    vi.useFakeTimers();
    const dispose = installSiteFavoritesSync(document, { pathname: '/lists/QV1m87', origin: 'https://javdb.com' } as Location);
    document.querySelector<HTMLSpanElement>('.button-uncollect span')?.click();
    await vi.advanceTimersByTimeAsync(800);
    dispose();
    expect(sendMessage.mock.calls.some(([msg]) => msg.type === 'DB:LISTS_DELETE' && msg.payload?.id === old.id)).toBe(true);
  });

  it.each(cases)('%s 收藏已出现在站点索引才更新本地', async (type, id, path, body) => {
    const sendMessage = stubRuntime();
    const fetcher = stubFetch(body);
    await reconcileSiteFavorite({ type, id, name: 'item', origin: 'https://javdb.com' });
    expect(fetcher.mock.calls[0]?.[0]).toContain(path);
    const puts = sendMessage.mock.calls.filter(([msg]) => msg.type === 'DB:LISTS_PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0][0].payload?.record).toMatchObject({ type, source: 'javdb' });
  });

  it('200 登录墙、挑战页和无匹配结构均不得写入本地', async () => {
    const sendMessage = stubRuntime();
    for (const body of ["window.location.href='/login';", 'Just a moment...', '<main>nothing useful</main>']) {
      stubFetch(body);
      await reconcileSiteFavorite({ type: 'favorite', id: 'QV1m87', name: 'list', origin: 'https://javdb.com' });
    }
    expect(sendMessage.mock.calls.filter(([msg]) => msg.type === 'DB:LISTS_PUT')).toHaveLength(0);
  });

  it('确认不在站点收藏索引后可删除本地收藏镜像，保留其他清单', async () => {
    const old = { id: 'QV1m87', name: 'list', type: 'favorite', source: 'javdb', createdAt: 1, updatedAt: 2 };
    const sendMessage = stubRuntime([old]);
    stubFetch('<div id="lists"><li class="list-item" id="list-another"><a href="/lists/another">other</a></li></div>');
    await reconcileSiteFavorite({ type: 'favorite', id: 'QV1m87', name: 'list', origin: 'https://javdb.com' });
    expect(sendMessage.mock.calls.some(([msg]) => msg.type === 'DB:LISTS_DELETE' && msg.payload?.id === old.id)).toBe(true);
  });

  it('站点未收藏时不删除同 ID 的本地自建清单', async () => {
    const old = { id: 'QV1m87', name: 'local', type: 'favorite', source: 'local', createdAt: 1, updatedAt: 2 };
    const sendMessage = stubRuntime([old]);
    stubFetch('<div id="lists"><li class="list-item" id="list-other"><a href="/lists/other">Other</a></li></div>');
    await reconcileSiteFavorite({ type: 'favorite', id: old.id, name: old.name, origin: 'https://javdb.com' }, false);
    expect(sendMessage.mock.calls.some(([msg]) => msg.type === 'DB:LISTS_DELETE')).toBe(false);
  });

  it('目标在第二页：第一页缺失不能误删已有收藏', async () => {
    const old = { id: 'QV1m87', name: 'list', type: 'favorite', source: 'javdb', createdAt: 1, updatedAt: 2 };
    const sendMessage = stubRuntime([old]);
    const fetcher = vi.fn(async (url: string) => ({
      ok: true, url,
      text: async () => url.endsWith('page=1')
        ? '<div id="lists"><li class="list-item" id="list-other"><a href="/lists/other">Other</a></li></div><nav class="pagination"><a class="pagination-link" href="?page=2">2</a></nav>'
        : cases[0][3],
    }));
    vi.stubGlobal('fetch', fetcher);
    expect(await reconcileSiteFavorite({ type: 'favorite', id: old.id, name: old.name, origin: 'https://javdb.com' }, true)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.filter(([msg]) => msg.type === 'DB:LISTS_DELETE')).toHaveLength(0);
  });

  it('站点仍未收藏时不因本地旧值而误写或误删', async () => {
    const old = { id: 'QV1m87', name: 'list', type: 'favorite', source: 'javdb', createdAt: 1, updatedAt: 2 };
    const sendMessage = stubRuntime([old]);
    stubFetch('<div id="lists"><li class="list-item" id="list-other"><a href="/lists/other">Other</a></li></div>');
    expect(await reconcileSiteFavorite({ type: 'favorite', id: old.id, name: old.name, origin: 'https://javdb.com' }, true)).toBe(false);
    expect(sendMessage.mock.calls.filter(([msg]) => msg.type.startsWith('DB:LISTS_'))).toHaveLength(0);
  });
});
