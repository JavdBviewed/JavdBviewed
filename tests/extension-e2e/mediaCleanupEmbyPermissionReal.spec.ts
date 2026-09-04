/**
 * @file mediaCleanupEmbyPermissionReal.spec.ts
 * @description 「已看影片整理」Emby 删除「无删除权限」场景的真实容器 E2E。
 *
 * 背景（用户真实问题）：服务器账号在设置页登录正常，但删除已看影片时
 * 提示"无删除权限"。容器实测根因：Emby 单条目路由的 CanDelete 按路径上的
 * 用户计算，非管理员账号视角 CanDelete=false，DELETE 返回 403
 * "Unauthorized access"。修复后行为契约（本用例断言）：
 *   1. 删除前探测发现仅配置的凭证无删除权限时，不发出 DELETE、明确报错；
 *   2. 报错信息包含：凭证身份（用户令牌（normaluser））、条目类型（Movie）、
 *      定向修复建议（确认其为管理员 / 补填管理员 API Key / 用管理员重新登录）；
 *   3. 操作记录 tab 中展示完整失败原因，并提供「重试删除」入口；
 *   4. 服务端条目与磁盘文件保持原样（绝不误删）。
 *
 * 环境要求（缺失时自动 skip，不影响 CI）：
 *   - 测试容器可达（默认 http://localhost:38097，可用 EMBY_E2E_URL 覆盖）
 *   - 容器内存在非管理员账号 normaluser / norm-pw-123（可用环境变量覆盖）
 */
import { expect, test, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  seedExtensionStorage,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';
import { STORAGE_KEYS } from '../../apps/extension/src/utils/config';

const EMBY_URL = (process.env.EMBY_E2E_URL ?? 'http://localhost:38097').replace(/\/+$/, '');
const EMBY_API_KEY = process.env.EMBY_E2E_API_KEY ?? '13f76fe3bea74b76921de6521b16164f';
const MEDIA_ROOT = process.env.EMBY_E2E_MEDIA_ROOT ?? '/home/ryen/emby-test/media/Movies';
const NORMAL_USER_NAME = process.env.EMBY_E2E_NORMAL_USER ?? 'normaluser';
const NORMAL_USER_PASSWORD = process.env.EMBY_E2E_NORMAL_PASSWORD ?? 'norm-pw-123';
const MOVIE_NAME = 'E2EAV-PERM-1';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 容器侧辅助
// ---------------------------------------------------------------------------

function embyApiUrl(pathAndQuery: string): string {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  return `${EMBY_URL}${pathAndQuery}${sep}api_key=${encodeURIComponent(EMBY_API_KEY)}`;
}

async function embyJson(pathAndQuery: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(embyApiUrl(pathAndQuery), {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
  });
  const text = await response.text().catch(() => '');
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

async function embyReachable(): Promise<boolean> {
  try {
    const { status } = await embyJson('/System/Info');
    return status === 200;
  } catch {
    return false;
  }
}

const DEVICE_HEADERS: Record<string, string> = {
  'X-Emby-Device-Id': 'e2e-perm-test',
  'X-Emby-Device-Name': 'E2E-Perm',
  'X-Emby-Client': 'E2E-Perm',
  'X-Emby-Version': '4.9.5',
  'X-Emby-Authorization': 'MediaBrowser Client=E2E-Perm, Device=E2E-Perm, DeviceId=e2e-perm-test, Version=4.9.5',
};

/** 登录非管理员账号，返回 { userId, token }；失败返回 null。 */
async function loginNormalUser(): Promise<{ userId: string; token: string } | null> {
  try {
    const { status, body } = await embyJson(
      `/Users/AuthenticateByName?UserName=${encodeURIComponent(NORMAL_USER_NAME)}&Pw=${encodeURIComponent(NORMAL_USER_PASSWORD)}`,
      { method: 'POST', headers: DEVICE_HEADERS },
    );
    if (status !== 200 || typeof body?.AccessToken !== 'string' || !body.User?.Id) return null;
    return { userId: String(body.User.Id), token: body.AccessToken };
  } catch {
    return null;
  }
}

async function findMovieId(name: string): Promise<string | null> {
  const { status, body } = await embyJson(
    `/Items?IncludeItemTypes=Movie&Recursive=true&SearchTerm=${encodeURIComponent(name)}`,
  );
  if (status !== 200) return null;
  const items = Array.isArray(body?.Items) ? body.Items : [];
  const hit = items.find((item: any) => item?.Name === name);
  return hit?.Id ? String(hit.Id) : null;
}

function findFfmpeg(): string | null {
  const candidates: string[] = [];
  for (const host of ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (fs.existsSync(host)) candidates.push(host);
  }
  const cacheDir = path.join(process.env.HOME ?? '', '.cache', 'ms-playwright');
  try {
    for (const entry of fs.readdirSync(cacheDir)) {
      if (entry.startsWith('ffmpeg-')) candidates.push(path.join(cacheDir, entry, 'ffmpeg-linux'));
    }
  } catch { /* 无缓存目录 */ }
  candidates.push(path.resolve(process.cwd(), 'node_modules/playwright-core/.local-browsers/ffmpeg-1010/ffmpeg-linux'));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function ensureMediaFolder(name: string): void {
  const folder = path.join(MEDIA_ROOT, name);
  fs.mkdirSync(folder, { recursive: true });
  const video = path.join(folder, `${name}.mkv`);
  const poster = path.join(folder, 'poster.jpg');
  if (!fs.existsSync(video) || !fs.existsSync(poster)) {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) throw new Error(`媒体文件缺失且未找到 ffmpeg，无法重建 ${folder}`);
    const videoRes = spawnSync(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
      '-c:v', 'mpeg4', '-q:v', '5', '-an', video,
    ], { timeout: 60_000 });
    if (videoRes.status !== 0 || !fs.existsSync(video)) {
      throw new Error(`ffmpeg 生成测试视频失败：${String(videoRes.stderr || '')}`);
    }
    const posterRes = spawnSync(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x336699:size=100x150:duration=1',
      '-frames:v', '1', '-q:v', '5', poster,
    ], { timeout: 60_000 });
    if (posterRes.status !== 0 || !fs.existsSync(poster)) {
      throw new Error(`ffmpeg 生成测试海报失败：${String(posterRes.stderr || '')}`);
    }
  }
}

