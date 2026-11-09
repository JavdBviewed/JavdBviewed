/**
 * @file MediaServerDialogs.tsx
 * @description 媒体服务器草稿编辑、登录验证及库范围选择；显式保存后才生效
 * @module apps/dashboard/pages/settings/emby
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { Modal } from '../../../../../ui/primitives/Modal/Modal';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { EmbyMediaServer } from '../../../../../features/embyLibrary/types';
import { listEmbyLibraries, loginEmbyUser } from './embySettingsActions';
import {
  SERVER_TYPE_OPTIONS,
  serverCredentialCapabilityLines,
  validateMediaServerForSave,
} from './embySettingsModel';
import { MediaServerLibraryPicker } from './MediaServerLibraryPicker';

type SaveResult = { ok: boolean; error?: string };
type CreateProps = {
  draft: EmbyMediaServer | null;
  disabled?: boolean;
  onChange: (draft: EmbyMediaServer) => void;
  onConfirm: (draft: EmbyMediaServer) => Promise<SaveResult>;
  onCancel: () => void;
};
type EditProps = {
  server: EmbyMediaServer | null;
  index: number | null;
  disabled?: boolean;
  onClose: () => void;
  onSave: (index: number, server: EmbyMediaServer) => Promise<SaveResult>;
  onRemove: (index: number) => void;
};

export function MediaServerCreateDialog({
  draft,
  onConfirm,
  onCancel,
  ...props
}: CreateProps) {
  return draft ? (
    <MediaServerDialog
      key={draft.id || 'create'}
      initial={draft}
      mode="create"
      onSave={onConfirm}
      onClose={onCancel}
      {...props}
    />
  ) : null;
}
export function MediaServerEditDialog({
  server,
  index,
  onSave,
  onClose,
  onRemove,
  disabled,
}: EditProps) {
  return server && index != null ? (
    <MediaServerDialog
      key={server.id || index}
      initial={server}
      index={index}
      mode="edit"
      disabled={disabled}
      onSave={(draft) => onSave(index, draft)}
      onClose={onClose}
      onRemove={() => onRemove(index)}
    />
  ) : null;
}

const emptySession = {
  accessToken: undefined,
  userId: undefined,
  userDisplayName: undefined,
  tokenObtainedAt: undefined,
};
function MediaServerDialog({
  initial,
  index = 0,
  mode,
  disabled,
  onSave,
  onClose,
  onChange,
  onRemove,
}: {
  initial: EmbyMediaServer;
  index?: number;
  mode: 'create' | 'edit';
  disabled?: boolean;
  onSave: (draft: EmbyMediaServer) => Promise<SaveResult>;
  onClose: () => void;
  onChange?: (draft: EmbyMediaServer) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState(() => ({ ...initial }));
  const current = useRef(draft);
  const [specific, setSpecific] = useState(Boolean(initial.libraryIds?.length));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [authMessage, setAuthMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [error, setError] = useState<{
    field?: string;
    message: string;
  } | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const idBase =
    mode === 'create'
      ? 'emby-create-server'
      : `emby-server-${initial.id || index}`;
  const title =
    mode === 'create'
      ? '添加媒体服务器'
      : `编辑 ${initial.name || (initial.type === 'jellyfin' ? 'Jellyfin' : 'Emby')}`;
  const userLoggedIn = Boolean(draft.accessToken && draft.userId);

  // 弹窗局部焦点环；取消登录/读库时无需等待网络返回。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = root.current?.closest<HTMLElement>('[role="dialog"]');
    document.getElementById(`${idBase}-type`)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!savingRef.current) closeRef.current();
      }
      if (event.key !== 'Tab' || !dialog) return;
      const nodes = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
        ),
      ];
      const first = nodes[0];
      const last = nodes.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      alive.current = false;
      generation.current++;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [idBase]);

  const change = (patch: Partial<EmbyMediaServer>) => {
    const before = current.current;
    const endpointChanged =
      (patch.url !== undefined && patch.url !== before.url) ||
      (patch.type !== undefined && patch.type !== before.type);
    const identityChanged =
      endpointChanged ||
      (patch.username !== undefined && patch.username !== before.username) ||
      (patch.password !== undefined && patch.password !== before.password);
    const credentialsChanged =
      identityChanged ||
      (patch.apiKey !== undefined && patch.apiKey !== before.apiKey) ||
      'accessToken' in patch;
    if (credentialsChanged) {
      generation.current++;
      setLoggingIn(false);
      setAuthMessage(null);
    }
    const next = {
      ...before,
      ...patch,
      ...(identityChanged ? emptySession : {}),
      ...(endpointChanged ? { libraryIds: [], libraryOptions: [] } : {}),
      ...(credentialsChanged && !endpointChanged ? { libraryOptions: [] } : {}),
    };
    current.current = next;
    setDraft(next);
    setError(null);
    onChange?.(next);
  };
  const login = async () => {
    if (loggingIn || savingRef.current) return;
    const request = ++generation.current;
    const snapshot = current.current;
    setLoggingIn(true);
    setAuthMessage(null);
    try {
      const result = await loginEmbyUser({
        serverUrl: snapshot.url,
        username: snapshot.username || '',
        password: snapshot.password || '',
      });
      if (!alive.current || request !== generation.current) return;
      if (!result.ok) {
        setAuthMessage({ ok: false, text: result.error });
        return;
      }
      // 与发起登录时同一身份才可绑定会话；草稿中保留输入的账号和密码。
      change({
        accessToken: result.accessToken,
        userId: result.userId,
        userDisplayName: result.userName || result.username,
        tokenObtainedAt: result.tokenObtainedAt,
      });
      setAuthMessage({ ok: true, text: '登录验证成功，保存后生效' });
    } catch {
      if (alive.current && request === generation.current)
        setAuthMessage({ ok: false, text: '登录失败，请检查地址和账号后重试' });
    } finally {
      if (
        alive.current &&
        (request === generation.current || current.current.accessToken)
      )
        setLoggingIn(false);
    }
  };
  const save = async () => {
    if (savingRef.current || loggingIn || disabled) return;
    const validation = validateMediaServerForSave(current.current, index);
    if (!validation.ok) {
      setError({
        field: validation.field,
        message: validation.message || '请检查服务器配置',
      });
      document
        .getElementById(
          `${idBase}-${validation.field === 'url' ? 'url' : 'api-key'}`,
        )
        ?.focus();
      return;
    }
    if (specific && !current.current.libraryIds?.length) {
      setError({
        field: 'libraries',
        message: '请至少选择一个媒体库，或切换为全部媒体库',
      });
      root.current
        ?.querySelector<HTMLElement>('.emby-library-scope input')
        ?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave({
        ...current.current,
        url: current.current.url.trim().replace(/\/+$/, ''),
        libraryIds: specific ? current.current.libraryIds : [],
      });
      if (!alive.current) return;
      if (!result.ok) {
        setError({ message: result.error || '保存失败，请重试' });
        return;
      }
      onClose();
    } catch {
      if (alive.current) setError({ message: '保存失败，请重试' });
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const locked = disabled || saving;
  return (
    <Modal
      open
      title={title}
      dialogId={mode === 'edit' ? 'embyEditModal' : undefined}
      onClose={() => {
        if (!savingRef.current) onClose();
      }}
      className={`${mode === 'create' ? 'emby-server-create-modal' : 'emby-server-edit-modal'} emby-server-dialog !max-w-[40rem]`}
      footer={
        <>
          {onRemove ? (
            <Button
              variant="ghost"
              className="remove-emby-media-server mr-auto"
              disabled={locked}
              onClick={onRemove}
            >
              <i className="fas fa-trash" aria-hidden="true" /> 删除服务器
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className={
              mode === 'create'
                ? 'create-emby-media-server-cancel'
                : 'emby-server-edit-cancel'
            }
            disabled={locked}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            variant="primary"
            className={
              mode === 'create'
                ? 'create-emby-media-server-confirm'
                : 'emby-server-edit-done'
            }
            disabled={locked || loggingIn}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : mode === 'create' ? '添加服务器' : '保存修改'}
          </Button>
        </>
      }
    >
      <div
        ref={root}
        className="emby-server-form-body grid grid-cols-1 gap-2"
        aria-busy={saving}
      >
        <p className="emby-dialog-intro">
          连接 Emby 或 Jellyfin，选择需要同步的媒体库。修改保存后生效。
        </p>
        <section
          className="emby-dialog-section"
          aria-labelledby={`${idBase}-connection-heading`}
        >
          <h3 id={`${idBase}-connection-heading`}>
            <span className="emby-section-number">1</span>服务器信息
          </h3>
          <div className="emby-dialog-columns">
            <SettingField id={`${idBase}-type`} label="类型">
              <SettingSelect
                id={`${idBase}-type`}
                disabled={locked}
                value={draft.type}
                options={[...SERVER_TYPE_OPTIONS]}
                onChange={(value) => {
                  const type = value === 'jellyfin' ? 'jellyfin' : 'emby';
                  change({
                    type,
                    ...(draft.name === 'Emby' || draft.name === 'Jellyfin'
                      ? { name: type === 'emby' ? 'Emby' : 'Jellyfin' }
                      : {}),
                  });
                }}
              />
            </SettingField>
            <SettingField id={`${idBase}-name`} label="名称">
              <Input
                id={`${idBase}-name`}
                className="emby-server-name"
                placeholder="主服务器"
                disabled={locked}
                value={draft.name}
                onChange={(e) => change({ name: e.currentTarget.value })}
              />
            </SettingField>
          </div>
          <SettingField id={`${idBase}-url`} label="服务器地址">
            <Input
              id={`${idBase}-url`}
              className="emby-server-url"
              placeholder="http://192.168.1.10:8096"
              disabled={locked}
              value={draft.url}
              aria-invalid={error?.field === 'url'}
              onChange={(e) => change({ url: e.currentTarget.value })}
            />
            <small>填写完整地址，包含 http:// 或 https:// 和端口。</small>
            {error?.field === 'url' ? (
              <FieldError field="url" message={error.message} />
            ) : null}
          </SettingField>
        </section>
        <section
          className="emby-dialog-section emby-server-user-auth"
          aria-labelledby={`${idBase}-auth-heading`}
        >
          <h3 id={`${idBase}-auth-heading`}>
            <span className="emby-section-number">2</span>访问凭据{' '}
            <span
              className={`emby-connection-state ${userLoggedIn ? 'is-connected' : ''}`}
            >
              {userLoggedIn
                ? `已登录：${draft.userDisplayName || draft.username || '用户'}`
                : '未登录用户'}
            </span>
          </h3>
          <SecretField
            id={`${idBase}-api-key`}
            label="API Key"
            value={draft.apiKey}
            disabled={locked}
            placeholder="扫库/只读用 API Key"
            autoComplete="off"
            onChange={(value) => change({ apiKey: value })}
          />
          <p className="emby-dialog-help">
            API Key 可读取媒体库；需要写回观看进度时，请登录用户账号。
          </p>
          <div className="emby-dialog-columns">
            <SettingField id={`${idBase}-username`} label="用户名">
              <Input
                id={`${idBase}-username`}
                className="emby-server-username"
                value={draft.username || ''}
                placeholder="媒体服务器用户名"
                autoComplete="username"
                disabled={locked}
                onChange={(e) => change({ username: e.currentTarget.value })}
              />
            </SettingField>
            <SecretField
              id={`${idBase}-password`}
              label="密码"
              value={draft.password || ''}
              disabled={locked}
              placeholder="用于登录并保存到此来源"
              autoComplete="current-password"
              onChange={(value) => change({ password: value })}
            />
          </div>
          <div className="emby-dialog-actions">
            <Button
              variant="secondary"
              className="emby-user-login-btn"
              disabled={locked || loggingIn}
              onClick={() => void login()}
            >
              {loggingIn ? '登录中…' : '登录验证'}
            </Button>
            {userLoggedIn ? (
              <Button
                variant="ghost"
                className="emby-user-logout-btn"
                disabled={locked}
                onClick={() => change(emptySession)}
              >
                退出登录
              </Button>
            ) : null}
            {authMessage ? (
              <span
                className={
                  authMessage.ok ? 'emby-dialog-success' : 'emby-dialog-error'
                }
                role={authMessage.ok ? 'status' : 'alert'}
              >
                {authMessage.text}
              </span>
            ) : null}
          </div>
          {error?.field === 'credentials' ? (
            <FieldError field="credentials" message={error.message} />
          ) : null}
          <details
            className={
              mode === 'create'
                ? 'emby-create-server-credential-hint emby-dialog-help'
                : 'emby-server-credential-hint emby-dialog-help'
            }
          >
            <summary>查看当前凭据可用功能</summary>
            {serverCredentialCapabilityLines({
              apiKey: draft.apiKey,
              username: draft.username || '',
              password: draft.password || '',
              loggedIn: userLoggedIn,
            }).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </details>
          <p className="emby-dialog-help">
            用户名和密码随来源配置保存，用于重新登录和同步观看状态。
          </p>
        </section>
        <section
          className="emby-dialog-section"
          aria-labelledby={`${idBase}-scope-heading`}
        >
          <h3 id={`${idBase}-scope-heading`}>
            <span className="emby-section-number">3</span>同步范围
          </h3>
          <MediaServerLibraryPicker
            server={draft}
            specific={specific}
            onSpecificChange={(value) => {
              setSpecific(value);
              setError(null);
            }}
            onChange={change}
            disabled={locked}
            load={listEmbyLibraries}
          />
          {error?.field === 'libraries' ? (
            <FieldError field="libraries" message={error.message} />
          ) : null}
        </section>
        <SettingToggleRow
          id={`${idBase}-enabled`}
          label="启用"
          checked={draft.enabled}
          disabled={locked}
          onChange={(value) => change({ enabled: value })}
        />
        {error && !error.field ? <FieldError message={error.message} /> : null}
      </div>
    </Modal>
  );
}
function FieldError({ field, message }: { field?: string; message: string }) {
  return (
    <p
      className="emby-server-gate-error emby-dialog-error"
      data-field={field}
      role="alert"
    >
      {message}
    </p>
  );
}
function SecretField({
  id,
  label,
  value,
  disabled,
  placeholder,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  placeholder: string;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <SettingField id={id} label={label}>
      <div className="relative">
        <Input
          id={id}
          className="min-w-0 w-full pr-11"
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="emby-secret-eye absolute right-1 top-0 bottom-0 my-auto h-8 w-8 px-0"
          disabled={disabled}
          aria-label={`${visible ? '隐藏' : '显示'}${label}`}
          title={`${visible ? '隐藏' : '显示'}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <i
            className={visible ? 'fas fa-eye-slash' : 'fas fa-eye'}
            aria-hidden="true"
          />
        </Button>
      </div>
    </SettingField>
  );
}
