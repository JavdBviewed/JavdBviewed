/**
 * @file newWorksDiagnosticMode.ts
 * @description 新作品页性能对照参数，仅用于隔离诊断，不改变默认行为。
 * @module dashboard/tabs
 */

export type NewWorksDiagnosticMode = {
  renderStats: boolean;
  renderList: boolean;
  autoSync: boolean;
};

const DEFAULT_MODE: NewWorksDiagnosticMode = {
  renderStats: true,
  renderList: true,
  autoSync: true,
};

export function getNewWorksDiagnosticMode(value: string | undefined): NewWorksDiagnosticMode {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!['full', 'no-stats', 'no-list', 'no-auto-sync'].includes(normalized)) {
    return { ...DEFAULT_MODE };
  }
  return {
    renderStats: normalized !== 'no-stats',
    renderList: normalized !== 'no-list',
    autoSync: normalized !== 'no-auto-sync',
  };
}

export function readNewWorksDiagnosticMode(): NewWorksDiagnosticMode {
  try {
    return getNewWorksDiagnosticMode(new URLSearchParams(window.location.search).get('perfNewWorks') ?? undefined);
  } catch {
    return { ...DEFAULT_MODE };
  }
}
