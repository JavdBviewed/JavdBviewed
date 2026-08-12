import { describe, expect, it } from 'vitest';
import { shouldRebuildNavigation } from './navigationRenderPolicy';

describe('navigation render policy', () => {
  it('reuses navigation nodes for destinations in the current group', () => {
    expect(shouldRebuildNavigation({ previousGroupId: 'library', nextGroupId: 'library' })).toBe(false);
  });

  it('rebuilds navigation nodes when the group changes', () => {
    expect(shouldRebuildNavigation({ previousGroupId: 'library', nextGroupId: 'settings' })).toBe(true);
  });
});
