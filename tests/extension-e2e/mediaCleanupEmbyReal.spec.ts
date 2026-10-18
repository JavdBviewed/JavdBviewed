/**
 * @file mediaCleanupEmbyReal.spec.ts
 * @description 「已看影片整理」Emby 删除的真实容器 E2E（假成功回归验证）。
 *
 * 与 mediaCleanupDeleteRepro.spec.ts（mock background）不同，本文件让真实扩展
 * background 直接调用本地 Emby 4.9.5.0 测试容器（与用户真实服务器同版本，
 * 数据完全隔离）执行删除，并断言：
 *   1. UI 提示成功（"已处理 1 个文件，全部成功"）；
 *   2. 服务端条目确认消失（GET /Items?Ids= 空列表）——杜绝"提示成功但条目还在"；
 *   3. 磁盘视频文件确认消失（Emby 异步落盘删除，轮询等待）。
 *
 * 覆盖两条真实故障根因：
 *   - 用例 1（token + userId）：旧代码先试 DELETE /Users/{uid}/Items/{id}（该路由
 *     在 4.9.5.0 恒 404），把 404 当"已不存在"→ 什么都没删就报成功。
 *     本用例验证修复后只走 DELETE /Items/{id} 且删除后强校验。
 *   - 用例 2（仅 apiKey、无 userId）：旧代码存在性探测走 GET /Items/{id}
 *     （该路由在 4.9.5.0 规范中不存在，恒 404）→ 永远判"已删除"→ 假成功。
 *     本用例验证修复后走 GET /Items?Ids={id} 空列表判定。
 *
 * 环境要求（fixtures/embyRealEnv.ts 两级 preflight，失败=显式 skip 带原因）：
 *   - 测试容器可达并实读版本（默认 http://127.0.0.1:38098，可用 EMBY_E2E_URL 覆盖）
 *   - 凭据可用：EMBY_E2E_USERNAME/EMBY_E2E_PASSWORD 登录或 root 哨兵；
 *     用例 1（token+userId）需 token 凭据，用例 2（仅 apiKey）无有效 api_key 时显式 skip
 *   - 媒体目录可写（默认 /home/ryen/emby-b1/media/Movies，可用 EMBY_E2E_MEDIA_ROOT 覆盖）
 *   - 媒体文件缺失时用 Playwright 自带 ffmpeg 自动重建并触发扫库（90s 上限 + 401 快速失败）
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

import {
  EMBY_E2E_MEDIA_ROOT as MEDIA_ROOT,
  EMBY_E2E_URL as EMBY_URL,
  INDEX_POLL_TIMEOUT_MS,
  buildSeededServerEntry,
  embyJson,
  embyPreflight,
  getEmbyAuthSet,
  type EmbyAuth,
  type EmbyAuthSet,
} from './fixtures/embyRealEnv';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Service Worker 控制台收集（失败诊断用：真实 background 的报错都在这里）
// ---------------------------------------------------------------------------

const swConsoleLines: string[] = [];
const attachedContexts = new Set<BrowserContext>();

function attachConsoleCollectors(context: BrowserContext): void {
  if (attachedContexts.has(context)) return;
  attachedContexts.add(context);
  context.on('console', (msg) => {
    swConsoleLines.push(`[page:${msg.type()}] ${msg.text()}`);
  });
  const attachWorker = () => {
    for (const worker of context.serviceWorkers()) {
      if (!worker.url().startsWith('chrome-extension://')) continue;
      worker.on('console', (msg) => {
        swConsoleLines.push(`[sw:${msg.type()}] ${msg.text()}`);
      });
      worker.on('close', () => {
        swConsoleLines.push('[sw] closed');
      });
    }
  };
  context.on('serviceworker', attachWorker);
  attachWorker();
}

function collectSwConsole(): string {
  const lines = swConsoleLines.splice(0);
  return lines.length ? lines.join('\n') : '(无控制台输出)';
}

// ---------------------------------------------------------------------------
// 服务端辅助（Node 环境直连测试容器；凭据/请求统一走 fixtures/embyRealEnv.ts，
// 凭据不可用=显式 skip 带原因，不再静默空转）
// ---------------------------------------------------------------------------


/** 按名称查找已索引的 Movie 条目，返回 itemId 或 null。 */
async function findMovieId(name: string): Promise<string | null> {
  const { status, body } = await embyJson(
    `/Items?IncludeItemTypes=Movie&Recursive=true&SearchTerm=${encodeURIComponent(name)}`,
  );
  if (status === 401) throw new Error('Emby 凭据失效（/Items 401），快速失败而非空转轮询');
  if (status !== 200) return null;
  const items = Array.isArray(body?.Items) ? body.Items : [];
  const hit = items.find((item: any) => item?.Name === name);
  return hit?.Id ? String(hit.Id) : null;
}

