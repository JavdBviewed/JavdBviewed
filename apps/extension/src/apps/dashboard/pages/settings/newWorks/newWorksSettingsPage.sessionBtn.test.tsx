// @vitest-environment jsdom
/**
 * @file newWorksSettingsPage.sessionBtn.test.tsx
 * @description 云扫描「设置登录态」按钮反馈（10-28）页面运行时测试（jsdom 真挂载）：
 * 五分支 toast 文案/类型、busy 态（disabled+「设置中…」+恢复）、finally 刷新状态行、
 * busy 期重复点击不重推、未连云零渲染零请求、移除登录态不回归、代理位置提示行在位。
 * 真定时器 settle（cloudScanReadback 先例：fake timers 会接管 queueMicrotask 卡动态 import）。
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
  pushJavdbSessionVaultManual: vi.fn(),
  deleteJavdbSessionVault: vi.fn(),
  getCloudScanConfig: vi.fn(),
  scheduleSave: vi.fn(),
  /** 页面 persist 回调（hook mock 挂载时捕获） */
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
  pushJavdbSessionVaultManual: mocks.pushJavdbSessionVaultManual,
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

function setCloudCredentials(saved: boolean): void {
  mocks.loadCloudSettings.mockResolvedValue({
    baseUrl: 'http://127.0.0.1:18091',
    deviceLabel: '浏览器扩展',
    accountIdentifier: saved ? 'sessbtn@t' : '',
    accountPassword: saved ? 'secret' : '',
    deviceId: 'd-sessbtn',
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
  mocks.pushJavdbSessionVaultManual.mockResolvedValue({ ok: true, host: 'javdb570.com', cookieCount: 2 });
  mocks.deleteJavdbSessionVault.mockResolvedValue({ ok: true });
  mocks.getCloudScanConfig.mockResolvedValue(null);
  mocks.scheduleSave.mockImplementation((value: unknown) => {
    void mocks.pagePersist?.(value);
  });
  document.body.innerHTML = '<div id="sessbtn-root"></div>';
  root = createRoot(document.getElementById('sessbtn-root') as HTMLDivElement);
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

function setBtn(): HTMLButtonElement {
  const el = document.getElementById('nwCloudScanSessionSetBtn');
  expect(el).toBeInstanceOf(HTMLButtonElement);
  return el as HTMLButtonElement;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickAndSettle(el: HTMLElement): Promise<void> {
  click(el);
  await settle();
}

describe('NewWorksSettingsPage 设置登录态按钮反馈（运行时，10-28）', () => {
  it('ok → success toast「登录态已更新（N 个 cookie）」+ 结束后刷新状态行 + 按钮恢复', async () => {
    setCloudCredentials(true);
    mount();
    await settle();
    const before = mocks.fetchJavdbSessionVaultStatus.mock.calls.length;
    await clickAndSettle(setBtn());
    expect(mocks.toast).toHaveBeenCalledWith('登录态已更新（2 个 cookie）', 'success');
    expect(mocks.fetchJavdbSessionVaultStatus.mock.calls.length).toBeGreaterThan(before);
    expect(setBtn().disabled).toBe(false);
    expect(setBtn().textContent).toBe('设置登录态');
  });

  it('cloud-scan-disabled → warning「请先启用云扫描，再设置登录态」', async () => {
    setCloudCredentials(true);
    mocks.pushJavdbSessionVaultManual.mockResolvedValue({ ok: false, reason: 'cloud-scan-disabled' });
    mount();
    await settle();
    await clickAndSettle(setBtn());
    expect(mocks.toast).toHaveBeenCalledWith('请先启用云扫描，再设置登录态', 'warning');
  });

  it('no-credentials → warning「未检测到云服务凭据，请先配置云服务」', async () => {
    setCloudCredentials(true);
    mocks.pushJavdbSessionVaultManual.mockResolvedValue({ ok: false, reason: 'no-credentials' });
    mount();
    await settle();
    await clickAndSettle(setBtn());
    expect(mocks.toast).toHaveBeenCalledWith('未检测到云服务凭据，请先配置云服务', 'warning');
  });

  it('no-cookies → warning「未检测到 JavDB 登录 Cookie，请先在浏览器登录 JavDB 后再试」', async () => {
    setCloudCredentials(true);
    mocks.pushJavdbSessionVaultManual.mockResolvedValue({ ok: false, reason: 'no-cookies' });
    mount();
    await settle();
    await clickAndSettle(setBtn());
    expect(mocks.toast).toHaveBeenCalledWith('未检测到 JavDB 登录 Cookie，请先在浏览器登录 JavDB 后再试', 'warning');
  });

  it('push-failed → error「登录态推送失败，请检查云服务连接后重试」', async () => {
    setCloudCredentials(true);
    mocks.pushJavdbSessionVaultManual.mockResolvedValue({ ok: false, reason: 'push-failed' });
    mount();
    await settle();
    await clickAndSettle(setBtn());
    expect(mocks.toast).toHaveBeenCalledWith('登录态推送失败，请检查云服务连接后重试', 'error');
  });

  it('busy 态：推送中 disabled + 文案「设置中…」，结束后恢复', async () => {
    setCloudCredentials(true);
    let resolvePush: (v: unknown) => void = () => undefined;
    mocks.pushJavdbSessionVaultManual.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );
    mount();
    await settle();
    click(setBtn());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const btn = setBtn();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('设置中…');
    await act(async () => {
      resolvePush({ ok: true, host: 'javdb570.com', cookieCount: 2 });
    });
    await settle();
    expect(setBtn().disabled).toBe(false);
    expect(setBtn().textContent).toBe('设置登录态');
  });

  it('busy 期重复点击不重推（至多一次）', async () => {
    setCloudCredentials(true);
    let resolvePush: (v: unknown) => void = () => undefined;
    mocks.pushJavdbSessionVaultManual.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );
    mount();
    await settle();
    const btn = setBtn();
    click(btn);
    click(btn);
    await act(async () => {
      resolvePush({ ok: true, host: 'javdb570.com', cookieCount: 2 });
    });
    await settle();
    expect(mocks.pushJavdbSessionVaultManual).toHaveBeenCalledTimes(1);
  });

  it('未连云 → 区块隐藏（按钮不存在，零手动推送请求）', async () => {
    setCloudCredentials(false);
    mount();
    await settle();
    expect(document.getElementById('nwCloudScanSessionSetBtn')).toBeNull();
    expect(document.getElementById('nwCloudScanProxyHint')).toBeNull();
    expect(mocks.pushJavdbSessionVaultManual).not.toHaveBeenCalled();
  });

  it('移除登录态不回归：ok→success / fail→error（toast 文案不变）', async () => {
    setCloudCredentials(true);
    mount();
    await settle();
    const del = document.getElementById('nwCloudScanSessionDeleteBtn') as HTMLButtonElement;
    await clickAndSettle(del);
    expect(mocks.toast).toHaveBeenCalledWith('已移除登录态', 'success');
    vi.clearAllMocks();
    mocks.deleteJavdbSessionVault.mockResolvedValue({ ok: false, reason: 'delete-failed' });
    await clickAndSettle(del);
    expect(mocks.toast).toHaveBeenCalledWith('移除登录态失败', 'error');
  });
});

describe('NewWorksSettingsPage 代理位置提示（运行时，10-28）', () => {
  it('提示行在位（id + 文案逐字）', async () => {
    setCloudCredentials(true);
    mount();
    await settle();
    const el = document.getElementById('nwCloudScanProxyHint');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('云端扫描需直连 JavDB；若云端网络受限，请在 云服务管理台 → 设置 → 出站代理 配置代理（支持 http/socks5）');
  });
});
