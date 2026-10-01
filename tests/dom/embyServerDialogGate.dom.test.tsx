/**
 * @file embyServerDialogGate.dom.test.tsx
 * @description 媒体服务器新增/编辑弹窗：480px 单列、footer 固定按钮条、编辑关闭门禁（完成/×/Esc）
 * @module tests/dom
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MediaServerCreateDialog,
  MediaServerEditDialog,
} from '../../apps/extension/src/apps/dashboard/pages/settings/emby/EmbySettingsPage';
import { createEmptyMediaServerDraft } from '../../apps/extension/src/apps/dashboard/pages/settings/emby/embySettingsModel';
import type { EmbyMediaServer } from '../../apps/extension/src/features/embyLibrary/types';

let host: HTMLDivElement;
let root: Root | undefined;

function renderInto(element: ReactElement): void {
  if (root) flushSync(() => root.unmount());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(element);
  });
}

function dialog(className: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.${className}`);
  expect(el, className).not.toBeNull();
  return el as HTMLElement;
}

function click(el: Element | null, label: string): void {
  expect(el, label).not.toBeNull();
  act(() => {
    (el as HTMLElement).click();
  });
}

function setInputValue(el: Element | null, value: string, label: string): void {
  expect(el, label).not.toBeNull();
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressKey(el: Element | null, key: string, label: string): void {
  expect(el, label).not.toBeNull();
  act(() => {
    el!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function pressDocumentKey(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function server(patch: Partial<EmbyMediaServer> = {}): EmbyMediaServer {
  return {
    ...createEmptyMediaServerDraft(),
    id: 'srv-1',
    name: '家庭库',
    url: 'http://192.168.1.5:8096',
    apiKey: 'key-1',
    enabled: true,
    ...patch,
  };
}

function mountCreate(draft: EmbyMediaServer, spies: {
  onChange?: (draft: EmbyMediaServer) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
} = {}) {
  renderInto(
    createElement(MediaServerCreateDialog, {
      draft,
      onChange: spies.onChange ?? vi.fn(),
      onConfirm: spies.onConfirm ?? vi.fn(),
      onCancel: spies.onCancel ?? vi.fn(),
    }),
  );
}

function mountEdit(srv: EmbyMediaServer, spies: {
  onClose?: () => void;
  onChange?: (index: number, patch: Partial<EmbyMediaServer>) => void;
} = {}) {
  renderInto(
    createElement(MediaServerEditDialog, {
      server: srv,
      index: 0,
      onClose: spies.onClose ?? vi.fn(),
      onChange: spies.onChange ?? vi.fn(),
      onRemove: vi.fn(),
      onLoginSuccess: async () => ({ ok: true }),
      onLogout: vi.fn(),
    }),
  );
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) flushSync(() => root.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

describe('Emby 媒体服务器弹窗几何与按钮条', () => {
  it('新增弹窗=480px 单列 + footer 固定按钮条（取消在前、确认在后，均不在滚动 body 内）', () => {
    mountCreate(server());
    const box = dialog('emby-server-create-modal');
    expect(box.className).toContain('max-w-[30rem]');
    expect(box.className).not.toContain('96rem');

    const body = box.querySelector('.ui-modal__body');
    const footer = box.querySelector('.ui-modal__footer');
    expect(footer).not.toBeNull();
    expect(body).not.toBeNull();
    expect(body!.querySelector('.emby-server-form-body')?.className).toContain('grid-cols-1');
    expect(Array.from(footer!.querySelectorAll('button')).map((b) =>
      b.classList.contains('create-emby-media-server-cancel') ? 'cancel' :
      b.classList.contains('create-emby-media-server-confirm') ? 'confirm' : 'other',
    )).toEqual(['cancel', 'confirm']);
    expect(body!.querySelector('.create-emby-media-server-confirm')).toBeNull();
    expect(body!.querySelector('.create-emby-media-server-cancel')).toBeNull();

    const onCancel = vi.fn();
    mountCreate(server(), { onCancel });
    click(dialog('emby-server-create-modal').querySelector('.create-emby-media-server-cancel'), '取消');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('编辑弹窗=480px 单列 + footer 左删除右完成', () => {
    mountEdit(server());
    const box = dialog('emby-server-edit-modal');
    expect(box.className).toContain('max-w-[30rem]');
    expect(box.className).not.toContain('96rem');
    const body = box.querySelector('.ui-modal__body');
    const footer = box.querySelector('.ui-modal__footer');
    expect(body!.querySelector('.emby-server-form-body')?.className).toContain('grid-cols-1');
    expect(Array.from(footer!.querySelectorAll('button')).map((b) =>
      b.classList.contains('remove-emby-media-server') ? 'remove' :
      b.classList.contains('emby-server-edit-done') ? 'done' : 'other',
    )).toEqual(['remove', 'done']);
    expect(footer!.querySelector('.remove-emby-media-server')?.className).toContain('mr-auto');
    expect(body!.querySelector('.remove-emby-media-server')).toBeNull();
  });
});

describe('Emby 编辑弹窗关闭门禁', () => {
  it('启用且无凭据时点完成不关闭，并在凭据位置给红字与出路提示', () => {
    const onClose = vi.fn();
    mountEdit(server({ apiKey: '', username: '', password: '' }), { onClose });
    const box = dialog('emby-server-edit-modal');
    click(box.querySelector('.emby-server-edit-done'), '完成');
    expect(onClose).not.toHaveBeenCalled();

    const error = box.querySelector<HTMLElement>('.emby-server-gate-error[data-field="credentials"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('媒体服务器 1「家庭库」（http://192.168.1.5:8096）需要至少一种凭据');
    expect(error!.textContent).toContain('可先关闭「启用」或删除该服务器');
    expect(error!.style.fontSize).toBe('12px');
    expect(error!.closest('.emby-server-user-auth')).not.toBeNull();
  });

  it('地址非法时红字落在服务器地址字段下', () => {
    const onClose = vi.fn();
    mountEdit(server({ url: 'ftp://bad' }), { onClose });
    const box = dialog('emby-server-edit-modal');
    click(box.querySelector('.emby-server-edit-done'), '完成');
    expect(onClose).not.toHaveBeenCalled();
    const error = box.querySelector<HTMLElement>('.emby-server-gate-error[data-field="url"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('地址需要使用 http 或 https');
    expect(error!.textContent).toContain('可先关闭「启用」或删除该服务器');
    const urlField = error!.closest('[data-ui-pattern="setting-field"]');
    expect(urlField?.querySelector('label')?.textContent).toBe('服务器地址');
    // 红字与地址输入框同属一个字段容器（不是弹窗底部的通用提示条）
    expect(urlField?.contains(error!)).toBe(true);
    expect(urlField?.querySelector('.emby-server-url')).not.toBeNull();
  });

  it('补全凭据后点完成正常关闭并清掉红字', () => {
    let current = server({ apiKey: '' });
    const onClose = vi.fn();
    const onChange = (_index: number, patch: Partial<EmbyMediaServer>) => {
      current = { ...current, ...patch };
      mountEdit(current, { onClose, onChange });
    };
    mountEdit(current, { onClose, onChange });
    const box = dialog('emby-server-edit-modal');
    click(box.querySelector('.emby-server-edit-done'), '完成');
    expect(onClose).not.toHaveBeenCalled();
    expect(box.querySelector('.emby-server-gate-error')).not.toBeNull();

    setInputValue(
      dialog('emby-server-edit-modal').querySelector('#emby-server-srv-1-api-key'),
      'key-2',
      'API Key',
    );
    click(dialog('emby-server-edit-modal').querySelector('.emby-server-edit-done'), '完成');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('停用且无凭据的服务器可直接关闭', () => {
    const onClose = vi.fn();
    mountEdit(server({ enabled: false, apiKey: '', username: '', password: '' }), { onClose });
    const box = dialog('emby-server-edit-modal');
    click(box.querySelector('.emby-server-edit-done'), '完成');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(box.querySelector('.emby-server-gate-error')).toBeNull();
  });

  it('头部关闭钮与 Esc 同样走门禁', () => {
    const onClose = vi.fn();
    mountEdit(server({ apiKey: '' }), { onClose });
    click(dialog('emby-server-edit-modal').querySelector('.ui-modal__close'), '头部关闭钮');
    pressDocumentKey('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog('emby-server-edit-modal').querySelector('.emby-server-gate-error')).not.toBeNull();
  });

  it('Esc 在校验通过时关闭弹窗', () => {
    const onClose = vi.fn();
    mountEdit(server(), { onClose });
    pressDocumentKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('地址输入框回车在编辑态等同点完成（走门禁）', () => {
    const onClose = vi.fn();
    mountEdit(server({ apiKey: '' }), { onClose });
    pressKey(dialog('emby-server-edit-modal').querySelector('.emby-server-url'), 'Enter', '地址回车');
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog('emby-server-edit-modal').querySelector('.emby-server-gate-error')).not.toBeNull();

    mountEdit(server(), { onClose });
    pressKey(dialog('emby-server-edit-modal').querySelector('.emby-server-url'), 'Enter', '地址回车');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
