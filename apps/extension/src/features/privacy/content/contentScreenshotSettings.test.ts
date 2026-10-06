import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../utils/config';

describe('content screenshot privacy settings', () => {
    it('defaults ordinary content-page screenshot blur to disabled', () => {
        expect(DEFAULT_SETTINGS.privacy.screenshotMode.contentPages).toEqual({
            enabled: false,
            // 10-06-site-privacy-blur：标题/图片子开关默认双开（缺省即生效）
            blurTitles: true,
            blurImages: true,
            sites: { javdb: true, javbus: true },
        });
    });
});
