import { describe, expect, it } from 'vitest';
import {
  applyEnhancementFormToSettings,
  DEFAULT_ENHANCEMENT_SETTINGS_FORM,
  mapSettingsToEnhancementForm,
} from './enhancementSettingsModel';

describe('video enhancement scheduling mode', () => {
  it('defaults an absent or invalid mode to smart and persists an explicit choice', () => {
    expect(mapSettingsToEnhancementForm({}).videoEnhancementSchedulingMode).toBe('smart');
    expect(mapSettingsToEnhancementForm({
      videoEnhancement: { schedulingMode: 'unknown' },
    }).videoEnhancementSchedulingMode).toBe('smart');

    const next = applyEnhancementFormToSettings({} as any, {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      videoEnhancementSchedulingMode: 'immediate',
    });

    expect(next.videoEnhancement.schedulingMode).toBe('immediate');
  });
});
