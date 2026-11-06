import { showToast } from '../../platform/browser/toast';
import { getSettings } from '../../utils/storage';
import { addOfflineDownload } from './openlistClient';
import { normalizeOpenListSettings } from './openlistSettingsModel';

const observers = new WeakMap<Element, MutationObserver>();

export async function initOpenListPush(documentRef: Document = document): Promise<void> {
  const settings = normalizeOpenListSettings((await getSettings()).openlist);
  const container = documentRef.querySelector('#magnets-content');
  if (!container) return;
  observers.get(container)?.disconnect();
  observers.delete(container);
  if (!settings.baseUrl || !settings.token) return;

  const addButtons = () => {
    for (const item of container.querySelectorAll<HTMLElement>('.item')) {
      if (item.querySelector('.openlist-push-btn')) continue;
      const magnet = item.querySelector<HTMLAnchorElement>('a[href^="magnet:"]');
      if (!magnet) continue;
      let buttons = item.querySelector<HTMLElement>('.buttons');
      if (!buttons) {
        buttons = documentRef.createElement('div');
        buttons.className = 'buttons column';
        item.appendChild(buttons);
      }
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'button is-success is-small openlist-push-btn';
      button.textContent = '推送 OpenList';
      button.addEventListener('click', () => {
        if (button.disabled) return;
        button.disabled = true;
        void addOfflineDownload({ ...settings, urls: [magnet.href] }).then((result) => {
          if (!result.success) {
            showToast(result.message || 'OpenList 推送失败', 'error');
            return;
          }
          showToast(`已推送 OpenList${result.tasks?.[0]?.id ? ` · ${result.tasks[0].id}` : ''}`, 'success');
        }).catch((error: unknown) => {
          showToast(error instanceof Error ? error.message : 'OpenList 推送失败', 'error');
        }).finally(() => { button.disabled = false; });
      });
      buttons.appendChild(button);
    }
  };
  addButtons();
  const observer = new MutationObserver(addButtons);
  observer.observe(container, { childList: true });
  observers.set(container, observer);
}
