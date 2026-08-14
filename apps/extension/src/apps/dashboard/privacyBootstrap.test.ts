import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerDashboardPrivacyLockHandler } from './privacyBootstrap';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerDashboardPrivacyLockHandler', () => {
  it('does not keep an unrelated task-center message channel open', () => {
    let listener: ((message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | void) | undefined;
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: (candidate: typeof listener) => {
            listener = candidate;
          },
        },
      },
    });

    registerDashboardPrivacyLockHandler();

    expect(listener?.({ type: 'task-center:query' }, {}, vi.fn())).toBe(false);
  });
});
