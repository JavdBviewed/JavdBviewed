import { describe, expect, it } from 'vitest';
import { getNewWorksDiagnosticMode } from './newWorksDiagnosticMode';

describe('新作品页性能诊断模式', () => {
  it('默认保持完整页面行为', () => {
    expect(getNewWorksDiagnosticMode('')).toEqual({
      renderStats: true,
      renderList: true,
      autoSync: true,
    });
  });

  it('支持仅采集完整页面调用计数而不改变页面行为', () => {
    expect(getNewWorksDiagnosticMode('full')).toEqual({
      renderStats: true,
      renderList: true,
      autoSync: true,
    });
  });

  it('支持分别关闭统计、列表和自动状态同步', () => {
    expect(getNewWorksDiagnosticMode('no-stats')).toEqual({
      renderStats: false,
      renderList: true,
      autoSync: true,
    });
    expect(getNewWorksDiagnosticMode('no-list')).toEqual({
      renderStats: true,
      renderList: false,
      autoSync: true,
    });
    expect(getNewWorksDiagnosticMode('no-auto-sync')).toEqual({
      renderStats: true,
      renderList: true,
      autoSync: false,
    });
  });

  it('不接受未知模式，避免诊断参数改变普通行为', () => {
    expect(getNewWorksDiagnosticMode('unknown')).toEqual({
      renderStats: true,
      renderList: true,
      autoSync: true,
    });
  });
});
