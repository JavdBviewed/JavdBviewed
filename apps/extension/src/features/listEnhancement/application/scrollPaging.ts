/**
 * @file scrollPaging.ts
 * @description scrollPaging
 * @module features/listEnhancement
 */
export interface ScrollPagingPageInfo {
  currentPage: number;
  maxPage: number | null;
}

export interface SuperRankingPageInfo {
  page: number;
  maxPage: number | null;
}

export interface SuperRankingAppendResult {
  handled: boolean;
  appended: number;
  page: number;
  maxPage: number;
  url?: string;
}

export interface ResolveScrollPagingPageInfoInput {
  superRankingPageInfo: SuperRankingPageInfo | null;
  search: string;
  paginationLinks: NodeListOf<Element> | Element[];
}

export interface ShouldTriggerScrollPagingInput {
  isLoadingNextPage: boolean;
  currentPage: number;
  maxPage: number | null;
  scrollTop: number;
  windowHeight: number;
  documentHeight: number;
  threshold: number;
}

export interface ListScrollPagingControllerOptions {
  document: Document;
  window: Window;
  threshold: number;
  logger?: (...args: any[]) => void;
  getSuperRankingPageInfo: () => SuperRankingPageInfo | null;
  appendSuperRankingPage: (page: number) => Promise<SuperRankingAppendResult>;
  fetchText: (url: string) => Promise<string>;
  processVisibleItems: () => void;
  clearActorCaches: () => void;
  /** 演员缓存被清除后回调（供上层重置名称标识预热等派生状态）。 */
  onActorIndexCleared?: () => void;
  onItemsAppended?: (event: ListScrollPagingAppendEvent) => void;
  pushState?: (url: string) => void;
}

export interface ListScrollPagingController {
  init: () => void;
  cleanup: () => void;
  handleScroll: () => void;
  loadNextPage: () => Promise<void>;
  getState: () => { isLoadingNextPage: boolean; currentPage: number; maxPage: number | null };
}

export interface ListScrollPagingAppendEvent {
  source: 'fetched' | 'super-ranking';
  page: number;
  appended: number;
  items: HTMLElement[];
}

const INDICATOR_ID = 'scroll-loading-indicator';

export function resolveScrollPagingPageInfo(input: ResolveScrollPagingPageInfoInput): ScrollPagingPageInfo {
  if (input.superRankingPageInfo) {
    return {
      currentPage: input.superRankingPageInfo.page,
      maxPage: input.superRankingPageInfo.maxPage,
    };
  }

  const urlParams = new URLSearchParams(input.search);
  const pageParam = urlParams.get('page');
  const currentPage = pageParam ? parseInt(pageParam, 10) : 1;
  let maxPage: number | null = null;

  Array.from(input.paginationLinks).forEach(link => {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/page=(\d+)/);
    if (!match) return;

    const pageNum = parseInt(match[1], 10);
    if (!maxPage || pageNum > maxPage) {
      maxPage = pageNum;
    }
  });

  return { currentPage, maxPage };
}

export function shouldTriggerScrollPaging(input: ShouldTriggerScrollPagingInput): boolean {
  if (input.isLoadingNextPage || (input.maxPage && input.currentPage >= input.maxPage)) {
    return false;
  }

  const distanceToBottom = input.documentHeight - (input.scrollTop + input.windowHeight);
  return distanceToBottom <= input.threshold;
}

export function buildScrollPagingNextPageUrl(currentHref: string, nextPage: number): string {
  const url = new URL(currentHref);
  url.searchParams.set('page', nextPage.toString());
  return url.toString();
}

export function createScrollLoadingIndicator(documentRef: Document): HTMLElement {
  const existing = documentRef.getElementById(INDICATOR_ID);
  if (existing) return existing;

  const indicator = documentRef.createElement('div');
  indicator.id = INDICATOR_ID;
  indicator.className = 'scroll-loading-indicator';
  indicator.innerHTML = `
      <div class="loading-spinner"></div>
      <span class="loading-text">正在加载更多内容...</span>
    `;
  indicator.style.display = 'none';
  documentRef.body.appendChild(indicator);
  return indicator;
}

export function removeScrollLoadingIndicator(documentRef: Document): void {
  const indicator = documentRef.getElementById(INDICATOR_ID);
  indicator?.remove();
}

export function setScrollLoadingIndicatorVisible(documentRef: Document, visible: boolean): void {
  const indicator = documentRef.getElementById(INDICATOR_ID);
  if (indicator) {
    indicator.style.display = visible ? 'flex' : 'none';
  }
}

