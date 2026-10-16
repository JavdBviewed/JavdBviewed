/**
 * @file x2-emby-sync-model.spec.ts
 * @description X2（10-13 线）云 settings 同步模型真机验收（双 profile + 18091 测试云 + 38098 emby 夹具）：
 *   项 1 会话隔离（A 真登录获 session → 云/ B 均无会话；A 登出 → 不回灌；旧 blob 含会话注入 → 仍不回灌）
 *   项 2 并集合并（A 加 X → B 收到；B 加 Y → A 收到；互不覆盖）
 *   项 3 删除传播（A 删 Y → 云端墓碑 → B 消失；B 本地变更+同步后仍无 Y）
 *   项 4 同 id 变更（A 改名 X → B 名称更新、其它字段/其它源不动）
 *   项 5 兼容（修复前形态旧 blob 注入 pull → 剥离会话 + id 保留，无崩溃无脏键）
 *   项 7 页面无感知（扩展页 pageErrors=0；整页截图留 evidence/）
 *
 * 环境门禁：CLOUD_E2E_BASE_URL / CLOUD_E2E_PASSWORD 指向 18091 隔离测试云；
 * EMBY_E2E_URL / EMBY_E2E_USERNAME / EMBY_E2E_PASSWORD 指向 38098 emby-test-b1。
 * 凭据运行时读取，token/密码一律只记长度投影，禁回显。
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';

const cloudBaseUrl = process.env.CLOUD_E2E_BASE_URL?.trim();
const cloudPassword = process.env.CLOUD_E2E_PASSWORD?.trim();
const cloudUser = process.env.CLOUD_E2E_USER?.trim() || 'admin';
const embyUrl = process.env.EMBY_E2E_URL?.trim() || 'http://127.0.0.1:38098';
const embyUsername = process.env.EMBY_E2E_USERNAME?.trim() || 'MyEmbyUser';
const embyPassword = process.env.EMBY_E2E_PASSWORD?.trim();

const runTag = `x2r${String(Date.now()).slice(-6)}`;
const NAME_S1 = `X2Sess-${runTag}`;
const NAME_X = `X2UnionX-${runTag}`;
const NAME_X_RENAMED = `X2UnionX2-${runTag}`;
const NAME_Y = `X2UnionY-${runTag}`;

const EVIDENCE_DIR = process.env.X2_EVIDENCE_DIR
  ?.trim()
  ? path.resolve(process.env.X2_EVIDENCE_DIR.trim())
  : path.resolve(
      os.homedir(),
      'Git/JavdBviewed-project/.trellis/tasks/10-13-cloud-settings-sync-model/research/evidence/x2-realdevice',
    );

const SESSION_FIELDS = ['accessToken', 'userId', 'userDisplayName', 'tokenObtainedAt'] as const;

interface LocalServerView {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  username: string;
  hasAccessToken: boolean;
  accessTokenLen: number;
  userId: string;
  userDisplayName: string;
  tokenObtainedAt: number | null;
  updatedAt: number | null;
  embyTopKeys: string[];
}

interface CloudEmbyState {
  mediaServers: Array<Record<string, unknown>>;
  deletedServerIds: string[];
  settingsRevision: number;
}

test.describe('X2 emby 云 settings 同步模型（真机双 profile）', () => {
  test.skip(!cloudBaseUrl || !cloudPassword || !embyPassword, '需要 CLOUD_E2E_* 与 EMBY_E2E_* 指向隔离测试夹具');

  test(
    '会话隔离 + 并集 + 删除传播 + 同 id 变更 + 旧 blob 兼容 + 页面无感知',
    async ({}, testInfo) => {
      test.setTimeout(900_000);
      const profileA = testInfo.outputPath(`profile-a-${runTag}`);
      const profileB = testInfo.outputPath(`profile-b-${runTag}`);

      const contextA = await launchExtensionContext(resolveHarnessOptions(profileA), {
        headless: false,
        channel: 'chromium',
      });
      let contextB: BrowserContext | undefined;

      try {
        // ── 共享环境：A 连接 + 基线自愈 ─────────────────────────────────
        const extIdA = await readExtensionId(contextA);
        await suppressReleaseAnnouncementForTest(contextA);
        await resetCloudConnectionForIsolatedTest(contextA);
        const cloudPageA = await openCloudSettings(contextA, extIdA);
        await trackPageErrors(cloudPageA, 'A-cloud');
        await connectAndSync(cloudPageA, `X2 A ${runTag}`);
        await expect(cloudPageA.getByText('已登录', { exact: true }).first()).toBeVisible();

        const embyPageA = await openEmbySettings(contextA, extIdA);
        await trackPageErrors(embyPageA, 'A-emby');
        await selfHealBaseline(embyPageA, cloudPageA);
        const baseline = await fetchCloudEmbyState();
        const baselineIds = serverIdSet(baseline.mediaServers);
        test.info().annotations.push({
          type: 'cloud-baseline',
          description: `servers=${baselineIds.size} tombstones=${baseline.deletedServerIds.length} settingsRev=${baseline.settingsRevision}`,
        });

        // ══ 项 1a：A 真登录 38098 获 session → 同步 → 云端无会话字段（push 剥离）
        await addEmbyServer(embyPageA, NAME_S1, 'e2e-x2-sess-key');
        await loginEmbyViaEdit(embyPageA, NAME_S1, embyUsername, embyPassword!);
        let s1A = (await readLocalServers(embyPageA)).find((s) => s.name === NAME_S1);
        expect(s1A?.hasAccessToken, 'A 本地 S1 登录后应有 accessToken').toBe(true);
        expect(s1A?.accessTokenLen, 'A 本地 S1 accessToken 长度投影').toBeGreaterThan(0);

        await syncFromSummary(cloudPageA);
        let cloud = await fetchCloudEmbyState();
        let s1Cloud = findCloudServer(cloud, s1A!.id);
        expect(s1Cloud, '同步后云端应有 S1 条目').toBeTruthy();
        for (const f of SESSION_FIELDS) {
          expect(s1Cloud![f], `云端 S1 不应含会话字段 ${f}（push 剥离）`).toBeUndefined();
        }
        expect(String(s1Cloud!.url)).toBe(embyUrl);

        // ══ 项 1b：B 全新 profile 同步 → 收到 S1 但无会话（pull 隔离）
        contextB = await launchExtensionContext(resolveHarnessOptions(profileB), {
          headless: false,
          channel: 'chromium',
        });
        const extIdB = await readExtensionId(contextB);
        expect(extIdB).toBe(extIdA);
        await suppressReleaseAnnouncementForTest(contextB);
        await resetCloudConnectionForIsolatedTest(contextB);
        const cloudPageB = await openCloudSettings(contextB, extIdB);
        await trackPageErrors(cloudPageB, 'B-cloud');
        await connectAndSync(cloudPageB, `X2 B ${runTag}`);
        const embyPageB = await openEmbySettings(contextB, extIdB);
        await trackPageErrors(embyPageB, 'B-emby');

        let s1B = (await readLocalServers(embyPageB)).find((s) => s.name === NAME_S1);
        expect(s1B, 'B 应收到 S1 条目').toBeTruthy();
        expect(s1B!.id).toBe(s1A!.id);
        for (const f of SESSION_FIELDS) {
          expect(fieldView(s1B!, f), `B 本地 S1 不应出现 A 的会话字段 ${f}`).toBe('absent');
        }
        expect(s1B!.url).toBe(embyUrl);
        expect(s1B!.apiKey).toBe('e2e-x2-sess-key');

        // ══ 项 2：并集合并（A 加 X → B 收到；B 加 Y → A 收到；互不覆盖）
        await addEmbyServer(embyPageA, NAME_X, 'e2e-x2-union-x');
        await syncFromSummary(cloudPageA);
        await syncFromSummary(cloudPageB);
        let serversB = await readLocalServers(embyPageB);
        const xB = serversB.find((s) => s.name === NAME_X);
        expect(xB, 'B 应收到 A 新增的 X').toBeTruthy();

        await addEmbyServer(embyPageB, NAME_Y, 'e2e-x2-union-y');
        await syncFromSummary(cloudPageB);
        await syncFromSummary(cloudPageA);
        let serversA = await readLocalServers(embyPageA);
        const yA = serversA.find((s) => s.name === NAME_Y);
        expect(yA, 'A 应收到 B 新增的 Y').toBeTruthy();

        serversB = await readLocalServers(embyPageB);
        const bUnion = new Set(serversB.map((s) => s.id));
        for (const id of [...baselineIds, s1A!.id, xB!.id]) {
          expect(bUnion.has(id), `B 不应丢失既有源 ${id}（互不覆盖）`).toBe(true);
        }

        // ══ 项 4：同 id 变更（A 改名 X → B 名称更新、其它字段/其它源不动）
        const xBefore = serversB.find((s) => s.id === xB!.id)!;
        await renameEmbyServer(embyPageA, NAME_X, NAME_X_RENAMED);
        await syncFromSummary(cloudPageA);
        // 确定性时序（coord 16:55 裁决）：产品契约=「rename 落地后 B 端下一次 pull 即收敛
        // 为新值」（LWW 同 id 新戳胜，33 单测已锁）。A「同步完成」不保证 rename 已落云端
        // （实测 read-your-writes gap 最大约 6s），下方屏障只等云端 rename 落地以确立
        // 时序前提，不参与断言；屏障后的显式 B pull 即该「下一次 pull」。
        await expect
          .poll(
            async () => {
              const st = await fetchCloudEmbyState();
              return st.mediaServers.find((s) => s.id === xB!.id)?.name;
            },
            { timeout: 60_000 },
          )
          .toBe(NAME_X_RENAMED);
        await syncFromSummary(cloudPageB);
        const xAfter = (await readLocalServers(embyPageB)).find((s) => s.id === xB!.id);
        expect(xAfter?.name, 'B 的 X 名称应更新').toBe(NAME_X_RENAMED);
        expect(xAfter!.url).toBe(xBefore.url);
        expect(xAfter!.apiKey).toBe(xBefore.apiKey);
        for (const f of SESSION_FIELDS) {
          expect(fieldView(xAfter!, f), `B 的 X 不应出现会话字段 ${f}`).toBe('absent');
        }
        const s1AfterRename = (await readLocalServers(embyPageB)).find((s) => s.id === s1A!.id)!;
        expect(s1AfterRename.url).toBe(embyUrl);
        expect(s1AfterRename.apiKey).toBe('e2e-x2-sess-key');
        const yAfterRename = (await readLocalServers(embyPageB)).find((s) => s.id === yA!.id)!;
        expect(yAfterRename.name).toBe(NAME_Y);
        expect(yAfterRename.apiKey).toBe('e2e-x2-union-y');

        // ══ 项 3：删除传播（A 删 Y → 云端墓碑 → B 消失；B 本地变更+同步后仍无 Y）
        // 操作假设修（coord 16:55 裁决）：A emby 页 form=挂载快照，Y 经项 2 pull 入 A
        // settings 但页面无 storage.onChanged 实时刷新（既有行为，HEAD 同），先 reload
        // 渲染出 Y 行再删；reload=用户正常动作，脚本侧、不动产品码。
        await embyPageA.reload({ waitUntil: 'domcontentloaded' });
        await expect(embyPageA.locator('#emby-media-server-list')).toBeVisible({ timeout: 30_000 });
        await removeEmbyServer(embyPageA, NAME_Y);
        await syncFromSummary(cloudPageA);
        let cloudAfterDelete = await fetchCloudEmbyState();
        expect(serverIdSet(cloudAfterDelete.mediaServers).has(yA!.id), '云端 Y 应已删除').toBe(false);
        expect(cloudAfterDelete.deletedServerIds, '云端 tombstone 应记录 Y').toContain(yA!.id);

        await syncFromSummary(cloudPageB);
        expect(
          (await readLocalServers(embyPageB)).some((s) => s.id === yA!.id),
          'B 的 Y 应消失',
        ).toBe(false);

        // B 本地变更（改名 S1）+ 同步 → Y 仍不复活
        await renameEmbyServer(embyPageB, NAME_S1, `${NAME_S1}r`);
        await syncFromSummary(cloudPageB);
        expect(
          (await readLocalServers(embyPageB)).some((s) => s.id === yA!.id),
          'B 本地变更+同步后 Y 仍不应复活',
        ).toBe(false);
        const s1RenamedB = (await readLocalServers(embyPageB)).find((s) => s.id === s1A!.id)!;
        expect(s1RenamedB.name).toBe(`${NAME_S1}r`);
        // 同步回 A：A 侧 S1 名称也应更新（B→A 方向），Y 在 A 本就不存在
        // 确定性时序（与项 4 同裁决模式，coord 16:55）：B 的 rename 落地存在同样的
        // read-your-writes gap（本轮实测 6.9s），A「同步完成」不保证随后 pull 读到新值；
        // 先等云端 S1 rename 落地（仅时序前提，不参与断言），A 的 pull 即该「下一次 pull」。
        await expect
          .poll(
            async () => {
              const st = await fetchCloudEmbyState();
              return st.mediaServers.find((s) => s.id === s1A!.id)?.name;
            },
            { timeout: 60_000 },
          )
          .toBe(`${NAME_S1}r`);
        await syncFromSummary(cloudPageA);
        const s1OnA = (await readLocalServers(embyPageA)).find((s) => s.id === s1A!.id)!;
        expect(s1OnA.name).toBe(`${NAME_S1}r`);

        // ══ 项 1c + 项 5：A 登出清 session → 旧 blob（含会话、无戳）注入 → 两端均不回灌、无脏键
        // 同类操作假设修（与项 3 同裁决口径）：S1 改名来自 B pull，A 页 form 同为陈旧
        // 快照（行内仅旧名），不 reload 则按新名找不到行；先 reload 再登出，脚本侧、
        // 不动产品码。
        await embyPageA.reload({ waitUntil: 'domcontentloaded' });
        await expect(embyPageA.locator('#emby-media-server-list')).toBeVisible({ timeout: 30_000 });
        await logoutEmbyViaEdit(embyPageA, `${NAME_S1}r`);
        s1A = (await readLocalServers(embyPageA)).find((s) => s.id === s1A!.id)!;
        expect(s1A.hasAccessToken, 'A 登出后本地 S1 会话应已清除').toBe(false);
        await syncFromSummary(cloudPageA);

        const preInject = await fetchCloudEmbyState();
        const s1CloudNow = findCloudServer(preInject, s1A!.id)!;
        const xCloudNow = findCloudServer(preInject, xB!.id)!;
        expect(xCloudNow, '注入前云端应有 X').toBeTruthy();
        // 项 1c 真实契约：A 登出+同步后云端 S1 即应无会话字段（push 剥离生效）。
        // 断言放注入前：注入后服务端逐字段并集合并会把 LEGACY 会话字段留在云端
        // （base 独有字段保留，L5 协议面语义，本线不改），终态审计对 S1 豁免。
        for (const f of SESSION_FIELDS) {
          expect((s1CloudNow as Record<string, unknown>)[f], `注入前云端 S1 应无 ${f}（项 1c）`).toBeUndefined();
        }
        const legacyValue = {
          theme: 'dark',
          emby: {
            enabled: true,
            mediaServers: [
              {
                ...stripSession(s1CloudNow),
                accessToken: `LEGACY-AT-${runTag}`,
                userId: `LEGACY-UID-${runTag}`,
                userDisplayName: `Legacy-${runTag}`,
                tokenObtainedAt: 1_700_000_000_000,
              },
              { ...stripSession(xCloudNow), name: NAME_X },
            ],
          },
        };
        const pushStatus = await injectLegacySettings(
          preInject.settingsRevision,
          legacyValue,
          `x2-legacy-${runTag}`,
        );
        test.info().annotations.push({ type: 'legacy-inject', description: `pushStatus=${pushStatus}` });

        await syncFromSummary(cloudPageB);
        const s1BFinal = (await readLocalServers(embyPageB)).find((s) => s.id === s1A!.id)!;
        for (const f of SESSION_FIELDS) {
          expect(fieldView(s1BFinal, f), `B 拉取含会话旧 blob 后不应回灌 ${f}（项 1c+5）`).toBe('absent');
        }
        expect(s1BFinal.name).toBe(`${NAME_S1}r`);
        const xBFinal = (await readLocalServers(embyPageB)).find((s) => s.id === xB!.id)!;
        // 名称不写死：注入的无戳旧 blob 经服务端逐字段并集合并后，base 侧旧 name
        // （X 原名）覆盖回云端（L5 协议面语义，本线不改）；B 再 pull 平手按远端胜，
        // 名称回落旧值属预期。项 5 真实契约=id 保留（不丢源）+ 无会话字段 + 无脏键。
        expect(xBFinal, 'X id 应保留（无戳旧 blob 不丢源）').toBeTruthy();
        for (const f of SESSION_FIELDS) {
          expect(fieldView(xBFinal, f), `B 的 X 不应回灌 ${f}（项 5）`).toBe('absent');
        }
        await assertNoDirtyKeys(embyPageB);

        await syncFromSummary(cloudPageA);
        const s1AFinal = (await readLocalServers(embyPageA)).find((s) => s.id === s1A!.id)!;
        for (const f of SESSION_FIELDS) {
          expect(fieldView(s1AFinal, f), `A 拉取含会话旧 blob 后不应回灌 ${f}`).toBe('absent');
        }

        // 终态审计：注入后云端 S1 会携带 LEGACY 会话字段——服务端逐字段并集合并
        // 保留 base 独有字段（L5 协议面语义），剥离推送（省略字段）无法清除存量，
        // 属既有协议行为、本线不修（报备项）；审计范围收窄为 X（本线新建、无 base
        // 会话遗留）必须无会话字段 + 墓碑含 Y。
        const cloudFinal = await fetchCloudEmbyState();
        const xFinal = findCloudServer(cloudFinal, xB!.id)!;
        expect(xFinal, '终态云端应仍有 X').toBeTruthy();
        for (const f of SESSION_FIELDS) {
          expect((xFinal as Record<string, unknown>)[f], `终态云端 X 的 ${f} 应已被剥离`).toBeUndefined();
        }
        expect(cloudFinal.deletedServerIds).toContain(yA!.id);

        // ══ 项 7：页面无感知（pageErrors=0 + 整页截图）
        const errors = pageErrorLog();
        expect(errors, `扩展页 pageErrors 应为 0，实际：${JSON.stringify(errors)}`).toEqual({});
        fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
        await cloudPageA.screenshot({ path: path.join(EVIDENCE_DIR, `x2-A-cloud-${runTag}.png`), fullPage: true });
        await cloudPageB.screenshot({ path: path.join(EVIDENCE_DIR, `x2-B-cloud-${runTag}.png`), fullPage: true });
        await embyPageB.screenshot({ path: path.join(EVIDENCE_DIR, `x2-B-emby-${runTag}.png`), fullPage: true });
        test.info().annotations.push({
          type: 'evidence',
          description: `screenshots → ${EVIDENCE_DIR} (A-cloud/B-cloud/B-emby)`,
        });
      } finally {
        await contextB?.close();
        await contextA.close();
      }
    },
  );
});

// ── 环境 ──────────────────────────────────────────────────────────────────

function resolveHarnessOptions(userDataDir: string): ReturnType<typeof resolveExtensionHarnessOptions> {
  return resolveExtensionHarnessOptions(
    {
      ...process.env,
      JAVDB_EXTENSION_PROFILE: path.resolve(userDataDir),
    },
    process.cwd(),
  );
}

// ── 页面导航 ──────────────────────────────────────────────────────────────

async function openCloudSettings(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(
    extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/cloud-settings'),
    { waitUntil: 'domcontentloaded' },
  );
  await dismissReleaseAnnouncementIfPresent(page);
  await expect(page.locator('[data-cloud-settings-react="1"]').last()).toBeVisible();
  return page;
}

async function openEmbySettings(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(
    extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-settings/media-library-settings'),
    { waitUntil: 'domcontentloaded' },
  );
  await dismissReleaseAnnouncementIfPresent(page);
  await expect(page.locator('[data-media-library-settings-react="1"]').last()).toBeVisible();
  await expect(page.locator('#emby-media-server-list')).toBeVisible();
  return page;
}

async function dismissReleaseAnnouncementIfPresent(page: Page): Promise<void> {
  const modal = page.locator('#jdb-release-announcement-modal');
  const closeButton = modal.locator('[data-action="release-announcement-close"]');
  await modal.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
  if (!(await closeButton.isVisible().catch(() => false))) return;
  await closeButton.click();
  await modal.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
}

// ── 云连接与同步（与 cloud-selfhost-sync.spec.ts 同模式）───────────────────

async function connectAndSync(page: Page, deviceLabel: string): Promise<void> {
  await page.getByRole('button', { name: '编辑连接' }).click();
  const dialog = page.getByRole('dialog', { name: '连接服务' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#cloud-base-url').fill(cloudBaseUrl!);
  await dialog.locator('#cloud-device-label').fill(deviceLabel);
  await dialog.locator('#cloud-identifier').fill(cloudUser);
  await dialog.locator('#cloud-password').fill(cloudPassword!);
  // 新 UI：「保存连接」仅存草稿；「测试连接」= 保存配置 + 登录账号
  await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('✓ 连接正常，未执行同步')).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole('button', { name: '保存连接', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已登录', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  // 摘要卡：已登录 → 「立即同步」
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  const progressDialog = page.getByRole('dialog').filter({ hasText: '同步完成' });
  await expect(progressDialog).toBeVisible({ timeout: 180_000 });
  await closeCompletedSyncDialog(page);
}

async function syncFromSummary(page: Page): Promise<void> {
  await page.getByRole('button', { name: '立即同步' }).click();
  const progressDialog = page.getByRole('dialog').filter({ hasText: '同步完成' });
  await expect(progressDialog).toBeVisible({ timeout: 180_000 });
  await closeCompletedSyncDialog(page);
}

async function closeCompletedSyncDialog(page: Page): Promise<void> {
  const progressDialog = page.getByRole('dialog').filter({ hasText: '同步完成' });
  if (await progressDialog.count()) {
    await progressDialog.getByRole('button', { name: '完成', exact: true }).click();
    await expect(progressDialog).toHaveCount(0);
  }
}

async function resetCloudConnectionForIsolatedTest(context: BrowserContext): Promise<void> {
  const worker =
    context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://')) ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  await worker.evaluate(async () => {
    await chrome.storage.local.remove([
      'cloud_sync_session_v1',
      'cloud_sync_pending_v1',
      'cloud_sync_cursors_v1',
    ]);
    await chrome.storage.local.set({
      cloud_sync_settings_v1: {
        baseUrl: '',
        deviceLabel: '',
        accountIdentifier: '',
        accountPassword: '',
      },
      cloud_auto_sync_settings_v1: {
        enabled: false,
        intervalMinutes: 30,
      },
    });
  });
}

// ── Emby 源 UI 操作（38098 真登录路径；token/密码只投影长度，不回显）──────

async function addEmbyServer(page: Page, name: string, apiKey: string): Promise<void> {
  await page.locator('#add-emby-media-server').click();
  await page.locator('#emby-create-server-name').fill(name);
  await page.locator('#emby-create-server-url').fill(embyUrl);
  await page.locator('#emby-create-server-api-key').fill(apiKey);
  await page.locator('.create-emby-media-server-confirm').click();
  // 立即持久化成功信号（persistEmbyForm → toast）
  await expect(page.getByText('设置已保存')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.emby-media-server-summary', { hasText: name }).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function removeEmbyServer(page: Page, name: string, timeoutMs = 30_000): Promise<void> {
  const row = page.locator('.emby-media-server-summary', { hasText: name }).first();
  // 显式超时（coord 16:55 裁决）：目标行可见性 fail-fast，防无界等待（历史 900s hang 根因）
  await expect(row).toBeVisible({ timeout: timeoutMs });
  await row.getByRole('button', { name: '删除', exact: true }).click({ timeout: timeoutMs });
  const dialog = page.getByRole('dialog', { name: '确认删除媒体服务器' });
  await expect(dialog).toBeVisible({ timeout: timeoutMs });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click({ timeout: timeoutMs });
  await expect(page.getByText('媒体服务器来源已删除')).toBeVisible({ timeout: timeoutMs });
}

/** 本地 settings 投影：token/密码只回投影位（布尔/长度），原始值不进测试输出 */
async function readLocalServers(page: Page): Promise<LocalServerView[]> {
  return page.evaluate(async () => {
    const st = (await chrome.storage.local.get('settings')) as { settings?: any };
    const servers = st.settings?.emby?.mediaServers;
    if (!Array.isArray(servers)) return [];
    const SESSION_KEYS = ['accessToken', 'userId', 'userDisplayName', 'tokenObtainedAt'];
    const BASE_KEYS = ['id', 'name', 'url', 'type', 'apiKey', 'username', 'password', 'updatedAt'];
    return servers.map((raw: any) => {
      const obj = raw ?? {};
      const topKeys = Object.keys(obj).filter(
        (k) => !BASE_KEYS.includes(k) && !SESSION_KEYS.includes(k),
      );
      return {
        id: String(obj.id || ''),
        name: String(obj.name || ''),
        url: String(obj.url || ''),
        apiKey: String(obj.apiKey || ''),
        username: String(obj.username || ''),
        hasAccessToken: String(obj.accessToken || '').trim().length > 0,
        accessTokenLen: String(obj.accessToken || '').trim().length,
        userId: String(obj.userId || ''),
        userDisplayName: String(obj.userDisplayName || ''),
        tokenObtainedAt: typeof obj.tokenObtainedAt === 'number' ? obj.tokenObtainedAt : null,
        updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : null,
        embyTopKeys: topKeys,
      };
    });
  });
}

