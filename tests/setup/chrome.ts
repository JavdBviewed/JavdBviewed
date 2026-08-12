/**
 * @file chrome.ts
 * @description Chrome API mock 层 —— 为 vitest 提供 chrome.runtime / storage / tabs / alarms 的完整模拟
 * @module tests/setup
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import manifest from '../../apps/extension/src/manifest.json';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

type ChromeMessage = {
  type?: string;     // 消息类型标识
  payload?: unknown; // 消息负载
  [key: string]: unknown;
};

type RuntimeMessageHandler = (message: ChromeMessage, sender?: chrome.runtime.MessageSender) => unknown | Promise<unknown>;  // runtime 消息处理器签名

type Listener<T extends (...args: any[]) => any> = T;

/** 创建 Chrome 扩展事件模拟对象 —— 支持 addListener / removeListener / dispatch */
function createEvent<T extends (...args: any[]) => any>() {
  const listeners = new Set<Listener<T>>();
  return {
    addListener: vi.fn((listener: Listener<T>) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: Listener<T>) => {
      listeners.delete(listener);
    }),
    hasListener: vi.fn((listener: Listener<T>) => listeners.has(listener)),
    hasListeners: vi.fn(() => listeners.size > 0),
    dispatch: (...args: Parameters<T>) => {
      for (const listener of listeners) {
        listener(...args);
      }
    },
    clear: () => listeners.clear(),
    listeners,
  };
}

let storageState: Record<string, any> = {};
let runtimeMessages: ChromeMessage[] = [];
let tabsMessages: Array<{ tabId: number; message: ChromeMessage }> = [];
let createdTabs: chrome.tabs.CreateProperties[] = [];
let runtimeMessageHandler: RuntimeMessageHandler = () => ({ ok: true, success: true });

