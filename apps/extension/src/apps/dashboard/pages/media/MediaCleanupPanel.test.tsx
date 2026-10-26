/**
 * @vitest-environment jsdom
 * @file MediaCleanupPanel.test.tsx
 * @description 清理面板来源已失效（孤儿）副本渲染测试（10-26-emby-index-reconcile）：
 * 标记 + 勾选禁用 + 页面级全选口径 + 「清除失效条目」消息 + 历史行重试入口收敛
 * @module apps/dashboard/pages/media
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendRuntimeMessage } = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(async (message: { type?: string }) => {
    if (message?.type === 'MEDIA_CLEANUP_CLEAR_INVALID_COPIES') {
      return { success: true, clearedCount: 1, removedEntryCount: 1, skippedCount: 0 };
    }
    return { success: true };
  }),
}));

vi.mock('../../../../platform/browser/runtimeMessages', () => ({
  sendRuntimeMessage,
}));

import { MediaCleanupPanel } from './MediaCleanupPanel';

const OLD_URL = 'http://192.168.1.66:18096';
const NEW_URL = 'http://47.108.74.231:18096';

const ORPHAN_COPY_ID = 'emby:old-server:i1';
const VALID_COPY_ID = 'emby:new-server:i2';

function cleanupStateFixture() {
  return {
    version: 1,
    items: {
      'AAA-001': {
        id: 'AAA-001',
        titleId: 'AAA-001',
        code: 'AAA-001',
        title: 'AAA-001 标题',
        reason: 'watched',
        addedAt: 900,
        updatedAt: 1000,
        copies: {
          [ORPHAN_COPY_ID]: {
            copyId: ORPHAN_COPY_ID,
            source: 'emby',
            serverName: 'Emby-home',
            serverUrl: OLD_URL,
            itemId: 'i1',
            fileName: 'AAA-001.mp4',
            lastFoundAt: 900,
            status: 'pending',
            updatedAt: 1000,
          },
          [VALID_COPY_ID]: {
            copyId: VALID_COPY_ID,
            source: 'emby',
            serverName: 'Emby-home',
            serverUrl: NEW_URL,
            itemId: 'i2',
            fileName: 'AAA-001 新版.mp4',
            lastFoundAt: 900,
            status: 'pending',
            updatedAt: 1000,
          },
        },
      },
      'BBB-002': {
        id: 'BBB-002',
        titleId: 'BBB-002',
        code: 'BBB-002',
        title: 'BBB-002 标题',
        reason: 'watched',
        addedAt: 900,
        updatedAt: 1000,
        copies: {
          'bbb-orphan-failed': {
            copyId: 'bbb-orphan-failed',
            source: 'emby',
            serverName: 'Emby-home',
            serverUrl: OLD_URL,
            itemId: 'b1',
            fileName: 'BBB-002.mp4',
            lastFoundAt: 900,
            status: 'failed',
            error: '对应媒体服务器配置已不存在',
            updatedAt: 1000,
          },
          'bbb-valid-failed': {
            copyId: 'bbb-valid-failed',
            source: 'emby',
            serverName: 'Emby-home',
            serverUrl: NEW_URL,
            itemId: 'b2',
            fileName: 'BBB-002 新版.mp4',
            lastFoundAt: 900,
            status: 'failed',
            error: '删除失败',
            updatedAt: 1000,
          },
        },
      },
    },
    observedWatchedCopyIds: [],
    updatedAt: 1000,
  };
}

function makeChromeStub() {
  const store: Record<string, unknown> = {
    settings: {
      emby: {
        enabled: true,
        libraryEnabled: true,
        mediaServers: [
          { id: 's1', type: 'emby', name: 'Emby-home', url: NEW_URL, apiKey: 'KEY-1', enabled: true },
        ],
      },
    },
    media_cleanup_state: cleanupStateFixture(),
    media_deletion_history: { version: 1, records: {}, updatedAt: 0 },
    media_115_cleanup_list: { items: [], updatedAt: 0 },
  };
  return {
    store,
    get: vi.fn((keys: unknown, cb: (items: Record<string, unknown>) => void) => {
      const out: Record<string, unknown> = {};
      if (keys === null || keys === undefined) {
        for (const key of Object.keys(store)) out[key] = store[key];
      } else if (typeof keys === 'string') {
        if (store[keys] !== undefined) out[keys] = store[keys];
      } else if (Array.isArray(keys)) {
        for (const key of keys) if (store[key] !== undefined) out[key] = store[key];
      }
      cb(out);
    }),
    set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
      Object.assign(store, items);
      cb?.();
    }),
    remove: vi.fn((keys: string | string[], cb?: () => void) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete store[key];
      cb?.();
    }),
  };
}

let container: HTMLDivElement;
let root: Root;
let chromeStub: ReturnType<typeof makeChromeStub>;

async function renderPanel(): Promise<void> {
  await act(async () => {
    root.render(createElement(MediaCleanupPanel));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickInAct(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  chromeStub = makeChromeStub();
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      storage: { local: chromeStub },
      runtime: { id: 'test-extension-id', lastError: undefined, sendMessage: vi.fn() },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('来源已失效（孤儿）副本', () => {
  it('待处理页：孤儿行标记 + 勾选禁用；正常副本可勾选，卡片级全选只选可勾选副本', async () => {
    await renderPanel();

    const orphanRow = container.querySelector<HTMLElement>('.ml-cleanup-copy-row.is-source-invalid');
    expect(orphanRow).not.toBeNull();
    expect(orphanRow?.querySelector('.ml-cleanup-copy-invalid-badge')?.textContent).toBe('来源已失效');
    const orphanCheckbox = orphanRow?.querySelector('input[type="checkbox"]');
    expect(orphanCheckbox?.disabled).toBe(true);

    const rows = Array.from(container.querySelectorAll('.ml-cleanup-copy-row'));
    expect(rows).toHaveLength(2);
    const validCheckbox = rows.find((row) => !row.classList.contains('is-source-invalid'))
      ?.querySelector('input[type="checkbox"]');
    expect(validCheckbox?.disabled).toBe(false);

    // 卡片级全选：孤儿不参与选择，只选中正常副本
    const titleCheckbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"][aria-label="选择 AAA-001 的全部来源文件"]',
    );
    expect(titleCheckbox?.disabled).toBe(false);
    await clickInAct(titleCheckbox as HTMLElement);
    const footer = container.querySelector('.ml-cleanup-footer')?.textContent || '';
    expect(footer).toContain('1 部影片 / 1 个文件');
  });

  it('「清除失效条目」→ 发 MEDIA_CLEANUP_CLEAR_INVALID_COPIES（titleId + copyId）', async () => {
    await renderPanel();

    const clearButton = container.querySelector<HTMLButtonElement>('.ml-cleanup-copy-clear-btn');
    expect(clearButton).not.toBeNull();
    await clickInAct(clearButton as HTMLButtonElement);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'MEDIA_CLEANUP_CLEAR_INVALID_COPIES',
      titleId: 'AAA-001',
      copyId: ORPHAN_COPY_ID,
    });
  });

  it('历史页：孤儿失败副本无重试入口，正常失败副本保留重试', async () => {
    await renderPanel();

    const historyTab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((tab) => tab.textContent === '操作记录');
    await clickInAct(historyTab as HTMLElement);

    const rows = Array.from(container.querySelectorAll('[data-media-cleanup-history-row]'));
    expect(rows).toHaveLength(2);
    const byCopyLabel = (text: string) => rows.find((row) => row.textContent?.includes(text));
    const orphanRow = byCopyLabel('BBB-002.mp4');
    const validRow = byCopyLabel('BBB-002 新版.mp4');
    expect(orphanRow).not.toBeNull();
    expect(validRow).not.toBeNull();
    expect(orphanRow?.querySelector('.ml-cleanup-history-retry')).toBeNull();
    expect(validRow?.querySelector('.ml-cleanup-history-retry')?.textContent).toBe('重试删除');
  });
});
