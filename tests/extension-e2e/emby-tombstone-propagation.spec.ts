/**
 * @file emby-tombstone-propagation.spec.ts
 * @description Emby 源删除墓碑传播验收（任务线⑧）：扩展删除源 → 云端 tombstone → 其他 profile 不复活 → 重加新 id 正常
 *
 * 环境门禁：CLOUD_E2E_BASE_URL / CLOUD_E2E_PASSWORD 指向隔离测试云（生产域名/端口禁止）。
 * 数据隔离：双全新 profile；测试云基线只增不删（动态获取），终态审计断言。
 * 基线自愈：首连后先用产品自身的删除+tombstone 机制清理无凭据 legacy 脏源（幂等，
 * 已清理则跳过），确保后续保存/同步断言不受脏数据干扰。
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import {
  assertExtensionBuildDirectory,
  createChromiumExtensionArgs,
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
  suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';

const cloudBaseUrl = process.env.CLOUD_E2E_BASE_URL?.trim();
const cloudPassword = process.env.CLOUD_E2E_PASSWORD?.trim();
const cloudUser = process.env.CLOUD_E2E_USER?.trim() || 'admin';
const embyTestUrl = process.env.EMBY_E2E_URL?.trim() || 'http://127.0.0.1:38097';

const SERVER_NAME_A = 'TombE2E-A';
const SERVER_NAME_B = 'TombE2E-B';

test.describe('Emby server deletion tombstone propagation', () => {
  test.skip(
    !cloudBaseUrl || !cloudPassword,
    '需要 CLOUD_E2E_BASE_URL 与 CLOUD_E2E_PASSWORD 指向隔离测试容器',
  );

  test('deleted emby server is tombstoned on cloud and never revives on other profiles', async (
    {},
    testInfo,
  ) => {
    test.setTimeout(600_000);
    const profileA = testInfo.outputPath('profile-a');
    const profileB = testInfo.outputPath('profile-b');

    const contextA = await launchExtensionContext(resolveHarnessOptions(profileA), {
      headless: false,
      channel: 'chromium',
    });
    let contextB: BrowserContext | undefined;

    try {
      const extensionId = await readExtensionId(contextA);
      await suppressReleaseAnnouncementForTest(contextA);
      await resetCloudConnectionForIsolatedTest(contextA);

      // ── Profile A：连接同步 → 清理无凭据脏源 → 云端基线 ───────────────
      const cloudPageA = await openCloudSettings(contextA, extensionId);
      await connectAndSync(cloudPageA, `Tomb E2E A ${Date.now()}`);
      await expect(cloudPageA.getByText('已登录', { exact: true }).first()).toBeVisible();

      const embyPageA = await openEmbySettings(contextA, extensionId);

      // 基线自愈：清理测试云遗留的无凭据脏源（历史 e2e 产物，会阻断整页保存）。
      // 用产品自身的删除 + tombstone 机制完成，幂等：已清理则无操作。
      const preCleanupServers = await readLocalEmbyServers(embyPageA);
      const dirtyIndexes = preCleanupServers
        .map((srv, index) => (srv.hasCredential ? -1 : index))
        .filter((index) => index >= 0)
        .sort((a, b) => b - a);
      for (const index of dirtyIndexes) {
        const dirty = preServersAt(preCleanupServers, index);
        test.info().annotations.push({
          type: 'baseline-cleanup',
          description: `removed dirty legacy source id=${dirty.id} url=${dirty.url}`,
        });
        await removeEmbyServerByIndex(embyPageA, index);
      }
      if (dirtyIndexes.length > 0) {
        await syncFromSummary(cloudPageA);
      }

      const baseline = await fetchCloudEmbyState();
      const baselineIds = serverIdSet(baseline.mediaServers);
      const baselineTombstones = new Set(baseline.deletedServerIds);
      test.info().annotations.push({
        type: 'cloud-baseline',
        description: `servers=${baselineIds.size} tombstones=${baselineTombstones.size}`,
      });

      // ── A 添加源 → 同步 → 云端多 1 条，tombstone 不变 ─────────────────
      await addEmbyServer(embyPageA, SERVER_NAME_A);
      const addedServersA = await readLocalEmbyServers(embyPageA);
      const serverA = addedServersA.find((s) => s.name === SERVER_NAME_A);
      expect(serverA?.id, 'A 新建源应有新 id').toBeTruthy();

      await syncFromSummary(cloudPageA);
      const afterAddA = await fetchCloudEmbyState();
      expect(serverIdSet(afterAddA.mediaServers)).toEqual(new Set([...baselineIds, serverA!.id]));
      expect(new Set(afterAddA.deletedServerIds)).toEqual(baselineTombstones);

      // ── A 删除该源 → 同步 → 云端回到基线，tombstone 记录该 id ─────────
      await removeEmbyServer(embyPageA, SERVER_NAME_A);
      await syncFromSummary(cloudPageA);
      const afterDeleteA = await fetchCloudEmbyState();
      expect(serverIdSet(afterDeleteA.mediaServers)).toEqual(baselineIds);
      expect(afterDeleteA.deletedServerIds).toContain(serverA!.id);

      // ── Profile B（全新）：同步后不得复活 A 已删源 ─────────────────────
      contextB = await launchExtensionContext(resolveHarnessOptions(profileB), {
        headless: false,
        channel: 'chromium',
      });
      const extensionIdB = await readExtensionId(contextB);
      expect(extensionIdB).toBe(extensionId);
      await suppressReleaseAnnouncementForTest(contextB);
      await resetCloudConnectionForIsolatedTest(contextB);
      const cloudPageB = await openCloudSettings(contextB, extensionIdB);
      await connectAndSync(cloudPageB, `Tomb E2E B ${Date.now()}`);
      await expect(cloudPageB.getByText('已登录', { exact: true }).first()).toBeVisible();

      const embyPageB = await openEmbySettings(contextB, extensionIdB);
      const serversBInitial = await readLocalEmbyServers(embyPageB);
      expect(
        serversBInitial.some((s) => s.name === SERVER_NAME_A || s.id === serverA!.id),
        'B 不应看到 A 已删除的源',
      ).toBe(false);
      expect(serverIdSet(serversBInitial)).toEqual(baselineIds);

      // ── B 重加（新 id）→ 同步 → 云端多 1 条，旧 tombstone 保留 ─────────
      await addEmbyServer(embyPageB, SERVER_NAME_B);
      const addedServersB = await readLocalEmbyServers(embyPageB);
      const serverB = addedServersB.find((s) => s.name === SERVER_NAME_B);
      expect(serverB?.id, 'B 新建源应有新 id').toBeTruthy();
      expect(serverB!.id).not.toBe(serverA!.id);

      await syncFromSummary(cloudPageB);
      const afterAddB = await fetchCloudEmbyState();
      expect(serverIdSet(afterAddB.mediaServers)).toEqual(new Set([...baselineIds, serverB!.id]));
      expect(afterAddB.deletedServerIds).toContain(serverA!.id);

      // ── B 删除 → 同步 → 云端回到基线，双 tombstone ────────────────────
      await removeEmbyServer(embyPageB, SERVER_NAME_B);
      await syncFromSummary(cloudPageB);
      const finalState = await fetchCloudEmbyState();

      // 终态审计：legacy 源无损；tombstone 只增不删
      expect(serverIdSet(finalState.mediaServers)).toEqual(baselineIds);
      const finalTombstones = new Set(finalState.deletedServerIds);
      for (const id of baselineTombstones) expect(finalTombstones.has(id)).toBe(true);
      expect(finalTombstones.has(serverA!.id)).toBe(true);
      expect(finalTombstones.has(serverB!.id)).toBe(true);
    } finally {
      await contextB?.close();
      await contextA.close();
    }
  });
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

async function dismissReleaseAnnouncementIfPresent(page: Page): Promise<void> {
  const modal = page.locator('#jdb-release-announcement-modal');
  const closeButton = modal.locator('[data-action="release-announcement-close"]');
  await modal.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
  if (!(await closeButton.isVisible().catch(() => false))) return;
  await closeButton.click();
  await modal.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
}

// ── Emby 源 UI 操作 ───────────────────────────────────────────────────────

async function addEmbyServer(page: Page, name: string): Promise<void> {
  await page.locator('#add-emby-media-server').click();
  await page.locator('#emby-create-server-name').fill(name);
  await page.locator('#emby-create-server-url').fill(embyTestUrl);
  await page.locator('#emby-create-server-api-key').fill('e2e-tombstone-key');
  await page.locator('.create-emby-media-server-confirm').click();
  // 立即持久化成功信号（persistEmbyForm → toast）
  await expect(page.getByText('设置已保存')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.emby-media-server-summary', { hasText: name }).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function removeEmbyServer(page: Page, name: string): Promise<void> {
  const row = page.locator('.emby-media-server-summary', { hasText: name }).first();
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认删除媒体服务器' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('媒体服务器来源已删除')).toBeVisible({ timeout: 30_000 });
}

/** 按列表下标删除（删除后行序前移，批量删除须从大下标往小下标） */
async function removeEmbyServerByIndex(page: Page, index: number): Promise<void> {
  const row = page.locator(`.emby-media-server-summary[data-index="${index}"]`);
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认删除媒体服务器' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('媒体服务器来源已删除')).toBeVisible({ timeout: 30_000 });
}

