/**
 * @file homeTagsChart.test.ts
 * @description home tags chart config 测试
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';

describe('home tags chart config', () => {
  it('builds readable G2Plot bar options for tag data', async () => {
    const { buildHomeTagsBarData, buildHomeTagsBarOptions } = await import('../../apps/extension/src/dashboard/home/charts');

    const data = buildHomeTagsBarData([
      { name: '巨乳', count: 12 },
      { name: '中出', count: 8 },
    ], 0, 10);
    const options = buildHomeTagsBarOptions(data, {
      text: '#e5e7eb',
      muted: '#94a3b8',
      border: 'rgba(148, 163, 184, 0.25)',
    });

    expect(options.data).toEqual([
      { name: '巨乳', value: 12, color: '#60a5fa' },
      { name: '中出', value: 8, color: '#34d399' },
    ]);
    expect(options.label.style.fill).toBe('#e5e7eb');
    expect(options.xAxis.label.style.fill).toBe('#94a3b8');
    expect(options.yAxis.label.style.fill).toBe('#94a3b8');
    expect(options.xAxis.grid.line.style.stroke).toBe('rgba(148, 163, 184, 0.25)');
  });

  it('formats status donut labels from each datum value', async () => {
    const { buildHomeStatusDonutOptions } = await import('../../apps/extension/src/dashboard/home/charts');
    const options = buildHomeStatusDonutOptions({
      muted: '#94a3b8',
      text: '#e5e7eb',
    });

    expect(options.label.content).toBeUndefined();
    expect(options.label.formatter({ value: 42 })).toBe('42');
    expect(options.label.formatter({ value: 0 })).toBe('0');
  });
});
