/**
 * @file webdavControllerConcurrent.test.ts
 * @description WebDAV 后台 controller 网络窗并发写保留锁（10-21 B 组）
 *
 * 场景：listWebDAVClients 入口读 settings → 网络段 await（期间另一上下文
 * 并发写 display/emby 节）→ knownDevices 持久化点必须以 section delta 保留
 * 并发节，不得以入口全默认值实例整包写回（旧行为：抹并发节 + 钩子对新鲜
 * prev 误打 emby.deletedServerIds 墓碑）。
 *
 * 计时口径：ext 段 setup 使用 vi.useFakeTimers，本测试的同步等待只用
 * 纯微任务 flush（Promise.resolve 链），不依赖 setTimeout/setImmediate。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../apps/extension/src/utils/config';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';

vi.mock('../../apps/extension/src/features/webdavSync/application/clientRegistry', () => ({
  listWebDAVClientProfiles: vi.fn(),
  readWebDAVClientProfile: vi.fn(),
  updateWebDAVClientRegistry: vi.fn(),
}));
vi.mock('../../apps/extension/src/features/webdavSync/infrastructure/webdavClient', () => ({
  ensureWebDAVSupportDirs: vi.fn(async () => {}),
  webDavReadJsonFile: vi.fn(async () => null),
  webDavWriteJsonFile: vi.fn(async () => {}),
}));

const CLIENT_ID = '11111111-2222-4333-8444-555555555555';

/** 纯微任务 flush，等待异步链推进到断言条件（fake timers 安全）。 */
async function flushUntil(predicate: () => boolean, maxTicks = 500): Promise<boolean> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    await Promise.resolve();
    if (predicate()) return true;
  }
  return predicate();
}

describe('WebDAV controller 网络窗并发写保留（10-21 B 组）', () => {
  afterEach(() => {
    vi.doUnmock('../../apps/extension/src/features/webdavSync/application/clientRegistry');
    vi.doUnmock('../../apps/extension/src/features/webdavSync/infrastructure/webdavClient');
    vi.resetModules();
  });

  it('listWebDAVClients 网络窗内并发写 display/emby：节保留、knownDevices 落盘、emby 墓碑零新增', async () => {
    // fresh profile：webdav 已配置 + 身份齐全（排除 C1 身份补写干扰）
    const baseSettings = {
      webdav: {
        enabled: true,
        url: 'http://127.0.0.1:19002',
        username: 'u',
        password: 'p',
        clientId: CLIENT_ID,
        clientInstalledAt: '2026-01-01T00:00:00.000Z',
        browserName: 'Chrome',
        deviceLabel: 'Chrome',
      },
    };
    setChromeStorage({ [STORAGE_KEYS.SETTINGS]: baseSettings });

    const { listWebDAVClientProfiles, readWebDAVClientProfile, updateWebDAVClientRegistry } =
      await import('../../apps/extension/src/features/webdavSync/application/clientRegistry');
    readWebDAVClientProfile.mockResolvedValue(null);
    updateWebDAVClientRegistry.mockResolvedValue(undefined);

    // 网络段可控门：handler 进入 await 前不 resolve
    let releaseNetwork: () => void = () => {};
    const networkGate = new Promise<void>((resolve) => { releaseNetwork = resolve; });
    listWebDAVClientProfiles.mockImplementation(async () => {
      await networkGate;
      // 返回当前设备 profile（remote 已存在 → backfill 零写，走单 persist 路径）
      return [{
        clientId: CLIENT_ID,
        deviceLabel: 'Chrome',
        browserName: 'Chrome',
        platform: 'unknown',
        extensionVersion: '2.1.2',
        installedAt: '2026-01-01T00:00:00.000Z',
      }];
    });

    const { registerWebDAVRouter } = await import('../../apps/extension/src/features/webdavSync/background/controller');
    registerWebDAVRouter();
    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
    expect(typeof listener).toBe('function');

    const responsePromise = new Promise<any>((resolve) => {
      const handled = listener?.({ type: 'webdav-list-clients' }, {} as chrome.runtime.MessageSender, resolve);
      expect(handled).toBe(true);
    });

    // 等待 handler 进入网络段（listWebDAVClientProfiles 被调用）
    const reachedNetwork = await flushUntil(() => listWebDAVClientProfiles.mock.calls.length === 1);
    expect(reachedNetwork).toBe(true);

    // 网络窗内并发写（另一上下文落盘 display + emby 节）
    setChromeStorage({
      [STORAGE_KEYS.SETTINGS]: {
        ...baseSettings,
        display: { hideInMediaLibrary: true },
        emby: { mediaServers: [{ id: 'srv-c', name: 'C-Srv', url: 'http://10.255.250.1:18096', enabled: true }] },
      },
    });
    releaseNetwork();

    const response = await responsePromise;
    expect(response.success).toBe(true);

    const finalSettings = getChromeStorageSnapshot()[STORAGE_KEYS.SETTINGS];
    // 并发节保留（旧实现：入口全默认值实例整包写回 → display/emby 蒸发）
    expect(finalSettings.display).toEqual({ hideInMediaLibrary: true });
    expect(finalSettings.emby.mediaServers).toEqual([{ id: 'srv-c', name: 'C-Srv', url: 'http://10.255.250.1:18096', enabled: true }]);
    // emby 墓碑负锁（旧实现 next 无 emby 节，钩子对新鲜 prev 会追加 srv-c）
    expect(finalSettings.emby.deletedServerIds ?? []).toEqual([]);
    // 持久化本体生效：knownDevices 落盘且含当前设备
    expect(Array.isArray(finalSettings.webdav.knownDevices)).toBe(true);
    expect(finalSettings.webdav.knownDevices.length).toBeGreaterThanOrEqual(1);
    expect(finalSettings.webdav.knownDevices.some((device: any) => device?.clientId === CLIENT_ID)).toBe(true);
  });
});