function findFfmpeg(): string | null {
  const candidates: string[] = [];
  // 主机完整 ffmpeg 优先：Playwright 精简版 ffmpeg 不含 lavfi 输入格式，无法生成测试视频
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

/** 确保测试媒体文件夹存在（视频 + 海报），缺失时用 ffmpeg 重建。 */
function ensureMediaFolder(name: string): void {
  const folder = path.join(MEDIA_ROOT, name);
  fs.mkdirSync(folder, { recursive: true });
  const video = path.join(folder, `${name}.mkv`);
  const poster = path.join(folder, 'poster.jpg');
  if (!fs.existsSync(video) || !fs.existsSync(poster)) {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) {
      throw new Error(`媒体文件缺失且未找到 Playwright ffmpeg，无法重建 ${folder}`);
    }
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

/** 确保媒体已索引并返回 itemId（缺失时重建 + 触发整库扫库并轮询）。 */
async function ensureIndexedMovie(name: string): Promise<string> {
  let itemId = await findMovieId(name);
  if (itemId) return itemId;
  ensureMediaFolder(name);
  // /Library/Refresh 为 admin 端点：token 模式恒用 admin 凭据（root 哨兵/admin env 用户）
  const set = await getEmbyAuthSet();
  if (!set) throw new Error('防御性：preflight 已核凭据，此处不应为空');
  const refresh = await embyJson('/Library/Refresh', { method: 'POST' }, set.admin);
  if (refresh.status === 401) throw new Error('Emby admin 凭据失效（/Library/Refresh 401），快速失败而非空转轮询');
  if (refresh.status !== 200 && refresh.status !== 204) {
    throw new Error(`测试容器 /Library/Refresh 返回 HTTP ${refresh.status}，无法触发扫库`);
  }
  // 90s 上限 + 401 快速失败（PRD ④；此 build /Tasks 404，任务态查询不可行）
  const deadline = Date.now() + INDEX_POLL_TIMEOUT_MS;
  for (;;) {
    itemId = await findMovieId(name);
    if (itemId) return itemId;
    if (Date.now() >= deadline) {
      throw new Error(`扫库后 ${name} 仍未被 Emby 索引（达 ${INDEX_POLL_TIMEOUT_MS / 1000}s 上限）`);
    }
    await sleep(5_000);
  }
}

/** 断言条目已从服务端消失（DELETE 对 DB 是同步的，给少量轮询余量）。 */
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

/** 断言磁盘视频文件已消失（Emby 文件删除是异步任务，轮询等待）。 */
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

// ---------------------------------------------------------------------------
// 扩展 UI 侧：播种状态 → 打开面板 → 选中 → 删除 → 断言 UI 成功提示
// ---------------------------------------------------------------------------

type EmbyDeleteUiOptions = {
  code: string;
  itemId: string;
  fileName: string;
  useToken: boolean;
};

/** 按路由形态取凭据：token 路由=主 token（主为 api_key 时回落 admin）；apiKey 路由=仅接受 api_key 凭据。 */
function pickAuthForRoute(set: EmbyAuthSet, useToken: boolean): EmbyAuth {
  if (useToken) {
    return set.primary.mode === 'token' ? set.primary : set.admin.mode === 'token' ? set.admin : set.primary;
  }
  return set.primary;
}

async function runEmbyDeleteThroughUi(
  context: BrowserContext,
  extensionId: string,
  options: EmbyDeleteUiOptions,
  authSet: EmbyAuthSet,
): Promise<void> {
  const { code, itemId, fileName, useToken } = options;
  const auth = pickAuthForRoute(authSet, useToken);
  if (useToken && auth.mode !== 'token') {
    throw new Error('防御性：无可用 token 凭据（用例入口应已预核并 skip）');
  }
  if (!useToken && auth.mode !== 'api_key') {
    throw new Error('防御性：无可用 api_key 凭据（用例入口应已预核并 skip）');
  }
  attachConsoleCollectors(context);
  const now = Date.now();
  const copyId = `emby:${EMBY_URL}:${itemId}`;
  const server = buildSeededServerEntry(auth, 'emby-e2e', 'Emby-E2E');

  // 播种必须先于 dashboard 首次加载：先加载再播种时，页面内存里的默认设置
  // 会被设置面板 saveSettings 整对象回写，把播种的 emby/drive115 段抹掉
  // （LevelDB WAL 取证确认的失败根因）。seedExtensionStorage 走 SW 写入，
  // 与页面读取共享同一 storage 分区。
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
        [code]: {
          id: code,
          titleId: code,
          code,
          title: `${code} E2E 真实容器删除验证`,
          reason: 'watched',
          addedAt: now,
          updatedAt: now,
          copies: {
            [copyId]: {
              copyId,
              source: 'emby',
              serverName: 'Emby-E2E',
              serverUrl: EMBY_URL,
              itemId,
              fileName,
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

  await overlay.getByRole('checkbox', { name: `选择 ${code} 的全部来源文件` }).check();
  await overlay.getByRole('button', { name: '删除选中的文件' }).click();
  const confirmDialog = overlay.getByRole('alertdialog');
  await expect(confirmDialog).toContainText('确认删除 1 个文件');
  await confirmDialog.getByRole('button', { name: '确认删除' }).click();

  // UI 成功契约：批量消息 + toast（真实 background 执行删除，含删除后服务端校验）。
  // 必须轮询等待最终消息（"已处理 N 个文件…"）出现后再断言，
  // 不能在消息刚可见时一次性读取——删除走真实 HTTP 往返，期间消息一直是"正在处理"。
  const msgLocator = overlay.locator('.ml-cleanup-msg');
  await expect(msgLocator).toBeVisible();
  await expect(msgLocator).toContainText(/已处理 1 个文件/, { timeout: 120_000 });
  const msgText = (await msgLocator.textContent()) || '';
  if (!msgText.includes('全部成功')) {
    // 失败诊断：dump 操作记录 + 清理状态 + SW 控制台，直接暴露确切错误文案
    const dump = await page.evaluate(
      (keys: { cleanup: string; history: string; settings: string }) =>
        new Promise<string>((resolve) => {
          chrome.storage.local.get(
            [keys.cleanup, keys.history, keys.settings],
            (items: Record<string, unknown>) => {
              try {
                resolve(JSON.stringify(items, null, 2));
              } catch (e: unknown) {
                resolve(`dump 失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            },
          );
        }),
      {
        cleanup: STORAGE_KEYS.MEDIA_CLEANUP_STATE,
        history: STORAGE_KEYS.MEDIA_DELETION_HISTORY,
        settings: STORAGE_KEYS.SETTINGS,
      },
    );
    throw new Error(
      `UI 显示失败：${msgText}\n--- 控制台 ---\n${collectSwConsole()}\n--- storage dump ---\n${dump}`,
    );
  }
  await expect(page.locator('#messageContainer .toast')).toContainText(
    '已删除 1 个文件，全部成功',
    { timeout: 10_000 },
  );
  await page.close();
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test.describe('media cleanup Emby real-container delete', () => {
  test.setTimeout(300_000);

  /** 容器不可达时在当前用例内跳过（skip 谓词在收集期求值，不能依赖 beforeAll 的结果）。 */
  async function skipIfContainerDown(): Promise<void> {
    const pf = await embyPreflight();
    if (!pf.ok) {
      test.skip(true, `${pf.reason}，跳过真实容器用例`);
    }
  }

  test('token+userId 路由：只走 DELETE /Items/{id}，删除后校验条目与磁盘文件消失（根因 A 回归）', async ({}, testInfo) => {
  await skipIfContainerDown();
    const set = await getEmbyAuthSet();
    if (!set || (set.primary.mode !== 'token' && set.admin.mode !== 'token')) {
      test.skip(true, '无可用 token 凭据（此夹具仅 api_key 模式生效时），跳过 token+userId 路由用例');
    }
    const name = 'E2EAV-TOKEN-1';
    const itemId = await ensureIndexedMovie(name);
    const harnessOptions = resolveExtensionHarnessOptions(
      {
        ...process.env,
        JAVDB_EXTENSION_USE_CHROME_DATA: '0',
        JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-token'),
      },
      process.cwd(),
    );
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      await runEmbyDeleteThroughUi(context, extensionId, {
        code: name,
        itemId,
        fileName: `${name}.mkv`,
        useToken: true,
      }, set);
      // 服务端 + 磁盘双重确认：提示成功 ⇔ 文件真的没了
      await assertItemGone(itemId);
      await assertVideoFileGone(name);
    } finally {
      await context.close();
    }
  });

  test('仅 apiKey（无 userId）路由：存在性判定走 /Items?Ids=，删除后校验消失（根因 B 回归）', async ({}, testInfo) => {
  await skipIfContainerDown();
    const set = await getEmbyAuthSet();
    if (!set || set.primary.mode !== 'api_key') {
      test.skip(true, '此夹具无有效 api_key 凭证（旧默认 key 对 38098 恒 401；此 build 无 API key 管理路由与存储），跳过仅 apiKey 路由用例');
    }
    const name = 'E2EAV-KEY-1';
    const itemId = await ensureIndexedMovie(name);
    const harnessOptions = resolveExtensionHarnessOptions(
      {
        ...process.env,
        JAVDB_EXTENSION_USE_CHROME_DATA: '0',
        JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile-keyonly'),
      },
      process.cwd(),
    );
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    });
    try {
      const extensionId = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      await runEmbyDeleteThroughUi(context, extensionId, {
        code: name,
        itemId,
        fileName: `${name}.mkv`,
        useToken: false,
      }, set);
      await assertItemGone(itemId);
      await assertVideoFileGone(name);
    } finally {
      await context.close();
    }
  });
});
