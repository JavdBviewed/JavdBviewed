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

describe('video detail scheduling modes', () => {
    it('prewarms only the known expensive automatic tasks at the smart background rate', () => {
        const blueprints = getVideoDetailTaskBlueprints({
            videoEnhancement: {
                enabled: true,
                schedulingMode: 'smart',
                enableRelatedLists: true,
                enableReviewBreaker: true,
                enableVideoFavoriteRating: true,
                enableActorNameMarks: true,
            },
        });
        const byLabel = new Map(blueprints.map(blueprint => [blueprint.label, blueprint]));

        expect(byLabel.get('videoStatus:initialSync')?.visibilityPolicy).toBe('background_allowed');
        expect(byLabel.get('videoEnhancement:initCore')?.visibilityPolicy).toBe('background_allowed');
        expect(byLabel.get('videoEnhancement:loadData')?.visibilityPolicy).toBeUndefined();
        expect(byLabel.get('videoEnhancement:runRelatedLists')?.visibilityPolicy).toBeUndefined();
        expect(byLabel.get('videoStatus:fullRefresh')).toBeUndefined();
        expect(byLabel.get('onlineAvailability:check')).toBeUndefined();
        expect(byLabel.get('videoFavoriteRating:init')?.visibilityPolicy).toBe('background_throttled');
        expect(byLabel.get('actorMarks:page')?.visibilityPolicy).toBe('background_throttled');
    });

    it('keeps automatic heavy data tasks background-eligible in immediate mode', () => {
        const blueprints = getVideoDetailTaskBlueprints({
            videoEnhancement: {
                enabled: true,
                schedulingMode: 'immediate',
                enableRelatedLists: true,
                enableVideoFavoriteRating: true,
                enableActorNameMarks: true,
            },
        });
        const byLabel = new Map(blueprints.map(blueprint => [blueprint.label, blueprint]));

        expect(byLabel.get('videoEnhancement:loadData')?.visibilityPolicy).toBeUndefined();
        expect(byLabel.get('videoEnhancement:runRelatedLists')?.visibilityPolicy).toBeUndefined();
        expect(byLabel.get('videoStatus:fullRefresh')).toBeUndefined();
        expect(byLabel.get('onlineAvailability:check')).toBeUndefined();
        expect(byLabel.get('videoFavoriteRating:init')?.visibilityPolicy).toBe('background_allowed');
        expect(byLabel.get('actorMarks:page')?.visibilityPolicy).toBe('background_allowed');
    });
});
