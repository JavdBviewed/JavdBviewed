import { expect, it } from 'vitest';
import { shouldAutoPrompt } from './crosslinePromptPolicy';
const input = { enabled: true, targetState: 'anonymous' as const, sourceCount: 1, now: 2_000_000, suppressedUntil: 0, shownThisSession: false, lastGlobalShownAt: 0 };
it('only offers an anonymous target a verified source', () => {
  expect(shouldAutoPrompt(input)).toBe(true);
  expect(shouldAutoPrompt({ ...input, sourceCount: 0 })).toBe(false);
  expect(shouldAutoPrompt({ ...input, targetState: 'unknown' })).toBe(false);
  expect(shouldAutoPrompt({ ...input, targetState: 'authenticated' })).toBe(false);
  expect(shouldAutoPrompt({ ...input, enabled: false })).toBe(false);
});
it('shares the dismissal and global interval boundaries without re-expanding a shown target', () => {
  expect(shouldAutoPrompt({ ...input, shownThisSession: true })).toBe(false);
  expect(shouldAutoPrompt({ ...input, suppressedUntil: input.now + 1 })).toBe(false);
  expect(shouldAutoPrompt({ ...input, suppressedUntil: input.now })).toBe(true);
  expect(shouldAutoPrompt({ ...input, lastGlobalShownAt: input.now - 599_999 })).toBe(false);
  expect(shouldAutoPrompt({ ...input, lastGlobalShownAt: input.now - 600_000 })).toBe(true);
});