function fieldView(view: LocalServerView, f: (typeof SESSION_FIELDS)[number]): 'absent' | 'present' {
  switch (f) {
    case 'accessToken':
      return view.hasAccessToken ? 'present' : 'absent';
    case 'userId':
      return view.userId ? 'present' : 'absent';
    case 'userDisplayName':
      return view.userDisplayName ? 'present' : 'absent';
    case 'tokenObtainedAt':
      return view.tokenObtainedAt === null ? 'absent' : 'present';
  }
}

/** 编辑弹窗填用户名+密码 → 「登录并保存令牌」→ 38098 真登录（凭据+accessToken 落本地） */
async function loginEmbyViaEdit(page: Page, name: string, user: string, password: string): Promise<void> {
  const servers = await readLocalServers(page);
  const index = servers.findIndex((s) => s.name === name);
  const target = servers[index];
  if (!target) throw new Error(`emby server not found for login: ${name}`);
  const row = page.locator('.emby-media-server-summary', { hasText: name }).first();
  await row.getByRole('button', { name: '编辑' }).click();
  const dialog = page.locator('#embyEditModal [role="dialog"]');
  await expect(dialog).toBeVisible();
  // idBase 与组件同口径：emby-server-${server.id || index}
  const idBase = `emby-server-${target.id || index}`;
  await dialog.locator(`#${idBase}-username`).fill(user);
  await dialog.locator(`#${idBase}-password`).fill(password);
  await dialog.locator('.emby-user-login-btn').click();
  await expect(page.getByText('用户登录成功，来源凭据与访问令牌已保存')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => (await readLocalServers(page)).find((s) => s.id === target.id)?.hasAccessToken,
      { timeout: 30_000 },
    )
    .toBe(true);
  await dialog.locator('.emby-server-edit-done').click();
  await expect(dialog).toHaveCount(0);
}

