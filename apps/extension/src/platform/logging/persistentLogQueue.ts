/**
 * @file persistentLogQueue.ts
 * @description 将高频日志合并后批量发送到 background，避免逐条消息和 IndexedDB 事务。
 * @module platform/logging
 */

export interface PersistentLogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  data?: unknown;
}

export interface LogPersistenceQueueOptions {
  batchSize?: number;
  flushDelayMs?: number;
  maxPendingEntries?: number;
  retryDelayMs?: number;
  send?: (entries: PersistentLogEntry[]) => Promise<void>;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_FLUSH_DELAY_MS = 250;
const DEFAULT_MAX_PENDING_ENTRIES = 256;
const DEFAULT_RETRY_DELAY_MS = 1000;

function sendLogBatch(entries: PersistentLogEntry[]): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 5000);
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        finish();
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'DB:LOGS_BULK', payload: { entries } },
        () => {
          // 发送失败时不能再次打印日志，否则会形成递归日志风暴。
          void chrome.runtime.lastError;
          finish();
        },
      );
    } catch {
      finish();
    }
  });
}

export class LogPersistenceQueue {
  private readonly batchSize: number;
  private readonly flushDelayMs: number;
  private readonly maxPendingEntries: number;
  private readonly retryDelayMs: number;
  private readonly send: (entries: PersistentLogEntry[]) => Promise<void>;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private pending: PersistentLogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;

  constructor(options: LogPersistenceQueueOptions = {}) {
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE));
    this.flushDelayMs = Math.max(0, Math.floor(options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS));
    this.maxPendingEntries = Math.max(this.batchSize, Math.floor(options.maxPendingEntries ?? DEFAULT_MAX_PENDING_ENTRIES));
    this.retryDelayMs = Math.max(this.flushDelayMs, Math.floor(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
    this.send = options.send ?? sendLogBatch;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  enqueue(entry: PersistentLogEntry): void {
    this.pending.push(entry);
    if (this.pending.length > this.maxPendingEntries) {
      this.pending.splice(0, this.pending.length - this.maxPendingEntries);
    }
    if (this.pending.length >= this.batchSize) {
      void this.flush();
      return;
    }
    this.schedule(this.flushDelayMs);
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.cancelTimer();
    this.flushing = true;
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0, this.batchSize);
        try {
          await this.send(batch);
        } catch {
          this.pending.unshift(...batch);
          this.schedule(this.retryDelayMs);
          break;
        }
      }
    } finally {
      this.flushing = false;
      if (this.pending.length > 0 && !this.timer) this.schedule(this.flushDelayMs);
    }
  }

  pendingCount(): number {
    return this.pending.length;
  }

  private schedule(delayMs: number): void {
    if (this.timer) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.flush();
    }, delayMs);
  }

  private cancelTimer(): void {
    if (!this.timer) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
  }
}

export const persistentLogQueue = new LogPersistenceQueue();

export function enqueuePersistentLog(entry: PersistentLogEntry): void {
  persistentLogQueue.enqueue(entry);
}
