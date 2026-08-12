import { describe, expect, it, vi } from 'vitest';

import {
  consumeTabActivationMarks,
  recordTabActivationPhase,
} from './tabActivationPerformance';

describe('tab activation performance marks', () => {
  it('records only when the performance probe is installed and consumes marks once', () => {
    const probe = { tabActivationMarks: [] as unknown[] };
    vi.stubGlobal('__JAVDB_PERF_PROBE__', probe);

    recordTabActivationPhase('tab-new-works', 'module-load-start', 12.5);
    recordTabActivationPhase('tab-new-works', 'module-load-complete', 19.25);

    expect(consumeTabActivationMarks()).toEqual([
      { tabId: 'tab-new-works', phase: 'module-load-start', at: 12.5 },
      { tabId: 'tab-new-works', phase: 'module-load-complete', at: 19.25 },
    ]);
    expect(consumeTabActivationMarks()).toEqual([]);
    vi.unstubAllGlobals();
  });
});
