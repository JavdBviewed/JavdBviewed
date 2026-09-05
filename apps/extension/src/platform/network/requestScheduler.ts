/**
 * @file requestScheduler.ts
 * @description 请求调度器 —— 控制并发数和每域名速率限制，防止请求风暴
 * @module platform/network
 *
 * 支持全局并发限制 + 每域名并发限制 + 每域名每分钟速率限制，
 * 用于磁力搜索等需要大量并发请求的场景。
 */

/** 调度器配置 */
export interface SchedulerConfig {
  globalMaxConcurrent: number;                        // 全局最大并发请求数
  perHostMaxConcurrent: number;                       // 每域名最大并发数
  perHostRateLimitPerMin: number;                     // 每域名每分钟最大请求数
}

/** 内部排队任务 */
interface Task {
  url: string;
  options: RequestInit;
  host: string;
  resolve: (response: Response) => void;
  reject: (error: any) => void;
}

/** 调度器创建选项 */
export interface RequestSchedulerOptions {
  config?: Partial<SchedulerConfig>;
  fetchImpl?: typeof fetch;
  setTimeoutImpl?: typeof setTimeout;
  now?: () => number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  globalMaxConcurrent: 4,
  perHostMaxConcurrent: 1,
  perHostRateLimitPerMin: 12,
};

export class RequestScheduler {
  private config: SchedulerConfig = { ...DEFAULT_CONFIG };
  private globalActive = 0;
  private hostActive = new Map<string, number>();
  private queue: Task[] = [];
  private inFlight = new Map<string, Promise<Response>>();
  private hostTimestamps = new Map<string, number[]>();
  private hostCooldownUntil = new Map<string, number>();
  private hostBackoffMs = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly now: () => number;

  constructor(options: RequestSchedulerOptions = {}) {
    this.config = { ...this.config, ...options.config };
    this.fetchImpl = options.fetchImpl ?? (((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch);
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    this.now = options.now ?? Date.now;
  }

  updateConfig(config: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async enqueue(url: string, options: RequestInit = {}): Promise<Response> {
    const key = this.buildKey(url, options);
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const host = this.getHost(url);
    const promise = new Promise<Response>((resolve, reject) => {
      this.queue.push({ url, options, host, resolve, reject });
      this.tryStartNext();
    });

    const wrapped = promise.finally(() => this.inFlight.delete(key)) as Promise<Response>;
    this.inFlight.set(key, wrapped);
    return wrapped;
  }

  private buildKey(url: string, options: RequestInit): string {
    const method = (options.method || 'GET').toUpperCase();
    const body = typeof options.body === 'string' ? options.body : '';
    return `${method}:${url}:${body}`;
  }

  private getHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return 'unknown-host';
    }
  }

  private getHostNextAvailableTime(host: string): number {
    const limit = Math.max(1, this.config.perHostRateLimitPerMin);
    const windowMs = 60_000;
    const now = this.now();
    const timestamps = (this.hostTimestamps.get(host) || []).filter((timestamp) => now - timestamp < windowMs);
    this.hostTimestamps.set(host, timestamps);
    if (timestamps.length < limit) return now;
    return timestamps[0] + windowMs;
  }

  private markHostRequestCompleted(host: string): void {
    const timestamps = this.hostTimestamps.get(host) || [];
    timestamps.push(this.now());
    const now = this.now();
    const windowMs = 60_000;
    this.hostTimestamps.set(host, timestamps.filter((timestamp) => now - timestamp < windowMs));
  }

  private canStart(host: string): boolean {
    const globalOk = this.globalActive < this.config.globalMaxConcurrent;
    const hostActive = this.hostActive.get(host) || 0;
    const hostOk = hostActive < this.config.perHostMaxConcurrent;
    const rateOk = this.getHostNextAvailableTime(host) <= this.now();
    const cooldownUntil = this.hostCooldownUntil.get(host) || 0;
    const cooldownOk = this.now() >= cooldownUntil;
    return globalOk && hostOk && rateOk && cooldownOk;
  }

  private tryStartNext(): void {
    if (this.queue.length === 0) return;

    for (let index = 0; index < this.queue.length; index++) {
      const task = this.queue[index];
      if (this.canStart(task.host)) {
        this.queue.splice(index, 1);
        this.startTask(task);
        index = -1;
      }
    }

    const nextWake = this.computeNextWakeTime();
    if (nextWake > this.now()) {
      const delay = Math.min(5_000, Math.max(0, nextWake - this.now()));
      this.setTimeoutImpl(() => this.tryStartNext(), delay);
    }
  }

  private computeNextWakeTime(): number {
    let next = Infinity;
    for (const task of this.queue) {
      const rateTime = this.getHostNextAvailableTime(task.host);
      const cooldownTime = this.hostCooldownUntil.get(task.host) || 0;
      const candidate = Math.max(rateTime, cooldownTime);
      if (candidate < next) next = candidate;
    }
    return next === Infinity ? this.now() : next;
  }

  private async startTask(task: Task): Promise<void> {
    const { host, url, options, resolve, reject } = task;
    this.globalActive++;
    this.hostActive.set(host, (this.hostActive.get(host) || 0) + 1);

    try {
      const response = await this.fetchImpl(url, options);
      if (response.status === 429 || response.status === 503) {
        this.applyBackoff(host);
      } else {
        this.resetBackoff(host);
      }
      resolve(response);
      this.markHostRequestCompleted(host);
    } catch (error) {
      this.applyBackoff(host, true);
      reject(error);
    } finally {
      this.globalActive--;
      this.hostActive.set(host, Math.max(0, (this.hostActive.get(host) || 1) - 1));
      this.tryStartNext();
    }
  }

  private applyBackoff(host: string, light = false): void {
    const base = light ? 10_000 : 30_000;
    const current = this.hostBackoffMs.get(host) || base;
    const next = Math.min(current * 2, 300_000);
    const until = this.now() + current;
    this.hostCooldownUntil.set(host, Math.max(this.hostCooldownUntil.get(host) || 0, until));
    this.hostBackoffMs.set(host, next);
  }

  private resetBackoff(host: string): void {
    this.hostBackoffMs.delete(host);
  }
}

export const requestScheduler = new RequestScheduler();
