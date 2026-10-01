/**
 * @file embyServerCreateDialog.dom.test.tsx
 * @description Emby 设置「添加媒体服务器」弹窗（MediaServerCreateDialog）：
 * 账号/密码字段在位、凭据形态切换时功能可用性提示同步更新、确认/取消入口存在。
 * 弹窗壳（Modal Portal 到 document.body）一并挂载，确认/取消在 footer 而非滚动区。
 * @module tests/dom
 */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaServerCreateDialog } from '../../apps/extension/src/apps/dashboard/pages/settings/emby/EmbySettingsPage';
import { createEmptyMediaServerDraft } from '../../apps/extension/src/apps/dashboard/pages/settings/emby/embySettingsModel';
import type { EmbyMediaServer } from '../../apps/extension/src/features/embyLibrary/types';

let host: HTMLDivElement;
let root: Root;
let onConfirm: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;

function TestHarness({ initial, onConfirm, onCancel }: {
  initial: EmbyMediaServer;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return createElement(MediaServerCreateDialog, {
    draft,
    onChange: setDraft,
    onConfirm,
    onCancel,
  });
}

function mountRow(initial: EmbyMediaServer): void {
  act(() => {
    root.render(
      createElement(TestHarness, { initial, onConfirm, onCancel }),
    );
  });
}

function setInput(id: string, value: string): void {
  const el = document.querySelector(`#${id}`) as HTMLInputElement;
  expect(el).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function hintLines(): string[] {
  const box = document.querySelector('.emby-create-server-credential-hint');
  expect(box).not.toBeNull();
  return Array.from(box!.querySelectorAll('p')).map((p) => p.textContent || '');
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onConfirm = vi.fn();
  onCancel = vi.fn();
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe('Emby 添加媒体服务器弹窗（MediaServerCreateRow）', () => {
  it('渲染名称/地址/API Key/用户名/密码/启用与确认取消入口', () => {
    mountRow(createEmptyMediaServerDraft());
    for (const id of [
      'emby-create-server-name',
      'emby-create-server-url',
      'emby-create-server-api-key',
      'emby-create-server-username',
      'emby-create-server-password',
      'emby-create-server-enabled',
    ]) {
      expect(document.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(document.querySelector('.create-emby-media-server-confirm')).not.toBeNull();
    expect(document.querySelector('.create-emby-media-server-cancel')).not.toBeNull();
  });

  it('凭据为空时提示需至少配置一种凭据', () => {
    mountRow(createEmptyMediaServerDraft());
    expect(hintLines()[0]).toContain('请至少配置一种凭据');
  });

  it('仅 API Key 时提示写回/标记已看需用户名或登录', () => {
    mountRow(createEmptyMediaServerDraft());
    setInput('emby-create-server-api-key', 'k-123');
    expect(hintLines()[0]).toContain('仅 API Key');
    expect(hintLines()[0]).toContain('进度写回与标记已看需再配置用户名');
  });

  it('仅 用户名+密码 时提示先登录', () => {
    mountRow(createEmptyMediaServerDraft());
    setInput('emby-create-server-username', 'alice');
    setInput('emby-create-server-password', 'secret');
    expect(hintLines()[0]).toContain('仅账号+密码');
    expect(hintLines()[0]).toContain('登录并保存令牌');
  });

  it('双配时提示立即可用 + 登录后优先', () => {
    mountRow(createEmptyMediaServerDraft());
    setInput('emby-create-server-api-key', 'k-123');
    setInput('emby-create-server-username', 'alice');
    setInput('emby-create-server-password', 'secret');
    expect(hintLines()[0]).toContain('API Key + 账号密码均已配置');
    expect(hintLines()[0]).toContain('立即可用');
  });
});