/** 编辑弹窗改名称 → 完成（整页 settings 保存） */
async function renameEmbyServer(page: Page, oldName: string, newName: string): Promise<void> {
  const servers = await readLocalServers(page);
  const index = servers.findIndex((s) => s.name === oldName);
  const target = servers[index];
  if (!target) throw new Error(`emby server not found for rename: ${oldName}`);
  const row = page.locator('.emby-media-server-summary', { hasText: oldName }).first();
  await row.getByRole('button', { name: '编辑' }).click();
  const dialog = page.locator('#embyEditModal [role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator(`#emby-server-${target.id || index}-name`).fill(newName);
  await dialog.locator('.emby-server-edit-done').click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () => (await readLocalServers(page)).find((s) => s.id === target.id)?.name,
      { timeout: 30_000 },
    )
    .toBe(newName);
}

/** 编辑弹窗退出登录（清 4 会话字段，保留来源与凭据） */
async function logoutEmbyViaEdit(page: Page, name: string): Promise<void> {
  const target = (await readLocalServers(page)).find((s) => s.name === name);
  if (!target) throw new Error(`emby server not found for logout: ${name}`);
  const row = page.locator('.emby-media-server-summary', { hasText: name }).first();
  await row.getByRole('button', { name: '编辑' }).click();
  const dialog = page.locator('#embyEditModal [role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('.emby-user-logout-btn').click();
  await expect
    .poll(
      async () => (await readLocalServers(page)).find((s) => s.id === target.id)?.hasAccessToken,
      { timeout: 30_000 },
    )
    .toBe(false);
  await dialog.locator('.emby-server-edit-done').click();
  await expect(dialog).toHaveCount(0);
}

/** 基线自愈：清理测试云遗留的无凭据脏源（历史 e2e 产物会阻断整页保存），幂等 */
async function selfHealBaseline(embyPage: Page, cloudPage: Page): Promise<void> {
  const dirty = await embyPage.evaluate(async () => {
    const st = (await chrome.storage.local.get('settings')) as { settings?: any };
    const servers = st.settings?.emby?.mediaServers;
    if (!Array.isArray(servers)) return [] as Array<{ id: string; url: string; index: number }>;
    return servers
      .map((s: any, index: number) => {
        const hasCredential = Boolean(
          String(s?.apiKey || '').trim() ||
            String(s?.accessToken || '').trim() ||
            (String(s?.username || '').trim() && String(s?.password || '').trim()),
        );
        return hasCredential ? null : { id: String(s?.id || ''), url: String(s?.url || ''), index };
      })
      .filter((x): x is { id: string; url: string; index: number } => x !== null)
      .sort((a, b) => b.index - a.index);
  });
  for (const item of dirty) {
    test.info().annotations.push({
      type: 'baseline-cleanup',
      description: `removed dirty legacy source id=${item.id} url=${item.url}`,
    });
    const row = embyPage.locator(`.emby-media-server-summary[data-index="${item.index}"]`);
    await row.getByRole('button', { name: '删除', exact: true }).click();
    const dialog = embyPage.getByRole('dialog', { name: '确认删除媒体服务器' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(embyPage.getByText('媒体服务器来源已删除')).toBeVisible({ timeout: 30_000 });
  }
  if (dirty.length > 0) {
    await syncFromSummary(cloudPage);
  }
}

// ── 云端 ground truth（login + pull，与 emby-tombstone-propagation.spec.ts 同模式）──────

async function fetchCloudEmbyState(): Promise<CloudEmbyState> {
  const loginRes = await fetch(`${cloudBaseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: cloudUser,
      password: cloudPassword,
      device: {
        id: 'x2-e2e-probe',
        label: 'x2-e2e',
        platform: 'linux',
        clientType: 'cli',
        clientVersion: '0',
      },
    }),
  });
  if (!loginRes.ok) throw new Error(`cloud login failed: HTTP ${loginRes.status}`);
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  const pullRes = await fetch(`${cloudBaseUrl}/v1/sync/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ cursor: '' }),
  });
  if (!pullRes.ok) throw new Error(`cloud pull failed: HTTP ${pullRes.status}`);
  const data = (await pullRes.json()) as {
    changes?: Array<{ type?: string; id?: string; revision?: number; payload?: unknown }>;
  };

  for (const change of data.changes ?? []) {
    if (change.type !== 'storage_item' || change.id !== 'settings') continue;
    let payload: unknown = change.payload;
    if (typeof payload === 'string') payload = JSON.parse(payload);
    const value =
      payload && typeof payload === 'object' && 'value' in (payload as Record<string, unknown>)
        ? (payload as Record<string, unknown>).value
        : payload;
    const emby = (value as any)?.emby ?? {};
    return {
      mediaServers: Array.isArray(emby.mediaServers) ? emby.mediaServers : [],
      deletedServerIds: Array.isArray(emby.deletedServerIds) ? emby.deletedServerIds : [],
      settingsRevision: Number(change.revision ?? 0),
    };
  }
  throw new Error('cloud pull: settings storage_item not found');
}

