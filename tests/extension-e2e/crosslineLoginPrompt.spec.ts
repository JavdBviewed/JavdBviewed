import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { expect, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest } from '../../scripts/extensionHarness';

const guest = '<nav id="navbar-menu-user"><div class="navbar-end"><a href="/login">登录</a></div></nav>';
const member = '<nav id="navbar-menu-user"><div class="navbar-end"><a href="/users/profile">测试账号</a><a href="/logout">退出</a></div></nav><a href="/users/want_watch_videos">收藏</a>';
const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:sans-serif}nav{display:flex;justify-content:flex-end;min-height:48px;padding:8px 12px}.navbar-end{display:flex;gap:12px;align-items:center}a{color:#3273dc}</style></head><body>${body}<main>页面示例</main></body></html>`;
const session = (domain: string, value: string) => ({ name: '_jdb_session', value, domain, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' as const });
type ProfileMode = 'http-login-wall' | 'login-wall' | 'normal' | 'challenge' | 'reject-copy' | 'challenge-copy';
type Fixture = { context: BrowserContext; worker: Worker; modes: Record<string, ProfileMode>; probes: Record<string, number> };
const test = base.extend<{ fixture: Fixture; sourceHost: string; targetHost: string }>({
  sourceHost: ['javdb.com', { option: true }],
  targetHost: ['javdb575.com', { option: true }],
  fixture: async ({ sourceHost, targetHost }, use, testInfo) => {
    const options = resolveExtensionHarnessOptions({ ...process.env, JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile') }, process.cwd());
    mkdirSync(testInfo.outputPath('tls'), { recursive: true });
    const key = testInfo.outputPath('tls/key.pem'), cert = testInfo.outputPath('tls/cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=fixture.invalid'], { stdio: 'ignore' });
    const probes: Record<string, number> = {}, modes: Record<string, ProfileMode> = {};
    // Actual HTTPS requests are necessary: Playwright route interception happens before Chromium attaches cookies to worker fetches.
    const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
      const host = req.headers.host || '';
      if (!['javdb.com', 'javdb575.com', 'javdb580.com', 'javdb585.com'].includes(host)) { res.writeHead(404); res.end(); return; }
      const signedIn = /_jdb_session=fixture-auth/.test(req.headers.cookie || '');
      if (req.url === '/logout') {
        res.writeHead(302, { Location: '/', 'Set-Cookie': '_jdb_session=fixture-logged-out; Path=/; Secure; HttpOnly; SameSite=Lax' }); res.end(); return;
      }
      let body = signedIn ? member : guest;
      if (new URL(req.url || '/', 'https://fixture.invalid').pathname === '/users/profile') {
        probes[host] = (probes[host] || 0) + 1;
        const mode = modes[host];
        res.setHeader('Set-Cookie', `_jdb_session=${signedIn ? 'fixture-auth' : 'fixture-guest'}-rotated-${probes[host]}; Path=/; Secure; HttpOnly; SameSite=Lax`);
        if (mode === 'http-login-wall' && !signedIn) { res.writeHead(302, { Location: '/login' }); res.end(); return; }
        if (mode === 'login-wall' && !signedIn) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end("window.location.href='/login';"); return; }
        if (mode === 'challenge' || (mode === 'challenge-copy' && signedIn)) body = '<div id="cf-challenge">Just a moment</div>';
        else if (mode === 'reject-copy' && signedIn) body = guest;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html(body));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    let context: BrowserContext | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No fixture HTTPS port');
      context = await launchExtensionContext(options, { headless: true, channel: 'chromium', extraArgs: [
        '--no-proxy-server', '--ignore-certificate-errors',
        `--host-resolver-rules=MAP javdb.com 127.0.0.1:${address.port}, MAP javdb575.com 127.0.0.1:${address.port}, MAP javdb580.com 127.0.0.1:${address.port}, MAP javdb585.com 127.0.0.1:${address.port}, MAP * ~NOTFOUND`,
      ] });
      const id = await readExtensionId(context); await suppressReleaseAnnouncementForTest(context);
      const worker = context.serviceWorkers().find(w => w.url().includes(id));
      if (!worker) throw new Error('No extension service worker');
      await worker.evaluate(async ({ sourceHost, targetHost }) => {
        await chrome.storage.local.set({ javdbCrosslineSessionEnabled: false });
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, routes: { ...settings.routes, javdb: {
          primary: `https://${sourceHost}`, alternatives: [{ url: `https://${targetHost}`, enabled: true }],
        } } } });
      }, { sourceHost, targetHost });
      // Seed the target first: the automatic bridge must never observe a missing target during setup.
      await context.addCookies([session(targetHost, 'fixture-guest')]);
      await context.addCookies([session(sourceHost, 'fixture-auth')]);
      await worker.evaluate(() => chrome.storage.local.set({ javdbCrosslineSessionEnabled: true }));
      await use({ context, worker, modes, probes });
    } finally {
      await context?.close(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  },
});

async function readPageStatus(worker: Worker) {
  return worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://javdb575.com/*' }))[0];
    if (typeof tab?.id !== 'number') throw new Error('No target page');
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED',
      func: async () => await chrome.runtime.sendMessage({ type: 'JAVDB_CROSSLINE_PAGE:STATUS' }) });
    return results[0]?.result;
  });
}

