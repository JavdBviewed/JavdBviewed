/**
 * @file embyStateRerun.test.ts
 * @description EMBY_LIBRARY_STATE_UPDATED 广播 re-mark 路径有界重试锁（10-15 A1-1/A1-2 判别性用例）。
 *
 * 根因：scheduler 仅在状态写时广播（50ms debounce）；广播落在「页面未就绪」窗时，
 * 首次 processVisibleItems 被 isPageProperlyLoaded 门控整批静默跳过，无重试无兜底，
 * 页面就绪后不再补跑 → 已入库卡片隐藏状态丢失（「隐藏已入库」概率性幻视）。
 *
 * 本测试经真实 installContentMessageRouter + chrome mock 驱动 EMBY 分支，锁：
 *   1. 首次 pass 被门控拦截 → 按 400/1500/4000ms 有界重试（自门控：门控恢复即执行）；
 *   2. 某次重试执行成功 → 取消剩余重试（不冗余重跑）；
 *   3. 重试全失败 → 末次回退 recomputeAllListHiding（无门控，settings 分支先例）；
 *   4. 新广播重置重试链（不堆叠）；
 *   5. 健康页（首次 pass 成功）→ 零重试成本；
 *   6. sendResponse 契约不变（成功 {success:true} / storage 失败 {success:false, error}）。
 * @module tests/extension
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setChromeStorage } from '../setup/chrome';
import { STORAGE_KEYS } from '../../apps/extension/src/utils/config';
import { getValue } from '../../apps/extension/src/utils/storage';
import { listEnhancementManager } from '../../apps/extension/src/features/listEnhancement/listEnhancementManager';
import { processVisibleItems } from '../../apps/extension/src/features/listEnhancement/content/itemProcessor';
import { EMBY_STATE_RERUN_DELAYS_MS } from '../../apps/extension/src/features/listEnhancement/content/embyStateRerun';

vi.mock('../../apps/extension/src/features/listEnhancement/content/itemProcessor', () => ({
  processVisibleItems: vi.fn(),
}));

vi.mock('../../apps/extension/src/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/extension/src/utils/storage')>();
  return { ...actual, getValue: vi.fn() };
});

const processVisibleItemsMock = processVisibleItems as unknown as ReturnType<typeof vi.fn>;
const getValueMock = getValue as unknown as ReturnType<typeof vi.fn>;

const EMBY_STATE = { entries: { 'AAA-001': [{ itemId: 'emby-item-1' }] }, updatedAt: 1 };

let recomputeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  processVisibleItemsMock.mockReset();
  getValueMock.mockResolvedValue(EMBY_STATE);
  recomputeSpy = vi
    .spyOn(listEnhancementManager, 'recomputeAllListHiding')
    .mockImplementation(() => undefined);
  const { installContentMessageRouter } = await import(
    '../../apps/extension/src/apps/content/contentMessageRouter'
  );
  installContentMessageRouter();
  setChromeStorage({ [STORAGE_KEYS.EMBY_LIBRARY_STATE]: EMBY_STATE });
});

afterEach(() => {
  recomputeSpy.mockRestore();
});

/** 向 router 已安装的 onMessage 监听器派发 EMBY 广播，返回 (sendResponse 收到的响应) */
async function fireEmbyBroadcast(): Promise<{ response: any; returnedTrue: boolean }> {
  const onMessage = chrome.runtime.onMessage as unknown as { listeners: Set<(m: any, s: any, r: any) => unknown> };
  let returnedTrue = false;
  let embySpy: ReturnType<typeof vi.fn> | null = null;
  for (const listener of onMessage.listeners) {
    const spy = vi.fn();
    const ret = listener({ type: 'EMBY_LIBRARY_STATE_UPDATED' }, { id: 'tab-1' } as any, spy);
    if (ret === true) {
      returnedTrue = true;
      embySpy = spy;
    }
  }
  // 等待异步响应（getValue().then 微任务）
  await vi.advanceTimersByTimeAsync(0);
  const response = embySpy && embySpy.mock.calls.length > 0 ? (embySpy.mock.calls[0][0] as any) : undefined;
  return { response, returnedTrue };
}

describe('EMBY_LIBRARY_STATE_UPDATED 广播 re-mark 有界重试（A1-1/A1-2）', () => {
  it('重试延迟序列锁定为 400/1500/4000ms', () => {
    expect(EMBY_STATE_RERUN_DELAYS_MS).toEqual([400, 1500, 4000]);
  });

  it('首次 pass 被门控拦截 → 400ms 重试执行 re-mark pass，且剩余重试取消（A1-1 主修）', async () => {
    processVisibleItemsMock.mockReturnValueOnce(false); // 首次 pass 被门控拦截
    processVisibleItemsMock.mockReturnValue(true); // 页面门控恢复

    const { returnedTrue } = await fireEmbyBroadcast();
    expect(returnedTrue).toBe(true);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(2);

    // 门控已恢复且重试已执行 → 1500/4000 的剩余重试取消，不再重跑
    await vi.advanceTimersByTimeAsync(1100);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2500);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(2);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it('门控持续失败 → 恰好 3 次重试 + 末次回退 recomputeAllListHiding，且无后续补跑', async () => {
    processVisibleItemsMock.mockReturnValue(false);

    await fireEmbyBroadcast();
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(399);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // t=400
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1100); // t=1500
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2500); // t=4000
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(4);
    expect(recomputeSpy).toHaveBeenCalledTimes(1);

    // 有界：之后不再有任何补跑
    await vi.advanceTimersByTimeAsync(10000);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(4);
    expect(recomputeSpy).toHaveBeenCalledTimes(1);
  });

  it('新广播重置重试链：不堆叠、旧链取消（A1-2 去重）', async () => {
    processVisibleItemsMock.mockReturnValue(false);

    await fireEmbyBroadcast(); // t=0，首次 1 次
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200); // t=200
    await fireEmbyBroadcast(); // 第二次广播：重置链，其首次 pass 亦被拦截
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(2);

    // 旧链 t=400 的尝试已被取消（新链首档在 t=600）
    await vi.advanceTimersByTimeAsync(200); // t=400
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); // t=600 = 200+400
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1100); // t=1700 = 200+1500
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2500); // t=4200 = 200+4000
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(5);
    expect(recomputeSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10000);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(5);
    expect(recomputeSpy).toHaveBeenCalledTimes(1);
  });

  it('健康页（首次 pass 成功）→ 零重试成本', async () => {
    processVisibleItemsMock.mockReturnValue(true);

    await fireEmbyBroadcast();
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10000);
    expect(processVisibleItemsMock).toHaveBeenCalledTimes(1);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it('sendResponse 契约不变：成功 {success:true}；storage 读失败 {success:false, error}', async () => {
    processVisibleItemsMock.mockReturnValue(true);

    const { response } = await fireEmbyBroadcast();
    expect(response).toEqual({ success: true });

    processVisibleItemsMock.mockReset();
    processVisibleItemsMock.mockReturnValue(true);
    getValueMock.mockRejectedValueOnce(new Error('storage down'));

    const { response: response2 } = await fireEmbyBroadcast();
    expect(response2).toEqual({ success: false, error: 'storage down' });
  });
});
