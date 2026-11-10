import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';

async function readRecords(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('javdb_v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    try { return await new Promise<any[]>((resolve, reject) => {
      const req = db.transaction('viewedRecords').objectStore('viewedRecords').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    }); } finally { db.close(); }
  });
}

test('media scan ingests records, preserves 99 watched after 58 removals, and fences explicit unwatch', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const full = Array.from({ length: 99 }, (_, i) => ({ Id: String(i + 1), Name: `SYN-${String(i + 1).padStart(3, '0')}`, RunTimeTicks: 1000, UserData: { Played: false, PlaybackPositionTicks: 950, LastPlayedDate: '2026-11-01T00:00:00Z' } }));
  let items: any[] = full;
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    requests.push(`${req.method} ${url.pathname}`);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/Items')) res.end(JSON.stringify({ Items: items.slice(Number(url.searchParams.get('StartIndex')) || 0), TotalRecordCount: items.length }));
    else if (url.pathname.endsWith('/UserData') || url.pathname.includes('/PlayedItems/')) res.end('{}');
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const harness = resolveExtensionHarnessOptions({ ...process.env, JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-history') }, process.cwd());
  let context: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;
  try {
    context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
    const id = await readExtensionId(context);
    await suppressReleaseAnnouncementForTest(context);
    const page = await context.newPage();
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/media-library-settings'));
    await expect(page.locator('#sync-emby-library')).toBeVisible();
    const seed = { id: 'SYN-001', videoCode: 'SYN-001', title: '保留用户标题', status: 'want', isFavorite: true, tags: ['自定'], notes: '保留备注', createdAt: 1, updatedAt: 2 };
    await page.evaluate(async ({ url, seed }) => {
      await chrome.storage.local.set({ settings: {
        cloudSync: { enabled: false }, newWorks: { enabled: false },
        emby: { enabled: true, libraryEnabled: true, recognitionEnabled: false, libraryStatus: { enabled: true }, mediaServers: [{ id: 'synthetic', type: 'emby', name: '合成测试', url, apiKey: 'synthetic', userId: 'test-user', enabled: true }] },
      } });
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('javdb_v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('viewedRecords', 'readwrite'); tx.objectStore('viewedRecords').put(seed); tx.objectStore('viewedRecords').put({ ...seed, id: 'SYN-999', videoCode: 'SYN-999', deletedAt: 5 }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    }, { url: baseUrl, seed });
    await page.reload();
    const scan = async () => {
      const result = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'EMBY_LIBRARY_SYNC', manual: true }));
      expect(result.success).toBe(true); return result;
    };
    // First scan uses the actual settings button; later scans use its same SW command.
    await page.locator('#sync-emby-library').click();
    await expect(page.locator('#emby-library-sync-status')).toContainText('已索引 99 个媒体条目', { timeout: 25_000 });
    const baseline = await readRecords(page);
    expect(baseline).toHaveLength(100);
    expect(baseline.find(r => r.id === seed.id)).toEqual(seed);
    expect(baseline.filter(r => r.id.startsWith('media:'))).toHaveLength(98);
    expect(baseline.filter(r => r.id.startsWith('media:')).every(r => r.status === 'viewed' && !r.javdbUrl)).toBe(true);
    await scan();
    expect(await readRecords(page)).toEqual(baseline);

    const records = await context.newPage();
    await records.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-records'));
    const filter = records.locator('#filterSelect');
    const expectCount = async (value: string, expected: number) => {
      await filter.selectOption(value);
      if (expected === 0) {
        await expect(records.locator('#videoList')).toContainText('没有符合条件的记录');
        await expect(records.locator('#searchResultCount')).toBeHidden();
        return;
      }
      await expect(records.locator('#searchResultCount')).toContainText(new RegExp(`找到\\s*${expected}\\s*个结果`), { timeout: 20_000 });
    };
    await expectCount('realWatched', 99);
    await expectCount('inLibrary', 99);
    items = full.slice(58);
    await scan();
    // Same mounted page must update its active filter after the background scan.
    await expect(records.locator('#searchResultCount')).toContainText(/找到\s*41\s*个结果/, { timeout: 20_000 });
    await expectCount('realWatched', 99);
    expect(await readRecords(page)).toEqual(baseline);
    await records.screenshot({ path: testInfo.outputPath('watched-99-after-58-removed.png'), fullPage: true });

    items = [...full.slice(58), { Id: 'unknown', Name: '无番号测试影片', RunTimeTicks: 1000, UserData: { Played: true, LastPlayedDate: '2026-11-01T00:00:00Z' } }, { Id: 'conflict', Name: 'ABC-123 DEF-456' }, { Id: 'trash', Name: 'SYN-999' }];
    await scan();
    const withUnknown = await readRecords(page);
    expect(withUnknown).toHaveLength(102);
    expect(withUnknown.find(r => r.id === 'SYN-999')?.deletedAt).toBe(5);
    const unknown = withUnknown.find(r => r.title === '无番号测试影片');
    expect(unknown.id).toMatch(/^media:[a-f0-9]{64}$/);
    expect(unknown.videoCode).toBeUndefined();
    expect(withUnknown.find(r => r.title === 'ABC-123 DEF-456')?.videoCode).toBeUndefined();
    await expectCount('realWatched', 100);
    await expectCount('inLibrary', 43);
    const unwatch = await page.evaluate(async url => chrome.runtime.sendMessage({ type: 'EMBY_LIBRARY_SET_PLAYED', serverUrl: url, itemId: 'unknown', played: false }), baseUrl);
    expect(unwatch.success).toBe(true);
    await scan(); // Provider deliberately returns stale Played=true and the old playback timestamp.
    await expectCount('realWatched', 99);
    expect(requests.some(r => r.endsWith('/Items/unknown/UserData'))).toBe(true);
    const refresh = await page.evaluate(async mediaId => chrome.runtime.sendMessage({ type: 'refresh-record', videoId: mediaId }), unknown.id);
    expect(refresh.success).toBe(false);
    expect(refresh.error).toContain('尚未识别番号');

    items = [];
    await scan();
    await expectCount('inLibrary', 0);
    await expectCount('realWatched', 99);
    await records.reload();
    await expectCount('realWatched', 99);
    expect(await readRecords(page)).toEqual(withUnknown);
    const facts = await page.evaluate(async () => (await chrome.storage.local.get('media_watch_evidence')).media_watch_evidence);
    expect(facts.titles[unknown.id.toUpperCase()]).toBeTruthy();
    // Exercise the real IDB transaction: failure on the second insert must not publish a partial batch/index.
    const worker = context.serviceWorkers()[0];
    const oldIndex = await page.evaluate(async () => (await chrome.storage.local.get('emby_library_state')).emby_library_state);
    await worker.evaluate(() => {
      const native = IDBObjectStore.prototype.add;
      (globalThis as any).__restoreMediaAdd = () => { IDBObjectStore.prototype.add = native; };
      IDBObjectStore.prototype.add = function(value, key) {
        if (this.name === 'viewedRecords' && value?.title === 'ROLL-002') throw new DOMException('synthetic write failure', 'QuotaExceededError');
        return native.call(this, value, key);
      };
    });
    items = [{ Id: 'rollback1', Name: 'ROLL-001' }, { Id: 'rollback2', Name: 'ROLL-002' }];
    try {
      const failure = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'EMBY_LIBRARY_SYNC', manual: true }));
      expect(failure.success).toBe(false);
      expect(await readRecords(page)).toEqual(withUnknown);
      expect(await page.evaluate(async () => (await chrome.storage.local.get('emby_library_state')).emby_library_state)).toEqual(oldIndex);
    } finally { await worker.evaluate(() => (globalThis as any).__restoreMediaAdd()); }
    await scan();
    expect(await readRecords(page)).toHaveLength(104);
    await context.close();
    context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
    const restarted = await context.newPage();
    await restarted.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-records'));
    await restarted.locator('#filterSelect').selectOption('realWatched');
    await expect(restarted.locator('#searchResultCount')).toContainText(/找到\s*99\s*个结果/, { timeout: 20_000 });
    expect((await readRecords(restarted)).find(r => r.id === seed.id)).toEqual(seed);
    await testInfo.attach('counts.json', { body: JSON.stringify({ scan: [99, 41, 44, 0], watched: [99, 99, 100, 99, 99], records: [100, 100, 102, 102], exactPersonalRecordPreserved: true, tombstonePreserved: true, unknownUnwatchSurvivesStaleScan: true, idbBatchRollbackAndRetry: true, browserRestartRetainsHistory: true }), contentType: 'application/json' });
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
