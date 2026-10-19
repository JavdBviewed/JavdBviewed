/**
 * @file enqueueLocalChange.test.ts
 * @description 10-18 审计 C2-2：scheduleEnqueue 失败日志+重试判别（原 fire-and-forget catch-all 静默吞错）
 * - 连续失败：共 3 次尝试、1s/4s 退避、2×warn + 1×error（重试耗尽）、失败计数 +1
 * - 重试后成功：仅 1×warn、无耗尽 error、计数不变
 * - 同步 throw：与异步 reject 同路径重试
 * @module features/cloudSync
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCloudEnqueueFailureCount, scheduleEnqueue } from './enqueueLocalChange';

describe('scheduleEnqueue 失败日志与重试（C2-2）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('连续失败：共 3 次尝试、1s/4s 退避、2×warn + 1×error（重试耗尽）、失败计数 +1', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = getCloudEnqueueFailureCount();
    let calls = 0;
    const task = () => {
      calls += 1;
      return Promise.reject(new Error('quota exceeded'));
    };
    scheduleEnqueue(task);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('入队失败（第 1/3 次）');
    expect(warn.mock.calls[0][0]).toContain('quota exceeded');
    expect(warn.mock.calls[0][0]).toContain('1000ms 后重试');
    expect(warn.mock.calls[1][0]).toContain('入队失败（第 2/3 次）');
    expect(warn.mock.calls[1][0]).toContain('4000ms 后重试');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('入队重试耗尽');
    expect(error.mock.calls[0][0]).toContain('变更未进 pending 队列');
    expect(error.mock.calls[0][0]).toContain('quota exceeded');
    expect(getCloudEnqueueFailureCount()).toBe(before + 1);
    // 无第 4 次尝试
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toBe(3);
    warn.mockRestore();
    error.mockRestore();
  });

  it('重试后成功：仅 1×warn、无耗尽 error、失败计数不变', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = getCloudEnqueueFailureCount();
    let calls = 0;
    const task = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('lock busy')) : Promise.resolve();
    };
    scheduleEnqueue(task);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('入队失败（第 1/3 次）');
    expect(error).not.toHaveBeenCalled();
    expect(getCloudEnqueueFailureCount()).toBe(before);
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toBe(2);
    warn.mockRestore();
    error.mockRestore();
  });

  it('同步 throw 与异步 reject 同路径重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const task = () => {
      calls += 1;
      if (calls < 3) throw new Error('sync boom');
      return Promise.resolve();
    };
    scheduleEnqueue(task);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('sync boom');
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });
});
