/** 下载任务页唯一生命周期拥有者：切换分类时释放前一分类的视图及请求。 */
import { createRoot, type Root } from 'react-dom/client';
import '../../ui/styles/globals.css';
import { OpenListTasksPanel } from '../../apps/dashboard/pages/downloadTasks/OpenListTasksPanel';
import type { Drive115TasksManager } from './drive115Tasks';
import { dashboardTabLifecycle } from './tabLifecycle';

type Provider = '115' | 'openlist';
class DownloadTasksPage {
  private drive?: Drive115TasksManager;
  private root?: Root;
  private selected?: Provider;
  private active = false;
  private generation = 0;
  private unregister: () => void;
  constructor(readonly element: HTMLElement) {
    element.addEventListener('click', this.onClick);
    element.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('hashchange', this.onHashChange);
    this.unregister = dashboardTabLifecycle.register('tab-drive115-tasks', {
      onActive: () => { void this.activate(); },
      onRestore: () => { void this.activate(); },
      onHidden: () => this.deactivate(),
      onDispose: () => this.dispose(),
    });
  }
  private onHashChange = () => {
    if (window.location.hash.split('/')[0] === '#tab-drive115-tasks' && this.active) void this.activate();
  };
  private onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-download-provider]');
    if (button) window.location.hash = `tab-drive115-tasks/${button.dataset.downloadProvider}`;
  };
  private onKeyDown = (event: KeyboardEvent) => {
    const current = (event.target as Element).closest<HTMLButtonElement>('[data-download-provider]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const provider = event.key === 'Home' ? '115' : event.key === 'End' ? 'openlist' : current.dataset.downloadProvider === '115' ? 'openlist' : '115';
    this.element.querySelector<HTMLButtonElement>(`[data-download-provider="${provider}"]`)?.focus();
    window.location.hash = `tab-drive115-tasks/${provider}`;
  };
  async activate(): Promise<void> {
    this.active = true;
    const provider: Provider = window.location.hash.split('/')[1] === 'openlist' ? 'openlist' : '115';
    if (this.selected === provider) return;
    const generation = ++this.generation;
    this.root?.unmount(); this.root = undefined;
    this.drive?.deactivate();
    this.selected = provider;
    const drivePanel = this.element.querySelector<HTMLElement>('#downloadTasks115Panel');
    const openlistPanel = this.element.querySelector<HTMLElement>('#downloadTasksOpenListPanel');
    if (!drivePanel || !openlistPanel) return;
    drivePanel.hidden = provider !== '115'; openlistPanel.hidden = provider !== 'openlist';
    this.element.querySelectorAll<HTMLButtonElement>('[data-download-provider]').forEach(button => {
      const selected = button.dataset.downloadProvider === provider;
      button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    if (provider === 'openlist') {
      this.root = createRoot(openlistPanel); this.root.render(<OpenListTasksPanel />);
    } else {
      const { Drive115TasksManager } = await import('./drive115Tasks');
      if (generation !== this.generation || !this.active) return;
      this.drive ??= new Drive115TasksManager({ manageLifecycle: false });
      await this.drive.activate();
    }
  }
  private deactivate(): void {
    this.active = false; this.generation++; this.selected = undefined;
    this.root?.unmount(); this.root = undefined; this.drive?.deactivate();
  }
  dispose(): void {
    this.deactivate(); this.unregister?.();
    this.element.removeEventListener('click', this.onClick); this.element.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('hashchange', this.onHashChange);
    if (page === this) page = undefined;
  }
}
let page: DownloadTasksPage | undefined;
export async function initializeDownloadTasks(): Promise<void> {
  const element = document.getElementById('downloadTasksPage');
  if (!element) return;
  if (page?.element !== element) { page?.dispose(); page = new DownloadTasksPage(element); }
  await page?.activate();
}
