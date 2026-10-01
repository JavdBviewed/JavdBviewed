/**
 * @file EmbySettingsPage.tsx
 * @description Emby/Jellyfin 增强设置 React 全页
 * @module apps/dashboard/pages/settings/emby
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Modal } from '../../../../../ui/primitives/Modal/Modal';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { EmbyMediaServer, EmbyServerType } from '../../../../../features/embyLibrary/types';
import { showConfirm } from '../../../../../dashboard/components/confirmModal';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import type { SettingsSectionNavItem } from '../shared/SettingsSectionNav';
import { SettingsHighlightNotice } from '../shared/SettingsHighlightNotice';
import {
  getSettings,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  getLibrarySyncDiagnosis,
  loginEmbyUser,
  persistEmbyForm,
  runLibraryCheck,
  runManualLibrarySync,
  toast,
  type LibraryCheckUiState,
  type LibrarySyncUiState,
} from './embySettingsActions';
import {
  addMatchUrl,
  addMediaServer,
  clearMediaServerUserSession,
  createEmptyMediaServerDraft,
  DEFAULT_EMBY_SETTINGS_FORM,
  LINK_BEHAVIOR_OPTIONS,
  mapSettingsToEmbyForm,
  removeMatchUrlAt,
  removeMediaServerAt,
  SERVER_TYPE_OPTIONS,
  serverCredentialCapabilityLines,
  serverCredentialMode,
  updateMatchUrlAt,
  updateMediaServerAt,
  validateMediaServerInput,
  validateMediaServerForSave,
  type EmbySettingsFormState,
} from './embySettingsModel';

const AUTO_SAVE_MS = 1000;

type ServerDraft = EmbyMediaServer | null;
type ServerDeleteTarget = {
  index: number;
  server: EmbyMediaServer;
} | null;
type SettingsPersistResult = Awaited<ReturnType<typeof persistEmbyForm>>;

/**
 * Emby/Jellyfin 增强设置完整页面
 */
