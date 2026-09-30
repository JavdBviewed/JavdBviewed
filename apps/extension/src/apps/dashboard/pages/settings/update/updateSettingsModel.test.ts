/**
 * @file updateSettingsModel.test.ts
 * @description 版本设置模型单测
 * @module apps/dashboard/pages/settings/update
 */
import { describe, expect, it } from 'vitest';
import {
  applyUpdateFormToSettings,
  countTelemetryPayloadFields,
  DEFAULT_UPDATE_SETTINGS_FORM,
  formatLastUpdateCheck,
  formatTelemetryPayloadJson,
  formatTelemetryPreviewTime,
  mapSettingsToUpdateForm,
  mapTelemetryViewFromSettings,
  TELEMETRY_DATA_EXCLUDED_ITEMS,
  TELEMETRY_DATA_INCLUDED_ITEMS,
  TELEMETRY_DEVICE_ID_NOTE,
  TELEMETRY_PURPOSE_NOTE,
  TELEMETRY_VIEWER_EVENTS,
  TELEMETRY_VIEWER_EVENT_OPTIONS,
} from './updateSettingsModel';

describe('updateSettingsModel', () => {
  it('defaults auto check true and interval 24', () => {
    expect(mapSettingsToUpdateForm({})).toEqual(DEFAULT_UPDATE_SETTINGS_FORM);
  });

  it('maps explicit values', () => {
    const form = mapSettingsToUpdateForm({
      autoUpdateCheck: false,
      updateCheckInterval: '12',
      includePrerelease: true,
    } as any);
    expect(form.autoUpdateCheck).toBe(false);
    expect(form.updateCheckInterval).toBe('12');
    expect(form.includePrerelease).toBe(true);
  });

  it('applies form back to settings', () => {
    const next = applyUpdateFormToSettings({} as any, {
      autoUpdateCheck: false,
      updateCheckInterval: '168',
      includePrerelease: true,
    });
    expect((next as any).autoUpdateCheck).toBe(false);
    expect((next as any).updateCheckInterval).toBe('168');
    expect((next as any).includePrerelease).toBe(true);
  });

  it('formats last check', () => {
    expect(formatLastUpdateCheck(null)).toBe('从未检查');
    expect(formatLastUpdateCheck('not-a-date')).not.toBe('');
  });

});

describe('updateSettingsModel 遥测数据查看器', () => {
  it('遥测总开关未配置视为启用，与上报侧同一口径', () => {
    expect(mapTelemetryViewFromSettings({})).toEqual({ enabled: true, endpoint: '' });
    expect(mapTelemetryViewFromSettings(null)).toEqual({ enabled: true, endpoint: '' });
    expect(mapTelemetryViewFromSettings({ telemetry: { enabled: false } } as any))
      .toEqual({ enabled: false, endpoint: '' });
  });

  it('上报地址做 trim，缺失回落空串', () => {
    const view = mapTelemetryViewFromSettings({
      telemetry: { enabled: true, endpoint: '  https://jbd-server.we-together.club/v1/telemetry/report  ' },
    } as any);
    expect(view.endpoint).toBe('https://jbd-server.we-together.club/v1/telemetry/report');
    expect(view.enabled).toBe(true);
    expect(mapTelemetryViewFromSettings({ telemetry: { endpoint: null } } as any).endpoint).toBe('');
  });

  it('请求体 JSON 用两空格缩进完整展示，序列化失败有兜底', () => {
    const json = formatTelemetryPayloadJson({ client: { platform: 'linux' }, anonymous: true });
    expect(json).toContain('"client": {');
    expect(json).toContain('\n  "anonymous": true');
    expect(json.split('\n').length).toBeGreaterThan(3);

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(formatTelemetryPayloadJson(circular)).toBe('无法序列化请求体');
  });

  it('字段数量按叶子统计，数组与对象都展开', () => {
    expect(countTelemetryPayloadFields(null)).toBe(0);
    expect(countTelemetryPayloadFields(undefined)).toBe(0);
    expect(countTelemetryPayloadFields('startup')).toBe(1);
    expect(countTelemetryPayloadFields({ a: 1, b: { c: 2, d: [3, 4] } })).toBe(4);
  });

  it('生成时间为本地可读串，空值显示未生成', () => {
    expect(formatTelemetryPreviewTime('')).toBe('未生成');
    expect(formatTelemetryPreviewTime(null)).toBe('未生成');
    expect(formatTelemetryPreviewTime('not-a-date')).toBe('not-a-date');
    expect(formatTelemetryPreviewTime('2026-09-30T02:30:00.000Z')).not.toBe('2026-09-30T02:30:00.000Z');
  });

  it('可查看事件恰为三类且都有触发时机说明', () => {
    expect([...TELEMETRY_VIEWER_EVENTS]).toEqual(['startup', 'heartbeat', 'error_report']);
    expect(TELEMETRY_VIEWER_EVENT_OPTIONS).toHaveLength(3);
    for (const option of TELEMETRY_VIEWER_EVENT_OPTIONS) {
      expect(TELEMETRY_VIEWER_EVENTS).toContain(option.value);
      expect(option.label.trim().length).toBeGreaterThan(1);
      expect(option.trigger).toContain('触发');
    }
    const optionValues = TELEMETRY_VIEWER_EVENT_OPTIONS.map((item) => item.value);
    expect([...TELEMETRY_VIEWER_EVENTS].every((event) => optionValues.includes(event))).toBe(true);
  });

  it('包含/不包含清单锁住用户口径（番号、演员名、邮箱、磁盘路径、设备标识）', () => {
    const included = TELEMETRY_DATA_INCLUDED_ITEMS.join('\n');
    const excluded = TELEMETRY_DATA_EXCLUDED_ITEMS.join('\n');

    expect(included).toContain('设备标识');
    expect(included).toContain('deviceId');
    expect(included).toContain('分桶');
    expect(included).toContain('区间');
    expect(included).toContain('布尔');

    expect(excluded).toContain('番号');
    expect(excluded).toContain('演员名');
    expect(excluded).toContain('邮箱');
    expect(excluded).toContain('磁盘路径');
    expect(excluded).toContain('磁力链接');
    expect(excluded).toContain('令牌');
    expect(TELEMETRY_DATA_EXCLUDED_ITEMS.length).toBeGreaterThanOrEqual(8);
    expect(TELEMETRY_DATA_INCLUDED_ITEMS.length).toBeGreaterThanOrEqual(6);
  });

  it('文案声明使用即默认允许、只用于开发与优化、设备标识不含账号信息', () => {
    expect(TELEMETRY_PURPOSE_NOTE).toContain('使用本拓展即默认允许');
    expect(TELEMETRY_PURPOSE_NOTE).toContain('帮助程序的开发与优化');
    expect(TELEMETRY_DEVICE_ID_NOTE).toContain('deviceId');
    expect(TELEMETRY_DEVICE_ID_NOTE).toContain('不包含你的账号信息');
    expect(TELEMETRY_DEVICE_ID_NOTE).toContain('浏览内容');
  });
});
