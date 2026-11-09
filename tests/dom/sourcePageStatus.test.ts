import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPageUserStatus, observeSourcePageStatus } from '../../apps/extension/src/features/videoDetail/sourcePageStatus';

const marker = '<div class="review-title"><a href="/users/watched_videos"><span class="tag">我看過這部影片</span></a></div>';
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  window.history.pushState({}, '', '/v/test');
  document.body.innerHTML = '<nav class="movie-panel-info"><div class="review-buttons"></div></nav><form id="new_review" action="/v/test/reviews"><button>保存</button></form>';
});
afterEach(() => { dispose?.(); vi.clearAllTimers(); vi.useRealTimers(); document.body.innerHTML = ''; });

describe('source account status confirmation', () => {
  it('bounds failed writes and reports a visible failure once', async () => {
    const apply = vi.fn(async () => false);
    const failure = vi.fn();
    dispose = observeSourcePageStatus(apply, failure);
    document.querySelector('.review-buttons')!.innerHTML = marker;
    await vi.advanceTimersByTimeAsync(15000);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(failure).toHaveBeenCalledTimes(1);
    document.querySelector('.review-title')!.append(' ');
    await vi.advanceTimersByTimeAsync(15000);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it('confirms slow saves with blank score/comment without treating submit as success', async () => {
    const apply = vi.fn(async () => true);
    dispose = observeSourcePageStatus(apply, vi.fn());
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(4000);
    expect(apply).not.toHaveBeenCalled();
    document.querySelector('.review-buttons')!.outerHTML = `<div class="review-buttons">${marker}</div>`;
    await vi.advanceTimersByTimeAsync(4000);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toBe('viewed');
  });

  it('unrelated actor changes do not cause status work', async () => {
    const apply = vi.fn(async () => true);
    dispose = observeSourcePageStatus(apply, vi.fn());
    document.querySelector('.movie-panel-info')!.insertAdjacentHTML('beforeend', '<div class="actor">actor</div>');
    await vi.advanceTimersByTimeAsync(8000);
    expect(apply).not.toHaveBeenCalled();
  });

  it('missing markers alone never clear viewed; explicit successful removal can', async () => {
    document.querySelector('.review-buttons')!.innerHTML = marker + '<a data-method="delete" href="/v/test/reviews/1">取消</a>';
    const apply = vi.fn(async () => true);
    dispose = observeSourcePageStatus(apply, vi.fn());
    document.querySelector('.review-title')!.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(apply).not.toHaveBeenCalled();
    document.querySelector('a')!.dispatchEvent(new Event('ajax:success', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(apply.mock.calls[0]?.slice(0, 2)).toEqual([null, true]);
  });

  it('does not run pending confirmation after disposal or navigation', async () => {
    const apply = vi.fn(async () => true);
    dispose = observeSourcePageStatus(apply, vi.fn());
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
    document.querySelector('.review-buttons')!.innerHTML = marker;
    window.history.pushState({}, '', '/v/other');
    await vi.advanceTimersByTimeAsync(10000);
    expect(apply).not.toHaveBeenCalled();
  });

  it('ignores public review tags and external account links', () => {
    document.querySelector('.review-buttons')!.innerHTML = '<div class="review-title"><a href="https://external.example/users/watched_videos">外部链接</a></div>';
    document.body.insertAdjacentHTML('beforeend', `<section>${marker}</section>`);
    expect(detectPageUserStatus()).toBeNull();
  });
});
