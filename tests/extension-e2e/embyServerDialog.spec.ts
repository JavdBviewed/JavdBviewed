import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';

test('media server dialogs save selected libraries and draft login without leaking cancelled edits', async ({}, testInfo) => {
  const reads: Array<{ type: string; parent: string | null }> = [];
  let denyFolders = false;
  let loginCount = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const [, kind, ...parts] = url.pathname.split('/');
    const endpoint = '/' + parts.join('/');
    res.setHeader('Content-Type', 'application/json');
    const reply = (body: unknown, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    if (endpoint === '/Users/AuthenticateByName') {
      loginCount++;
      reply({
        AccessToken: 'synthetic-user-token',
        User: { Id: 'test-user', Name: '演示用户' },
      });
      return;
    }
    if (endpoint.endsWith('/Views') || endpoint.startsWith('/Library/')) {
      if (denyFolders) {
        reply({}, 403);
        return;
      }
      const authorized =
        kind === 'jellyfin'
          ? String(req.headers.authorization || '').includes(
              'synthetic-user-token',
            )
          : url.searchParams.get('api_key') === 'synthetic-api-key';
      if (!authorized) {
        reply({}, 401);
        return;
      }
      reply({
        Items: [
          { Id: 'movie-library', Name: '电影收藏', CollectionType: 'movies' },
          { Id: 'family-library', Name: '家庭录像', CollectionType: 'mixed' },
        ],
      });
      return;
    }
    if (endpoint.endsWith('/Items')) {
      const parent = url.searchParams.get('ParentId');
      reads.push({ type: kind, parent });
      reply({
        Items: [
          { Id: 'film-1', Name: 'ABC-123', Path: '/synthetic/ABC-123.mp4' },
        ],
        TotalRecordCount: 1,
      });
      return;
    }
    reply({}, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('missing synthetic server port');
  const origin = `http://127.0.0.1:${address.port}`;
  const harness = resolveExtensionHarnessOptions(
    {
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile'),
    },
    process.cwd(),
  );
  let context: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;
  try {
    context = await launchExtensionContext(harness, {
      headless: false,
      channel: 'chromium',
      extraArgs: ['--no-proxy-server'],
    });
    await context.route(/^https?:\/\//, (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const id = await readExtensionId(context);
    await suppressReleaseAnnouncementForTest(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/media-library-settings'));
    // 等首轮设置初始化完成，避免默认值保存晚到覆盖合成配置。
    await expect(page.locator('#sync-emby-library')).toBeVisible();
    await page.evaluate(async () =>
      chrome.storage.local.set({
        settings: {
          cloudSync: { enabled: false },
          newWorks: { enabled: false },
          emby: {
            enabled: true,
            libraryEnabled: true,
            recognitionEnabled: false,
            mediaServers: [],
            libraryStatus: { enabled: true },
          },
        },
      }),
    );
    await page.goto(
      extensionPageUrl(
        id,
        'dashboard/dashboard.html#tab-settings/media-library-settings',
      ),
    );
    const readServers = () =>
      page.evaluate(
        async () =>
          (await chrome.storage.local.get('settings')).settings.emby
            .mediaServers,
      );
    await page.locator('#add-emby-media-server').click();
    let dialog = page.getByRole('dialog', { name: '添加媒体服务器' });
    await dialog.getByLabel('名称', { exact: true }).fill('家庭 Emby');
    await dialog
      .getByLabel('服务器地址', { exact: true })
      .fill(`${origin}/emby`);
    await dialog
      .getByLabel('API Key', { exact: true })
      .fill('synthetic-api-key');
    await dialog.getByLabel('指定媒体库', { exact: true }).check();
    await dialog
      .getByRole('button', { name: '读取媒体库', exact: true })
      .click();
    await dialog.getByLabel('电影收藏', { exact: false }).check();
    await expect(dialog).toContainText('已选择 1 个库');
    await dialog.locator('.ui-modal__body').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath('create-light.png') });
    await dialog
      .getByRole('button', { name: '添加服务器', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(async () => (await readServers())[0]?.libraryIds)
      .toEqual(['movie-library']);
    await expect
      .poll(() =>
        reads.some(
          (read) => read.type === 'emby' && read.parent === 'movie-library',
        ),
      )
      .toBe(true);
    expect(
      reads
        .filter((read) => read.type === 'emby')
        .every((read) => read.parent === 'movie-library'),
    ).toBe(true);

    await page
      .locator('.emby-media-server-summary')
      .getByRole('button', { name: '编辑', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('名称', { exact: true }).fill('不会保存的名字');
    await dialog
      .getByRole('button', { name: '读取媒体库', exact: true })
      .click();
    await dialog.getByLabel('家庭录像', { exact: false }).check();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect((await readServers())[0]).toMatchObject({
      name: '家庭 Emby',
      libraryIds: ['movie-library'],
    });

    await page
      .locator('.emby-media-server-summary')
      .getByRole('button', { name: '编辑', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    denyFolders = true;
    await dialog
      .getByRole('button', { name: '读取媒体库', exact: true })
      .click();
    await expect(dialog).toContainText('403');
    await expect(
      dialog.locator('[data-library-id="movie-library"]'),
    ).toBeChecked();
    denyFolders = false;
    await dialog
      .getByRole('button', { name: '读取媒体库', exact: true })
      .click();
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'dark'),
    );
    await dialog.locator('.ui-modal__body').evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath('edit-dark.png') });
    await dialog.getByLabel('电影收藏', { exact: false }).uncheck();
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(dialog).toContainText('请至少选择一个媒体库');
    expect((await readServers())[0].libraryIds).toEqual(['movie-library']);
    await dialog.getByLabel('全部媒体库', { exact: true }).check();
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(async () => (await readServers())[0]?.libraryIds || [])
      .toEqual([]);
    await expect
      .poll(() =>
        reads.some((read) => read.type === 'emby' && read.parent === null),
      )
      .toBe(true);

    await page.locator('#add-emby-media-server').click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('类型', { exact: true }).selectOption('jellyfin');
    await dialog.getByLabel('名称', { exact: true }).fill('我的 Jellyfin');
    await dialog
      .getByLabel('服务器地址', { exact: true })
      .fill(`${origin}/jellyfin`);
    await dialog.getByLabel('用户名', { exact: true }).fill('demo');
    await dialog.getByLabel('密码', { exact: true }).fill('synthetic-password');
    await dialog.getByRole('button', { name: '登录验证', exact: true }).click();
    await expect(dialog).toContainText('登录验证成功，保存后生效');
    expect(loginCount).toBe(1);
    expect((await readServers()).length).toBe(1);
    await dialog.getByLabel('指定媒体库', { exact: true }).check();
    await dialog
      .getByRole('button', { name: '读取媒体库', exact: true })
      .click();
    await dialog.getByLabel('电影收藏', { exact: false }).check();
    await dialog.getByLabel('家庭录像', { exact: false }).check();
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog
      .getByLabel('家庭录像', { exact: false })
      .scrollIntoViewIfNeeded();
    const bounds = await dialog.boundingBox();
    const footer = await dialog.locator('.ui-modal__footer').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(390);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(844);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
    await page.screenshot({
      path: testInfo.outputPath('create-narrow-dark.png'),
    });
    await dialog
      .getByRole('button', { name: '添加服务器', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => (await readServers()).length).toBe(2);
    expect((await readServers())[1]).toMatchObject({
      type: 'jellyfin',
      libraryIds: ['movie-library', 'family-library'],
      userId: 'test-user',
    });
    await page.reload();
    await expect(page.locator('.emby-media-server-summary')).toHaveCount(2);
    await expect(
      page.locator('.emby-media-server-summary').nth(1),
    ).toContainText('同步 2 个指定库');
    await testInfo.attach('synthetic-dialog-result', {
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'synthetic loopback',
        loginCount,
        readScopes: reads,
        selectedLibraries: (await readServers()).map(
          (s: { type: string; libraryIds?: string[] }) => ({
            type: s.type,
            ids: s.libraryIds || [],
          }),
        ),
      }),
    });
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
