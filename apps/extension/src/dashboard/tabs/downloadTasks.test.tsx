// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const drive = vi.hoisted(() => ({ activate: vi.fn(), deactivate: vi.fn() }));
vi.mock('./drive115Tasks', () => ({ Drive115TasksManager: vi.fn(() => drive) }));
vi.mock('../../apps/dashboard/pages/downloadTasks/OpenListTasksPanel', () => ({ OpenListTasksPanel: () => <div>OpenList panel</div> }));
import { initializeDownloadTasks } from './downloadTasks';
import { dashboardTabLifecycle } from './tabLifecycle';
afterEach(() => { dashboardTabLifecycle.disposeAll(); document.body.innerHTML = ''; vi.clearAllMocks(); });
it('opens OpenList directly without initializing 115 and restores the selected category after leaving', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div id="downloadTasksPage"><div role="tablist">
    <button data-download-provider="115"></button><button data-download-provider="openlist"></button></div>
    <div id="downloadTasks115Panel"></div><div id="downloadTasksOpenListPanel"></div></div>`;
  window.location.hash = '#tab-drive115-tasks/openlist';
  await act(async () => initializeDownloadTasks());
  expect(drive.activate).not.toHaveBeenCalled();
  expect(document.getElementById('downloadTasksOpenListPanel')?.textContent).toBe('OpenList panel');
  await act(async () => dashboardTabLifecycle.notify('hidden', 'tab-drive115-tasks'));
  expect(document.getElementById('downloadTasksOpenListPanel')?.textContent).toBe('');
  await act(async () => dashboardTabLifecycle.notify('active', 'tab-drive115-tasks'));
  expect(document.getElementById('downloadTasksOpenListPanel')?.textContent).toBe('OpenList panel');
  window.location.hash = '#tab-drive115-tasks/115';
  await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); await initializeDownloadTasks(); });
  expect(drive.activate).toHaveBeenCalledOnce();
  expect(document.getElementById('downloadTasksOpenListPanel')?.hidden).toBe(true);
});
