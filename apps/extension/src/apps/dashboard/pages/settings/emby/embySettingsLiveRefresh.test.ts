/**
 * @file embySettingsLiveRefresh.test.ts
 * @description Emby/Jellyfin 设置页跨设备变更实时刷新：外部变更判定纯函数单测
 *              （canonical 键序无关等价 + skip/defer/apply 三态 + removedIds 过滤）
 * @module apps/dashboard/pages/settings/emby
 */
import { describe, expect, it } from 'vitest';
import type { EmbyMediaServer } from '../../../../../features/embyLibrary/types';
import {
  canonicalEmbyFormJson,
  DEFAULT_EMBY_SETTINGS_FORM,
  resolveEmbyFormExternalChange,
  type EmbySettingsFormState,
} from './embySettingsModel';

function makeServer(overrides: Partial<EmbyMediaServer>): EmbyMediaServer {
  return {
    id: overrides.id ?? 'srv-a',
    type: 'emby',
    name: overrides.name ?? 'Server A',
    url: overrides.url ?? 'http://localhost:8096',
    apiKey: overrides.apiKey ?? 'key-a',
    enabled: overrides.enabled ?? true,
  };
}

function baseForm(): EmbySettingsFormState {
  return {
    ...DEFAULT_EMBY_SETTINGS_FORM,
    mediaServers: [makeServer({ id: 'srv-a' })],
  };
}

describe('canonicalEmbyFormJson', () => {
  it('is key-order insensitive for equal forms', () => {
    const a = baseForm();
    // 顶层键序 + 服务器元素键序 + 嵌套 highlightStyle 键序三重扰动，同值必须同串
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
          out[key] = reorder((value as Record<string, unknown>)[key]);
        }
        return out;
      }
      return value;
    };
    const b = reorder(a) as EmbySettingsFormState;
    expect(canonicalEmbyFormJson(a)).toBe(canonicalEmbyFormJson(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('differs when any value differs (including nested server fields)', () => {
    const a = baseForm();
    const b: EmbySettingsFormState = {
      ...a,
      mediaServers: [makeServer({ id: 'srv-a', apiKey: 'key-a-rotated' })],
    };
    expect(canonicalEmbyFormJson(a)).not.toBe(canonicalEmbyFormJson(b));
  });
});

describe('resolveEmbyFormExternalChange', () => {
  it('skips when incoming is equivalent to current (self-save echo guard)', () => {
    const current = baseForm();
    // 键序扰动但同值 → 仍必须 skip（自存回显）
    const incoming: EmbySettingsFormState = {
      ...current,
      mediaServers: current.mediaServers.map((s) => ({ ...s })),
    };
    const decision = resolveEmbyFormExternalChange({
      currentForm: current,
      incoming,
      editing: false,
      dirty: false,
      removedIds: new Set(),
    });
    expect(decision).toEqual({ action: 'skip' });
  });

  it('applies when clean and incoming adds a remote server', () => {
    const current = baseForm();
    const incoming: EmbySettingsFormState = {
      ...current,
      mediaServers: [
        makeServer({ id: 'srv-a' }),
        makeServer({ id: 'srv-b', name: 'Server B', url: 'http://remote:8096', apiKey: 'key-b' }),
      ],
    };
    const decision = resolveEmbyFormExternalChange({
      currentForm: current,
      incoming,
      editing: false,
      dirty: false,
      removedIds: new Set(),
    });
    expect(decision.action).toBe('apply');
    if (decision.action !== 'apply') return;
    expect(decision.snapshot.mediaServers.map((s) => s.id)).toEqual(['srv-a', 'srv-b']);
  });

  it('defers while editing (dialog open) without dropping the remote change', () => {
    const current = baseForm();
    const incoming: EmbySettingsFormState = {
      ...current,
      mediaServers: [
        makeServer({ id: 'srv-a' }),
        makeServer({ id: 'srv-b', name: 'Server B' }),
      ],
    };
    const decision = resolveEmbyFormExternalChange({
      currentForm: current,
      incoming,
      editing: true,
      dirty: false,
      removedIds: new Set(),
    });
    expect(decision.action).toBe('defer');
    if (decision.action !== 'defer') return;
    expect(decision.snapshot.mediaServers.map((s) => s.id)).toEqual(['srv-a', 'srv-b']);
  });

  it('defers while dirty even when no dialog is open', () => {
    const current = baseForm();
    const incoming: EmbySettingsFormState = {
      ...current,
      syncIntervalMinutes: 30,
    };
    const decision = resolveEmbyFormExternalChange({
      currentForm: current,
      incoming,
      editing: false,
      dirty: true,
      removedIds: new Set(),
    });
    expect(decision.action).toBe('defer');
  });

  it('still skips when equivalent even while editing (echo must not defer)', () => {
    const current = baseForm();
    const incoming: EmbySettingsFormState = { ...current };
    const decision = resolveEmbyFormExternalChange({
      currentForm: current,
      incoming,
      editing: true,
      dirty: false,
      removedIds: new Set(),
    });
    expect(decision).toEqual({ action: 'skip' });
  });

  it('filters out servers removed in this session from the incoming snapshot', () => {
    const current = baseForm();
    // 本会话已删除 srv-a（不在 current 中），但远端写入早于删除、其快照仍含 srv-a
    const incoming: EmbySettingsFormState = {
      ...current,
      mediaServers: [
        makeServer({ id: 'srv-a', name: 'Server A' }),
        makeServer({ id: 'srv-b', name: 'Server B' }),
      ],
    };
    const decision = resolveEmbyFormExternalChange({
      currentForm: current,
      incoming,
      editing: false,
      dirty: false,
      removedIds: new Set(['srv-a']),
    });
    expect(decision.action).toBe('apply');
    if (decision.action !== 'apply') return;
    expect(decision.snapshot.mediaServers.map((s) => s.id)).toEqual(['srv-b']);
  });

  it('skips when the only diff is a session-removed server (no phantom defer)', () => {
    // 本会话已删除 srv-a（current 已不含）；远端写入早于删除、其快照仍含 srv-a
    const current: EmbySettingsFormState = {
      ...baseForm(),
      mediaServers: [makeServer({ id: 'srv-b', name: 'Server B' })],
    };
    const incoming: EmbySettingsFormState = {
      ...current,
      mediaServers: [
        makeServer({ id: 'srv-a', name: 'Server A' }),
        makeServer({ id: 'srv-b', name: 'Server B' }),
      ],
    };
    const decision = resolveEmbyFormExternalChange({
      currentForm: current,
      incoming,
      editing: false,
      dirty: false,
      removedIds: new Set(['srv-a']),
    });
    expect(decision).toEqual({ action: 'skip' });
  });
});