/** 直接 push 一条修复前形态的 settings（含会话字段、旧 revision），模拟旧客户端残留数据 */
async function injectLegacySettings(
  currentRevision: number,
  value: Record<string, unknown>,
  deviceId: string,
): Promise<string> {
  const loginRes = await fetch(`${cloudBaseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: cloudUser,
      password: cloudPassword,
      device: {
        id: 'x2-legacy-inject',
        label: 'x2-legacy-inject',
        platform: 'linux',
        clientType: 'cli',
        clientVersion: '0',
      },
    }),
  });
  if (!loginRes.ok) throw new Error(`cloud login (inject) failed: HTTP ${loginRes.status}`);
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  const pushRes = await fetch(`${cloudBaseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      protocolVersion: 1,
      changes: [
        {
          id: 'settings',
          type: 'storage_item',
          revision: currentRevision + 1,
          updatedAt: Date.now(),
          updatedByDeviceId: deviceId,
          payload: { key: 'settings', value },
        },
      ],
    }),
  });
  const body = (await pushRes.json().catch(() => ({}))) as {
    results?: Array<{ status?: string; reason?: string }>;
  };
  const resultStatus = body.results?.[0]?.status ?? 'unknown';
  return pushRes.ok ? `http=${pushRes.status};result=${resultStatus}` : `http=${pushRes.status}`;
}

