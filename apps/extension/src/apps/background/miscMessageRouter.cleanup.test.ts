import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const listeners: Array<(
    message: unknown,
    sender: unknown,
    sendResponse: (response: unknown) => void,
  ) => unknown> = [];
  return {
    listeners,
    addListener: vi.fn((listener) => listeners.push(listener)),
    removeListener: vi.fn(),
    clearInvalidSourceCopies: vi.fn(),
  };
});

vi.mock('../../features/mediaCleanup/mediaCleanupStorage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../features/mediaCleanup/mediaCleanupStorage')>(),
  clearInvalidSourceCopies: testState.clearInvalidSourceCopies,
}));

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown;

let messageListener: MessageListener;

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: testState.addListener,
        removeListener: testState.removeListener,
      },
    },
  });
  const { registerMiscRouter } = await import('./miscMessageRouter');
  registerMiscRouter();
  messageListener = testState.listeners[0];
});

beforeEach(() => {
  testState.clearInvalidSourceCopies.mockReset();
});

async function dispatch(message: Record<string, unknown>) {
  const sendResponse = vi.fn();
  messageListener(message, {}, sendResponse);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
  return sendResponse;
}

describe('MEDIA_CLEANUP_CLEAR_INVALID_COPIES', () => {
  it('legacy 单目标组装为单元素 targets 并返回计数', async () => {
    testState.clearInvalidSourceCopies.mockResolvedValue({
      clearedCount: 1,
      removedEntryCount: 1,
      skippedCount: 0,
    });

    const sendResponse = await dispatch({
      type: 'MEDIA_CLEANUP_CLEAR_INVALID_COPIES',
      titleId: ' title-1 ',
      copyId: ' copy-1 ',
    });

    expect(testState.clearInvalidSourceCopies).toHaveBeenCalledWith({
      targets: [{ titleId: 'title-1', copyId: 'copy-1' }],
    });
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      clearedCount: 1,
      removedEntryCount: 1,
      skippedCount: 0,
    });
  });

  it('600 个合法 targets 按 500+100 两批顺序处理并汇总计数', async () => {
    testState.clearInvalidSourceCopies
      .mockResolvedValueOnce({ clearedCount: 1, removedEntryCount: 2, skippedCount: 3 })
      .mockResolvedValueOnce({ clearedCount: 4, removedEntryCount: 5, skippedCount: 6 });
    const targets = Array.from({ length: 600 }, (_, index) => ({
      titleId: `title-${index}`,
      copyId: `copy-${index}`,
    }));

    const sendResponse = await dispatch({
      type: 'MEDIA_CLEANUP_CLEAR_INVALID_COPIES',
      targets,
    });

    expect(testState.clearInvalidSourceCopies).toHaveBeenCalledTimes(2);
    expect(testState.clearInvalidSourceCopies.mock.calls[0][0].targets).toHaveLength(500);
    expect(testState.clearInvalidSourceCopies.mock.calls[1][0].targets).toHaveLength(100);
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      clearedCount: 5,
      removedEntryCount: 7,
      skippedCount: 9,
    });
  });

  it('targets 为空数组时失败且不调用 storage', async () => {
    const sendResponse = await dispatch({
      type: 'MEDIA_CLEANUP_CLEAR_INVALID_COPIES',
      targets: [],
    });

    expect(testState.clearInvalidSourceCopies).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: '清除目标为空，无可清除条目',
    });
  });

  it('targets 中任一项无效时整体拒绝，不清理其它合法项', async () => {
    const sendResponse = await dispatch({
      type: 'MEDIA_CLEANUP_CLEAR_INVALID_COPIES',
      targets: [{ titleId: 'title-1', copyId: 'copy-1' }, { titleId: ' ', copyId: 'copy-2' }],
    });
    expect(testState.clearInvalidSourceCopies).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: '清除目标包含无效影片或来源副本标识',
    });
  });

  it('超过 1000 个目标时拒绝并且不进入 storage', async () => {
    const sendResponse = await dispatch({
      type: 'MEDIA_CLEANUP_CLEAR_INVALID_COPIES',
      targets: Array.from({ length: 1001 }, (_, index) => ({ titleId: 'title', copyId: String(index) })),
    });
    expect(testState.clearInvalidSourceCopies).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: '清除目标数量超过上限（1000）' });
  });
});
