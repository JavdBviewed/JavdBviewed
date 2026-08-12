import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRemoteDashboardUrl,
  buildRemoteProcessSnapshotInvocation,
  buildRemoteProcessSnapshotCommand,
  calculateRemoteProcessCpuPercent,
  hasUnmappedRemoteExtensionTarget,
  isRemoteExtensionPageUrl,
  isRemoteExternalSyncIsolationSuccessful,
  parseRemotePssScope,
  parseRemoteTabSequence,
  parseRemoteTabSwitchIntervalMs,
  parseRemoteBoolean,
  parseRemoteChromeProcessLine,
} from './remoteCdpPerformanceProbe';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'remoteCdpPerformanceProbe.ts'), 'utf-8');

describe('remote CDP performance probe helpers', () => {
  it('installs the page performance probe after fixture seeding reloads the dashboard', () => {
    const seedIndex = source.indexOf('await seedRemoteData(page, options);');
    const probeIndex = source.indexOf('await page.evaluate(buildWslPerformanceProbeScript());');

    expect(seedIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(seedIndex);
  });

  it('records the hash request timestamp with each tab activation snapshot', () => {
    expect(source).toMatch(/const requestedAt = performance\.now\(\);\s*window\.location\.hash = hash;/);
    expect(source).toMatch(/requestedAt,\s*expectedTabId,/);
  });

  it('finishes tab activation timing before starting resource sampling', () => {
    expect(source).not.toContain('const tabSwitching = page.evaluate');
    expect(source).toMatch(/tabSwitchSnapshots = await page\.evaluate[\s\S]*tabChurnSamples = await samplePage/);
  });

  it('uses the local shell when the process probe runs on the current machine', () => {
    expect(buildRemoteProcessSnapshotInvocation('local', '/tmp/profile')).toEqual({
      file: '/bin/bash',
      args: ['-lc', expect.stringContaining('userDataDir=')],
    });
  });

  it('keeps SSH for an explicit remote process probe host', () => {
    expect(buildRemoteProcessSnapshotInvocation('192.168.0.134', '/opt/profile')).toEqual({
      file: 'ssh',
      args: expect.arrayContaining(['192.168.0.134']),
    });
  });

  it('parses the tab-separated remote process snapshot', () => {
    const args = '/opt/javdb-perf/chrome --type=renderer --user-data-dir=/opt/javd-perf/profiles/smoke';
    const encoded = Buffer.from(args).toString('base64');
    expect(parseRemoteChromeProcessLine(`123\t456\t789\t654\t${encoded}`)).toMatchObject({
      pid: 123,
      cpuJiffies: 456,
      rssKb: 789,
      pssKb: 654,
      args,
    });
  });

  it('rejects malformed or non-Chrome process snapshots', () => {
    expect(parseRemoteChromeProcessLine('bad')).toBeNull();
    const encoded = Buffer.from('/usr/bin/node --user-data-dir=/tmp/profile').toString('base64');
    expect(parseRemoteChromeProcessLine(`123\t456\t789\t654\t${encoded}`)).toBeNull();
  });

  it('uses Linux /proc jiffies to calculate interval CPU', () => {
    expect(calculateRemoteProcessCpuPercent(100, 110, 1_000)).toBe(10);
  });

  it('restricts the remote process command to the configured profile', () => {
    const command = buildRemoteProcessSnapshotCommand('/opt/javdb-perf/profiles/smoke');
    expect(command).toContain('userDataDir=');
    expect(command).toContain('--user-data-dir=$userDataDir');
    expect(command).toContain('smaps_rollup');
    expect(command).toContain('base64');
  });

  it('支持只为扩展进程读取 smaps，降低宿主数据长样本的 SSH 采样开销', () => {
    expect(parseRemotePssScope(undefined)).toBe('all');
    expect(parseRemotePssScope('extension')).toBe('extension');
    const command = buildRemoteProcessSnapshotCommand('/opt/javdb-perf/profiles/smoke', 'extension');
    expect(command).toContain('"--extension-process"');
    expect(command).toContain('pss=0');
  });

  it('规范化远端 Dashboard tab 切换序列并去重', () => {
    expect(parseRemoteTabSequence('tab-home,#tab-media,tab-home,invalid')).toEqual([
      '#tab-home',
      '#tab-media',
    ]);
    expect(parseRemoteTabSequence(undefined)).toEqual([]);
  });

  it('defaults tab activation measurement to a user-paced interval', () => {
    expect(parseRemoteTabSwitchIntervalMs(undefined)).toBe(500);
    expect(parseRemoteTabSwitchIntervalMs('0')).toBe(0);
    expect(parseRemoteTabSwitchIntervalMs('700')).toBe(700);
    expect(parseRemoteTabSwitchIntervalMs('99999')).toBe(5_000);
  });

  it('透传首页图表诊断参数而不改变 dashboard hash', () => {
    expect(buildRemoteDashboardUrl(
      'gnegjfjccmeafanpmbjboegcbchcghka',
      '#tab-home',
      'single-tags:echarts',
    )).toBe('chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html?perfHomeCharts=single-tags%3Aecharts#tab-home');
  });

  it('透传新作品聚合诊断参数而不改变 dashboard hash', () => {
    expect(buildRemoteDashboardUrl(
      'gnegjfjccmeafanpmbjboegcbchcghka',
      '#tab-new-works',
      '',
      'full',
    )).toBe('chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html?perfNewWorks=full#tab-new-works');
  });

  it('只把真实扩展页面 URL 视为已映射页面', () => {
    expect(isRemoteExtensionPageUrl(
      'chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html#tab-home',
      'gnegjfjccmeafanpmbjboegcbchcghka',
    )).toBe(true);
    expect(isRemoteExtensionPageUrl(
      'chrome-error://chromewebdata/',
      'gnegjfjccmeafanpmbjboegcbchcghka',
    )).toBe(false);
  });

  it('发现 raw CDP 扩展 target 但 Playwright 映射为空时应中止探针', () => {
    expect(hasUnmappedRemoteExtensionTarget(
      [{
        targetId: 'dashboard',
        type: 'page',
        url: 'chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html#tab-home',
      }],
      ['chrome-error://chromewebdata/'],
      'gnegjfjccmeafanpmbjboegcbchcghka',
    )).toBe(true);
    expect(hasUnmappedRemoteExtensionTarget(
      [{
        targetId: 'dashboard',
        type: 'page',
        url: 'chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html#tab-home',
      }],
      ['chrome-extension://gnegjfjccmeafanpmbjboegcbchcghka/dashboard/dashboard.html#tab-home'],
      'gnegjfjccmeafanpmbjboegcbchcghka',
    )).toBe(false);
  });

  it('默认开启远端外部同步隔离，并支持显式关闭', () => {
    expect(parseRemoteBoolean(undefined, true)).toBe(true);
    expect(parseRemoteBoolean('0', true)).toBe(false);
    expect(parseRemoteBoolean('off', true)).toBe(false);
    expect(parseRemoteBoolean('yes', false)).toBe(true);
  });

  it('使用隔离表达式实际返回的 ok 字段判断成功', () => {
    const isolationResult = { ok: true, checks: { cloud: true, emby: true, drive115: true, pending: true } };
    expect(isRemoteExternalSyncIsolationSuccessful(isolationResult)).toBe(true);
    expect(isRemoteExternalSyncIsolationSuccessful({ success: true } as never)).toBe(false);
    expect(isRemoteExternalSyncIsolationSuccessful(null)).toBe(false);
  });
});
