import type { JavdbLoginState } from './javdbLoginVerification';
export const CROSSLINE_DISMISS_MS = 24 * 60 * 60 * 1000;
export const CROSSLINE_GLOBAL_INTERVAL_MS = 10 * 60 * 1000;
export const CROSSLINE_SUPPRESSION_KEY = 'javdbCrosslinePromptSuppression';
export const CROSSLINE_SESSION_KEY = 'javdbCrosslinePromptSession';
export type CrosslineSuppression = Record<string, { until: number; reason: 'dismiss' | 'logout' }>;
export function crosslineScopeKey(storeId: string, host: string): string { return `${storeId}:${host}`; }
export function shouldAutoPrompt(input: {
  enabled: boolean; targetState: JavdbLoginState; sourceCount: number; now: number;
  suppressedUntil: number; shownThisSession: boolean; lastGlobalShownAt: number;
}): boolean {
  return input.enabled && input.targetState === 'anonymous' && input.sourceCount > 0 &&
    input.suppressedUntil <= input.now && !input.shownThisSession &&
    (!input.lastGlobalShownAt || input.now - input.lastGlobalShownAt >= CROSSLINE_GLOBAL_INTERVAL_MS);
}
