/**
 * @file logSettingsModel.test.ts
 * @description 日志设置模型测试
 * @module apps/dashboard/pages/settings/log
 */
import { describe, expect, it } from 'vitest';
import {
  applyEnableAll,
  applyLogFormToSettings,
  applyMuteAll,
  applyResetDefault,
  DEFAULT_LOG_SETTINGS_FORM,
  mapSettingsToLogForm,
  validateLogForm,
} from './logSettingsModel';

describe('logSettingsModel', () => {
  it('defaults match legacy logging defaults', () => {
    expect(DEFAULT_LOG_SETTINGS_FORM.consoleLevel).toBe('INFO');
    expect(DEFAULT_LOG_SETTINGS_FORM.maxLogEntries).toBe(10000);
    expect(DEFAULT_LOG_SETTINGS_FORM.timeZone).toBe('Asia/Shanghai');
    expect(DEFAULT_LOG_SETTINGS_FORM.showTimestamp).toBe(true);
  });

  it('maps empty settings to defaults', () => {
    const form = mapSettingsToLogForm(undefined);
    expect(form.consoleLevel).toBe('INFO');
    expect(form.maxLogEntries).toBe(10000);
    expect(form.modules.core).toBe(false);
  });

  it('maps logModules with consoleCategories fallback', () => {
    const form = mapSettingsToLogForm({
      logging: {
        consoleLevel: 'INFO',
        maxLogEntries: 2000,
        consoleCategories: { core: true, actor: true },
        logModules: { sync: true },
        consoleFormat: { showTimestamp: false, timeZone: 'UTC' },
      },
    } as any);
    expect(form.consoleLevel).toBe('INFO');
    expect(form.maxLogEntries).toBe(2000);
    expect(form.modules.core).toBe(true);
    expect(form.modules.actor).toBe(true);
    expect(form.modules.sync).toBe(true);
    expect(form.showTimestamp).toBe(false);
    expect(form.timeZone).toBe('UTC');
  });

  it('validates entry ranges', () => {
    expect(validateLogForm(DEFAULT_LOG_SETTINGS_FORM).isValid).toBe(true);
    const bad = validateLogForm({
      ...DEFAULT_LOG_SETTINGS_FORM,
      maxLogEntries: 10,
      retentionDays: 9999,
    });
    expect(bad.isValid).toBe(false);
    expect(bad.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('applies mute / enable / reset shortcuts', () => {
    const muted = applyMuteAll(DEFAULT_LOG_SETTINGS_FORM);
    expect(muted.consoleLevel).toBe('OFF');
    expect(muted.modules.core).toBe(false);

    const all = applyEnableAll(DEFAULT_LOG_SETTINGS_FORM);
    expect(all.consoleLevel).toBe('DEBUG');
    expect(all.modules.debug).toBe(true);

    const reset = applyResetDefault(DEFAULT_LOG_SETTINGS_FORM);
    expect(reset.consoleLevel).toBe('INFO');
    expect(reset.modules.debug).toBe(false);
    expect(reset.modules.core).toBe(true);
  });

  it('merges form into logging settings', () => {
    const next = applyLogFormToSettings({} as any, {
      ...DEFAULT_LOG_SETTINGS_FORM,
      consoleLevel: 'WARN',
      modules: { ...DEFAULT_LOG_SETTINGS_FORM.modules, core: true },
    });
    expect((next.logging as any).consoleLevel).toBe('WARN');
    expect((next.logging as any).logModules.core).toBe(true);
    expect((next.logging as any).consoleCategories.core).toBe(true);
  });
});
