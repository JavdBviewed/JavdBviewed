import { describe, expect, it } from 'vitest';

import { isDrive115LibraryStatusEnabled, matchesDrive115LibraryCode } from './libraryStatusBadges';

describe('115 library status badges', () => {
  it('only treats an exact normalized code match as existing', () => {
    expect(matchesDrive115LibraryCode('ssis-001', ['SSIS-001'])).toBe(true);
    expect(matchesDrive115LibraryCode('ssis-001', ['SSIS-001-C'])).toBe(false);
    expect(matchesDrive115LibraryCode('ssis-001', [])).toBe(false);
  });

  it('uses the top-level local library matching setting while accepting the legacy location', () => {
    expect(isDrive115LibraryStatusEnabled({})).toBe(false);
    expect(isDrive115LibraryStatusEnabled({ libraryMatchStatus: { enabled: true, sources: { drive115: true } } })).toBe(true);
    expect(isDrive115LibraryStatusEnabled({ listEnhancement: { drive115LibraryStatus: { enabled: true } } })).toBe(true);
  });
});