function appendFetchedMovieItemsWithRefs(documentRef: Document, html: string): { appended: number; items: HTMLElement[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const newItems = doc.querySelectorAll('.movie-list .item');
  const movieList = documentRef.querySelector('.movie-list');

  if (!movieList || newItems.length === 0) {
    return { appended: 0, items: [] };
  }

  const appendedItems: HTMLElement[] = [];
  newItems.forEach(item => {
    const clone = item.cloneNode(true) as HTMLElement;
    movieList.appendChild(clone);
    appendedItems.push(clone);
  });

  return { appended: appendedItems.length, items: appendedItems };
}

export function appendFetchedMovieItems(documentRef: Document, html: string): number {
  return appendFetchedMovieItemsWithRefs(documentRef, html).appended;
}

export function createListScrollPagingController(options: ListScrollPagingControllerOptions): ListScrollPagingController {
  let isLoadingNextPage = false;
  let currentPage = 1;
  let maxPage: number | null = null;
  let scrollHandler: ((event: Event) => void) | null = null;

  const logger = (...args: any[]) => options.logger?.(...args);
  const pushState = (url: string) => {
    if (options.pushState) {
      options.pushState(url);
      return;
    }
    options.window.history.pushState({}, '', url);
  };

  const updatePageInfo = () => {
    const pageInfo = resolveScrollPagingPageInfo({
      superRankingPageInfo: options.getSuperRankingPageInfo(),
      search: options.window.location.search,
      paginationLinks: options.document.querySelectorAll('.pagination-link'),
    });
    currentPage = pageInfo.currentPage;
    maxPage = pageInfo.maxPage;
    logger(`Current page: ${currentPage}, Max page: ${maxPage}`);
  };

  const cleanup = () => {
    logger('Cleaning up scroll paging...');
    if (scrollHandler) {
      options.window.removeEventListener('scroll', scrollHandler);
      scrollHandler = null;
    }
    removeScrollLoadingIndicator(options.document);
    isLoadingNextPage = false;
    currentPage = 1;
    maxPage = null;
    logger('Scroll paging cleaned up');
  };

  const loadNextPage = async () => {
    if (isLoadingNextPage) return;
    if (maxPage && currentPage >= maxPage) {
      logger('Already at last page');
      return;
    }

    isLoadingNextPage = true;
    const nextPage = currentPage + 1;

    try {
      logger(`Loading page ${nextPage}...`);
      setScrollLoadingIndicatorVisible(options.document, true);
      logger('Clearing actor caches before loading next page...');
      options.clearActorCaches();
      options.onActorIndexCleared?.();

      const superRankingResult = await options.appendSuperRankingPage(nextPage);
      if (superRankingResult.handled) {
        if (superRankingResult.appended > 0) {
          currentPage = superRankingResult.page;
          maxPage = superRankingResult.maxPage;
          logger(`[ScrollPaging] super ranking page ${nextPage} appended ${superRankingResult.appended} items to DOM at ${new Date().toISOString()}`);
          if (superRankingResult.url) {
            pushState(superRankingResult.url);
          }
          options.processVisibleItems();
          options.onItemsAppended?.({
            source: 'super-ranking',
            page: superRankingResult.page,
            appended: superRankingResult.appended,
            items: [],
          });
        }
        return;
      }

      const nextUrl = buildScrollPagingNextPageUrl(options.window.location.href, nextPage);
      const html = await options.fetchText(nextUrl);
      const appendResult = appendFetchedMovieItemsWithRefs(options.document, html);
      const appended = appendResult.appended;

      if (appended > 0) {
        currentPage = nextPage;
        logger(`[ScrollPaging] page ${nextPage} appended ${appended} items to DOM at ${new Date().toISOString()}`);
        pushState(buildScrollPagingNextPageUrl(options.window.location.href, nextPage));
        logger('[ScrollPaging] triggering processVisibleItems for new items');
        options.processVisibleItems();
        options.onItemsAppended?.({
          source: 'fetched',
          page: nextPage,
          appended,
          items: appendResult.items,
        });
      }
    } catch (error) {
      logger('Failed to load next page:', error);
    } finally {
      isLoadingNextPage = false;
      setScrollLoadingIndicatorVisible(options.document, false);
    }
  };

  const handleScroll = () => {
    const scrollTop = options.window.pageYOffset || options.document.documentElement.scrollTop;
    if (shouldTriggerScrollPaging({
      isLoadingNextPage,
      currentPage,
      maxPage,
      scrollTop,
      windowHeight: options.window.innerHeight,
      documentHeight: options.document.documentElement.scrollHeight,
      threshold: options.threshold,
    })) {
      void loadNextPage();
    }
  };

  return {
    init(): void {
      logger('Initializing scroll paging...');
      cleanup();
      updatePageInfo();
      scrollHandler = handleScroll;
      options.window.addEventListener('scroll', scrollHandler, { passive: true });
      createScrollLoadingIndicator(options.document);
      logger('Scroll paging initialized');
    },

    cleanup,
    handleScroll,
    loadNextPage,

    getState() {
      return { isLoadingNextPage, currentPage, maxPage };
    },
  };
}
