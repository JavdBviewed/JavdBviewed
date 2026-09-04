/**
 * @file mediaCleanupConvergeReal.spec.ts
 * @description 「已看影片整理」键/字段一致性 + 脏数据收敛的真机 E2E（真实 Chrome + 真实 Emby 测试容器）。
 *
 * 背景：旧版 enqueueTitle 生成 ::rev 派生副本时，键是 `基座::rev{epoch}` 但 entry 的
 * copyId 字段仍是基座 ID；删除/重试链路按键取 entry，导致删除操作命中基座条目、
 * 用户看到的派生行永不更新（"提示成功但还在待处理"），脏记录随每次查找不断叠加。
 *
 * 本文件验证（build ≥ 103）：
 *   用例 1：历史假成功 deleted + 5 条脏 ::rev 派生（字段=基座 ID 的旧 bug 形状），
 *     文件仍在库 → 「查找已看影片」后收敛为 1 条 pending（copyId 字段===键），
 *     通过 UI 删除 → 服务端条目与磁盘文件真实消失，删除历史记录在 rev 键上。
 *   用例 2：同形状脏数据但文件已被外部删除（本地索引已刷新、不含该条目）→
 *     重扫后全部非 deleted 记录折叠为 skipped，待处理归零。
 *
 * 环境要求（缺失时自动 skip，不影响 CI）：
 *   - 测试容器可达（默认 http://localhost:38097，可用 EMBY_E2E_URL 覆盖）
 *   - 媒体目录可写（默认 /home/ryen/emby-test/media/Movies，可用 EMBY_E2E_MEDIA_ROOT 覆盖）
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 服务端辅助（Node 环境直连测试容器；失败只影响本文件，自动 skip）
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
    if (!ffmpeg) throw new Error(`媒体文件缺失且未找到 Playwright ffmpeg，无法重建 ${folder}`);
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

async function assertItemGone(itemId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { status, body } = await embyJson(`/Items?Ids=${encodeURIComponent(itemId)}`);
    if (status === 200) {
      const items = Array.isArray(body?.Items) ? body.Items : [];
      if (items.length === 0) return;
    }
    await sleep(2_000);
  }
  throw new Error(`删除后服务端仍查询到条目 ${itemId}（假成功回归！）`);
}

async function assertVideoFileGone(name: string): Promise<void> {
  const video = path.join(MEDIA_ROOT, name, `${name}.mkv`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!fs.existsSync(video)) return;
    await sleep(2_000);
  }
  const folder = path.join(MEDIA_ROOT, name);
  const remaining = fs.existsSync(folder) ? fs.readdirSync(folder) : [];
  throw new Error(`删除后磁盘视频文件仍存在：${video}（文件夹剩余：${JSON.stringify(remaining)}）`);
}

/** 用例 2：模拟"文件已被外部删除"——直接从测试容器删除条目。 */
async function deleteItemFromServer(itemId: string): Promise<void> {
  const { status } = await embyJson(`/Items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  if (status !== 204 && status !== 200) throw new Error(`测试容器删除条目 ${itemId} 失败（HTTP ${status}）`);
  await assertItemGone(itemId);
}

// ---------------------------------------------------------------------------
// 脏数据播种：基座 deleted（历史假成功）+ N 条旧 bug 形状的 ::rev 派生（字段=基座 ID）
// ---------------------------------------------------------------------------

function buildDirtyCleanupState(input: {
  code: string;
  baseId: string;
  itemId: string;
  fileName: string;
  now: number;
  /** rev 条数；状态按 pending/failed 交替，updatedAt 递增（最后一条为 pending）。 */
  revCount: number;
}) {
  const { code, baseId, itemId, fileName, now, revCount } = input;
  const copies: Record<string, any> = {
    [baseId]: {
      copyId: baseId,
      source: 'emby',
      serverName: 'Emby-E2E',
      serverUrl: EMBY_URL,
      itemId,
      fileName,
      watchedAt: now,
      lastFoundAt: now,
      status: 'deleted',
      updatedAt: now,
    },
  };
  for (let i = 0; i < revCount; i += 1) {
    const key = `${baseId}::rev${i + 2}`;
    copies[key] = {
      // 旧 bug 形状：派生副本的 copyId 字段仍是基座 ID（键与字段不一致）。
      copyId: baseId,
      source: 'emby',
      serverName: 'Emby-E2E',
      serverUrl: EMBY_URL,
      itemId,
      fileName,
      watchedAt: now,
      lastFoundAt: now,
      status: i % 2 === 0 ? 'pending' : 'failed',
      error: i % 2 === 0 ? undefined : '历史失败',
      updatedAt: now + 1 + i,
    };
  }
  return {
    version: 1,
    baseline: { capturedAt: now, candidateCount: 1, importedAt: revCount + 1 },
    observedWatchedCopyIds: [baseId],
    updatedAt: now + revCount,
    items: {
      [code]: {
        id: code,
        titleId: code,
        code,
        title: `${code} E2E 脏数据收敛验证`,
        reason: 'watched',
        addedAt: now,
        updatedAt: now + revCount,
        copies,
      },
    },
  };
}

async function openCleanupOverlay(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: '媒体库工具' }).click();
  await page.getByRole('button', { name: /已看影片整理/ }).click();
  const overlay = page.locator('[data-media-cleanup-overlay="1"]');
  await expect(overlay).toBeVisible();
  return page;
}

async function readStorageJson(page: import('@playwright/test').Page, keys: string[]): Promise<Record<string, any>> {
  return page.evaluate((keyList: string[]) => new Promise<Record<string, any>>((resolve) => {
    chrome.storage.local.get(keyList, (items: Record<string, unknown>) => {
      try { resolve(JSON.parse(JSON.stringify(items))); }
      catch { resolve({}); }
    });
  }), keys);
}

async function launchContext(profileName: string): Promise<BrowserContext> {
  const context = await launchExtensionContext(
    resolveExtensionHarnessOptions(
      {
        ...process.env,
        JAVDB_EXTENSION_USE_CHROME_DATA: '0',
        JAVDB_EXTENSION_PROFILE: profileName,
      },
      process.cwd(),
    ),
    { headless: false, channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium' },
  );
  const extensionId = await readExtensionId(context);
  await suppressReleaseAnnouncementForTest(context);
  return context;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test.describe('media cleanup dirty-data converge (real container)', () => {
  test.setTimeout(300_000);

  async function skipIfContainerDown(): Promise<void> {
    if (!(await embyReachable())) {
      test.skip(true, `Emby 测试容器不可达（${EMBY_URL}），跳过真实容器用例`);
    }
  }

  test('文件仍在库：脏 rev 收敛为 1 条 pending（字段===键），UI 删除后服务端与磁盘真实消失', async ({}, testInfo) => {
    await skipIfContainerDown();
    const code = 'E2EAV-CONV-1';
    const name = code;
    const itemId = await ensureIndexedMovie(name);
    const baseId = `emby:${EMBY_URL}:${itemId}`;
    const now = Date.now();
    const revKey = `${baseId}::rev6`; // revCount=5 → rev2..rev6，最后一条 pending 被保留
    const context = await launchContext(testInfo.outputPath('profile-converge-1'));
    try {
      await seedExtensionStorage(context, {
        [STORAGE_KEYS.SETTINGS]: {
          emby: {
            enabled: true,
            mediaServers: [{
              id: 'emby-e2e',
              type: 'emby',
              name: 'Emby-E2E',
              url: EMBY_URL,
              apiKey: EMBY_API_KEY,
              enabled: true,
            }],
          },
          drive115: {
            enabled: true,
            mediaLibraryRoots: [{ cid: 'e2e-none', name: 'E2E 115 片库', enabled: false }],
          },
        },
        [STORAGE_KEYS.EMBY_LIBRARY_STATE]: {
          entries: {
            [code]: [{
              serverType: 'emby',
              serverName: 'Emby-E2E',
              serverUrl: EMBY_URL,
              itemId,
              itemName: name,
              path: `${MEDIA_ROOT}/${name}/${name}.mkv`,
              userData: { played: true, positionTicks: 0, runtimeTicks: 10_000_000, percent: 100, lastPlayedAt: now },
              updatedAt: now,
            }],
          },
          updatedAt: now,
        },
        [STORAGE_KEYS.MEDIA_CLEANUP_STATE]: buildDirtyCleanupState({
          code, baseId, itemId, fileName: `${name}.mkv`, now, revCount: 5,
        }),
        [STORAGE_KEYS.MEDIA_DELETION_HISTORY]: { version: 1, records: {}, updatedAt: now },
      });

      const page = await openCleanupOverlay(context, await readExtensionId(context));
      await page.getByRole('button', { name: '查找已看影片' }).click();

      // 收敛契约：5 条脏 rev 中保留最新 pending（rev6），折叠 4 条；基座 deleted 保持原样。
      const msgLocator = page.locator('.ml-cleanup-msg');
      await expect(msgLocator).toContainText(/已合并 4 条历史重复记录/, { timeout: 30_000 });

      // 存储层强断言：只剩 1 条 pending，且 copyId 字段===键（键/字段一致性回归）。
      const stored = await readStorageJson(page, [STORAGE_KEYS.MEDIA_CLEANUP_STATE]);
      const copies = stored[STORAGE_KEYS.MEDIA_CLEANUP_STATE]?.items?.[code]?.copies ?? {};
      const entries = Object.entries(copies) as Array<[string, any]>;
      const pendingEntries = entries.filter(([, copy]) => copy?.status === 'pending');
      expect(pendingEntries).toHaveLength(1);
      expect(pendingEntries[0][0]).toBe(revKey);
      expect(pendingEntries[0][1].copyId).toBe(revKey); // 字段必须与键一致
      expect(copies[baseId]?.status).toBe('deleted'); // 删除历史保持原样
      expect(entries.filter(([, copy]) => copy?.status === 'skipped')).toHaveLength(4);

      // UI 层：待处理只剩 1 条可操作副本 → 全选只应选中 1 个文件。
      await page.getByRole('checkbox', { name: `选择 ${code} 的全部来源文件` }).check();
      await page.getByRole('button', { name: '删除选中的文件' }).click();
      const confirmDialog = page.locator('[data-media-cleanup-overlay="1"]').getByRole('alertdialog');
      await expect(confirmDialog).toContainText('确认删除 1 个文件');
      await confirmDialog.getByRole('button', { name: '确认删除' }).click();

      await expect(msgLocator).toContainText(/已处理 1 个文件/, { timeout: 120_000 });
      const msgText = (await msgLocator.textContent()) || '';
      if (!msgText.includes('全部成功')) {
        throw new Error(`UI 显示删除失败：${msgText}`);
      }
      await expect(page.locator('#messageContainer .toast')).toContainText('已删除 1 个文件，全部成功', { timeout: 10_000 });

      // 服务端 + 磁盘双重确认：提示成功 ⇔ 文件真的没了。
      await assertItemGone(itemId);
      await assertVideoFileGone(name);

      // 删除历史必须落在 rev 键上（证明删除链路命中了派生条目而非基座条目）。
      const history = await readStorageJson(page, [STORAGE_KEYS.MEDIA_DELETION_HISTORY]);
      const recordKeys = Object.keys(history[STORAGE_KEYS.MEDIA_DELETION_HISTORY]?.records ?? {});
      expect(recordKeys.some((key) => key.startsWith(`extension_cleanup:${revKey}:`))).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('文件已被外部删除：重扫将全部重复记录折叠为 skipped，待处理归零', async ({}, testInfo) => {
    await skipIfContainerDown();
    const code = 'E2EAV-CONV-2';
    const name = code;
    const itemId = await ensureIndexedMovie(name);
    await deleteItemFromServer(itemId); // 模拟外部删除；本地索引随后刷新不再含该条目
    const baseId = `emby:${EMBY_URL}:${itemId}`;
    const now = Date.now();
    const context = await launchContext(testInfo.outputPath('profile-converge-2'));
    try {
      await seedExtensionStorage(context, {
        [STORAGE_KEYS.SETTINGS]: {
          emby: {
            enabled: true,
            mediaServers: [{
              id: 'emby-e2e',
              type: 'emby',
              name: 'Emby-E2E',
              url: EMBY_URL,
              apiKey: EMBY_API_KEY,
              enabled: true,
            }],
          },
          drive115: {
            enabled: true,
            mediaLibraryRoots: [{ cid: 'e2e-none', name: 'E2E 115 片库', enabled: false }],
          },
        },
        // 本地索引已刷新：不含该影片（外部删除后重扫的自然状态）。
        [STORAGE_KEYS.EMBY_LIBRARY_STATE]: { entries: {}, updatedAt: now },
        [STORAGE_KEYS.MEDIA_CLEANUP_STATE]: buildDirtyCleanupState({
          code, baseId, itemId, fileName: `${name}.mkv`, now, revCount: 4,
        }),
        [STORAGE_KEYS.MEDIA_DELETION_HISTORY]: { version: 1, records: {}, updatedAt: now },
      });

      const page = await openCleanupOverlay(context, await readExtensionId(context));
      await page.getByRole('button', { name: '查找已看影片' }).click();

      const msgLocator = page.locator('.ml-cleanup-msg');
      await expect(msgLocator).toContainText(/已合并 4 条历史重复记录/, { timeout: 30_000 });
      await expect(msgLocator).toContainText('没有新增待处理影片', { timeout: 30_000 });

      // 待处理 tab 归零。
      await expect(page.locator('[data-media-cleanup-overlay="1"] .ml-cleanup-empty')).toContainText(
        '当前没有待处理影片',
      );

      // 存储层强断言：无 pending；非 deleted 记录全部 skipped 且带正确提示；deleted 历史保留。
      const stored = await readStorageJson(page, [STORAGE_KEYS.MEDIA_CLEANUP_STATE]);
      const copies = stored[STORAGE_KEYS.MEDIA_CLEANUP_STATE]?.items?.[code]?.copies ?? {};
      const entries = Object.entries(copies) as Array<[string, any]>;
      expect(entries.filter(([, copy]) => copy?.status === 'pending' || copy?.status === 'deleting')).toHaveLength(0);
      expect(entries.filter(([, copy]) => copy?.status === 'skipped')).toHaveLength(4);
      for (const [, copy] of entries.filter(([, c]) => c?.status === 'skipped')) {
        expect(copy.message).toBe('重新扫描时该文件已不在媒体库中，记录已合并');
      }
      expect(copies[baseId]?.status).toBe('deleted');
    } finally {
      await context.close();
    }
  });
});
