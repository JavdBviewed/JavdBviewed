/**
 * @file media115PlayPanelGuidance.dom.test.tsx
 * @description 115 播放面板（G2）：索引 pick_code 直通失败时 message 追加引导句
 * （指引用户改用搜索获取最新播放地址）；搜索流程零回归（runSearch → onStreamReady 既有文案）。
 * @module tests/dom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '../../apps/extension/src/features/drive115/v2/drive115PlaybackActions',
  async (importActual) => {
    const actual = await importActual<any>();
    return {
      ...actual,
      tryResolveDrive115StreamUrl: vi.fn(),
      resolveDrive115PlayTarget: vi.fn(),
    };
  },
);

import { Media115PlayPanel } from '../../apps/extension/src/apps/dashboard/pages/media/Media115PlayPanel';
import {
  resolveDrive115PlayTarget,
  tryResolveDrive115StreamUrl,
} from '../../apps/extension/src/features/drive115/v2/drive115PlaybackActions';

const GUIDANCE = '索引 pick_code 可能已失效，可改用搜索获取最新播放地址';

let host: HTMLDivElement;
let root: Root;

async function until(assertion: () => void, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (e) {
      if (Date.now() - start > timeoutMs) throw e;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe('Media115PlayPanel 直通失败引导（G2）', () => {
  it('直通失败：message 含原错误 + 引导句', async () => {
    (tryResolveDrive115StreamUrl as any).mockResolvedValue({ success: false, message: 'pick_code 已失效' });
    root.render(
      createElement(Media115PlayPanel, { initialQuery: 'FTHTD-243', initialPickCode: '998877' }),
    );

    await until(() => {
      const msg = document.querySelector('.ml-115-msg');
      expect(msg).not.toBeNull();
      expect(msg!.textContent).toContain('pick_code 已失效');
      expect(msg!.textContent).toContain(GUIDANCE);
    });
  });

  it('直通失败且流服务无 message：回退文案 + 引导句', async () => {
    (tryResolveDrive115StreamUrl as any).mockResolvedValue({ success: false });
    root.render(
      createElement(Media115PlayPanel, { initialQuery: 'FTHTD-243', initialPickCode: '998877' }),
    );

    await until(() => {
      const msg = document.querySelector('.ml-115-msg');
      expect(msg).not.toBeNull();
      expect(msg!.textContent).toContain('取流失败');
      expect(msg!.textContent).toContain(GUIDANCE);
    });
  });

  it('搜索流程零回归：runSearch → onStreamReady 既有文案，message 不被引导句污染', async () => {
    const onStreamReady = vi.fn();
    const candidate = { fileId: 'f1', fileName: 'FTHTD-243.mp4', fileSize: 1234567, pickCode: 'p-1', parentId: '1', sha1: 's' };
    (resolveDrive115PlayTarget as any).mockResolvedValue({
      success: true,
      session: { candidates: [candidate] },
      defaultCandidate: candidate,
      webPlayUrl: 'https://www.115.com/cdb?x=1',
      streamUrl: 'https://stream.example/v.mp4',
      streamType: 'mp4',
    });
    act(() => {
      root.render(createElement(Media115PlayPanel, { initialQuery: 'FTHTD-243', onStreamReady }));
    });

    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '搜索');
    expect(btn).toBeDefined();
    act(() => {
      (btn as HTMLButtonElement).click();
    });

    await until(() => expect(onStreamReady).toHaveBeenCalledTimes(1));
    expect(onStreamReady.mock.calls[0][0]).toMatchObject({
      streamUrl: 'https://stream.example/v.mp4',
      message: '已获取播放地址，正在打开播放器…',
    });
    const msg = document.querySelector('.ml-115-msg');
    expect(msg!.textContent).not.toContain(GUIDANCE);
  });
});
