import { STORAGE_KEYS } from '../../utils/config';
import { getSettings, getValue, saveSettings } from '../../utils/storage';
import { saveSettingsSectionDelta, type SettingsDeltaWriter } from '../../utils/settingsDelta';

export interface OpenListSettings {
  baseUrl: string;
  token: string;
  path: string;
  tool: string;
}

export const DEFAULT_OPENLIST_SETTINGS: OpenListSettings = { baseUrl: '', token: '', path: '', tool: 'aria2' };

export function normalizeOpenListSettings(raw: unknown): OpenListSettings {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const base = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : '';
  let baseUrl = '';
  try {
    const url = new URL(base);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash) {
      baseUrl = url.href.replace(/\/+$/, '');
    }
  } catch { /* Invalid endpoint stays unconfigured. */ }
  return {
    baseUrl,
    token: typeof input.token === 'string' ? input.token.trim() : '',
    path: typeof input.path === 'string' ? input.path.trim() : '',
    tool: typeof input.tool === 'string' && input.tool.trim() ? input.tool.trim() : 'aria2',
  };
}

export async function saveOpenListSettings(
  input: OpenListSettings,
  writer: SettingsDeltaWriter = {
    readRawSettings: () => getValue(STORAGE_KEYS.SETTINGS, {}),
    getMergedSettings: getSettings,
    saveSettings,
  },
): Promise<void> {
  await saveSettingsSectionDelta(writer, {}, 'openlist', () => normalizeOpenListSettings(input));
}
