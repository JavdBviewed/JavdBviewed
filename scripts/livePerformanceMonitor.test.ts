import { describe, expect, it } from 'vitest';
import {
  buildLiveMonitorEvents,
  buildLiveMonitorPgrepArgs,
  selectLiveMonitorSourceUrls,
  summarizeLiveMonitorTaskCenter,
  parseLiveMonitorProcessListing,
  parseLiveMonitorPidListing,
  shouldRefreshLiveMonitorPss,
  shouldRefreshLiveMonitorPage,
  shouldRefreshLiveMonitorTasks,
  selectLiveMonitorChromeProcesses,
  type LiveMonitorProcess,
} from './livePerformanceMonitor';

describe('livePerformanceMonitor', () => {
  it('places a long task on the wall-clock timeline and attributes it to the latest tab activation', () => {
    const events = buildLiveMonitorEvents({
      sampledAt: 1_000_000,
      pageNow: 800,
      longTaskEntries: [{ startTime: 620, duration: 280 }],
      tabActivationMarks: [
        { tabId: 'tab-records', phase: 'content-active', at: 500 },
        { tabId: 'tab-new-works', phase: 'content-active', at: 600 },
      ],
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'activation',
        tabId: 'tab-records',
        at: 999_700,
      }),
      expect.objectContaining({
        kind: 'activation',
        tabId: 'tab-new-works',
        at: 999_800,
      }),
      expect.objectContaining({
        kind: 'long-task',
        tabId: 'tab-new-works',
        at: 999_820,
        duration: 280,
      }),
    ]);
  });

  it('retains prior activation marks to identify long tasks from a later monitor batch', () => {
    const events = buildLiveMonitorEvents({
      sampledAt: 1_000_000,
      pageNow: 1_000,
      longTaskEntries: [{ startTime: 900, duration: 280 }],
      tabActivationMarks: [],
      activationHistory: [
        { tabId: 'tab-records', phase: 'content-active', at: 600 },
        { tabId: 'tab-records', phase: 'initialize-start', at: 650 },
        { tabId: 'tab-records', phase: 'initialize-complete', at: 750 },
      ],
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'long-task',
        tabId: 'tab-records',
        at: 999_900,
        duration: 280,
        afterContentActiveMs: 300,
        afterInitializeStartMs: 250,
        afterInitializeCompleteMs: 150,
      }),
    ]);
  });

  it('selects only Chrome processes belonging to the isolated performance profile', () => {
    const processes: LiveMonitorProcess[] = [
      { pid: 11, cpuJiffies: 10, rssKb: 20, pssKb: 30, args: '--user-data-dir=/tmp/javdb-14k-profile-KdfuMW --type=renderer' },
      { pid: 12, cpuJiffies: 10, rssKb: 20, pssKb: 30, args: '--user-data-dir=/home/ryen/.config/google-chrome --type=renderer' },
    ];

    expect(selectLiveMonitorChromeProcesses(processes, '/tmp/javdb-14k-profile-KdfuMW')).toEqual([processes[0]]);
  });

  it('finds only the isolated profile PIDs before reading process details', () => {
    expect(parseLiveMonitorProcessListing(
      '11 /opt/chrome --user-data-dir=/tmp/javdb-14k-profile-KdfuMW --type=renderer\n'
      + '12 /opt/chrome --user-data-dir=/home/ryen/.config/google-chrome --type=renderer\n'
      + '13 /usr/bin/node worker.js\n',
      '/tmp/javdb-14k-profile-KdfuMW',
    )).toEqual([
      { pid: 11, args: '/opt/chrome --user-data-dir=/tmp/javdb-14k-profile-KdfuMW --type=renderer' },
    ]);
  });

  it('deduplicates valid PIDs returned by the native profile lookup', () => {
    expect(parseLiveMonitorPidListing('11\n12\n11\ninvalid\n0\n')).toEqual([11, 12]);
  });

  it('terminates pgrep options before the profile marker', () => {
    expect(buildLiveMonitorPgrepArgs('/tmp/javdb-14k-profile-KdfuMW')).toEqual([
      '-f',
      '--',
      '--user-data-dir=/tmp/javdb-14k-profile-KdfuMW',
    ]);
  });

  it('refreshes PSS less often than CPU and RSS samples', () => {
    expect(shouldRefreshLiveMonitorPss(undefined, 10_000)).toBe(true);
    expect(shouldRefreshLiveMonitorPss(10_000, 14_999)).toBe(false);
    expect(shouldRefreshLiveMonitorPss(10_000, 15_000)).toBe(true);
  });

  it('batches Dashboard reads while retaining per-second process samples', () => {
    expect(shouldRefreshLiveMonitorPage(undefined, 10_000)).toBe(true);
    expect(shouldRefreshLiveMonitorPage(10_000, 14_999)).toBe(false);
    expect(shouldRefreshLiveMonitorPage(10_000, 15_000)).toBe(true);
  });

  it('selects only original-site URLs from browser targets', () => {
    expect(selectLiveMonitorSourceUrls([
      'https://javdb.com/v/abc',
      'https://javdb570.com/?locale=zh-CN',
      'chrome-extension://extension/dashboard/dashboard.html',
      'https://example.com/',
    ])).toEqual([
      'https://javdb.com/v/abc',
      'https://javdb570.com/?locale=zh-CN',
    ]);
  });

  it('summarizes task allocation with only diagnostic-safe task fields', () => {
    const summary = summarizeLiveMonitorTaskCenter({
      tasks: [
        {
          taskId: 'task-1', label: 'videoEnhancement:runCover', pageType: 'video', phase: 'idle', cost: 'light',
          status: 'running', waitReason: 'bucket-full', progressPct: 35, stage: 'cover', detail: 'secret', metadata: { secret: true },
        },
        {
          taskId: 'task-2', label: 'listEnhancement:init', pageType: 'list', phase: 'high', cost: 'medium',
          status: 'done', endedAt: 9_995,
        },
      ],
    }, 10_000);

    expect(summary.counts).toEqual({ running: 1, done: 1 });
    expect(summary.active).toEqual([{
      label: 'videoEnhancement:runCover', pageType: 'video', phase: 'idle', cost: 'light',
      status: 'running', waitReason: 'bucket-full', progressPct: 35, stage: 'cover',
    }]);
    expect(summary.recent).toEqual([{
      label: 'listEnhancement:init', pageType: 'list', phase: 'high', cost: 'medium', status: 'done',
    }]);
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  it('reads the full task-center snapshot less often than page events', () => {
    expect(shouldRefreshLiveMonitorTasks(undefined, 10_000)).toBe(true);
    expect(shouldRefreshLiveMonitorTasks(10_000, 24_999)).toBe(false);
    expect(shouldRefreshLiveMonitorTasks(10_000, 25_000)).toBe(true);
  });
});