function findCloudServer(cloud: CloudEmbyState, id: string): Record<string, unknown> | undefined {
  return cloud.mediaServers.find((s) => String(s?.id || '') === id);
}

function stripSession(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if ((SESSION_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function serverIdSet(servers: Array<{ id?: string }>): Set<string> {
  return new Set(servers.map((s) => String(s.id || '').trim()).filter(Boolean));
}

// ── 页面错误与脏键审计 ─────────────────────────────────────────────────────

const pageErrors: Record<string, string[]> = {};

function trackPageErrors(page: Page, tag: string): void {
  pageErrors[tag] = pageErrors[tag] ?? [];
  page.on('pageerror', (error) => {
    pageErrors[tag].push(`${error.name}: ${error.message}`);
  });
}

function pageErrorLog(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [tag, errors] of Object.entries(pageErrors)) {
    if (errors.length > 0) out[tag] = errors;
  }
  return out;
}

/** 终态结构审计：emby 面不得有 'undefined' 键 / 非对象条目 / 缺 id（不硬编码允许键集，emby 子含产品键） */
async function assertNoDirtyKeys(page: Page): Promise<void> {
  const audit = await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const problems: string[] = [];
    if (!settings || typeof settings !== 'object') {
      return { problems: ['settings missing or not object'] };
    }
    const emby = (settings as { emby?: unknown }).emby;
    if (!emby || typeof emby !== 'object') {
      return { problems: ['settings.emby missing'] };
    }
    const servers = (emby as { mediaServers?: unknown }).mediaServers;
    if (!Array.isArray(servers)) {
      return { problems: ['emby.mediaServers not array'] };
    }
    servers.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        problems.push(`mediaServers[${i}] not object`);
        return;
      }
      const obj = entry as Record<string, unknown>;
      if (typeof obj.id !== 'string' || obj.id.trim().length === 0) {
        problems.push(`mediaServers[${i}] id missing or non-string`);
      }
      for (const k of Object.keys(obj)) {
        if (k === 'undefined' || k.trim().length === 0) problems.push(`mediaServers[${i}] dirty key '${k}'`);
      }
    });
    const tombstones = (emby as { deletedServerIds?: unknown }).deletedServerIds;
    if (tombstones !== undefined) {
      if (!Array.isArray(tombstones) || tombstones.some((t) => typeof t !== 'string')) {
        problems.push('emby.deletedServerIds not string array');
      }
    }
    return { problems };
  });
  expect(audit.problems, `settings.emby 结构审计发现脏数据: ${audit.problems.join('; ')}`).toEqual([]);
}