const storageChangedEvent = createEvent<(changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void>();
const runtimeMessageEvent = createEvent<(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => boolean | void>();
const runtimeConnectEvent = createEvent<(port: chrome.runtime.Port) => void>();
const runtimeStartupEvent = createEvent<() => void>();
const runtimeInstalledEvent = createEvent<(details: chrome.runtime.InstalledDetails) => void>();
const tabsUpdatedEvent = createEvent<(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void>();
const tabsRemovedEvent = createEvent<(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void>();
const alarmsAlarmEvent = createEvent<(alarm: chrome.alarms.Alarm) => void>();

/** 深拷贝（JSON 序列化/反序列化） */
function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

/** 根据 keys 参数构建 storage.get 返回值（支持 string/array/object 三种查询方式） */
function buildStorageResult(keys: string | string[] | Record<string, any> | null | undefined): Record<string, any> {
  if (keys === null || keys === undefined) return clone(storageState);
  if (typeof keys === 'string') {
    return Object.prototype.hasOwnProperty.call(storageState, keys) ? { [keys]: clone(storageState[keys]) } : {};
  }
  if (Array.isArray(keys)) {
    return keys.reduce<Record<string, any>>((result, key) => {
      if (Object.prototype.hasOwnProperty.call(storageState, key)) {
        result[key] = clone(storageState[key]);
      }
      return result;
    }, {});
  }
  return Object.entries(keys).reduce<Record<string, any>>((result, [key, fallback]) => {
    result[key] = Object.prototype.hasOwnProperty.call(storageState, key) ? clone(storageState[key]) : fallback;
    return result;
  }, {});
}

function finishChromeCall<T>(value: T, callback?: (value: T) => void): Promise<T> | void {
  if (callback) {
    callback(value);
    return undefined;
  }
  return Promise.resolve(value);
}

function buildStorageChanges(payload: Record<string, any>): { [key: string]: chrome.storage.StorageChange } {
  return Object.entries(payload).reduce<{ [key: string]: chrome.storage.StorageChange }>((changes, [key, newValue]) => {
    changes[key] = {
      oldValue: clone(storageState[key]),
      newValue: clone(newValue),
    };
    return changes;
  }, {});
}

function createChromeMock(): typeof chrome {
  const chromeMock = {
    runtime: {
      id: 'test-runtime',
      lastError: null as chrome.runtime.LastError | null,
      getManifest: vi.fn(() => clone(manifest) as chrome.runtime.Manifest),
      getURL: vi.fn((path = '') => `chrome-extension://test-runtime/${path}`),
      reload: vi.fn(),
      openOptionsPage: vi.fn((callback?: () => void) => finishChromeCall(undefined, callback)),
      sendMessage: vi.fn((message: ChromeMessage, callback?: (response?: any) => void) => {
        runtimeMessages.push(clone(message));
        const resolveResponse = async () => runtimeMessageHandler(message, { id: 'test-runtime' } as chrome.runtime.MessageSender);
        if (callback) {
          void resolveResponse()
            .then((response) => callback(response))
            .catch((error) => {
              chromeMock.runtime.lastError = { message: error instanceof Error ? error.message : String(error) };
              callback(undefined);
            });
          return undefined;
        }
        return resolveResponse();
      }),
      onMessage: runtimeMessageEvent,
      onConnect: runtimeConnectEvent,
      onStartup: runtimeStartupEvent,
      onInstalled: runtimeInstalledEvent,
    },
    storage: {
      local: {
        get: vi.fn((keys?: string | string[] | Record<string, any> | null, callback?: (items: Record<string, any>) => void) => {
          return finishChromeCall(buildStorageResult(keys), callback);
        }),
        set: vi.fn((payload: Record<string, any>, callback?: () => void) => {
          const changes = buildStorageChanges(payload);
          storageState = { ...storageState, ...clone(payload) };
          storageChangedEvent.dispatch(changes, 'local');
          return finishChromeCall(undefined, callback);
        }),
        remove: vi.fn((keys: string | string[], callback?: () => void) => {
          const changes: { [key: string]: chrome.storage.StorageChange } = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (Object.prototype.hasOwnProperty.call(storageState, key)) {
              changes[key] = { oldValue: clone(storageState[key]) };
            }
            delete storageState[key];
          }
          if (Object.keys(changes).length) {
            storageChangedEvent.dispatch(changes, 'local');
          }
          return finishChromeCall(undefined, callback);
        }),
        clear: vi.fn((callback?: () => void) => {
          storageState = {};
          return finishChromeCall(undefined, callback);
        }),
      },
      sync: {
        get: vi.fn((keys?: string | string[] | Record<string, any> | null, callback?: (items: Record<string, any>) => void) => {
          return finishChromeCall(buildStorageResult(keys), callback);
        }),
        set: vi.fn((payload: Record<string, any>, callback?: () => void) => {
          storageState = { ...storageState, ...clone(payload) };
          return finishChromeCall(undefined, callback);
        }),
        remove: vi.fn((keys: string | string[], callback?: () => void) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storageState[key];
          }
          return finishChromeCall(undefined, callback);
        }),
        clear: vi.fn((callback?: () => void) => {
          storageState = {};
          return finishChromeCall(undefined, callback);
        }),
      },
      onChanged: storageChangedEvent,
    },
    tabs: {
      query: vi.fn((_queryInfo: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        return finishChromeCall([], callback);
      }),
      create: vi.fn((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
        createdTabs.push(clone(createProperties));
        const tab = { id: createdTabs.length, url: createProperties.url, active: createProperties.active ?? true } as chrome.tabs.Tab;
        return finishChromeCall(tab, callback);
      }),
      sendMessage: vi.fn((tabId: number, message: ChromeMessage, callback?: (response?: any) => void) => {
        tabsMessages.push({ tabId, message: clone(message) });
        return finishChromeCall({ ok: true, success: true }, callback);
      }),
      reload: vi.fn((_tabId?: number, callback?: () => void) => finishChromeCall(undefined, callback)),
      remove: vi.fn((_tabIds: number | number[], callback?: () => void) => finishChromeCall(undefined, callback)),
      onUpdated: tabsUpdatedEvent,
      onRemoved: tabsRemovedEvent,
    },
    alarms: {
      create: vi.fn((_name: string, _alarmInfo: chrome.alarms.AlarmCreateInfo) => Promise.resolve()),
      get: vi.fn((_name: string, callback?: (alarm?: chrome.alarms.Alarm) => void) => finishChromeCall(undefined, callback)),
      clear: vi.fn((_name: string, callback?: (wasCleared: boolean) => void) => finishChromeCall(true, callback)),
      onAlarm: alarmsAlarmEvent,
    },
    notifications: {
      create: vi.fn((_notificationId: string, _options: chrome.notifications.NotificationOptions, callback?: (notificationId: string) => void) => {
        return finishChromeCall('notification-id', callback);
      }),
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([])),
      insertCSS: vi.fn(() => Promise.resolve()),
    },
  } as unknown as typeof chrome;

  return chromeMock;
}

export function resetChromeMock(): void {
  storageState = {};
  runtimeMessages = [];
  tabsMessages = [];
  createdTabs = [];
  runtimeMessageHandler = () => ({ ok: true, success: true });

  storageChangedEvent.clear();
  runtimeMessageEvent.clear();
  runtimeConnectEvent.clear();
  runtimeStartupEvent.clear();
  runtimeInstalledEvent.clear();
  tabsUpdatedEvent.clear();
  tabsRemovedEvent.clear();
  alarmsAlarmEvent.clear();

  Object.defineProperty(globalThis, 'chrome', {
    value: createChromeMock(),
    configurable: true,
    writable: true,
  });
}

export function setChromeStorage(values: Record<string, any>): void {
  storageState = { ...storageState, ...clone(values) };
}

export function getChromeStorageSnapshot(): Record<string, any> {
  return clone(storageState);
}

export function setRuntimeMessageHandler(handler: RuntimeMessageHandler): void {
  runtimeMessageHandler = handler;
}

export function getRuntimeMessages(): ChromeMessage[] {
  return clone(runtimeMessages);
}

export function getTabsMessages(): Array<{ tabId: number; message: ChromeMessage }> {
  return clone(tabsMessages);
}

export function getCreatedTabs(): chrome.tabs.CreateProperties[] {
  return clone(createdTabs);
}

export function dispatchRuntimeInstalled(details: chrome.runtime.InstalledDetails): void {
  runtimeInstalledEvent.dispatch(details);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetChromeMock();
});

afterEach(() => {
  vi.useRealTimers();
});
