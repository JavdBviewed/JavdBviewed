/**
 * @file webdavConfigModal.layout.test.ts
 * @description WebDAV 配置编辑弹窗 legacy 结构与关键尺寸回归测试
 * @module apps/dashboard/pages/settings/webdav
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'WebdavSettingsPage.tsx'), 'utf8');
const modalSource = readFileSync(join(here, '..', '..', '..', '..', '..', 'ui', 'primitives', 'Modal', 'Modal.tsx'), 'utf8');
const webdavCss = readFileSync(
  join(here, '..', '..', '..', '..', '..', 'dashboard', 'styles', '05-pages', 'settings', 'webdav.css'),
  'utf8',
);

describe('WebDAV config modal fidelity', () => {
  it('keeps legacy field order and icon-only field actions', () => {
    expect(pageSource).toMatch(/modalConfigName[\s\S]+modalWebdavUrl[\s\S]+modalWebdavUser[\s\S]+modalWebdavPass/);
    expect(pageSource).toContain('webdav-modal-label-action');
    expect(pageSource).toContain('webdav-modal-input-action webdav-modal-copy-action');
    expect(pageSource).toContain('webdav-modal-input-action webdav-modal-toggle-action');
    expect(pageSource).not.toContain('复制地址</Button>');
    expect(pageSource).not.toContain("{passwordVisible ? '隐藏' : '显示'}");
  });

  it('keeps legacy modal dimensions, spacing, and green test action', () => {
    expect(pageSource).toContain('className="webdav-config-modal-react"');
    expect(webdavCss).toContain('max-width: 600px');
    expect(webdavCss).toContain('padding: 20px 24px');
    expect(webdavCss).toContain('padding: 24px');
    expect(webdavCss).toContain('flex: 0 0 120px');
    expect(webdavCss).toContain('flex: 0 0 150px');
    expect(webdavCss).toContain('.webdav-modal-test-button');
    expect(webdavCss).toContain('background: var(--success)');
  });

  it('uses the FontAwesome close icon in the shared modal shell', () => {
    expect(modalSource).toContain('ui-modal__close');
    expect(modalSource).toContain('fas fa-times');
    expect(modalSource).not.toContain('>\n            ✕');
  });
});
