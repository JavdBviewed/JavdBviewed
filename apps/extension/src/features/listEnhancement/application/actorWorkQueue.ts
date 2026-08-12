import { countContentPerformanceEvent } from '../../../platform/tasks';

export interface ActorWorkQueueOptions {
  concurrency?: number;
  logger?: (error: unknown) => void;
}

export type ActorWorkQueueKey = object | string;

export interface ActorWorkQueue {
  enqueue(task: () => Promise<void>, key?: ActorWorkQueueKey): void;
  clearPending(): void;
  getStatus(): { active: number; pending: number };
}

export function createActorWorkQueue(options: ActorWorkQueueOptions = {}): ActorWorkQueue {
  const concurrency = Math.max(1, Math.min(16, Math.floor(options.concurrency ?? 4)));
  const pending: Array<{ task: () => Promise<void>; key?: ActorWorkQueueKey }> = [];
  const pendingKeys = new Set<ActorWorkQueueKey>();
  const activeKeys = new Set<ActorWorkQueueKey>();
  let active = 0;
  let pumpScheduled = false;

  const schedulePump = (): void => {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(() => {
      pumpScheduled = false;
      pump();
    }, 0);
  };

  const pump = (): void => {
    while (active < concurrency && pending.length > 0) {
      const work = pending.shift();
      if (!work) break;

      if (work.key !== undefined) {
        pendingKeys.delete(work.key);
        activeKeys.add(work.key);
      }

      active += 1;
      countContentPerformanceEvent('actorQueue.start');
      void Promise.resolve()
        .then(work.task)
        .catch(error => {
          countContentPerformanceEvent('actorQueue.error');
          options.logger?.(error);
        })
        .finally(() => {
          if (work.key !== undefined) {
            activeKeys.delete(work.key);
          }
          active -= 1;
          countContentPerformanceEvent('actorQueue.complete');
          // 给渲染和用户输入一个调度机会，避免连续演员任务占满主线程。
          schedulePump();
        });
    }
  };

  return {
    enqueue(task, key): void {
      if (key !== undefined && (pendingKeys.has(key) || activeKeys.has(key))) {
        countContentPerformanceEvent('actorQueue.deduped');
        return;
      }

      pending.push({ task, key });
      if (key !== undefined) {
        pendingKeys.add(key);
      }
      countContentPerformanceEvent('actorQueue.enqueue');
      pump();
    },
    clearPending(): void {
      pending.length = 0;
      pendingKeys.clear();
    },
    getStatus(): { active: number; pending: number } {
      return { active, pending: pending.length };
    },
  };
}
