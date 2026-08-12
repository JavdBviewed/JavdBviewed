import { describe, expect, it } from 'vitest';

import {
  buildWslChromeShellCommand,
  buildWslChromeSingletonCleanupCommand,
  buildWslChromeSessionCleanupCommand,
  buildWslLifecycleRequirements,
  buildWslProbeInvocation,
  buildWslSourceFixtureServerCommand,
  resolveWslSourceFixtureDynamicItemCount,
  parseWslRegressionRepeatCount,
  resolveWslChromeProfile,
  resolveWslDashboardHash,
  resolveWslProbeDataMode,
  shouldReuseWslHostDataProfile,
  buildWslRuntimeProfileStageCommand,
  shouldClearWslCloudPending,
} from './runWslPerformanceRegression';

describe('WSL performance regression runner', () => {
  it('starts the source fixture inside WSL so localhost matches the content-script manifest', () => {
    expect(buildWslSourceFixtureServerCommand({
      directory: '/mnt/f/project/.test-profiles/source-fixture',
      port: 18082,
    })).toBe(
      'exec python3 -m http.server 18082 --bind 127.0.0.1 --directory /mnt/f/project/.test-profiles/source-fixture',
    );
  });

  it('allows a static source fixture when measuring mutation-observer overhead', () => {
    expect(resolveWslSourceFixtureDynamicItemCount(undefined, 240)).toBe(120);
    expect(resolveWslSourceFixtureDynamicItemCount('0', 240)).toBe(0);
    expect(resolveWslSourceFixtureDynamicItemCount('48', 240)).toBe(48);
    expect(resolveWslSourceFixtureDynamicItemCount('invalid', 240)).toBe(120);
  });
  it('uses an isolated profile and loads only the target extension', () => {
    const command = buildWslChromeShellCommand({
      chromePath: '/tmp/cft/chrome',
      profileDir: '/tmp/javdb-regression-1',
      extensionDir: '/mnt/f/project/dist',
      port: 9270,
      logPath: '/tmp/javdb-regression-1.log',
    });

    expect(command).toContain('--user-data-dir=/tmp/javdb-regression-1');
    expect(command).toContain('--disable-extensions-except=/mnt/f/project/dist');
    expect(command).toContain('--load-extension=/mnt/f/project/dist');
    expect(command).toContain('--remote-debugging-port=9270');
    expect(command).toContain('rm -rf -- /tmp/javdb-regression-1 && exec xvfb-run -a');
    expect(command).toContain('> /tmp/javdb-regression-1.log 2>&1');
  });

  it('can launch a browser baseline without loading any extension', () => {
    const command = buildWslChromeShellCommand({
      chromePath: '/tmp/cft/chrome',
      profileDir: '/tmp/profile',
      extensionDir: '/tmp/dist',
      port: 9270,
      logPath: '/tmp/chrome.log',
      loadExtension: false,
    });

    expect(command).toContain('--disable-extensions');
    expect(command).not.toContain('--load-extension=');
    expect(command).not.toContain('--disable-extensions-except=');
  });

  it('can keep GPU enabled for an environment comparison run', () => {
    const command = buildWslChromeShellCommand({
      chromePath: '/tmp/cft/chrome',
      profileDir: '/tmp/profile',
      extensionDir: '/tmp/dist',
      port: 9270,
      logPath: '/tmp/chrome.log',
      disableGpu: false,
    });

    expect(command).not.toContain('--disable-gpu');
  });

  it('keeps an explicitly persistent isolated profile between WSL sessions', () => {
    const profile = resolveWslChromeProfile({
      runIndex: 0,
      persistentProfileDir: '/mnt/f/project/.test-tools/wsl-profile',
      now: 1_786_100_000_000,
    });
    const command = buildWslChromeShellCommand({
      chromePath: '/tmp/cft/chrome',
      profileDir: profile.profileDir,
      extensionDir: '/mnt/f/project/dist',
      port: 9270,
      logPath: '/mnt/f/project/.test-tools/wsl-profile.log',
      resetProfile: profile.resetProfile,
    });

    expect(profile).toEqual({
      profileDir: '/mnt/f/project/.test-tools/wsl-profile',
      resetProfile: false,
    });
    expect(command).not.toContain('rm -rf --');
    expect(command).toContain('--user-data-dir=/mnt/f/project/.test-tools/wsl-profile');
  });

  it('clears only stale Chrome singleton locks before reusing a persistent profile', () => {
    const command = buildWslChromeSingletonCleanupCommand('/mnt/f/project/.test-tools/wsl-profile');

    expect(command).toBe(
      'rm -f -- /mnt/f/project/.test-tools/wsl-profile/SingletonCookie '
        + '/mnt/f/project/.test-tools/wsl-profile/SingletonLock '
        + '/mnt/f/project/.test-tools/wsl-profile/SingletonSocket',
    );
    expect(command).not.toContain('rm -rf');
  });

  it('clears stale session restore artifacts without removing the persistent profile', () => {
    const command = buildWslChromeSessionCleanupCommand(
      '/mnt/f/project/.test-tools/wsl-profile',
      'Default',
    );

    expect(command).toBe(
      "rm -rf -- /mnt/f/project/.test-tools/wsl-profile/Default/Sessions "
        + "'/mnt/f/project/.test-tools/wsl-profile/Default/Current Session' "
        + "'/mnt/f/project/.test-tools/wsl-profile/Default/Current Tabs' "
        + "'/mnt/f/project/.test-tools/wsl-profile/Default/Last Session' "
        + "'/mnt/f/project/.test-tools/wsl-profile/Default/Last Tabs'",
    );
    expect(command).not.toContain('rm -rf -- /mnt/f/project/.test-tools/wsl-profile ');
  });

  it('uses a disposable profile when persistence is not requested', () => {
    expect(resolveWslChromeProfile({
      runIndex: 2,
      now: 1_786_100_000_000,
    })).toEqual({
      profileDir: '/tmp/javdb-wsl-regression-1786100000000-2',
      resetProfile: true,
    });
  });

  it('blocks external network requests for host-data performance runs', () => {
    const command = buildWslChromeShellCommand({
      chromePath: '/tmp/cft/chrome',
      profileDir: '/mnt/f/project/.test-profiles/wsl-real-data',
      extensionDir: '/mnt/f/project/dist',
      port: 9270,
      logPath: '/mnt/f/project/.test-profiles/wsl-real-data.log',
      resetProfile: false,
      blockExternalNetwork: true,
    });

    expect(command).toContain("'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'");
  });

  it('does not overwrite host media data with the synthetic fixture', () => {
    expect(resolveWslProbeDataMode(false)).toEqual({
      injectMediaFixture: true,
      disableExternalSync: false,
      forceCloseRecovery: false,
      singlePageIsolation: false,
      pageTimeoutMs: 10_000,
    });
    expect(resolveWslProbeDataMode(true)).toEqual({
      injectMediaFixture: false,
      disableExternalSync: true,
      forceCloseRecovery: true,
      singlePageIsolation: true,
      pageTimeoutMs: 30_000,
    });
  });

  it('normalizes repeat counts and falls back to one run', () => {
    expect(parseWslRegressionRepeatCount(undefined)).toBe(1);
    expect(parseWslRegressionRepeatCount('3')).toBe(3);
    expect(parseWslRegressionRepeatCount('0')).toBe(1);
    expect(parseWslRegressionRepeatCount('not-a-number')).toBe(1);
  });

  it('normalizes an explicit initial Dashboard hash for isolated comparisons', () => {
    expect(resolveWslDashboardHash('tab-media')).toBe('tab-media');
    expect(resolveWslDashboardHash('#tab-records')).toBe('tab-records');
    expect(resolveWslDashboardHash('tab-settings/emby-settings')).toBe('tab-settings/emby-settings');
    expect(resolveWslDashboardHash('https://example.test')).toBe('tab-home');
    expect(resolveWslDashboardHash(undefined)).toBe('tab-home');
  });

  it('runs the Windows pnpm shim through cmd.exe', () => {
    const invocation = buildWslProbeInvocation();
    expect(invocation.file.toLowerCase()).toMatch(/(?:^|\\)cmd\.exe$/);
    expect(invocation.args).toEqual(['/d', '/s', '/c', 'pnpm.cmd exec tsx scripts/wslCdpPerformanceProbe.ts']);
  });

  it('accepts active or restore as the target tab activation event', () => {
    expect(buildWslLifecycleRequirements('tab-home,tab-media')).toEqual({
      requiredLifecycleEvents: [
        'tab-media:initialize',
        'tab-media:dispose',
      ],
      requiredLifecycleEventGroups: [['tab-media:active', 'tab-media:restore']],
    });
  });

  it('allows an already initialized host-data page while still requiring cleanup', () => {
    expect(buildWslLifecycleRequirements('tab-media', { allowPreInitializedTarget: true })).toEqual({
      requiredLifecycleEvents: ['tab-media:dispose'],
      requiredLifecycleEventGroups: [['tab-media:initialize', 'tab-media:active', 'tab-media:restore']],
    });
  });

  it('reuses a seeded persistent host-data profile unless an explicit refresh is requested', () => {
    expect(shouldReuseWslHostDataProfile({
      persistentProfileDir: '/mnt/f/project/.test-tools/wsl-host-profile',
      markerExists: true,
      forceRefresh: false,
      snapshotRefreshed: false,
    })).toBe(true);
    expect(shouldReuseWslHostDataProfile({
      persistentProfileDir: '/mnt/f/project/.test-tools/wsl-host-profile',
      markerExists: true,
      forceRefresh: true,
      snapshotRefreshed: false,
    })).toBe(false);
    expect(shouldReuseWslHostDataProfile({
      persistentProfileDir: '',
      markerExists: true,
      forceRefresh: false,
      snapshotRefreshed: false,
    })).toBe(false);
    expect(shouldReuseWslHostDataProfile({
      persistentProfileDir: '/mnt/f/project/.test-tools/wsl-host-profile',
      markerExists: true,
      forceRefresh: false,
      snapshotRefreshed: true,
    })).toBe(false);
  });

  it('stages host data into WSL ext4 before random IndexedDB reads', () => {
    expect(buildWslRuntimeProfileStageCommand(
      '/mnt/f/project/.test-profiles/host-profile',
      '/tmp/javdb-wsl-runtime-1',
    )).toBe(
      'rm -rf -- /tmp/javdb-wsl-runtime-1 && mkdir -p /tmp/javdb-wsl-runtime-1 '
        + '&& cp -a -- /mnt/f/project/.test-profiles/host-profile/. /tmp/javdb-wsl-runtime-1/',
    );
  });

  it('preserves the explicit Cloud pending cleanup opt-in for the inner probe', () => {
    expect(shouldClearWslCloudPending('1')).toBe(true);
    expect(shouldClearWslCloudPending('true')).toBe(true);
    expect(shouldClearWslCloudPending(undefined)).toBe(false);
    expect(shouldClearWslCloudPending('0')).toBe(false);
  });
});
