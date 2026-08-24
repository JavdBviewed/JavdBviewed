/**
 * @file settingsSaveEffects.layout.test.ts
 * @description 防止 React 19 updater 内执行设置保存副作用
 * @module apps/dashboard/pages/settings/shared
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const settingsRoot = join(here, '..');
const pageFiles = [
  'display/DisplaySettingsPage.tsx',
  'searchEngine/SearchEngineSettingsPage.tsx',
  'ai/AISettingsPage.tsx',
  'privacy/PrivacySettingsPage.tsx',
  'webdav/WebdavSettingsPage.tsx',
  'sync/SyncSettingsPage.tsx',
  'insights/InsightsSettingsPage.tsx',
  'log/LogSettingsPage.tsx',
  'advanced/AdvancedSettingsPage.tsx',
  'networkTest/NetworkTestSettingsPage.tsx',
  'globalActions/GlobalActionsPage.tsx',
  'enhancement/EnhancementSettingsPage.tsx',
  'emby/EmbySettingsPage.tsx',
  'drive115/Drive115SettingsPage.tsx',
];

describe('React settings save side effects', () => {
  it('does not schedule or flush persistence from a setForm updater', () => {
    for (const relativePath of pageFiles) {
      const source = readFileSync(join(settingsRoot, relativePath), 'utf8');
      const lines = source.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].includes('setForm((prev)')) continue;
        const updaterWindow = lines.slice(index, index + 16).join('\n');
        expect(updaterWindow, relativePath).not.toMatch(/\b(scheduleSave|flush(?:ConversationSave)?)\s*\(/);
      }
    }
  });
});
