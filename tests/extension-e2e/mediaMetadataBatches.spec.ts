import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';

async function readRecords(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('javdb_v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<any[]>((resolve, reject) => { const r = db.transaction('viewedRecords').objectStore('viewedRecords').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); } finally { db.close(); }
  });
}

test('media scan creates one consent batch and enriches the same records without inventing playback', async ({}, testInfo) => {
  test.setTimeout(180_000);
  let items = [
    { Id: 'a', Name: 'ABC-123 媒体名称', UserData: { Played: false } },
    { Id: 'b', Name: 'DEF-456 媒体名称', UserData: { Played: true } },
    { Id: 'unknown', Name: '无番号影片', UserData: { Played: false } },
  ];
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost'); res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/Items')) res.end(JSON.stringify({ Items: items, TotalRecordCount: items.length }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port missing');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const harness = resolveExtensionHarnessOptions({ ...process.env, JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-metadata') }, process.cwd());
  let context: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;
  try {
    context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
    const id = await readExtensionId(context); await suppressReleaseAnnouncementForTest(context);
    const page = await context.newPage(); await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/media-library-settings'));
    await expect(page.locator('#sync-emby-library')).toBeVisible();
    await page.evaluate(async url => { await chrome.storage.local.set({ settings: { cloudSync: { enabled: false }, newWorks: { enabled: false }, emby: {
      enabled: true, libraryEnabled: true, recognitionEnabled: false, libraryStatus: { enabled: true },
      mediaServers: [{ id: 'synthetic', type: 'emby', name: '合成库', url, apiKey: 'synthetic', userId: 'synthetic', enabled: true }],
    } } }); }, baseUrl);
    await page.reload();
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => {
      const native = globalThis.fetch;
      const state = { requests: [] as string[], failSecond: true, waitFirst: true, release: undefined as undefined | (() => void) };
      (globalThis as any).__metadataFixture = state;
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.origin !== 'https://javdb.com') return native(input, init);
        state.requests.push(`${init?.method || 'GET'} ${url.pathname}${url.search}`);
        if (url.pathname === '/search') {
          const code = url.searchParams.get('q') || '';
          if (code === 'DEF-456' && state.failSecond) return new Response('<div class="movie-list">暂无结果</div>');
          return new Response(`<div class="movie-list"><div class="item"><a href="/v/${code.replace('-', '')}" title="合成源站标题"><div class="video-title"><strong>${code}</strong> 合成源站标题</div></a></div></div>`);
        }
        const code = url.pathname.includes('ABC123') ? 'ABC-123' : url.pathname.includes('DEF456') ? 'DEF-456' : 'GHI-789';
        if (code === 'ABC-123' && state.waitFirst) { state.waitFirst = false; await new Promise<void>(resolve => { state.release = resolve; }); }
        const block = (label: string, value: string) => `<div class="panel-block"><strong>${label}:</strong><span class="value">${value}</span></div>`;
        return new Response(`<div class="video-detail"><h2 class="title"><strong>${code}</strong> 合成源站标题</h2><img class="video-cover" src="https://img.invalid/cover.jpg">${block('番號', code)}${block('日期','2024-02-29')}${block('時長','120 分鍾')}${block('演員','<a href="/actors/aa">合成演员</a>')}${block('片商','<a href="/makers/mm">合成片商</a>')}</div>`);
      };
    });
    const panel = page.locator('[data-media-metadata-batches]');
    await page.locator('#sync-emby-library').click();
    await expect(panel.locator('[data-metadata-batch]')).toHaveCount(1, { timeout: 25000 });
    await expect(panel).toContainText('未识别番号 1');
    const initial = await readRecords(page); expect(initial).toHaveLength(3);
    expect(initial.every(r => r.status === 'viewed' && !r.javdbUrl && !r.completed)).toBe(true);
    expect(await worker.evaluate(() => (globalThis as any).__metadataFixture.requests)).toEqual([]);
    const scan = () => page.evaluate(async () => chrome.runtime.sendMessage({ type: 'EMBY_LIBRARY_SYNC', manual: true }));
    expect((await scan()).success).toBe(true); await expect(panel.locator('[data-metadata-batch]')).toHaveCount(1);
    const abc = initial.find(r => r.videoCode === 'ABC-123');
    await panel.getByRole('button', { name: '确认同步源站资料' }).click();
    await expect.poll(() => worker.evaluate(() => Boolean((globalThis as any).__metadataFixture.release))).toBe(true);
    await page.evaluate(async record => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('javdb_v1'); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('viewedRecords','readwrite'); tx.objectStore('viewedRecords').put({ ...record, title: '用户并发修改的标题', notes: '用户备注', isFavorite: true, userTags: ['人工标签'], manuallyEditedFields: ['title'], updatedAt: Date.now() }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    }, abc);
    await worker.evaluate(() => (globalThis as any).__metadataFixture.release());
    await expect(panel).toContainText('失败 1', { timeout: 25000 });
    await expect(panel).toContainText('已补全 1');
    const first = (await readRecords(page)).find(r => r.id === abc.id);
    expect(first).toMatchObject({ title: '用户并发修改的标题', notes: '用户备注', isFavorite: true, userTags: ['人工标签'], status: 'viewed', actors: ['合成演员'], maker: '合成片商', duration: 120, releaseDate: '2024-02-29', javdbUrl: 'https://javdb.com/v/ABC123' });
    expect(first.createdAt).toBe(abc.createdAt);
    await worker.evaluate(() => {
      (globalThis as any).__metadataFixture.failSecond = false;
      const original = IDBObjectStore.prototype.put;
      (globalThis as any).__restoreMetadataPut = () => { IDBObjectStore.prototype.put = original; };
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === 'viewedRecords' && value?.videoCode === 'DEF-456' && value.javdbUrl) throw new DOMException('合成写入失败', 'QuotaExceededError');
        return original.call(this, value, key);
      };
    });
    await panel.getByRole('button', { name: '重试失败项' }).click();
    await expect(panel.getByRole('button', { name: '重试失败项' })).toBeVisible({ timeout: 25000 });
    await expect(panel).toContainText('已补全 1');
    expect((await readRecords(page)).find(r => r.videoCode === 'DEF-456').javdbUrl).toBeUndefined();
    await worker.evaluate(() => (globalThis as any).__restoreMetadataPut());
    await panel.getByRole('button', { name: '重试失败项' }).click();
    await expect(panel).toContainText('已补全 2', { timeout: 25000 });
    const requests = await worker.evaluate(() => (globalThis as any).__metadataFixture.requests as string[]);
    expect(requests.every(r => r.startsWith('GET '))).toBe(true);
    expect(requests.filter(r => r.includes('q=ABC-123'))).toHaveLength(1);
    expect(requests.filter(r => r.includes('q=DEF-456'))).toHaveLength(3);
    expect(await readRecords(page)).toHaveLength(3);
    await page.screenshot({ path: testInfo.outputPath('metadata-batch-completed.png'), fullPage: true });
    const recordsPage = await context.newPage(); await recordsPage.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-records'));
    await recordsPage.locator('#filterSelect').selectOption('viewed');
    await expect(recordsPage.locator('#searchResultCount')).toContainText(/找到\s*3\s*个结果/);
    await recordsPage.locator('#filterSelect').selectOption('realWatched');
    await expect(recordsPage.locator('#searchResultCount')).toContainText(/找到\s*1\s*个结果/);
    await recordsPage.locator('#filterSelect').selectOption('inLibrary');
    await expect(recordsPage.locator('#searchResultCount')).toContainText(/找到\s*3\s*个结果/);
    // A later scan creates an independent pending batch. Previous consent never covers it.
    items = [...items, { Id: 'later', Name: 'GHI-789', UserData: { Played: false } }];
    expect((await scan()).success).toBe(true); await expect(panel.locator('[data-metadata-batch]')).toHaveCount(2);
    expect(await worker.evaluate(() => (globalThis as any).__metadataFixture.requests.length)).toBe(requests.length);
    await page.reload(); await expect(panel.locator('[data-metadata-batch]')).toHaveCount(2);
    await panel.getByRole('button', { name: '本批不需要同步' }).click();
    const later = (await readRecords(page)).find(r => r.videoCode === 'GHI-789');
    const single = await page.evaluate(async recordId => chrome.runtime.sendMessage({ type: 'refresh-record', videoId: recordId }), later.id);
    expect(single.success).toBe(true); expect(single.record.id).toBe(later.id); expect(single.record.status).toBe('viewed');
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-sync'));
    await expect(page.locator('#media-metadata-sync-tasks')).toContainText('已取消');
    await testInfo.attach('metadata-result.json', { body: JSON.stringify({ records: 4, firstBatchItems: 3, metadataSuccess: 2, unidentified: 1, sourceBeforeConsent: 0, onlyGet: true, metadataWriteFailureKeepsRecordAndRetry: true, realWatched: 1, inLibraryBeforeLater: 3, concurrentFieldsPreserved: true, singleRefreshSameId: true, laterBatchRequiresConsent: true }), contentType: 'application/json' });
  } finally { await context?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
