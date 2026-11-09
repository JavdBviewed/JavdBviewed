// @vitest-environment jsdom
/** @description 已保存认证标记不能替代本机有效会话；存储失败仍显示锁屏 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  stored: { isBlurred: false, isLocked: false, isAuthenticated: true, sessionStartTime: 10, lastActivity: 20, temporaryViewActive: false, temporaryViewEndTime: 0 },
  enabled: true, restore: vi.fn(), end: vi.fn(), show: vi.fn(), save: vi.fn(),
}));
vi.mock('../../utils/storage', () => ({ getSettings: async () => ({ privacy: {
  privateMode: { enabled: mocks.enabled, requirePassword: true },
  screenshotMode: { enabled: false, protectedElements: [], blurAreas: [] },
} }), saveSettings: vi.fn() }));
vi.mock('./PasswordService', () => ({ getPasswordService: () => ({}) }));
vi.mock('./SessionManager', () => ({ getSessionManager: () => ({
  restoreSession: mocks.restore, getSessionInfo: () => ({ startTime: 42 }), endSession: mocks.end, addEventListener: vi.fn(),
}) }));
vi.mock('./BlurController', () => ({ getBlurController: () => ({}) }));
vi.mock('./LockScreen', () => ({ getLockScreen: () => ({ show: mocks.show }) }));
vi.mock('./utils/storage', () => ({ getPrivacyStorage: () => ({ loadPrivacyState: async () => mocks.stored, savePrivacyState: mocks.save }) }));
vi.mock('../../utils/logController', () => ({ log: { privacy: vi.fn() } }));
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  mocks.enabled = true; mocks.stored.isLocked = false; mocks.restore.mockResolvedValue(false); mocks.end.mockResolvedValue(undefined); mocks.save.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function initialize() {
  const { getPrivacyManager } = await import('./PrivacyManager');
  const manager = getPrivacyManager();
  const result = manager.initialize().catch(() => {});
  await vi.advanceTimersByTimeAsync(1000); await result; return manager;
}
describe('privacy restoration authority', () => {
  it('locks despite a saved authenticated state when there is no valid session', async () => {
    const manager = await initialize(); expect(mocks.show).toHaveBeenCalledOnce();
    expect(manager.getState()).toMatchObject({ isAuthenticated: false, isLocked: true, sessionStartTime: 0 });
  });
  it('keeps a valid local session and uses its start time', async () => {
    mocks.restore.mockResolvedValue(true); const manager = await initialize();
    expect(mocks.show).not.toHaveBeenCalled(); expect(manager.getState()).toMatchObject({ isAuthenticated: true, sessionStartTime: 42 });
  });
  it('honors a persisted lock even if a residual session exists after cleanup failure', async () => {
    mocks.stored.isLocked = true; mocks.restore.mockResolvedValue(true);
    const manager = await initialize();
    expect(mocks.restore).not.toHaveBeenCalled(); expect(mocks.show).toHaveBeenCalledOnce();
    expect(manager.getState()).toMatchObject({ isAuthenticated: false, isLocked: true });
  });
  it('does not enable private mode when it is disabled', async () => {
    mocks.enabled = false; const manager = await initialize(); expect(mocks.show).not.toHaveBeenCalled();
    expect(manager.getState().isAuthenticated).toBe(false);
  });
  it('shows lock screen before session cleanup can fail', async () => {
    mocks.end.mockRejectedValue(new Error('storage unavailable')); const manager = await initialize();
    expect(mocks.show).toHaveBeenCalledOnce(); expect(manager.getState()).toMatchObject({ isAuthenticated: false, isLocked: true });
  });
});
