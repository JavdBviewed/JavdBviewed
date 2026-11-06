import { describe, expect, it } from 'vitest';
import {
  parseBackgroundBootstrapSkipProfile,
  shouldRunBackgroundBootstrapStep,
} from './bootstrapProfile';

describe('background bootstrap diagnostic profile', () => {
  it('keeps the production profile enabled when no skip list is provided', () => {
    const profile = parseBackgroundBootstrapSkipProfile(undefined);

    expect(profile).toEqual([]);
    expect(shouldRunBackgroundBootstrapStep(profile, 'task-center-restore')).toBe(true);
  });

  it('parses only known steps and de-duplicates them', () => {
    const profile = parseBackgroundBootstrapSkipProfile(
      ' task-center-restore,route-auto-update,unknown,task-center-restore ',
    );

    expect(profile).toEqual(['task-center-restore', 'route-auto-update']);
    expect(shouldRunBackgroundBootstrapStep(profile, 'task-center-restore')).toBe(false);
    expect(shouldRunBackgroundBootstrapStep(profile, 'alarm-wiring')).toBe(true);
  });

  it('can disable OpenList proxy without disabling 115 proxy', () => {
    const profile = parseBackgroundBootstrapSkipProfile('openlist-proxy');
    expect(profile).toEqual(['openlist-proxy']);
    expect(shouldRunBackgroundBootstrapStep(profile, 'openlist-proxy')).toBe(false);
    expect(shouldRunBackgroundBootstrapStep(profile, 'drive115-proxy')).toBe(true);
  });
});
