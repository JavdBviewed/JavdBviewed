import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');
    resolve(address.port);
  }));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('OpenList content button sends a verified task through the extension background', async ({}, testInfo) => {
  const requests: Array<{ authorization: string; body: unknown }> = [];
  let rejectPush = false;
  const openlist = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/public/settings') return res.end(JSON.stringify({ code: 1500, data: { version: '1.9.9' } }));
    if (req.url === '/api/me') {
      if (req.headers.authorization !== 'raw-token') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ code: 401, message: 'invalid token' }));
      }
      return res.end(JSON.stringify({ code: 1500, data: { username: 'admin' } }));
    }
    if (req.url === '/api/fs/add_offline_download') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push({ authorization: req.headers.authorization || '', body: JSON.parse(Buffer.concat(chunks).toString()) });
      if (rejectPush) return res.end(JSON.stringify({ code: 403, message: 'permission denied' }));
      return res.end(JSON.stringify({ code: 1500, data: { tasks: [{ id: 't-1' }] } }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  const site = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<html><body><div id="magnets-content"><div class="item"><a href="magnet:?xt=urn:btih:abc">sample</a><div class="buttons"></div></div></div></body></html>');
  });
  const openlistPort = await listen(openlist);
  const sitePort = await listen(site);
  const harness = resolveExtensionHarnessOptions({
    ...process.env,
    JAVDB_EXTENSION_USE_CHROME_DATA: '0',
    JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-openlist'),
  }, process.cwd());
  let context: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;
  try {
    context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
    const blocked: string[] = [];
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      blocked.push(route.request().url());
      return route.abort();
    });
    const extensionId = await readExtensionId(context);
    await suppressReleaseAnnouncementForTest(context);
    const settingsPage = await context.newPage();
    await settingsPage.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html'));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const siteUrl = `http://127.0.0.1:${sitePort}/v/mock`;
    await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.openlist-push-btn')).toHaveCount(0);

    await settingsPage.evaluate((baseUrl) => chrome.storage.local.set({
      settings: { openlist: { baseUrl, token: 'raw-token', path: '/movies', tool: 'aria2' } },
    }), `http://127.0.0.1:${openlistPort}`);
    const connection = await settingsPage.evaluate((baseUrl) => new Promise<unknown>((resolve) => {
      chrome.runtime.sendMessage({ type: 'openlist.test_connection', payload: { baseUrl, token: 'raw-token' } }, resolve);
    }), `http://127.0.0.1:${openlistPort}`);
    expect(connection).toMatchObject({ ok: true, version: '1.9.9', username: 'admin' });
    const denied = await settingsPage.evaluate((baseUrl) => new Promise<unknown>((resolve) => {
      chrome.runtime.sendMessage({ type: 'openlist.test_connection', payload: { baseUrl, token: 'bad-token' } }, resolve);
    }), `http://127.0.0.1:${openlistPort}`);
    expect(denied).toMatchObject({ ok: false, message: 'invalid token' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const button = page.locator('.openlist-push-btn');
    await expect(button).toBeVisible({ timeout: 20_000 });
    await button.click();
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBe(1);
    expect(requests[0]).toEqual({
      authorization: 'raw-token',
      body: { urls: ['magnet:?xt=urn:btih:abc'], path: '/movies', tool: 'aria2' },
    });
    await expect(page.locator('.javdb-ext-toast-message')).toContainText('t-1');
    rejectPush = true;
    await button.click();
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBe(2);
    await expect(page.locator('.javdb-ext-toast-message', { hasText: 'permission denied' })).toBeVisible();
    expect(errors).toEqual([]);
    expect(blocked.filter((url) => url.includes('javcloud.prlrr.com') || url.includes(':18091'))).toEqual([]);
  } finally {
    await context?.close();
    await close(site);
    await close(openlist);
  }
});
