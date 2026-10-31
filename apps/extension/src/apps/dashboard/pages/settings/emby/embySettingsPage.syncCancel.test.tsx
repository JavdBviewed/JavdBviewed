/**
 * @vitest-environment jsdom
 * @file embySettingsPage.syncCancel.test.tsx
 * @description 资料库同步按钮取消与禁用解释（10-31-ext-emby-syncbtn-unstick）页面运行时测试：
 * flush reject → 错误面板 + toast + 按钮恢复；!libraryEnabled → 提示行 + disabled + title；
 * syncing 中按钮变「取消同步」→ 二次点击走取消动作（reject 不抛、不改 syncStatus）
 * @module apps/dashboard/pages/settings/emby
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionsMock = vi.hoisted(() => ({
  toast: vi.fn(async () => {}),
  runManualLibrarySync: vi.fn(),
  runManualLibrarySyncCancel: vi.fn(),
  persistEmbyForm: vi.fn(async () => ({ ok: true })),
  runLibraryCheck: vi.fn(),
  loginEmbyUser: vi.fn(),
  getLibrarySyncDiagnosis: vi.fn(() => ({ title: '同步失败', description: '测试用诊断' })),
}));

const settingsPersistMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  scheduleSave: vi.fn(),
  flush: vi.fn(async () => {}),
  useDebouncedSettingsSave: vi.fn(() => ({
    scheduleSave: settingsPersistMock.scheduleSave,
    flush: settingsPersistMock.flush,
    mountedRef: { current: true },
  })),
}));

vi.mock('./embySettingsActions', () => actionsMock);
vi.mock('../shared/settingsPersist', () => settingsPersistMock);

import { EmbySettingsPage } from './EmbySettingsPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pageSettings(libraryEnabled: boolean): Record<string, unknown> {
  return {
    emby: {
      enabled: true,
      recognitionEnabled: false,
      libraryEnabled,
      libraryStatus: { enabled: libraryEnabled },
      linkBehavior: 'javdb-search',
      syncIntervalMinutes: 60,
      mediaServers: [
        { id: 'srv-1', type: 'emby', name: 'Emby-home', url: 'http://192.168.1.66:18096', apiKey: 'KEY-1', enabled: true },
      ],
    },
  };
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  settingsPersistMock.getSettings.mockResolvedValue(pageSettings(true));
  settingsPersistMock.flush.mockResolvedValue(undefined);
  actionsMock.runManualLibrarySync.mockResolvedValue({ ui: { kind: 'idle' } });
  actionsMock.runManualLibrarySyncCancel.mockResolvedValue({ ok: true });
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

async function mountPage(): Promise<void> {
  await act(async () => {
    root.render(createElement(EmbySettingsPage));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function syncButton(): HTMLButtonElement {
  const button = document.getElementById('sync-emby-library');
  expect(button, 'sync-emby-library 按钮缺失').not.toBeNull();
  return button as HTMLButtonElement;
}

async function clickSyncButton(): Promise<void> {
  await act(async () => {
    syncButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('EmbySettingsPage 同步按钮取消与禁用解释（U5）', () => {
  it('flush reject → 错误面板 + error toast + 按钮恢复，不发起同步', async () => {
    settingsPersistMock.flush.mockRejectedValueOnce(new Error('flush 失败'));
    await mountPage();

    await clickSyncButton();

    expect(actionsMock.runManualLibrarySync).not.toHaveBeenCalled();
    expect(actionsMock.toast).toHaveBeenCalledWith('资料库同步失败：flush 失败', 'error');
    const panel = document.getElementById('emby-library-sync-status');
    expect(panel?.textContent).toContain('同步失败：flush 失败');
    const button = syncButton();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('立即同步资料库');
  });

  it('libraryEnabled=false → 按钮 disabled + title + 提示行逐字在位', async () => {
    settingsPersistMock.getSettings.mockResolvedValue(pageSettings(false));
    await mountPage();

    const button = syncButton();
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('请先开启「启用资料库同步」');
    const hint = document.getElementById('sync-emby-library-hint');
    expect(hint, 'sync-emby-library-hint 缺失').not.toBeNull();
    expect(hint?.textContent).toContain('请先开启「启用资料库同步」后再同步资料库。');
  });

  it('libraryEnabled=true → 提示行不渲染', async () => {
    await mountPage();
    const button = syncButton();
    expect(button.disabled).toBe(false);
    expect(document.getElementById('sync-emby-library-hint')).toBeNull();
  });

  it('syncing 中按钮变「取消同步」；二次点击走取消动作，失败形态不抛且不改 syncStatus', async () => {
    let resolveSync: ((value: { ui: { kind: string } }) => void) | null = null;
    actionsMock.runManualLibrarySync.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );
    // 取消动作契约=reject 不抛（SW 无响应等由动作层收敛为 {ok:false,message}）
    actionsMock.runManualLibrarySyncCancel.mockResolvedValueOnce({ ok: false, message: 'SW 无响应' });
    await mountPage();

    await clickSyncButton();
    let button = syncButton();
    expect(button.textContent).toContain('取消同步');

    await clickSyncButton();
    expect(actionsMock.runManualLibrarySyncCancel).toHaveBeenCalledTimes(1);
    expect(actionsMock.toast).toHaveBeenCalledWith('取消资料库同步失败：SW 无响应', 'error');
    // 最终态由在途同步的响应落地：取消失败不改面板
    expect(document.getElementById('emby-library-sync-status')?.textContent).toContain('正在同步资料库');
    button = syncButton();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('取消同步');
  });

  it('取消动作成功（ok:true）→ 无 toast、按钮保持取消态直至在途同步落地', async () => {
    let resolveSync: ((value: { ui: { kind: string } }) => void) | null = null;
    actionsMock.runManualLibrarySync.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );
    await mountPage();

    await clickSyncButton();
    await clickSyncButton();
    expect(actionsMock.runManualLibrarySyncCancel).toHaveBeenCalledTimes(1);
    expect(actionsMock.toast).not.toHaveBeenCalled();

    await act(async () => {
      resolveSync?.({ ui: { kind: 'idle' } });
    });
    const button = syncButton();
    expect(button.textContent).toContain('立即同步资料库');
    expect(button.disabled).toBe(false);
  });
});
