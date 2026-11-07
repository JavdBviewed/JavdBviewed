// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettings, saveOpenListSettings, testConnection, listTools } = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: 'secret', path: '/movies', tool: 'aria2' } }),
  saveOpenListSettings: vi.fn().mockResolvedValue(undefined),
  testConnection: vi.fn().mockResolvedValue({ ok: true, version: '1.9.9', username: 'admin' }),
  listTools: vi.fn().mockResolvedValue({ success: true, tools: ['SimpleHttp'] }),
}));
vi.mock('../../../../../utils/storage', () => ({ getSettings }));
vi.mock('../../../../../features/openlist/openlistSettingsModel', () => ({
  DEFAULT_OPENLIST_SETTINGS: { baseUrl: '', token: '', path: '', tool: 'aria2' },
  normalizeOpenListSettings: (raw: unknown) => raw,
  saveOpenListSettings,
}));
vi.mock('../../../../../features/openlist/openlistClient', () => ({ testConnection, listTools }));

import { OpenListSettingsSection } from './OpenListSettingsSection';

describe('OpenList settings section', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    getSettings.mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: 'secret', path: '/movies', tool: 'aria2' } });
    saveOpenListSettings.mockResolvedValue(undefined);
    testConnection.mockResolvedValue({ ok: true, version: '1.9.9', username: 'admin' });
    listTools.mockResolvedValue({ success: true, tools: ['SimpleHttp'] });
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('loads, saves and tests the configured server without exposing its token', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<OpenListSettingsSection />));

    const token = host.querySelector<HTMLInputElement>('#openlistToken');
    expect(token?.type).toBe('password');
    expect(token?.value).toBe('secret');
    expect(host.textContent).not.toContain('secret');
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistSave')?.click());
    expect(saveOpenListSettings).toHaveBeenCalledWith({
      baseUrl: 'http://nas.local', token: 'secret', path: '/movies', tool: 'aria2',
    });
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistTest')?.click());
    expect(testConnection).toHaveBeenCalledWith({ baseUrl: 'http://nas.local', token: 'secret' });
    expect(host.textContent).toContain('1.9.9');
    expect(host.textContent).toContain('admin');
  });

  it('shows the server error on an unsuccessful test', async () => {
    testConnection.mockResolvedValueOnce({ ok: false, message: 'permission denied' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<OpenListSettingsSection />));
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistTest')?.click());
    expect(host.textContent).toContain('permission denied');
  });

  it('offers field help and a downloader selector and logs safe test diagnostics', async () => {
    testConnection.mockResolvedValueOnce({ ok: false, message: 'OpenList 接口返回 HTTP 200，但不是 API 响应', diagnostics: { stage: 'public/settings', httpStatus: 200 } });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<OpenListSettingsSection />));
    expect(host.querySelector<HTMLSelectElement>('#openlistTool')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label$="填写帮助"]')).toHaveLength(4);
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistTest')?.click());
    expect(errorLog).toHaveBeenCalledWith('[OpenList] 测试连接失败', expect.objectContaining({ stage: 'public/settings', httpStatus: 200 }));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret');
    errorLog.mockRestore();
  });

  it('reports that the configured downloader is not available for the selected directory', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<OpenListSettingsSection />));
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistTest')?.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(401); });
    expect(host.textContent).toContain('当前目录可用：SimpleHttp');
    expect(host.querySelector<HTMLOptionElement>('option[value="SimpleHttp"]')?.textContent).toContain('不支持磁链');
    expect(host.textContent).toContain('Aria2（尚未提供）');
    expect(host.querySelector<HTMLOptionElement>('option[value="aria2"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLOptionElement>('option[value="SimpleHttp"]')?.disabled).toBe(false);
  });

  async function renderSettings() {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<OpenListSettingsSection />));
  }

  async function finishDetection() {
    await act(async () => { await vi.advanceTimersByTimeAsync(401); });
  }

  async function changeInput(selector: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Missing input: ${selector}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('explains how to make a magnetic downloader available and offers a refresh action', async () => {
    await renderSettings();
    await finishDetection();
    expect(host.textContent).toContain('磁链暂不可用');
    expect(host.textContent).toContain('OpenList 管理后台');
    expect(host.textContent).toContain('重新检测');
    expect(host.querySelector<HTMLAnchorElement>('#openlistOpenServer')?.href).toBe('http://nas.local/');
    expect(host.querySelector<HTMLAnchorElement>('#openlistOpenServer')?.rel).toContain('noreferrer');
    listTools.mockResolvedValueOnce({ success: true, tools: ['aria2', 'SimpleHttp'] });
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistRefreshTools')?.click());
    await finishDetection();
    expect(host.querySelector<HTMLOptionElement>('option[value="aria2"]')?.disabled).toBe(false);
    expect(host.textContent).not.toContain('磁链暂不可用');
  });

  it('separates a failed availability check from a successful empty list', async () => {
    listTools.mockResolvedValueOnce({ success: false, message: '网络连接失败' });
    await renderSettings();
    await finishDetection();
    expect(host.textContent).toContain('检测失败');
    expect(host.textContent).not.toContain('尚未提供');
    expect(host.textContent).not.toContain('当前目录可用');
    listTools.mockResolvedValueOnce({ success: true, tools: [] });
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistRefreshTools')?.click());
    await finishDetection();
    expect(host.textContent).toContain('当前目录未返回可用下载器');
    expect(host.textContent).not.toContain('检测失败');
  });

  it('deduplicates downloader aliases while saving the name returned by the server', async () => {
    listTools.mockResolvedValueOnce({ success: true, tools: ['Aria2', 'SimpleHttp', 'simplehttp', ' Aria2 '] });
    await renderSettings();
    await finishDetection();
    const options = Array.from(host.querySelectorAll<HTMLOptionElement>('#openlistTool option'));
    expect(options.filter(option => option.value.toLowerCase() === 'simplehttp')).toHaveLength(1);
    expect(options.filter(option => option.value.toLowerCase() === 'aria2')).toHaveLength(1);
    expect(host.querySelector<HTMLSelectElement>('#openlistTool')?.value).toBe('Aria2');
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistSave')?.click());
    expect(saveOpenListSettings).toHaveBeenCalledWith(expect.objectContaining({ tool: 'Aria2' }));
  });

  it('discards an old directory response after the user edits the destination', async () => {
    let finishOld: ((value: { success: boolean; tools: string[] }) => void) | undefined;
    listTools.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    await renderSettings();
    await finishDetection();
    await changeInput('#openlistPath', '/other');
    listTools.mockResolvedValueOnce({ success: true, tools: ['aria2'] });
    await finishDetection();
    await act(async () => { finishOld?.({ success: true, tools: ['SimpleHttp'] }); });
    expect(host.textContent).toContain('当前目录可用：Aria2');
    expect(host.textContent).not.toContain('磁链暂不可用');
  });

  it('does not label the saved downloader unavailable before a response arrives', async () => {
    await renderSettings();
    expect(host.textContent).toContain('正在检测');
    expect(host.textContent).not.toContain('尚未提供');
    expect(host.textContent).not.toContain('当前目录不可用');
  });

});
