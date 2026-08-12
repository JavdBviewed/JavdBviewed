/**
 * @file runWslPerformanceRegression.ts
 * @description 自动启动隔离 WSL Chrome for Testing 并执行扩展性能回归探针。
 * @module scripts
 */
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateWslPerformanceReport, type WslPerformanceGatePolicy } from './performanceRegressionGate';
import { shouldRunWslCloseRecovery } from './wslCdpPerformanceProbe';
import {
  ensureChromeDataSnapshot,
  prepareChromeTestProfile,
  resolveExtensionHarnessOptions,
  sanitizeChromeTestProfileExtensions,
} from './extensionHarness';
import { buildPerformanceSourceFixtureHtml } from './performanceSourceFixture';

const execFileAsync = promisify(execFile);
const DEFAULT_EXTENSION_ID = 'gnegjfjccmeafanpmbjboegcbchcghka';
// 放在 Windows 挂载盘，避免 WSL 重启清理 /tmp 后重复准备测试浏览器。
const DEFAULT_CFT_PATH = '/mnt/f/JavdBviewed-project/JavdBviewed/.test-tools/chrome-for-testing-151/chrome-linux64/chrome';
const DEFAULT_EXTENSION_DIR = '/mnt/f/JavdBviewed-project/JavdBviewed/dist';
const DEFAULT_TAB_SEQUENCE = 'tab-home,tab-media,tab-records,tab-actors,tab-new-works,tab-settings';

export type WslChromeShellCommandOptions = {
  chromePath: string;
  profileDir: string;
  extensionDir: string;
  port: number;
  logPath: string;
  resetProfile?: boolean;
  blockExternalNetwork?: boolean;
  loadExtension?: boolean;
  disableGpu?: boolean;
};

export type WslChromeProfileOptions = {
  runIndex: number;
  persistentProfileDir?: string;
  now?: number;
};

export type WslChromeProfile = {
  profileDir: string;
  resetProfile: boolean;
};

export function resolveWslChromeProfile(options: WslChromeProfileOptions): WslChromeProfile {
  const persistentProfileDir = options.persistentProfileDir?.trim();
  if (persistentProfileDir) {
    return {
      profileDir: persistentProfileDir,
      resetProfile: false,
    };
  }
  return {
    profileDir: `/tmp/javdb-wsl-regression-${options.now ?? Date.now()}-${options.runIndex}`,
    resetProfile: true,
  };
}

export function shouldReuseWslHostDataProfile(options: {
  persistentProfileDir?: string;
  markerExists: boolean;
  forceRefresh: boolean;
  snapshotRefreshed: boolean;
}): boolean {
  return Boolean(options.persistentProfileDir?.trim())
    && options.markerExists
    && !options.forceRefresh
    && !options.snapshotRefreshed;
}

