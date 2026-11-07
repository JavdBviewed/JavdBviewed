// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendRuntimeMessage } = vi.hoisted(() => ({ sendRuntimeMessage: vi.fn() }));
vi.mock('../../../../../platform/browser/runtimeMessages', () => ({ sendRuntimeMessage }));
import { CrosslineSessionSettings } from './CrosslineSessionSettings';

const status = {
  enabled: true, checkedAt: 1, reason: 'different-sessions', routes: [
    { host: 'javdb.com', status: 'present' },
    { host: 'javdb570.com', status: 'missing' },
    { host: 'javdb575.com', status: 'conflict' },
  ],
};

describe('crossline session settings', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    sendRuntimeMessage.mockResolvedValue({ success: true, status });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it('shows configured routes and conflicts without presenting cookies as verified login', async () => {
    await act(async () => root.render(<CrosslineSessionSettings />));
    expect(sendRuntimeMessage).toHaveBeenCalledWith({ type: 'JAVDB_CROSSLINE:STATUS' });
    expect(host.textContent).toContain('javdb575.com');
    expect(host.textContent).toContain('不同会话');
    expect(host.textContent).toContain('检测到会话不代表账号已登录');
    expect(host.querySelector<HTMLAnchorElement>('a[href="#tab-settings/network-test-settings"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('#crosslineRefresh')?.click());
    expect(sendRuntimeMessage).toHaveBeenCalledWith({ type: 'JAVDB_CROSSLINE:REFRESH' });
  });

  it('persists the toggle and displays a read-only status when off', async () => {
    sendRuntimeMessage.mockResolvedValueOnce({ success: true, status })
      .mockResolvedValueOnce({ success: true, status: { ...status, enabled: false } });
    await act(async () => root.render(<CrosslineSessionSettings />));
    const toggle = host.querySelector<HTMLInputElement>('#crosslineEnabled');
    expect(toggle?.checked).toBe(true);
    await act(async () => {
      toggle?.click();
    });
    expect(sendRuntimeMessage).toHaveBeenCalledWith({ type: 'JAVDB_CROSSLINE:SET_ENABLED', enabled: false });
    expect(host.textContent).toContain('自动同步已关闭');
  });

  it('retains the confirmed toggle and marks old diagnostics after a failed save', async () => {
    await act(async () => root.render(<CrosslineSessionSettings />));
    sendRuntimeMessage.mockResolvedValueOnce({ success: false, stage: 'settings-write', error: '保存自动同步开关失败，请重试。' });
    await act(async () => host.querySelector<HTMLInputElement>('#crosslineEnabled')?.click());
    expect(host.querySelector<HTMLInputElement>('#crosslineEnabled')?.checked).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('以下为上次读取结果');
  });

  it('allows retry after the initial read fails and reports partial write results', async () => {
    sendRuntimeMessage.mockRejectedValueOnce(new Error('raw-browser-details'));
    await act(async () => root.render(<CrosslineSessionSettings />));
    expect(host.textContent).toContain('后台无响应');
    expect(host.textContent).not.toContain('raw-browser-details');
    expect(host.querySelector<HTMLInputElement>('#crosslineEnabled')?.disabled).toBe(true);
    sendRuntimeMessage.mockResolvedValueOnce({ success: true, status: {
      ...status,
      error: { stage: 'cookie-write', message: '写入目标线路会话失败，部分线路可能已同步' },
      routes: [{ host: 'javdb570.com', status: 'synced' }, { host: 'javdb575.com', status: 'error' }],
    } });
    await act(async () => host.querySelector<HTMLButtonElement>('#crosslineRefresh')?.click());
    expect(host.textContent).toContain('本次已补齐');
    expect(host.textContent).toContain('写入失败');
    expect(host.querySelector<HTMLInputElement>('#crosslineEnabled')?.disabled).toBe(false);
  });

  it('serializes requests while the initial state is loading', async () => {
    let complete: ((value: unknown) => void) | undefined;
    sendRuntimeMessage.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    await act(async () => root.render(<CrosslineSessionSettings />));
    expect(host.querySelector<HTMLButtonElement>('#crosslineRefresh')?.disabled).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('#crosslineRefresh')?.click());
    expect(sendRuntimeMessage).toHaveBeenCalledTimes(1);
    await act(async () => complete?.({ success: true, status }));
    expect(host.querySelector<HTMLButtonElement>('#crosslineRefresh')?.disabled).toBe(false);
  });
});
