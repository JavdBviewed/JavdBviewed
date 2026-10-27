// @vitest-environment jsdom
/**
 * @file newWorksSettingsPage.cloudScanReadback.test.tsx
 * @description 云扫描回读提示（10-27-ext-scan-config-readback）页面运行时测试（jsdom 真挂载）：
 * 无凭据→不发回读请求且区块隐藏；source=admin→提示行（文案+生效值+附注）；
 * extension/null→无行无错；保存成功涉 cloudScan 变更→再拉一次；不涉→不再拉。
 * 真定时器 settle（fake timers 会接管 queueMicrotask 卡动态 import，mount.settingsRace 先例）。
 * @module apps/dashboard/pages/settings/newWorks
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadForm: vi.fn(),
  persistForm: vi.fn(),
  toast: vi.fn(),
  loadCloudSettings: vi.fn(),
  fetchJavdbSessionVaultStatus: vi.fn(),
  pushJavdbSessionVaultIfEnabled: vi.fn(),
  deleteJavdbSessionVault: vi.fn(),
  getCloudScanConfig: vi.fn(),
  scheduleSave: vi.fn(),
  /** 页面 persist 回调（hook mock 挂载时捕获；保存链路用例经它驱动落盘） */
  pagePersist: null as null | ((value: unknown) => Promise<unknown>),
}));

vi.mock('./newWorksSettingsActions', () => ({
  loadNewWorksSettingsForm: mocks.loadForm,
  persistNewWorksForm: mocks.persistForm,
  toast: mocks.toast,
}));

vi.mock('../../../../../features/cloudSync', () => ({
  loadCloudSettings: mocks.loadCloudSettings,
  fetchJavdbSessionVaultStatus: mocks.fetchJavdbSessionVaultStatus,
  pushJavdbSessionVaultIfEnabled: mocks.pushJavdbSessionVaultIfEnabled,
  deleteJavdbSessionVault: mocks.deleteJavdbSessionVault,
  getCloudScanConfig: mocks.getCloudScanConfig,
}));

vi.mock('../shared/settingsPersist', () => ({
  useDebouncedSettingsSave: (options: {
    delayMs: number;
    persist: (value: unknown) => Promise<unknown>;
  }) => {
    mocks.pagePersist = options.persist;
    return {
      scheduleSave: mocks.scheduleSave,
      flush: () => undefined,
      mountedRef: { current: true },
    };
  },
}));

import { DEFAULT_NEW_WORKS_SETTINGS_FORM } from './newWorksSettingsModel';
import { NewWorksSettingsPage } from './NewWorksSettingsPage';

const ADMIN_BODY = { enabled: true, batchSize: 25, intervalMinutes: 15, source: 'admin' as const };

function setCloudCredentials(saved: boolean): void {
  mocks.loadCloudSettings.mockResolvedValue({
    baseUrl: 'http://127.0.0.1:18080',
    deviceLabel: '浏览器扩展',
    accountIdentifier: saved ? 'readback@t' : '',
    accountPassword: saved ? 'secret' : '',
    deviceId: 'd-readback',
    updatedAt: 0,
  });
}

let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.loadForm.mockResolvedValue({ ...DEFAULT_NEW_WORKS_SETTINGS_FORM });
  mocks.persistForm.mockResolvedValue({ ok: true });
  mocks.toast.mockResolvedValue(undefined);
  mocks.fetchJavdbSessionVaultStatus.mockResolvedValue('present');
  mocks.pushJavdbSessionVaultIfEnabled.mockResolvedValue({ ok: true });
  mocks.deleteJavdbSessionVault.mockResolvedValue({ ok: true });
  mocks.getCloudScanConfig.mockResolvedValue(null);
  mocks.scheduleSave.mockImplementation((value: unknown) => {
    void mocks.pagePersist?.(value);
  });
  document.body.innerHTML = '<div id="readback-root"></div>';
  root = createRoot(document.getElementById('readback-root') as HTMLDivElement);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.innerHTML = '';
});

/** 真定时器 settle：冲刷微任务链与 0ms 定时器 */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function mount(): void {
  act(() => {
    root.render(createElement(NewWorksSettingsPage));
  });
}

describe('NewWorksSettingsPage 云扫描回读提示（运行时）', () => {
  it('未存云凭据 → 不发回读请求，云扫描区块隐藏', async () => {
    setCloudCredentials(false);
    mount();
    await settle();
    expect(mocks.getCloudScanConfig).not.toHaveBeenCalled();
    expect(document.getElementById('new-works-cloud-scan')).toBeNull();
    expect(document.getElementById('nwCloudScanConfigReadback')).toBeNull();
  });

  it('source=admin → 提示行在位（文案+生效值+附注），初拉恰一次', async () => {
    setCloudCredentials(true);
    mocks.getCloudScanConfig.mockResolvedValue(ADMIN_BODY);
    mount();
    await settle();
    expect(mocks.getCloudScanConfig).toHaveBeenCalledTimes(1);
    const el = document.getElementById('nwCloudScanConfigReadback');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('云端管理台配置优先生效：开，每 15 分钟，每批 25 条');
    expect(el?.textContent).toContain('拓展端修改仅在管理台未接管时生效');
  });

  it('source=extension → 无提示行（区块与页面行为不变）', async () => {
    setCloudCredentials(true);
    mocks.getCloudScanConfig.mockResolvedValue({ enabled: true, batchSize: 25, intervalMinutes: 15, source: 'extension' });
    mount();
    await settle();
    expect(mocks.getCloudScanConfig).toHaveBeenCalledTimes(1);
    expect(document.getElementById('new-works-cloud-scan')).not.toBeNull();
    expect(document.getElementById('nwCloudScanConfigReadback')).toBeNull();
  });

  it('拉取失败（null）→ 无提示行、无错误横幅', async () => {
    setCloudCredentials(true);
    mocks.getCloudScanConfig.mockResolvedValue(null);
    mount();
    await settle();
    expect(document.getElementById('new-works-cloud-scan')).not.toBeNull();
    expect(document.getElementById('nwCloudScanConfigReadback')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('保存成功涉 cloudScan 变更 → 回读再拉一次（共 2 次）', async () => {
    setCloudCredentials(true);
    mocks.getCloudScanConfig.mockResolvedValue(ADMIN_BODY);
    mount();
    await settle();
    expect(mocks.getCloudScanConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      mocks.scheduleSave({ ...DEFAULT_NEW_WORKS_SETTINGS_FORM, cloudScanEnabled: true });
    });
    await settle();
    expect(mocks.persistForm).toHaveBeenCalledTimes(1);
    expect(mocks.getCloudScanConfig).toHaveBeenCalledTimes(2);
  });

  it('保存成功不涉 cloudScan → 不再拉（保持 1 次）', async () => {
    setCloudCredentials(true);
    mocks.getCloudScanConfig.mockResolvedValue(ADMIN_BODY);
    mount();
    await settle();
    expect(mocks.getCloudScanConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      mocks.scheduleSave({ ...DEFAULT_NEW_WORKS_SETTINGS_FORM, checkInterval: 48 });
    });
    await settle();
    expect(mocks.persistForm).toHaveBeenCalledTimes(1);
    expect(mocks.getCloudScanConfig).toHaveBeenCalledTimes(1);
  });
});
