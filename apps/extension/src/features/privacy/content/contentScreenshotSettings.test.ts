import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../utils/config';

describe('content screenshot privacy settings', () => {
    it('defaults ordinary content-page screenshot blur to disabled', () => {
        expect(DEFAULT_SETTINGS.privacy.screenshotMode.contentPages).toEqual({
            enabled: false,
            sites: { javdb: true, javbus: true },
        });
    });
});
