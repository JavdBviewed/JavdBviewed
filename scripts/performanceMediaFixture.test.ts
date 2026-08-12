import { describe, expect, it } from 'vitest';
import { buildPerformanceMediaFixture } from './performanceMediaFixture';

describe('performance media fixture', () => {
  it('builds deterministic multi-source data without credentials or remote URLs', () => {
    const fixture = buildPerformanceMediaFixture(3, 1_700_000_000_000);

    expect(Object.keys(fixture.emby_library_state.entries)).toEqual([
      'PERF-0001',
      'PERF-0002',
      'PERF-0003',
    ]);
    expect(fixture.drive115_library_state.entries).toHaveLength(3);
    expect(fixture.emby_library_state.entries['PERF-0002'][0].itemName)
      .toBe('PERF-0002 测试影片');
    expect(fixture.drive115_library_state.entries[1].pickCode).toBe('perf-pick-2');
    expect(JSON.stringify(fixture)).not.toMatch(/password|token|apiKey|https?:\/\//i);
  });

  it('adds local cover URLs only when explicitly requested', () => {
    const fixture = buildPerformanceMediaFixture(1, 1_700_000_000_000, 'http://127.0.0.1:43123/covers');

    expect(fixture.emby_library_state.entries['PERF-0001'][0].imageUrls?.Thumb)
      .toBe('http://127.0.0.1:43123/covers/PERF-0001.jpg');
  });
});