type LocalEmbyServer = {
  id: string;
  name: string;
  url: string;
  /** 是否具备至少一种凭据（API Key / 访问令牌 / 用户名+密码），与保存校验同口径 */
  hasCredential: boolean;
};

async function readLocalEmbyServers(page: Page): Promise<LocalEmbyServer[]> {
  return page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const servers = settings?.emby?.mediaServers;
    if (!Array.isArray(servers)) return [];
    return servers.map((s: any) => ({
      id: String(s?.id || ''),
      name: String(s?.name || ''),
      url: String(s?.url || ''),
      hasCredential: Boolean(
        String(s?.apiKey || '').trim() ||
          String(s?.accessToken || '').trim() ||
          (String(s?.username || '').trim() && String(s?.password || '').trim()),
      ),
    }));
  });
}

function preServersAt(servers: LocalEmbyServer[], index: number): LocalEmbyServer {
  return servers[index];
}

// ── 云端 ground truth（login + pull，移植 /tmp/cloud-check.py）────────────

interface CloudEmbyState {
  mediaServers: Array<{ id?: string; name?: string }>;
  deletedServerIds: string[];
}

async function fetchCloudEmbyState(): Promise<CloudEmbyState> {
  const loginRes = await fetch(`${cloudBaseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: cloudUser,
      password: cloudPassword,
      device: {
        id: 'tombstone-e2e-probe',
        label: 'tombstone-e2e',
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
    changes?: Array<{ type?: string; id?: string; payload?: unknown }>;
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
    };
  }
  throw new Error('cloud pull: settings storage_item not found');
}

function serverIdSet(servers: Array<{ id?: string }>): Set<string> {
  return new Set(
    servers
      .map((s) => String(s.id || '').trim())
      .filter(Boolean),
  );
}
