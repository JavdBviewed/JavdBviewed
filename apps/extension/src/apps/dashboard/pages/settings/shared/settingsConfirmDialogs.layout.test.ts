/**
 * @file settingsConfirmDialogs.layout.test.ts
 * @description 设置 React 页面确认交互规范回归测试
 * @module apps/dashboard/pages/settings/shared
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const settingsRoot = dirname(fileURLToPath(import.meta.url));
const sourceFiles = [
  '../ai/AISettingsPage.tsx',
  '../cloud/CloudSettingsPage.tsx',
  '../globalActions/globalActionsActions.ts',
  '../networkTest/NetworkTestSettingsPage.tsx',
  '../privacy/privacySettingsActions.ts',
  '../webdav/WebdavSettingsPage.tsx',
].map((relativePath) => readFileSync(join(settingsRoot, relativePath), 'utf8'));

describe('settings confirmation dialogs', () => {
  it('does not leave native confirm calls in React settings flows', () => {
    for (const source of sourceFiles) {
      expect(source).not.toMatch(/(?:window\.)?confirm\s*\(/);
    }
  });
});
