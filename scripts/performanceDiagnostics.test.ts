import { describe, expect, it } from 'vitest';

import {
  createDiagnosticSession,
  redactDiagnosticPayload,
  summarizeDiagnosticSamples,
  type DiagnosticSample,
} from './performanceDiagnostics';

describe('performance diagnostics', () => {
  it('redacts credentials, tokens and URL query parameters recursively', () => {
    const result = redactDiagnosticPayload({
      url: 'https://example.test/api?access_token=secret&item=video-1',
      headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
      nested: [{ password: 'secret', title: 'must not be collected' }],
    });

    expect(result).toEqual({
      url: 'https://example.test/api?redacted=1',
      headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' },
      nested: [{ password: '[REDACTED]', title: '[REDACTED]' }],
    });
  });

  it('preserves extension URL origins while removing query details', () => {
    expect(redactDiagnosticPayload(
      'chrome-extension://extension-id/dashboard/dashboard.html?tab=media#detail',
      'url',
    )).toBe('chrome-extension://extension-id/dashboard/dashboard.html?redacted=1');
  });

  it('keeps only a bounded sample window and stops accepting samples after stop', () => {
    const session = createDiagnosticSession({ scenarioId: 'wsl-home', maxSamples: 2 });

    session.record({ phase: 'cold', module: 'dashboard', at: 1, rssBytes: 100, cpuPercent: 1 });
    session.record({ phase: 'warmup', module: 'dashboard', at: 2, rssBytes: 200, cpuPercent: 2 });
    session.record({ phase: 'steady', module: 'dashboard', at: 3, rssBytes: 300, cpuPercent: 3 });
    session.stop();
    session.record({ phase: 'cooldown', module: 'dashboard', at: 4, rssBytes: 400, cpuPercent: 4 });

    expect(session.snapshot()).toEqual({
      scenarioId: 'wsl-home',
      stopped: true,
      samples: [
        { phase: 'warmup', module: 'dashboard', at: 2, rssBytes: 200, cpuPercent: 2 },
        { phase: 'steady', module: 'dashboard', at: 3, rssBytes: 300, cpuPercent: 3 },
      ],
    });
  });

  it('summarizes peak values and the steady RSS slope without retaining raw payloads', () => {
    const samples: DiagnosticSample[] = [
      { phase: 'steady', module: 'dashboard', at: 1_000, rssBytes: 100, cpuPercent: 5 },
      { phase: 'steady', module: 'dashboard', at: 2_000, rssBytes: 150, cpuPercent: 7 },
      { phase: 'cooldown', module: 'dashboard', at: 3_000, rssBytes: 120, cpuPercent: 2 },
    ];

    expect(summarizeDiagnosticSamples(samples)).toEqual({
      sampleCount: 3,
      peakRssBytes: 150,
      peakCpuPercent: 7,
      steadyRssSlopeBytesPerSecond: 50,
      peakJsHeapUsedBytes: null,
      steadyJsHeapSlopeBytesPerSecond: 0,
      longTaskCount: 0,
      longTaskP95Ms: null,
      lifecycleCounts: {},
      cooldownRssBytes: 120,
    });
  });

  it('summarizes long-task p95, heap slope and the latest lifecycle counters', () => {
    const samples = [
      {
        phase: 'steady',
        module: 'dashboard',
        at: 1_000,
        rssBytes: 100,
        cpuPercent: 5,
        jsHeapUsedBytes: 1_000,
        longTaskDurationsMs: [10, 30],
        lifecycleCounts: { 'tab-media:active': 1 },
      },
      {
        phase: 'steady',
        module: 'dashboard',
        at: 2_000,
        rssBytes: 150,
        cpuPercent: 7,
        jsHeapUsedBytes: 1_300,
        longTaskDurationsMs: [40],
        lifecycleCounts: { 'tab-media:active': 1, 'tab-media:hidden': 1 },
      },
      {
        phase: 'cooldown',
        module: 'dashboard',
        at: 3_000,
        rssBytes: 120,
        cpuPercent: 2,
        jsHeapUsedBytes: 1_100,
        longTaskDurationsMs: [],
        lifecycleCounts: { 'tab-media:active': 1, 'tab-media:hidden': 1, 'tab-media:dispose': 1 },
      },
    ] as unknown as DiagnosticSample[];

    expect(summarizeDiagnosticSamples(samples)).toMatchObject({
      longTaskCount: 3,
      longTaskP95Ms: 40,
      steadyJsHeapSlopeBytesPerSecond: 300,
      peakJsHeapUsedBytes: 1_300,
      lifecycleCounts: { 'tab-media:active': 1, 'tab-media:hidden': 1, 'tab-media:dispose': 1 },
    });
  });

  it('merges lifecycle counters across page reloads without double counting cumulative samples', () => {
    const samples = [
      {
        phase: 'steady' as const,
        module: 'dashboard',
        at: 1_000,
        rssBytes: 100,
        cpuPercent: 1,
        lifecycleCounts: { 'tab-home:active': 1, 'tab-media:active': 1 },
      },
      {
        phase: 'steady' as const,
        module: 'dashboard',
        at: 2_000,
        rssBytes: 110,
        cpuPercent: 1,
        lifecycleCounts: { 'tab-home:hidden': 1, 'tab-media:active': 1 },
      },
    ];

    expect(summarizeDiagnosticSamples(samples).lifecycleCounts).toEqual({
      'tab-home:active': 1,
      'tab-home:hidden': 1,
      'tab-media:active': 1,
    });
  });
});
