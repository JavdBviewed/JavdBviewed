import { describe, expect, it } from 'vitest';

import {
  evaluateWslPerformanceReport,
  type WslPerformanceGatePolicy,
} from './performanceRegressionGate';

function makeReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    extensionRuntime: {
      ok: true,
      extensionPageCount: 1,
      serviceWorkerCount: 1,
      reason: null,
    },
    extensionPageRuntime: {
      url: 'chrome-extension://test-extension/dashboard/dashboard.html#tab-media',
      domNodes: 2_258,
      appRootMounted: true,
    },
    diagnostic: {
      summary: {
        sampleCount: 12,
        peakRssBytes: 700 * 1024 * 1024,
        peakCpuPercent: 60,
        steadyRssSlopeBytesPerSecond: 1_000,
        peakJsHeapUsedBytes: 30_000,
        steadyJsHeapSlopeBytesPerSecond: 100,
        longTaskCount: 3,
        longTaskP95Ms: 40,
        lifecycleCounts: {
          'tab-media:active': 1,
          'tab-media:hidden': 1,
          'tab-media:dispose': 1,
        },
        cooldownRssBytes: 650 * 1024 * 1024,
      },
    },
    scenarios: [{
      name: 'wsl-javdb-dashboard-tab-media',
      tabCount: 1,
      samples: [{
        page: {
          url: 'chrome-extension://test-extension/dashboard/dashboard.html?redacted=1',
          domNodes: 2_258,
        },
      }],
    }],
    ...overrides,
  };
}

describe('WSL performance regression gate', () => {
  it('rejects a report that is actually an error page or has no mounted extension', () => {
    const result = evaluateWslPerformanceReport({
      ...makeReport(),
      extensionRuntime: { ok: false, extensionPageCount: 0, serviceWorkerCount: 0 },
      extensionPageRuntime: {
        url: 'chrome-error://chromewebdata/',
        appRootMounted: false,
      },
    }, { requiredScenarioNames: ['wsl-javdb-dashboard-tab-media'] });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'invalid-extension-runtime',
      'invalid-page-runtime',
    ]);
  });

  it('accepts a valid report with the required scenario and redacted payload', () => {
    const result = evaluateWslPerformanceReport(
      makeReport(),
      { requiredScenarioNames: ['wsl-javdb-dashboard-tab-media'] },
    );

    expect(result).toEqual({ ok: true, issues: [], metrics: {
      peakRssBytes: 700 * 1024 * 1024,
      peakCpuPercent: 60,
      steadyRssSlopeBytesPerSecond: 1_000,
      peakJsHeapUsedBytes: 30_000,
      steadyJsHeapSlopeBytesPerSecond: 100,
      longTaskCount: 3,
      longTaskP95Ms: 40,
      lifecycleCounts: {
        'tab-media:active': 1,
        'tab-media:hidden': 1,
        'tab-media:dispose': 1,
      },
      cooldownRssBytes: 650 * 1024 * 1024,
    } });
  });

  it('accepts a browser baseline without extension runtime or page evidence', () => {
    const report = makeReport({
      extensionRuntime: null,
      extensionPageRuntime: null,
    });

    const result = evaluateWslPerformanceReport(report, {
      requireExtensionRuntime: false,
      requireExtensionPage: false,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a current report that exceeds the baseline tolerance', () => {
    const policy: WslPerformanceGatePolicy = {
      requiredScenarioNames: ['wsl-javdb-dashboard-tab-media'],
      baseline: {
        peakRssBytes: 600 * 1024 * 1024,
        peakCpuPercent: 50,
        steadyRssSlopeBytesPerSecond: 500,
      },
      toleranceRatio: 0.1,
    };

    const result = evaluateWslPerformanceReport(makeReport(), policy);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'peak-rss-regression',
      'peak-cpu-regression',
      'rss-slope-regression',
    ]);
  });

  it('rejects a report containing raw sensitive diagnostic fields', () => {
    const result = evaluateWslPerformanceReport({
      ...makeReport(),
      leaked: { access_token: 'secret' },
    }, {});

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('sensitive-payload');
  });

  it('requires long-task, lifecycle and cooldown evidence when the policy enables it', () => {
    const result = evaluateWslPerformanceReport(makeReport(), {
      requiredScenarioNames: ['wsl-javdb-dashboard-tab-media'],
      requireLongTaskMetrics: true,
      requiredLifecycleEvents: ['tab-media:active', 'tab-media:hidden', 'tab-media:dispose'],
      requireCooldownRecovery: true,
    });

    expect(result.ok).toBe(true);

    const missing = evaluateWslPerformanceReport(makeReport({
      diagnostic: { summary: { ...((makeReport().diagnostic as Record<string, unknown>).summary as Record<string, unknown>), cooldownRssBytes: null, longTaskP95Ms: null, lifecycleCounts: {} } },
    }), {
      requireLongTaskMetrics: true,
      requiredLifecycleEvents: ['tab-media:dispose'],
      requireCooldownRecovery: true,
    });

    expect(missing.ok).toBe(false);
    expect(missing.issues.map((issue) => issue.code)).toEqual([
      'missing-long-task-metrics',
      'missing-lifecycle-event',
      'missing-cooldown-recovery',
    ]);
  });

  it('accepts restore as the activation event when a tab is revisited from the initial route', () => {
    const result = evaluateWslPerformanceReport(makeReport({
      diagnostic: {
        summary: {
          ...((makeReport().diagnostic as Record<string, unknown>).summary as Record<string, unknown>),
          lifecycleCounts: {
            'tab-media:initialize': 1,
            'tab-media:restore': 1,
            'tab-media:dispose': 1,
          },
        },
      },
    }), {
      requiredLifecycleEvents: ['tab-media:initialize', 'tab-media:dispose'],
      requiredLifecycleEventGroups: [['tab-media:active', 'tab-media:restore']],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a lifecycle group when neither activation event was recorded', () => {
    const result = evaluateWslPerformanceReport(makeReport({
      diagnostic: {
        summary: {
          ...((makeReport().diagnostic as Record<string, unknown>).summary as Record<string, unknown>),
          lifecycleCounts: {
            'tab-media:initialize': 1,
            'tab-media:dispose': 1,
          },
        },
      },
    }), {
      requiredLifecycleEvents: ['tab-media:initialize', 'tab-media:dispose'],
      requiredLifecycleEventGroups: [['tab-media:active', 'tab-media:restore']],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['missing-lifecycle-event']);
  });
});
