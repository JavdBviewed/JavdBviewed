import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/config';

/**
 * 端到端（进程内）复现：UI 发送 MEDIA_CLEANUP_DELETE_COPY 消息后，
 * 真实 handler 走真实的 115 删除链路（mock 掉 settings/fetch/chrome），
 * 验证失败原因最终如何（或如何没有）传回 UI。
 *
 * 全部 mock，禁止真实 115 API 调用。
 */

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

vi.mock('../../utils/storage', () => ({
  getValue: storageMock.getValue,
  setValue: storageMock.setValue,
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

import { getSettings } from '../../utils/storage';
import { handleMediaCleanupDeleteCopy } from './mediaCleanupBackground';

const NOW = 1757102235179;
const ORIGINAL_FETCH = globalThis.fetch;

function seed115OnlyState() {
  storageMock.values.set(STORAGE_KEYS.MEDIA_CLEANUP_STATE, {
    version: 1,
    items: {
      'HBAD-720': {
        id: 'HBAD-720',
        titleId: 'HBAD-720',
        code: 'HBAD-720',
        title: 'HBAD-720 美人女友超爱口暴性欲强到随时都',
        reason: 'watched',
        addedAt: NOW,
        updatedAt: NOW,
        copies: {
          '115:file-1': {
            copyId: '115:file-1',
            source: '115',
            serverName: '115 片库',
            fileId: 'file-1',
            fileName: 'HBAD-720.mp4',
            watchedAt: NOW,
            lastFoundAt: NOW,
            status: 'pending',
            updatedAt: NOW,
          },
        },
      },
    },
    observedWatchedCopyIds: ['115:file-1'],
    updatedAt: NOW,
  });
  storageMock.values.set(STORAGE_KEYS.MEDIA_DELETION_HISTORY, { version: 1, records: {}, updatedAt: NOW });
}

function mockValidToken() {
  (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    drive115: {
      v2AccessToken: 'valid-token',
      v2TokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      v2AutoRefresh: true,
    },
  });
}

function mockFetchWith(body: unknown, init: RequestInit, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
  void init;
}

async function waitForResponse(sendResponse: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled(), { timeout: 5000 });
  return sendResponse.mock.calls[0][0] as Record<string, unknown>;
}

describe('handleMediaCleanupDeleteCopy: 115 真实链路（mock settings/fetch）', () => {
  beforeEach(() => {
    storageMock.values.clear();
    storageMock.getValue.mockClear();
    storageMock.setValue.mockClear();
    (getSettings as unknown as ReturnType<typeof vi.fn>).mockReset();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('token 过期且 refresh_token 已标记 invalid → 刷新被拒绝，失败原因透传', async () => {
    seed115OnlyState();
    (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      drive115: {
        v2AccessToken: 'expired-token',
        v2TokenExpiresAt: Math.floor(Date.now() / 1000) - 100,
        v2RefreshToken: 'rt-1',
        v2RefreshTokenStatus: 'invalid',
        v2RefreshTokenLastError: 'refresh_token 已过期',
        v2AutoRefresh: true,
      },
    });

    const sendResponse = vi.fn();
    handleMediaCleanupDeleteCopy(
      { type: 'MEDIA_CLEANUP_DELETE_COPY', titleId: 'HBAD-720', copyId: '115:file-1' },
      sendResponse,
    );
    const response = await waitForResponse(sendResponse);

    expect(response).toMatchObject({ success: false, ok: false });
    expect(String(response.message)).toContain('refresh_token 已过期');
    expect(String(response.message)).toContain('请重新授权');

    // 失败原因应写回队列，供 UI 失败页展示
    const state = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as {
      items: Record<string, { copies: Record<string, { status: string; error?: string }> }>;
    };
    const copy = state.items['HBAD-720'].copies['115:file-1'];
    expect(copy.status).toBe('failed');
    expect(copy.error).toContain('refresh_token 已过期');
  });

  it('token 有效但 open API 返回无删除权限 → API 错误消息透传', async () => {
    seed115OnlyState();
    mockValidToken();
    mockFetchWith({ state: false, message: 'no permission' }, {});

    const sendResponse = vi.fn();
    handleMediaCleanupDeleteCopy(
      { type: 'MEDIA_CLEANUP_DELETE_COPY', titleId: 'HBAD-720', copyId: '115:file-1' },
      sendResponse,
    );
    const response = await waitForResponse(sendResponse);

    expect(response).toMatchObject({ success: false, ok: false });
    expect(String(response.message)).not.toBe('');

    const state = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as {
      items: Record<string, { copies: Record<string, { status: string; error?: string }> }>;
    };
    expect(state.items['HBAD-720'].copies['115:file-1']).toMatchObject({
      status: 'failed',
      error: String(response.message),
    });
  });

  it('open API 成功 → 副本标记 deleted 并进入删除历史', async () => {
    seed115OnlyState();
    mockValidToken();
    mockFetchWith({ state: true }, {});

    const sendResponse = vi.fn();
    handleMediaCleanupDeleteCopy(
      { type: 'MEDIA_CLEANUP_DELETE_COPY', titleId: 'HBAD-720', copyId: '115:file-1' },
      sendResponse,
    );
    const response = await waitForResponse(sendResponse);

    expect(response).toMatchObject({ success: true, ok: true });

    const state = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as {
      items: Record<string, { copies: Record<string, { status: string }> }>;
    };
    expect(state.items['HBAD-720'].copies['115:file-1'].status).toBe('deleted');

    const history = storageMock.values.get(STORAGE_KEYS.MEDIA_DELETION_HISTORY) as {
      records: Record<string, { copyId: string }>;
    };
    expect(Object.values(history.records).some((r) => r.copyId === '115:file-1')).toBe(true);
  });

  it('fetch 网络异常（无 chrome 代理路径）→ 网络错误透传而不是空消息', async () => {
    seed115OnlyState();
    mockValidToken();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const sendResponse = vi.fn();
    handleMediaCleanupDeleteCopy(
      { type: 'MEDIA_CLEANUP_DELETE_COPY', titleId: 'HBAD-720', copyId: '115:file-1' },
      sendResponse,
    );
    const response = await waitForResponse(sendResponse);

    expect(response).toMatchObject({ success: false, ok: false });
    // 网络异常现由 friendlyRequestError 统一翻译成可读文案（而非英文原始提示）
    expect(String(response.message)).toBe('网络异常，无法连接 115 服务，请稍后重试');
  });
});
