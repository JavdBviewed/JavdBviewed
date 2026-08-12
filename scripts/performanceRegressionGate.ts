/**
 * @file performanceRegressionGate.ts
 * @description 校验 WSL 性能报告的运行时有效性、敏感字段和相对基线回退。
 * @module scripts
 */

export type WslPerformanceMetrics = {
  peakRssBytes: number;
  peakCpuPercent: number;
  steadyRssSlopeBytesPerSecond: number;
  peakJsHeapUsedBytes: number | null;
  steadyJsHeapSlopeBytesPerSecond: number | null;
  longTaskCount: number | null;
  longTaskP95Ms: number | null;
  lifecycleCounts: Record<string, number>;
  cooldownRssBytes: number | null;
};

export type WslPerformanceGateIssue = {
  code:
    | 'invalid-extension-runtime'
    | 'invalid-page-runtime'
    | 'missing-metrics'
    | 'missing-scenario'
    | 'sensitive-payload'
    | 'peak-rss-regression'
    | 'peak-cpu-regression'
    | 'rss-slope-regression'
    | 'missing-long-task-metrics'
    | 'missing-lifecycle-event'
    | 'missing-cooldown-recovery';
  message: string;
};

export type WslPerformanceGatePolicy = {
  requireExtensionRuntime?: boolean;
  requireExtensionPage?: boolean;
  requiredScenarioNames?: readonly string[];
  baseline?: Partial<Pick<
    WslPerformanceMetrics,
    'peakRssBytes' | 'peakCpuPercent' | 'steadyRssSlopeBytesPerSecond'
  >>;
  toleranceRatio?: number;
  requireLongTaskMetrics?: boolean;
  requiredLifecycleEvents?: readonly string[];
  requiredLifecycleEventGroups?: readonly (readonly string[])[];
  requireCooldownRecovery?: boolean;
};

export type WslPerformanceGateResult = {
  ok: boolean;
  issues: WslPerformanceGateIssue[];
  metrics?: WslPerformanceMetrics;
};

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|token|secret|authorization|cookie|credential|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const REDACTED_VALUE = '[REDACTED]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readMetrics(report: Record<string, unknown>): WslPerformanceMetrics | null {
  const diagnostic = isRecord(report.diagnostic) ? report.diagnostic : null;
  const summary = diagnostic && isRecord(diagnostic.summary) ? diagnostic.summary : null;
  if (!summary) return null;

  const peakRssBytes = readFiniteNumber(summary.peakRssBytes);
  const peakCpuPercent = readFiniteNumber(summary.peakCpuPercent);
  const steadyRssSlopeBytesPerSecond = readFiniteNumber(summary.steadyRssSlopeBytesPerSecond);
  const peakJsHeapUsedBytes = summary.peakJsHeapUsedBytes === null
    ? null
    : readFiniteNumber(summary.peakJsHeapUsedBytes);
  const steadyJsHeapSlopeBytesPerSecond = summary.steadyJsHeapSlopeBytesPerSecond === null
    ? null
    : readFiniteNumber(summary.steadyJsHeapSlopeBytesPerSecond);
  const longTaskCount = summary.longTaskCount === null
    ? null
    : readFiniteNumber(summary.longTaskCount);
  const longTaskP95Ms = summary.longTaskP95Ms === null
    ? null
    : readFiniteNumber(summary.longTaskP95Ms);
  const lifecycleCounts = isRecord(summary.lifecycleCounts)
    ? Object.fromEntries(
      Object.entries(summary.lifecycleCounts)
        .filter(([, count]) => typeof count === 'number' && Number.isFinite(count))
        .map(([event, count]) => [event, count as number]),
    )
    : {};
  const cooldownRssBytes = summary.cooldownRssBytes === null
    ? null
    : readFiniteNumber(summary.cooldownRssBytes);
  if (
    peakRssBytes === null
    || peakCpuPercent === null
    || steadyRssSlopeBytesPerSecond === null
    || (summary.cooldownRssBytes !== null && cooldownRssBytes === null)
  ) {
    return null;
  }
  return {
    peakRssBytes,
    peakCpuPercent,
    steadyRssSlopeBytesPerSecond,
    peakJsHeapUsedBytes,
    steadyJsHeapSlopeBytesPerSecond,
    longTaskCount,
    longTaskP95Ms,
    lifecycleCounts,
    cooldownRssBytes,
  };
}

function hasRawSensitivePayload(value: unknown, key?: string): boolean {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    if (value !== REDACTED_VALUE && value !== null && value !== undefined) return true;
  }
  if (Array.isArray(value)) return value.some((item) => hasRawSensitivePayload(item));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([entryKey, entryValue]) => (
    hasRawSensitivePayload(entryValue, entryKey)
  ));
}

