import { sendRuntimeMessage } from '../../platform/browser/runtimeMessages';
import type { CrosslinePageRequest, CrosslinePageResponse, CrosslinePromptStatus } from '../../shared/protocols/crosslineSession';
import { classifyJavdbLoginHtml, JAVDB_LOGOUT_PATH } from '../../features/routeManagement/javdbLoginVerification';
import './crosslineLoginPrompt.css';

/** One non-modal entry per document; credentials remain in the background. */
export function installCrosslineLoginPrompt(options: { origin?: string } = {}): () => void {
  const origin = options.origin ?? location.origin;
  let disposed = false, suspended = false, generation = 0, refreshed = false;
  let root: HTMLDivElement | undefined;
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = (message: CrosslinePageRequest) => sendRuntimeMessage<CrosslinePageResponse>(message);
  let positionPanel: (() => void) | undefined;
  let hiddenBadge: { element: HTMLElement; display: string } | undefined;
  const remove = () => {
    positionPanel = undefined;
    if (hiddenBadge) { hiddenBadge.element.style.display = hiddenBadge.display; hiddenBadge = undefined; }
 generation++; root?.remove(); root = undefined; observer?.disconnect(); clearTimeout(timer); };
  const alive = (epoch: number) => !disposed && !suspended && generation === epoch;

  function render(status: CrosslinePromptStatus, anchor: HTMLElement, epoch: number) {
    if (!alive(epoch) || root || document.querySelector('.javdb-ext-crossline')) return;
    const element = document.createElement('div'); element.className = 'navbar-item javdb-ext-crossline'; root = element;
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'javdb-ext-crossline-trigger';
    trigger.textContent = '同步登录'; trigger.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div'); panel.className = 'javdb-ext-crossline-panel'; panel.hidden = true;
    panel.id = 'javdb-ext-crossline-panel'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '跨线路登录');
    trigger.setAttribute('aria-controls', panel.id);
    const text = document.createElement('p'); text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
    const select = document.createElement('select'); select.setAttribute('aria-label', '登录态来源');
    const sourceLink = document.createElement('a'); sourceLink.textContent = '打开来源网站'; sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer';
    const targetLink = document.createElement('a'); targetLink.textContent = '打开当前网站个人页'; targetLink.href = `${origin}/users/profile`; targetLink.target = '_blank'; targetLink.rel = 'noopener noreferrer'; targetLink.hidden = true;
    const actions = document.createElement('div'); actions.className = 'javdb-ext-crossline-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '同步登录';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '暂不提醒'; dismiss.className = 'javdb-ext-crossline-dismiss';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.className = 'javdb-ext-crossline-close'; close.setAttribute('aria-label', '关闭登录提示');
    actions.append(copy, dismiss); panel.append(close, text, select, sourceLink, targetLink, actions); element.append(trigger, panel);
    const badge = anchor.querySelector<HTMLElement>('#javdb-ext-badge');
    if (badge) { hiddenBadge = { element: badge, display: badge.style.display }; badge.style.display = 'none'; }
    anchor.prepend(element);
    positionPanel = () => {
      if (panel.hidden) return;
      panel.style.transform = '';
      const box = panel.getBoundingClientRect();
      const shift = Math.min(0, window.innerWidth - 12 - box.right) + Math.max(0, 12 - box.left);
      panel.style.transform = `translateX(${shift}px)`;
    };
    let current = status, busy = false;
    const setOpen = (open: boolean) => { panel.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); if (open) positionPanel?.(); };
    const setSources = (next: CrosslinePromptStatus) => {
      current = next; targetLink.hidden = true; select.replaceChildren();
      for (const source of next.sources) { const option = document.createElement('option'); option.value = source.host; option.textContent = source.host; select.append(option); }
      if (next.sources.length > 1) {
        const option = document.createElement('option'); option.value = ''; option.textContent = '选择已登录的网站'; option.selected = true; option.disabled = true; select.prepend(option);
      }
      select.hidden = next.sources.length < 2;
      text.textContent = next.sources.length === 1 ? `此网站尚未登录，可使用 ${next.sources[0].host} 的登录态。` : '此网站尚未登录，请选择已登录的网站。';
      updateSelection();
    };
    function updateSelection() {
      const host = select.value; sourceLink.hidden = !host; if (host) sourceLink.href = `https://${host}/users/profile`;
      copy.disabled = busy || !host;
    }
    select.addEventListener('change', updateSelection);
    const dismissPanel = () => {
      setOpen(false);
      void request({ type: 'JAVDB_CROSSLINE_PAGE:DISMISS', offerId: current.offerId || '' }).catch(() => undefined);
    };
    dismiss.addEventListener('click', dismissPanel); close.addEventListener('click', dismissPanel);
    element.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { dismissPanel(); trigger.focus(); } });
    trigger.addEventListener('click', async () => {
      if (busy) return;
      if (!panel.hidden) { dismissPanel(); return; }
      setOpen(true); text.textContent = '正在验证登录状态…'; busy = true; copy.disabled = true;
      try {
        const reply = await request({ type: 'JAVDB_CROSSLINE_PAGE:STATUS' });
        if (!alive(epoch)) return;
        if (reply.success && reply.status?.offerId && reply.status.sources.length) setSources(reply.status);
        else remove();
      } catch { text.textContent = '暂时无法检查登录态，请稍后重试。'; }
      finally { busy = false; updateSelection(); }
    });
    copy.addEventListener('click', async event => {
      if (!event.isTrusted || busy || !select.value || !current.offerId) return;
      busy = true; copy.disabled = true; select.disabled = true; text.textContent = '正在验证并同步登录态…';
      try {
        const reply = await request({ type: 'JAVDB_CROSSLINE_PAGE:COPY', sourceHost: select.value, offerId: current.offerId });
        if (!alive(epoch)) return;
        targetLink.hidden = false;
        if (!reply.success) text.textContent = reply.error;
        else if (reply.outcome === 'authenticated' || reply.outcome === 'already-authenticated') {
          text.textContent = '已登录，正在刷新页面…';
          if (!refreshed) { refreshed = true; location.reload(); }
        } else if (reply.outcome === 'not-accepted') text.textContent = '该网站未接受此登录态，请在此网站登录。';
        else if (reply.outcome === 'stale') text.textContent = '登录状态已变化，请关闭提示后重新检查。';
        else text.textContent = '暂时无法确认登录结果，请打开个人页检查或重试。';
      } catch { if (alive(epoch)) text.textContent = '登录操作未完成，请稍后重试。'; }
      finally { busy = false; select.disabled = false; updateSelection(); }
    });
    setSources(status);
    // Hidden mobile menus and background tabs do not consume an automatic display slot.
    if (document.visibilityState === 'visible' && anchor.getClientRects().length) {
      void request({ type: 'JAVDB_CROSSLINE_PAGE:CLAIM', offerId: status.offerId || '' }).then(reply => {
        if (alive(epoch) && reply.success && reply.show) setOpen(true);
      }).catch(() => undefined);
    }
  }
  async function evaluate() {
    if (disposed || suspended || document.visibilityState !== 'visible' || root) return;
    const menu = document.querySelector<HTMLElement>('#navbar-menu-user');
    if (!menu) {
      if (!observer && document.documentElement) {
        observer = new MutationObserver(() => { if (document.querySelector('#navbar-menu-user')) { observer?.disconnect(); clearTimeout(timer); void evaluate(); } });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        timer = setTimeout(() => observer?.disconnect(), 10_000);
      }
      return;
    }
    if (classifyJavdbLoginHtml({ html: menu.outerHTML, origin, url: `${origin}/`, status: 200 }) !== 'anonymous') return;
    const anchor = menu.querySelector<HTMLElement>('.navbar-end') ?? menu;
    const epoch = ++generation;
    try {
      const reply = await request({ type: 'JAVDB_CROSSLINE_PAGE:STATUS' });
      if (alive(epoch) && reply.success && reply.status?.enabled && reply.status.targetState === 'anonymous' && reply.status.sources.length) render(reply.status, anchor, epoch);
    } catch { /* Automatic checks stay silent; manual operations have visible errors. */ }
  }
  const onLogout = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest('a[href],form[action],button[formaction]');
    if (!control) return;
    const raw = control.getAttribute('href') ?? control.getAttribute('action') ?? control.getAttribute('formaction');
    if (!raw) return;
    try {
      const url = new URL(raw, origin);
      if (url.origin === origin && JAVDB_LOGOUT_PATH.test(url.pathname)) {
        remove(); void request({ type: 'JAVDB_CROSSLINE_PAGE:LOGOUT' }).catch(() => undefined);
      }
    } catch { /* Ignore unrelated controls. */ }
  };
  const resize = () => positionPanel?.();
  window.addEventListener('resize', resize);
  const visibility = () => { if (document.visibilityState === 'visible') void evaluate(); };
  const hide = () => { suspended = true; remove(); };
  const show = () => { suspended = false; void evaluate(); };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && (changes.settings || changes.javdbCrosslineSessionEnabled)) { remove(); void evaluate(); }
  };
  document.addEventListener('click', onLogout, true); document.addEventListener('submit', onLogout, true);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
  chrome.storage?.onChanged?.addListener(changed);
  void evaluate();
  return () => {
    disposed = true; remove(); window.removeEventListener('resize', resize); document.removeEventListener('click', onLogout, true); document.removeEventListener('submit', onLogout, true);
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
    chrome.storage?.onChanged?.removeListener(changed);
  };
}
