/**
 * @file realtimeCheck.ts
 * @description realtimeCheck
 * @module features/embyLibrary
 */
import { STATE, log } from '../../contentState';
import { normalizeVideoCode } from '../domain/libraryIndex';
import { isEmbyLibraryEnabled } from '../../../utils/config';
import type { EmbyLibraryState } from '../types';

export interface RealtimeCheckConfig {
  enabled: boolean;
  batchSize: number;
  cacheTtlMs: number;
  debounceMs: number;
}

interface RealtimeCheckQueueDeps {
  sendMessage: (message: any) => Promise<any>;
  now: () => number;
  onState: (state: EmbyLibraryState) => void;
  onReprocess: (codes: readonly string[]) => void;
}

function sendRuntimeMessage(message: any): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (error) {
      resolve({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export class EmbyLibraryRealtimeCheckQueue {
  private pending = new Set<string>();
  private checkedAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private config: RealtimeCheckConfig = {
    enabled: false,
    batchSize: 20,
    cacheTtlMs: 10 * 60 * 1000,
    debounceMs: 600,
  };

  constructor(private readonly deps: RealtimeCheckQueueDeps) {}

  enqueue(codes: string[], config?: Partial<RealtimeCheckConfig>): void {
    this.config = { ...this.config, ...(config || {}) };
    if (!this.config.enabled) return;

    const now = this.deps.now();
    for (const rawCode of codes) {
      const code = normalizeVideoCode(rawCode);
      if (!code) continue;
      const lastCheckedAt = this.checkedAt.get(code);
      if (lastCheckedAt !== undefined && now - lastCheckedAt < this.config.cacheTtlMs) continue;
      this.pending.add(code);
    }

    if (this.pending.size === 0) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(0, this.config.debounceMs));
  }

  async flush(): Promise<void> {
    if (this.running || this.pending.size === 0 || !this.config.enabled) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = true;
    const batchSize = Math.max(1, Math.min(20, Number(this.config.batchSize) || 20));
    const codes = Array.from(this.pending).slice(0, batchSize);
    codes.forEach((code) => this.pending.delete(code));

    try {
      const response = await this.deps.sendMessage({
        type: 'EMBY_LIBRARY_CHECK_CODES',
        codes,
      });

      const now = this.deps.now();
      codes.forEach((code) => this.checkedAt.set(code, now));

      if (response?.success && response.state) {
        this.deps.onState(response.state);
        // 只重处理本批已完成实时检查的卡片，避免每个批次都重跑整页列表。
        this.deps.onReprocess(codes);
      }
    } catch (error) {
      log('Emby library realtime check failed:', error as any);
    } finally {
      this.running = false;
      if (this.pending.size > 0) {
        this.schedule();
      }
    }
  }
}

export const embyLibraryRealtimeCheckQueue = new EmbyLibraryRealtimeCheckQueue({
  sendMessage: sendRuntimeMessage,
  now: () => Date.now(),
  onState: (state) => {
    STATE.embyLibraryState = state;
  },
  onReprocess: (codes) => {
    void import('../../listEnhancement/content/itemProcessor')
      .then(({ processVisibleItems }) => processVisibleItems({ force: true, codes }))
      .catch((error) => log('Failed to reprocess list after Emby library check:', error as any));
  },
});

export function buildRealtimeCheckConfig(settings: any): RealtimeCheckConfig {
  const raw = settings?.emby?.realtimeCheck || {};
  return {
    enabled: isEmbyLibraryEnabled(settings?.emby) && raw.enabled === true,
    batchSize: Math.max(1, Math.min(20, Number(raw.batchSize ?? 20) || 20)),
    cacheTtlMs: Math.max(1, Number(raw.cacheTtlMinutes ?? 10) || 10) * 60 * 1000,
    debounceMs: 600,
  };
}
