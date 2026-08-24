/**
 * @file settingsSectionIcons.layout.test.ts
 * @description 设置子页区块图标与 legacy partial 的映射回归
 * @module apps/dashboard/pages/settings/shared
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const source = (page: string) =>
  readFileSync(join(here, '..', page), 'utf8');

const sharedSource = (file: string) =>
  readFileSync(join(here, '..', file), 'utf8');

describe('settings section icon fidelity', () => {
  const cases = [
    ['ai/AISettingsPage.tsx', ['fa-cog', 'fa-brain', 'fa-vial', 'fa-tools']],
    ['privacy/PrivacySettingsPage.tsx', ['fa-camera', 'fa-lock', 'fa-life-ring']],
    ['sync/SyncSettingsPage.tsx', ['fa-video', 'fa-users', 'fa-cog', 'fa-vial']],
    ['log/LogSettingsPage.tsx', ['fa-sliders-h', 'fa-paint-brush', 'fa-th-large', 'fa-cogs']],
    ['networkTest/NetworkTestSettingsPage.tsx', ['fa-rocket', 'fa-route', 'fa-edit']],
    ['webdav/WebdavSettingsPage.tsx', ['fa-server', 'fa-laptop-house', 'fa-users', 'fa-cog', 'fa-database']],
    ['update/UpdateSettingsPage.tsx', ['fa-sync-alt', 'fa-cog', 'fa-info-circle', 'fa-code-branch']],
  ] as const;

  it.each(cases)('keeps legacy icons in %s', (page, icons) => {
    const pageSource = source(page);
    for (const icon of icons) {
      expect(pageSource).toContain(`className="fas ${icon}"`);
    }
  });

  it('uses icon buttons for shared back navigation and legacy help hints', () => {
    expect(sharedSource('shared/settingsPageFrame.tsx')).toContain('fas fa-arrow-left');
    expect(sharedSource('SettingsSubpageShell.tsx')).toContain('fas fa-arrow-left');
    expect(source('insights/InsightsSettingsPage.tsx')).toContain('InsightsLabel');
    expect(source('insights/InsightsSettingsPage.tsx')).toContain('fas fa-question-circle');
  });

  it('keeps icons on high-frequency action buttons', () => {
    const expectButtonIcon = (page: string, id: string, icon: string): void => {
      const pageSource = source(page);
      expect(pageSource).toMatch(
        new RegExp(`id="${id}"[\\s\\S]{0,500}fa-${icon}`),
      );
    };

    expectButtonIcon('webdav/WebdavSettingsPage.tsx', 'testWebdavConfigModal', 'plug');
    expectButtonIcon('webdav/WebdavSettingsPage.tsx', 'modalToggleWebdavPasswordVisibility', 'eye');
    expectButtonIcon('webdav/WebdavSettingsPage.tsx', 'modalCopyWebdavFullUrl', 'copy');
    expectButtonIcon('webdav/WebdavSettingsPage.tsx', 'refreshWebdavClients', 'rotate-right');
    expect(source('emby/EmbySettingsPage.tsx')).toMatch(
      /title="确认删除媒体服务器"[\s\S]{0,700}fa-trash/,
    );
    expectButtonIcon('privacy/PrivacySettingsPage.tsx', 'setupSecurityQuestionsBtn', 'cog');
    expectButtonIcon('privacy/PrivacySettingsPage.tsx', 'generateBackupCodeBtn', 'key');
    expectButtonIcon('enhancement/EnhancementSettingsPage.tsx', 'showOrchestratorBtn', 'project-diagram');
    expectButtonIcon('enhancement/EnhancementSettingsPage.tsx', 'saveFilterRuleBtn', 'save');
  });
});
