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
    expect(pageSource).toContain("aria-label={showPassword ? '隐藏密码' : '显示密码'}");
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
    expect(pageSource).toContain('cloud-section-sync');
    expect(pageSource).toContain('cloud-section-connection');
    expect(pageSource).toContain('cloud-section-account');
    expect(pageSource).toContain('cloud-section-devices');
    expect(pageSource).toContain('cloud-section-scope');
  });

  it('does not add a separate beta notice block above the Cloud content', () => {
    expect(pageSource).not.toContain('cloud-beta-notice');
    expect(styleSource).not.toContain('cloud-beta-notice');
  });
});
