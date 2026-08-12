import { describe, expect, it } from 'vitest';
import { getVideoDetailTaskBlueprints } from '../../apps/extension/src/features/videoDetail/pageHandler';

describe('video detail task blueprints', () => {
  it('gives multi-source metadata loading time to finish one retry before the orchestrator can retry it', () => {
    const loadData = getVideoDetailTaskBlueprints({
      dataEnhancement: { enableMultiSource: true, enableTranslation: false },
      videoEnhancement: { enabled: false },
    }).find((task) => task.label === 'videoEnhancement:loadData');

    expect(loadData).toMatchObject({
      phase: 'deferred',
      timeout: 18_000,
    });
  });

  it('completes the visible loading state from core metadata without waiting for optional idle enhancements', () => {
    const finish = getVideoDetailTaskBlueprints({
      dataEnhancement: { enableMultiSource: true, enableTranslation: true },
      videoEnhancement: {
        enabled: true,
        enableActorRemarks: true,
        enableReviewBreaker: true,
        enableRelatedLists: true,
      },
    }).find((task) => task.label === 'videoEnhancement:finish');

    expect(finish).toMatchObject({
      phase: 'high',
      dependsOn: ['videoEnhancement:loadData'],
    });
  });
});
