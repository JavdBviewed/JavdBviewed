import { describe, expect, it } from 'vitest';
import { RequestScheduler } from './requestScheduler';

interface FakeTimer {
  atMs: number;
  fired: boolean;
  fire: () => void;
}

function createScheduler() {
  let nowMs = 1_000_000;
  const timers: FakeTimer[] = [];
  const fetchCalls: string[] = [];
  const fetchImpl = (async (input: any) => {
    const url = String(input);
    fetchCalls.push(url);
    return new Response('{}', { status: fetchCalls.length === 1 ? 429 : 200 });
  }) as unknown as typeof fetch;
  const setTimeoutImpl = ((fn: () => void, delay: number) => {
    const timer: FakeTimer = {
      atMs: nowMs + delay,
      fired: false,
      fire: () => {
        if (!timer.fired) {
          timer.fired = true;
          fn();
        }
      },
    };
    timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const scheduler = new RequestScheduler({
    config: { globalMaxConcurrent: 4, perHostMaxConcurrent: 1, perHostRateLimitPerMin: 12 },
    fetchImpl,
    setTimeoutImpl,
    now: () => nowMs,
  });
  const advance = (ms: number) => {
    nowMs += ms;
    timers
      .filter((timer) => timer.atMs <= nowMs && !timer.fired)
      .sort((a, b) => a.atMs - b.atMs)
      .forEach((timer) => timer.fire());
  };
  return { scheduler, advance, timers, fetchCalls };
}

describe('RequestScheduler host backoff wake', () => {
  it('schedules a wake timer when a queued host enters cooldown instead of stalling', async () => {
    const { scheduler, advance, timers, fetchCalls } = createScheduler();

    const first = scheduler.enqueue('https://api.test/one');
    await first;
    expect(fetchCalls).toEqual(['https://api.test/one']);

    const second = scheduler.enqueue('https://api.test/two');
    // 429 触发 30s 退避，队列中的同 host 任务必须安排 wake，否则退避结束前无人唤醒
    expect(timers.length).toBeGreaterThanOrEqual(1);

    advance(5_000);
    expect(fetchCalls).toEqual(['https://api.test/one']);
    expect(timers.some((timer) => timer.atMs > 1_005_000)).toBe(true);

    advance(25_001);
    await second;
    expect(fetchCalls).toEqual(['https://api.test/one', 'https://api.test/two']);
    expect((await second).status).toBe(200);
  });

  it('keeps queued tasks waiting across wake fires until the cooldown truly expires', async () => {
    const { scheduler, advance, timers, fetchCalls } = createScheduler();

    const first = scheduler.enqueue('https://api.test/one');
    await first;
    const second = scheduler.enqueue('https://api.test/two');

    advance(29_999);
    expect(fetchCalls).toEqual(['https://api.test/one']);

    advance(1);
    await second;
    expect(fetchCalls).toEqual(['https://api.test/one', 'https://api.test/two']);
    expect(timers.length).toBeGreaterThanOrEqual(2);
  });
});
