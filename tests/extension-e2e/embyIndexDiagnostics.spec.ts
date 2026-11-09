import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';

test('Jellyfin indexing distinguishes extraction failures and preserves partial snapshots', async ({}, testInfo) => {
  let phase: 'full' | 'partial' | 'empty' = 'full';
  const offsets: Array<{ phase: string; start: number }> = [];
  const items = [
    { Id: 'a', Name: '中文片名', Path: '/BOX-999/ABC-123-C.mp4' },
    { Id: 'b', Name: '中文片名', MediaSources: [{ Path: '/movies/DEF-456.mp4' }] },
    { Id: 'c', Name: 'ABC-123' },
    { Id: 'd', Name: '中文片名' },
    { Id: 'e', Name: 'GHI-789 JKL-012' },
  ];
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname !== '/Items') { res.statusCode = 404; res.end('{}'); return; }
    const start = Number(url.searchParams.get('StartIndex'));
    offsets.push({ phase, start });
    if (phase === 'empty') res.end(JSON.stringify({ Items: [], TotalRecordCount: 0 }));
    else if (phase === 'partial') res.end(JSON.stringify({ Items: start === 0 ? [items[0]] : [], TotalRecordCount: 5 }));
    else res.end(JSON.stringify({ Items: items.slice(start, start + 2), TotalRecordCount: 5 }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const harness = resolveExtensionHarnessOptions({ ...process.env, JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-index') }, process.cwd());
  let context: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;
  try {
    context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
    const id = await readExtensionId(context);
    await suppressReleaseAnnouncementForTest(context);
    const page = await context.newPage();
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/media-library-settings'));
    // 等首轮设置初始化完成，避免默认值保存晚到覆盖合成配置。
    await expect(page.locator('#sync-emby-library')).toBeVisible();
    await page.evaluate(async url => {
      await chrome.storage.local.set({ settings: {
        cloudSync: { enabled: false }, newWorks: { enabled: false },
        emby: { enabled: true, libraryEnabled: true, recognitionEnabled: false, libraryStatus: { enabled: true },
          mediaServers: [{ id: 'synthetic-jf', type: 'jellyfin', name: 'Jellyfin 测试库', url, apiKey: 'synthetic', enabled: true }] },
      } });
    }, baseUrl);
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/media-library-settings'));
    const button = page.locator('#sync-emby-library');
    const panel = page.locator('#emby-library-sync-status');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(panel).toContainText('已索引 3 个媒体条目', { timeout: 20000 });
    await expect(panel).toContainText('2 个不同番号');
    await expect(panel).toContainText('未识别 1 个，候选冲突 1 个');
    expect(offsets.filter(x => x.phase === 'full').map(x => x.start)).toEqual([0, 2, 4]);
    const read = () => page.evaluate(async () => (await chrome.storage.local.get('emby_library_state')).emby_library_state);
    const full = await read();
    expect(full.entries['ABC-123']).toHaveLength(2);
    expect(full.entries['DEF-456']).toHaveLength(1);
    expect(full.entries['BOX-999']).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('full-diagnostics.png'), fullPage: true });

    phase = 'partial';
    await button.click();
    await expect(panel).toContainText('同步不完整', { timeout: 20000 });
    await expect(panel).toContainText('未读取的旧索引已保留');
    const partial = await read();
    expect(partial.entries['ABC-123']).toHaveLength(2);
    expect(partial.entries['DEF-456']).toEqual(full.entries['DEF-456']);
    expect(partial.serverResults[0].complete).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('partial-retained.png'), fullPage: true });
    await page.reload();
    expect((await read()).entries['DEF-456']).toEqual(full.entries['DEF-456']);

    phase = 'empty';
    await button.click();
    await expect(panel).toContainText('已索引 0 个媒体条目', { timeout: 20000 });
    expect((await read()).entries).toEqual({});
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
