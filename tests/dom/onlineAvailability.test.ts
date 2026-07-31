/**
 * @file onlineAvailability.test.ts
 * @description online availability helpers 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultHttpClient } from '../../apps/extension/src/platform/network/httpClient';
import {
  applyOnlineAvailabilitySitePreferences,
  buildOnlineAvailabilityUrl,
  DEFAULT_ONLINE_AVAILABILITY_SITES,
  findOnlineAvailabilityInsertionTarget,
  OnlineAvailabilityManager,
  parseOnlineAvailabilityDocument,
} from '../../apps/extension/src/features/onlineAvailability';

describe('online availability helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('builds site urls with optional code formatting', () => {
    const fanza = DEFAULT_ONLINE_AVAILABILITY_SITES.find(site => site.key === 'fanza')!;

    expect(buildOnlineAvailabilityUrl(fanza, 'SSIS-795')).toBe(
      'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=SSIS00795/',
    );
  });

  it('includes the expanded online site adapter set', () => {
    const siteKeys = DEFAULT_ONLINE_AVAILABILITY_SITES.map(site => site.key);

    expect(siteKeys).toEqual(expect.arrayContaining(['123av', 'netflav', 'javguru']));
    expect(buildOnlineAvailabilityUrl(DEFAULT_ONLINE_AVAILABILITY_SITES.find(site => site.key === '123av')!, 'SSIS-795')).toBe(
      'https://123av.com/zh/search?keyword=ssis-795',
    );
  });

  it('applies saved site enabled preferences without mutating the built-in site rules', () => {
    const configured = applyOnlineAvailabilitySitePreferences(DEFAULT_ONLINE_AVAILABILITY_SITES, {
      missav: false,
      jable: true,
      unknown: false,
    });

    expect(configured.find(site => site.key === 'missav')?.enabled).toBe(false);
    expect(configured.find(site => site.key === 'jable')?.enabled).toBe(true);
    expect(configured.find(site => site.key === 'fanza')?.enabled).toBe(true);
    expect(DEFAULT_ONLINE_AVAILABILITY_SITES.find(site => site.key === 'missav')?.enabled).toBe(true);
  });

  it('marks direct detail pages available when the response is successful', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'jable')!;
    const doc = new DOMParser().parseFromString(`
      <link rel="canonical" href="https://jable.tv/videos/ssis-795/">
      <meta property="og:type" content="video.movie">
      <div class="video-info"><div class="info-header">SSIS-795</div></div>
      <video src="preview.mp4"></video>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://jable.tv/videos/ssis-795/', 200);

    expect(result).toEqual({
      siteKey: 'jable',
      siteName: 'Jable',
      available: true,
      url: 'https://jable.tv/videos/ssis-795/',
      tags: [],
    });
  });

  it('marks direct detail pages unavailable when the response status is an error', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'jable')!;
    const doc = new DOMParser().parseFromString('<html><title>404 Not Found</title></html>', 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://jable.tv/videos/jur-730/', 404);

    expect(result.available).toBe(false);
  });

  it('marks FANZA unavailable when the requested cid only appears in an empty shell', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'fanza')!;
    const doc = new DOMParser().parseFromString(`
      <title>FANZA動画</title>
      <meta name="keywords" content="JUR-730">
      <input name="searchstr" value="JUR-730">
      <div id="root"></div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=JUR00730/', 200);

    expect(result.available).toBe(false);
  });

  it('marks FANZA unavailable when a list shell only echoes the requested product title', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'fanza');
    if (!site) throw new Error('FANZA site rule not found');
    const doc = new DOMParser().parseFromString(`
      <title>FANZA動画 検索</title>
      <form action="/search/"><input name="searchstr" value="JUR-730"></form>
      <section class="d-item-list">
        <a class="productTitle" href="/digital/videoa/-/list/">JUR-730 Sample Recommendation</a>
      </section>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=JUR00730/', 200);

    expect(result.available).toBe(false);
  });

  it('marks FANZA available when the detail page carries a product cid signal', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'fanza')!;
    const doc = new DOMParser().parseFromString(`
      <title>JUR-730 - FANZA動画</title>
      <link rel="canonical" href="https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=JUR00730/">
      <meta property="og:url" content="https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=JUR00730/">
      <h1 class="productTitle">JUR-730</h1>
      <script>window.dataLayer = [{ product_id: "JUR00730" }]</script>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=JUR00730/', 200);

    expect(result.available).toBe(true);
  });

  it('marks FANZA unavailable for age-check or empty shell pages without the requested cid', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'fanza')!;
    const doc = new DOMParser().parseFromString(`
      <title>年齢認証 - FANZA</title>
      <script src="/_next/static/chunks/app/not-found.js"></script>
      <a href="/age_check/=/declared=yes/">はい</a>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=JUR00730/', 200);

    expect(result.available).toBe(false);
  });

  it('marks Jable unavailable when info-header appears on a generic shell', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'jable')!;
    const doc = new DOMParser().parseFromString(`
      <title>Jable 搜索</title>
      <div class="info-header">JUR-730</div>
      <main class="search-results">No videos found for JUR-730</main>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://jable.tv/videos/jur-730/', 200);

    expect(result.available).toBe(false);
  });

  it('marks Jable unavailable when og video metadata appears without detail-page signals', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'jable');
    if (!site) throw new Error('Jable site rule not found');
    const doc = new DOMParser().parseFromString(`
      <title>Jable Search JUR-730</title>
      <link rel="canonical" href="https://jable.tv/search/jur-730/">
      <meta property="og:type" content="video.movie">
      <div class="info-header">JUR-730</div>
      <main class="search-results">JUR-730</main>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://jable.tv/videos/jur-730/', 200);

    expect(result.available).toBe(false);
  });

  it('marks MISSAV available only when the response carries detail-page signals', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'missav')!;
    const doc = new DOMParser().parseFromString(`
      <title>JUR-730 - MissAV</title>
      <h1>JUR-730 Sample Title</h1>
      <nav>詳情 女優消息 磁力下載</nav>
      <div>發行日期: 2026-05-22</div>
      <div>番號: JUR-730</div>
      <a class="text-nord13" href="https://missav.ws/chinese-subtitle">中文字幕</a>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://missav.ws/jur-730/', 200);

    expect(result.available).toBe(true);
    expect(result.tags).toContain('字幕');
  });

  it('keeps MISSAV detail pages available when global search controls are present', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'missav')!;
    const doc = new DOMParser().parseFromString(`
      <title>JUR-730 - MissAV</title>
      <form action="/search"><input type="search" value=""></form>
      <h1>JUR-730 Sample Title</h1>
      <div>發行日期: 2026-05-22</div>
      <div>番號: JUR-730</div>
      <a class="text-nord13" href="https://missav.ws/chinese-subtitle">中文字幕</a>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://missav.ws/jur-730/', 200);

    expect(result.available).toBe(true);
  });

  it('marks MISSAV unavailable when a search or shell page only echoes the requested code', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'missav')!;
    const doc = new DOMParser().parseFromString(`
      <title>搜尋 JUR-730 - MissAV</title>
      <input type="search" value="JUR-730">
      <nav>最近更新 新作上市 中文字幕 女優一覽</nav>
      <main>搜尋 JUR-730</main>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://missav.ws/jur-730/', 200);

    expect(result.available).toBe(false);
  });

  it('marks JavBus unavailable when a soft error page only echoes the requested code', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'javbus')!;
    const doc = new DOMParser().parseFromString(`
      <title>JavBus</title>
      <form><input value="JUR-730"></form>
      <div class="error">Access denied for JUR-730</div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://javbus.com/JUR-730', 200);

    expect(result.available).toBe(false);
  });

  it('marks JavBus available when detail-page structure and exact code are present', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'javbus')!;
    const doc = new DOMParser().parseFromString(`
      <h3>JUR-730 Sample Title</h3>
      <a class="bigImage" href="/pics/cover.jpg"></a>
      <div id="sample-waterfall"></div>
      <p>識別碼: JUR-730</p>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'JUR-730', 'https://javbus.com/JUR-730', 200);

    expect(result.available).toBe(true);
  });

  it('checks parser pages by matching the result title or link against the code', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'supjav')!;
    const doc = new DOMParser().parseFromString(`
      <div class="posts clearfix">
        <div class="post"><a class="img" title="ABCD-123" href="/abcd-123"></a></div>
        <div class="post"><a class="img" title="SSIS-795 Chinese Subtitle" href="https://supjav.com/ssis-795/"></a></div>
      </div>
      <h3><a rel="bookmark" itemprop="url">SSIS-795 Chinese Subtitle</a></h3>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://supjav.com/zh/?s=SSIS-795', 200);

    expect(result.available).toBe(true);
    expect(result.tags).toContain('字幕');
    expect(result.url).toBe('https://supjav.com/ssis-795/');
  });

  it('matches 123AV only when a visible result title carries the exact code', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === '123av')!;
    const doc = new DOMParser().parseFromString(`
      <div class="detail">
        <a href="/zh/v/ssis-795">SSIS-795 Sample Video</a>
      </div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://123av.com/zh/search?keyword=ssis-795', 200);

    expect(result.available).toBe(true);
    expect(result.url).toBe('https://123av.com/zh/v/ssis-795');
  });

  it('rejects 123AV parser shell links that only carry the code in href', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === '123av')!;
    const doc = new DOMParser().parseFromString(`
      <div class="detail">
        <a href="/zh/v/ssis-795"><span>Open result</span></a>
      </div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://123av.com/zh/search?keyword=ssis-795', 200);

    expect(result.available).toBe(false);
  });

  it('matches NETFLAV result cards through the card title text', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'netflav')!;
    const doc = new DOMParser().parseFromString(`
      <div class="grid_0_cell">
        <a href="/video?id=abc123">
          <span class="grid_0_title">SSIS-795 Chinese Subtitle</span>
        </a>
      </div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://netflav5.com/search?type=title&keyword=ssis-795', 200);

    expect(result.available).toBe(true);
    expect(result.url).toBe('https://netflav5.com/video?id=abc123');
    expect(result.tags).toContain('字幕');
  });

  it('rejects NETFLAV links that only carry the code in href', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'netflav')!;
    const doc = new DOMParser().parseFromString(`
      <div class="grid_0_cell">
        <a href="/video?keyword=ssis-795">
          <span class="grid_0_title">Random Recommendation</span>
        </a>
      </div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://netflav5.com/search?type=title&keyword=ssis-795', 200);

    expect(result.available).toBe(false);
  });

  it('returns the matched parser result link when the title selector is the matching anchor', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'javguru')!;
    const doc = new DOMParser().parseFromString(`
      <div class="inside-article">
        <div class="grid1"><a title="SSIS-795 Chinese Subtitle" href="https://jav.guru/ssis-795/">SSIS-795</a></div>
      </div>
      <div class="imgg"><a href="https://jav.guru/ssis-795/">cover</a></div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://jav.guru/?s=SSIS-795', 200);

    expect(result.available).toBe(true);
    expect(result.url).toBe('https://jav.guru/ssis-795/');
  });

  it('rejects Jav.Guru cover links when the paired title belongs to another code', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === 'javguru')!;
    const doc = new DOMParser().parseFromString(`
      <div class="inside-article">
        <div class="grid1"><a title="ABCD-123 Different Video" href="https://jav.guru/abcd-123/">ABCD-123</a></div>
      </div>
      <div class="imgg"><a href="https://jav.guru/ssis-795/">cover</a></div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://jav.guru/?s=SSIS-795', 200);

    expect(result.available).toBe(false);
  });

  it('rejects parser results whose code only contains the requested code as a prefix', () => {
    const site = DEFAULT_ONLINE_AVAILABILITY_SITES.find(item => item.key === '123av')!;
    const doc = new DOMParser().parseFromString(`
      <div class="detail">
        <a href="https://123av.com/zh/v/ssis-7950">SSIS-7950 Similar Video</a>
      </div>
    `, 'text/html');

    const result = parseOnlineAvailabilityDocument(site, doc, 'SSIS-795', 'https://123av.com/zh/search?keyword=ssis-795', 200);

    expect(result.available).toBe(false);
  });

  it('places the panel in a detail enhancement panel after the main columns', () => {
    document.body.innerHTML = `
      <div class="columns is-desktop">
        <div class="column column-video-cover">cover</div>
        <div class="column">
          <nav class="panel movie-panel-info">
            <div class="panel-block">番号</div>
            <div class="review-buttons"></div>
            <div class="panel-block">stats</div>
          </nav>
        </div>
      </div>
    `;

    const target = findOnlineAvailabilityInsertionTarget();
    const columns = document.querySelector('.columns.is-desktop');
    const container = document.getElementById('jdb-detail-enhancement-panel');

    expect(target?.parent).toBe(document.querySelector('#jdb-detail-enhancement-panel .panel'));
    expect(target?.before).toBeNull();
    expect(container?.previousElementSibling).toBe(columns);
  });

  it('keeps detail external and subtitle search directly below online availability when online availability loads later', async () => {
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-795</strong></h2>
      <div class="columns is-desktop">
        <div class="column column-video-cover">cover</div>
        <div class="column">
          <nav class="panel movie-panel-info">
            <div class="panel-block first-block">SSIS-795</div>
            <div class="review-buttons"></div>
          </nav>
        </div>
      </div>
      <div id="jdb-detail-enhancement-panel" class="jdb-detail-enhancement-panel">
        <nav class="panel jdb-detail-enhancement-panel-inner">
          <div id="jdb-external-search-panel" class="panel-block">外部搜索</div>
          <div id="jdb-subtitle-search-panel" class="panel-block">字幕搜索</div>
        </nav>
      </div>
    `;

    const manager = new OnlineAvailabilityManager();
    manager.updateConfig({
      enabled: true,
      autoCheck: false,
    });

    await manager.initialize();

    const onlinePanel = document.getElementById('jdb-online-availability-panel');
    const searchPanel = document.getElementById('jdb-external-search-panel');

    const subtitlePanel = document.getElementById('jdb-subtitle-search-panel');
    expect(onlinePanel?.parentElement).toBe(document.querySelector('#jdb-detail-enhancement-panel .panel'));
    expect(onlinePanel?.nextElementSibling).toBe(searchPanel);
    expect(searchPanel?.nextElementSibling).toBe(subtitlePanel);
    expect(document.querySelector('.movie-panel-info #jdb-online-availability-panel')).toBeNull();
  });

  it('renders a final empty state when a site request never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(defaultHttpClient, 'getDocument').mockImplementation(() => new Promise<Document>(() => {}));
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-795</strong></h2>
      <nav class="panel movie-panel-info">
        <div class="review-buttons"></div>
      </nav>
    `;

    const manager = new OnlineAvailabilityManager();
    manager.updateConfig({
      enabled: true,
      autoCheck: true,
      timeoutMs: 50,
      showUnavailable: false,
      sites: [{
        key: 'stuck',
        name: 'Stuck',
        url: 'https://example.test/{{code}}',
        fetchType: 'get',
        enabled: true,
      }],
    });

    const completed = vi.fn();
    void manager.initialize().then(completed);

    await vi.advanceTimersByTimeAsync(51);
    await Promise.resolve();

    expect(completed).toHaveBeenCalled();
    expect(document.querySelector('#jdb-online-availability-panel')?.textContent).toContain('暂无命中');
    expect(document.querySelector('.jdb-online-status')).toBeNull();
  });

  it('renders unavailable site tags when a checked site fails', async () => {
    vi.spyOn(defaultHttpClient, 'getDocument').mockImplementation(async url => {
      if (String(url).includes('ok.test')) {
        return new DOMParser().parseFromString('<div class="info-header">SSIS-795</div>', 'text/html');
      }
      throw new Error('HTTP 404');
    });
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-795</strong></h2>
      <nav class="panel movie-panel-info">
        <div class="review-buttons"></div>
      </nav>
    `;

    const manager = new OnlineAvailabilityManager();
    manager.updateConfig({
      enabled: true,
      autoCheck: true,
      timeoutMs: 50,
      showUnavailable: true,
      sites: [
        {
          key: 'ok',
          name: 'OK',
          url: 'https://ok.test/{{code}}',
          fetchType: 'get',
          enabled: true,
          domQuery: { subQuery: '.info-header' },
        },
        {
          key: 'missing',
          name: 'Missing',
          url: 'https://missing.test/{{code}}',
          fetchType: 'get',
          enabled: true,
        },
      ],
    });

    await manager.initialize();

    expect(document.querySelector('#jdb-online-availability-panel a')?.textContent).toBe('OK');
    expect(document.querySelector('.jdb-online-unavailable')?.textContent).toBe('Missing 失败');
  });

  it('hides unavailable tags by default', async () => {
    vi.spyOn(defaultHttpClient, 'getDocument').mockRejectedValue(new Error('HTTP 404'));
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-795</strong></h2>
      <nav class="panel movie-panel-info">
        <div class="review-buttons"></div>
      </nav>
    `;

    const manager = new OnlineAvailabilityManager();
    manager.updateConfig({
      enabled: true,
      autoCheck: true,
      timeoutMs: 50,
      sites: [{
        key: 'missing',
        name: 'Missing',
        url: 'https://missing.test/{{code}}',
        fetchType: 'get',
        enabled: true,
      }],
    });

    await manager.initialize();

    expect(document.querySelector('.jdb-online-unavailable')).toBeNull();
    expect(document.querySelector('#jdb-online-availability-panel')?.textContent).toContain('暂无命中');
  });

  it('renders unavailable tags when every checked site fails', async () => {
    vi.spyOn(defaultHttpClient, 'getDocument').mockRejectedValue(new Error('HTTP 404'));
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-795</strong></h2>
      <nav class="panel movie-panel-info">
        <div class="review-buttons"></div>
      </nav>
    `;

    const manager = new OnlineAvailabilityManager();
    manager.updateConfig({
      enabled: true,
      autoCheck: true,
      timeoutMs: 50,
      showUnavailable: true,
      sites: [{
        key: 'missing',
        name: 'Missing',
        url: 'https://missing.test/{{code}}',
        fetchType: 'get',
        enabled: true,
      }],
    });

    await manager.initialize();

    expect(document.querySelector('.jdb-online-unavailable')?.textContent).toBe('Missing 失败');
    expect(document.querySelector('#jdb-online-availability-panel')?.textContent).not.toContain('暂无命中');
  });

  it('falls back to the Jable chinese-subtitle detail path before rendering results', async () => {
    vi.spyOn(defaultHttpClient, 'getDocument').mockImplementation(async url => {
      if (String(url).endsWith('/ssis-795/')) {
        throw new Error('HTTP 404');
      }
      return new DOMParser().parseFromString(`
        <link rel="canonical" href="https://jable.tv/videos/ssis-795-c/">
        <meta property="og:type" content="video.movie">
        <div class="video-info"><div class="info-header">SSIS-795</div></div>
      `, 'text/html');
    });
    document.body.innerHTML = `
      <h2 class="title is-4"><strong>SSIS-795</strong></h2>
      <nav class="panel movie-panel-info">
        <div class="review-buttons"></div>
      </nav>
    `;

    const manager = new OnlineAvailabilityManager();
    manager.updateConfig({
      enabled: true,
      autoCheck: true,
      timeoutMs: 50,
      sites: [{
        key: 'jable',
        name: 'Jable',
        url: 'https://jable.tv/videos/{{code}}/',
        fetchType: 'get',
        enabled: true,
        domQuery: { subQuery: '.info-header', leakQuery: '.info-header' },
      }],
    });

    await manager.initialize();

    expect(defaultHttpClient.getDocument).toHaveBeenCalledWith('https://jable.tv/videos/ssis-795-c/', expect.any(Object));
    expect(document.querySelector('#jdb-online-availability-panel a')?.getAttribute('href')).toBe('https://jable.tv/videos/ssis-795-c/');
  });
});
