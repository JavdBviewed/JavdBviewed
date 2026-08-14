/**
 * @file taskPolicy.test.ts
 * @description resolveTaskBucket 翻译桶与通用映射单测
 */
import { describe, expect, it } from 'vitest';
import { resolveTaskBucket, resolveTaskLeaseGroup, TASK_BUCKET_LIMITS } from './taskPolicy';

describe('resolveTaskBucket', () => {
  it('routes real translation API labels to translate bucket', () => {
    expect(resolveTaskBucket('videoEnhancement:translateCurrentTitle')).toBe('translate');
    expect(resolveTaskBucket('videoEnhancement:translateCurrentTitle:request')).toBe('translate');
    expect(resolveTaskBucket('someFeature:translateBatch')).toBe('translate');
  });

  it('keeps translation UI stages off the serial translate bucket', () => {
    expect(resolveTaskBucket('videoEnhancement:translateCurrentTitle:prepare')).toBe('video-light');
    expect(resolveTaskBucket('videoEnhancement:translateCurrentTitle:render')).toBe('video-light');
    expect(resolveTaskBucket('videoEnhancement:titleTranslateBtn')).toBe('video-light');
  });

  it('keeps non-API title render on video-light', () => {
    expect(resolveTaskBucket('videoEnhancement:runTitle')).toBe('video-light');
  });

  it('maps other known prefixes', () => {
    expect(resolveTaskBucket('videoStatus:initialSync')).toBe('videoStatus');
    expect(resolveTaskBucket('drive115:push')).toBe('drive115-push');
    expect(resolveTaskBucket('drive115:init:list')).toBe('drive115');
    expect(resolveTaskBucket('ux:magnet:autoSearch')).toBe('video-light');
    expect(resolveTaskBucket('ui:remove-unwanted')).toBe('ui-light');
    expect(resolveTaskBucket('misc:unknown')).toBe('auxiliary');
  });

  it('keeps translate bucket serial', () => {
    expect(TASK_BUCKET_LIMITS.translate).toBe(1);
  });

  it('serializes automatic heavy detail tasks across source tabs', () => {
    expect(resolveTaskLeaseGroup('videoFavoriteRating:init')).toBe('source-page-heavy');
    expect(resolveTaskLeaseGroup('actorMarks:page')).toBe('source-page-heavy');
    expect(resolveTaskLeaseGroup('insights:collector')).toBe('source-page-heavy');
    expect(resolveTaskLeaseGroup('ui:remove-unwanted')).toBeNull();
  });

  it('does not add the smart-mode lease limit to immediate enhancement tasks', () => {
    expect(resolveTaskLeaseGroup('videoFavoriteRating:init', 'background_allowed')).toBeNull();
    expect(resolveTaskLeaseGroup('actorMarks:page', 'background_allowed')).toBeNull();
    expect(resolveTaskLeaseGroup('insights:collector', 'background_allowed')).toBeNull();
  });

  it('keeps core status synchronization serialized in every scheduling mode', () => {
    expect(resolveTaskLeaseGroup('videoStatus:initialSync', 'background_allowed')).toBe('source-page-heavy');
    expect(resolveTaskLeaseGroup('videoStatus:initialSync', 'foreground_first')).toBe('source-page-heavy');
  });
});
