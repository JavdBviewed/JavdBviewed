/**
 * @vitest-environment jsdom
 * @file useDrive115Cover.test.tsx
 * @description 115 封面视口加载回归测试
 * @module apps/dashboard/pages/media
 */
import { act, createElement, useCallback } from 'react';
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

function CoverHarness({
  pickCode = 'cover-pick',
  inViewport = true,
}: { pickCode?: string; inViewport?: boolean }) {
  const { ref, coverUrl } = useDrive115Cover({
    source: '115',
    coverPickCode: pickCode,
  });

  const attachRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.getBoundingClientRect = () => ({
        top: inViewport ? 0 : 2_000,
        bottom: inViewport ? 120 : 2_120,
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
  }, [inViewport, ref]);

  return createElement('div', {
    ref: attachRef,
    'data-cover-url': coverUrl,
  });
}

let renderCount = 0;

function RenderCountHarness() {
  renderCount += 1;
  const { ref, coverUrl } = useDrive115Cover({
    source: '115',
    coverPickCode: 'render-count-pick',
  });
  return createElement('div', { ref, 'data-cover-url': coverUrl });
}

describe('useDrive115Cover', () => {
  let observerCallback: ObserverCallback | undefined;
  let observerCount = 0;

  beforeEach(() => {
    sendRuntimeMessage.mockClear();
    observerCallback = undefined;
    observerCount = 0;
    renderCount = 0;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: ObserverCallback) {
        observerCount += 1;
        observerCallback = callback;
      }

      observe(): void {
        // 等待 Hook 自己判断已在视口内的节点。
      }

      unobserve(): void {
        // 模拟共享观察器移除单个节点。
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

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL',
      pickCode: 'cover-pick',
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('多个封面实例共享一个 IntersectionObserver，避免按卡片创建观察器', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement('div', null,
        createElement(CoverHarness, { pickCode: 'cover-pick-1', inViewport: false }),
        createElement(CoverHarness, { pickCode: 'cover-pick-2', inViewport: false }),
        createElement(CoverHarness, { pickCode: 'cover-pick-3', inViewport: false }),
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(observerCount).toBe(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('绑定节点不会因为保存 DOM 节点状态而额外重渲染卡片', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(RenderCountHarness));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderCount).toBe(2);

    await act(async () => {
      root.unmount();
    });
  });
});
