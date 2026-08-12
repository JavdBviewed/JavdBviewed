import { observeWhenVisible } from '../../../ui/lib/sharedIntersectionObserver';

export interface ActorVisibilityGate {
  defer(item: HTMLElement, callback: () => void): boolean;
  cancel(item: HTMLElement): void;
  cancelAll(): void;
}

const ACTOR_VISIBILITY_OPTIONS = {
  rootMargin: '240px 0px',
  threshold: 0.01,
};

export function createActorVisibilityGate(): ActorVisibilityGate {
  const pending = new Map<HTMLElement, () => void>();

  return {
    defer(item, callback): boolean {
      if (typeof IntersectionObserver === 'undefined') {
        return false;
      }
      if (pending.has(item)) {
        return true;
      }

      const stop = observeWhenVisible(item, () => {
        pending.delete(item);
        callback();
      }, ACTOR_VISIBILITY_OPTIONS);
      pending.set(item, stop);
      return true;
    },

    cancel(item): void {
      const stop = pending.get(item);
      if (!stop) return;
      pending.delete(item);
      stop();
    },

    cancelAll(): void {
      const stops = [...pending.values()];
      pending.clear();
      stops.forEach(stop => stop());
    },
  };
}
