import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';

test('source save with no score/comment survives control replacement, page reload and extension restart', async ({}, testInfo) => {
  let saved = false;
  const submissions: string[] = [];
  const marker = '<div class="review-buttons"><div class="review-title"><a href="/users/watched_videos"><span class="tag">我看过这部影片</span></a></div></div>';
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      submissions.push(Buffer.concat(chunks).toString()); saved = true;
      res.end(marker); return;
    }
    res.end(`<!doctype html><html><head><title>TEST-055 测试 | JavDB</title></head><body>
      <a class="navbar-item" href="https://javdb.com">JavDB</a><h2 class="title is-4"><strong>TEST-055</strong></h2>
      <nav class="panel movie-panel-info"><div class="panel-block first-block"><strong>番號:</strong><span class="value">TEST-055</span></div>
      ${saved ? marker : '<div class="review-buttons"><button id="review-watched" type="button">看过</button></div>'}</nav>
      <form id="new_review" action="/v/synthetic/reviews" hidden><input name="video_review[score]" value=""><textarea name="video_review[content]"></textarea><button type="submit">保存</button></form>
      <script>
      document.querySelector('#review-watched')?.addEventListener('click',()=>document.querySelector('form').hidden=false);
      document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const response=await fetch(e.target.action,{method:'POST',body:new URLSearchParams(new FormData(e.target))});if(response.ok)document.querySelector('.review-buttons').outerHTML=await response.text();});
      </script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  const url = `http://127.0.0.1:${address.port}/v/synthetic`;
  const harness = resolveExtensionHarnessOptions({ ...process.env, JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-watched') }, process.cwd());
  let context: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;
  const launch = async () => {
    context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    return context;
  };
  try {
    await launch();
    const extensionId = await readExtensionId(context!);
    await suppressReleaseAnnouncementForTest(context!);
    let dashboard = await context!.newPage();
    await dashboard.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html'));
    await dashboard.evaluate(async () => {
      await chrome.storage.local.set({ settings: { videoEnhancement: { enabled: false }, dataEnhancement: { enableMultiSource: false }, newWorks: { enabled: false } } });
      const record = { id: 'TEST-055', title: '测试', status: 'browsed', tags: ['保留'], isFavorite: true, createdAt: 1, updatedAt: 1 };
      const response = await chrome.runtime.sendMessage({ type: 'DB:VIEWED_PUT', payload: { record } });
      if (!response?.success) throw new Error('seed failed');
    });
    const read = () => dashboard.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'DB:VIEWED_GET', payload: { id: 'TEST-055' } })).record);
    const page = await context!.newPage();
    await page.goto(url);
    await expect(page).toHaveTitle(/已浏览/, { timeout: 20000 });
    await page.locator('#review-watched').click();
    expect((await read()).status).toBe('browsed');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await read()).status, { timeout: 20000 }).toBe('viewed');
    expect(new URLSearchParams(submissions[0]).get('video_review[score]')).toBe('');
    expect(new URLSearchParams(submissions[0]).get('video_review[content]')).toBe('');
    expect(await read()).toMatchObject({ status: 'viewed', tags: ['保留'], isFavorite: true });
    await page.reload();
    await expect(page).toHaveTitle(/已观看/, { timeout: 20000 });
    await page.screenshot({ path: testInfo.outputPath('source-watched-synced.png') });
    await context!.close(); context = undefined;
    await launch();
    dashboard = await context!.newPage();
    await dashboard.goto(extensionPageUrl(await readExtensionId(context!), 'dashboard/dashboard.html'));
    expect(await read()).toMatchObject({ status: 'viewed', tags: ['保留'], isFavorite: true });
    expect(submissions).toHaveLength(1);
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