export function EmbySettingsPage() {
  const [form, setForm] = useState<EmbySettingsFormState>(DEFAULT_EMBY_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverDraft, setServerDraft] = useState<ServerDraft>(null);
  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerDeleteTarget>(null);
  const [deletingServer, setDeletingServer] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<LibrarySyncUiState>({ kind: 'idle' });
  const [checkCode, setCheckCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkStatus, setCheckStatus] = useState<LibraryCheckUiState>({ kind: 'idle' });
  const formRef = useRef(form);
  formRef.current = form;

  const persist = useCallback(async (nextForm: EmbySettingsFormState) => {
    const result = await persistEmbyForm(nextForm);
    if (!result.ok) {
      setSaveError(result.error || '保存失败');
      await toast(result.error || '保存失败', 'error');
      return result;
    }
    setSaveError(null);
    await toast('设置已保存', 'success');
    return result;
  }, []);

  const { scheduleSave, flush } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        const next = mapSettingsToEmbyForm(settings);
        formRef.current = next;
        setForm(next);
      } catch (err) {
        console.error('[EmbySettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateForm = useCallback(
    (patch: Partial<EmbySettingsFormState>, immediate = false) => {
      const next = { ...formRef.current, ...patch };
      formRef.current = next;
      setForm(next);
      if (immediate) void flush(next);
      else scheduleSave(next);
    },
    [flush, scheduleSave],
  );

  const setFormAndSchedule = useCallback(
    (updater: (prev: EmbySettingsFormState) => EmbySettingsFormState, immediate = false) => {
      const next = updater(formRef.current);
      formRef.current = next;
      setForm(next);
      if (immediate) void flush(next);
      else scheduleSave(next);
    },
    [flush, scheduleSave],
  );

  const enabled = form.enabled;
  const recognitionEnabled = form.recognitionEnabled;
  const libraryEnabled = form.libraryEnabled;
  const editingServer = editingServerIndex == null ? null : form.mediaServers[editingServerIndex] ?? null;

  const focusCreateUrl = () => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLInputElement>('.emby-create-server-url')
        ?.focus();
    }, 30);
  };

  const onAddServer = () => {
    if (serverDraft) {
      focusCreateUrl();
      return;
    }
    // 首次打开的焦点由弹窗内 useDialogInitialFocus 落到第一个字段（类型），
    // 不再在此抢焦到地址框；仅在弹窗已打开时把焦点补到地址框。
    setServerDraft(createEmptyMediaServerDraft());
  };

  const onCancelCreate = () => {
    setServerDraft(null);
  };

  const onConfirmCreate = async () => {
    if (!serverDraft) return;
    const v = validateMediaServerInput(serverDraft);
    if (!v.ok) {
      await toast(v.message || '输入无效', 'warning');
      return;
    }
    const nextServer = {
      ...serverDraft,
      url: serverDraft.url.trim().replace(/\/+$/, ''),
      apiKey: serverDraft.apiKey.trim(),
      username: (serverDraft.username || '').trim(),
      password: (serverDraft.password || '').trim(),
    };
    setFormAndSchedule(
      (prev) => ({
        ...prev,
        mediaServers: addMediaServer(prev.mediaServers, nextServer),
      }),
      true,
    );
    setServerDraft(null);
    // 仅账号+密码（无 API Key、未登录会话）：添加成功但用户会话尚不存在，
    // 必须明确告知「先登录」，避免保存后同步/详情/播放静默 401
    if (serverCredentialMode(nextServer) === 'account') {
      await toast(
        '服务器已添加。登录用户账号前，媒体库同步/详情/播放不可用，请在编辑中先「登录并保存令牌」',
        'warning',
      );
    }
  };

  const requestRemoveServer = (index: number) => {
    const server = formRef.current.mediaServers[index];
    if (!server) return;
    setDeleteTarget({ index, server });
  };

  const onConfirmRemoveServer = async () => {
    if (!deleteTarget || deletingServer) return;
    setDeletingServer(true);
    try {
      await flush(formRef.current);
      const nextForm = {
        ...formRef.current,
        mediaServers: removeMediaServerAt(formRef.current.mediaServers, deleteTarget.index),
      };
      const result = await persistEmbyForm(nextForm);
      if (!result.ok) {
        setSaveError(result.error || '删除来源失败');
        await toast(result.error || '删除来源失败', 'error');
        return;
      }
      formRef.current = nextForm;
      setForm(nextForm);
      setSaveError(null);
      setDeleteTarget(null);
      setEditingServerIndex(null);
      await toast('媒体服务器来源已删除', 'success');
    } finally {
      setDeletingServer(false);
    }
  };

  const onServerField = (
    index: number,
    patch: Partial<EmbyMediaServer>,
  ) => {
    setFormAndSchedule((prev) => ({
      ...prev,
      mediaServers: updateMediaServerAt(prev.mediaServers, index, patch),
    }));
  };

  const onServerLoginSuccess = async (
    index: number,
    patch: Partial<EmbyMediaServer>,
  ): Promise<SettingsPersistResult> => {
    const nextForm = {
      ...formRef.current,
      mediaServers: updateMediaServerAt(formRef.current.mediaServers, index, patch),
    };
    const saved = await flush(nextForm);
    if (!saved.ok) return saved;

    formRef.current = nextForm;
    setForm(nextForm);
    return saved;
  };

  const onServerLogout = (index: number) => {
    setFormAndSchedule(
      (prev) => {
        const current = prev.mediaServers[index];
        if (!current) return prev;
        return {
          ...prev,
          mediaServers: updateMediaServerAt(
            prev.mediaServers,
            index,
            clearMediaServerUserSession(current),
          ),
        };
      },
      true,
    );
  };

  const onAddMatchUrl = async () => {
    if (formRef.current.matchUrls.length >= 20) {
      await toast('最多添加 20 个额外匹配地址', 'warning');
      return;
    }
    const confirmed = await showConfirm({
      title: '添加额外匹配地址',
      message: '将在下方追加一行匹配地址，请填写后自动保存。',
      confirmText: '添加',
      type: 'info',
    });
    if (!confirmed) return;
    setFormAndSchedule(
      (prev) => ({
        ...prev,
        matchUrls: addMatchUrl(prev.matchUrls, ''),
      }),
      true,
    );
    await toast('已添加一行，请填写地址', 'success');
  };

  const onMatchUrlChange = (index: number, value: string) => {
    setFormAndSchedule((prev) => ({
      ...prev,
      matchUrls: updateMatchUrlAt(prev.matchUrls, index, value),
    }));
  };

  const onRemoveMatchUrl = async (index: number) => {
    const target = formRef.current.matchUrls[index];
    if (!target) return;
    const confirmed = await showConfirm({
      title: '删除匹配地址',
      message: `确定删除「${target}」？`,
      confirmText: '删除',
      type: 'danger',
    });
    if (!confirmed) return;
    setFormAndSchedule(
      (prev) => ({
        ...prev,
        matchUrls: removeMatchUrlAt(prev.matchUrls, index),
      }),
      true,
    );
    await toast('匹配地址已删除', 'success');
  };

  const onManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncStatus({ kind: 'loading' });
    try {
      // 同步前先 flush 当前表单
      await flush(formRef.current);
      const result = await runManualLibrarySync(formRef.current);
      setSyncStatus(result.ui);
    } finally {
      setSyncing(false);
    }
  };

  const onTestLibraryCheck = async () => {
    if (checking) return;
    const code = checkCode.trim();
    if (!code) {
      await toast('请输入要测试的番号', 'warning');
      return;
    }
    setChecking(true);
    setCheckStatus({ kind: 'loading' });
    try {
      await flush(formRef.current);
      const result = await runLibraryCheck(formRef.current, code);
      setCheckStatus(result.ui);
    } finally {
      setChecking(false);
    }
  };

  const sectionNavItems: SettingsSectionNavItem[] = [
    { id: 'emby-nav-media-server', label: '媒体服务器', shortLabel: '服务器' },
    { id: 'emby-nav-recognition', label: '番号识别与链接', shortLabel: '识别' },
    { id: 'emby-nav-link-behavior', label: '链接行为', shortLabel: '链接' },
    { id: 'emby-nav-quick-actions', label: '快捷按钮', shortLabel: '按钮' },
    { id: 'emby-nav-library-status', label: '媒体库入库状态', shortLabel: '入库' },
  ];

  return (
    <SettingsPageFrame
      title="Emby/Jellyfin 增强设置"
      description="两个独立能力：番号识别/转 JavDB 链接（无需 API Key），以及媒体库同步/入库状态（需已启用服务器）。"
      sectionNavItems={sectionNavItems}
      rootDataAttrs={{ 'data-media-library-settings-react': '1' }}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="media-library-settings">
          <SettingsHighlightNotice title="Emby/Jellyfin 功能仍在测试中">
            影音增强、媒体库同步和播放状态写回仍在持续打磨。遇到识别、同步或播放异常，可以到{' '}
            <a
              href="https://github.com/JavdBviewed/JavdBviewed/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Issues
            </a>{' '}
            反馈现象、截图和日志。
          </SettingsHighlightNotice>

          <SettingSection
            id="emby-nav-media-server"
            title="媒体服务器"
            description="配置 Emby/Jellyfin 服务器地址、API Key，以及用户登录令牌。"
          >
            <SettingToggleRow
              id="emby-library-enabled"
              label="启用媒体库同步与入库状态"
              description="启用后，后台会按间隔同步已启用服务器的媒体库，并在 JavDB 列表/详情页显示入库状态。"
              checked={form.libraryEnabled}
              onChange={(v) => updateForm({ libraryEnabled: v, libraryStatusEnabled: v })}
            />
            <div
              id="emby-media-server-list"
              className="flex flex-col gap-2 px-2 py-2"
              data-settings-search-keywords="媒体服务器 Emby Jellyfin API Key 登录 AccessToken"
            >
              {form.mediaServers.length === 0 ? (
                <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">
                  尚未添加媒体服务器
                </p>
              ) : null}

              {form.mediaServers.map((server, index) => (
                <MediaServerSummaryRow
                  key={server.id || 'server-' + index}
                  server={server}
                  index={index}
                  onEdit={() => setEditingServerIndex(index)}
                  onRemove={() => requestRemoveServer(index)}
                />
              ))}
            </div>

            <MediaServerCreateDialog
              draft={serverDraft}
              onChange={setServerDraft}
              onConfirm={() => void onConfirmCreate()}
              onCancel={onCancelCreate}
            />

            <MediaServerEditDialog
              server={editingServer}
              index={editingServerIndex}
              onClose={() => setEditingServerIndex(null)}
              onChange={(index, patch) => onServerField(index, patch)}
              onRemove={requestRemoveServer}
              onLoginSuccess={(index, patch) => onServerLoginSuccess(index, patch)}
              onLogout={(index) => onServerLogout(index)}
            />

            <MediaServerDeleteConfirmDialog
              target={deleteTarget}
              deleting={deletingServer}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={() => void onConfirmRemoveServer()}
            />

            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button
                id="add-emby-media-server"
                variant="secondary"
                onClick={onAddServer}
              >
                <i className="fas fa-plus" aria-hidden="true" /> 添加服务器
              </Button>
              <Button
                id="sync-emby-library"
                variant="primary"
                disabled={!libraryEnabled || syncing}
                onClick={() => void onManualSync()}
              >
                <i className="fas fa-sync-alt" aria-hidden="true" />{' '}
                {syncing ? '同步中…' : '立即同步媒体库'}
              </Button>
            </div>

            <LibrarySyncStatusPanel status={syncStatus} />

            <div className="mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
              <SettingField
                id="emby-library-check-code"
                label="测试入库检测"
                description="输入番号后按当前已启用服务器实时查询，结果会同时更新本地入库索引。"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="emby-library-check-code"
                    className="min-w-0 flex-1"
                    disabled={!libraryEnabled || checking}
                    placeholder="ABC-123 / FC2-PPV-123456"
                    value={checkCode}
                    onChange={(e) => setCheckCode(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void onTestLibraryCheck();
                      }
                    }}
                  />
                  <Button
                    id="test-emby-library-check"
                    variant="secondary"
                    disabled={!libraryEnabled || checking}
                    onClick={() => void onTestLibraryCheck()}
                  >
                    <i className="fas fa-search" aria-hidden="true" />{' '}
                    {checking ? '检测中…' : '测试入库检测'}
                  </Button>
                </div>
              </SettingField>
              <LibraryCheckResultPanel status={checkStatus} />
            </div>
          </SettingSection>

          <SettingSection
            id="emby-nav-recognition"
            title="番号识别与链接"
            description="自动识别页面中的番号并转换为可点击的 JavDB 链接。"
          >
            <SettingToggleRow
              id="emby-recognition-enabled"
              label="启用番号识别 / 转 JavDB 链接"
              description="在匹配的媒体服务器页面自动识别番号并转换为 JavDB 链接，无需 API Key。"
              checked={form.recognitionEnabled}
              onChange={(v) => updateForm({ recognitionEnabled: v })}
            />
            <SettingSection
              title="额外匹配地址（高级）"
              description="已启用媒体服务器的地址会自动匹配。仅在反向代理、备用域名或网页登录地址不同于服务器地址时，在这里补充匹配模式；支持通配符 *。"
            >
              <div
                id="emby-match-urls-list"
                className="flex flex-col gap-2 px-2 py-2"
                data-settings-search-keywords="额外匹配地址 反向代理 备用域名 媒体服务器"
                style={{ opacity: recognitionEnabled ? 1 : 0.5 }}
              >
              {(form.matchUrls.length === 0 ? [''] : form.matchUrls).map((url, index) => {
                const realIndex = form.matchUrls.length === 0 ? -1 : index;
                const displayValue = form.matchUrls.length === 0 ? '' : url;
                const isDraft = form.matchUrls.length === 0 || !url.trim();
                return (
                  <div key={`url-${index}`} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      disabled={!recognitionEnabled}
                      placeholder="备用域名或反代地址，如 https://media.example.com（留空不会保存）"
                      value={displayValue}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        if (form.matchUrls.length === 0) {
                          setFormAndSchedule((prev) => ({
                            ...prev,
                            matchUrls: [value],
                          }));
                        } else {
                          onMatchUrlChange(realIndex, value);
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      disabled={!recognitionEnabled || isDraft}
                      title="删除"
                      aria-label="删除匹配地址"
                      onClick={() => {
                        if (isDraft) return;
                        void onRemoveMatchUrl(realIndex);
                      }}
                    >
                      <i className="fas fa-trash" aria-hidden="true" /> 删除
                    </Button>
                  </div>
                );
              })}
            </div>
              <div className="px-2 pb-2">
                <Button
                  id="add-emby-url"
                  variant="secondary"
                  disabled={!recognitionEnabled}
                  onClick={() => void onAddMatchUrl()}
                >
                  <i className="fas fa-plus" aria-hidden="true" /> 添加额外匹配地址
                </Button>
              </div>
            </SettingSection>
          </SettingSection>

          <SettingSection id="emby-nav-link-behavior" title="链接行为">
            <SettingField
              id="emby-link-behavior"
              label="点击番号后的行为"
              description="选择点击番号链接后的跳转行为。推荐使用搜索模式以确保能找到相关内容。"
            >
              <SettingSelect
                id="emby-link-behavior"
                disabled={!recognitionEnabled}
                value={form.linkBehavior}
                options={[...LINK_BEHAVIOR_OPTIONS]}
                onChange={(v) =>
                  updateForm({
                    linkBehavior: v === 'javdb-direct' ? 'javdb-direct' : 'javdb-search',
                  })
                }
              />
            </SettingField>
          </SettingSection>

          <SettingSection id="emby-nav-quick-actions" title="快捷按钮">
            <SettingToggleRow
              id="emby-show-quick-search-code"
              label='显示"搜番号"按钮'
              description="在右侧显示悬浮按钮，快速按页面内容或选中文本进行番号搜索/直达。"
              checked={form.showQuickSearchCode}
              disabled={!recognitionEnabled}
              onChange={(v) => updateForm({ showQuickSearchCode: v })}
            />
            <SettingToggleRow
              id="emby-show-quick-search-actor"
              label='显示"搜演员"按钮'
              description="在右侧显示悬浮按钮，快速按页面内容或选中文本进行演员搜索。"
              checked={form.showQuickSearchActor}
              disabled={!recognitionEnabled}
              onChange={(v) => updateForm({ showQuickSearchActor: v })}
            />
          </SettingSection>

          <SettingSection id="emby-nav-library-status" title="媒体库入库状态">
            <SettingToggleRow
              id="emby-library-status-enabled"
              label="显示 Emby/Jellyfin 入库状态"
              description="在 JavDB 列表页和详情页显示本地媒体服务器是否已入库（依赖上方“媒体库同步与入库状态”总开关）。"
              checked={form.libraryEnabled}
              onChange={(v) => updateForm({ libraryEnabled: v, libraryStatusEnabled: v })}
            />
            <div
              className="flex flex-col gap-1"
              style={{ opacity: libraryEnabled ? 1 : 0.5 }}
            >
              <SettingToggleRow
                id="emby-library-show-list"
                label="列表页显示入库标签"
                checked={form.libraryShowOnList}
                disabled={!libraryEnabled}
                onChange={(v) => updateForm({ libraryShowOnList: v })}
              />
              <SettingToggleRow
                id="emby-library-show-detail"
                label="详情页显示入库标签"
                checked={form.libraryShowOnDetail}
                disabled={!libraryEnabled}
                onChange={(v) => updateForm({ libraryShowOnDetail: v })}
              />
              <SettingToggleRow
                id="emby-library-realtime-enabled"
                label="启用实时校验队列"
                checked={form.realtimeCheckEnabled}
                disabled={!libraryEnabled}
                onChange={(v) => updateForm({ realtimeCheckEnabled: v })}
              />
            </div>
            <SettingField
              id="emby-library-sync-interval"
              label="自动同步间隔（分钟）"
              description="后台自动同步会按此间隔使用本地保存的 API Key 请求已启用服务器的影片列表，并把入库索引保存到扩展本地；点击“立即同步媒体库”会马上执行一次。"
            >
              <Input
                id="emby-library-sync-interval"
                type="number"
                min={5}
                max={10080}
                step={5}
                value={String(form.syncIntervalMinutes)}
                onChange={(e) => {
                  const n = parseInt(e.currentTarget.value, 10);
                  if (!Number.isFinite(n)) return;
                  updateForm({ syncIntervalMinutes: Math.max(5, n) });
                }}
              />
            </SettingField>
          </SettingSection>

          <SettingSection title="使用说明">
            <ul className="m-0 list-disc px-6 py-2 text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
              <li>
                <strong className="text-[var(--color-fg)]">媒体服务器匹配:</strong>{' '}
                已启用服务器的地址会自动用于页面匹配，一般不需要额外配置网址
              </li>
              <li>
                <strong className="text-[var(--color-fg)]">额外匹配地址:</strong>{' '}
                仅用于反向代理、备用域名或网页登录地址不同于服务器地址的情况；支持通配符 * 匹配任意字符
              </li>
              <li>
                <strong className="text-[var(--color-fg)]">番号识别:</strong>{' '}
                自动识别常见的番号格式，如 ABC-123、FC2-PPV-123456 等
              </li>
              <li>
                <strong className="text-[var(--color-fg)]">链接跳转:</strong>{' '}
                所有链接都会在新标签页中打开，不影响当前页面
              </li>
              <li>
                <strong className="text-[var(--color-fg)]">兼容性:</strong>{' '}
                支持 Emby、Jellyfin 等主流媒体服务器
              </li>
            </ul>
          </SettingSection>

          {saveError ? (
            <p className="m-0 px-2 text-[13px] text-[var(--color-danger,#c0392b)]" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      )}
    </SettingsPageFrame>
  );
}

