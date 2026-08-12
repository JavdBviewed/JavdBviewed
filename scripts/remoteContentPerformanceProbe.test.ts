import { describe, expect, it } from 'vitest';
import {
  buildRemoteContentPerformanceReadExpression,
  formatRemoteContentRuntimeEvaluationFailure,
  parseRemoteContentVariant,
} from './remoteContentPerformanceProbe';

describe('remote content performance variant', () => {
  it('defaults unknown values to the full configuration', () => {
    expect(parseRemoteContentVariant(undefined)).toBe('full');
    expect(parseRemoteContentVariant('unknown')).toBe('full');
  });

  it('accepts the actor-only control variant', () => {
    expect(parseRemoteContentVariant('actor-off')).toBe('actor-off');
  });

  it('accepts the content-filter control variant', () => {
    expect(parseRemoteContentVariant('filter-off')).toBe('filter-off');
  });

  it('accepts the orthogonal content-filter control with actor work enabled', () => {
    expect(parseRemoteContentVariant('actor-on-filter-off')).toBe('actor-on-filter-off');
  });

  it('accepts the actor watermark visibility-gate variant', () => {
    expect(parseRemoteContentVariant('watermark')).toBe('watermark');
  });

  it('reports CDP runtime exceptions instead of reducing them to empty checks', () => {
    expect(formatRemoteContentRuntimeEvaluationFailure({
      exceptionDetails: {
        text: 'Uncaught (in promise)',
        exception: { description: 'TypeError: chrome.alarms is undefined' },
      },
    })).toBe('Uncaught (in promise): TypeError: chrome.alarms is undefined');
  });

  it('reads content diagnostics through the page message bridge', () => {
    const expression = buildRemoteContentPerformanceReadExpression();

    expect(expression).toContain('JDB_CONTENT_PERF_READ');
    expect(expression).toContain('JDB_CONTENT_PERF_SNAPSHOT');
    expect(expression).not.toContain('__JDB_CONTENT_PERF__');
  });
});
