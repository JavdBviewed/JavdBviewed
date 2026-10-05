/**
 * @file confirmModal.test.ts
 * @description ConfirmModal 测试
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmModal } from '../../apps/extension/src/dashboard/components/confirmModal';

describe('ConfirmModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    vi.useFakeTimers();
  });

  it('renders default message content as text', () => {
    const modal = new ConfirmModal();
    void modal.show({
      title: '<img src=x>',
      message: '<img src=x onerror=alert(1)>Keep text',
      confirmText: '<b>OK</b>',
      cancelText: '<i>Cancel</i>',
    });

    expect(document.querySelector('.modal-body img')).toBeNull();
    expect(document.querySelector('.confirm-message')?.textContent).toBe('<img src=x onerror=alert(1)>Keep text');
    expect(document.querySelector('.modal-header h3')?.textContent).toBe('<img src=x>');
    expect(document.querySelector('#confirmOk')?.textContent).toBe('<b>OK</b>');
    expect(document.querySelector('#confirmCancel')?.textContent).toBe('<i>Cancel</i>');
  });

  it('resolves true on confirm and removes the modal after closing', async () => {
    const modal = new ConfirmModal();
    const result = modal.show({ message: 'Delete item?', type: 'danger' });

    document.querySelector<HTMLButtonElement>('#confirmOk')?.click();
    await vi.advanceTimersByTimeAsync(300);

    await expect(result).resolves.toBe(true);
    expect(document.querySelector('.confirm-modal')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('resolves false when Escape is pressed', async () => {
    const modal = new ConfirmModal();
    const result = modal.show({ message: 'Close?' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.advanceTimersByTimeAsync(300);

    await expect(result).resolves.toBe(false);
    expect(document.querySelector('.confirm-modal')).toBeNull();
  });
});

/** 让微任务队列排空后检查 Promise 是否已 settle（fake timers 下不用 setTimeout 竞态，防假超时误判） */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return settled;
}

describe('ConfirmModal — 10-05 F-1 单例劫持：新 show() 到达时旧弹窗自动放弃（resolve false）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    // 收口残留弹窗（含本用例故意留开的）并触发残留 keydown 监听自摘，防跨用例污染
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(300);
  });

  it('旧弹窗未收口时再 show() → 旧 Promise 以 false settle（旧工作流走 cancel 收口），新弹窗接管且可正常收口', async () => {
    const modal = new ConfirmModal();
    const first = modal.show({ message: '第一次确认', confirmText: '确认1' });
    expect(document.querySelector('#confirmOk')?.textContent).toBe('确认1');

    const second = modal.show({ message: '第二次确认', confirmText: '确认2' });

    // 新弹窗接管 DOM（旧 DOM 被移除，既有行为）
    expect(document.querySelectorAll('.confirm-modal')).toHaveLength(1);
    expect(document.querySelector('#confirmOk')?.textContent).toBe('确认2');

    // 旧 Promise 必须 settle（修复前=永久悬挂 → 本断言 RED）
    await expect(isSettled(first)).resolves.toBe(true);
    await expect(first).resolves.toBe(false);

    // 新弹窗回调链未被旧弹窗污染：确认 → true
    document.querySelector<HTMLButtonElement>('#confirmOk')?.click();
    await vi.advanceTimersByTimeAsync(300);
    await expect(second).resolves.toBe(true);
    expect(document.querySelector('.confirm-modal')).toBeNull();
  });

  it('旧弹窗已收口（正常点选关闭）后再 show() → 幂等零副作用', async () => {
    const modal = new ConfirmModal();
    const first = modal.show({ message: 'A' });
    document.querySelector<HTMLButtonElement>('#confirmOk')?.click();
    await vi.advanceTimersByTimeAsync(300);
    await expect(first).resolves.toBe(true);

    const second = modal.show({ message: 'B' });
    document.querySelector<HTMLButtonElement>('#confirmCancel')?.click();
    await vi.advanceTimersByTimeAsync(300);
    await expect(second).resolves.toBe(false);
    expect(document.querySelector('.confirm-modal')).toBeNull();
  });

  it('连续三次 show() → 前两个均以 false settle，只有最后一个可被用户收口', async () => {
    const modal = new ConfirmModal();
    const m1 = modal.show({ message: 'M1' });
    const m2 = modal.show({ message: 'M2' });
    const m3 = modal.show({ message: 'M3' });

    // 修复前 m1/m2 永久悬挂 → isSettled 快速 RED（不靠 20s 超时）
    await expect(isSettled(m1)).resolves.toBe(true);
    await expect(isSettled(m2)).resolves.toBe(true);
    await expect(m1).resolves.toBe(false);
    await expect(m2).resolves.toBe(false);
    expect(document.querySelector('#confirmOk')?.textContent).toBe('确认');
    expect(document.querySelectorAll('.confirm-modal')).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('#confirmOk')?.click();
    await vi.advanceTimersByTimeAsync(300);
    await expect(m3).resolves.toBe(true);
  });
});