function shellValue(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildWslChromeShellCommand(options: WslChromeShellCommandOptions): string {
  const profileDir = shellValue(options.profileDir);
  const chromePath = shellValue(options.chromePath);
  const extensionDir = shellValue(options.extensionDir);
  const logPath = shellValue(options.logPath);
  const prepareProfile = options.resetProfile === false ? '' : `rm -rf -- ${profileDir} &&`;
  const loadExtension = options.loadExtension !== false;
  const disableGpu = options.disableGpu !== false;
  const networkIsolationArgs = options.blockExternalNetwork === true
    ? [shellValue('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost')]
    : [];
  const extensionArgs = loadExtension
    ? [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    : ['--disable-extensions'];
  return [
    prepareProfile,
    `exec xvfb-run -a ${chromePath}`,
    '--no-sandbox',
    '--no-first-run',
    ...(disableGpu ? ['--disable-gpu'] : []),
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ...networkIsolationArgs,
    '--remote-debugging-address=0.0.0.0',
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${profileDir}`,
    ...extensionArgs,
    'about:blank',
    `> ${logPath} 2>&1`,
  ].filter(Boolean).join(' ');
}

/**
 * 将宿主数据副本复制到 WSL ext4 临时目录，避免 IndexedDB 随机读取经过 /mnt/f 的 9P/DrvFs。
 * 源目录只读参与复制，Chrome 的测试写入留在临时目录中。
 */
export function buildWslRuntimeProfileStageCommand(sourceDir: string, targetDir: string): string {
  const source = shellValue(sourceDir);
  const target = shellValue(targetDir);
  return `rm -rf -- ${target} && mkdir -p ${target} && cp -a -- ${source}/. ${target}/`;
}

function buildWslRuntimeProfileCleanupCommand(profileDir: string): string {
  return `rm -rf -- ${shellValue(profileDir)}`;
}

export function buildWslSourceFixtureServerCommand(options: {
  directory: string;
  port: number;
}): string {
  const directory = shellValue(options.directory);
  return `exec python3 -m http.server ${Math.max(1, Math.trunc(options.port))} --bind 127.0.0.1 --directory ${directory}`;
}

type WslSourceFixtureServer = {
  url: string;
  port: number;
  stop: () => Promise<void>;
};

async function startWslSourceFixtureServer(options: {
  port: number;
  itemCount: number;
  dynamicItemCount: number;
}): Promise<WslSourceFixtureServer> {
  const filePath = path.resolve('tmp/performance-source-fixture-runtime.html');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buildPerformanceSourceFixtureHtml(options.itemCount, {
    dynamicItemCount: options.dynamicItemCount,
  }), 'utf8');
  const directory = path.dirname(toWslMountedPath(filePath));
  const port = Math.max(1, Math.trunc(options.port));
  const command = buildWslSourceFixtureServerCommand({ directory, port });
  const child = spawn('wsl.exe', ['-e', 'bash', '-lc', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const startedAt = Date.now();
  const url = `http://127.0.0.1:${port}/performance-source-fixture-runtime.html`;
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return {
          url,
          port,
          stop: () => execFileAsync('wsl.exe', [
            '-e', 'bash', '-lc', `pkill -f -- 'http.server ${port}' 2>/dev/null || true`,
          ], { timeout: 5_000, windowsHide: true }).then(() => undefined),
        };
      }
    } catch {
      // WSL server 尚未完成启动，继续等待。
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`无法启动 WSL 性能 fixture server：${url}`);
}

export function buildWslChromeSingletonCleanupCommand(profileDir: string): string {
  const profile = shellValue(profileDir);
  return `rm -f -- ${profile}/SingletonCookie ${profile}/SingletonLock ${profile}/SingletonSocket`;
}

export function buildWslChromeSessionCleanupCommand(
  profileDir: string,
  sourceProfile = 'Default',
): string {
  const profileRoot = `${profileDir}/${sourceProfile}`;
  const artifacts = [
    `${profileRoot}/Sessions`,
    `${profileRoot}/Current Session`,
    `${profileRoot}/Current Tabs`,
    `${profileRoot}/Last Session`,
    `${profileRoot}/Last Tabs`,
  ].map(shellValue);
  return `rm -rf -- ${artifacts.join(' ')}`;
}

export function parseWslRegressionRepeatCount(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 1;
}

export function resolveWslSourceFixtureDynamicItemCount(
  value: string | undefined,
  initialItemCount: number,
): number {
  const fallback = Math.max(0, Math.trunc(initialItemCount * 0.5));
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

export function resolveWslDashboardHash(value: string | undefined): string {
  const normalized = value?.trim().replace(/^#/, '') ?? '';
  return /^tab-[a-z0-9-]+(?:\/[a-z0-9-]+)?$/.test(normalized)
    ? normalized
    : 'tab-home';
}

export function resolveWslProbeDataMode(useHostChromeData: boolean): {
  injectMediaFixture: boolean;
  disableExternalSync: boolean;
  forceCloseRecovery: boolean;
  singlePageIsolation: boolean;
  pageTimeoutMs: number;
} {
  return {
    injectMediaFixture: !useHostChromeData,
    disableExternalSync: useHostChromeData,
    forceCloseRecovery: useHostChromeData,
    singlePageIsolation: useHostChromeData,
    pageTimeoutMs: useHostChromeData ? 30_000 : 10_000,
  };
}

export type WslLifecycleRequirements = {
  requiredLifecycleEvents: string[];
  requiredLifecycleEventGroups: string[][];
};

export type WslLifecycleRequirementOptions = {
  allowPreInitializedTarget?: boolean;
};

/** 初始路由切换到目标 Tab 时可能记录 restore，不能把它误判为缺失 active。 */
export function buildWslLifecycleRequirements(
  sequence: string,
  options: WslLifecycleRequirementOptions = {},
): WslLifecycleRequirements {
  const requiredLifecycleEvents = new Set<string>();
  const requiredLifecycleEventGroups: string[][] = [];
  sequence
    .split(',')
    .map((part) => part.trim().replace(/^#?/, ''))
    .filter((part) => /^tab-[a-z0-9-]+$/.test(part))
    .forEach((tabId) => {
      if (tabId === 'tab-home') return;
      if (!options.allowPreInitializedTarget) {
        requiredLifecycleEvents.add(`${tabId}:initialize`);
      }
      requiredLifecycleEvents.add(`${tabId}:dispose`);
      requiredLifecycleEventGroups.push(options.allowPreInitializedTarget
        ? [`${tabId}:initialize`, `${tabId}:active`, `${tabId}:restore`]
        : [`${tabId}:active`, `${tabId}:restore`]);
    });
  return {
    requiredLifecycleEvents: [...requiredLifecycleEvents],
    requiredLifecycleEventGroups,
  };
}

export function buildWslProbeInvocation(): { file: string; args: string[] } {
  return {
    file: process.env.ComSpec?.trim() || 'cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm.cmd exec tsx scripts/wslCdpPerformanceProbe.ts'],
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function waitForCdp(port: number, timeoutMs = 20_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome 尚未完成启动，继续轮询。
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待 WSL Chrome CDP 超时：${port}`);
}

async function startWslChrome(options: WslChromeShellCommandOptions): Promise<void> {
  const command = buildWslChromeShellCommand(options);
  const child = spawn('wsl.exe', ['-e', 'bash', '-lc', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  await waitForCdp(options.port);
}

async function stopWslChrome(port: number): Promise<void> {
  const command = `pkill -f -- '--remote-debugging-port=${port}' || true`;
  await execFileAsync('wsl.exe', ['-e', 'bash', '-lc', command], {
    timeout: 5_000,
    windowsHide: true,
  }).catch(() => undefined);
}

async function clearWslChromeSingletonLocks(profileDir: string): Promise<void> {
  await execFileAsync('wsl.exe', [
    '-u',
    'root',
    '-e',
    'bash',
    '-lc',
    buildWslChromeSingletonCleanupCommand(profileDir),
  ], {
    timeout: 5_000,
    windowsHide: true,
  });
}

async function clearWslChromeSessionRestoreArtifacts(
  profileDir: string,
  sourceProfile: string,
): Promise<void> {
  await execFileAsync('wsl.exe', [
    '-u',
    'root',
    '-e',
    'bash',
    '-lc',
    buildWslChromeSessionCleanupCommand(profileDir, sourceProfile),
  ], {
    timeout: 30_000,
    windowsHide: true,
  });
}

async function stageWslRuntimeProfile(sourceDir: string, runIndex: number): Promise<string> {
  const targetDir = `/tmp/javdb-wsl-runtime-${Date.now()}-${runIndex}`;
  await execFileAsync('wsl.exe', [
    '-u',
    'root',
    '-e',
    'bash',
    '-lc',
    buildWslRuntimeProfileStageCommand(sourceDir, targetDir),
  ], {
    timeout: 120_000,
    windowsHide: true,
  });
  // 不让宿主挂载盘上的会话恢复文件进入 Chrome；这里只修改 WSL 临时副本。
  await clearWslChromeSessionRestoreArtifacts(targetDir, 'Default');
  return targetDir;
}

async function cleanupWslRuntimeProfile(profileDir: string): Promise<void> {
  await execFileAsync('wsl.exe', [
    '-u',
    'root',
    '-e',
    'bash',
    '-lc',
    buildWslRuntimeProfileCleanupCommand(profileDir),
  ], {
    timeout: 30_000,
    windowsHide: true,
  }).catch(() => undefined);
}

async function findReport(reportDir: string): Promise<string> {
  const entries = await fs.readdir(reportDir, { withFileTypes: true });
  const reports = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => {
      const filePath = path.join(reportDir, entry.name);
      const stat = await fs.stat(filePath);
      return { filePath, modifiedAt: stat.mtimeMs };
    }));
  const latest = reports.sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
  if (!latest) throw new Error(`WSL 性能报告目录为空：${reportDir}`);
  return latest.filePath;
}

async function runProbe(options: {
  port: number;
  profileDir: string;
  reportDir: string;
  sampleMs: number;
  sampleIntervalMs: number;
  dashboardSequence: string;
  mediaItems: number;
  injectMediaFixture: boolean;
  disableExternalSync: boolean;
  forceCloseRecovery: boolean;
  singlePageIsolation: boolean;
  pageTimeoutMs: number;
  requireExtension: boolean;
  sourceUrl?: string;
}): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    JAVDB_WSL_CDP_PORT: String(options.port),
    JAVDB_WSL_USER_DATA_DIR: options.profileDir,
    JAVDB_WSL_EXTENSION_ID: process.env.JAVDB_WSL_EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID,
    JAVDB_WSL_REQUIRE_EXTENSION: options.requireExtension ? '1' : '0',
    JAVDB_WSL_DASHBOARD_HASH: resolveWslDashboardHash(process.env.JAVDB_WSL_DASHBOARD_HASH),
    JAVDB_WSL_HOME_CHARTS: process.env.JAVDB_WSL_HOME_CHARTS?.trim() || '',
    JAVDB_WSL_DASHBOARD_TAB_SEQUENCE: options.dashboardSequence,
    JAVDB_WSL_DASHBOARD_TAB_LOOPS: process.env.JAVDB_WSL_REGRESSION_TAB_LOOPS?.trim() || '1',
    JAVDB_WSL_INJECT_MEDIA_FIXTURE: options.injectMediaFixture ? '1' : '0',
    JAVDB_WSL_MEDIA_ITEMS: String(options.mediaItems),
    JAVDB_WSL_SAMPLE_MS: String(options.sampleMs),
    JAVDB_WSL_SAMPLE_INTERVAL_MS: String(options.sampleIntervalMs),
    JAVDB_WSL_RUN_CLOSE_RECOVERY: process.env.JAVDB_WSL_RUN_CLOSE_RECOVERY?.trim() || '1',
    JAVDB_WSL_FORCE_CLOSE_RECOVERY: options.forceCloseRecovery ? '1' : '0',
    JAVDB_WSL_DISABLE_EXTERNAL_SYNC: options.disableExternalSync ? '1' : '0',
    JAVDB_WSL_CLEAR_CLOUD_PENDING: shouldClearWslCloudPending(
      process.env.JAVDB_WSL_CLEAR_CLOUD_PENDING,
    ) ? '1' : '0',
    JAVDB_WSL_SINGLE_PAGE_ISOLATION: options.singlePageIsolation ? '1' : '0',
    JAVDB_WSL_PAGE_TIMEOUT_MS: String(options.pageTimeoutMs),
    JAVDB_WSL_REPORT_DIR: options.reportDir,
    ...(process.env.JAVDB_WSL_CPU_PROFILE ? { JAVDB_WSL_CPU_PROFILE: process.env.JAVDB_WSL_CPU_PROFILE } : {}),
    ...(process.env.JAVDB_WSL_CPU_PROFILE_MS ? { JAVDB_WSL_CPU_PROFILE_MS: process.env.JAVDB_WSL_CPU_PROFILE_MS } : {}),
    ...(process.env.JAVDB_WSL_CPU_PROFILE_DELAY_MS ? { JAVDB_WSL_CPU_PROFILE_DELAY_MS: process.env.JAVDB_WSL_CPU_PROFILE_DELAY_MS } : {}),
    ...(options.sourceUrl ? { JAVDB_WSL_SOURCE_URL: options.sourceUrl } : {}),
  };
  const invocation = buildWslProbeInvocation();
  const { stdout, stderr } = await execFileAsync(
    invocation.file,
    invocation.args,
    { cwd: process.cwd(), env, maxBuffer: 2_000_000, windowsHide: true },
  );
  if (stderr.trim()) process.stderr.write(stderr);
  if (stdout.trim()) process.stdout.write(stdout);
  return findReport(options.reportDir);
}

function isEnabledEnvValue(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

export function shouldClearWslCloudPending(value: string | undefined): boolean {
  return isEnabledEnvValue(value);
}

function toWslMountedPath(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return normalized;
  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}

function resolveLocalWslProfilePath(value: string): string {
  const mountedPath = value.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (mountedPath) {
    return path.resolve(`${mountedPath[1].toUpperCase()}:\\${mountedPath[2].replace(/\//g, '\\')}`);
  }
  return path.resolve(process.cwd(), value);
}

async function prepareWslHostDataProfile(options: {
  persistentProfileDir?: string;
  forceRefresh: boolean;
  clearSessionArtifacts?: boolean;
}): Promise<string> {
  const harnessOptions = resolveExtensionHarnessOptions(process.env, process.cwd());
  if (!harnessOptions.chromeDataSnapshot.enabled) {
    throw new Error('WSL 宿主 Chrome 数据模式需要启用 Chrome 快照，不能降级为空 profile。');
  }
  const snapshot = await ensureChromeDataSnapshot(harnessOptions.chromeDataSnapshot);
  const configuredProfileDir = options.persistentProfileDir?.trim()
    || process.env.JAVDB_WSL_CHROME_DATA_PROFILE?.trim()
    || '.test-profiles/wsl-real-data-profile';
  const destinationUserDataDir = resolveLocalWslProfilePath(configuredProfileDir);
  const markerPath = path.join(destinationUserDataDir, '.javdb-extension-test-profile.json');
  let markerExists = false;
  try {
    await fs.access(markerPath);
    markerExists = true;
  } catch {
    markerExists = false;
  }
  const reuse = shouldReuseWslHostDataProfile({
    persistentProfileDir: options.persistentProfileDir,
    markerExists,
    forceRefresh: options.forceRefresh,
    snapshotRefreshed: snapshot.refreshed,
  });
  if (!reuse) {
    await prepareChromeTestProfile({
      snapshotDir: harnessOptions.chromeDataSnapshot.snapshotDir,
      destinationUserDataDir,
      sourceUserDataDir: snapshot.metadata.sourceUserDataDir,
      sourceProfile: snapshot.metadata.sourceProfile,
      allowedExtensionIds: [DEFAULT_EXTENSION_ID],
    });
  } else if (options.clearSessionArtifacts !== false) {
    // runner 通过 pkill 结束 Chrome 时会留下会话恢复文件；清理它们避免旧页面进入新的性能样本。
    await clearWslChromeSessionRestoreArtifacts(
      toWslMountedPath(destinationUserDataDir),
      snapshot.metadata.sourceProfile,
    );
    await sanitizeChromeTestProfileExtensions(
      path.join(destinationUserDataDir, snapshot.metadata.sourceProfile),
      [DEFAULT_EXTENSION_ID],
    );
  }
  console.info(
    `[WSL] 使用宿主 Chrome 隔离快照：${new Date(snapshot.metadata.copiedAt).toISOString()}`
    + `（${reuse ? '复用持久副本' : snapshot.refreshed ? '本次已刷新' : '10 天内复用'}，profile=${snapshot.metadata.sourceProfile}）`,
  );
  return toWslMountedPath(destinationUserDataDir);
}

async function readGatePolicy(options: {
  requireExtensionEvidence: boolean;
  requireEnhancedDiagnostics: boolean;
  requiredLifecycleEvents: readonly string[];
  requiredLifecycleEventGroups: readonly (readonly string[])[];
}): Promise<WslPerformanceGatePolicy> {
  const baselinePath = process.env.JAVDB_WSL_PERF_BASELINE?.trim();
  const policy: WslPerformanceGatePolicy = options.requireEnhancedDiagnostics
    ? {
      requireExtensionRuntime: options.requireExtensionEvidence,
      requireExtensionPage: options.requireExtensionEvidence,
      requireLongTaskMetrics: true,
      requiredLifecycleEvents: options.requiredLifecycleEvents,
      requiredLifecycleEventGroups: options.requiredLifecycleEventGroups,
      requireCooldownRecovery: shouldRunWslCloseRecovery(
        process.env.JAVDB_WSL_RUN_CLOSE_RECOVERY?.trim() || '1',
      ),
    }
    : {
      requireExtensionRuntime: options.requireExtensionEvidence,
      requireExtensionPage: options.requireExtensionEvidence,
    };
  if (!baselinePath) return policy;
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8')) as unknown;
  const report = evaluateWslPerformanceReport(baseline, {});
  if (!report.metrics) throw new Error(`性能基线报告无有效指标：${baselinePath}`);
  return {
    ...policy,
    baseline: report.metrics,
    toleranceRatio: Number(process.env.JAVDB_WSL_PERF_TOLERANCE ?? '0.2'),
  };
}

async function main(): Promise<void> {
  const repeatCount = parseWslRegressionRepeatCount(process.env.JAVDB_WSL_REGRESSION_REPEATS);
  const basePort = parsePositiveInteger(process.env.JAVDB_WSL_REGRESSION_PORT, 9270);
  const rootReportDir = path.resolve(
    process.env.JAVDB_WSL_REGRESSION_REPORT_DIR ?? 'test-results/performance/wsl-regression',
  );
  const chromePath = process.env.JAVDB_WSL_CFT_PATH?.trim() || DEFAULT_CFT_PATH;
  const extensionDir = process.env.JAVDB_WSL_EXTENSION_DIR?.trim() || DEFAULT_EXTENSION_DIR;
  const dashboardSequence = process.env.JAVDB_WSL_REGRESSION_SEQUENCE?.trim() || DEFAULT_TAB_SEQUENCE;
  const sampleMs = parsePositiveInteger(process.env.JAVDB_WSL_REGRESSION_SAMPLE_MS, 5_000);
  const sampleIntervalMs = parsePositiveInteger(process.env.JAVDB_WSL_REGRESSION_INTERVAL_MS, 1_000);
  const mediaItems = parsePositiveInteger(process.env.JAVDB_WSL_REGRESSION_MEDIA_ITEMS, 1_289);
  const persistentProfileDir = process.env.JAVDB_WSL_PERSISTENT_PROFILE_DIR?.trim();
  const useHostChromeData = isEnabledEnvValue(process.env.JAVDB_WSL_USE_CHROME_DATA);
  const loadExtension = !['0', 'false', 'no'].includes(
    (process.env.JAVDB_WSL_LOAD_EXTENSION ?? '1').trim().toLowerCase(),
  );
  const disableGpu = !['0', 'false', 'no'].includes(
    (process.env.JAVDB_WSL_DISABLE_GPU ?? '1').trim().toLowerCase(),
  );
  const stageProfileToTmpfs = useHostChromeData
    && isEnabledEnvValue(process.env.JAVDB_WSL_STAGE_PROFILE_TO_TMPFS);
  const sourceFixtureMode = isEnabledEnvValue(process.env.JAVDB_WSL_SOURCE_FIXTURE);
  let sourceFixtureServer: WslSourceFixtureServer | null = null;
  if (sourceFixtureMode) {
    sourceFixtureServer = await startWslSourceFixtureServer({
      port: parsePositiveInteger(process.env.JAVDB_WSL_SOURCE_FIXTURE_PORT, 18082),
      itemCount: parsePositiveInteger(process.env.JAVDB_WSL_SOURCE_FIXTURE_ITEMS, 240),
      dynamicItemCount: resolveWslSourceFixtureDynamicItemCount(
        process.env.JAVDB_WSL_SOURCE_FIXTURE_DYNAMIC_ITEMS,
        parsePositiveInteger(process.env.JAVDB_WSL_SOURCE_FIXTURE_ITEMS, 240),
      ),
    });
    process.env.JAVDB_WSL_SOURCE_URL = sourceFixtureServer.url;
  }
  const sourceMode = Boolean(process.env.JAVDB_WSL_SOURCE_URL?.trim());
  const lifecycleRequirements = loadExtension
    ? buildWslLifecycleRequirements(dashboardSequence, {
      allowPreInitializedTarget: useHostChromeData,
    })
    : { requiredLifecycleEvents: [], requiredLifecycleEventGroups: [] };
  const policy = await readGatePolicy({
    requireExtensionEvidence: loadExtension,
    requireEnhancedDiagnostics: loadExtension && !sourceMode,
    ...lifecycleRequirements,
  });
  await fs.mkdir(rootReportDir, { recursive: true });

  try {
  for (let index = 0; index < repeatCount; index += 1) {
    const port = basePort + index;
    const profile = useHostChromeData
        ? {
          profileDir: await prepareWslHostDataProfile({
            persistentProfileDir,
            forceRefresh: isEnabledEnvValue(process.env.JAVDB_WSL_REFRESH_PERSISTENT_PROFILE),
            clearSessionArtifacts: !stageProfileToTmpfs,
          }),
        resetProfile: false,
      }
      : resolveWslChromeProfile({
        runIndex: index,
        persistentProfileDir,
      });
    const runtimeProfileDir = stageProfileToTmpfs
      ? await stageWslRuntimeProfile(profile.profileDir, index)
      : profile.profileDir;
    const runtimeProfile = {
      profileDir: runtimeProfileDir,
      resetProfile: stageProfileToTmpfs ? false : profile.resetProfile,
    };
    const reportDir = path.join(rootReportDir, `run-${index + 1}`);
    const launchOptions: WslChromeShellCommandOptions = {
      chromePath,
      profileDir: runtimeProfile.profileDir,
      extensionDir,
      port,
      logPath: `${runtimeProfile.profileDir}.log`,
      resetProfile: runtimeProfile.resetProfile,
      blockExternalNetwork: useHostChromeData,
      loadExtension,
      disableGpu,
    };
    try {
      await stopWslChrome(port);
      if (runtimeProfile.resetProfile === false) {
        await clearWslChromeSingletonLocks(runtimeProfile.profileDir);
      }
      await startWslChrome(launchOptions);
      const reportPath = await runProbe({
        port,
        profileDir: runtimeProfile.profileDir,
        reportDir,
        sampleMs,
        sampleIntervalMs,
        dashboardSequence,
        mediaItems,
        ...resolveWslProbeDataMode(useHostChromeData),
        requireExtension: loadExtension,
        sourceUrl: process.env.JAVDB_WSL_SOURCE_URL?.trim(),
      });
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown;
      const gate = evaluateWslPerformanceReport(report, policy);
      console.log(JSON.stringify({ run: index + 1, reportPath, ...gate }, null, 2));
      if (!gate.ok) {
        throw new Error(`WSL 性能报告未通过门禁：${gate.issues.map((issue) => issue.code).join(', ')}`);
      }
    } finally {
      await stopWslChrome(port);
      if (stageProfileToTmpfs) {
        await cleanupWslRuntimeProfile(runtimeProfile.profileDir);
      }
    }
  }
  } finally {
    await sourceFixtureServer?.stop().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
