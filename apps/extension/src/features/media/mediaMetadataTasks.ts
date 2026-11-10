/** Media scan metadata batches: consent is scoped to the persisted batch membership. */
import type { VideoRecord } from '../../types';

export const MEDIA_METADATA_TASKS_KEY = 'media_metadata_batches_v1';
export type MediaMetadataItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'unidentified';
export interface MediaMetadataItem {
  recordId: string;
  code?: string;
  title: string;
  status: MediaMetadataItemStatus;
  error?: string;
}
export interface MediaMetadataBatch {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled';
  runId?: string;
  items: MediaMetadataItem[];
}
export interface MediaMetadataTaskDependencies {
  load(): Promise<MediaMetadataBatch[]>;
  save(batches: MediaMetadataBatch[]): Promise<void>;
  records(): Promise<VideoRecord[]>;
  refresh(id: string): Promise<unknown>;
  id(): string;
  now(): number;
}

export class MediaMetadataTaskService {
  private tail: Promise<unknown> = Promise.resolve();
  private inFlight = new Set<string>();
  private runs = new Map<string, string>();
  constructor(private readonly deps: MediaMetadataTaskDependencies) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
  private async change<T>(fn: (batches: MediaMetadataBatch[]) => Promise<T> | T): Promise<T> {
    return this.serial(async () => {
      const batches = await this.deps.load();
      const previous = JSON.stringify(batches);
      const result = await fn(batches);
      if (JSON.stringify(batches) !== previous) await this.deps.save(batches);
      return result;
    });
  }
  private find(batches: MediaMetadataBatch[], id: string): MediaMetadataBatch {
    const batch = batches.find(b => b.id === id);
    if (!batch) throw new Error('没有找到这批资料同步任务');
    return batch;
  }
  list(): Promise<MediaMetadataBatch[]> { return this.serial(() => this.deps.load()); }

  discover(): Promise<MediaMetadataBatch[]> {
    return this.change(async batches => {
      const known = new Set(batches.flatMap(b => b.items.map(i => i.recordId)));
      const records = (await this.deps.records()).filter(r => r.id.startsWith('media:') && !r.deletedAt && !r.javdbUrl && !known.has(r.id));
      if (records.length) {
        const now = this.deps.now();
        batches.push({ id: this.deps.id(), createdAt: now, updatedAt: now, status: 'pending', items: records.map(r => ({
          recordId: r.id, code: r.videoCode, title: r.title, status: r.videoCode ? 'pending' : 'unidentified',
        })) });
      }
      return batches;
    });
  }
  confirm(id: string): Promise<MediaMetadataBatch> {
    return this.change(batches => {
      if (this.inFlight.has(id)) throw new Error('本批次正在同步，请等待当前影片处理完成');
      const batch = this.find(batches, id);
      if (batch.status === 'cancelled') throw new Error('本批次已取消');
      const todo = batch.items.filter(i => ['pending', 'running', 'failed'].includes(i.status));
      if (!todo.length) throw new Error('没有可同步的影片；未识别番号的影片需要先补充番号');
      for (const item of todo) { item.status = 'pending'; delete item.error; }
      batch.status = 'running'; batch.runId = this.deps.id(); batch.updatedAt = this.deps.now();
      this.runs.set(id, batch.runId);
      return batch;
    });
  }
  private stop(id: string, status: 'paused' | 'cancelled'): Promise<MediaMetadataBatch> {
    return this.change(batches => {
      const batch = this.find(batches, id);
      if (batch.status !== 'completed' && batch.status !== 'cancelled') batch.status = status;
      this.runs.delete(id); batch.updatedAt = this.deps.now();
      return batch;
    });
  }
  pause(id: string): Promise<MediaMetadataBatch> { return this.stop(id, 'paused'); }
  dismiss(id: string): Promise<MediaMetadataBatch> { return this.stop(id, 'cancelled'); }

  async step(id: string, runId: string): Promise<MediaMetadataBatch> {
    if (this.inFlight.has(id)) throw new Error('本批次正在同步');
    this.inFlight.add(id);
    try {
      const recordId = await this.change(batches => {
        const batch = this.find(batches, id);
        if (batch.status !== 'running' || !runId || batch.runId !== runId || this.runs.get(id) !== runId) {
          throw new Error('请确认或继续本批次后再同步');
        }
        const item = batch.items.find(i => i.status === 'pending');
        if (!item) throw new Error('本批次没有待处理影片');
        item.status = 'running'; batch.updatedAt = this.deps.now();
        return item.recordId;
      });
      let failure: string | undefined;
      try { await this.deps.refresh(recordId); }
      catch (error) { failure = error instanceof Error ? error.message : '读取源站资料失败，请稍后重试'; }
      return await this.change(batches => {
        const batch = this.find(batches, id);
        const item = batch.items.find(i => i.recordId === recordId)!;
        item.status = failure ? 'failed' : 'done';
        if (failure) item.error = failure; else delete item.error;
        if (batch.status === 'running' && !batch.items.some(i => i.status === 'pending')) {
          batch.status = 'completed'; this.runs.delete(id);
        }
        batch.updatedAt = this.deps.now();
        return batch;
      });
    } finally { this.inFlight.delete(id); }
  }
}
