/**
 * @file listItemObserver.ts
 * @description listItemObserver
 * @module features/listEnhancement
 */
export function processExistingListItems(
  document: Document,
  enhanceItem: (item: HTMLElement) => void,
): void {
  const items = document.querySelectorAll('.movie-list .item');
  items.forEach(item => enhanceItem(item as HTMLElement));
}

export interface ListItemObserverOptions {
  document: Document;
  enhanceItem: (item: HTMLElement) => void;
  onNewItems: (items: readonly HTMLElement[]) => void;
}

export function observeListItems(options: ListItemObserverOptions): MutationObserver | null {
  const targetNode = options.document.querySelector('.movie-list');
  if (!targetNode) return null;

  const observer = new MutationObserver(mutations => {
    countContentPerformanceEvent('observer.listEnhancementManager.callback');
    countContentPerformanceEvent('observer.listEnhancementManager.mutations', mutations.length);
    const newItems = new Set<HTMLElement>();
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const element = node as Element;
        if (element.matches('.item')) {
          newItems.add(element as HTMLElement);
          return;
        }

        const items = element.querySelectorAll('.item');
        items.forEach(item => newItems.add(item as HTMLElement));
      });
    });

    if (newItems.size === 0) return;

    const items = [...newItems];
    items.forEach(options.enhanceItem);
    options.onNewItems(items);
  });

  observer.observe(targetNode, { childList: true, subtree: true });
  return observer;
}
import { countContentPerformanceEvent } from '../../../platform/tasks';
