/**
 * @file privacyBootstrap.ts
 * @description privacyBootstrap
 * @module apps/dashboard
 */
import { setupDashboardPrivacyMonitoring } from '../../dashboard/privacy/dashboardMonitor';
import { log } from '../../utils/logController';

export function registerDashboardPrivacyLockHandler(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'privacy-lock-trigger') return false;
    try {
      import('../../features/privacy').then(({ getPrivacyManager }) => {
        const privacyManager = getPrivacyManager();
        privacyManager.lock().catch((error: any) => {
          console.error('Failed to lock from message:', error);
        });
      }).catch((error) => {
        console.error('Failed to load privacy manager:', error);
      });
      sendResponse({ success: true });
    } catch (error) {
      console.error('Failed to handle lock trigger:', error);
      sendResponse({ success: false });
    }
    return true;
  });
}

export async function initializeDashboardPrivacy(): Promise<void> {
  try {
    log.privacy('Initializing privacy system for Dashboard...');
    const { initializePrivacySystem } = await import('../../features/privacy');
    await initializePrivacySystem();
    log.privacy('Privacy system initialized successfully for Dashboard');

    setupDashboardPrivacyMonitoring();

    const { initializeIdleTimerDisplay } = await import('../../dashboard/privacy/idleTimer');
    initializeIdleTimerDisplay();

    const { initializeManualLockButton } = await import('../../dashboard/privacy/manualLock');
    await initializeManualLockButton();
  } catch (error) {
    console.error('Failed to initialize privacy system for Dashboard:', error);
  }
}
