/**
 * @vitest-environment jsdom
 * @file useDrive115Cover.test.tsx
 * @description 115 封面视口加载回归测试
 * @module apps/dashboard/pages/media
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendRuntimeMessage } = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(async () => ({
    success: true,
    url: 'https://115.example/cover.jpg',
  })),
}));

vi.mock('../../../../platform/browser/runtimeMessages', () => ({
  sendRuntimeMessage,
}));

import { useDrive115Cover } from './useDrive115Cover';

type ObserverCallback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;

function CoverHarness() {
  const { ref, coverUrl } = useDrive115Cover({
    source: '115',
    coverPickCode: 'cover-pick',
  });

  const attachRef = (node: HTMLDivElement | null) => {
    if (node) {
      node.getBoundingClientRect = () => ({
        top: 0,
        bottom: 120,
        left: 0,
        right: 120,
        width: 120,
        height: 120,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    }
    ref(node);
  };

  return createElement('div', {
    ref: attachRef,
    'data-cover-url': coverUrl,
  });
}

describe('useDrive115Cover', () => {
  let observerCallback: ObserverCallback | undefined;

  beforeEach(() => {
    sendRuntimeMessage.mockClear();
    observerCallback = undefined;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: ObserverCallback) {
        observerCallback = callback;
      }

      observe(): void {
        // 等待 Hook 自己判断已在视口内的节点。
      }

      disconnect(): void {
        // no-op
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('节点已经在视口内时不依赖 IntersectionObserver 回调也会解析封面', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(CoverHarness));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(observerCallback).toBeDefined();
    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL',
      pickCode: 'cover-pick',
    });

    await act(async () => {
      root.unmount();
    });
  });
});