type MediaServerRowProps = {
  server: EmbyMediaServer;
  index: number;
  disabled?: boolean;
  /** 关闭门禁红字（编辑弹窗专用，由弹窗持有状态） */
  gateError?: ServerGateError;
  /** 地址回车=等同点「完成」（走关闭门禁） */
  onRequestClose?: () => void;
  onChange: (patch: Partial<EmbyMediaServer>) => void;
  /** 删除按钮已移至编辑弹窗 footer；保留字段兼容既有挂载点 */
  onRemove?: () => void;
  onLoginSuccess: (patch: Partial<EmbyMediaServer>) => Promise<SettingsPersistResult>;
  onLogout: () => void;
};

type MediaServerSummaryRowProps = {
  server: EmbyMediaServer;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
};

type MediaServerCreateDialogProps = {
  draft: EmbyMediaServer | null;
  disabled?: boolean;
  onChange: (draft: EmbyMediaServer) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

type MediaServerEditDialogProps = {
  server: EmbyMediaServer | null;
  index: number | null;
  disabled?: boolean;
  onClose: () => void;
  onChange: (index: number, patch: Partial<EmbyMediaServer>) => void;
  onRemove: (index: number) => void;
  onLoginSuccess: (
    index: number,
    patch: Partial<EmbyMediaServer>,
  ) => Promise<SettingsPersistResult>;
  onLogout: (index: number) => void;
};

type MediaServerDeleteConfirmDialogProps = {
  target: ServerDeleteTarget;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function MediaServerSummaryRow({
  server,
  index,
  onEdit,
  onRemove,
}: MediaServerSummaryRowProps) {
  const displayName = server.name.trim() || (server.type === 'jellyfin' ? 'Jellyfin' : 'Emby');
  const serverType = server.type === 'jellyfin' ? 'Jellyfin' : 'Emby';
  const urlLabel = server.url.trim() || '未填写服务器地址';
  const hasApiKey = Boolean(server.apiKey.trim());
  const userLoggedIn = Boolean(server.accessToken && server.userId);

  return (
    <div
      className="emby-media-server-summary flex flex-col gap-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-index={String(index)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-bold text-[var(--color-fg)]">
            {displayName}
          </span>
          <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-fg-muted)]">
            {serverType}
          </span>
          <span
            className={
              server.enabled
                ? 'text-[12px] font-semibold text-[var(--color-success,#16a34a)]'
                : 'text-[12px] font-semibold text-[var(--color-fg-muted)]'
            }
          >
            {server.enabled ? '已启用' : '已停用'}
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-[12px] text-[var(--color-fg-muted)]">
          {urlLabel}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--color-fg-muted)]">
          <span>{hasApiKey ? 'API Key 已配置' : 'API Key 未配置'}</span>
          <span>
            {userLoggedIn
              ? '用户已登录：' + (server.userDisplayName || server.username || server.userId || '')
              : '用户未登录'}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <i className="fas fa-edit" aria-hidden="true" /> 编辑
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <i className="fas fa-trash" aria-hidden="true" /> 删除
        </Button>
      </div>
    </div>
  );
}