async function ensureIndexedMovie(name: string): Promise<string> {
  let itemId = await findMovieId(name);
  if (itemId) return itemId;
  ensureMediaFolder(name);
  await embyJson('/Library/Refresh', { method: 'POST' });
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await sleep(5_000);
    itemId = await findMovieId(name);
    if (itemId) return itemId;
  }
  throw new Error(`扫库后 ${name} 仍未被 Emby 索引（测试容器扫库超时）`);
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test.describe('media cleanup Emby no-delete-permission (real container)', () => {
  test.setTimeout(300_000);

  async function skipIfContainerDown(): Promise<void> {
    if (!(await embyReachable())) {
      test.skip(true, `Emby 测试容器不可达（${EMBY_URL}），跳过真实容器用例`);
    }
  }

  test('非管理员账号（CanDelete=false）→ 不删除、报错含凭证身份/条目类型/修复建议，操作记录可重试', async ({}, testInfo) => {
    await skipIfContainerDown();
    const account = await loginNormalUser();
    if (!account) {
      test.skip(true, `容器内非管理员账号 ${NORMAL_USER_NAME} 登录失败，跳过`);
    }

    const itemId = await ensureIndexedMovie(MOVIE_NAME);

    // 防御性前置：确认该账号视角确实 CanDelete=false（容器状态漂移时跳过而非误报失败）
    const probe = await fetch(
      `${EMBY_URL}/Users/${account.userId}/Items/${itemId}`,
      { headers: { 'X-Emby-Token': account.token, Accept: 'application/json' } },
    );
    const probeBody: any = await probe.json().catch(() => null);
    if (probe.status !== 200 || probeBody?.CanDelete !== false) {
      test.skip(true, `前置不成立：${NORMAL_USER_NAME} 视角 CanDelete=${probeBody?.CanDelete}（预期 false），容器状态可能已变化`);
    }

    const context = await launchExtensionContext(
      resolveExtensionHarnessOptions(
        {
          ...process.env,
          JAVDB_EXTENSION_USE_CHROME_DATA: '0',
          JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-perm'),
        },
        process.cwd(),
      ),
      { headless: false, channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium' },
    );
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);

      const now = Date.now();
      const copyId = `emby:${EMBY_URL}:${itemId}`;
      // 关键：服务器只配置非管理员账号的用户令牌（无 API Key）
      const server = {
        id: 'emby-e2e-perm',
        type: 'emby',
        name: 'Emby-E2E-PERM',
        url: EMBY_URL,
        apiKey: '',
        enabled: true,
        username: NORMAL_USER_NAME,
        userDisplayName: NORMAL_USER_NAME,
        accessToken: account.token,
        userId: account.userId,
      };

      await seedExtensionStorage(context, {
        [STORAGE_KEYS.SETTINGS]: {
          emby: { enabled: true, mediaServers: [server] },
          drive115: {
            enabled: true,
            mediaLibraryRoots: [{ cid: 'e2e-none', name: 'E2E 115 片库', enabled: false }],
          },
        },
        [STORAGE_KEYS.MEDIA_CLEANUP_STATE]: {
          version: 1,
          observedWatchedCopyIds: [copyId],
          updatedAt: now,
          items: {
            [MOVIE_NAME]: {
              id: MOVIE_NAME,
              titleId: MOVIE_NAME,
              code: MOVIE_NAME,
              title: `${MOVIE_NAME} 无删除权限场景验证`,
              reason: 'watched',
              addedAt: now,
              updatedAt: now,
              copies: {
                [copyId]: {
                  copyId,
                  source: 'emby',
                  serverName: 'Emby-E2E-PERM',
                  serverUrl: EMBY_URL,
                  itemId,
                  fileName: `${MOVIE_NAME}.mkv`,
                  watchedAt: now,
                  lastFoundAt: now,
                  status: 'pending',
                  updatedAt: now,
                },
              },
            },
          },
        },
        [STORAGE_KEYS.MEDIA_DELETION_HISTORY]: { version: 1, records: {}, updatedAt: now },
      });

      const page = await context.newPage();
      await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await page.getByRole('button', { name: '媒体库工具' }).click();
      await page.getByRole('button', { name: /已看影片整理/ }).click();
      const overlay = page.locator('[data-media-cleanup-overlay="1"]');
      await expect(overlay).toBeVisible();

      await overlay.getByRole('checkbox', { name: `选择 ${MOVIE_NAME} 的全部来源文件` }).check();
      await overlay.getByRole('button', { name: '删除选中的文件' }).click();
      const confirmDialog = overlay.getByRole('alertdialog');
      await expect(confirmDialog).toContainText('确认删除 1 个文件');
      await confirmDialog.getByRole('button', { name: '确认删除' }).click();

      // 1) 批量消息：1 个文件、失败 1 个
      const msgLocator = overlay.locator('.ml-cleanup-msg');
      await expect(msgLocator).toBeVisible();
      await expect(msgLocator).toContainText(/已处理 1 个文件/, { timeout: 120_000 });
      const msgText = (await msgLocator.textContent()) || '';
      expect(msgText).toContain('失败 1');

      // 2) 失败后面板自动切到操作记录；失败原因完整可见（不再只藏在 title 里）
      const historyResult = overlay.locator('.ml-cleanup-history-result');
      await expect(historyResult).toBeVisible({ timeout: 15_000 });
      await expect(historyResult).toContainText('媒体服务器账号无该条目的删除权限', { timeout: 15_000 });
      await expect(historyResult).toContainText(`用户令牌（${NORMAL_USER_NAME}）`);
      await expect(historyResult).toContainText('条目类型 Movie');
      await expect(historyResult).toContainText('请确认其为管理员');

      // 3) 失败操作提供「重试删除」入口
      await expect(page.getByRole('button', { name: `重试删除 ${MOVIE_NAME}` })).toBeVisible();

      // 4) 安全契约：条目与磁盘文件必须原样保留（未发出 DELETE）
      const { status, body } = await embyJson(`/Items?Ids=${encodeURIComponent(itemId)}`);
      expect(status).toBe(200);
      expect(Array.isArray(body?.Items) ? body.Items.length : -1).toBe(1);
      expect(fs.existsSync(path.join(MEDIA_ROOT, MOVIE_NAME, `${MOVIE_NAME}.mkv`))).toBe(true);
    } finally {
      await context.close();
    }
  });
});
