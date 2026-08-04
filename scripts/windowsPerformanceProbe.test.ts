import { describe, expect, it } from 'vitest';
import {
  aggregateWindowsProcessSamples,
  aggregateWindowsProcessSamplesByCategory,
  buildPerformanceMediaFixture,
  buildContentStressHtml,
  buildJavDbStressHtml,
  normalizeChromeProcessCategory,
  parseChromeTargetInfos,
  parsePerformanceScenarioSelection,
  redactDiagnosticUrl,
  selectTrackedWindowsProcessIds,
  selectInitialDashboardHash,
  shouldDisableGpu,
  shouldRunNoExtensionControl,
  shouldRunPerformanceScenario,
  type WindowsProcessSample,
} from './windowsPerformanceProbe';

describe('windows performance probe helpers', () => {
  it('parses an optional comma-separated scenario selection', () => {
    expect(parsePerformanceScenarioSelection(undefined)).toBeNull();
    expect(parsePerformanceScenarioSelection('all')).toBeNull();
    expect(parsePerformanceScenarioSelection(' dashboard-home, drive115-index-mock-12 '))
      .toEqual(new Set(['dashboard-home', 'drive115-index-mock-12']));
    expect(shouldRunPerformanceScenario(null, 'dashboard-home')).toBe(true);
    expect(shouldRunPerformanceScenario(new Set(['dashboard-home']), 'dashboard-home')).toBe(true);
    expect(shouldRunPerformanceScenario(new Set(['dashboard-home']), 'media-library-1289-items')).toBe(false);
    expect(selectInitialDashboardHash(null)).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['dashboard-home']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['dashboard-multi-tab']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['popup-dashboard-reuse']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['dashboard-javdb-multi-tab']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['dashboard-insights-message-churn']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['dashboard-media-115-multi-tab']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['dashboard-media-115-same-tab']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['dashboard-tab-switch-churn']))).toBe('#tab-home');
    expect(selectInitialDashboardHash(new Set(['media-library-1289-items']))).toBe('#tab-media');
  });

  it('runs the tab-switch churn scenario from a single home dashboard', () => {
    expect(shouldRunPerformanceScenario(new Set(['dashboard-tab-switch-churn']), 'dashboard-tab-switch-churn')).toBe(true);
    expect(shouldRunPerformanceScenario(new Set(['dashboard-tab-switch-churn']), 'dashboard-home')).toBe(false);
  });

  it('enables GPU-disabled diagnostics only for an explicit probe flag', () => {
    expect(shouldDisableGpu('1')).toBe(true);
    expect(shouldDisableGpu('true')).toBe(true);
    expect(shouldDisableGpu('0')).toBe(false);
    expect(shouldDisableGpu(undefined)).toBe(false);
  });

  it('enables the no-extension control only for explicit truthy probe flags', () => {
    expect(shouldRunNoExtensionControl('1')).toBe(true);
    expect(shouldRunNoExtensionControl('true')).toBe(true);
    expect(shouldRunNoExtensionControl('TRUE')).toBe(true);
    expect(shouldRunNoExtensionControl('0')).toBe(false);
    expect(shouldRunNoExtensionControl(undefined)).toBe(false);
  });

  it('classifies Chrome CDP process types and keeps CPU attribution per category', () => {
    expect(normalizeChromeProcessCategory('browser')).toBe('browser');
    expect(normalizeChromeProcessCategory('renderer')).toBe('renderer');
    expect(normalizeChromeProcessCategory('GPU')).toBe('gpu');
    expect(normalizeChromeProcessCategory('network.mojom.NetworkService')).toBe('utility');
    expect(normalizeChromeProcessCategory('unrecognized-process')).toBe('other');

    const previous: WindowsProcessSample[] = [
      {
        pid: 201,
        processName: 'chrome',
        processType: 'browser',
        workingSetBytes: 100,
        privateBytes: 80,
        cpuTimeSeconds: 5,
      },
      {
        pid: 202,
        processName: 'chrome',
        processType: 'renderer',
        workingSetBytes: 200,
        privateBytes: 160,
        cpuTimeSeconds: 2,
      },
    ];
    const current: WindowsProcessSample[] = [
      {
        pid: 201,
        processName: 'chrome',
        processType: 'browser',
        workingSetBytes: 120,
        privateBytes: 90,
        cpuTimeSeconds: 6,
      },
      {
        pid: 202,
        processName: 'chrome',
        processType: 'renderer',
        workingSetBytes: 240,
        privateBytes: 180,
        cpuTimeSeconds: 2.5,
      },
      {
        pid: 203,
        processName: 'chrome',
        processType: null,
        workingSetBytes: 60,
        privateBytes: 40,
        cpuTimeSeconds: 10,
      },
    ];

    const groups = aggregateWindowsProcessSamplesByCategory(current, previous, 1_000, 4);
    expect(groups.find((group) => group.processCategory === 'browser')).toMatchObject({
      processCount: 1,
      workingSetBytes: 120,
      privateBytes: 90,
      cpuPercent: 25,
      cpuPercentSingleCore: 100,
    });
    expect(groups.find((group) => group.processCategory === 'renderer')).toMatchObject({
      processCount: 1,
      workingSetBytes: 240,
      privateBytes: 180,
      cpuPercent: 12.5,
      cpuPercentSingleCore: 50,
    });
    expect(groups.find((group) => group.processCategory === 'unclassified')).toMatchObject({
      processCount: 1,
      workingSetBytes: 60,
      privateBytes: 40,
      cpuPercent: 0,
      cpuPercentSingleCore: 0,
    });
  });

  it('parses and redacts Chrome target inventory by extension and website category', () => {
    expect(parseChromeTargetInfos({
      targetInfos: [
        {
          targetId: 'extension-page',
          type: 'page',
          title: 'Dashboard',
          url: 'chrome-extension://abcdefghijklmnop/dashboard/dashboard.html?token=secret#tab-media',
          attached: true,
        },
        {
          targetId: 'extension-worker',
          type: 'service_worker',
          title: '',
          url: 'chrome-extension://abcdefghijklmnop/background.js',
          attached: true,
        },
        {
          targetId: 'website-page',
          type: 'page',
          title: 'JavDB',
          url: 'https://javdb.com/search?q=secret',
          attached: false,
        },
      ],
    })).toEqual([
      {
        targetId: 'extension-page',
        type: 'page',
        title: 'Dashboard',
        url: 'chrome-extension://abcdefghijklmnop/dashboard/dashboard.html',
        attached: true,
        category: 'extension',
      },
      {
        targetId: 'extension-worker',
        type: 'service_worker',
        title: '',
        url: 'chrome-extension://abcdefghijklmnop/background.js',
        attached: true,
        category: 'extension',
      },
      {
        targetId: 'website-page',
        type: 'page',
        title: 'JavDB',
        url: 'https://javdb.com/search',
        attached: false,
        category: 'website',
      },
    ]);
  });

  it('aggregates Chrome process memory and CPU over a sampling interval', () => {
    const previous: WindowsProcessSample[] = [
      {
        pid: 101,
        processName: 'chrome',
        workingSetBytes: 100,
        privateBytes: 80,
        cpuTimeSeconds: 10,
      },
    ];
    const current: WindowsProcessSample[] = [
      {
        pid: 101,
        processName: 'chrome',
        workingSetBytes: 140,
        privateBytes: 120,
        cpuTimeSeconds: 12,
      },
      {
        pid: 102,
        processName: 'chrome',
        workingSetBytes: 60,
        privateBytes: 50,
        cpuTimeSeconds: 4,
      },
    ];

    expect(aggregateWindowsProcessSamples(current, previous, 1_000, 4)).toEqual({
      processCount: 2,
      workingSetBytes: 200,
      privateBytes: 170,
      cpuPercent: 50,
      cpuPercentSingleCore: 200,
    });
  });

  it('removes credentials and query parameters from diagnostic URLs', () => {
    expect(redactDiagnosticUrl('https://user:secret@example.com/path?a=token&b=2'))
      .toBe('https://example.com/path');
    expect(redactDiagnosticUrl('chrome-extension://abcdefghijklmnop/dashboard/dashboard.html#tab-home'))
      .toBe('chrome-extension://abcdefghijklmnop/dashboard/dashboard.html');
    expect(redactDiagnosticUrl('not a url')).toBe('[invalid-url]');
  });

  it('tracks only process IDs that were not present before the probe started', () => {
    expect(selectTrackedWindowsProcessIds([10, 11, 12], new Set([10, 12])))
      .toEqual([11]);
  });

  it('builds a deterministic multi-source fixture without credentials or media URLs', () => {
    const fixture = buildPerformanceMediaFixture(3);
    expect(Object.keys(fixture.emby_library_state.entries)).toHaveLength(3);
    expect(fixture.drive115_library_state.entries).toHaveLength(3);
    expect(fixture.emby_library_state.entries['PERF-0002'][0].itemName).toBe('PERF-0002 测试影片');
    expect(fixture.drive115_library_state.entries[1].pickCode).toBe('perf-pick-2');
    expect(JSON.stringify(fixture)).not.toMatch(/password|token|apiKey|https?:\/\//i);
  });

  it('adds deterministic local cover URLs only when a cover server is requested', () => {
    const fixture = buildPerformanceMediaFixture(1, Date.now(), 'http://127.0.0.1:43123/covers');
    expect(fixture.emby_library_state.entries['PERF-0001'][0].imageUrls?.Thumb)
      .toBe('http://127.0.0.1:43123/covers/PERF-0001.jpg');
  });

  it('builds a local DOM stress page without external requests', () => {
    const html = buildContentStressHtml();
    expect(html).toContain('data-performance-stress="1"');
    expect(html).toContain('type="password"');
    expect(html).toContain('setTimeout');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('builds a JavDB-shaped list fixture for the real content-script match', () => {
    const html = buildJavDbStressHtml(3);
    expect(html).toContain('data-javdb-performance-stress="1"');
    expect(html).toContain('class="movie-list"');
    expect(html.match(/class="item"/g)).toHaveLength(3);
    expect(html).toContain('PERF-0001');
    expect(html).not.toContain('https://');
  });
});
