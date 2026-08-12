import { afterEach, describe, expect, it } from 'vitest';

import {
  enableNewWorksDiagnostics,
  getNewWorksDiagnosticSnapshot,
} from '../../features/newWorks/newWorksDiagnostics';

describe('new works initialization diagnostics', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__JAVDB_NEW_WORKS_DIAGNOSTICS__;
  });

  it('preserves the initialization result while recording the phase duration', async () => {
    const diagnostics = await import('./newWorksInitializationDiagnostics').catch(() => null);

    expect(diagnostics).not.toBeNull();
    if (!diagnostics) return;

    enableNewWorksDiagnostics();
    const result = await diagnostics.measureNewWorksInitializationPhase(
      'page.initialize.render.duration',
      async () => 'rendered',
    );

    expect(result).toBe('rendered');
    expect(getNewWorksDiagnosticSnapshot()?.durations['page.initialize.render.duration']).toMatchObject({
      count: 1,
    });
  });
});
