/**
 * @file networkTestSettingsPage.layout.test.ts
 * @description 网络测试 React 页与 legacy 视觉层级的结构回归测试
 * @module apps/dashboard/pages/settings/networkTest
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'NetworkTestSettingsPage.tsx'), 'utf8');
const styleSource = readFileSync(join(here, 'networkTestSettingsPage.css'), 'utf8');

describe('NetworkTestSettingsPage layout fidelity', () => {
  it('scopes the legacy visual overrides to the React network page', () => {
    expect(pageSource).toContain("import './networkTestSettingsPage.css';");
    expect(pageSource).toContain('className="network-test-settings-react"');
    expect(styleSource).toContain('.network-test-settings-react [data-ui-pattern=\'page-header\']');
    expect(styleSource).toContain('font-size: 28px');
    expect(styleSource).toContain('border-bottom: 2px solid');
  });

  it('keeps legacy card, control, and icon-with-input dimensions', () => {
    expect(pageSource).toContain('className="network-test-section"');
    expect(pageSource).toContain('network-test-input-with-icon');
    expect(styleSource).toContain('border-radius: 8px');
    expect(styleSource).toContain('height: 42px');
    expect(styleSource).toContain('border-width: 2px');
    expect(styleSource).toContain('max-width: 400px');
    expect(styleSource).toContain('max-width: 500px');
  });

  it('keeps route, batch stats, config, and scrollable result hooks', () => {
    for (const className of [
      'network-test-route-item',
      'network-test-route-actions',
      'network-test-domain-stats',
      'network-test-domain-config',
      'network-test-batch-results',
    ]) {
      expect(pageSource).toContain(className);
      expect(styleSource).toContain(`.${className}`);
    }
    expect(styleSource).toContain('max-height: 500px');
    expect(styleSource).toContain('overflow-y: auto');
  });
});
