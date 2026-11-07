import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn(), set: vi.fn() }));
vi.mock('../../features/routeManagement/crosslineCookieBridge', () => ({
  getJavdbCrosslineStatus: mocks.get,
  refreshJavdbCrosslineSessions: mocks.refresh,
  setJavdbCrosslineEnabled: mocks.set,
  describeCrosslineError: () => ({ stage: 'settings-write', message: '保存自动同步开关失败，请重试。' }),
}));
import { handleCrosslineSessionMessage } from './crosslineSessionMessageHandler';
const root = 'chrome-extension://test-extension/';
const sender = { id: 'test-extension', url: `${root}dashboard/dashboard.html`, origin: root.slice(0, -1), tab: { id: 1 } } as chrome.runtime.MessageSender;
const status = { enabled: true, checkedAt: 1, reason: 'no-session', routes: [] };
beforeEach(() => {
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension', getURL: () => root } });
  mocks.get.mockResolvedValue(status);
  mocks.refresh.mockResolvedValue(status);
  mocks.set.mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('crossline settings messages', () => {
  it('accepts a Dashboard sender with tab metadata', async () => {
    expect(await handleCrosslineSessionMessage({ type: 'JAVDB_CROSSLINE:STATUS' }, sender)).toEqual({ success: true, status });
    expect(mocks.get).toHaveBeenCalledOnce();
  });
  it.each([
    { ...sender, url: 'https://javdb.com/', origin: 'https://javdb.com' },
    { ...sender, id: 'another-extension' },
    { ...sender, origin: 'null' },
    { ...sender, url: undefined },
  ])('rejects non-extension page origins', async untrusted => {
    expect((await handleCrosslineSessionMessage({ type: 'JAVDB_CROSSLINE:REFRESH' }, untrusted)).success).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects malformed toggles without writes', async () => {
    expect((await handleCrosslineSessionMessage({ type: 'JAVDB_CROSSLINE:SET_ENABLED', enabled: 'false' }, sender)).success).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('awaits toggle persistence and returns current state without duplicating sync', async () => {
    await handleCrosslineSessionMessage({ type: 'JAVDB_CROSSLINE:SET_ENABLED', enabled: false }, sender);
    expect(mocks.set).toHaveBeenCalledWith(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledOnce();
  });
  it('only manual refresh invokes the bridge', async () => {
    await handleCrosslineSessionMessage({ type: 'JAVDB_CROSSLINE:REFRESH' }, sender);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('returns safe stage-specific errors', async () => {
    mocks.set.mockRejectedValueOnce(new Error('secret-browser-error'));
    const response = await handleCrosslineSessionMessage({ type: 'JAVDB_CROSSLINE:SET_ENABLED', enabled: true }, sender);
    expect(response).toMatchObject({ success: false, stage: 'settings-write' });
    expect(JSON.stringify(response)).not.toContain('secret-browser-error');
  });
});
