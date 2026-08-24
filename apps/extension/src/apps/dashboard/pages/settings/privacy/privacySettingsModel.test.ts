/**
 * @file privacySettingsModel.test.ts
 * @description 隐私设置模型测试
 * @module apps/dashboard/pages/settings/privacy
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIVACY_SETTINGS_FORM,
  mapSettingsToPrivacyForm,
  toggleBlurArea,
  validatePrivacyForm,
} from './privacySettingsModel';

describe('privacySettingsModel', () => {
  it('defaults match legacy privacy form', () => {
    expect(DEFAULT_PRIVACY_SETTINGS_FORM.blurIntensity).toBe(5);
    expect(DEFAULT_PRIVACY_SETTINGS_FORM.sessionTimeout).toBe(10);
    expect(DEFAULT_PRIVACY_SETTINGS_FORM.autoBlurTrigger).toBe('manual');
    expect(DEFAULT_PRIVACY_SETTINGS_FORM.blurAreas).toContain('home-page');
  });

  it('maps empty settings to defaults', () => {
    const form = mapSettingsToPrivacyForm(undefined);
    expect(form.screenshotEnabled).toBe(false);
    expect(form.privateModeEnabled).toBe(false);
    expect(form.hasPassword).toBe(false);
    expect(form.blurIntensity).toBe(5);
  });

  it('maps privacy nested config', () => {
    const form = mapSettingsToPrivacyForm({
      privacy: {
        screenshotMode: {
          enabled: true,
          contentPages: { enabled: true, sites: { javdb: true, javbus: true } },
          blurIntensity: 8,
          autoBlurTrigger: 'tab-leave',
          blurAreas: ['navigation'],
        },
        privateMode: {
          enabled: true,
          requirePassword: true,
          passwordHash: 'abc',
          idleTimeout: 30,
          lockOnTabLeave: true,
          lockOnExtensionClose: true,
        },
      },
    } as any);
    expect(form.screenshotEnabled).toBe(true);
    expect(form.contentPagesScreenshotEnabled).toBe(true);
    expect(form.blurIntensity).toBe(8);
    expect(form.autoBlurTrigger).toBe('tab-leave');
    expect(form.blurAreas).toEqual(['navigation']);
    expect(form.privateModeEnabled).toBe(true);
    expect(form.hasPassword).toBe(true);
    expect(form.sessionTimeout).toBe(30);
    expect(form.lockOnTabLeave).toBe(true);
  });

  it('validates ranges', () => {
    expect(validatePrivacyForm(DEFAULT_PRIVACY_SETTINGS_FORM).isValid).toBe(true);
    const bad = validatePrivacyForm({
      ...DEFAULT_PRIVACY_SETTINGS_FORM,
      blurIntensity: 0,
      sessionTimeout: 1,
    });
    expect(bad.isValid).toBe(false);
    expect(bad.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('toggles blur areas', () => {
    const next = toggleBlurArea(['navigation'], 'home-page', true);
    expect(next).toContain('home-page');
    expect(toggleBlurArea(next, 'navigation', false)).not.toContain('navigation');
  });
});
