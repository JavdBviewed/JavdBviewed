import { expect, test } from '@playwright/test';
import { encryptData } from '../../apps/extension/src/features/privacy/utils/crypto';
import {
  extensionPageUrl, launchExtensionContext, readExtensionId,
  resolveExtensionHarnessOptions, suppressReleaseAnnouncementForTest,
} from '../../scripts/extensionHarness';

for (const scenario of ['invalid-disabled', 'invalid-enabled', 'stale-auth-enabled'] as const) {
  test(`privacy recovery: ${scenario}`, async ({}, testInfo) => {
    const enabled = scenario !== 'invalid-disabled';
    const harness = resolveExtensionHarnessOptions({
      ...process.env, JAVDB_EXTENSION_USE_CHROME_DATA: '0', JAVDB_EXTENSION_PROFILE: testInfo.outputPath('profile'),
    }, process.cwd());
    const context = await launchExtensionContext(harness, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
    try {
      await context.route(/^https?:\/\//, route => route.abort());
      const id = await readExtensionId(context);
      await suppressReleaseAnnouncementForTest(context);
      const url = extensionPageUrl(id, 'dashboard/dashboard.html#tab-settings/media-library-settings');
      const initial = await context.newPage();
      await initial.goto(url);
      await expect(initial.locator('#sync-emby-library')).toBeVisible();
      await initial.close();
      const worker = context.serviceWorkers()[0];
      const key = 'synthetic-device-key';
      const value = scenario === 'stale-auth-enabled' ? JSON.stringify({
        isBlurred: false, isLocked: false, isAuthenticated: true, sessionStartTime: 10,
        lastActivity: 20, temporaryViewActive: false, temporaryViewEndTime: 0,
      }) : '{"x":"synthetic-invalid\nvalue"}';
      const ciphertext = encryptData(value, key);
      await worker.evaluate(async ({ enabled, key, ciphertext }) => {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({
          settings: { ...settings, privacy: { ...settings.privacy,
            privateMode: { ...settings.privacy.privateMode, enabled, requirePassword: true, passwordHash: 'synthetic-preserved-hash', lockOnTabLeave: false },
            screenshotMode: { ...settings.privacy.screenshotMode, enabled: false, autoBlurTrigger: 'manual' },
          } },
          privacy_encryption_key: key, privacy_state: ciphertext,
          privacy_config_security_questions: 'synthetic-preserved-questions',
          media_watch_evidence: { 'TEST-001': { played: true } },
        });
        await chrome.storage.local.remove('privacy_session');
      }, { enabled, key, ciphertext });
      const page = await context.newPage();
      const messages: string[] = [];
      page.on('console', msg => messages.push(msg.text()));
      await page.goto(url);
      const lock = page.locator('#privacy-lock-screen');
      if (enabled) await expect(lock).toBeVisible();
      else {
        await expect.poll(async () => (await worker.evaluate(async () => (await chrome.storage.local.get('privacy_state')).privacy_state))).toBeUndefined();
        await expect(lock).toHaveCount(0);
      }
      const retained = await worker.evaluate(async () => {
        const data = await chrome.storage.local.get(['settings', 'privacy_encryption_key', 'privacy_session', 'privacy_config_security_questions', 'media_watch_evidence']);
        return { hash: data.settings.privacy.privateMode.passwordHash, key: data.privacy_encryption_key,
          session: data.privacy_session, questions: data.privacy_config_security_questions, evidence: data.media_watch_evidence };
      });
      expect(retained).toEqual({ hash: 'synthetic-preserved-hash', key, session: undefined,
        questions: 'synthetic-preserved-questions', evidence: { 'TEST-001': { played: true } } });
      expect(messages.filter(message => message.includes('Unreadable local privacy state'))).toHaveLength(scenario === 'stale-auth-enabled' ? 0 : 1);
      await page.reload();
      if (enabled) await expect(lock).toBeVisible();
      else { await expect(page.locator('#sync-emby-library')).toBeVisible(); await expect(lock).toHaveCount(0); }
      expect(messages.filter(message => message.includes('Unreadable local privacy state'))).toHaveLength(scenario === 'stale-auth-enabled' ? 0 : 1);
      expect(messages.join('\n')).not.toMatch(/SyntaxError|Bad control character|synthetic-invalid|synthetic-device-key/);
      await page.screenshot({ path: testInfo.outputPath('privacy-recovered.png') });
    } finally {
      await context.close();
    }
  });
}
