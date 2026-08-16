import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { ContentScreenshotBlurController } from '../../apps/extension/src/features/privacy/content/contentScreenshotBlur';

function loadOfflinePage(name: string): void {
    const html = readFileSync(resolve(process.cwd(), 'test-results/performance/local-session-capture/pages-offline', name), 'utf8');
    document.documentElement.innerHTML = html;
}

describe('offline content screenshot blur', () => {
    afterEach(() => {
        document.querySelector('#jdb-content-privacy-blur-style')?.remove();
        document.body.innerHTML = '';
    });

    it('protects the saved JavDB detail fixture at its outer video container', () => {
        loadOfflinePage('02.html');
        const controller = new ContentScreenshotBlurController(document, new URL('https://javdb.com/v/offline-detail'));

        controller.initialize({ enabled: true, sites: { javdb: true, javbus: true } });

        expect(document.querySelector('.video-detail')?.classList.contains('jdb-content-privacy-blur')).toBe(true);
        controller.destroy();
    });

    it('protects cards in the saved JavDB list fixture', () => {
        loadOfflinePage('01.html');
        const controller = new ContentScreenshotBlurController(document, new URL('https://javdb.com/'));

        controller.initialize({ enabled: true, sites: { javdb: true, javbus: true } });

        expect(document.querySelectorAll('.movie-list .item.jdb-content-privacy-blur').length).toBeGreaterThan(0);
        controller.destroy();
    });
});
