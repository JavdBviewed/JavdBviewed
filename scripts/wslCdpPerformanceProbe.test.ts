import { describe, expect, it, vi } from 'vitest';
import {
  buildWslDashboardUrl,
  buildWslDiagnosticSnapshot,
  inspectWslExtensionRuntime,
  inferWslExtensionId,
  mergeWslExtensionRuntimeUrls,
  parseWslTabCounts,
  buildWslScenarioName,
  shouldRequireWslExtension,
  shouldEnableWslDeepDiagnostics,
  shouldRunWslCloseRecovery,
  shouldForceWslCloseRecovery,
  shouldTouchWslDashboardLifecycle,
  buildWslPerformanceProbeScript,
  parseWslChromeProcessLine,
  selectWslChromeProcesses,
  summarizeWslChromeProcessesByCategory,
  summarizeWslChromeProcessesByRole,
  selectWslPageIndex,
  selectWslPageTargetIdsToClose,
  isMissingWslTargetError,
  summarizeWslChromeProcesses,
  isWslExtensionPageUrl,
  inspectWslExtensionPageRuntime,
  parseWslDashboardHash,
  parseWslDashboardTabSequence,
  summarizeWslEventListeners,
  summarizeWslContainerEventListeners,
  summarizeWslEventTargetSamples,
  buildWslExternalSyncIsolationExpression,
  summarizeWslStorageValue,
  summarizeWslStorageCollection,
  summarizeWslOriginStorageUsage,
  summarizeWslHeapProfile,
  buildWslPageMetricsExpression,
  buildContentPerformanceReadExpression,
  appendContentPerformanceDiagnosticQuery,
  shouldEnableWslHeapProfile,
  resolveWslCdpCommandTimeoutMs,
  summarizeWslCdpProcessInfo,
  shouldNavigateWslDashboardTarget,
  summarizeWslCpuProfile,
  summarizeWslTargetInfos,
  calculateWslIntervalCpuPercent,
  parseWslChromeProcessLineWithJiffies,
  summarizeWslServiceWorkerHeapUsage,
  inspectWslSourceFixtureSnapshot,
  buildWslContentSettingsExpression,
  parseWslContentSettingsProfile,
  buildChromeProcessSnapshotInvocation,
  closeWslTargets,
  removeClosedWslTargetIds,
  closeWslProbeTargets,
  closeWslProbeTargetsWithRetry,
  closeWslPageTargetsExcept,
} from './wslCdpPerformanceProbe';

