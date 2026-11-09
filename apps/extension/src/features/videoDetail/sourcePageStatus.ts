import type { VideoStatus } from '../../types';

const STATUS_CONTROLS = '.review-buttons, .review-title, #edit_review';

/** Only the personal controls inside the movie panel can confirm account state. */
export function detectPageUserStatus(doc: Document = document): VideoStatus | null {
  const panel = doc.querySelector('.movie-panel-info');
  if (!panel) return null;
  for (const [path, status] of [['/users/watched_videos', 'viewed'], ['/users/want_watch_videos', 'want']] as const) {
    for (const anchor of panel.querySelectorAll<HTMLAnchorElement>('.review-title a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href')!, doc.baseURI);
        if (url.origin === new URL(doc.baseURI).origin && url.pathname === path) return status;
      } catch { /* An invalid link does not confirm account state. */ }
    }
  }
  for (const tag of panel.querySelectorAll('.review-title span.tag, .review-buttons span.tag')) {
    const text = (tag.textContent || '').replace(/\s/g, '');
    if (/^我看[過过][這这]部(?:影片|電影|电影)$/.test(text)) return 'viewed';
    if (/^我想看[這这]部(?:影片|電影|电影)$/.test(text)) return 'want';
  }
  return null;
}

/** Observe the stable parent, including replacement of the status controls. */
export function observeSourcePageStatus(
  apply: (status: VideoStatus | null, explicitClear: boolean, isActive: () => boolean) => Promise<boolean>,
  onFailure: () => void,
  doc: Document = document,
): () => void {
  const panel = doc.querySelector('.movie-panel-info');
  const win = doc.defaultView;
  if (!panel || !win) return () => {};
  const pathname = win.location.pathname;
  let disposed = false;
  const isActive = () => !disposed && win.location.pathname === pathname;
  let timer: number | undefined;
  const confirmationTimers = new Set<number>();
  let busy = false;
  let dirty = false;
  let clearConfirmed = false;
  let acknowledged: VideoStatus | null | undefined;
  let attemptStatus: VideoStatus | null | undefined;
  let failures = 0;

  const schedule = (delay = 150) => {
    if (!isActive()) return;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = win.setTimeout(() => { timer = undefined; void reconcile(); }, delay);
  };
  const reconcile = async () => {
    if (!isActive()) return;
    if (busy) { dirty = true; return; }
    const status = detectPageUserStatus(doc);
    if (status === acknowledged || (!status && !clearConfirmed)) return;
    if (status !== attemptStatus) { attemptStatus = status; failures = 0; }
    if (failures >= 3) return;
    busy = true;
    let succeeded = false;
    try { succeeded = await apply(status, clearConfirmed, isActive); }
    catch { /* Keep the confirmed page state pending for a bounded retry. */ }
    finally { busy = false; }
    if (!isActive()) return;
    if (succeeded) { acknowledged = status; failures = 0; clearConfirmed = false; }
    else {
      failures++;
      if (failures < 3) schedule(failures * 1000);
      else onFailure();
    }
    if (dirty || detectPageUserStatus(doc) !== status) { dirty = false; schedule(); }
  };

  const touchesControls = (node: Node) => {
    const el = node.nodeType === 1 ? node as Element : node.parentElement;
    return Boolean(el?.closest(STATUS_CONTROLS) || el?.querySelector(STATUS_CONTROLS));
  };
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => {
      const el = m.target.nodeType === 1 ? m.target as Element : m.target.parentElement;
      return el?.closest(STATUS_CONTROLS) || [...m.addedNodes, ...m.removedNodes].some(touchesControls);
    })) schedule();
  });
  observer.observe(panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });

  const onInteraction = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const form = target.closest('form');
    const clearLink = target.closest<HTMLAnchorElement>('a[data-method="delete"]');
    let isReviewForm = false;
    if (form) {
      try {
        const action = new URL(form.getAttribute('action') || '', doc.baseURI);
        isReviewForm = action.origin === win.location.origin
          && (action.pathname === `${pathname}/reviews` || action.pathname.startsWith(`${pathname}/reviews/`));
      } catch { /* Not a current movie form. */ }
    }
    let explicitClear = false;
    if (event.type === 'ajax:success' && clearLink && panel.contains(clearLink) && clearLink.closest(STATUS_CONTROLS)) {
      const url = new URL(clearLink.href, doc.baseURI);
      explicitClear = url.origin === win.location.origin && url.pathname.startsWith(`${pathname}/reviews/`);
    }
    if (!isReviewForm && !explicitClear) return;
    clearConfirmed ||= explicitClear;
    failures = 0;
    confirmationTimers.forEach(id => win.clearTimeout(id));
    confirmationTimers.clear();
    for (const delay of [0, 800, 1600, 3000, 6000]) {
      const id = win.setTimeout(() => { confirmationTimers.delete(id); schedule(0); }, delay);
      confirmationTimers.add(id);
    }
  };
  doc.addEventListener('submit', onInteraction, true);
  doc.addEventListener('ajax:success', onInteraction, true);
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    if (timer !== undefined) win.clearTimeout(timer);
    confirmationTimers.forEach(id => win.clearTimeout(id));
    doc.removeEventListener('submit', onInteraction, true);
    doc.removeEventListener('ajax:success', onInteraction, true);
  };
}
