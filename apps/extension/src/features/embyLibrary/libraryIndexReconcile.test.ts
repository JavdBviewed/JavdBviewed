/**
 * @file libraryIndexReconcile.test.ts
 * @description storage 级对账测试（10-26-emby-index-reconcile）：
 * 有变化才写回 / syncSuggested 口径（配置变化 && 入库开启）/ fail-open /
 * 同步请求上下文分流（SW 直调 handler，页面发 runtime 消息）
 * @module features/embyLibrary
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    getValue: vi.fn(async (key: string, fallback: unknown) => values.get(key) ?? fallback),
    setValue: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };
});

const runtimeMock = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(async () => ({ success: true })),
}));

const handlersMock = vi.hoisted(() => ({
  handleEmbyLibrarySync: vi.fn((message: unknown, cb?: (response: unknown) => void) => {
    cb?.({ success: true, synced: 1, failed: 0 });
  }),
}));

vi.mock('../../utils/storage', () => storageMock);
vi.mock('../../platform/browser/runtimeMessages', () => runtimeMock);
vi.mock('./background/handlers', () => handlersMock);

import {
  reconcileEmbyLibraryIndexAfterSettingsChange,
  requestEmbyLibrarySyncAfterConfigChange,
} from './libraryIndexReconcile';
import { STORAGE_KEYS } from '../../utils/config';

const OLD_URL = 'http://192.168.1.66:18096';
const NEW_URL = 'http://47.108.74.231:18096';

function server(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'srv-1',
    type: 'emby',
    name: 'Emby-home',
    url: OLD_URL,
    enabled: true,
    apiKey: 'KEY-1',
    ...over,
  };
}

function seedLibraryState(codes: Array<'AAA-001' | 'BBB-002'> = ['AAA-001', 'BBB-002']): void {
  const entries: Record<string, Array<Record<string, unknown>>> = {};
  if (codes.includes('AAA-001')) {
    entries['AAA-001'] = [
      { serverType: 'emby', serverName: 'Emby-home', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' },
    ];
  }
  if (codes.includes('BBB-002')) {
    entries['BBB-002'] = [
      { serverType: 'emby', serverName: 'Emby-home', serverUrl: NEW_URL, itemId: 'item-9', itemName: 'BBB-002' },
    ];
  }
  storageMock.values.set(STORAGE_KEYS.EMBY_LIBRARY_STATE, { entries, updatedAt: 1000 });
}

describe('reconcileEmbyLibraryIndexAfterSettingsChange', () => {
  beforeEach(() => {
    storageMock.values.clear();
    seedLibraryState();
  });

  it('无孤儿（白名单全覆盖）→ 不写回、不触发同步', async () => {
    seedLibraryState(['AAA-001']);
    const settings = { emby: { mediaServers: [server()], libraryEnabled: true } };
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: settings,
      nextSettings: settings,
    });
    expect(result).toEqual({ changed: false, removedEntryCount: 0, syncSuggested: false });
    expect(storageMock.setValue).not.toHaveBeenCalled();
  });

  it('凭据变化（登录保存令牌）：无孤儿也要 syncSuggested，不写回', async () => {
    seedLibraryState(['AAA-001']);
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: { emby: { mediaServers: [server()], libraryEnabled: true } },
      nextSettings: {
        emby: { mediaServers: [server({ accessToken: 'TOK-1', userId: 'uid-1' })], libraryEnabled: true },
      },
    });
    expect(result).toEqual({ changed: false, removedEntryCount: 0, syncSuggested: true });
    expect(storageMock.setValue).not.toHaveBeenCalled();
  });

  it('孤儿残留但配置未变（假孤儿）：剪枝写回、不触发同步', async () => {
    const ghostEntries: Record<string, Array<Record<string, unknown>>> = {
      'AAA-001': [
        { serverType: 'emby', serverName: 'Emby-home', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' },
      ],
      'GGG-003': [
        { serverType: 'emby', serverName: 'ghost', serverUrl: 'http://ghost.example:8096', itemId: 'item-g', itemName: 'GGG-003' },
      ],
    };
    storageMock.values.set(STORAGE_KEYS.EMBY_LIBRARY_STATE, { entries: ghostEntries, updatedAt: 1000 });
    const settings = { emby: { mediaServers: [server()], libraryEnabled: true } };
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: settings,
      nextSettings: settings,
    });
    expect(result).toEqual({ changed: true, removedEntryCount: 1, syncSuggested: false });
    const written = storageMock.values.get(STORAGE_KEYS.EMBY_LIBRARY_STATE) as { entries: Record<string, unknown[]> };
    expect(written.entries).not.toHaveProperty('GGG-003');
    expect(written.entries['AAA-001']).toHaveLength(1);
  });

  it('改地址：孤儿剪枝写回（保留无关字段），配置变化 + 入库开启 → syncSuggested', async () => {
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: { emby: { mediaServers: [server()], libraryEnabled: true } },
      nextSettings: { emby: { mediaServers: [server({ url: NEW_URL })], libraryEnabled: true } },
    });
    expect(result).toEqual({ changed: true, removedEntryCount: 1, syncSuggested: true });
    const written = storageMock.values.get(STORAGE_KEYS.EMBY_LIBRARY_STATE) as {
      entries: Record<string, unknown[]>;
      updatedAt: number;
    };
    expect(written.entries).not.toHaveProperty('AAA-001');
    expect(written.entries['BBB-002']).toHaveLength(1);
    expect(written.updatedAt).toBe(1000);
  });

  it('删来源：该来源条目移除；配置变化 + 入库开启 → syncSuggested', async () => {
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: {
        emby: {
          mediaServers: [
            server(),
            { id: 'srv-2', type: 'emby', name: 'B', url: NEW_URL, enabled: true, apiKey: 'K2' },
          ],
          libraryEnabled: true,
        },
      },
      nextSettings: { emby: { mediaServers: [server()], libraryEnabled: true } },
    });
    expect(result).toEqual({ changed: true, removedEntryCount: 1, syncSuggested: true });
    const written = storageMock.values.get(STORAGE_KEYS.EMBY_LIBRARY_STATE) as { entries: Record<string, unknown[]> };
    expect(written.entries).not.toHaveProperty('BBB-002');
    expect(written.entries['AAA-001']).toHaveLength(1);
  });

  it('入库功能关闭：仍剪枝但不触发同步', async () => {
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: { emby: { mediaServers: [server()], libraryEnabled: false } },
      nextSettings: { emby: { mediaServers: [server({ url: NEW_URL })], libraryEnabled: false } },
    });
    expect(result.changed).toBe(true);
    expect(result.removedEntryCount).toBe(1);
    expect(result.syncSuggested).toBe(false);
  });

  it('仅名称变化（键不变）→ 无孤儿、不触发同步', async () => {
    seedLibraryState(['AAA-001']);
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: { emby: { mediaServers: [server({ name: '旧名' })], libraryEnabled: true } },
      nextSettings: { emby: { mediaServers: [server({ name: '新名' })], libraryEnabled: true } },
    });
    expect(result).toEqual({ changed: false, removedEntryCount: 0, syncSuggested: false });
  });

  it('storage 异常 → fail-open 不抛错、不触发同步', async () => {
    storageMock.getValue.mockRejectedValueOnce(new Error('storage down'));
    const result = await reconcileEmbyLibraryIndexAfterSettingsChange({
      prevSettings: { emby: { mediaServers: [server()] } },
      nextSettings: { emby: { mediaServers: [server({ url: NEW_URL })] } },
    });
    expect(result).toEqual({ changed: false, removedEntryCount: 0, syncSuggested: false });
  });
});

describe('requestEmbyLibrarySyncAfterConfigChange', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SW 上下文（无 window）→ 直调同步 handler（manual 绕过同步间隔）', async () => {
    await requestEmbyLibrarySyncAfterConfigChange('test-sw');
    expect(handlersMock.handleEmbyLibrarySync).toHaveBeenCalledTimes(1);
    expect(handlersMock.handleEmbyLibrarySync.mock.calls[0]?.[0]).toEqual({ manual: true });
    expect(runtimeMock.sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('SW 上下文同步抛错 → 仅告警不抛', async () => {
    handlersMock.handleEmbyLibrarySync.mockImplementationOnce(() => {
      throw new Error('sync down');
    });
    await expect(requestEmbyLibrarySyncAfterConfigChange('test-sw-fail')).resolves.toBeUndefined();
  });

  it('页面上下文（有 window）→ 发 runtime 消息（manual 同步）', async () => {
    vi.stubGlobal('window', {});
    await requestEmbyLibrarySyncAfterConfigChange('test-page');
    expect(runtimeMock.sendRuntimeMessage).toHaveBeenCalledWith({ type: 'EMBY_LIBRARY_SYNC', manual: true });
    expect(handlersMock.handleEmbyLibrarySync).not.toHaveBeenCalled();
  });

  it('页面上下文消息发送失败 → 仅告警不抛', async () => {
    vi.stubGlobal('window', {});
    runtimeMock.sendRuntimeMessage.mockRejectedValueOnce(new Error('no background'));
    await expect(requestEmbyLibrarySyncAfterConfigChange('test-page-fail')).resolves.toBeUndefined();
  });
});
