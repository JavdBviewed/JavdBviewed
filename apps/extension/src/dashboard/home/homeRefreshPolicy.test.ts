import { describe, expect, it } from 'vitest';
import { shouldRefreshHomeOverview } from './homeRefreshPolicy';

describe('shouldRefreshHomeOverview', () => {
  it('loads the overview when the dashboard page has not initialized it yet', () => {
    expect(shouldRefreshHomeOverview({ initialized: false })).toBe(true);
  });

  it('does not reload a completed overview when the home tab is shown again', () => {
    expect(shouldRefreshHomeOverview({ initialized: true })).toBe(false);
  });

  it('allows an explicit refresh to reload a completed overview', () => {
    expect(shouldRefreshHomeOverview({ initialized: true, force: true })).toBe(true);
  });
});