test('stored source without an open tab, per-target dismissal, keyboard, narrow viewport and verified copy', async ({ fixture }, testInfo) => {
  const { context, probes } = fixture;
  fixture.modes['javdb575.com'] = 'http-login-wall';
  const page = await context.newPage(); await page.goto('https://javdb575.com/');
  const panel = page.locator('.javdb-ext-crossline-panel');
  await expect(panel).toBeVisible({ timeout: 25_000 }); await expect(panel).toContainText('javdb.com');
  expect(probes['javdb.com']).toBeGreaterThan(0);
  const second = await context.newPage(); await second.goto('https://javdb575.com/lists/fixture');
  await expect(second.locator('.javdb-ext-crossline-trigger')).toBeVisible();
  await expect(second.locator('.javdb-ext-crossline-panel')).toBeHidden();
  await page.bringToFront(); await panel.getByRole('button', { name: '暂不提醒' }).click();
  await expect(panel).toBeHidden(); await page.reload();
  await expect(page.locator('.javdb-ext-crossline-trigger')).toBeVisible(); await expect(panel).toBeHidden();
  for (const path of ['/v/fixture', '/actors/fixture']) {
    await page.goto(`https://javdb575.com${path}`);
    await expect(page.locator('.javdb-ext-crossline-trigger')).toBeVisible(); await expect(panel).toBeHidden();
  }
  await page.setViewportSize({ width: 375, height: 720 });
  await page.locator('.javdb-ext-crossline-trigger').focus(); await page.keyboard.press('Enter'); await expect(panel).toBeVisible();
  await page.keyboard.press('Escape'); await expect(panel).toBeHidden();
  await page.keyboard.press('Enter'); await expect(panel).toBeVisible();
  const box = await panel.boundingBox(); expect(box && box.x >= 0 && box.x + box.width <= 375).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('login-prompt-narrow.png') });
  await panel.getByRole('button', { name: '同步登录', exact: true }).click();
  await expect(page.locator('a[href="/logout"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.javdb-ext-crossline')).toHaveCount(0);
  expect((await context.cookies('https://javdb575.com')).some(c => c.name === '_jdb_session' && c.value === 'fixture-auth')).toBe(true);
});

for (const scenario of ['anonymous-source', 'source-challenge', 'target-challenge', 'target-authenticated'] as const) {
  test(`does not offer login for ${scenario}`, async ({ fixture }) => {
    const { context, worker, modes } = fixture;
    if (scenario === 'anonymous-source') await context.addCookies([session('javdb.com', 'fixture-expired')]);
    if (scenario === 'source-challenge') modes['javdb.com'] = 'challenge';
    if (scenario === 'target-challenge') modes['javdb575.com'] = 'challenge';
    if (scenario === 'target-authenticated') await context.addCookies([session('javdb575.com', 'fixture-auth-other')]);
    const page = await context.newPage(); await page.goto('https://javdb575.com/');
    const reply = await readPageStatus(worker);
    expect(reply.success).toBe(true); expect(reply.status.sources).toEqual([]);
    await expect(page.locator('.javdb-ext-crossline')).toHaveCount(0);
  });
}

for (const mode of ['reject-copy', 'challenge-copy'] as const) {
  test(`keeps the page and reports ${mode} after writing cookies`, async ({ fixture }) => {
    const { context, modes } = fixture; modes['javdb575.com'] = mode;
    const page = await context.newPage(); await page.goto('https://javdb575.com/');
    const panel = page.locator('.javdb-ext-crossline-panel'); await expect(panel).toBeVisible();
    let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await panel.getByRole('button', { name: '同步登录', exact: true }).click();
    await expect(panel).toContainText(mode === 'reject-copy' ? '该网站未接受此登录态' : '暂时无法确认登录结果');
    expect(navigations).toBe(0);
    if (mode === 'reject-copy') expect((await context.cookies('https://javdb575.com')).some(c => c.value === 'fixture-guest')).toBe(true);
  });
}

