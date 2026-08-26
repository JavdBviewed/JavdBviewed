/**
 * @file extensionHarness.ts
 * @description Playwright 拓展测试的 Chrome 数据快照、构建目录与 Chromium 启动封装
 * @module scripts
 */
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Dirent } from 'node:fs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SNAPSHOT_REFRESH_DAYS = 10;
const TEST_PROFILE_MARKER = '.javdb-extension-test-profile.json';
const FILE_SYSTEM_RETRY_OPTIONS = { attempts: 8, delayMs: 250 } as const;
const RELEASE_ANNOUNCEMENT_STATE_KEY = 'release_announcement_state';
const RELEASE_ANNOUNCEMENT_POLL_INTERVAL_MS = 100;
const RELEASE_ANNOUNCEMENT_SUPPRESSION_TIMEOUT_MS = 5_000;

export interface ChromeDataSnapshotSettings {
  sourceUserDataDir: string;
  sourceProfile?: string;
  snapshotDir: string;
  metadataPath: string;
  refreshDays: number;
}

export type ChromeDataSnapshotConfig =
  | ({ enabled: true } & ChromeDataSnapshotSettings)
  | { enabled: false };

export interface ChromeSnapshotMetadata {
  version: 1;
  copiedAt: number;
  sourceUserDataDir: string;
  sourceProfile: string;
  refreshDays: number;
}

export interface ChromeSnapshotResult {
  refreshed: boolean;
  metadata: ChromeSnapshotMetadata;
}

export interface ExtensionHarnessOptions {
  extensionDir: string;
  userDataDir: string;
  startupUrl?: string;
  chromeDataSnapshot: ChromeDataSnapshotConfig;
}

export interface LaunchExtensionContextOptions {
  channel?: string;
  headless?: boolean;
  slowMo?: number;
}

export interface PrepareChromeTestProfileOptions {
  snapshotDir: string;
  destinationUserDataDir: string;
  sourceUserDataDir: string;
  sourceProfile: string;
  /** 仅用于需要单扩展基线的性能测试；不影响真实 Chrome 数据。 */
  allowedExtensionIds?: readonly string[];
}

export function defaultExtensionProfileDir(cwd: string): string {
  return path.resolve(cwd, '.test-profiles', 'extension-chromium');
}

