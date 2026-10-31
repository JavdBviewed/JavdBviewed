/**
 * @file embySettingsActions.cancel.test.ts
 * @description 手动资料库同步取消动作（10-31-ext-emby-syncbtn-unstick）：
 * canceled 响应 → ui kind canceled + warning toast（部分结果汇总逐字）；
 * runManualLibrarySyncCancel reject 不抛 / 各响应形态映射
 * @module apps/dashboard/pages/settings/emby
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({
  showMessage: vi.fn(async () => {}),
}));

const settingsPersistMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  syncDashboardState: vi.fn(async () => undefined),
}));

const reconcileMock = vi.hoisted(() => ({
  reconcileEmbyLibraryIndexAfterSettingsChange: vi.fn(),
  requestEmbyLibrarySyncAfterConfigChange: vi.fn(async () => undefined),
}));

const runtimeMock = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(),
}));

vi.mock('../../../../../dashboard/ui/toast', () => toastMock);
vi.mock('../shared/settingsPersist', () => settingsPersistMock);
vi.mock('../../../../../features/embyLibrary/libraryIndexReconcile', () => reconcileMock);
vi.mock('../../../../../platform/browser/runtimeMessages', () => runtimeMock);

import { runManualLibrarySync, runManualLibrarySyncCancel } from './embySettingsActions';
import { mapSettingsToEmbyForm } from './embySettingsModel';

function currentSettings(): Record<string, unknown> {
  return {
    emby: {
      enabled: true,
      recognitionEnabled: false,
      libraryEnabled: true,
      libraryStatus: { enabled: true },
      linkBehavior: 'javdb-search',
      syncIntervalMinutes: 60,
      mediaServers: [
        { id: 'srv-1', type: 'emby', name: 'Emby-home', url: 'http://192.168.1.66:18096', apiKey: 'KEY-1', enabled: true },
      ],
    },
  };
}

describe('runManualLibrarySync canceled 响应（U4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPersistMock.getSettings.mockResolvedValue(currentSettings());
    settingsPersistMock.saveSettings.mockResolvedValue(undefined);
    reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange.mockResolvedValue({
      changed: false,
      removedEntryCount: 0,
      syncSuggested: false,
    });
  });

  it('canceled 响应 → ui kind canceled + 部分结果汇总逐字 + warning toast', async () => {
    runtimeMock.sendRuntimeMessage.mockResolvedValueOnce({
      success: true,
      synced: 1,
      failed: 1,
      canceled: true,
      serverResults: [
        { serverId: 'srv-1', serverName: 'A', success: true, itemCount: 10, indexedCount: 10 },
        { serverId: 'srv-2', serverName: 'B', success: false, error: '已取消' },
      ],
    });
    const form = mapSettingsToEmbyForm(currentSettings());

    const result = await runManualLibrarySync(form);

    expect(runtimeMock.sendRuntimeMessage).toHaveBeenCalledWith({ type: 'EMBY_LIBRARY_SYNC', manual: true });
    expect(result.ui).toEqual({
      kind: 'canceled',
      summary: '已取消：成功 1 个服务器，失败 1 个（部分结果）',
      serverResults: [
        expect.objectContaining({ serverId: 'srv-1', success: true }),
        expect.objectContaining({ serverId: 'srv-2', success: false }),
      ],
    });
    expect(toastMock.showMessage).toHaveBeenCalledWith('已取消资料库同步', 'warning');
  });

  it('canceled 且全失败 → 汇总 0/1 逐字', async () => {
    runtimeMock.sendRuntimeMessage.mockResolvedValueOnce({
      success: false,
      synced: 0,
      failed: 1,
      canceled: true,
      serverResults: [
        { serverId: 'srv-1', success: false, error: '同步已取消' },
      ],
    });
    const form = mapSettingsToEmbyForm(currentSettings());

    const result = await runManualLibrarySync(form);

    expect(result.ui.kind).toBe('canceled');
    expect(result.ui).toMatchObject({ summary: '已取消：成功 0 个服务器，失败 1 个（部分结果）' });
    expect(toastMock.showMessage).toHaveBeenCalledWith('已取消资料库同步', 'warning');
  });
});

describe('runManualLibrarySyncCancel', () => {
  it('发送 EMBY_LIBRARY_CANCEL_SYNC；running:true → {ok:true}', async () => {
    runtimeMock.sendRuntimeMessage.mockResolvedValueOnce({ success: true, running: true });
    await expect(runManualLibrarySyncCancel()).resolves.toEqual({ ok: true });
    expect(runtimeMock.sendRuntimeMessage).toHaveBeenCalledWith({ type: 'EMBY_LIBRARY_CANCEL_SYNC' });
  });

  it('无在途 running:false → {ok:true}', async () => {
    runtimeMock.sendRuntimeMessage.mockResolvedValueOnce({ success: true, running: false });
    await expect(runManualLibrarySyncCancel()).resolves.toEqual({ ok: true });
  });

  it('SW 消息 reject → 不抛，返回 {ok:false, message}', async () => {
    runtimeMock.sendRuntimeMessage.mockRejectedValueOnce(new Error('SW 无响应'));
    await expect(runManualLibrarySyncCancel()).resolves.toEqual({ ok: false, message: 'SW 无响应' });
  });

  it('响应 success:false → {ok:false, message: error}', async () => {
    runtimeMock.sendRuntimeMessage.mockResolvedValueOnce({ success: false, error: '取消失败' });
    await expect(runManualLibrarySyncCancel()).resolves.toEqual({ ok: false, message: '取消失败' });
  });
});
