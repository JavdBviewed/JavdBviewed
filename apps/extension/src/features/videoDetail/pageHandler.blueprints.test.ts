// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { getVideoDetailTaskBlueprints } from './pageHandler';

describe('video detail task blueprints', () => {
    it('keeps status synchronization ahead of all status-dependent enhancements', () => {
        const blueprints = getVideoDetailTaskBlueprints({
            videoEnhancement: {
                enabled: true,
                enableActorRemarks: true,
                enableReviewBreaker: true,
                enableRelatedLists: true,
                enableVideoFavoriteRating: true,
                enableLocalListInSourceModal: true,
            },
            dataEnhancement: {
                enableMultiSource: true,
                enableTranslation: true,
            },
        });
        const byLabel = new Map(blueprints.map(blueprint => [blueprint.label, blueprint]));

        expect(byLabel.get('videoStatus:initialSync')).toMatchObject({
            phase: 'critical',
            priority: 12,
        });
        expect(byLabel.get('videoEnhancement:initCore')?.dependsOn).toContain('videoStatus:initialSync');
        expect(byLabel.get('videoEnhancement:loadData')?.dependsOn).toContain('videoStatus:initialSync');
        expect(byLabel.get('videoFavoriteRating:init')?.dependsOn).toContain('videoStatus:initialSync');
        expect(byLabel.get('videoEnhancement:runRelatedLists')?.dependsOn).toEqual([
            'videoStatus:initialSync',
            'videoEnhancement:initCore',
        ]);
    });
});
