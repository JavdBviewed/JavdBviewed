export type TabActivationPhase =
  | 'activation-start'
  | 'content-active'
  | 'initialize-start'
  | 'module-load-start'
  | 'module-load-complete'
  | 'initialize-complete';

export type TabActivationMark = {
  tabId: string;
  phase: TabActivationPhase;
  at: number;
};

type PerformanceProbe = { tabActivationMarks?: TabActivationMark[] };

function getProbe(): PerformanceProbe | null {
  const value = (globalThis as typeof globalThis & { __JAVDB_PERF_PROBE__?: unknown }).__JAVDB_PERF_PROBE__;
  return value && typeof value === 'object' ? value as PerformanceProbe : null;
}

export function recordTabActivationPhase(tabId: string, phase: TabActivationPhase, at = performance.now()): void {
  const probe = getProbe();
  if (!probe) return;
  const marks = probe.tabActivationMarks ?? [];
  marks.push({ tabId, phase, at });
  if (marks.length > 100) marks.splice(0, marks.length - 100);
  probe.tabActivationMarks = marks;
}

export function consumeTabActivationMarks(): TabActivationMark[] {
  const probe = getProbe();
  if (!probe?.tabActivationMarks) return [];
  return probe.tabActivationMarks.splice(0);
}