export function resolveExtensionHarnessOptions(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ExtensionHarnessOptions {
  const extensionDir = path.resolve(cwd, env.JAVDB_EXTENSION_DIST ?? 'dist');
  const userDataDir = path.resolve(cwd, env.JAVDB_EXTENSION_PROFILE ?? defaultExtensionProfileDir(cwd));
  const startupUrl = env.JAVDB_EXTENSION_URL;
  const useChromeData = !['0', 'false', 'no'].includes(
    (env.JAVDB_EXTENSION_USE_CHROME_DATA ?? '').trim().toLowerCase(),
  );
  const chromeDataSnapshot: ChromeDataSnapshotConfig = useChromeData
    ? {
        enabled: true,
        sourceUserDataDir: resolveConfiguredPath(
          cwd,
          env.JAVDB_CHROME_USER_DATA
            ?? path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data'),
        ),
        ...(env.JAVDB_CHROME_PROFILE?.trim()
          ? { sourceProfile: env.JAVDB_CHROME_PROFILE.trim() }
          : {}),
        snapshotDir: resolveConfiguredPath(
          cwd,
          env.JAVDB_CHROME_SNAPSHOT ?? path.join('.test-profiles', 'chrome-source-snapshot'),
        ),
        metadataPath: resolveConfiguredPath(
          cwd,
          env.JAVDB_CHROME_SNAPSHOT_METADATA
            ?? path.join('.test-profiles', 'chrome-source-snapshot.meta.json'),
        ),
        refreshDays: DEFAULT_SNAPSHOT_REFRESH_DAYS,
      }
    : { enabled: false };

  return {
    extensionDir,
    userDataDir,
    ...(startupUrl ? { startupUrl } : {}),
    chromeDataSnapshot,
  };
}

export function createChromiumExtensionArgs(extensionDir: string): string[] {
  return [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`];
}

export async function assertExtensionBuildDirectory(extensionDir: string): Promise<void> {
  const manifestPath = path.join(extensionDir, 'manifest.json');

  try {
    await fs.access(manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `未找到已构建拓展 manifest：${manifestPath}\n请先运行 pnpm run build:extension。原始错误：${message}`,
    );
  }
}

export function shouldRefreshChromeSnapshot(
  metadata: ChromeSnapshotMetadata | undefined,
  input: {
    sourceUserDataDir: string;
    sourceProfile: string;
    refreshDays: number;
    now: number;
  },
): boolean {
  if (!metadata) {
    return true;
  }

  const sourceChanged = normalizePathForComparison(metadata.sourceUserDataDir)
    !== normalizePathForComparison(input.sourceUserDataDir);
  const profileChanged = metadata.sourceProfile !== input.sourceProfile;
  const refreshWindowChanged = metadata.refreshDays !== input.refreshDays;
  const age = input.now - metadata.copiedAt;

  return sourceChanged
    || profileChanged
    || refreshWindowChanged
    || age < 0
    || age > input.refreshDays * DAY_MS;
}

export function shouldCopyChromeProfilePath(relativePath: string): boolean {
  const segments = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const baseName = segments.at(-1) ?? '';
  const excludedDirectories = new Set([
    'cache',
    'code cache',
    'gpucache',
    'dawncache',
    'dawnwebgpucache',
    'graphitedawncache',
    'grshadercache',
    'shadercache',
    'media cache',
    'crashpad',
    'component_crx_cache',
    'extensions_crx_cache',
    'service worker',
    'sessions',
  ]);

  if (
    baseName === 'lock'
    || baseName.startsWith('singleton')
    || ['current session', 'current tabs', 'last session', 'last tabs'].includes(baseName)
  ) {
    return false;
  }

  return !segments.some((segment) => excludedDirectories.has(segment));
}

const EXTENSION_PROFILE_DIRECTORIES = [
  'Extensions',
  'Local Extension Settings',
  'Sync Extension Settings',
  'Extension State',
] as const;

function normalizedExtensionIds(extensionIds: readonly string[]): Set<string> {
  return new Set(extensionIds
    .map((extensionId) => extensionId.trim().toLowerCase())
    .filter((extensionId) => /^[a-p]{32}$/.test(extensionId)));
}

export function shouldKeepChromeExtensionStateDirectory(
  directoryName: string,
  allowedExtensionIds: readonly string[],
): boolean {
  const normalizedName = directoryName.trim().toLowerCase();
  const allowedIds = normalizedExtensionIds(allowedExtensionIds);
  if (allowedIds.has(normalizedName)) return true;

  // IndexedDB uses names such as chrome-extension_<id>_0.indexeddb.leveldb.
  const indexedDbMatch = normalizedName.match(/^chrome-extension_([a-p]{32})(?:_|\.|$)/);
  if (indexedDbMatch) return allowedIds.has(indexedDbMatch[1]);

  return !/^[a-p]{32}$/.test(normalizedName);
}

/**
 * 从隔离测试 profile 中移除其他扩展的专属状态，避免宿主扩展污染性能样本。
 * 只接收测试副本路径；调用方不得传入真实 Chrome User Data。
 */
export async function sanitizeChromeTestProfileExtensions(
  profileDir: string,
  allowedExtensionIds: readonly string[],
): Promise<void> {
  const allowedIds = normalizedExtensionIds(allowedExtensionIds);
  if (allowedIds.size === 0) {
    throw new Error('性能测试必须提供至少一个有效的目标扩展 ID');
  }

  for (const directoryName of EXTENSION_PROFILE_DIRECTORIES) {
    const directory = path.join(profileDir, directoryName);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw error;
    }
    await Promise.all(entries
      .filter((entry) => entry.isDirectory()
        && !shouldKeepChromeExtensionStateDirectory(entry.name, [...allowedIds]))
      .map((entry) => fs.rm(path.join(directory, entry.name), { recursive: true, force: true })));
  }

  const indexedDbDirectory = path.join(profileDir, 'IndexedDB');
  let indexedDbEntries: Dirent[];
  try {
    indexedDbEntries = await fs.readdir(indexedDbDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      indexedDbEntries = [];
    } else {
      throw error;
    }
  }
  await Promise.all(indexedDbEntries
    .filter((entry) => entry.isDirectory()
      && entry.name.toLowerCase().startsWith('chrome-extension_')
      && !shouldKeepChromeExtensionStateDirectory(entry.name, [...allowedIds]))
    .map((entry) => fs.rm(path.join(indexedDbDirectory, entry.name), { recursive: true, force: true })));

  await retainChromeExtensionPreferences(
    path.join(profileDir, 'Preferences'),
    ['extensions', 'settings'],
    allowedIds,
  );
  await retainChromeExtensionPreferences(
    path.join(profileDir, 'Secure Preferences'),
    ['protection', 'macs', 'extensions', 'settings'],
    allowedIds,
  );
}

async function retainChromeExtensionPreferences(
  filePath: string,
  propertyPath: readonly string[],
  allowedExtensionIds: Set<string>,
): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`测试 profile 的 Chrome 偏好设置损坏：${filePath}。${formatError(error)}`);
  }

  let current: unknown = parsed;
  for (const property of propertyPath) {
    if (!isRecord(current) || !isRecord(current[property])) return;
    current = current[property];
  }
  if (!isRecord(current)) return;
  for (const extensionId of Object.keys(current)) {
    if (!allowedExtensionIds.has(extensionId.toLowerCase())) delete current[extensionId];
  }
  await fs.writeFile(filePath, JSON.stringify(parsed), 'utf8');
}

export async function readChromeSnapshotMetadata(
  metadataPath: string,
): Promise<ChromeSnapshotMetadata | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(metadataPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`无法读取 Chrome 测试数据复制记录：${metadataPath}。${formatError(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Chrome 测试数据复制记录已损坏：${metadataPath}。${formatError(error)}`);
  }

  if (!isChromeSnapshotMetadata(value)) {
    throw new Error(`Chrome 测试数据复制记录格式无效：${metadataPath}`);
  }

  return value;
}

export async function ensureChromeDataSnapshot(
  options: ChromeDataSnapshotSettings,
  now = Date.now(),
): Promise<ChromeSnapshotResult> {
  if (!Number.isFinite(options.refreshDays) || options.refreshDays <= 0) {
    throw new Error(`Chrome 测试数据刷新天数无效：${options.refreshDays}`);
  }

  const sourceUserDataDir = path.resolve(options.sourceUserDataDir);
  const localStatePath = path.join(sourceUserDataDir, 'Local State');
  const sourceProfile = options.sourceProfile?.trim() || await readLastUsedChromeProfile(localStatePath);
  const sourceProfileDir = path.join(sourceUserDataDir, sourceProfile);
  await assertDirectory(sourceUserDataDir, 'Chrome User Data 源目录');
  await assertDirectory(sourceProfileDir, `Chrome profile（${sourceProfile}）`);
  await assertFile(localStatePath, 'Chrome Local State');

  const metadata = await readChromeSnapshotMetadata(options.metadataPath);
  const snapshotReady = await pathExists(path.join(options.snapshotDir, 'Local State'))
    && await pathExists(path.join(options.snapshotDir, sourceProfile));
  const shouldRefresh = !snapshotReady || shouldRefreshChromeSnapshot(metadata, {
    sourceUserDataDir,
    sourceProfile,
    refreshDays: options.refreshDays,
    now,
  });

  if (!shouldRefresh && metadata) {
    return { refreshed: false, metadata };
  }

  const nextMetadata: ChromeSnapshotMetadata = {
    version: 1,
    copiedAt: now,
    sourceUserDataDir,
    sourceProfile,
    refreshDays: options.refreshDays,
  };

  await rebuildChromeSnapshot({
    sourceUserDataDir,
    sourceProfile,
    snapshotDir: path.resolve(options.snapshotDir),
    localStatePath,
  });
  await writeChromeSnapshotMetadata(options.metadataPath, nextMetadata);

  return { refreshed: true, metadata: nextMetadata };
}

export async function prepareChromeTestProfile(
  options: PrepareChromeTestProfileOptions,
): Promise<void> {
  const snapshotDir = path.resolve(options.snapshotDir);
  const destinationUserDataDir = path.resolve(options.destinationUserDataDir);
  const sourceUserDataDir = path.resolve(options.sourceUserDataDir);

  assertSafeTestProfileDestination({
    destinationUserDataDir,
    snapshotDir,
    sourceUserDataDir,
  });
  await assertDirectory(path.join(snapshotDir, options.sourceProfile), 'Chrome 测试数据基线 profile');
  await assertFile(path.join(snapshotDir, 'Local State'), 'Chrome 测试数据基线 Local State');
  await replaceDirectoryFromSource(snapshotDir, destinationUserDataDir);
  const serviceWorkerStateDir = path.resolve(
    destinationUserDataDir,
    options.sourceProfile,
    'Service Worker',
  );
  if (!isSameOrInside(serviceWorkerStateDir, destinationUserDataDir)) {
    throw new Error(`拒绝清理测试 profile 之外的 Service Worker 状态：${serviceWorkerStateDir}`);
  }
  await fs.rm(serviceWorkerStateDir, { recursive: true, force: true });
  if (options.allowedExtensionIds) {
    await sanitizeChromeTestProfileExtensions(
      path.join(destinationUserDataDir, options.sourceProfile),
      options.allowedExtensionIds,
    );
  }
  await fs.writeFile(path.join(destinationUserDataDir, TEST_PROFILE_MARKER), JSON.stringify({
    sourceProfile: options.sourceProfile,
    preparedAt: Date.now(),
  }, null, 2), 'utf8');
}

export async function retryTransientFileSystemOperation<T>(
  operation: () => Promise<T>,
  options: { attempts: number; delayMs: number } = FILE_SYSTEM_RETRY_OPTIONS,
): Promise<T> {
  const attempts = Math.max(1, Math.trunc(options.attempts));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isTransientFileSystemError(error)) {
        throw error;
      }
      if (options.delayMs > 0) {
        await delay(options.delayMs);
      }
    }
  }
  throw new Error('文件系统操作重试状态异常');
}

export async function launchExtensionContext(
  harnessOptions: ExtensionHarnessOptions,
  launchOptions: LaunchExtensionContextOptions = {},
): Promise<BrowserContext> {
  await assertExtensionBuildDirectory(harnessOptions.extensionDir);
  const args = createChromiumExtensionArgs(harnessOptions.extensionDir);

  if (harnessOptions.chromeDataSnapshot.enabled) {
    const snapshot = await ensureChromeDataSnapshot(harnessOptions.chromeDataSnapshot);
    await prepareChromeTestProfile({
      snapshotDir: harnessOptions.chromeDataSnapshot.snapshotDir,
      destinationUserDataDir: harnessOptions.userDataDir,
      sourceUserDataDir: snapshot.metadata.sourceUserDataDir,
      sourceProfile: snapshot.metadata.sourceProfile,
    });
    args.push(`--profile-directory=${snapshot.metadata.sourceProfile}`);
    console.info(
      `[E2E] Chrome 数据基线：${new Date(snapshot.metadata.copiedAt).toISOString()}`
      + `（${snapshot.refreshed ? '本次已刷新' : '10 天内复用'}，profile=${snapshot.metadata.sourceProfile}）`,
    );
  }

  return chromium.launchPersistentContext(harnessOptions.userDataDir, {
    channel: launchOptions.channel ?? 'chromium',
    headless: launchOptions.headless ?? false,
    slowMo: launchOptions.slowMo,
    args,
  });
}

export async function readExtensionId(context: BrowserContext, timeoutMs = 15_000): Promise<string> {
  const existingWorker = context.serviceWorkers().find((worker) => isExtensionWorker(worker));
  const worker = existingWorker ?? (await context.waitForEvent('serviceworker', { timeout: timeoutMs }));
  const url = new URL(worker.url());

  if (url.protocol !== 'chrome-extension:' || url.hostname.length === 0) {
    throw new Error(`无法从 service worker URL 解析拓展 ID：${worker.url()}`);
  }

  return url.hostname;
}

/**
 * 等待扩展安装事件落盘后，再标记公告已读，避免测试启动竞态把标记覆盖掉。
 */
export async function suppressReleaseAnnouncementForTest(
  context: BrowserContext,
  timeoutMs = RELEASE_ANNOUNCEMENT_SUPPRESSION_TIMEOUT_MS,
): Promise<void> {
  const worker = context.serviceWorkers().find((candidate) => isExtensionWorker(candidate))
    ?? await context.waitForEvent('serviceworker', { timeout: timeoutMs });
  const announcementKey = await worker.evaluate(() => chrome.runtime.getManifest?.().version || 'release-announcement-current');
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  const stateWaitDeadline = Math.min(deadline, Date.now() + 2_000);

  let state = await readReleaseAnnouncementStateFromWorker(worker);
  while (!hasReleaseAnnouncementState(state) && Date.now() < stateWaitDeadline) {
    await delay(RELEASE_ANNOUNCEMENT_POLL_INTERVAL_MS);
    state = await readReleaseAnnouncementStateFromWorker(worker);
  }

  while (Date.now() < deadline) {
    await worker.evaluate(({ storageKey, announcementKey: key }) => chrome.storage.local.set({
      [storageKey]: {
        lastSeenAnnouncementKey: key,
        lastSeenAt: Date.now(),
      },
    }), {
      storageKey: RELEASE_ANNOUNCEMENT_STATE_KEY,
      announcementKey,
    });

    const nextState = await readReleaseAnnouncementStateFromWorker(worker);
    if (nextState?.lastSeenAnnouncementKey === announcementKey && !nextState.pending) {
      return;
    }
    await delay(RELEASE_ANNOUNCEMENT_POLL_INTERVAL_MS);
  }

  throw new Error('测试启动器无法稳定隐藏版本公告：安装事件可能仍在覆盖公告状态。');
}

async function readReleaseAnnouncementStateFromWorker(worker: Worker): Promise<{
  pending?: unknown;
  lastSeenAnnouncementKey?: unknown;
} | undefined> {
  const state = await worker.evaluate(async (key) => {
    const result = await chrome.storage.local.get(key);
    return result?.[key];
  }, RELEASE_ANNOUNCEMENT_STATE_KEY);
  return state as {
    pending?: unknown;
    lastSeenAnnouncementKey?: unknown;
  } | undefined;
}

function hasReleaseAnnouncementState(state: {
  pending?: unknown;
  lastSeenAnnouncementKey?: unknown;
} | undefined): boolean {
  return Boolean(state?.pending || state?.lastSeenAnnouncementKey);
}

export function extensionPageUrl(extensionId: string, pagePath: string): string {
  const normalizedPath = pagePath.replace(/^\/+/, '');
  return `chrome-extension://${extensionId}/${normalizedPath}`;
}

/**
 * 通过 service worker（扩展自身运行上下文）写入 chrome.storage.local，
 * 用于测试前置准备（如预先开启某个功能开关）。
 * 相比在 dashboard 页内 evaluate，worker 写入与页面读取共享同一
 * extension storage 分区，干净 profile 下也能稳定生效。
 */
export async function seedExtensionStorage(
  context: BrowserContext,
  storage: Record<string, unknown>,
): Promise<void> {
  const worker = context.serviceWorkers().find((candidate) => isExtensionWorker(candidate))
    ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await worker.evaluate((data) => chrome.storage.local.set(data), storage);
}

async function rebuildChromeSnapshot(input: {
  sourceUserDataDir: string;
  sourceProfile: string;
  snapshotDir: string;
  localStatePath: string;
}): Promise<void> {
  const stageDir = createSiblingTemporaryPath(input.snapshotDir, 'stage');
  const backupDir = createSiblingTemporaryPath(input.snapshotDir, 'backup');
  await fs.mkdir(path.dirname(input.snapshotDir), { recursive: true });
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.rm(backupDir, { recursive: true, force: true });

  try {
    await fs.mkdir(stageDir, { recursive: true });
    await fs.copyFile(input.localStatePath, path.join(stageDir, 'Local State'));
    const sourceProfileDir = path.join(input.sourceUserDataDir, input.sourceProfile);
    const stageProfileDir = path.join(stageDir, input.sourceProfile);
    await fs.cp(sourceProfileDir, stageProfileDir, {
      recursive: true,
      force: true,
      filter: (sourcePath) => {
        const relativePath = path.relative(input.sourceUserDataDir, sourcePath);
        return relativePath.length === 0 || shouldCopyChromeProfilePath(relativePath);
      },
    });
    await replaceDirectoryWithStage(stageDir, input.snapshotDir, backupDir);
  } catch (error) {
    await restoreDirectoryAfterFailure(input.snapshotDir, backupDir);
    await fs.rm(stageDir, { recursive: true, force: true });
    throw new Error(
      `复制 Chrome 测试数据失败：${input.sourceUserDataDir}（profile=${input.sourceProfile}）。`
      + `请关闭正在写入该 profile 的 Chrome 窗口后重试。${formatError(error)}`,
    );
  }
}

async function replaceDirectoryFromSource(sourceDir: string, destinationDir: string): Promise<void> {
  const stageDir = createSiblingTemporaryPath(destinationDir, 'stage');
  const backupDir = createSiblingTemporaryPath(destinationDir, 'backup');
  await fs.mkdir(path.dirname(destinationDir), { recursive: true });
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.rm(backupDir, { recursive: true, force: true });

  try {
    await fs.cp(sourceDir, stageDir, { recursive: true, force: true });
    await replaceDirectoryWithStage(stageDir, destinationDir, backupDir);
  } catch (error) {
    await restoreDirectoryAfterFailure(destinationDir, backupDir);
    await fs.rm(stageDir, { recursive: true, force: true });
    throw new Error(`准备隔离测试 profile 失败：${destinationDir}。${formatError(error)}`);
  }
}

async function replaceDirectoryWithStage(
  stageDir: string,
  destinationDir: string,
  backupDir: string,
): Promise<void> {
  if (await pathExists(destinationDir)) {
    await retryTransientFileSystemOperation(() => fs.rename(destinationDir, backupDir));
  }
  await retryTransientFileSystemOperation(() => fs.rename(stageDir, destinationDir));
  await retryTransientFileSystemOperation(() => fs.rm(backupDir, { recursive: true, force: true }));
}

async function restoreDirectoryAfterFailure(destinationDir: string, backupDir: string): Promise<void> {
  if (!await pathExists(backupDir)) {
    return;
  }
  if (await pathExists(destinationDir)) {
    await retryTransientFileSystemOperation(() => fs.rm(destinationDir, { recursive: true, force: true }));
  }
  await retryTransientFileSystemOperation(() => fs.rename(backupDir, destinationDir));
}

async function writeChromeSnapshotMetadata(
  metadataPath: string,
  metadata: ChromeSnapshotMetadata,
): Promise<void> {
  const resolvedPath = path.resolve(metadataPath);
  const temporaryPath = `${resolvedPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify(metadata, null, 2), 'utf8');
  await fs.rm(resolvedPath, { force: true });
  await fs.rename(temporaryPath, resolvedPath);
}

async function readLastUsedChromeProfile(localStatePath: string): Promise<string> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(localStatePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法解析 Chrome Local State：${localStatePath}。${formatError(error)}`);
  }

  const profile = isRecord(value) && isRecord(value.profile) ? value.profile.last_used : undefined;
  if (typeof profile !== 'string' || profile.trim().length === 0) {
    throw new Error(`Chrome Local State 未记录最近使用的 profile：${localStatePath}`);
  }
  return profile.trim();
}

function assertSafeTestProfileDestination(input: {
  destinationUserDataDir: string;
  snapshotDir: string;
  sourceUserDataDir: string;
}): void {
  const destination = path.resolve(input.destinationUserDataDir);
  const protectedPaths = [path.resolve(input.snapshotDir), path.resolve(input.sourceUserDataDir)];
  if (destination === path.parse(destination).root || destination === path.resolve(os.homedir())) {
    throw new Error(`拒绝使用不安全的测试 profile 目标目录：${destination}`);
  }
  if (protectedPaths.some((protectedPath) => pathsOverlap(destination, protectedPath))) {
    throw new Error(`测试 profile 目标目录不得与真实 Chrome 数据或基线重叠：${destination}`);
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrInside(left, right) || isSameOrInside(right, left);
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createSiblingTemporaryPath(targetPath: string, kind: string): string {
  return `${targetPath}.${kind}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveConfiguredPath(cwd: string, configuredPath: string): string {
  if (path.win32.isAbsolute(configuredPath) && process.platform !== 'win32') {
    const drivePath = configuredPath.match(/^([A-Za-z]):[\\/](.*)$/);
    if (drivePath) {
      return path.resolve(
        `/mnt/${drivePath[1].toLowerCase()}`,
        drivePath[2].replace(/\\/g, '/'),
      );
    }
  }
  return path.isAbsolute(configuredPath) || path.win32.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(cwd, configuredPath);
}

function normalizePathForComparison(input: string): string {
  const normalized = path.resolve(input).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function assertDirectory(directoryPath: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(directoryPath);
    if (!stat.isDirectory()) {
      throw new Error('路径不是目录');
    }
  } catch (error) {
    throw new Error(`${label}不存在或不可读：${directoryPath}。${formatError(error)}`);
  }
}

async function assertFile(filePath: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error('路径不是文件');
    }
  } catch (error) {
    throw new Error(`${label}不存在或不可读：${filePath}。${formatError(error)}`);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isChromeSnapshotMetadata(value: unknown): value is ChromeSnapshotMetadata {
  return isRecord(value)
    && value.version === 1
    && typeof value.copiedAt === 'number'
    && Number.isFinite(value.copiedAt)
    && typeof value.sourceUserDataDir === 'string'
    && value.sourceUserDataDir.length > 0
    && typeof value.sourceProfile === 'string'
    && value.sourceProfile.length > 0
    && typeof value.refreshDays === 'number'
    && Number.isFinite(value.refreshDays)
    && value.refreshDays > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isTransientFileSystemError(error: unknown): boolean {
  return isNodeError(error)
    && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code ?? '');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExtensionWorker(worker: Worker): boolean {
  return worker.url().startsWith('chrome-extension://');
}
