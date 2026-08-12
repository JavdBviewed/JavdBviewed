export const DEFAULT_INSIGHTS_TEMPLATE_FALLBACK =
  '<!doctype html><html><head><meta charset="utf-8"/></head><body><p>模板加载失败</p></body></html>';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface LoadInsightsTemplateOptions {
  getTemplateUrl: () => string;
  fetchFn?: FetchFn;
  fallbackHtml?: string;
}

interface ViewedPageResult<T> {
  items: T[];
  total?: number;
}

type ViewedPageLoader<T> = (query: {
  offset: number;
  limit: number;
  orderBy: 'updatedAt';
  order: 'desc';
}) => Promise<ViewedPageResult<T>>;

export function adjustInsightsIframeHeight(iframe: HTMLIFrameElement): void {
  try {
    const checkHeight = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc || !doc.body) return;
        const contentHeight = Math.max(
          doc.body.scrollHeight,
          doc.body.offsetHeight,
          doc.documentElement.scrollHeight,
          doc.documentElement.offsetHeight,
        );
        if (contentHeight > 0) {
          iframe.style.height = `${contentHeight + 20}px`;
        }
      } catch {}
    };

    checkHeight();
    iframe.addEventListener('load', () => {
      checkHeight();
      setTimeout(checkHeight, 100);
      setTimeout(checkHeight, 500);
    });
  } catch {}
}

export async function loadInsightsTemplate(options: LoadInsightsTemplateOptions): Promise<string> {
  try {
    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(options.getTemplateUrl());
    return await response.text();
  } catch {
    return options.fallbackHtml ?? DEFAULT_INSIGHTS_TEMPLATE_FALLBACK;
  }
}

export async function fetchInsightsVideoRecordsPaged<T>(
  dbViewedPage: ViewedPageLoader<T>,
  pageSize = 500,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  while (true) {
    const { items: page, total } = await dbViewedPage({
      offset,
      limit: pageSize,
      orderBy: 'updatedAt',
      order: 'desc',
    });
    const len = Array.isArray(page) ? page.length : 0;
    if (!len) break;
    items.push(...page);
    offset += len;
    if (items.length >= (total || 0)) break;
    if (len < pageSize) break;
  }
  return items;
}

export function getInsightsPreviewContainer(documentRef: Document = document): HTMLElement | null {
  const iframe = documentRef.getElementById('insights-preview');
  if (!iframe) return null;
  const container = iframe.parentElement as HTMLElement | null;
  if (container) {
    const computedStyle = getComputedStyle(container);
    if (!computedStyle.position || computedStyle.position === 'static') {
      container.style.position = 'relative';
    }
  }
  return container;
}
