/**
 * @file extensionHarness.test.ts
 * @description 拓展 Playwright 测试启动参数与 profile 路径解析自检
 * @module scripts
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createChromiumExtensionArgs,
  defaultExtensionProfileDir,
  ensureChromeDataSnapshot,
  prepareChromeTestProfile,
  readChromeSnapshotMetadata,
  resolveExtensionHarnessOptions,
  retryTransientFileSystemOperation,
  shouldKeepChromeExtensionStateDirectory,
  shouldCopyChromeProfilePath,
  shouldRefreshChromeSnapshot,
  suppressReleaseAnnouncementForTest,
} from './extensionHarness';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('extensionHarness', () => {
  test('uses repo-local default profile and dist directory', () => {
    const cwd = path.resolve('F:/repo/JavdBviewed');
    const options = resolveExtensionHarnessOptions({
      LOCALAPPDATA: 'C:/Users/Test/AppData/Local',
    }, cwd);

    expect(options.extensionDir).toBe(path.join(cwd, 'dist'));
    expect(options.userDataDir).toBe(defaultExtensionProfileDir(cwd));
    expect(options.startupUrl).toBeUndefined();
    expect(options.chromeDataSnapshot).toEqual({
      enabled: true,
      sourceUserDataDir: process.platform === 'win32'
        ? 'C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\User Data'
        : '/mnt/c/Users/Test/AppData/Local/Google/Chrome/User Data',
      snapshotDir: path.join(cwd, '.test-profiles', 'chrome-source-snapshot'),
      metadataPath: path.join(cwd, '.test-profiles', 'chrome-source-snapshot.meta.json'),
      refreshDays: 10,
    });
  });

  test('maps Windows drive paths to WSL mounts instead of resolving them under the POSIX cwd', () => {
    const options = resolveExtensionHarnessOptions({
      JAVDB_CHROME_USER_DATA: 'C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\User Data',
    }, '/work/JavdBviewed');

    expect(options.chromeDataSnapshot).toMatchObject({
      enabled: true,
      sourceUserDataDir: process.platform === 'win32'
        ? 'C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\User Data'
        : '/mnt/c/Users/Test/AppData/Local/Google/Chrome/User Data',
    });
  });

  test('resolves explicit env paths relative to cwd', () => {
    const cwd = path.resolve('F:/repo/JavdBviewed');
    const options = resolveExtensionHarnessOptions(
      {
        JAVDB_EXTENSION_DIST: 'tmp/dist-extension',
        JAVDB_EXTENSION_PROFILE: '.tmp/profile',
        JAVDB_EXTENSION_URL: 'https://example.test/page',
      },
      cwd,
    );

    expect(options.extensionDir).toBe(path.join(cwd, 'tmp/dist-extension'));
    expect(options.userDataDir).toBe(path.join(cwd, '.tmp/profile'));
    expect(options.startupUrl).toBe('https://example.test/page');
  });

  test('only disables the real Chrome data baseline through an explicit environment switch', () => {
    const options = resolveExtensionHarnessOptions({
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
    }, path.resolve('F:/repo/JavdBviewed'));

    expect(options.chromeDataSnapshot).toEqual({ enabled: false });
  });

  test('creates Chromium extension loading args', () => {
    const extensionDir = path.resolve('F:/repo/JavdBviewed/dist');

    expect(createChromiumExtensionArgs(extensionDir)).toEqual([
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ]);
  });

  test('waits for the install announcement state before suppressing it', async () => {
    let state: unknown = {};
    let evaluateCall = 0;
    const worker = {
      evaluate: vi.fn(async (_callback: unknown, argument?: unknown) => {
        evaluateCall += 1;
        if (evaluateCall === 1) return '2.0.0';
        if (evaluateCall === 2) return state;
        if (evaluateCall === 3) {
          state = { pending: { type: 'install', version: '2.0.0' } };
          return state;
        }
        if (evaluateCall === 4) {
          state = {
            lastSeenAnnouncementKey: (argument as { announcementKey: string }).announcementKey,
            lastSeenAt: 1,
          };
          return undefined;
        }
        return state;
      }),
    };
    const context = {
      serviceWorkers: () => [{ ...worker, url: () => 'chrome-extension://test/background.js' }],
    };

    await suppressReleaseAnnouncementForTest(context as never);

    expect(state).toEqual({ lastSeenAnnouncementKey: '2.0.0', lastSeenAt: expect.any(Number) });
    expect(worker.evaluate).toHaveBeenCalledTimes(5);
  });

  test('refreshes a Chrome snapshot only when it is missing, stale, or points to another source', () => {
    const now = Date.UTC(2026, 6, 30);
    const current = {
      version: 1 as const,
      copiedAt: now - 9 * 24 * 60 * 60 * 1000,
      sourceUserDataDir: 'C:/Chrome/User Data',
      sourceProfile: 'Default',
      refreshDays: 10,
    };

    expect(shouldRefreshChromeSnapshot(undefined, {
      sourceUserDataDir: current.sourceUserDataDir,
      sourceProfile: current.sourceProfile,
      refreshDays: 10,
      now,
    })).toBe(true);
    expect(shouldRefreshChromeSnapshot(current, {
      sourceUserDataDir: current.sourceUserDataDir,
      sourceProfile: current.sourceProfile,
      refreshDays: 10,
      now,
    })).toBe(false);
    expect(shouldRefreshChromeSnapshot(current, {
      sourceUserDataDir: current.sourceUserDataDir,
      sourceProfile: current.sourceProfile,
      refreshDays: 10,
      now: now + 2 * 24 * 60 * 60 * 1000,
    })).toBe(true);
    expect(shouldRefreshChromeSnapshot(current, {
      sourceUserDataDir: current.sourceUserDataDir,
      sourceProfile: 'Profile 2',
      refreshDays: 10,
      now,
    })).toBe(true);
  });

  test('keeps browser databases but excludes locks and rebuildable caches', () => {
    expect(shouldCopyChromeProfilePath('Default/Local Extension Settings/gneg/idb.log')).toBe(true);
    expect(shouldCopyChromeProfilePath('Default/IndexedDB/chrome-extension_gneg.indexeddb.leveldb/000003.log')).toBe(true);
    expect(shouldCopyChromeProfilePath('Default/Network/Cookies')).toBe(true);
    expect(shouldCopyChromeProfilePath('Default/Cache/data_0')).toBe(false);
    expect(shouldCopyChromeProfilePath('Default/Code Cache/js/index')).toBe(false);
    expect(shouldCopyChromeProfilePath('Default/Service Worker/ScriptCache/index')).toBe(false);
    expect(shouldCopyChromeProfilePath('Default/Local Storage/leveldb/LOCK')).toBe(false);
    expect(shouldCopyChromeProfilePath('SingletonLock')).toBe(false);
    expect(shouldCopyChromeProfilePath('Default/Current Session')).toBe(false);
    expect(shouldCopyChromeProfilePath('Default/Current Tabs')).toBe(false);
    expect(shouldCopyChromeProfilePath('Default/Sessions/Session_123')).toBe(false);
  });

  test('keeps only the target extension state directory', () => {
    const target = 'gnegjfjccmeafanpmbjboegcbchcghka';
    const other = 'nkeimhogjdpnpccoofpliimaahmaaome';

    expect(shouldKeepChromeExtensionStateDirectory(target, [target])).toBe(true);
    expect(shouldKeepChromeExtensionStateDirectory(other, [target])).toBe(false);
    expect(shouldKeepChromeExtensionStateDirectory(
      `chrome-extension_${target}_0.indexeddb.leveldb`,
      [target],
    )).toBe(true);
    expect(shouldKeepChromeExtensionStateDirectory(
      `chrome-extension_${other}_0.indexeddb.leveldb`,
      [target],
    )).toBe(false);
    expect(shouldKeepChromeExtensionStateDirectory('Cookies', [target])).toBe(true);
  });

  test('copies the last-used Chrome profile and refreshes it after ten days', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-harness-'));
    temporaryDirectories.push(root);
    const sourceUserDataDir = path.join(root, 'source', 'User Data');
    const snapshotDir = path.join(root, 'snapshot');
    const metadataPath = path.join(root, 'snapshot.meta.json');
    const extensionData = path.join(
      sourceUserDataDir,
      'Default',
      'Local Extension Settings',
      'gnegjfjccmeafanpmbjboegcbchcghka',
    );
    await fs.mkdir(extensionData, { recursive: true });
    await fs.mkdir(path.join(sourceUserDataDir, 'Default', 'Cache'), { recursive: true });
    await fs.writeFile(path.join(sourceUserDataDir, 'Local State'), JSON.stringify({
      profile: { last_used: 'Default' },
    }), 'utf8');
    await fs.writeFile(path.join(extensionData, '000003.log'), 'first', 'utf8');
    await fs.writeFile(path.join(sourceUserDataDir, 'Default', 'Cache', 'data_0'), 'cache', 'utf8');
    const now = Date.UTC(2026, 6, 30);
    const options = { sourceUserDataDir, snapshotDir, metadataPath, refreshDays: 10 };

    const first = await ensureChromeDataSnapshot(options, now);
    expect(first.refreshed).toBe(true);
    expect(first.metadata.sourceProfile).toBe('Default');
    expect(await fs.readFile(path.join(snapshotDir, 'Default', 'Local Extension Settings', 'gnegjfjccmeafanpmbjboegcbchcghka', '000003.log'), 'utf8')).toBe('first');
    await expect(fs.access(path.join(snapshotDir, 'Default', 'Cache', 'data_0'))).rejects.toThrow();

    await fs.writeFile(path.join(extensionData, '000004.log'), 'second', 'utf8');
    const reused = await ensureChromeDataSnapshot(options, now + 9 * 24 * 60 * 60 * 1000);
    expect(reused.refreshed).toBe(false);
    await expect(fs.access(path.join(snapshotDir, 'Default', 'Local Extension Settings', 'gnegjfjccmeafanpmbjboegcbchcghka', '000004.log'))).rejects.toThrow();

    const refreshed = await ensureChromeDataSnapshot(options, now + 11 * 24 * 60 * 60 * 1000);
    expect(refreshed.refreshed).toBe(true);
    expect(await fs.readFile(path.join(snapshotDir, 'Default', 'Local Extension Settings', 'gnegjfjccmeafanpmbjboegcbchcghka', '000004.log'), 'utf8')).toBe('second');
    expect((await readChromeSnapshotMetadata(metadataPath))?.copiedAt).toBe(now + 11 * 24 * 60 * 60 * 1000);
  });

  test('creates an isolated test profile from the snapshot without changing the snapshot', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-profile-copy-'));
    temporaryDirectories.push(root);
    const snapshotDir = path.join(root, 'snapshot');
    const testProfileDir = path.join(root, 'test-results', 'profile');
    const snapshotExtensionData = path.join(
      snapshotDir,
      'Default',
      'Local Extension Settings',
      'gnegjfjccmeafanpmbjboegcbchcghka',
    );
    await fs.mkdir(snapshotExtensionData, { recursive: true });
    const snapshotServiceWorkerCache = path.join(
      snapshotDir,
      'Default',
      'Service Worker',
      'ScriptCache',
      'stale-worker.js',
    );
    await fs.mkdir(path.dirname(snapshotServiceWorkerCache), { recursive: true });
    await fs.mkdir(testProfileDir, { recursive: true });
    await fs.writeFile(path.join(snapshotDir, 'Local State'), '{}', 'utf8');
    await fs.writeFile(path.join(snapshotExtensionData, '000003.log'), 'real-data-copy', 'utf8');
    await fs.writeFile(snapshotServiceWorkerCache, 'stale-worker', 'utf8');
    await fs.mkdir(path.join(snapshotDir, 'Default', 'Extensions', 'gnegjfjccmeafanpmbjboegcbchcghka'), { recursive: true });
    await fs.mkdir(path.join(snapshotDir, 'Default', 'Extensions', 'nkeimhogjdpnpccoofpliimaahmaaome'), { recursive: true });
    await fs.mkdir(path.join(snapshotDir, 'Default', 'Local Extension Settings', 'nkeimhogjdpnpccoofpliimaahmaaome'), { recursive: true });
    await fs.mkdir(path.join(snapshotDir, 'Default', 'IndexedDB', 'chrome-extension_nkeimhogjdpnpccoofpliimaahmaaome_0.indexeddb.leveldb'), { recursive: true });
    await fs.mkdir(path.join(snapshotDir, 'Default', 'IndexedDB', 'https_example.test_0.indexeddb.leveldb'), { recursive: true });
    await fs.writeFile(path.join(snapshotDir, 'Default', 'Preferences'), JSON.stringify({
      extensions: {
        settings: {
          gnegjfjccmeafanpmbjboegcbchcghka: { path: '/target' },
          nkeimhogjdpnpccoofpliimaahmaaome: { path: '/other' },
        },
      },
    }), 'utf8');
    await fs.writeFile(path.join(snapshotDir, 'Default', 'Secure Preferences'), JSON.stringify({
      protection: {
        macs: {
          extensions: {
            settings: {
              gnegjfjccmeafanpmbjboegcbchcghka: 'target',
              nkeimhogjdpnpccoofpliimaahmaaome: 'other',
            },
          },
        },
      },
    }), 'utf8');
    await fs.writeFile(path.join(testProfileDir, 'stale.txt'), 'stale', 'utf8');

    await prepareChromeTestProfile({
      snapshotDir,
      destinationUserDataDir: testProfileDir,
      sourceUserDataDir: path.join(root, 'real-chrome', 'User Data'),
      sourceProfile: 'Default',
      allowedExtensionIds: ['gnegjfjccmeafanpmbjboegcbchcghka'],
    });

    expect(await fs.readFile(path.join(
      testProfileDir,
      'Default',
      'Local Extension Settings',
      'gnegjfjccmeafanpmbjboegcbchcghka',
      '000003.log',
    ), 'utf8')).toBe('real-data-copy');
    await expect(fs.access(path.join(testProfileDir, 'stale.txt'))).rejects.toThrow();
    expect(await fs.readFile(path.join(snapshotExtensionData, '000003.log'), 'utf8')).toBe('real-data-copy');
    await expect(fs.access(path.join(testProfileDir, 'Default', 'Service Worker'))).rejects.toThrow();
    await expect(fs.access(path.join(testProfileDir, 'Default', 'Extensions', 'nkeimhogjdpnpccoofpliimaahmaaome'))).rejects.toThrow();
    await expect(fs.access(path.join(testProfileDir, 'Default', 'Local Extension Settings', 'nkeimhogjdpnpccoofpliimaahmaaome'))).rejects.toThrow();
    await expect(fs.access(path.join(testProfileDir, 'Default', 'IndexedDB', 'chrome-extension_nkeimhogjdpnpccoofpliimaahmaaome_0.indexeddb.leveldb'))).rejects.toThrow();
    await fs.access(path.join(testProfileDir, 'Default', 'Extensions', 'gnegjfjccmeafanpmbjboegcbchcghka'));
    await fs.access(path.join(testProfileDir, 'Default', 'IndexedDB', 'https_example.test_0.indexeddb.leveldb'));
    const preferences = JSON.parse(await fs.readFile(path.join(testProfileDir, 'Default', 'Preferences'), 'utf8')) as {
      extensions: { settings: Record<string, unknown> };
    };
    expect(Object.keys(preferences.extensions.settings)).toEqual(['gnegjfjccmeafanpmbjboegcbchcghka']);
    const securePreferences = JSON.parse(await fs.readFile(path.join(testProfileDir, 'Default', 'Secure Preferences'), 'utf8')) as {
      protection: { macs: { extensions: { settings: Record<string, unknown> } } };
    };
    expect(Object.keys(securePreferences.protection.macs.extensions.settings)).toEqual(['gnegjfjccmeafanpmbjboegcbchcghka']);
    expect(await fs.readFile(snapshotServiceWorkerCache, 'utf8')).toBe('stale-worker');
  });

  test('retries transient Windows file-system errors but fails fast for other errors', async () => {
    let transientAttempts = 0;
    const result = await retryTransientFileSystemOperation(async () => {
      transientAttempts += 1;
      if (transientAttempts < 3) {
        throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' });
      }
      return 'copied';
    }, { attempts: 3, delayMs: 0 });

    expect(result).toBe('copied');
    expect(transientAttempts).toBe(3);

    let permanentAttempts = 0;
    await expect(retryTransientFileSystemOperation(async () => {
      permanentAttempts += 1;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }, { attempts: 3, delayMs: 0 })).rejects.toThrow('missing');
    expect(permanentAttempts).toBe(1);
  });

  test('fails clearly when the source profile is missing instead of falling back to empty data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-missing-source-'));
    temporaryDirectories.push(root);

    await expect(ensureChromeDataSnapshot({
      sourceUserDataDir: path.join(root, 'missing', 'User Data'),
      snapshotDir: path.join(root, 'snapshot'),
      metadataPath: path.join(root, 'snapshot.meta.json'),
      refreshDays: 10,
    })).rejects.toThrow(/Chrome Local State|Chrome User Data/);
  });

  test('fails clearly when snapshot metadata is corrupted', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-broken-metadata-'));
    temporaryDirectories.push(root);
    const sourceUserDataDir = path.join(root, 'source', 'User Data');
    const metadataPath = path.join(root, 'snapshot.meta.json');
    await fs.mkdir(path.join(sourceUserDataDir, 'Default'), { recursive: true });
    await fs.writeFile(path.join(sourceUserDataDir, 'Local State'), JSON.stringify({
      profile: { last_used: 'Default' },
    }), 'utf8');
    await fs.writeFile(metadataPath, '{broken-json', 'utf8');

    await expect(ensureChromeDataSnapshot({
      sourceUserDataDir,
      snapshotDir: path.join(root, 'snapshot'),
      metadataPath,
      refreshDays: 10,
    })).rejects.toThrow('复制记录已损坏');
  });
});
