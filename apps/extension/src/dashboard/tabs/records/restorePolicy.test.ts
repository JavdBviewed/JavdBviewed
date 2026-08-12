import { describe, expect, it } from 'vitest';
import { shouldRenderRecordsOnRestore } from './restorePolicy';

describe('records restore policy', () => {
  it('keeps an unchanged rendered page during tab restore', () => {
    expect(shouldRenderRecordsOnRestore({ hasRenderedPage: true, stale: false })).toBe(false);
  });

  it('renders when the page has not rendered yet or became stale while hidden', () => {
    expect(shouldRenderRecordsOnRestore({ hasRenderedPage: false, stale: false })).toBe(true);
    expect(shouldRenderRecordsOnRestore({ hasRenderedPage: true, stale: true })).toBe(true);
  });
});
