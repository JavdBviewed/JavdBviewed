/**
 * @file embySettingsPage.layout.test.ts
 * @description Emby/Jellyfin 设置页布局回归测试
 * @module apps/dashboard/pages/settings/emby
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'EmbySettingsPage.tsx'), 'utf8');
const reactFullSource = readFileSync(join(here, '..', 'shared', 'reactFullPageIds.ts'), 'utf8');
const mountSource = readFileSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'mount.ts'), 'utf8');
const legacySettingsSource = readFileSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'settings', 'index.ts'), 'utf8');
const legacyEmbySource = readFileSync(
  join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'settings', 'emby', 'EmbySettings.ts'),
  'utf8',
);

describe('EmbySettingsPage media server layout', () => {
  it('routes emby settings to the React full page so summary rows are actually used', () => {
    expect(reactFullSource).toContain("'emby-settings'");
    expect(mountSource).toContain('mountEmbySettingsPage');
    expect(legacySettingsSource).toContain('isReactFullSettingsPage');
    for (const pageId of ['cloud-settings', 'drive115-settings', 'emby-settings']) {
      expect(reactFullSource).toContain(`'${pageId}'`);
    }
  });

  it('renders media servers as compact summary rows', () => {
    expect(pageSource).toContain('MediaServerSummaryRow');
    expect(pageSource).toContain('emby-media-server-summary');
    expect(pageSource).not.toMatch(/form.mediaServers.map[sS]{0,700}<MediaServerRow/);
  });

  it('moves server creation and editing into dialogs', () => {
    expect(pageSource).toContain('MediaServerCreateDialog');
    expect(pageSource).toContain('MediaServerEditDialog');
    expect(pageSource).toContain('emby-server-create-modal');
    expect(pageSource).toContain('emby-server-edit-modal');
  });

  it('uses a wide server dialog and icon-only secret visibility controls', () => {
    expect(pageSource).toContain('max-w-[96rem]');
    expect(pageSource).toContain("visible ? 'fas fa-eye-slash' : 'fas fa-eye'");
    expect(pageSource).toContain('aria-pressed={visible}');
    expect(pageSource).toContain('absolute right-1 top-1/2');
    expect(pageSource).not.toContain("{visible ? '隐藏' : '显示'}");
  });

  it('edits and persists the saved source password instead of treating it as session-only input', () => {
    expect(pageSource).toContain('password: server.password');
    expect(pageSource).toContain('value={server.password || \'\'}');
    expect(pageSource).toContain('onChange={(value) => onChange({ password: value })}');
    expect(pageSource).toContain('用户名和密码会随来源配置保存');
    expect(pageSource).not.toContain('仅用于本次登录，不会写入设置');
    expect(pageSource).not.toContain("const [loginPassword, setLoginPassword] = useState('')");
    expect(pageSource).not.toContain("setLoginPassword('')");
  });

  it('waits for source credential persistence before reporting login success', () => {
    expect(pageSource).toContain('const saved = await onLoginSuccess({');
    expect(pageSource).toContain("password: server.password || ''");
    expect(pageSource).toContain("if (!saved.ok)");
    expect(pageSource).toContain('来源凭据与访问令牌已保存');
  });

  it('keeps the saved password in the legacy fallback editor', () => {
    expect(legacyEmbySource).toContain("value=\"${this.escapeHtml(server.password || '')}\"");
    expect(legacyEmbySource).toContain('password: server.password ? String(server.password) : undefined');
    expect(legacyEmbySource).toContain("const password = item.querySelector<HTMLInputElement>('.emby-server-password')?.value || undefined");
    expect(legacyEmbySource).toContain('password: password ?? existing?.password');
    expect(legacyEmbySource).not.toContain('if (pwd) pwd.value = \'\'');
    expect(legacyEmbySource).not.toContain('密码仅用于本次登录请求，不会写入设置');
  });

  it('uses the shared highlight notice style for the beta warning', () => {
    expect(pageSource).toContain('SettingsHighlightNotice');
    expect(pageSource).toContain('Emby/Jellyfin 功能仍在测试中');
    expect(pageSource).toContain('GitHub Issues');
    expect(pageSource).toContain('https://github.com/JavdBviewed/JavdBviewed/issues');
    expect(pageSource).not.toContain('mx-2 mb-2 flex items-start gap-2 rounded-[var(--radius-2)]');
  });

  it('offers safe source deletion from both the summary and editor', () => {
    expect(pageSource).toContain('MediaServerDeleteConfirmDialog');
    expect(pageSource).toContain('onRemove={() => requestRemoveServer(index)}');
    expect(pageSource).toMatch(/function MediaServerSummaryRow[\s\S]+?onClick=\{onRemove\}/);
    expect(pageSource).toContain('确认删除媒体服务器');
    expect(pageSource).toContain('不会删除本地媒体索引，也不会删除服务器中的影片文件');
    expect(pageSource).not.toContain('window.confirm');
  });

  it('persists a confirmed deletion before closing its dialogs', () => {
    expect(pageSource).toContain('await flush(formRef.current)');
    expect(pageSource).toContain('await persistEmbyForm(nextForm)');
    expect(pageSource).toContain('setDeleteTarget(null)');
    expect(pageSource).toContain('setEditingServerIndex(null)');
  });

  it('asks for confirmation and feedback on extra match address mutations', () => {
    expect(pageSource).toContain('import { showConfirm }');
    expect(pageSource).toContain('const confirmed = await showConfirm({');
    expect(pageSource).toContain('删除匹配地址');
    expect(pageSource).toContain('添加额外匹配地址');
    expect(pageSource).toContain('disabled={!recognitionEnabled || isDraft}');
    expect(pageSource).toContain('匹配地址已删除');
    expect(pageSource).toContain('已添加一行，请填写地址');
    expect(pageSource).toContain("toast('设置已保存', 'success')");
    expect(pageSource).toContain('留空不会保存');
  });

  it('restores the in-page section quick-nav for the split Emby page', () => {
    // 快速导航统一由共享外框 SettingsPageFrame 渲染（单一导航，不再页面内手动嵌套）。
    expect(pageSource).toContain('SettingsPageFrame');
    expect(pageSource).toContain('sectionNavItems={sectionNavItems}');
    expect(pageSource).not.toContain('SettingsSectionNavLayout');
    for (const id of [
      'emby-nav-media-server',
      'emby-nav-recognition',
      'emby-nav-link-behavior',
      'emby-nav-quick-actions',
      'emby-nav-library-status',
    ]) {
      expect(pageSource).toContain(id);
    }
  });

  it('keeps source management available when the global enhancement is disabled', () => {
    expect(pageSource).toContain('<MediaServerSummaryRow');
    expect(pageSource).not.toMatch(/<MediaServerSummaryRow[\s\S]{0,240}disabled=\{!enabled\}/);
    expect(pageSource).not.toMatch(/<MediaServerCreateDialog[\s\S]{0,180}disabled=\{!enabled\}/);
    expect(pageSource).not.toMatch(/<MediaServerEditDialog[\s\S]{0,220}disabled=\{!enabled\}/);
    expect(pageSource).not.toMatch(/id="add-emby-media-server"[\s\S]{0,160}disabled=\{!enabled\}/);
  });
});