function MediaServerDeleteConfirmDialog({
  target,
  deleting,
  onCancel,
  onConfirm,
}: MediaServerDeleteConfirmDialogProps) {
  const displayName = target
    ? target.server.name.trim() || (target.server.type === 'jellyfin' ? 'Jellyfin' : 'Emby')
    : '';
  const serverUrl = target?.server.url.trim() || '未填写服务器地址';

  return (
    <Modal
      dialogId="embyDeleteModal"
      open={Boolean(target)}
      title="确认删除媒体服务器"
      onClose={deleting ? () => undefined : onCancel}
      className="emby-server-delete-modal"
      footer={
        <>
        <Button variant="secondary" disabled={deleting} onClick={onCancel}>
          <i className="fas fa-times" aria-hidden="true" /> 取消
          </Button>
          <Button variant="danger" disabled={deleting} onClick={onConfirm}>
            <i className="fas fa-trash" aria-hidden="true" />{' '}
            {deleting ? '删除中…' : '确认删除'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="m-0 text-[13px] leading-6 text-[var(--color-fg)]">
          将从扩展设置中删除来源“{displayName}”。
        </p>
        <div className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <div className="font-semibold text-[var(--color-fg)]">{displayName}</div>
          <div className="mt-1 break-all font-mono text-[12px] text-[var(--color-fg-muted)]">
            {serverUrl}
          </div>
        </div>
        <p className="m-0 text-[12px] leading-5 text-[var(--color-fg-muted)]">
          此操作不会删除本地媒体索引，也不会删除服务器中的影片文件。
        </p>
      </div>
    </Modal>
  );
}

/** 弹窗关闭门禁红字归属字段（url / credentials），null=无红字 */
type ServerGateError = { field: 'url' | 'credentials'; message: string } | null;

/** 关闭门禁红字的出路提示：停用或删除都能绕过校验，避免用户被弹窗卡住 */
const GATE_EXIT_HINT = '可先关闭「启用」或删除该服务器';

function ServerGateErrorText({
  field,
  message,
}: {
  field: 'url' | 'credentials';
  message: string;
}) {
  return (
    <p
      className="emby-server-gate-error m-0 mt-1 leading-5"
      data-field={field}
      role="alert"
      style={{ fontSize: '12px', color: 'var(--danger)' }}
    >
      {message}
    </p>
  );
}

/**
 * Modal 基元不接遮罩点击与 Esc（基元交互语义不动），弹窗本地补 Esc：
 * 新增=放弃草稿，编辑=走关闭门禁。
 */
function useDialogEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}

/** 打开弹窗聚焦第一个字段（类型选择器） */
function useDialogInitialFocus(active: boolean, firstFieldId: string | null) {
  useEffect(() => {
    if (!active || !firstFieldId) return;
    document.getElementById(firstFieldId)?.focus();
  }, [active, firstFieldId]);
}

type MediaServerFormAuth = {
  userLoggedIn: boolean;
  sessionLabel: string;
  loggingIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
};

type MediaServerFormBodyProps = {
  /** create=新增草稿表单，edit=编辑表单；两态共用同一字段顺序/label/placeholder */
  mode: 'create' | 'edit';
  server: EmbyMediaServer;
  disabled?: boolean;
  /** DOM id 前缀：新增 emby-create-server-*，编辑 emby-server-<id>-*（保持既有锚点） */
  idBase: string;
  onChange: (patch: Partial<EmbyMediaServer>) => void;
  /** 类型切换的特殊联动（新增态需要同步默认名称），缺省只写 type */
  onTypeChange?: (type: EmbyServerType) => void;
  usernameValue: string;
  onUsernameChange: (value: string) => void;
  capability: { apiKey: string; username: string; password: string; loggedIn?: boolean };
  /** 关闭门禁红字（编辑态专用） */
  gateError?: ServerGateError;
  /** 编辑态额外的会话状态与登录入口；新增态为 null */
  auth?: MediaServerFormAuth | null;
  /** 地址输入框回车：新增=确认，编辑=等同点「完成」（走关闭门禁） */
  onSubmit?: () => void;
};

/**
 * 媒体服务器表单本体（新增/编辑共用）：
 * 单列字段顺序 = 类型 → 名称 → 服务器地址 → API Key → 用户登录盒（用户名/密码两列）→ 启用；
 * 确认/取消/删除/完成一律在弹窗 footer，不落滚动区。
 */
function MediaServerFormBody({
  mode,
  server,
  disabled,
  idBase,
  onChange,
  onTypeChange,
  usernameValue,
  onUsernameChange,
  capability,
  gateError = null,
  auth = null,
  onSubmit,
}: MediaServerFormBodyProps) {
  return (
    <div className="emby-server-form-body grid grid-cols-1 gap-2">
      <SettingField id={`${idBase}-type`} label="类型">
        <SettingSelect
          id={`${idBase}-type`}
          disabled={disabled}
          value={server.type}
          options={[...SERVER_TYPE_OPTIONS]}
          onChange={(v) => {
            const type: EmbyServerType = v === 'jellyfin' ? 'jellyfin' : 'emby';
            if (onTypeChange) {
              onTypeChange(type);
              return;
            }
            onChange({ type });
          }}
        />
      </SettingField>

      <SettingField id={`${idBase}-name`} label="名称">
        <Input
          id={`${idBase}-name`}
          className="emby-server-name"
          disabled={disabled}
          placeholder="主服务器"
          value={server.name}
          onChange={(e) => onChange({ name: e.currentTarget.value })}
        />
      </SettingField>

      <SettingField id={`${idBase}-url`} label="服务器地址">
        <Input
          id={`${idBase}-url`}
          className="emby-server-url"
          disabled={disabled}
          placeholder="http://192.168.1.10:8096"
          value={server.url}
          onChange={(e) => onChange({ url: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {gateError?.field === 'url' ? (
          <ServerGateErrorText field="url" message={gateError.message} />
        ) : null}
      </SettingField>

      <SecretField
        id={`${idBase}-api-key`}
        label="API Key"
        disabled={disabled}
        placeholder="扫库/只读用 API Key"
        autoComplete="off"
        value={server.apiKey}
        onChange={(value) => onChange({ apiKey: value })}
      />

      <div className="emby-server-user-auth rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-[var(--color-fg)]">
            用户登录（写回观看状态 / 更完整 UserData）
          </span>
          {auth ? (
            <span
              className={
                auth.userLoggedIn
                  ? 'text-[12px] font-medium text-[var(--color-success, #16a34a)]'
                  : 'text-[12px] text-[var(--color-fg-muted)]'
              }
            >
              {auth.sessionLabel}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <SettingField id={`${idBase}-username`} label="用户名">
            <Input
              id={`${idBase}-username`}
              className="emby-server-username"
              disabled={disabled || Boolean(auth?.loggingIn)}
              placeholder="媒体服务器用户名"
              autoComplete="username"
              value={usernameValue}
              onChange={(e) => onUsernameChange(e.currentTarget.value)}
            />
          </SettingField>
          <SecretField
            id={`${idBase}-password`}
            label="密码"
            disabled={disabled || Boolean(auth?.loggingIn)}
            placeholder="用于登录并保存到此来源"
            autoComplete="current-password"
            value={server.password || ''}
            onChange={(value) => onChange({ password: value })}
          />
        </div>
        {gateError?.field === 'credentials' ? (
          <ServerGateErrorText field="credentials" message={gateError.message} />
        ) : null}
        {auth ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="primary"
              className="emby-user-login-btn"
              disabled={disabled || auth.loggingIn}
              onClick={auth.onLogin}
            >
              <i className="fas fa-sign-in-alt" aria-hidden="true" />{' '}
              {auth.loggingIn ? '登录中…' : '登录并保存令牌'}
            </Button>
            <Button
              variant="secondary"
              className="emby-user-logout-btn"
              disabled={disabled || !auth.userLoggedIn || auth.loggingIn}
              onClick={auth.onLogout}
            >
              <i className="fas fa-sign-out-alt" aria-hidden="true" /> 退出登录
            </Button>
          </div>
        ) : null}
        <p className="m-0 mt-2 text-[12px] leading-5 text-[var(--color-fg-muted)]">
          API Key 负责扫库；用户登录后的 AccessToken 用于标记真实已看。用户名和密码会随来源配置保存，用于重新登录和同步观看状态。
        </p>
        <div
          className={`${
            mode === 'create'
              ? 'emby-create-server-credential-hint'
              : 'emby-server-credential-hint'
          } mt-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] leading-5 text-[var(--color-fg-muted)]`}
          aria-live="polite"
        >
          {serverCredentialCapabilityLines(capability).map((line) => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))}
        </div>
      </div>

      <SettingToggleRow
        id={`${idBase}-enabled`}
        label="启用"
        checked={server.enabled}
        disabled={disabled}
        onChange={(v) => onChange({ enabled: v })}
      />
    </div>
  );
}

export function MediaServerCreateDialog({
  draft,
  disabled,
  onChange,
  onConfirm,
  onCancel,
}: MediaServerCreateDialogProps) {
  const open = Boolean(draft);
  useDialogEscapeKey(open, onCancel);
  useDialogInitialFocus(open, 'emby-create-server-type');

  return (
    <Modal
      open={open}
      title="添加媒体服务器"
      onClose={onCancel}
      className="emby-server-create-modal max-h-[calc(100vh-2rem)] !max-w-[30rem] overflow-y-auto"
      footer={
        <>
          <Button
            variant="secondary"
            className="create-emby-media-server-cancel"
            disabled={disabled}
            title="取消"
            onClick={onCancel}
          >
            <i className="fas fa-times" aria-hidden="true" /> 取消
          </Button>
          <Button
            variant="primary"
            className="create-emby-media-server-confirm"
            disabled={disabled}
            title="确认"
            onClick={onConfirm}
          >
            <i className="fas fa-check" aria-hidden="true" /> 确认
          </Button>
        </>
      }
    >
      {draft ? (
        <MediaServerCreateRow
          draft={draft}
          disabled={disabled}
          onChange={onChange}
          onConfirm={onConfirm}
        />
      ) : null}
    </Modal>
  );
}

export function MediaServerEditDialog({
  server,
  index,
  disabled,
  onClose,
  onChange,
  onRemove,
  onLoginSuccess,
  onLogout,
}: MediaServerEditDialogProps) {
  const title = server
    ? '编辑 ' + (server.name || (server.type === 'jellyfin' ? 'Jellyfin' : 'Emby'))
    : '编辑媒体服务器';
  const open = Boolean(server) && index != null;
  const [gateError, setGateError] = useState<ServerGateError>(null);
  // 任一相关字段变化即清红字（地址非法与缺凭据两种都算），避免旧报错粘在弹窗里
  const fieldSignature = server
    ? [
        server.url,
        server.apiKey,
        server.accessToken,
        server.username,
        server.password,
        String(server.enabled),
      ].join('\u0001')
    : '';
  useEffect(() => {
    setGateError(null);
  }, [fieldSignature]);

  const attemptClose = useCallback(() => {
    if (!server || index == null) {
      onClose();
      return;
    }
    const result = validateMediaServerForSave(server, index);
    if (!result.ok && result.field) {
      // 两种报错都给出路：停用或删除都能绕过保存校验，避免用户被弹窗卡住
      const message = `${result.message || '该服务器配置不完整'}，${GATE_EXIT_HINT}`;
      setGateError({ field: result.field, message });
      return;
    }
    setGateError(null);
    onClose();
  }, [server, index, onClose]);

  useDialogEscapeKey(open, attemptClose);
  useDialogInitialFocus(open, server ? `emby-server-${server.id || index}-type` : null);

  return (
    <Modal
      dialogId="embyEditModal"
      open={open}
      title={title}
      onClose={attemptClose}
      className="emby-server-edit-modal max-h-[calc(100vh-2rem)] !max-w-[30rem] overflow-y-auto"
      footer={
        <>
          <Button
            variant="secondary"
            className="remove-emby-media-server mr-auto"
            disabled={disabled}
            title="删除服务器"
            onClick={() => {
              if (index != null) onRemove(index);
            }}
          >
            <i className="fas fa-trash" aria-hidden="true" /> 删除
          </Button>
          <Button
            variant="primary"
            className="emby-server-edit-done"
            disabled={disabled}
            onClick={attemptClose}
          >
            <i className="fas fa-check" aria-hidden="true" /> 完成
          </Button>
        </>
      }
    >
      {server && index != null ? (
        <MediaServerRow
          server={server}
          index={index}
          disabled={disabled}
          gateError={gateError}
          onRequestClose={attemptClose}
          onChange={(patch) => onChange(index, patch)}
          onLoginSuccess={(patch) => onLoginSuccess(index, patch)}
          onLogout={() => onLogout(index)}
        />
      ) : null}
    </Modal>
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
  placeholder?: string;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
  }, [id]);

  return (
    <SettingField id={id} label={label}>
      <div className="relative">
        <Input
          id={id}
          className="min-w-0 w-full pr-11"
          type={visible ? 'text' : 'password'}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        {/* 小眼睛：垂直居中不依赖 transform（top-0/bottom-0/my-auto），
            否则 button.css 全局 hover/active 的 transform 会整体覆盖 -translate-y-1/2 造成下跳；
            几何与 hover/active 态锁定见 dashboard/styles/05-pages/settings/emby.css 的 .emby-secret-eye */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="emby-secret-eye absolute right-1 top-0 bottom-0 my-auto h-8 w-8 px-0"
          disabled={disabled}
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
          title={visible ? `隐藏${label}` : `显示${label}`}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          <i className={visible ? 'fas fa-eye-slash' : 'fas fa-eye'} aria-hidden="true" />
        </Button>
      </div>
    </SettingField>
  );
}

export function MediaServerRow({
  server,
  index,
  disabled,
  gateError = null,
  onRequestClose,
  onChange,
  onLoginSuccess,
  onLogout,
}: MediaServerRowProps) {
  const idBase = `emby-server-${server.id || index}`;
  const [loginUsername, setLoginUsername] = useState(server.username || '');
  const [loggingIn, setLoggingIn] = useState(false);
  const userLoggedIn = Boolean(server.accessToken && server.userId);
  const sessionLabel = userLoggedIn
    ? `已登录：${server.userDisplayName || server.username || server.userId || ''}`
    : '未登录用户（写回「真实已看」通常需要登录）';

  useEffect(() => {
    setLoginUsername(server.username || '');
  }, [server.id, server.username]);

  const onLogin = async () => {
    if (loggingIn) return;
    setLoggingIn(true);
    try {
      const result = await loginEmbyUser({
        serverUrl: server.url,
        username: loginUsername,
        password: server.password || '',
      });
      if (!result.ok) {
        await toast(`登录失败：${result.error}`, 'error');
        return;
      }
      const saved = await onLoginSuccess({
        username: result.username,
        password: server.password || '',
        accessToken: result.accessToken,
        userId: result.userId,
        userDisplayName: result.userName || result.username,
        tokenObtainedAt: result.tokenObtainedAt,
      });
      if (!saved.ok) {
        await toast(`登录成功，但来源配置保存失败：${saved.error || '请稍后重试'}`, 'error');
        return;
      }
      await toast('用户登录成功，来源凭据与访问令牌已保存', 'success');
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <MediaServerFormBody
      mode="edit"
      server={server}
      disabled={disabled}
      idBase={idBase}
      gateError={gateError}
      onChange={onChange}
      usernameValue={loginUsername}
      onUsernameChange={(value) => {
        setLoginUsername(value);
        onChange({ username: value });
      }}
      capability={{
        apiKey: server.apiKey,
        username: loginUsername,
        password: server.password || '',
        loggedIn: userLoggedIn,
      }}
      auth={{
        userLoggedIn,
        sessionLabel,
        loggingIn,
        onLogin: () => void onLogin(),
        onLogout,
      }}
      onSubmit={onRequestClose}
    />
  );
}

type MediaServerCreateRowProps = {
  draft: EmbyMediaServer;
  disabled?: boolean;
  onChange: (draft: EmbyMediaServer) => void;
  onConfirm: () => void;
  /** 取消按钮已移至弹窗 footer；保留字段兼容既有挂载点 */
  onCancel?: () => void;
};

export function MediaServerCreateRow({
  draft,
  disabled,
  onChange,
  onConfirm,
}: MediaServerCreateRowProps) {
  return (
    <MediaServerFormBody
      mode="create"
      server={draft}
      disabled={disabled}
      idBase="emby-create-server"
      onChange={(patch) => onChange({ ...draft, ...patch })}
      onTypeChange={(type) =>
        onChange({
          ...draft,
          type,
          name:
            draft.name === 'Emby' || draft.name === 'Jellyfin'
              ? type === 'jellyfin'
                ? 'Jellyfin'
                : 'Emby'
              : draft.name,
        })
      }
      usernameValue={draft.username || ''}
      onUsernameChange={(value) => onChange({ ...draft, username: value })}
      capability={{
        apiKey: draft.apiKey,
        username: draft.username || '',
        password: draft.password || '',
      }}
      onSubmit={onConfirm}
    />
  );
}

function LibrarySyncStatusPanel({ status }: { status: LibrarySyncUiState }) {
  if (status.kind === 'idle') {
    return (
      <div
        id="emby-library-sync-status"
        className="emby-library-sync-status mx-2 mb-2 min-h-[1.25rem] text-[13px]"
        aria-live="polite"
      />
    );
  }

  if (status.kind === 'loading') {
    return (
      <div
        id="emby-library-sync-status"
        className="emby-library-sync-status is-loading mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-fg-muted)]"
        aria-live="polite"
      >
        正在同步媒体库...
      </div>
    );
  }

  if (status.kind === 'setup') {
    return (
      <div
        id="emby-library-sync-status"
        className="emby-library-sync-status is-warning mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px]"
        aria-live="polite"
      >
        <div className="font-medium text-[var(--color-warning,#d68910)]">{status.summary}</div>
        <div className="mt-1 text-[var(--color-fg-muted)]">{status.hint}</div>
      </div>
    );
  }

  const toneClass =
    status.kind === 'success'
      ? 'text-[var(--color-success,#27ae60)]'
      : 'text-[var(--color-danger,#c0392b)]';

  return (
    <div
      id="emby-library-sync-status"
      className={`emby-library-sync-status is-${status.kind} mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px]`}
      aria-live="polite"
    >
      <div className={`font-medium ${toneClass}`}>{status.summary}</div>
      {status.serverResults.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {status.serverResults.map((result, i) => {
            const success = result.success === true;
            const serverName = String(result.serverName || result.serverId || '未命名服务器');
            const serverType = String(result.serverType || 'media').toUpperCase();
            if (success) {
              return (
                <div
                  key={`${result.serverId || serverName}-${i}`}
                  className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                >
                  <div className="flex flex-wrap gap-2 font-medium">
                    <span>{serverName}</span>
                    <span className="text-[var(--color-fg-muted)]">{serverType}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
                    读取 {Number(result.itemCount || 0)} 个媒体条目，索引{' '}
                    {Number(result.indexedCount || 0)} 个番号。
                  </div>
                </div>
              );
            }
            const diagnosis = getLibrarySyncDiagnosis(String(result.error || '同步失败'));
            return (
              <div
                key={`${result.serverId || serverName}-${i}`}
                className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
              >
                <div className="flex flex-wrap gap-2 font-medium">
                  <span>{serverName}</span>
                  <span className="text-[var(--color-fg-muted)]">{serverType}</span>
                </div>
                <div className="mt-1 text-[var(--color-danger,#c0392b)]">{diagnosis.title}</div>
                <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
                  {diagnosis.description}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function LibraryCheckResultPanel({ status }: { status: LibraryCheckUiState }) {
  if (status.kind === 'idle') {
    return (
      <div
        id="emby-library-check-result"
        className="emby-library-check-result mt-2 min-h-[1.25rem] text-[13px]"
        aria-live="polite"
      />
    );
  }

  if (status.kind === 'loading') {
    return (
      <div
        id="emby-library-check-result"
        className="emby-library-check-result is-loading mt-2 text-[13px] text-[var(--color-fg-muted)]"
        aria-live="polite"
      >
        正在检测入库状态...
      </div>
    );
  }

  if (status.kind === 'empty') {
    return (
      <div
        id="emby-library-check-result"
        className="emby-library-check-result is-empty mt-2 text-[13px] text-[var(--color-fg-muted)]"
        aria-live="polite"
      >
        {status.message}
      </div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div
        id="emby-library-check-result"
        className="emby-library-check-result is-error mt-2 text-[13px] text-[var(--color-danger,#c0392b)]"
        aria-live="polite"
      >
        {status.message}
      </div>
    );
  }

  return (
    <div
      id="emby-library-check-result"
      className="emby-library-check-result is-success mt-2 text-[13px]"
      aria-live="polite"
    >
      <div className="mb-2 font-medium text-[var(--color-success,#27ae60)]">
        已入库：命中 {status.count} 个媒体条目
      </div>
      <div className="flex flex-col gap-2">
        {status.matches.map(({ code, entry, href }) => (
          <a
            key={`${code}-${entry.itemId}-${entry.serverUrl}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-wrap items-center gap-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-fg)] no-underline hover:border-[var(--color-primary)]"
          >
            {entry.coverImageUrl ? (
              <img
                className="h-14 w-10 rounded object-cover"
                src={entry.coverImageUrl}
                alt=""
                loading="lazy"
              />
            ) : null}
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              {entry.serverName || entry.serverType}
            </span>
            <span className="font-medium">{code}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-fg-muted)]">
              {entry.itemName || entry.itemId}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
