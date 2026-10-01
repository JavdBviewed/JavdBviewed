/**
 * @file embyServerFormParity.dom.test.tsx
 * @description 新增/编辑媒体服务器两表单交叉锁：字段顺序、label、placeholder 逐字一致
 * @module tests/dom
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MediaServerCreateRow,
  MediaServerRow,
} from '../../apps/extension/src/apps/dashboard/pages/settings/emby/EmbySettingsPage';
import { createEmptyMediaServerDraft } from '../../apps/extension/src/apps/dashboard/pages/settings/emby/embySettingsModel';
import type { EmbyMediaServer } from '../../apps/extension/src/features/embyLibrary/types';

/** 两表单共用的字段顺序（用户裁决：类型 → 名称 → 服务器地址 → API Key → 用户登录盒 → 启用） */
const CANONICAL_FIELD_ORDER = [
  '类型',
  '名称',
  '服务器地址',
  'API Key',
  '用户名',
  '密码',
  '启用',
];

/** 两表单逐字一致的 placeholder（label → placeholder） */
const CANONICAL_PLACEHOLDERS: Record<string, string> = {
  名称: '主服务器',
  服务器地址: 'http://192.168.1.10:8096',
  'API Key': '扫库/只读用 API Key',
  用户名: '媒体服务器用户名',
  密码: '用于登录并保存到此来源',
};

type FieldEntry = { label: string; placeholder: string };

let host: HTMLDivElement;
let root: Root | undefined;

function fieldsInDomOrder(): FieldEntry[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(
      '[data-ui-pattern="setting-field"], [data-ui-pattern="setting-toggle-row"]',
    ),
  ).map((el) => {
    const label = el.querySelector('label')?.textContent?.trim() ?? '';
    const control = el.querySelector<HTMLInputElement | HTMLSelectElement>('input, select, textarea');
    return { label, placeholder: control?.placeholder ?? '' };
  });
}

function renderInto(element: ReactElement): void {
  if (root) flushSync(() => root.unmount());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(element);
  });
}

function mountCreate(draft: EmbyMediaServer): void {
  renderInto(
    createElement(MediaServerCreateRow, {
      draft,
      onChange: vi.fn(),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    }),
  );
}

function mountEdit(server: EmbyMediaServer): void {
  renderInto(
    createElement(MediaServerRow, {
      server,
      index: 0,
      onChange: vi.fn(),
      onRemove: vi.fn(),
      onLoginSuccess: async () => ({ ok: true }),
      onLogout: vi.fn(),
    }),
  );
}

function byLabel(entries: FieldEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) map[entry.label] = entry.placeholder;
  return map;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) flushSync(() => root.unmount());
  host?.remove();
});

describe('Emby 媒体服务器两表单一致性', () => {
  it('新增表单按统一顺序渲染字段', () => {
    mountCreate(createEmptyMediaServerDraft());
    expect(fieldsInDomOrder().map((f) => f.label)).toEqual(CANONICAL_FIELD_ORDER);
  });

  it('编辑表单按统一顺序渲染字段', () => {
    mountEdit(createEmptyMediaServerDraft());
    expect(fieldsInDomOrder().map((f) => f.label)).toEqual(CANONICAL_FIELD_ORDER);
  });

  it('两表单 label 与 placeholder 逐字一致', () => {
    mountCreate(createEmptyMediaServerDraft());
    const createMap = byLabel(fieldsInDomOrder());
    mountEdit(createEmptyMediaServerDraft());
    const editMap = byLabel(fieldsInDomOrder());

    for (const [label, placeholder] of Object.entries(CANONICAL_PLACEHOLDERS)) {
      expect(createMap[label], `新增/${label}`).toBe(placeholder);
      expect(editMap[label], `编辑/${label}`).toBe(placeholder);
    }
    expect(createMap).toEqual(editMap);
  });

  it('两表单都含用户登录盒，且能力提示盒各只保留一份并在盒内', () => {
    mountCreate(createEmptyMediaServerDraft());
    const createBox = host.querySelector('.emby-server-user-auth');
    expect(createBox).not.toBeNull();
    expect(host.querySelectorAll('.emby-server-user-auth').length).toBe(1);
    expect(createBox?.querySelector('.emby-create-server-credential-hint')).not.toBeNull();
    expect(host.querySelectorAll('.emby-create-server-credential-hint').length).toBe(1);

    mountEdit(createEmptyMediaServerDraft());
    const editBox = host.querySelector('.emby-server-user-auth');
    expect(editBox).not.toBeNull();
    expect(host.querySelectorAll('.emby-server-user-auth').length).toBe(1);
    expect(editBox?.querySelector('.emby-server-credential-hint')).not.toBeNull();
    expect(host.querySelectorAll('.emby-server-credential-hint').length).toBe(1);
  });
});
