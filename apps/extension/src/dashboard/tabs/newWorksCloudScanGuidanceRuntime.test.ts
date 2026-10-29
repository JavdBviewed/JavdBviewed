/**
 * @file newWorksCloudScanGuidanceRuntime.test.ts
 * @description 新作品页「云托管扫描引导」入口单测：
 * 纯函数判定（4 组合零噪声）、runtime 防御路径（行不存在不抛/读失败隐藏/接线幂等与点击行为）、
 * marker 常量一致性锁（runtime 与设置页同源）
 * @module dashboard/tabs
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { newWorksManager } from '../../features/newWorks';
import { loadCloudSettings } from '../../features/cloudSync/cloudSettingsStorage';
import {
  NWS_GUIDANCE_FOCUS_KEY,
  shouldShowCloudScanGuidance,
  updateNewWorksCloudScanGuidance,
} from './newWorksCloudScanGuidanceRuntime';

vi.mock('../../features/newWorks', () => ({
  newWorksManager: {
    getGlobalConfig: vi.fn(),
  },
}));

vi.mock('../../features/cloudSync/cloudSettingsStorage', () => ({
  loadCloudSettings: vi.fn(),
}));

const getGlobalConfigMock = vi.mocked(newWorksManager.getGlobalConfig);
const loadCloudSettingsMock = vi.mocked(loadCloudSettings);

const CREDENTIALS = { accountIdentifier: 'u-1', accountPassword: 'p-1' } as const;
const CONFIG_OFF = { cloudScan: { enabled: false, batchSize: 20, intervalMinutes: 60 } } as const;
const CONFIG_ON = { cloudScan: { enabled: true, batchSize: 20, intervalMinutes: 60 } } as const;

function stubDocument(elements: Record<string, unknown> = {}) {
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id in elements ? elements[id] : null),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shouldShowCloudScanGuidance 纯函数判定', () => {
  it('无云凭据 → 隐藏', () => {
    expect(
      shouldShowCloudScanGuidance({ hasCloudCredentials: false, cloudScanEnabled: false, configLoadOk: true }),
    ).toBe(false);
  });

  it('凭据已存 + 云扫描关闭 → 显示', () => {
    expect(
      shouldShowCloudScanGuidance({ hasCloudCredentials: true, cloudScanEnabled: false, configLoadOk: true }),
    ).toBe(true);
  });

  it('凭据已存 + 云扫描已开启 → 隐藏', () => {
    expect(
      shouldShowCloudScanGuidance({ hasCloudCredentials: true, cloudScanEnabled: true, configLoadOk: true }),
    ).toBe(false);
  });

  it('读取失败（configLoadOk=false）→ 隐藏', () => {
    expect(
      shouldShowCloudScanGuidance({ hasCloudCredentials: true, cloudScanEnabled: false, configLoadOk: false }),
    ).toBe(false);
  });
});

describe('updateNewWorksCloudScanGuidance 防御路径', () => {
  it('引导行不存在 → 静默返回且不触发任何读取', async () => {
    stubDocument({});

    await expect(updateNewWorksCloudScanGuidance()).resolves.toBeUndefined();

    expect(loadCloudSettingsMock).not.toHaveBeenCalled();
    expect(getGlobalConfigMock).not.toHaveBeenCalled();
  });

  it('凭据读取抛异常 → 行隐藏（不抛出）', async () => {
    const row = { hidden: false };
    stubDocument({ cloudScanGuidanceRow: row });
    loadCloudSettingsMock.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(updateNewWorksCloudScanGuidance()).resolves.toBeUndefined();

    expect(row.hidden).toBe(true);
  });

  it('全局配置读取抛异常 → 行隐藏（不抛出）', async () => {
    const row = { hidden: false };
    stubDocument({ cloudScanGuidanceRow: row });
    loadCloudSettingsMock.mockResolvedValueOnce({ ...CREDENTIALS });
    getGlobalConfigMock.mockRejectedValueOnce(new Error('config unavailable'));

    await expect(updateNewWorksCloudScanGuidance()).resolves.toBeUndefined();

    expect(row.hidden).toBe(true);
  });

  it('凭据已存 + 云扫描未开启 → 行显示', async () => {
    const row = { hidden: true };
    stubDocument({ cloudScanGuidanceRow: row, cloudScanGuidanceBtn: { addEventListener: vi.fn() } });
    loadCloudSettingsMock.mockResolvedValueOnce({ ...CREDENTIALS });
    getGlobalConfigMock.mockResolvedValueOnce({ ...CONFIG_OFF });

    await updateNewWorksCloudScanGuidance();

    expect(row.hidden).toBe(false);
  });
});

describe('引导按钮接线（幂等 + 点击行为）', () => {
  function makeVisibleDom() {
    const clickHandlers: Array<() => void> = [];
    const button = {
      addEventListener: (type: string, handler: () => void) => {
        if (type === 'click') clickHandlers.push(handler);
      },
    };
    const row = { hidden: false };
    stubDocument({ cloudScanGuidanceRow: row, cloudScanGuidanceBtn: button });
    loadCloudSettingsMock.mockResolvedValue({ ...CREDENTIALS });
    getGlobalConfigMock.mockResolvedValue({ ...CONFIG_OFF });
    const setItem = vi.fn();
    vi.stubGlobal('sessionStorage', { setItem, getItem: vi.fn(() => null), removeItem: vi.fn() });
    const location = { hash: '#tab-new-works' };
    vi.stubGlobal('location', location);
    return { row, button, clickHandlers, setItem, location };
  }

  it('点击 → 写 marker 并跳转设置页新作品路由（逐字 hash）', async () => {
    const dom = makeVisibleDom();

    await updateNewWorksCloudScanGuidance();
    expect(dom.clickHandlers.length).toBe(1);
    dom.clickHandlers[0]();

    expect(dom.setItem).toHaveBeenCalledTimes(1);
    expect(dom.setItem).toHaveBeenCalledWith('nwcs_guidance_focus', '1');
    expect(dom.location.hash).toBe('#tab-settings/new-works-settings');
  });

  it('多次 render 复评 → 只接线一次', async () => {
    const dom = makeVisibleDom();

    await updateNewWorksCloudScanGuidance();
    await updateNewWorksCloudScanGuidance();
    await updateNewWorksCloudScanGuidance();

    expect(dom.clickHandlers.length).toBe(1);
  });
});

describe('marker 常量一致性锁', () => {
  it('marker 键逐字为 nwcs_guidance_focus', () => {
    expect(NWS_GUIDANCE_FOCUS_KEY).toBe('nwcs_guidance_focus');
  });

  it('设置页与新作品 runtime 共用同一常量（单一事实源）', () => {
    const pageSource = readFileSync(
      new URL('../../apps/dashboard/pages/settings/newWorks/NewWorksSettingsPage.tsx', import.meta.url),
      'utf8',
    );
    expect(pageSource).toContain('NWS_GUIDANCE_FOCUS_KEY');
    expect(pageSource).not.toMatch(/'nwcs_guidance_focus'/);
  });
});