function readScenarioNames(report: Record<string, unknown>): string[] {
  if (!Array.isArray(report.scenarios)) return [];
  return report.scenarios
    .filter(isRecord)
    .map((scenario) => scenario.name)
    .filter((name): name is string => typeof name === 'string');
}

function addRegressionIssue(
  issues: WslPerformanceGateIssue[],
  code: WslPerformanceGateIssue['code'],
  message: string,
): void {
  issues.push({ code, message });
}

function exceedsBaseline(current: number, baseline: number, toleranceRatio: number): boolean {
  return current > baseline * (1 + toleranceRatio);
}

export function evaluateWslPerformanceReport(
  input: unknown,
  policy: WslPerformanceGatePolicy,
): WslPerformanceGateResult {
  const issues: WslPerformanceGateIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ code: 'missing-metrics', message: '性能报告不是对象。' }],
    };
  }

  const extensionRuntime = isRecord(input.extensionRuntime) ? input.extensionRuntime : null;
  if (policy.requireExtensionRuntime !== false && extensionRuntime?.ok !== true) {
    addRegressionIssue(issues, 'invalid-extension-runtime', '扩展运行时校验未通过。');
  }

  const pageRuntime = isRecord(input.extensionPageRuntime) ? input.extensionPageRuntime : null;
  const pageUrl = typeof pageRuntime?.url === 'string' ? pageRuntime.url : '';
  if (policy.requireExtensionPage !== false && (
    !pageRuntime
    || pageRuntime.appRootMounted !== true
    || pageUrl.startsWith('chrome-error://')
    || !pageUrl.startsWith('chrome-extension://')
  )) {
    addRegressionIssue(issues, 'invalid-page-runtime', '扩展页面不是已挂载的有效页面。');
  }

  const metrics = readMetrics(input);
  if (!metrics) addRegressionIssue(issues, 'missing-metrics', '性能报告缺少完整指标摘要。');

  if (policy.requireLongTaskMetrics && (
    !metrics
    || metrics.longTaskCount === null
    || metrics.longTaskP95Ms === null
  )) {
    addRegressionIssue(issues, 'missing-long-task-metrics', '性能报告缺少长任务指标。');
  }

  for (const requiredEvent of policy.requiredLifecycleEvents ?? []) {
    if (!metrics || (metrics.lifecycleCounts[requiredEvent] ?? 0) < 1) {
      addRegressionIssue(issues, 'missing-lifecycle-event', `缺少生命周期事件：${requiredEvent}`);
    }
  }

  for (const eventGroup of policy.requiredLifecycleEventGroups ?? []) {
    const hasEvent = Boolean(metrics) && eventGroup.some(
      (event) => (metrics?.lifecycleCounts[event] ?? 0) >= 1,
    );
    if (!hasEvent) {
      addRegressionIssue(
        issues,
        'missing-lifecycle-event',
        `缺少生命周期事件之一：${eventGroup.join(' / ')}`,
      );
    }
  }

  if (policy.requireCooldownRecovery && (!metrics || metrics.cooldownRssBytes === null)) {
    addRegressionIssue(issues, 'missing-cooldown-recovery', '性能报告缺少关闭后的冷却回落指标。');
  }

  const scenarioNames = readScenarioNames(input);
  for (const requiredName of policy.requiredScenarioNames ?? []) {
    if (!scenarioNames.includes(requiredName)) {
      addRegressionIssue(issues, 'missing-scenario', `缺少场景：${requiredName}`);
    }
  }

  if (hasRawSensitivePayload(input)) {
    addRegressionIssue(issues, 'sensitive-payload', '性能报告包含未脱敏敏感字段。');
  }

  const baseline = policy.baseline;
  const toleranceRatio = Number.isFinite(policy.toleranceRatio)
    ? Math.max(0, policy.toleranceRatio ?? 0)
    : 0;
  if (metrics && baseline) {
    if (
      baseline.peakRssBytes !== undefined
      && exceedsBaseline(metrics.peakRssBytes, baseline.peakRssBytes, toleranceRatio)
    ) {
      addRegressionIssue(issues, 'peak-rss-regression', '峰值 RSS 超出基线容差。');
    }
    if (
      baseline.peakCpuPercent !== undefined
      && exceedsBaseline(metrics.peakCpuPercent, baseline.peakCpuPercent, toleranceRatio)
    ) {
      addRegressionIssue(issues, 'peak-cpu-regression', '峰值 CPU 超出基线容差。');
    }
    if (
      baseline.steadyRssSlopeBytesPerSecond !== undefined
      && exceedsBaseline(
        metrics.steadyRssSlopeBytesPerSecond,
        baseline.steadyRssSlopeBytesPerSecond,
        toleranceRatio,
      )
    ) {
      addRegressionIssue(issues, 'rss-slope-regression', '稳定阶段 RSS 斜率超出基线容差。');
    }
  }

  return metrics
    ? { ok: issues.length === 0, issues, metrics }
    : { ok: false, issues };
}
