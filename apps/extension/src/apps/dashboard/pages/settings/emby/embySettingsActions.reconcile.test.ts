/**
 * @file embySettingsActions.reconcile.test.ts
 * @description 设置保存后索引即时对账接线测试（10-26-emby-index-reconcile）：
 * 保存成功 → 对账；配置变化且建议同步 → 触发一次后台同步（fire-and-forget）；
 * 手动同步路径防重复触发；校验失败不对账
 * @module apps/dashboard/pages/settings/emby
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  sendRuntimeMessage: vi.fn(async () => ({ success: true, synced: 1, failed: 0, serverResults: [] })),
}));

vi.mock('../shared/settingsPersist', () => settingsPersistMock);
vi.mock('../../../../../features/embyLibrary/libraryIndexReconcile', () => reconcileMock);
vi.mock('../../../../../platform/browser/runtimeMessages', () => runtimeMock);

import { persistEmbyForm, runManualLibrarySync } from './embySettingsActions';
import { mapSettingsToEmbyForm } from './embySettingsModel';

const OLD_URL = 'http://192.168.1.66:18096';
const NEW_URL = 'http://47.108.74.231:18096';

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
        { id: 'srv-1', type: 'emby', name: 'Emby-home', url: OLD_URL, apiKey: 'KEY-1', enabled: true },
      ],
    },
  };
}

async function flushFireAndForget(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('persistEmbyForm 索引对账接线', () => {
  beforeEach(() => {
    settingsPersistMock.getSettings.mockResolvedValue(currentSettings());
    settingsPersistMock.saveSettings.mockResolvedValue(undefined);
  });

  it('保存改地址成功 → 对账（prev=保存前 / next=保存后）并触发后台同步', async () => {
    reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange
      .mockResolvedValueOnce({ changed: true, removedEntryCount: 1, syncSuggested: true });
    const form = mapSettingsToEmbyForm(currentSettings());
    form.mediaServers[0].url = NEW_URL;

    const result = await persistEmbyForm(form);

    expect(result).toEqual({ ok: true });
    const saved = settingsPersistMock.saveSettings.mock.calls[0]?.[0] as {
      emby: { mediaServers: Array<{ url: string }> };
    };
    expect(saved.emby.mediaServers[0].url).toBe(NEW_URL);
    expect(reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange).toHaveBeenCalledTimes(1);
    expect(reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange).toHaveBeenCalledWith({
      prevSettings: currentSettings(),
      nextSettings: saved,
    });
    await flushFireAndForget();
    expect(reconcileMock.requestEmbyLibrarySyncAfterConfigChange).toHaveBeenCalledWith('emby-settings-save');
  });

  it('仅改名称（无配置变化）→ 对账执行但不触发同步', async () => {
    reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange
      .mockResolvedValueOnce({ changed: false, removedEntryCount: 0, syncSuggested: false });
    const form = mapSettingsToEmbyForm(currentSettings());
    form.mediaServers[0].name = '改名';

    const result = await persistEmbyForm(form);

    expect(result).toEqual({ ok: true });
    expect(reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange).toHaveBeenCalledTimes(1);
    await flushFireAndForget();
    expect(reconcileMock.requestEmbyLibrarySyncAfterConfigChange).not.toHaveBeenCalled();
  });

  it('校验失败 → 不保存、不对账', async () => {
    const form = mapSettingsToEmbyForm(currentSettings());
    form.mediaServers[0].url = 'not-a-url';

    const result = await persistEmbyForm(form);

    expect(result.ok).toBe(false);
    expect(settingsPersistMock.saveSettings).not.toHaveBeenCalled();
    expect(reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange).not.toHaveBeenCalled();
    expect(reconcileMock.requestEmbyLibrarySyncAfterConfigChange).not.toHaveBeenCalled();
  });
});

describe('runManualLibrarySync 防重复触发', () => {
  beforeEach(() => {
    settingsPersistMock.getSettings.mockResolvedValue(currentSettings());
    settingsPersistMock.saveSettings.mockResolvedValue(undefined);
  });

  it('保存侧跳过自动同步（skipAutoSync），由手动路径自发 EMBY_LIBRARY_SYNC', async () => {
    reconcileMock.reconcileEmbyLibraryIndexAfterSettingsChange
      .mockResolvedValueOnce({ changed: true, removedEntryCount: 1, syncSuggested: true });
    const form = mapSettingsToEmbyForm(currentSettings());
    form.mediaServers[0].url = NEW_URL;

    const result = await runManualLibrarySync(form);

    expect(result.ui).toMatchObject({ kind: 'success' });
    expect(runtimeMock.sendRuntimeMessage).toHaveBeenCalledWith({ type: 'EMBY_LIBRARY_SYNC', manual: true });
    await flushFireAndForget();
    expect(reconcileMock.requestEmbyLibrarySyncAfterConfigChange).not.toHaveBeenCalled();
  });
});
