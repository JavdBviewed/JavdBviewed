// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../features/drive115/v2', () => ({ getDrive115V2Service: () => ({
  getValidAccessToken: async () => ({ success: true, accessToken: 'synthetic-token' }), getTaskList: mocks.list,
}) }));
vi.mock('../../utils/storage', () => ({ getSettings: async () => ({}), saveSettings: vi.fn() }));
vi.mock('../components/drive115FolderPicker', () => ({ openDrive115FolderPicker: vi.fn() }));
import { Drive115TasksManager } from './drive115Tasks';
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });
it('loads again after rapid category switching and ignores an old failed response', async () => {
  document.body.innerHTML = '<div id="tab-drive115-tasks"><div id="drive115TasksContainer"></div><div id="drive115TasksStatsContainer"></div><div id="drive115TasksPaginationContainer"></div></div>';
  let oldResponse: ((result: unknown) => void) | undefined;
  mocks.list.mockReturnValueOnce(new Promise(resolve => { oldResponse = resolve; })).mockResolvedValueOnce({ success: true, data: { tasks: [], count: 0, page_count: 1 } });
  const manager = new Drive115TasksManager({ manageLifecycle: false });
  const first = manager.activate();
  await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
  manager.deactivate();
  await manager.activate();
  expect(mocks.list).toHaveBeenCalledTimes(2);
  oldResponse?.({ success: false, message: 'stale failure' });
  await first;
  expect(document.body.textContent).not.toContain('stale failure');
});
it('retries an error without a global manager or inline handler', async () => {
  document.body.innerHTML = '<div id="drive115TasksContainer"></div>';
  mocks.list.mockResolvedValueOnce({ success: false, message: '<img src=x onerror=alert(1)>failed' })
    .mockResolvedValueOnce({ success: true, data: { tasks: [], count: 0, page_count: 1 } });
  const manager = new Drive115TasksManager({ manageLifecycle: false });
  await manager.activate();
  expect(document.querySelector('img')).toBeNull();
  const retry = document.querySelector<HTMLButtonElement>('#drive115TasksContainer button');
  expect(retry?.getAttribute('onclick')).toBeNull();
  retry?.click();
  await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
});
