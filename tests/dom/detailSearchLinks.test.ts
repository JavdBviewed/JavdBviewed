/**
 * @file detailSearchLinks.test.ts
 * @description detail search links 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultHttpClient } from '../../apps/extension/src/platform/network/httpClient';
import {
  buildDetailSearchLinks,
  findDetailSearchInsertionTarget,
  renderDetailSearchLinks,
} from '../../apps/extension/src/features/externalSearch';

describe('detail search links', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds links from configured search engines and removes duplicate templates', () => {
    const links = buildDetailSearchLinks('SSIS-795', [
      { id: 'javdb', name: 'JavDB', urlTemplate: 'https://javdb.com/search?q={{ID}}', icon: '' },
      { id: 'copy', name: 'JavDB Copy', urlTemplate: 'https://javdb.com/search?q={{ id }}', icon: '' },
      { id: 'bad', name: 'Bad', urlTemplate: '', icon: '' },
    ]);

    expect(links).toEqual([
      {
        name: 'JavDB',
        url: 'https://javdb.com/search?q=SSIS-795',
        icon: 'chrome-extension://test-runtime/assets/javdb.ico',
        category: 'search',
      },
    ]);
  });

  it('hides FC2-only detail links for standard video ids', () => {
    const links = buildDetailSearchLinks('SSIS-795', [
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: '', contexts: ['detail'] },
      { id: 'fc2ppvdb', name: 'FC2PPVDB', urlTemplate: 'https://fc2ppvdb.com/articles/{{FC2_ID}}', icon: '', match: 'fc2', contexts: ['detail'] },
    ]);

    expect(links.map(link => link.name)).toEqual(['SubTitleCat']);
  });

  it('renders FC2-only detail links for FC2 video ids with numeric placeholders', () => {
    const links = buildDetailSearchLinks('FC2-4903984', [
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: '', contexts: ['detail'] },
      { id: 'fc2ppvdb', name: 'FC2PPVDB', urlTemplate: 'https://fc2ppvdb.com/articles/{{FC2_ID}}', icon: '', match: 'fc2', contexts: ['detail'] },
    ]);

    expect(links.map(link => link.name)).toEqual(['SubTitleCat', 'FC2PPVDB']);
    expect(links[1].url).toBe('https://fc2ppvdb.com/articles/4903984');
  });

  it('places the search row in the detail enhancement panel below online availability when it is present', () => {
    document.body.innerHTML = `
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
          <div id="jdb-online-availability-panel" class="panel-block">在线可看</div>
        </nav>
      </div>
    `;

    const target = findDetailSearchInsertionTarget();

    expect(target?.parent).toBe(document.querySelector('#jdb-detail-enhancement-panel .panel'));
    expect(target?.before).toBe(document.querySelector('#jdb-online-availability-panel')?.nextSibling);
  });

  it('creates a detail enhancement panel after the main columns when the online panel has not rendered yet', () => {
    document.body.innerHTML = `
      <div class="columns is-desktop">
        <div class="column column-video-cover">cover</div>
        <div class="column">
          <nav class="panel movie-panel-info">
            <div class="panel-block first-block">SSIS-795</div>
            <div class="review-buttons"></div>
            <div class="panel-block">stats</div>
          </nav>
        </div>
      </div>
    `;

    const target = findDetailSearchInsertionTarget();
    const columns = document.querySelector('.columns.is-desktop');
    const container = document.getElementById('jdb-detail-enhancement-panel');

    expect(target?.parent).toBe(document.querySelector('#jdb-detail-enhancement-panel .panel'));
    expect(target?.before).toBeNull();
    expect(container?.previousElementSibling).toBe(columns);
    expect(document.querySelector('.movie-panel-info #jdb-external-search-panel')).toBeNull();
  });

  it('renders a compact external search panel on detail pages', () => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico' },
    ]);

    const panel = document.getElementById('jdb-external-search-panel');
    const link = panel?.querySelector<HTMLAnchorElement>('a');
    const icon = link?.querySelector<HTMLImageElement>('img');

    expect(panel?.className).toContain('panel-block');
    expect(panel?.parentElement).toBe(document.querySelector('#jdb-detail-enhancement-panel .panel'));
    expect(document.querySelector('.movie-panel-info #jdb-external-search-panel')).toBeNull();
    expect(panel?.textContent).toContain('外部搜索:');
    expect(link?.textContent).toBe('JavBus');
    expect(link?.href).toBe('https://javbus.com/search/SSIS-795');
    expect(icon?.src).toBe('chrome-extension://test-runtime/assets/javbus.ico');
  });

  it('renders subtitle search links in a separate detail panel', () => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search' },
      { id: 'missav', name: 'MISSAV', urlTemplate: 'https://missav.ws/search/{{ID}}', icon: 'assets/missav.ico', category: 'resource' },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);

    const externalPanel = document.getElementById('jdb-external-search-panel');
    const subtitlePanel = document.getElementById('jdb-subtitle-search-panel');

    expect(externalPanel?.textContent).toContain('外部搜索:');
    expect(externalPanel?.textContent).toContain('JavBus');
    expect(externalPanel?.textContent).toContain('MISSAV');
    expect(externalPanel?.textContent).not.toContain('SubTitleCat');
    expect(subtitlePanel?.textContent).toContain('字幕搜索:');
    expect(subtitlePanel?.textContent).toContain('SubTitleCat');
  });

  it('hides subtitle search panel when the detail option is disabled', () => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search' },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ], { showSubtitleSearch: false });

    expect(document.getElementById('jdb-external-search-panel')?.textContent).toContain('JavBus');
    expect(document.getElementById('jdb-subtitle-search-panel')).toBeNull();
  });

  it('hides external search panel while keeping subtitle search when the external search option is disabled', () => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search' },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ], { showExternalSearch: false });

    expect(document.getElementById('jdb-external-search-panel')).toBeNull();
    expect(document.getElementById('jdb-subtitle-search-panel')?.textContent).toContain('SubTitleCat');
  });

  it('removes detail external entry panels when the unified panel option is disabled', () => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search' },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search' },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ], { enabled: false });

    expect(document.getElementById('jdb-external-search-panel')).toBeNull();
    expect(document.getElementById('jdb-subtitle-search-panel')).toBeNull();
  });

  it('hides disabled search engines from detail panels', () => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search', enabled: false },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);

    expect(document.getElementById('jdb-external-search-panel')).toBeNull();
    expect(document.getElementById('jdb-subtitle-search-panel')?.textContent).toContain('SubTitleCat');
  });

  it('opens SubTitleCat through native fetched results instead of embedding the site page', async () => {
    const searchDoc = new DOMParser().parseFromString(`
      <table class="table sub-table">
        <tbody>
          <tr>
            <td><a href="subs/1072/SSIS%20-%20795.html">SSIS - 795</a> (translated from Chinese)</td>
            <td><i>👍</i></td>
            <td class="sub-table__size-cell"><span class="sub-table__metric-value">63 KB</span></td>
            <td>9 downloads</td>
            <td>9 languages</td>
          </tr>
          <tr>
            <td><a href="subs/999/DLDSS-063.html">DLDSS-063</a> (translated from English)</td>
            <td><i>👎</i></td>
            <td class="sub-table__size-cell"><span class="sub-table__metric-value">33 KB</span></td>
            <td>7 downloads</td>
            <td>7 languages</td>
          </tr>
        </tbody>
      </table>
    `, 'text/html');
    vi.spyOn(defaultHttpClient, 'getDocument').mockResolvedValue(searchDoc);
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/index.php?search={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const modal = document.querySelector('.jdb-subtitlecat-subtitle-modal');
    const rows = modal?.querySelectorAll('.jdb-subtitlecat-subtitle-row');

    expect(defaultHttpClient.getDocument).toHaveBeenCalledWith(
      'https://subtitlecat.com/index.php?search=SSIS-795',
      expect.objectContaining({ responseType: 'document' }),
    );
    expect(modal?.querySelector('#jdb-subtitlecat-subtitle-title')?.textContent).toBe('SubTitleCat · SSIS-795 · 1 条');
    expect(rows).toHaveLength(1);
    expect(modal?.textContent).toContain('SSIS - 795');
    expect(modal?.textContent).toContain('Chinese');
    expect(modal?.textContent).toContain('63 KB');
    expect(modal?.querySelector('iframe')).toBeNull();
  });

  it('loads SubTitleCat detail languages and suggests Emby-friendly filenames', async () => {
    const searchDoc = new DOMParser().parseFromString(`
      <table class="table sub-table">
        <tbody>
          <tr>
            <td><a href="subs/1072/SSIS%20-%20795.html">SSIS - 795</a> (translated from Chinese)</td>
            <td>&nbsp;</td>
            <td class="sub-table__size-cell"><span class="sub-table__metric-value">63 KB</span></td>
            <td>9 downloads</td>
            <td>9 languages</td>
          </tr>
        </tbody>
      </table>
    `, 'text/html');
    const detailDoc = new DOMParser().parseFromString(`
      <div class="sub-single">
        <span><img src="/assets/flags/cn.png" alt="zh-CN" class="flag"></span>
        <span>Chinese (Simplified)</span>
        <span><a id="download_zh-CN" href="/subs/1072/SSIS%20-%20795-zh-CN.srt" class="green-link">Download</a></span>
      </div>
      <div class="sub-single">
        <span><img src="/assets/flags/jp.png" alt="ja" class="flag"></span>
        <span>Japanese</span>
        <span><button id="ja" onclick="translate_from_server_folder('ja', 'SSIS - 795-orig.srt', '/subs/1072/')" class="yellow-link">Translate</button></span>
      </div>
    `, 'text/html');
    vi.spyOn(defaultHttpClient, 'getDocument')
      .mockResolvedValueOnce(searchDoc)
      .mockResolvedValueOnce(detailDoc);
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/index.php?search={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const loadButton = document.querySelector<HTMLButtonElement>('.jdb-subtitlecat-load-downloads');
    expect(loadButton?.textContent).toBe('获取下载');
    expect(loadButton?.disabled).toBe(false);
    loadButton?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const downloadLink = document.querySelector<HTMLAnchorElement>('.jdb-subtitlecat-language-download');
    const previewButton = document.querySelector<HTMLButtonElement>('.jdb-subtitlecat-language-preview');

    expect(defaultHttpClient.getDocument).toHaveBeenCalledWith(
      'https://subtitlecat.com/subs/1072/SSIS%20-%20795.html',
      expect.objectContaining({ responseType: 'document' }),
    );
    expect(document.querySelector('.jdb-subtitlecat-subtitle-modal')?.textContent).toContain('Chinese (Simplified)');
    expect(document.querySelector('.jdb-subtitlecat-subtitle-modal')?.textContent).not.toContain('Japanese');
    expect(downloadLink?.href).toBe('https://subtitlecat.com/subs/1072/SSIS%20-%20795-zh-CN.srt');
    expect(downloadLink?.download).toBe('SSIS-795.zh-CN.srt');
    expect(previewButton?.textContent).toBe('预览');
  });
  it('previews the selected SubTitleCat subtitle in a separate modal', async () => {
    const searchDoc = new DOMParser().parseFromString(`
      <table class="table sub-table">
        <tbody>
          <tr>
            <td><a href="subs/1072/SSIS%20-%20795.html">SSIS - 795</a> (translated from Chinese)</td>
            <td>&nbsp;</td>
            <td><span class="sub-table__metric-value">63 KB</span></td>
            <td>9 downloads</td>
            <td>9 languages</td>
          </tr>
        </tbody>
      </table>
    `, 'text/html');
    const detailDoc = new DOMParser().parseFromString(`
      <div class="sub-single">
        <span><img src="/assets/flags/cn.png" alt="zh-CN" class="flag"></span>
        <span>Chinese (Simplified)</span>
        <span><a id="download_zh-CN" href="/subs/1072/SSIS%20-%20795-zh-CN.srt" class="green-link">Download</a></span>
      </div>
    `, 'text/html');
    vi.spyOn(defaultHttpClient, 'getDocument')
      .mockResolvedValueOnce(searchDoc)
      .mockResolvedValueOnce(detailDoc);
    const fetchSubtitle = vi.spyOn(defaultHttpClient, 'get').mockResolvedValue('1\n00:00:01,000 --> 00:00:02,000\n正常中文字幕');
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/index.php?search={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    document.querySelector<HTMLButtonElement>('.jdb-subtitlecat-load-downloads')?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    document.querySelector<HTMLButtonElement>('.jdb-subtitlecat-language-preview')?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const previewModal = document.querySelector<HTMLElement>('.jdb-subtitlecat-preview-modal');
    const previewContent = previewModal?.querySelector<HTMLElement>('.jdb-subtitlecat-preview-content');
    const previewDownload = previewModal?.querySelector<HTMLButtonElement>('.jdb-subtitlecat-preview-download');

    expect(fetchSubtitle).toHaveBeenCalledWith(
      'https://subtitlecat.com/subs/1072/SSIS%20-%20795-zh-CN.srt',
      expect.objectContaining({ responseType: 'text' }),
    );
    expect(previewModal?.textContent).toContain('字幕预览 · SSIS-795.zh-CN.srt');
    expect(previewModal?.textContent).toContain('原字幕：SSIS - 795 / Chinese (Simplified)');
    expect(previewContent?.textContent).toContain('正常中文字幕');
    expect(previewDownload?.textContent).toContain('下载此字幕');
    expect(document.querySelector('.jdb-subtitlecat-preview-panel')).toBeNull();
  });

  it('opens 迅雷字幕 in a detail-page modal instead of navigating to the API URL', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({
      data: [
        {
          name: 'SSIS-795.zh.srt',
          ext: 'srt',
          url: 'https://subtitle.test/SSIS-795.zh.srt',
        },
      ],
    });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    const link = document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const modal = document.querySelector('.jdb-xunlei-subtitle-modal');
    const downloadLink = modal?.querySelector<HTMLAnchorElement>('a[href="https://subtitle.test/SSIS-795.zh.srt"]');

    expect(defaultHttpClient.getJson).toHaveBeenCalledWith(
      'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name=SSIS-795',
      expect.objectContaining({ responseType: 'json' }),
    );
    expect(modal?.textContent).toContain('迅雷字幕');
    expect(modal?.textContent).toContain('SSIS-795.zh.srt');
    expect(downloadLink?.textContent).toContain('下载');
  });

  it('uses the detail video id as the suggested subtitle download filename', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({
      data: [
        {
          gcid: '7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91',
          url: 'https://subtitle.v.geilijiasu.com/71/72/7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt',
          ext: 'srt',
          name: 'VOAY44lUVFzs56Arorr06Ia2A1_MKMP-577^.srt',
        },
      ],
    });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const downloadLink = document.querySelector<HTMLAnchorElement>('.jdb-xunlei-subtitle-download');

    expect(downloadLink?.download).toBe('MKMP-577.srt');
    expect(downloadLink?.title).toContain('MKMP-577.srt');
  });

  it('downloads 迅雷字幕 through a blob URL with the video-id filename', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({
      data: [
        {
          url: 'https://subtitle.v.geilijiasu.com/71/72/7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt',
          ext: 'srt',
          name: '7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt',
        },
      ],
    });
    const fetchSubtitle = vi.spyOn(defaultHttpClient, 'get').mockResolvedValue('1\n00:00:00,000 --> 00:00:01,000\n字幕');
    const createObjectURL = vi.fn(() => 'blob:subtitle-download');
    const revokeObjectURL = vi.fn(() => undefined);
    const StubURL = Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', StubURL);
    const clickedDownloads: string[] = [];
    const clickedHrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedDownloads.push(this.download);
      clickedHrefs.push(this.href);
    });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    document.querySelector<HTMLAnchorElement>('.jdb-xunlei-subtitle-download')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fetchSubtitle).toHaveBeenCalledWith(
      'https://subtitle.v.geilijiasu.com/71/72/7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt',
      expect.objectContaining({ responseType: 'text' }),
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedDownloads).toContain('MKMP-577.srt');
    expect(clickedHrefs).toContain('blob:subtitle-download');
  });

  it('以独立弹窗预览点击的 迅雷字幕内容', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({
      data: [
        {
          url: 'https://subtitle.v.geilijiasu.com/71/72/first.srt',
          ext: 'srt',
          name: 'first.srt',
        },
        {
          url: 'https://subtitle.v.geilijiasu.com/A2/F7/second.ass',
          ext: 'ass',
          name: 'second.ass',
        },
      ],
    });
    const fetchSubtitle = vi.spyOn(defaultHttpClient, 'get').mockResolvedValue('Dialogue: 正常中文字幕');
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const previewButtons = document.querySelectorAll<HTMLButtonElement>('.jdb-xunlei-subtitle-preview');
    expect(previewButtons).toHaveLength(2);
    previewButtons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const previewModal = document.querySelector<HTMLElement>('.jdb-xunlei-subtitle-preview-modal');
    const previewContent = previewModal?.querySelector<HTMLElement>('.jdb-xunlei-subtitle-preview-content');
    const previewDownload = previewModal?.querySelector<HTMLButtonElement>('.jdb-xunlei-subtitle-preview-download');

    expect(fetchSubtitle).toHaveBeenCalledWith(
      'https://subtitle.v.geilijiasu.com/A2/F7/second.ass',
      expect.objectContaining({ responseType: 'text' }),
    );
    expect(previewModal?.textContent).toContain('字幕预览 · MKMP-577.ass');
    expect(previewContent?.textContent).toContain('正常中文字幕');
    expect(previewModal?.textContent).toContain('原字幕：second.ass');
    expect(previewDownload?.textContent).toContain('下载此字幕');
    expect(document.querySelector('.jdb-xunlei-subtitle-preview-panel')).toBeNull();
  });

  it('renders real 迅雷字幕 API result fields for MKMP-577', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({
      code: 0,
      result: 'ok',
      data: [
        {
          gcid: '7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91',
          cid: '7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91',
          url: 'https://subtitle.v.geilijiasu.com/71/72/7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt',
          ext: 'srt',
          name: 'MKMP-577.srt',
          duration: 7932000,
          languages: [''],
          source: 0,
          score: 0,
          fingerprintf_score: 0,
          extra_name: '（网友上传）',
          mt: 2,
        },
        {
          gcid: 'A2F74670796A4B00E16369697BF01C2E454FD884',
          cid: 'A2F74670796A4B00E16369697BF01C2E454FD884',
          url: 'https://subtitle.v.geilijiasu.com/A2/F7/A2F74670796A4B00E16369697BF01C2E454FD884.srt',
          ext: 'srt',
          name: 'VOAY44lUVFzs56Arorr06Ia2A1_MKMP-577^.srt',
          duration: 7932000,
          languages: ['zh'],
          source: 0,
          score: 0,
          fingerprintf_score: 0,
          extra_name: '（网友上传）',
          mt: 2,
        },
      ],
    });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const modal = document.querySelector('.jdb-xunlei-subtitle-modal');
    const rows = modal?.querySelectorAll('.jdb-xunlei-subtitle-row');
    const downloadLink = modal?.querySelector<HTMLAnchorElement>('a[href="https://subtitle.v.geilijiasu.com/71/72/7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt"]');

    expect(rows).toHaveLength(2);
    expect(modal?.textContent).toContain('MKMP-577.srt');
    expect(modal?.textContent).toContain('VOAY44lUVFzs56Arorr06Ia2A1_MKMP-577^.srt');
    expect(modal?.textContent).toContain('ZH');
    expect(downloadLink?.textContent).toContain('下载');
  });

  it('renders 迅雷字幕 results with compact metadata tags and copy action', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockClear();
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({
      code: 0,
      result: 'ok',
      data: [
        {
          gcid: '7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91',
          cid: '7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91',
          url: 'https://subtitle.v.geilijiasu.com/71/72/7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt',
          ext: 'srt',
          name: 'MKMP-577.srt',
          duration: 7932000,
          languages: [''],
          extra_name: '（网友上传）',
          score: 0,
        },
        {
          gcid: 'A2F74670796A4B00E16369697BF01C2E454FD884',
          cid: 'A2F74670796A4B00E16369697BF01C2E454FD884',
          url: 'https://subtitle.v.geilijiasu.com/A2/F7/A2F74670796A4B00E16369697BF01C2E454FD884.srt',
          ext: 'srt',
          name: 'MKMP-577.srt',
          duration: 7932000,
          languages: ['zh'],
          extra_name: '（网友上传）',
          score: 92,
        },
      ],
    });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const modal = document.querySelector('.jdb-xunlei-subtitle-modal');
    const title = modal?.querySelector('#jdb-xunlei-subtitle-title');
    const tagTexts = Array.from(modal?.querySelectorAll('.jdb-xunlei-subtitle-tag') || [])
      .map(tag => tag.textContent?.trim());
    const copyButton = modal?.querySelector<HTMLButtonElement>('.jdb-xunlei-subtitle-copy');

    expect(title?.textContent).toBe('迅雷字幕 · MKMP-577 · 2 条');
    expect(tagTexts).toEqual(expect.arrayContaining([
      'SRT',
      '未知语言',
      'ZH',
      '网友上传',
      '02:12:12',
      'Hash 7172AEEC',
      'Hash A2F74670',
      '匹配 92',
    ]));
    expect(copyButton?.textContent).toContain('复制链接');

    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://subtitle.v.geilijiasu.com/71/72/7172AEEC50DD7ACBACC6D0EBEA4EB1734629AB91.srt');
    expect(copyButton?.textContent).toContain('已复制');
  });

  it('renders an empty state when 迅雷字幕 returns no results', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({ data: [] });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const modal = document.querySelector('.jdb-xunlei-subtitle-modal');

    expect(modal?.querySelector('#jdb-xunlei-subtitle-title')?.textContent).toBe('迅雷字幕 · MKMP-577 · 0 条');
    expect(modal?.textContent).toContain('迅雷接口未返回 MKMP-577 的字幕');
  });

  it('distinguishes fuzzy 迅雷字幕 results from exact empty results', async () => {
    vi.spyOn(defaultHttpClient, 'getJson')
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            url: 'https://subtitle.v.geilijiasu.com/08/D8/08D812AD45E61162DB94BF9B6F7DA40AD9A01796.srt',
            ext: 'srt',
            name: 'DLDSS-063 ノルハドック-en.srt',
          },
        ],
      });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">DLDSS-523</div>
      </nav>
    `;

    renderDetailSearchLinks('DLDSS-523', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const modal = document.querySelector('.jdb-xunlei-subtitle-modal');

    expect(defaultHttpClient.getJson).toHaveBeenCalledWith(
      'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name=DLDSS523',
      expect.objectContaining({ responseType: 'json' }),
    );
    expect(modal?.textContent).toContain('迅雷接口未返回 DLDSS-523 的字幕');
    expect(modal?.textContent).toContain('备用模糊查询 DLDSS523 返回 1 条，但没有精确匹配 DLDSS-523');
    expect(modal?.textContent).not.toContain('DLDSS-063 ノルハドック-en.srt');
  });

  it('renders an error state when 迅雷字幕 request fails', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockRejectedValue(new Error('Request timeout'));
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const modal = document.querySelector('.jdb-xunlei-subtitle-modal');
    const state = modal?.querySelector('.jdb-xunlei-subtitle-state.is-error');

    expect(state?.textContent).toContain('加载失败：Request timeout');
  });

  it('closes the 迅雷字幕 modal from the close button and Escape key', async () => {
    vi.spyOn(defaultHttpClient, 'getJson').mockResolvedValue({ data: [] });
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">MKMP-577</div>
      </nav>
    `;

    renderDetailSearchLinks('MKMP-577', [
      { id: 'xunlei-subtitle', name: '迅雷字幕', urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}', icon: 'assets/xunlei.png', category: 'subtitle', contexts: ['detail'] },
    ]);

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    document.querySelector<HTMLButtonElement>('.jdb-xunlei-subtitle-close')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(document.querySelector('.jdb-xunlei-subtitle-modal')).toBeNull();

    document.querySelector<HTMLAnchorElement>('#jdb-subtitle-search-panel a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    document.querySelector<HTMLElement>('.jdb-xunlei-subtitle-modal')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('.jdb-xunlei-subtitle-modal')).toBeNull();
  });

  it('injects detail search styles once and keeps dark-theme subtitle variables', () => {
    document.documentElement.dataset.theme = 'dark';
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search' },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);
    renderDetailSearchLinks('SSIS-795', [
      { id: 'javbus', name: 'JavBus', urlTemplate: 'https://javbus.com/search/{{ID}}', icon: 'assets/javbus.ico', category: 'search' },
      { id: 'subtitlecat', name: 'SubTitleCat', urlTemplate: 'https://subtitlecat.com/search?q={{ID}}', icon: 'assets/subtitlecat.ico', category: 'subtitle', contexts: ['detail'] },
    ]);

    const externalStyles = document.querySelectorAll('#jdb-external-search-styles');
    const subtitleStyles = document.querySelectorAll('#jdb-xunlei-subtitle-styles');
    const externalStyleText = externalStyles[0]?.textContent || '';
    const subtitleStyleText = subtitleStyles[0]?.textContent || '';

    expect(externalStyles).toHaveLength(1);
    expect(subtitleStyles).toHaveLength(1);
    expect(externalStyleText).toContain('.jdb-external-search-links');
    expect(subtitleStyleText).toContain('html[data-theme="dark"] .jdb-xunlei-subtitle-modal');
    expect(subtitleStyleText).toContain('--jdb-xunlei-bg: #1f2937');

    delete document.documentElement.dataset.theme;
  });

  it('falls back to the generic search icon when a configured icon fails to load', () => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">SSIS-795</div>
      </nav>
    `;

    renderDetailSearchLinks('SSIS-795', [
      { id: 'custom-site', name: 'Custom', urlTemplate: 'https://example.test/search/{{ID}}', icon: 'assets/custom-missing.png', category: 'search' },
    ]);

    const icon = document.querySelector<HTMLImageElement>('.jdb-external-search-icon')!;
    icon.dispatchEvent(new Event('error'));

    expect(icon.src).toBe('chrome-extension://test-runtime/assets/alternate-search.png');
  });
});





