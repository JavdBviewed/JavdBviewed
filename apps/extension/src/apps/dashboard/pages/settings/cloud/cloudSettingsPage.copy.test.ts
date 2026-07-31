/**
 * @file cloudSettingsPage.copy.test.ts
 * @description 云同步设置页文案回归测试
 * @module apps/dashboard/pages/settings/cloud
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'CloudSettingsPage.tsx'), 'utf8');
const styleSource = readFileSync(join(here, 'cloudSettings.css'), 'utf8');
const frameSource = readFileSync(join(here, '..', 'shared', 'settingsPageFrame.tsx'), 'utf8');

describe('CloudSettingsPage copy', () => {
  it('does not show the default bootstrap account hint', () => {
    expect(pageSource).not.toContain('默认引导账号');
    expect(pageSource).not.toContain('用户名 <code');
    expect(pageSource).not.toContain('CLOUD_ADMIN_PASSWORD');
  });

  it('shows the device id without a toggle', () => {
    expect(pageSource).not.toContain('showDeviceId');
    expect(pageSource).not.toContain('显示设备 ID');
    expect(pageSource).not.toContain('隐藏设备 ID');
  });

  it('uses an inline eye icon for password visibility', () => {
    expect(pageSource).toContain("aria-label={props.showPassword ? '隐藏密码' : '显示密码'}");
    expect(pageSource).toContain('fa-eye-slash');
    expect(pageSource).toContain('fa-eye');
    expect(pageSource).not.toContain("{showPassword ? '隐藏' : '显示'}");
  });

  it('uses the shared wide settings page frame instead of a page-level width patch', () => {
    expect(frameSource).toContain('max-w-[1200px]');
    expect(frameSource).not.toContain('max-w-3xl');
    expect(styleSource).not.toContain('[data-cloud-settings-react] > .mx-auto');
  });

  it('uses the shared section navigation with stable Cloud anchors', () => {
    expect(pageSource).toContain('CLOUD_SECTION_NAV_ITEMS');
    expect(pageSource).toContain('sectionNavItems={CLOUD_SECTION_NAV_ITEMS}');
    expect(pageSource).toContain('cloud-section-overview');
    expect(pageSource).toContain('cloud-section-connection');
    expect(pageSource).toContain('cloud-section-devices');
    expect(pageSource).toContain('cloud-section-scope');
    expect(pageSource).not.toContain("{ id: CLOUD_SECTION_IDS.account, label: '账号'");
  });

  it('uses the shared highlight notice block with an issue feedback entry', () => {
    const sharedStyleSource = readFileSync(
      join(here, '..', 'shared', 'settingsHighlightNotice.css'),
      'utf8',
    );
    expect(pageSource).toContain('SettingsHighlightNotice');
    expect(pageSource).toContain('功能仍在测试中');
    expect(pageSource).toContain('GitHub Issues');
    expect(pageSource).toContain('https://github.com/lmixture/JavdBviewed/issues');
    expect(styleSource).not.toContain('.cloud-beta-notice');
    expect(sharedStyleSource).toContain('.settings-highlight-notice');
  });

  it('shows the current Cloud connection as a single source summary', () => {
    expect(pageSource).toContain('CloudConnectionSummary');
    expect(pageSource).toContain('cloud-connection-summary');
    expect(pageSource).toContain('编辑连接');
    expect(pageSource).toContain('健康状态');
    expect(pageSource).toContain('登录状态');
    expect(pageSource).toContain('本机设备名');
  });

  it('moves connection fields and actions into an edit dialog', () => {
    expect(pageSource).toContain('CloudConnectionEditDialog');
    expect(pageSource).toContain('cloud-connection-edit-modal');
    expect(pageSource).toContain("title=\"连接服务\"");
    expect(pageSource).toContain('id="cloud-base-url"');
    expect(pageSource).toContain('id="cloud-device-label"');
    expect(pageSource).toContain('保存连接');
    expect(pageSource).toContain('测试连接');
  });

  it('keeps account sign-in inside the connection editor instead of a separate page section', () => {
    expect(pageSource).toContain('title="连接服务"');
    expect(pageSource).toContain('账号与会话');
    expect(pageSource).toContain('cloud-identifier');
    expect(pageSource).toContain('cloud-password');
    expect(pageSource).not.toContain('{/* 账号 */}');
  });

  it('restores saved account credentials into the connection editor and saves edits', () => {
    expect(pageSource).toContain('setIdentifier(state.settings.accountIdentifier || \'\')');
    expect(pageSource).toContain('setPassword(state.settings.accountPassword || \'\')');
    expect(pageSource).toContain('identifier: identifier.trim()');
    expect(pageSource).toContain('password,');
    expect(pageSource).toContain('已保存账号，登录后即可同步');
  });

  it('places manual sync on the connection summary and reports its lifecycle in a dialog', () => {
    expect(pageSource).toContain('立即同步');
    expect(pageSource).toContain("props.loggedIn ? '立即同步' : '登录后同步'");
    expect(pageSource).toContain('onSync={onSyncNow}');
    expect(pageSource).toContain('CloudSyncProgressDialog');
    expect(pageSource).toContain('正在整理本机数据');
    expect(pageSource).toContain('正在与 Cloud 服务同步并合并数据');
    expect(pageSource).toContain('同步失败');
    expect(pageSource).toContain('重试同步');
  });

  it('keeps the existing single CloudConnectionSettings contract', () => {
    expect(pageSource).toContain('useState<CloudConnectionSettings | null>');
    expect(pageSource).not.toContain('CloudConnectionSettings[]');
  });
});
