import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCloseCurrentTab } from './tabMessageHandlers';

/**
 * G 线（10-05-anchor-close-page-icons）：锚点优化「关闭当前页面」background 侧
 * - sender.tab.id 为权威来源（content 不可伪造目标 tab）
 * - tabs.remove 命中/无 tab/抛错 三分支
 */
describe('handleCloseCurrentTab', () => {
  let removeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    removeMock = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).chrome = { tabs: { remove: removeMock } };
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
  });

  it('removes the sender tab and responds success', async () => {
    const sendResponse = vi.fn();
    await handleCloseCurrentTab({ tab: { id: 7 } }, sendResponse);
    expect(removeMock).toHaveBeenCalledWith(7);
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('responds failure when sender has no tab id', async () => {
    const sendResponse = vi.fn();
    await handleCloseCurrentTab({ tab: null }, sendResponse);
    expect(removeMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    const res = sendResponse.mock.calls[0][0];
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('responds failure with error when tabs.remove throws', async () => {
    removeMock.mockRejectedValue(new Error('boom'));
    const sendResponse = vi.fn();
    await handleCloseCurrentTab({ tab: { id: 9 } }, sendResponse);
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'boom' });
  });
});
