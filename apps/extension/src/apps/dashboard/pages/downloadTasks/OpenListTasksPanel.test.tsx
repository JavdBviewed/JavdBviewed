// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ settings: vi.fn(), list: vi.fn(), operate: vi.fn() }));
vi.mock('../../../../utils/storage', () => ({ getSettings: mocks.settings }));
vi.mock('../../../../features/openlist/openlistTasksClient', async importOriginal => ({
  ...await importOriginal<object>(), listOpenListTasks: mocks.list, operateOpenListTask: mocks.operate,
}));
import { OpenListTasksPanel } from './OpenListTasksPanel';
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.settings.mockResolvedValue({ openlist: { baseUrl: 'https://files.example.test', token: 'test-token' } });
  mocks.list.mockResolvedValue({ tasks: [
    { id: 'a', kind: 'offline_download', name: '<script>sample</script>', state: 1, progress: 42 },
    { id: 'b', kind: 'offline_download_transfer', name: 'saving', state: 7, progress: 5, error: 'disk full' },
  ], errors: [] });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
it('renders both stages safely and offers retry for failed transfers', async () => {
  await act(async () => root.render(<OpenListTasksPanel />));
  expect(host.textContent).toContain('42%');
  expect(host.textContent).toContain('转存到目标目录');
  expect(host.textContent).toContain('disk full');
  expect(host.querySelector('script')).toBeNull();
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试');
  await act(async () => retry?.click());
  expect(mocks.operate).toHaveBeenCalledWith(expect.objectContaining({ token: 'test-token' }), expect.objectContaining({ id: 'b' }), 'retry', expect.any(Object));
});
it('guides missing configuration to OpenList settings without requesting tasks', async () => {
  mocks.settings.mockResolvedValue({});
  await act(async () => root.render(<OpenListTasksPanel />));
  expect(mocks.list).not.toHaveBeenCalled();
  expect(host.querySelector('a[href="#tab-settings/drive-settings/openlist"]')).not.toBeNull();
});
it('shows permission failure instead of claiming there are no tasks', async () => {
  mocks.list.mockResolvedValue({ tasks: [], errors: ['没有权限'] });
  await act(async () => root.render(<OpenListTasksPanel />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('没有权限');
  expect(host.textContent).not.toContain('暂无下载任务');
});
it('aborts outstanding requests on unmount', async () => {
  mocks.list.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<OpenListTasksPanel />));
  const signal = mocks.list.mock.calls[0][1].signal as AbortSignal;
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  root = createRoot(host);
});
