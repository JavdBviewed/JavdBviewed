/**
 * @file globalDependencyLabels.test.ts
 * @description R6 跨页依赖白名单契约：仅数据类 label，不含 DOM per-page
 */
import { describe, expect, it } from 'vitest';

/** 与 InitOrchestrator.GLOBAL_DEPENDENCY_LABELS 保持同步 */
const GLOBAL_DEPENDENCY_LABELS = new Set([
  'videoEnhancement:runRelatedLists',
  'videoEnhancement:runFC2Breaker',
  'videoEnhancement:runReviewBreaker',
  'onlineAvailability:check',
  'ux:magnet:autoSearch',
]);

const DOM_PER_PAGE_LABELS = [
  'list:observe:init',
  'listEnhancement:init',
  'ui:remove-unwanted',
  'actorEnhancement:init',
  'passwordHelper:init',
  'videoEnhancement:initCore',
];

describe('global dependency whitelist (R6)', () => {
  it('only allows data/network style labels', () => {
    for (const label of GLOBAL_DEPENDENCY_LABELS) {
      expect(label.includes('init') && label.startsWith('list')).toBe(false);
      expect(DOM_PER_PAGE_LABELS.includes(label)).toBe(false);
    }
  });

  it('keeps DOM bootstrap labels out of global completion', () => {
    for (const label of DOM_PER_PAGE_LABELS) {
      expect(GLOBAL_DEPENDENCY_LABELS.has(label)).toBe(false);
    }
  });
});