test('logout survives navigation and prevents automatic expansion while manual login remains available', async ({ fixture }) => {
  const { context, worker } = fixture;
  await context.addCookies([session('javdb575.com', 'fixture-auth-other')]);
  const page = await context.newPage(); await page.goto('https://javdb575.com/');
  await page.locator('a[href="/logout"]').click();
  await expect(page.locator('.javdb-ext-crossline-trigger')).toBeVisible();
  await expect(page.locator('.javdb-ext-crossline-panel')).toBeHidden();
  await expect.poll(() => worker.evaluate(async () => {
    const data = await chrome.storage.local.get('javdbCrosslinePromptSuppression');
    return Object.values(data.javdbCrosslinePromptSuppression || {}).some(item => !!item && typeof item === 'object' && 'reason' in item && item.reason === 'logout');
  })).toBe(true);
  await page.locator('.javdb-ext-crossline-trigger').click();
  await page.locator('.javdb-ext-crossline-panel').getByRole('button', { name: '同步登录', exact: true }).click();
  await expect(page.locator('a[href="/logout"]')).toBeVisible();
});

test('ignores synthetic clicks and preserves a target logged in by another tab', async ({ fixture }) => {
  const { context } = fixture;
  const page = await context.newPage(); await page.goto('https://javdb575.com/');
  const panel = page.locator('.javdb-ext-crossline-panel'); await expect(panel).toBeVisible();
  const copy = panel.getByRole('button', { name: '同步登录', exact: true });
  await copy.evaluate((button: HTMLButtonElement) => button.click());
  expect((await context.cookies('https://javdb575.com')).some(c => c.value === 'fixture-guest')).toBe(true);
  await context.addCookies([session('javdb575.com', 'fixture-auth-other')]);
  await copy.click(); await expect(page.locator('a[href="/logout"]')).toBeVisible();
  expect((await context.cookies('https://javdb575.com')).some(c => c.value === 'fixture-auth-other')).toBe(true);
});

test('removes the prompt and stops probes when the shared feature switch is disabled', async ({ fixture }) => {
  const { context, worker, probes } = fixture;
  const page = await context.newPage(); await page.goto('https://javdb575.com/');
  await expect(page.locator('.javdb-ext-crossline-panel')).toBeVisible();
  const before = { ...probes };
  await worker.evaluate(() => chrome.storage.local.set({ javdbCrosslineSessionEnabled: false }));
  await expect(page.locator('.javdb-ext-crossline')).toHaveCount(0);
  expect((await readPageStatus(worker)).status.enabled).toBe(false);
  expect(probes).toEqual(before);
});

test('handles the exact JavaScript login wall without executing page scripts', async ({ fixture }) => {
  fixture.modes['javdb575.com'] = 'login-wall';
  const page = await fixture.context.newPage(); await page.goto('https://javdb575.com/');
  await expect(page.locator('.javdb-ext-crossline-panel')).toBeVisible();
  expect((await fixture.context.cookies('https://javdb575.com')).some(c => c.value === 'fixture-guest')).toBe(true);
});
test('clamps the open panel to the viewport even if the site menu extends beyond it', async ({ fixture }) => {
  const page = await fixture.context.newPage(); await page.goto('https://javdb575.com/');
  const panel = page.locator('.javdb-ext-crossline-panel'); await expect(panel).toBeVisible();
  await page.addStyleTag({ content: '#navbar-menu-user { transform: translateX(240px); }' });
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect.poll(async () => { const box = await panel.boundingBox(); return !!box && box.x >= 0 && box.x + box.width <= 1024; }).toBe(true);
});

for (const targetHost of ['javdb580.com', 'javdb585.com']) {
  test.describe(targetHost, () => {
    test.use({ sourceHost: 'javdb575.com', targetHost });
    test(`offers an existing 575 login on configured ${targetHost} and verifies the copied session`, async ({ fixture }) => {
      const { context, probes } = fixture;
      const page = await context.newPage();
      await page.goto(`https://${targetHost}/`);
      const panel = page.locator('.javdb-ext-crossline-panel');
      await expect(panel).toBeVisible({ timeout: 25_000 });
      await expect(panel).toContainText('javdb575.com');
      expect(probes['javdb575.com']).toBeGreaterThan(0);
      expect(probes[targetHost]).toBeGreaterThan(0);
      // A different page on the same configured host keeps a manual entry without expanding again.
      await page.goto(`https://${targetHost}/v/fixture`);
      await expect(page.locator('.javdb-ext-crossline-trigger')).toBeVisible();
      await expect(panel).toBeHidden();
      await page.locator('.javdb-ext-crossline-trigger').click();
      await panel.getByRole('button', { name: '同步登录', exact: true }).click();
      await expect(page.locator('a[href="/logout"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.javdb-ext-crossline')).toHaveCount(0);
      expect((await context.cookies(`https://${targetHost}`)).some(c => c.name === '_jdb_session' && c.value === 'fixture-auth')).toBe(true);
    });
  });
}