describe('WSL CDP performance probe helpers', () => {
  it('closes each owned target at most once and tolerates an already-closed target', async () => {
    const calls: string[] = [];
    const cdp = {
      send: async (_method: string, params?: Record<string, unknown>) => {
        const targetId = typeof params?.targetId === 'string' ? params.targetId : '';
        calls.push(targetId);
        if (targetId === 'already-closed') throw new Error('No target with given id');
        return {};
      },
    };

    await closeWslTargets(cdp, ['dashboard', 'dashboard', 'already-closed']);

    expect(calls).toEqual(['dashboard', 'already-closed']);
  });

  it('reports non-race target close failures for a later cleanup retry', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cdp = {
      send: async (_method: string, params?: Record<string, unknown>) => {
        const targetId = typeof params?.targetId === 'string' ? params.targetId : '';
        if (targetId === 'transport-failed') throw new Error('CDP transport down');
        if (targetId === 'already-closed') throw new Error('No target with given id');
        return {};
      },
    };

    try {
      await expect(closeWslTargets(cdp, ['transport-failed', 'already-closed']))
        .resolves.toEqual([{ targetId: 'transport-failed', message: 'CDP transport down' }]);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('transport-failed'));
    } finally {
      warning.mockRestore();
    }
  });

  it('removes only targets that closed successfully from the active ownership set', () => {
    const activeTargetIds = new Set(['recovery', 'keep-alive', 'unrelated']);

    removeClosedWslTargetIds(
      activeTargetIds,
      ['recovery', 'keep-alive'],
      [{ targetId: 'recovery', message: 'CDP transport down' }],
    );

    expect(activeTargetIds).toEqual(new Set(['recovery', 'unrelated']));
  });

  it('retries a failed owned target and removes it after the retry succeeds', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let closeAttempts = 0;
    const activeTargetIds = new Set(['owned-target']);
    const cdp = {
      send: async (_method: string, params?: Record<string, unknown>) => {
        expect(params?.targetId).toBe('owned-target');
        closeAttempts += 1;
        if (closeAttempts === 1) throw new Error('temporary CDP failure');
        return {};
      },
    };

    try {
      await expect(closeWslProbeTargets(cdp, ['owned-target'], activeTargetIds))
        .resolves.toHaveLength(1);
      expect(activeTargetIds.has('owned-target')).toBe(true);

      await expect(closeWslProbeTargets(cdp, ['owned-target'], activeTargetIds))
        .resolves.toEqual([]);
      expect(activeTargetIds.has('owned-target')).toBe(false);
      expect(closeAttempts).toBe(2);
    } finally {
      warning.mockRestore();
    }
  });

  it('retries failed targets during final probe cleanup', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let closeAttempts = 0;
    const activeTargetIds = new Set(['owned-target']);
    const cdp = {
      send: async (_method: string, params?: Record<string, unknown>) => {
        expect(params?.targetId).toBe('owned-target');
        closeAttempts += 1;
        if (closeAttempts === 1) throw new Error('temporary CDP failure');
        return {};
      },
    };

    try {
      await expect(closeWslProbeTargetsWithRetry(cdp, ['owned-target'], activeTargetIds))
        .resolves.toEqual([]);
      expect(closeAttempts).toBe(2);
      expect(activeTargetIds).toEqual(new Set());
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('owned-target'));
    } finally {
      warning.mockRestore();
    }
  });

  it('removes pages closed during single-page isolation from active ownership', async () => {
    const activeTargetIds = new Set(['old-page', 'fresh-page']);
    const closedTargetIds: string[] = [];
    const cdp = {
      getTargets: async () => [
        { targetId: 'old-page', type: 'page' },
        { targetId: 'fresh-page', type: 'page' },
      ],
      send: async (_method: string, params?: Record<string, unknown>) => {
        closedTargetIds.push(String(params?.targetId));
        return {};
      },
    };

    await closeWslPageTargetsExcept(cdp, 'fresh-page', activeTargetIds);

    expect(closedTargetIds).toEqual(['old-page']);
    expect(activeTargetIds).toEqual(new Set(['fresh-page']));
  });

  it('uses the local shell for process snapshots when running on Linux', () => {
    const invocation = buildChromeProcessSnapshotInvocation('linux');
    expect(invocation).toEqual({
      file: '/bin/bash',
      args: ['-lc', expect.stringContaining('ps -eo pid=,rss=,comm=,args=')],
    });
    expect(invocation.args[1]).toMatch(/done; exit 0$/);
    expect(invocation.args[1]).toContain("awk '$3 ~ /^(chrome|chromium)/'");
  });

  it('keeps the WSL shell bridge for Windows hosts', () => {
    expect(buildChromeProcessSnapshotInvocation('win32')).toEqual({
      file: 'wsl.exe',
      args: [
        '--distribution',
        'Ubuntu-22.04',
        '--exec',
        '/bin/bash',
        '-lc',
        expect.stringContaining('ps -eo pid=,rss=,comm=,args='),
      ],
    });
  });

  it('adds the opt-in content diagnostic query without replacing existing source parameters', () => {
    expect(appendContentPerformanceDiagnosticQuery('http://127.0.0.1:18082/source?q=fixture'))
      .toBe('http://127.0.0.1:18082/source?q=fixture&perfContent=1');
    expect(buildContentPerformanceReadExpression()).toContain('JDB_CONTENT_PERF_READ');
  });

  it('keeps external-sync isolation usable in a content-script world without alarms', () => {
    const expression = buildWslExternalSyncIsolationExpression({ clearCloudPending: false });
    const storage = new Map<string, unknown>([
      ['settings', {}],
      ['cloud_auto_sync_settings_v1', { enabled: true }],
    ]);
    const chrome = {
      storage: {
        local: {
          get: async (keys: string[]) => Object.fromEntries(
            keys.filter(key => storage.has(key)).map(key => [key, storage.get(key)]),
          ),
          set: async (values: Record<string, unknown>) => {
            Object.entries(values).forEach(([key, value]) => storage.set(key, value));
          },
        },
      },
    };

    return expect(new Function('chrome', `return ${expression}`)(chrome)).resolves.toEqual({
      ok: true,
      checks: { emby: true, drive115: true, cloud: true, pending: true },
    });
  });

  it('builds a dashboard URL with an optional chart diagnostic query before the hash', () => {
    expect(buildWslDashboardUrl(
      'gnegjfjccmeafanpmbjboegcbchcghka',
      '#tab-home',
      'single-tags:echarts',
    )).toBe(
      'chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html?perfHomeCharts=single-tags%3Aecharts#tab-home',
    );
    expect(buildWslDashboardUrl(
      'gnegjfjccmeafanpmbjboegcbchcghka',
      '#tab-media',
      undefined,
    )).toBe(
      'chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html#tab-media',
    );
    expect(buildWslDashboardUrl(
      'gnegjfjccmeafanpmbjboegcbchcghka',
      '#tab-new-works',
      undefined,
      'no-auto-sync',
    )).toBe(
      'chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html?perfNewWorks=no-auto-sync#tab-new-works',
    );
  });

  it('builds isolated source-content profiles without enabling unrelated features', () => {
    const baseline = buildWslContentSettingsExpression('baseline');
    expect(baseline).toContain('enableListEnhancement: false');
    expect(baseline).toContain('enableContentFilter: false');

    const list = buildWslContentSettingsExpression('list');
    expect(list).toContain('enableListEnhancement: true');
    expect(list).toContain('enableVideoPreview: false');

    const preview = buildWslContentSettingsExpression('list-preview');
    expect(preview).toContain('enableVideoPreview: true');
    expect(preview).not.toContain('enableContentFilter: true');
  });

  it('normalizes source content profiles and falls back to the baseline', () => {
    expect(parseWslContentSettingsProfile(undefined)).toBe('baseline');
    expect(parseWslContentSettingsProfile('list')).toBe('list');
    expect(parseWslContentSettingsProfile('list-preview')).toBe('list-preview');
    expect(parseWslContentSettingsProfile('content-filter')).toBe('content-filter');
    expect(parseWslContentSettingsProfile('unknown')).toBe('baseline');
  });
  it('rejects source samples that did not load the full fixture or extension content script', () => {
    expect(inspectWslSourceFixtureSnapshot({
      sourceFixtureMarker: true,
      sourceFixtureItemCount: 240,
      extensionInjected: true,
    }, { expectedItemCount: 240, requireExtension: true })).toEqual({ ok: true, reason: null });
    expect(inspectWslSourceFixtureSnapshot({
      sourceFixtureMarker: false,
      sourceFixtureItemCount: 54,
      extensionInjected: false,
    }, { expectedItemCount: 240, requireExtension: true })).toEqual({
      ok: false,
      reason: 'source-fixture-not-loaded',
    });
  });
  it('summarizes Service Worker heap usage without retaining runtime payloads', () => {
    expect(summarizeWslServiceWorkerHeapUsage({
      usedSize: 1024,
      totalSize: 2048,
      embedderHeapUsedSize: 32,
      backingStorageSize: 64,
      globalObject: 'secret',
    })).toEqual({
      usedBytes: 1024,
      totalBytes: 2048,
      embedderHeapUsedBytes: 32,
      backingStorageBytes: 64,
    });

    expect(summarizeWslServiceWorkerHeapUsage({ usedSize: 'bad' })).toBeNull();
  });

  it('uses a bounded configurable CDP command timeout for host-data startup', () => {
    expect(resolveWslCdpCommandTimeoutMs(undefined)).toBe(5_000);
    expect(resolveWslCdpCommandTimeoutMs('30000')).toBe(30_000);
    expect(resolveWslCdpCommandTimeoutMs('200')).toBe(1_000);
    expect(resolveWslCdpCommandTimeoutMs('invalid')).toBe(5_000);
  });

  it('keeps only numeric CDP process attribution fields', () => {
    expect(summarizeWslCdpProcessInfo([
      {
        id: 123,
        type: 'renderer',
        cpuTime: 4.5,
        privateMemory: 123456,
        physicalMemory: 234567,
        peakWorkingSetSize: 345678,
        commandLine: '--user-data-dir=/secret/profile --token=secret',
      },
      {
        id: 'bad',
        type: 'utility',
        cpuTime: 'bad',
      },
    ])).toEqual([
      {
        pid: 123,
        type: 'renderer',
        cpuTimeSeconds: 4.5,
        privateMemoryBytes: 123456,
        physicalMemoryBytes: 234567,
        peakWorkingSetSizeBytes: 345678,
      },
    ]);
  });

  it('does not navigate to an extension URL in the no-extension control', () => {
    expect(shouldNavigateWslDashboardTarget(false, '#tab-home')).toBe(false);
    expect(shouldNavigateWslDashboardTarget(true, '#tab-home')).toBe(true);
    expect(shouldNavigateWslDashboardTarget(true, null)).toBe(false);
  });

  it('summarizes CPU profile self time without retaining source URLs', () => {
    expect(summarizeWslCpuProfile({
      nodes: [
        {
          id: 1,
          callFrame: {
            functionName: 'renderMedia',
            url: 'chrome-extension://secret/dashboard.js?token=abc',
            lineNumber: 12,
            columnNumber: 3,
          },
        },
        {
          id: 2,
          callFrame: {
            functionName: 'requestAnimationFrame',
            url: 'chrome-extension://secret/media.js',
            lineNumber: 20,
            columnNumber: 1,
          },
        },
      ],
      samples: [1, 2, 1],
      timeDeltas: [2_000, 1_000, 3_000],
    })).toEqual([
      {
        selfTimeMs: 5,
        functionName: 'renderMedia',
        source: '[extension]',
        lineNumber: 12,
        columnNumber: 3,
      },
      {
        selfTimeMs: 1,
        functionName: 'requestAnimationFrame',
        source: '[extension]',
        lineNumber: 20,
        columnNumber: 1,
      },
    ]);
  });

  it('summarizes target types without retaining titles or URL parameters', () => {
    const result = summarizeWslTargetInfos([
      {
        type: 'page',
        url: 'chrome-extension://extension-id/dashboard/dashboard.html#tab-media',
        title: '用户标题',
      },
      {
        type: 'service_worker',
        url: 'chrome-extension://extension-id/service_worker.js?token=secret',
        title: 'secret title',
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((target) => target.type)).toEqual(['page', 'service_worker']);
    expect(result.join(' ')).not.toContain('secret');
    expect(result.join(' ')).not.toContain('用户标题');
  });

  it('calculates CPU from cumulative jiffies within the sampling window', () => {
    expect(calculateWslIntervalCpuPercent(0, 100, 1_000)).toBe(100);
    expect(calculateWslIntervalCpuPercent(100, 150, 1_000)).toBe(50);
    expect(calculateWslIntervalCpuPercent(100, 90, 1_000)).toBe(0);
  });

  it('parses the cumulative jiffies process format separately from lifetime pcpu', () => {
    expect(parseWslChromeProcessLineWithJiffies(
      '123 250 4096 2048 100 200 300 400 0 chrome --type=renderer',
    )).toMatchObject({
      pid: 123,
      cpuPercent: 0,
      cpuJiffies: 250,
      rssKb: 4096,
      pssKb: 2048,
    });
  });

  it('records media mount counts without exposing media content', () => {
    const expression = buildWslPageMetricsExpression({ includeProbeState: true });

    expect(expression).toContain('mediaCardCount');
    expect(expression).toContain('mediaGridItemCount');
    expect(expression).toContain('visibleMediaCardCount');
    expect(expression).toContain('hiddenDashboardTabContentCount');
    expect(expression).toContain('dashboardTabMetrics: Array.from(document.querySelectorAll');
    expect(expression).toContain("domNodes: element.querySelectorAll('*').length + 1");
    expect(expression).toContain('childMetrics: Array.from(element.children)');
    expect(expression).toContain('recordsLifecycleSnapshots');
    expect(expression).toContain('newWorksDiagnostics: globalThis.__JAVDB_NEW_WORKS_DIAGNOSTICS__ ?? null');
    expect(expression).toContain('iframeKinds');
    expect(expression).toContain('canvasCount');
    expect(expression).toContain('imagePixelCount');
    expect(expression).toContain('resourceDecodedBytes');
    expect(expression).toContain('sourceFixtureMarker');
    expect(expression).toContain('sourceFixtureItemCount');
    expect(expression).toContain('extensionInjected');
    expect(expression).toContain('longTaskDurationsMs');
    expect(expression).not.toContain('textContent');
    expect(expression).not.toContain('innerHTML');
  });

  it('summarizes heap sampling nodes without retaining source URLs or full stacks', () => {
    expect(summarizeWslHeapProfile({
      nodes: [
        {
          selfSize: 4096,
          callFrame: {
            functionName: 'buildMediaCatalog',
            url: 'chrome-extension://secret/dashboard.js?token=abc',
            lineNumber: 12,
            columnNumber: 3,
          },
        },
        {
          selfSize: 12288,
          callFrame: {
            functionName: 'renderCard',
            url: 'chrome-extension://secret/media.js',
            lineNumber: 20,
            columnNumber: 1,
          },
        },
      ],
    })).toEqual([
      {
        selfSizeBytes: 12288,
        functionName: 'renderCard',
        source: '[extension]',
        lineNumber: 20,
        columnNumber: 1,
      },
      {
        selfSizeBytes: 4096,
        functionName: 'buildMediaCatalog',
        source: '[extension]',
        lineNumber: 12,
        columnNumber: 3,
      },
    ]);
  });

  it('separates extension, Chrome UI, web and utility renderer memory', () => {
    const summary = summarizeWslChromeProcessesByRole([
      {
        pid: 1,
        cpuPercent: 4,
        rssKb: 100,
        pssKb: 80,
        command: 'chrome',
        args: '--type=renderer --extension-process',
      },
      {
        pid: 2,
        cpuPercent: 2,
        rssKb: 60,
        pssKb: 40,
        command: 'chrome',
        args: '--type=renderer --top-chrome-webui',
      },
      {
        pid: 3,
        cpuPercent: 1,
        rssKb: 50,
        pssKb: 30,
        command: 'chrome',
        args: '--type=renderer',
      },
      {
        pid: 4,
        cpuPercent: 0.5,
        rssKb: 40,
        pssKb: 20,
        command: 'chrome',
        args: '--type=utility --utility-sub-type=network.mojom.NetworkService',
      },
    ]);

    expect(summary).toEqual({
      'extension-renderer': { processCount: 1, cpuPercent: 4, rssKb: 100, pssKb: 80 },
      'chrome-ui-renderer': { processCount: 1, cpuPercent: 2, rssKb: 60, pssKb: 40 },
      renderer: { processCount: 1, cpuPercent: 1, rssKb: 50, pssKb: 30 },
      utility: { processCount: 1, cpuPercent: 0.5, rssKb: 40, pssKb: 20 },
    });
  });

  it('parses smaps memory breakdown fields without changing legacy process lines', () => {
    expect(parseWslChromeProcessLine(
      '1234 12.5 45678 23456 12000 3000 5000 2000 100 google-chrome --type=renderer --extension-process',
    )).toEqual({
      pid: 1234,
      cpuPercent: 12.5,
      rssKb: 45678,
      pssKb: 23456,
      privateDirtyKb: 12000,
      privateCleanKb: 3000,
      sharedCleanKb: 5000,
      sharedDirtyKb: 2000,
      swapKb: 100,
      command: 'google-chrome',
      args: '--type=renderer --extension-process',
    });

    expect(parseWslChromeProcessLine(
      '1234 12.5 45678 23456 google-chrome --type=renderer',
    )).toEqual({
      pid: 1234,
      cpuPercent: 12.5,
      rssKb: 45678,
      pssKb: 23456,
      command: 'google-chrome',
      args: '--type=renderer',
    });
  });

  it('does not mutate the CDP node array when head is also present', () => {
    const nodes = [{
      selfSize: 1024,
      callFrame: { functionName: 'existingNode', url: 'chrome-extension://example/app.js' },
    }];

    expect(summarizeWslHeapProfile({
      nodes,
      head: {
        selfSize: 2048,
        callFrame: { functionName: 'headNode', url: 'chrome-extension://example/app.js' },
      },
    })).toHaveLength(2);
    expect(nodes).toHaveLength(1);
  });

  it('keeps heap sampling opt-in', () => {
    expect(shouldEnableWslHeapProfile(undefined)).toBe(false);
    expect(shouldEnableWslHeapProfile('0')).toBe(false);
    expect(shouldEnableWslHeapProfile('true')).toBe(true);
    expect(shouldEnableWslHeapProfile('yes')).toBe(true);
  });

  it('uses the same explicit opt-in contract for forced garbage collection', () => {
    expect(shouldEnableWslHeapProfile(undefined)).toBe(false);
    expect(shouldEnableWslHeapProfile('0')).toBe(false);
    expect(shouldEnableWslHeapProfile('1')).toBe(true);
  });

  it('builds an isolation patch that disables external sync without deleting source credentials', () => {
    const expression = buildWslExternalSyncIsolationExpression();

    expect(expression).toContain('cloud_auto_sync_settings_v1');
    expect(expression).toContain('emby.library.sync');
    expect(expression).toContain('drive115.daily_user_refresh');
    expect(expression).toContain('drive115-library-index-resume');
    expect(expression).toContain('webdav-auto-sync');
    expect(expression).toContain('enabled: false');
    expect(expression).toContain('mediaServers');
    expect(expression).toContain('mediaLibraryRoots');
    expect(expression).toContain('verification');
    expect(expression).toContain('checks');
    expect(expression).toContain('ok:');
    expect(expression).toContain('setTimeout(resolve, 2_000)');
    expect(expression.indexOf("'cloud-auto-sync'")).toBeLessThan(
      expression.indexOf("const stored = await chrome.storage.local.get"),
    );
    expect(expression).not.toContain('chrome.storage.local.clear');
    expect(expression).not.toContain('remove');
  });

  it('can clear only the Cloud pending queue in an explicitly isolated test copy', () => {
    const expression = buildWslExternalSyncIsolationExpression({ clearCloudPending: true });

    expect(expression).toContain("cloud_sync_pending_v1: []");
    expect(expression).not.toContain('chrome.storage.local.clear');
    expect(expression).not.toContain('chrome.storage.local.remove');
  });

  it('parses a deterministic source-tab matrix without creating duplicate counts', () => {
    expect(parseWslTabCounts(undefined)).toEqual([1]);
    expect(parseWslTabCounts('1, 2,2, 5, 10')).toEqual([1, 2, 5, 10]);
    expect(parseWslTabCounts('0, -1, nope, 3.5, 4')).toEqual([4]);
  });

  it('names source-tab scenarios by the actual tab count', () => {
    expect(buildWslScenarioName('javdb-source', 1)).toBe('javdb-source-1-tab');
    expect(buildWslScenarioName('javdb-source', 2)).toBe('javdb-source-2-tabs');
  });

  it('requires the extension runtime by default and allows an explicit control run', () => {
    expect(shouldRequireWslExtension(undefined)).toBe(true);
    expect(shouldRequireWslExtension('1')).toBe(true);
    expect(shouldRequireWslExtension('0')).toBe(false);
    expect(shouldRequireWslExtension('false')).toBe(false);
  });

  it('keeps deep EventTarget diagnostics opt-in so normal performance samples are not perturbed', () => {
    expect(shouldEnableWslDeepDiagnostics(undefined)).toBe(false);
    expect(shouldEnableWslDeepDiagnostics('0')).toBe(false);
    expect(shouldEnableWslDeepDiagnostics('true')).toBe(true);
    expect(shouldEnableWslDeepDiagnostics('yes')).toBe(true);
  });

  it('keeps close recovery opt-in and installs only bounded diagnostic state', () => {
    expect(shouldRunWslCloseRecovery(undefined)).toBe(false);
    expect(shouldRunWslCloseRecovery('1')).toBe(true);
    expect(shouldRunWslCloseRecovery('false')).toBe(false);
    expect(shouldForceWslCloseRecovery(undefined)).toBe(false);
    expect(shouldForceWslCloseRecovery('1')).toBe(true);
    expect(shouldForceWslCloseRecovery('false')).toBe(false);
    const script = buildWslPerformanceProbeScript();
    expect(script).toContain('__JAVDB_PERF_PROBE__');
    expect(script).toContain('PerformanceObserver');
    expect(script).toContain('longTaskDurationsMs');
    expect(script).toContain('longTaskEntries');
    expect(script).toContain('startTime: entry.startTime');
  });

  it('discovers the extension ID from the expected loader worker', () => {
    expect(inferWslExtensionId([
      'chrome-extension://built-in/background.js',
      'chrome-extension://test-extension/service-worker-loader.js',
    ])).toBe('test-extension');
    expect(inferWslExtensionId(['chrome-extension://other/service-worker.js'])).toBeNull();
  });

  it('discovers the extension ID from the current service worker filename', () => {
    expect(inferWslExtensionId([
      'chrome-extension://current-extension/service_worker.js',
    ])).toBe('current-extension');
  });

  it('merges Service Worker targets reported by CDP when Playwright has none', () => {
    expect(mergeWslExtensionRuntimeUrls(
      ['chrome-extension://test-extension/dashboard/dashboard.html#tab-home'],
      [],
      [{ type: 'service_worker', url: 'chrome-extension://test-extension/service_worker.js' }],
    )).toEqual({
      pageUrls: ['chrome-extension://test-extension/dashboard/dashboard.html#tab-home'],
      serviceWorkerUrls: ['chrome-extension://test-extension/service_worker.js'],
    });
  });

  it('accepts only a real extension page and its service worker as valid runtime evidence', () => {
    expect(inspectWslExtensionRuntime({
      expectedExtensionId: 'test-extension',
      pageUrls: [
        'chrome-extension://test-extension/dashboard/dashboard.html#tab-home',
        'https://javdb.com/',
      ],
      serviceWorkerUrls: ['chrome-extension://test-extension/service-worker-loader.js'],
    })).toEqual({
      ok: true,
      extensionPageCount: 1,
      serviceWorkerCount: 1,
      reason: null,
    });
  });

  it('rejects an error page or a missing extension service worker', () => {
    expect(inspectWslExtensionRuntime({
      expectedExtensionId: 'test-extension',
      pageUrls: ['chrome-error://chromewebdata/'],
      serviceWorkerUrls: [],
    })).toEqual({
      ok: false,
      extensionPageCount: 0,
      serviceWorkerCount: 0,
      reason: '目标扩展页面或 Service Worker 未加载，不能形成性能证据。',
    });
  });

  it('keeps an extension page sample valid when an idle MV3 worker is not observable', () => {
    expect(inspectWslExtensionRuntime({
      expectedExtensionId: 'test-extension',
      pageUrls: ['chrome-extension://test-extension/dashboard/dashboard.html#tab-home'],
      serviceWorkerUrls: [],
      allowMissingServiceWorker: true,
    })).toEqual({
      ok: true,
      extensionPageCount: 1,
      serviceWorkerCount: 0,
      reason: '扩展页面已加载，但 MV3 Service Worker 当前处于休眠状态，CDP 未观察到 Worker 目标。',
    });
  });

  it('parses a Linux Chrome process row without retaining command arguments', () => {
    expect(parseWslChromeProcessLine(' 1234  12.5 45678 google-chrome --type=renderer --user-data-dir=/tmp/test'))
      .toEqual({
        pid: 1234,
        cpuPercent: 12.5,
        rssKb: 45678,
        command: 'google-chrome',
        args: '--type=renderer --user-data-dir=/tmp/test',
      });
  });

  it('parses an optional Linux PSS column for shared-memory-aware diagnostics', () => {
    expect(parseWslChromeProcessLine('1234 12.5 45678 23456 google-chrome --type=renderer'))
      .toEqual({
        pid: 1234,
        cpuPercent: 12.5,
        rssKb: 45678,
        pssKb: 23456,
        command: 'google-chrome',
        args: '--type=renderer',
      });
  });

  it('keeps only processes belonging to the selected WSL test profile', () => {
    expect(selectWslChromeProcesses([
      { pid: 1, cpuPercent: 1, rssKb: 100, command: 'chrome', args: '--user-data-dir=/tmp/selected' },
      { pid: 2, cpuPercent: 2, rssKb: 200, command: 'chrome', args: '--user-data-dir=/tmp/other' },
      { pid: 3, cpuPercent: 3, rssKb: 300, command: 'chrome_crashpad', args: '--database=/tmp/crash' },
    ], '/tmp/selected')).toEqual([
      { pid: 1, cpuPercent: 1, rssKb: 100, command: 'chrome', args: '--user-data-dir=/tmp/selected' },
    ]);
  });

  it('recognizes only real pages under the expected extension origin', () => {
    expect(isWslExtensionPageUrl(
      'chrome-extension://test-extension/dashboard/dashboard.html#tab-home',
      'test-extension',
    )).toBe(true);
    expect(isWslExtensionPageUrl(
      'chrome-error://chromewebdata/',
      'test-extension',
    )).toBe(false);
    expect(isWslExtensionPageUrl(
      'chrome-extension://other-extension/dashboard/dashboard.html',
      'test-extension',
    )).toBe(false);
  });

  it('normalizes only safe Dashboard hashes for WSL fixture scenarios', () => {
    expect(parseWslDashboardHash(undefined)).toBe('#tab-home');
    expect(parseWslDashboardHash('tab-media')).toBe('#tab-media');
    expect(parseWslDashboardHash('#tab-records')).toBe('#tab-records');
    expect(parseWslDashboardHash('https://example.com/')).toBe('#tab-home');
  });

  it('parses a safe Dashboard tab sequence and falls back to the initial hash', () => {
    expect(parseWslDashboardTabSequence(undefined, '#tab-media')).toEqual(['#tab-media']);
    expect(parseWslDashboardTabSequence('tab-home, #tab-media, tab-settings, tab-media', '#tab-home'))
      .toEqual(['#tab-home', '#tab-media', '#tab-settings']);
    expect(parseWslDashboardTabSequence('tab-home,tab-media', '#tab-home', 2))
      .toEqual(['#tab-home', '#tab-media', '#tab-home', '#tab-media']);
    expect(parseWslDashboardTabSequence('https://example.com/,bad', '#tab-records'))
      .toEqual(['#tab-records']);
  });

  it('keeps lifecycle navigation enabled by default but allows a direct-page diagnostic run', () => {
    expect(shouldTouchWslDashboardLifecycle(undefined)).toBe(true);
    expect(shouldTouchWslDashboardLifecycle('1')).toBe(true);
    expect(shouldTouchWslDashboardLifecycle('0')).toBe(false);
    expect(shouldTouchWslDashboardLifecycle('false')).toBe(false);
  });

  it('rejects a target that reports an extension URL but actually rendered Chrome error page', () => {
    expect(inspectWslExtensionPageRuntime({
      expectedExtensionId: 'test-extension',
      pageRuntime: {
        url: 'chrome-error://chromewebdata/',
        domNodes: 34,
        appRootMounted: false,
        bodyText: 'ERR_FILE_NOT_FOUND',
      },
    })).toEqual({
      ok: false,
      reason: '扩展页面实际导航到错误页，不能形成性能证据。',
    });
  });

  it('requires the dashboard root to be mounted before accepting extension samples', () => {
    expect(inspectWslExtensionPageRuntime({
      expectedExtensionId: 'test-extension',
      pageRuntime: {
        url: 'chrome-extension://test-extension/dashboard/dashboard.html#tab-home',
        domNodes: 32,
        appRootMounted: false,
        bodyText: '',
      },
    })).toEqual({
      ok: false,
      reason: '扩展页面已导航成功，但 Dashboard 尚未挂载，不能形成性能证据。',
    });
  });

  it('accepts a mounted extension dashboard runtime', () => {
    expect(inspectWslExtensionPageRuntime({
      expectedExtensionId: 'test-extension',
      pageRuntime: {
        url: 'chrome-extension://test-extension/dashboard/dashboard.html#tab-home',
        domNodes: 128,
        appRootMounted: true,
        bodyText: 'Dashboard',
      },
    })).toEqual({ ok: true, reason: null });
  });

  it('summarizes only Chrome processes', () => {
    expect(summarizeWslChromeProcesses([
      { pid: 1, cpuPercent: 10, rssKb: 100 },
      { pid: 2, cpuPercent: 20, rssKb: 200 },
    ])).toEqual({ processCount: 2, cpuPercent: 30, rssKb: 300 });
  });

  it('summarizes PSS only when the process rows provide it', () => {
    expect(summarizeWslChromeProcesses([
      { pid: 1, cpuPercent: 10, rssKb: 100, pssKb: 60 },
      { pid: 2, cpuPercent: 20, rssKb: 200, pssKb: 90 },
    ])).toEqual({ processCount: 2, cpuPercent: 30, rssKb: 300, pssKb: 150 });
  });

  it('aggregates direct page event listeners by target and type', () => {
    expect(summarizeWslEventListeners({
      window: [{ type: 'resize' }, { type: 'drive115:tokenRefresh' }],
      document: [{ type: 'keydown' }],
      documentRoot: [{ type: 'keydown' }, { type: 'click' }],
    })).toEqual({
      targetCounts: { window: 2, document: 1, documentRoot: 2 },
      typeCounts: [
        { type: '[REDACTED]', count: 1 },
        { type: 'click', count: 1 },
        { type: 'keydown', count: 2 },
        { type: 'resize', count: 1 },
      ],
    });
  });

  it('summarizes listener-bearing descendants without exposing element text or URLs', () => {
    expect(summarizeWslContainerEventListeners([
      { selector: '#app-root', matchedCount: 120, inspectedCount: 120, listenerCount: 4, listenerTypeCounts: { click: 2, resize: 2 } },
      { selector: '#tab-media', matchedCount: 120, inspectedCount: 120, listenerCount: 4, listenerTypeCounts: { click: 2, resize: 2 } },
      { selector: '.ml-card', matchedCount: 48, inspectedCount: 48, listenerCount: 96, listenerTypeCounts: { click: 48, pointerdown: 48 } },
    ])).toEqual({
      selectors: [
        { selector: '#app-root', matchedCount: 120, inspectedCount: 120, listenerCount: 4, listenerTypeCounts: { click: 2, resize: 2 } },
        { selector: '#tab-media', matchedCount: 120, inspectedCount: 120, listenerCount: 4, listenerTypeCounts: { click: 2, resize: 2 } },
        { selector: '.ml-card', matchedCount: 48, inspectedCount: 48, listenerCount: 96, listenerTypeCounts: { click: 48, pointerdown: 48 } },
      ],
      totalMatchedCount: 288,
      totalInspectedCount: 288,
      totalListenerCount: 104,
      listenerTypeCounts: { click: 52, pointerdown: 48, resize: 4 },
    });
  });

  it('attributes WSL Chrome memory and CPU to process categories', () => {
    expect(summarizeWslChromeProcessesByCategory([
      { pid: 1, cpuPercent: 10, rssKb: 100, command: 'chrome', args: '--type=renderer' },
      { pid: 2, cpuPercent: 20, rssKb: 200, command: 'chrome', args: '--type=gpu-process' },
      { pid: 3, cpuPercent: 30, rssKb: 300, command: 'chrome', args: '--type=utility' },
      { pid: 4, cpuPercent: 40, rssKb: 400, command: 'chrome', args: '--user-data-dir=/tmp/test' },
    ])).toEqual({
      renderer: { processCount: 1, cpuPercent: 10, rssKb: 100 },
      gpu: { processCount: 1, cpuPercent: 20, rssKb: 200 },
      utility: { processCount: 1, cpuPercent: 30, rssKb: 300 },
      browser: { processCount: 1, cpuPercent: 40, rssKb: 400 },
    });
  });

  it('exposes process attribution peaks in the diagnostic snapshot', () => {
    const snapshot = buildWslDiagnosticSnapshot('media', [
      {
        at: 1_000,
        processSummary: { processCount: 4, cpuPercent: 20, rssKb: 1_000, pssKb: 800 },
        processSummaryByCategory: {
          renderer: { processCount: 1, cpuPercent: 12, rssKb: 700, pssKb: 600 },
          gpu: { processCount: 1, cpuPercent: 4, rssKb: 100, pssKb: 80 },
          browser: { processCount: 1, cpuPercent: 2, rssKb: 150, pssKb: 120 },
          utility: { processCount: 1, cpuPercent: 2, rssKb: 50, pssKb: 40 },
        },
        processSummaryByRole: {
          'extension-renderer': { processCount: 1, cpuPercent: 12, rssKb: 700, pssKb: 600 },
          gpu: { processCount: 1, cpuPercent: 4, rssKb: 100, pssKb: 80 },
        },
      },
      {
        at: 2_000,
        processSummary: { processCount: 4, cpuPercent: 18, rssKb: 1_200, pssKb: 950 },
        processSummaryByCategory: {
          renderer: { processCount: 1, cpuPercent: 9, rssKb: 500, pssKb: 400 },
          gpu: { processCount: 1, cpuPercent: 7, rssKb: 500, pssKb: 450 },
          browser: { processCount: 1, cpuPercent: 1, rssKb: 150, pssKb: 60 },
          utility: { processCount: 1, cpuPercent: 1, rssKb: 50, pssKb: 40 },
        },
        processSummaryByRole: {
          'extension-renderer': { processCount: 1, cpuPercent: 9, rssKb: 500, pssKb: 400 },
          gpu: { processCount: 1, cpuPercent: 7, rssKb: 500, pssKb: 450 },
        },
      },
    ]);

    expect(snapshot.processAttribution.peakByCategory).toEqual({
      renderer: { at: 1_000, processCount: 1, cpuPercent: 12, rssKb: 700, pssKb: 600 },
      gpu: { at: 2_000, processCount: 1, cpuPercent: 7, rssKb: 500, pssKb: 450 },
      browser: { at: 1_000, processCount: 1, cpuPercent: 2, rssKb: 150, pssKb: 120 },
      utility: { at: 1_000, processCount: 1, cpuPercent: 2, rssKb: 50, pssKb: 40 },
    });
    expect(snapshot.processAttribution.peakByRole).toEqual({
      'extension-renderer': { at: 1_000, processCount: 1, cpuPercent: 12, rssKb: 700, pssKb: 600 },
      gpu: { at: 2_000, processCount: 1, cpuPercent: 7, rssKb: 500, pssKb: 450 },
    });
  });

  it('summarizes non-DOM EventTarget diagnostics without retaining object values', () => {
    expect(summarizeWslEventTargetSamples([
      {
        prototypeName: 'AbortSignal',
        matchedCount: 4,
        inspectedCount: 4,
        domLikeCount: 0,
        nonDomCount: 4,
        listenerCount: 6,
        domListenerCount: 0,
        nonDomListenerCount: 6,
        constructorCounts: { AbortSignal: 4 },
        nonDomConstructorCounts: { AbortSignal: 4 },
        listenerTypeCounts: { abort: 4, error: 2 },
      },
      {
        prototypeName: 'EventTarget',
        matchedCount: 20,
        inspectedCount: 5,
        domLikeCount: 3,
        nonDomCount: 2,
        listenerCount: 3,
        domListenerCount: 1,
        nonDomListenerCount: 2,
        constructorCounts: { HTMLDivElement: 3, EventTarget: 2 },
        nonDomConstructorCounts: { EventTarget: 2 },
        listenerTypeCounts: { click: 1, message: 2 },
      },
    ])).toEqual({
      prototypes: [
        {
          prototypeName: 'AbortSignal',
          matchedCount: 4,
          inspectedCount: 4,
          domLikeCount: 0,
          nonDomCount: 4,
          listenerCount: 6,
          domListenerCount: 0,
          nonDomListenerCount: 6,
          constructorCounts: { AbortSignal: 4 },
          nonDomConstructorCounts: { AbortSignal: 4 },
          listenerTypeCounts: { abort: 4, error: 2 },
        },
        {
          prototypeName: 'EventTarget',
          matchedCount: 20,
          inspectedCount: 5,
          domLikeCount: 3,
          nonDomCount: 2,
          listenerCount: 3,
          domListenerCount: 1,
          nonDomListenerCount: 2,
          constructorCounts: { HTMLDivElement: 3, EventTarget: 2 },
          nonDomConstructorCounts: { EventTarget: 2 },
          listenerTypeCounts: { click: 1, message: 2 },
        },
      ],
      totalNonDomCount: 6,
      totalNonDomListenerCount: 8,
    });
  });

  it('builds a bounded WSL diagnostic summary from process samples', () => {
    const result = buildWslDiagnosticSnapshot('wsl-home', [
      { at: 1_000, processSummary: { processCount: 1, cpuPercent: 5, rssKb: 100 } },
      { at: 2_000, processSummary: { processCount: 1, cpuPercent: 7, rssKb: 150 } },
      { at: 3_000, processSummary: { processCount: 1, cpuPercent: 4, rssKb: 120 } },
    ], 2);

    expect(result.samples).toEqual([
      { phase: 'steady', module: 'wsl.chrome', at: 2_000, rssBytes: 153_600, cpuPercent: 7 },
      { phase: 'steady', module: 'wsl.chrome', at: 3_000, rssBytes: 122_880, cpuPercent: 4 },
    ]);
    expect(result.summary).toEqual({
      sampleCount: 2,
      peakRssBytes: 153_600,
      peakCpuPercent: 7,
      steadyRssSlopeBytesPerSecond: -30_720,
      peakJsHeapUsedBytes: null,
      steadyJsHeapSlopeBytesPerSecond: 0,
      longTaskCount: 0,
      longTaskP95Ms: null,
      lifecycleCounts: {},
      cooldownRssBytes: null,
    });
  });

  it('prefers a Dashboard page over Popup and source pages', () => {
    expect(selectWslPageIndex([
      'chrome-extension://extension-id/popup/popup.html',
      'https://javdb.com/',
      'chrome-extension://extension-id/dashboard/dashboard.html#tab-home',
    ])).toBe(2);
  });

  it('keeps only the selected page target during isolated host-data sampling', () => {
    expect(selectWslPageTargetIdsToClose([
      { targetId: 'dashboard', type: 'page', url: 'chrome-extension://id/dashboard/dashboard.html' },
      { targetId: 'source', type: 'page', url: 'https://javdb.com/' },
      { targetId: 'worker', type: 'service_worker', url: 'chrome-extension://id/service_worker.js' },
    ], 'dashboard')).toEqual(['source']);
  });

  it('recognizes a CDP target race without masking unrelated probe errors', () => {
    expect(isMissingWslTargetError(new Error('No target with given id found'))).toBe(true);
    expect(isMissingWslTargetError(new Error('CDP command timed out'))).toBe(false);
  });

  it('summarizes storage size and media metadata without retaining values', () => {
    expect(summarizeWslStorageValue({
      entries: [
        { nfoSummary: { plot: 'private plot', title: 'A' }, imageUrls: { Primary: 'https://example.test/a' } },
        { nfoSummary: { title: 'B' } },
      ],
    })).toEqual({
      jsonBytes: 142,
      entryCount: 2,
      nfoSummaryChars: 48,
      imageUrlChars: 22,
    });
  });

  it('summarizes all storage keys by size without retaining storage values', () => {
    const result = summarizeWslStorageCollection({
      small: 'x',
      medium: '123456789',
      large: { entries: [1, 2, 3] },
    }, 2);

    expect(result.keyCount).toBe(3);
    expect(result.totalJsonBytes).toBe(
      JSON.stringify('x').length
      + JSON.stringify('123456789').length
      + JSON.stringify({ entries: [1, 2, 3] }).length,
    );
    expect(result.largestKeys).toHaveLength(2);
    expect(result.largestKeys[0]?.key).toBe('large');
    expect(result.largestKeys[0]?.jsonBytes).toBe(JSON.stringify({ entries: [1, 2, 3] }).length);
    expect(result).not.toHaveProperty('values');
  });

  it('keeps only numeric origin storage usage and breakdown fields', () => {
    expect(summarizeWslOriginStorageUsage({
      usage: 1234,
      quota: 9876,
      usageBreakdown: [
        { storageType: 'indexeddb', usage: 900 },
        { storageType: 'cache_storage', usage: 300 },
        { storageType: 'opaque', usage: 'private' },
      ],
    })).toEqual({
      usageBytes: 1234,
      quotaBytes: 9876,
      breakdown: [
        { storageType: 'indexeddb', usageBytes: 900 },
        { storageType: 'cache_storage', usageBytes: 300 },
      ],
    });
  });
});
