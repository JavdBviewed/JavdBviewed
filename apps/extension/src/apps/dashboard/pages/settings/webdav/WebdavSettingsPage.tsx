/**
 * @file WebdavSettingsPage.tsx
 * @description WebDAV 同步 React 全页（配置列表 / 设备 / 同步与备份范围）
 * @module apps/dashboard/pages/settings/webdav
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebDAVClientProfile, WebDAVKnownDeviceView } from '../../../../../types';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { Modal } from '../../../../../ui/primitives/Modal/Modal';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { showConfirm } from '../../../../../dashboard/components/confirmModal';
import {
  getSettings,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  backupAllWebdavConfigs,
  backupWebdavConfig,
  copyText,
  diagnoseActiveWebdavConnection,
  loadWebdavClients,
  persistWebdavForm,
  fetchNextSyncTime,
  testActiveWebdavConnection,
  testTempWebdavConfig,
  toast,
  updateDeviceLabel,
  type WebdavClientsSnapshot,
} from './webdavSettingsActions';
import {
  applyProviderToDraft,
  BACKUP_RANGE_OPTIONS,
  combineUrl,
  DEFAULT_WEBDAV_SETTINGS_FORM,
  deleteConfig,
  draftFromConfig,
  EMPTY_CONFIG_MODAL_DRAFT,
  formatDeviceTime,
  formatNextSyncLabel,
  getModalAlistHint,
  getProviderLabel,
  mapSettingsToWebdavForm,
  splitUrl,
  switchActiveConfig,
  upsertConfigFromDraft,
  validateConfigModalDraft,
  WEBDAV_PROVIDER_OPTIONS,
  type WebdavBackupRange,
  type WebdavConfigModalDraft,
  type WebdavProvider,
  type WebdavSettingsFormState,
} from './webdavSettingsModel';

const AUTO_SAVE_MS = 400;

type DeviceCardProps = {
  profile: WebDAVClientProfile | WebDAVKnownDeviceView;
  isCurrent: boolean;
  busy: boolean;
  onSaveLabel: (clientId: string, label: string, isCurrent: boolean) => void;
};

function DeviceCard({ profile, isCurrent, busy, onSaveLabel }: DeviceCardProps) {
  const [label, setLabel] = useState(profile.deviceLabel || '');
  useEffect(() => {
    setLabel(profile.deviceLabel || '');
  }, [profile.clientId, profile.deviceLabel]);

  const preferredName = profile.deviceLabel || profile.clientId || '未命名设备';
  const lastSeen = formatDeviceTime(profile.lastSeenAt);
  const lastSyncSource = profile.lastSyncAt || profile.lastSeenAt;
  const lastSync = lastSyncSource ? formatDeviceTime(lastSyncSource) : '从未';
  const remote = (profile as WebDAVKnownDeviceView).currentRemote;

  return (
    <div
      className={`rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-2)] hover:shadow-[var(--shadow-1)] ${
        isCurrent ? 'border-[var(--color-primary)]' : ''
      }`}
    >
      <div className="mb-2 text-[13.5px] font-semibold text-[var(--color-fg)]">
        {isCurrent ? '当前设备' : preferredName}
      </div>
      {remote ? (
        <div className="mb-2 flex flex-wrap gap-2 text-[12px]">
          <span
            className={
              remote.hasClientProfile
                ? 'text-[var(--color-success,#27ae60)]'
                : 'text-[var(--color-fg-muted)]'
            }
          >
            {remote.hasClientProfile ? '当前端有设备记录' : '当前端暂无设备记录'}
          </span>
          <span
            className={
              remote.hasBackup
                ? 'text-[var(--color-success,#27ae60)]'
                : 'text-[var(--color-fg-muted)]'
            }
          >
            {remote.hasBackup ? '当前端有备份' : '当前端暂无备份'}
          </span>
        </div>
      ) : null}
      <div className="mb-3 grid gap-1 text-[12.5px] text-[var(--color-fg-muted)]">
        <div>
          <strong className="text-[var(--color-fg)]">设备名称：</strong>
          {preferredName}
        </div>
        <div>
          <strong className="text-[var(--color-fg)]">设备 ID：</strong>
          <span className="break-all font-mono text-[11.5px]">{profile.clientId}</span>
        </div>
        <div>
          <strong className="text-[var(--color-fg)]">浏览器：</strong>
          {profile.browserName || 'Unknown'}
        </div>
        <div>
          <strong className="text-[var(--color-fg)]">最近在线：</strong>
          {lastSeen}
        </div>
        <div>
          <strong className="text-[var(--color-fg)]">最近同步：</strong>
          {lastSync}
        </div>
        <div>
          <strong className="text-[var(--color-fg)]">扩展版本：</strong>
          {profile.extensionVersion || 'unknown'}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-[12px] text-[var(--color-fg-muted)]">
            设备备注名称
          </label>
          <Input
            value={label}
            placeholder="例如：办公室电脑 / 家里笔记本"
            onChange={(e) => setLabel(e.currentTarget.value)}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => onSaveLabel(profile.clientId, label, isCurrent)}
        >
          <i className="fas fa-save" aria-hidden="true" /> 保存名称
        </Button>
      </div>
    </div>
  );
}

/**
 * WebDAV 同步完整页面
 */
export function WebdavSettingsPage() {
  const [form, setForm] = useState<WebdavSettingsFormState>(DEFAULT_WEBDAV_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nextSyncLabel, setNextSyncLabel] = useState('');
  const [clients, setClients] = useState<WebdavClientsSnapshot>({
    current: null,
    others: [],
  });
  const [clientsLoading, setClientsLoading] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);

  const [testing, setTesting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [backingUpAll, setBackingUpAll] = useState(false);
  const [backingUpId, setBackingUpId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WebdavConfigModalDraft>(EMPTY_CONFIG_MODAL_DRAFT);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [modalTesting, setModalTesting] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  const reloadFromStorage = useCallback(async () => {
    const settings = await getSettings();
    const nextForm = mapSettingsToWebdavForm(settings);
    formRef.current = nextForm;
    setForm(nextForm);
    return nextForm;
  }, []);

  const refreshNextSync = useCallback(async (nextForm: WebdavSettingsFormState) => {
    if (!nextForm.enabled || !nextForm.autoSync) {
      setNextSyncLabel(formatNextSyncLabel(false, false));
      return;
    }
    const scheduled = await fetchNextSyncTime();
    setNextSyncLabel(formatNextSyncLabel(true, true, scheduled));
  }, []);

  const refreshClients = useCallback(async (clientId?: string) => {
    setClientsLoading(true);
    try {
      const snap = await loadWebdavClients(clientId);
      setClients(snap);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const persist = useCallback(
    async (nextForm: WebdavSettingsFormState) => {
      const result = await persistWebdavForm(nextForm);
      if (!result.success) {
        setSaveError(result.error || '保存失败');
        return;
      }
      setSaveError(null);
      await refreshNextSync(nextForm);
    },
    [refreshNextSync],
  );

  const { scheduleSave, flush } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextForm = await reloadFromStorage();
        if (cancelled) return;
        // 旧配置迁移后立刻落盘
        if (
          nextForm.configs.length > 0 &&
          !(await getSettings() as any)?.webdav?.configs?.length
        ) {
          await persistWebdavForm(nextForm, { skipValidation: true, setupAlarms: false });
          await toast('✓ 已自动迁移旧配置', 'success');
        }
        await refreshNextSync(nextForm);
        await refreshClients(nextForm.clientId);
      } catch (err) {
        console.error('[WebdavSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadFromStorage, refreshNextSync, refreshClients]);

  const updateForm = useCallback(
    (updater: (prev: WebdavSettingsFormState) => WebdavSettingsFormState, immediate = false) => {
      const next = updater(formRef.current);
      formRef.current = next;
      setForm(next);
      if (immediate) void flush(next);
      else scheduleSave(next);
    },
    [flush, scheduleSave],
  );

  const sectionsEnabled = form.enabled;

  const alistHint = useMemo(
    () => getModalAlistHint(draft.provider, draft.url, draft.folder),
    [draft.provider, draft.url, draft.folder],
  );

  const openAddModal = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_CONFIG_MODAL_DRAFT });
    setPasswordVisible(false);
    setModalOpen(true);
  };

  const openEditModal = (configId: string) => {
    const config = form.configs.find((c) => c.id === configId);
    if (!config) {
      void toast('配置不存在', 'error');
      return;
    }
    setEditingId(configId);
    setDraft(draftFromConfig(config));
    setPasswordVisible(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft({ ...EMPTY_CONFIG_MODAL_DRAFT });
    setPasswordVisible(false);
  };

  const onProviderChange = (value: string) => {
    const provider = value as WebdavProvider;
    setDraft((prev) => {
      const next = applyProviderToDraft(prev, provider, editingId === null);
      if (provider === 'jianguoyun') {
        void toast('已自动填充坚果云服务器地址', 'info');
      } else if (provider === 'teracloud') {
        void toast('已自动填充 TeraCloud 服务器地址', 'info');
      }
      return next;
    });
  };

  const onCopyModalUrl = () => {
    void copyText(
      combineUrl(draft.url.trim(), draft.folder.trim()),
      '地址为空，无法复制',
      '✓ 已复制完整地址',
    );
  };

  const onSaveModal = async () => {
    const v = validateConfigModalDraft(draft, true);
    if (!v.ok || !v.fullUrl) {
      await toast(v.message || '输入无效', 'warning');
      return;
    }

    const { configs: nextConfigs, savedConfigId } = upsertConfigFromDraft(
      form.configs,
      draft,
      editingId,
    );

    const previousActive = form.activeConfigId;
    const hasPrevious =
      !!previousActive && nextConfigs.some((c) => c.id === previousActive);
    const nextActiveConfigId = editingId
      ? hasPrevious
        ? previousActive
        : savedConfigId
      : savedConfigId || previousActive;

    const nextFormBase: WebdavSettingsFormState = {
      ...form,
      configs: nextConfigs,
    };
    const nextForm = switchActiveConfig(nextFormBase, nextActiveConfigId || savedConfigId);

    formRef.current = nextForm;
    setForm(nextForm);
    const result = await persistWebdavForm(nextForm, { skipValidation: true });
    if (!result.success) {
      await toast(result.error || '保存配置失败', 'error');
      return;
    }
    closeModal();
    await toast(editingId ? '✓ 配置已更新' : '✓ 配置已添加', 'success');
    await refreshClients(nextForm.clientId);
  };

  const onTestModal = async () => {
    const v = validateConfigModalDraft(draft, false);
    if (!v.ok || !v.fullUrl) {
      await toast(v.message || '输入无效', 'warning');
      return;
    }
    setModalTesting(true);
    try {
      await testTempWebdavConfig(draft, v.fullUrl);
    } finally {
      setModalTesting(false);
    }
  };

  const onSwitchConfig = (configId: string) => {
    updateForm((prev) => switchActiveConfig(prev, configId), true);
    const name = form.configs.find((c) => c.id === configId)?.name || configId;
    void toast(`✓ 已切换到配置：${name}`, 'success');
    void refreshClients(form.clientId);
  };

  const onDeleteConfig = async (configId: string) => {
    const config = form.configs.find((c) => c.id === configId);
    if (!config) {
      await toast('配置不存在', 'error');
      return;
    }
    const confirmed = await showConfirm({
      title: '删除 WebDAV 配置',
      message: `确定要删除配置"${config.name}"吗？`,
      type: 'danger',
      confirmText: '删除',
    });
    if (!confirmed) return;
    updateForm((prev) => deleteConfig(prev, configId), true);
    await toast('✓ 配置已删除', 'success');
  };

  const onBackupOne = async (configId: string) => {
    setBackingUpId(configId);
    try {
      await backupWebdavConfig(configId);
      const next = await reloadFromStorage();
      await refreshClients(next.clientId);
    } finally {
      setBackingUpId(null);
    }
  };

  const onBackupAll = async () => {
    setBackingUpAll(true);
    try {
      await backupAllWebdavConfigs();
      const next = await reloadFromStorage();
      await refreshClients(next.clientId);
    } finally {
      setBackingUpAll(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      await testActiveWebdavConnection(form);
    } finally {
      setTesting(false);
    }
  };

  const onDiagnose = async () => {
    setDiagnosing(true);
    try {
      await diagnoseActiveWebdavConnection(form);
    } finally {
      setDiagnosing(false);
    }
  };

  const onSaveDeviceLabel = async (
    clientId: string,
    label: string,
    isCurrent: boolean,
  ) => {
    setDeviceBusy(true);
    try {
      const result = await updateDeviceLabel({
        clientId,
        deviceLabel: label,
        isCurrent,
      });
      if (result.success) {
        if (isCurrent) {
          const next = { ...formRef.current, deviceLabel: label.trim() };
          formRef.current = next;
          setForm(next);
        }
        await refreshClients(form.clientId);
      }
    } finally {
      setDeviceBusy(false);
    }
  };

  const applyAlistHint = () => {
    if (!alistHint) return;
    const { baseUrl, folder } = splitUrl(alistHint.suggestedUrl);
    setDraft((prev) => ({ ...prev, url: baseUrl, folder }));
  };

  const updateBackupRange = (key: keyof WebdavBackupRange, value: boolean) => {
    updateForm((prev) => ({
      ...prev,
      backupRange: { ...prev.backupRange, [key]: value },
    }));
  };

  return (
    <SettingsPageFrame
      title="WebDAV同步"
      description="通过WebDAV协议，将您的观看记录备份到兼容的云存储服务（如：坚果云、Nextcloud等）。"
      rootDataAttrs={{ 'data-webdav-settings-react': '1' }}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="webdav-settings">
          <SettingSection title="主开关" icon={<i className="fas fa-server" />}>
            <SettingToggleRow
              id="webdavEnabled"
              label="启用 WebDAV 同步"
              checked={form.enabled}
              onChange={(v) =>
                updateForm((prev) => ({ ...prev, enabled: v }), true)
              }
            />
          </SettingSection>

          <div
            className={
              sectionsEnabled
                ? 'flex flex-col gap-4'
                : 'flex flex-col gap-4 opacity-55 pointer-events-none'
            }
            aria-disabled={!sectionsEnabled}
          >
            <SettingSection
              id="webdavConfigSection"
              title="配置管理"
              icon={<i className="fas fa-laptop-house" />}
              description="可添加多个备份端；默认备份端用于测试连接、自动同步与恢复入口。"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2">
                <Button id="addWebdavConfig" variant="primary" size="sm" onClick={openAddModal}>
                  <i className="fas fa-plus" aria-hidden="true" /> 添加配置
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button
                    id="backupAllWebdavConfigs"
                    variant="secondary"
                    size="sm"
                    disabled={backingUpAll || form.configs.length === 0}
                    onClick={() => void onBackupAll()}
                  >
                    <i className="fas fa-database" aria-hidden="true" />{' '}
                    {backingUpAll ? '正在备份…' : '备份到全部备份端'}
                  </Button>
                  <Button
                    id="testWebdavConnection"
                    variant="secondary"
                    size="sm"
                    disabled={testing}
                    onClick={() => void onTest()}
                  >
                    <i className="fas fa-plug" aria-hidden="true" />{' '}
                    {testing ? '测试中…' : '测试连接'}
                  </Button>
                  <Button
                    id="diagnoseWebdavConnection"
                    variant="secondary"
                    size="sm"
                    disabled={diagnosing}
                    onClick={() => void onDiagnose()}
                  >
                    <i className="fas fa-stethoscope" aria-hidden="true" />{' '}
                    {diagnosing ? '诊断中…' : '诊断连接'}
                  </Button>
                </div>
              </div>

              <div id="webdavConfigList" className="flex flex-col gap-2 px-2 py-2">
                {form.configs.length === 0 ? (
                  <div className="rounded-[var(--radius-2)] border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-[13px] text-[var(--color-fg-muted)]">
                    暂无保存的配置，点击「添加配置」创建新配置
                  </div>
                ) : (
                  form.configs.map((config) => {
                    const isActive = config.id === form.activeConfigId;
                    return (
                      <div
                        key={config.id}
                        className={`flex flex-wrap items-center gap-3 rounded-[var(--radius-2)] border px-3 py-2 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-1)] ${
                          isActive
                            ? 'border-[var(--color-primary)] bg-[var(--color-surface-2)]'
                            : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                        }`}
                        data-config-id={config.id}
                      >
                        <label className="flex items-center gap-2 text-[13px] text-[var(--color-fg)]">
                          <input
                            type="radio"
                            name="webdav-config"
                            value={config.id}
                            checked={isActive}
                            onChange={() => onSwitchConfig(config.id)}
                          />
                          <span className="font-semibold">{config.name}</span>
                        </label>
                        {isActive ? (
                          <span className="rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-[11.5px] text-[var(--color-primary)]">
                            默认备份端
                          </span>
                        ) : null}
                        <div className="flex flex-wrap gap-3 text-[12px] text-[var(--color-fg-muted)]">
                          <span>{getProviderLabel(config.provider)}</span>
                          <span>{config.username}</span>
                          {config.lastSync ? (
                            <span>{new Date(config.lastSync).toLocaleString()}</span>
                          ) : null}
                        </div>
                        <div className="ml-auto flex flex-wrap gap-1">
                          {!isActive ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onSwitchConfig(config.id)}
                            >
                              <i className="fas fa-star" aria-hidden="true" /> 设为默认
                            </Button>
                          ) : null}
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={backingUpId === config.id || backingUpAll}
                            onClick={() => void onBackupOne(config.id)}
                            title="立即备份到此端"
                          >
                            <i className="fas fa-cloud-upload-alt" aria-hidden="true" />{' '}
                            {backingUpId === config.id ? '备份中…' : '立即备份'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(config.id)}
                          >
                            <i className="fas fa-edit" aria-hidden="true" /> 编辑
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => void onDeleteConfig(config.id)}
                          >
                            <i className="fas fa-trash" aria-hidden="true" /> 删除
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </SettingSection>

            <SettingSection
              id="webdavClientsSection"
              title="客户端与设备"
              icon={<i className="fas fa-users" />}
              description="设备清单会在不同备份端之间补齐；可恢复内容仍以当前备份端里的备份文件为准。"
            >
              <div className="flex flex-wrap items-center gap-2 px-2 py-2">
                <Button
                  id="refreshWebdavClients"
                  variant="secondary"
                  size="sm"
                  disabled={clientsLoading}
                  onClick={() => void refreshClients(form.clientId)}
                >
                  <i className="fas fa-rotate-right" aria-hidden="true" />{' '}
                  {clientsLoading ? '刷新中…' : '刷新设备列表'}
                </Button>
              </div>

              <div className="px-2 pb-1 text-[12.5px] font-semibold text-[var(--color-fg)]">
                已知设备
              </div>

              <div id="webdavClientProfile" className="flex flex-col gap-2 px-2 py-2">
                {clientsLoading && !clients.current ? (
                  <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">
                    正在加载当前客户端信息...
                  </p>
                ) : clients.current ? (
                  <DeviceCard
                    profile={clients.current}
                    isCurrent
                    busy={deviceBusy}
                    onSaveLabel={(id, label, isCurrent) =>
                      void onSaveDeviceLabel(id, label, isCurrent)
                    }
                  />
                ) : (
                  <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">
                    当前设备信息加载失败
                  </p>
                )}
              </div>

              <div id="webdavClientsList" className="flex flex-col gap-2 px-2 py-2">
                {clients.notice ? (
                  <p className="m-0 text-[12.5px] text-[var(--color-warning,#d68910)]">
                    {clients.notice}，先显示本地保存的设备清单。
                  </p>
                ) : null}
                {clients.error && clients.others.length === 0 ? (
                  <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">{clients.error}</p>
                ) : clientsLoading && clients.others.length === 0 ? (
                  <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">
                    正在加载已知设备...
                  </p>
                ) : clients.others.length === 0 ? (
                  <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">
                    暂无其他已知设备
                  </p>
                ) : (
                  clients.others.map((client) => (
                    <DeviceCard
                      key={client.clientId}
                      profile={client}
                      isCurrent={false}
                      busy={deviceBusy}
                      onSaveLabel={(id, label, isCurrent) =>
                        void onSaveDeviceLabel(id, label, isCurrent)
                      }
                    />
                  ))
                )}
              </div>
            </SettingSection>

            <SettingSection id="webdavSyncSection" title="同步设置" icon={<i className="fas fa-cog" />}>
              <SettingToggleRow
                id="webdavAutoSync"
                label="自动上传"
                checked={form.autoSync}
                onChange={(v) =>
                  updateForm((prev) => ({ ...prev, autoSync: v }), true)
                }
              />
              <div className="grid gap-3 px-2 py-2 sm:grid-cols-3">
                <SettingField
                  id="webdav-sync-interval"
                  label="同步间隔（分钟）"
                  description={
                    nextSyncLabel ? <span id="webdav-next-sync-time">{nextSyncLabel}</span> : undefined
                  }
                >
                  <Input
                    id="webdav-sync-interval"
                    type="number"
                    min={1}
                    max={1440}
                    value={String(form.syncInterval)}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (!Number.isFinite(n)) return;
                      updateForm((prev) => ({ ...prev, syncInterval: n }));
                    }}
                  />
                </SettingField>
                <SettingField id="webdav-retention-days" label="每设备保留（个）">
                  <Input
                    id="webdav-retention-days"
                    type="number"
                    min={0}
                    max={9999}
                    value={String(form.retentionDays)}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (!Number.isFinite(n)) return;
                      updateForm((prev) => ({ ...prev, retentionDays: n }));
                    }}
                  />
                </SettingField>
                <SettingField id="webdav-warning-days" label="预警天数（天）">
                  <Input
                    id="webdav-warning-days"
                    type="number"
                    min={0}
                    max={3650}
                    value={String(form.warningDays)}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (!Number.isFinite(n)) return;
                      updateForm((prev) => ({ ...prev, warningDays: n }));
                    }}
                  />
                </SettingField>
              </div>
            </SettingSection>

            <SettingSection
              id="webdavBackupSection"
              title="备份数据范围"
              icon={<i className="fas fa-database" />}
              description="选择要备份到云端的数据类型"
            >
              <div className="flex flex-col gap-1 px-2 py-2">
                {BACKUP_RANGE_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className="flex items-start gap-2 rounded-[var(--radius-2)] px-2 py-1.5 text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
                  >
                    <input
                      id={opt.id}
                      type="checkbox"
                      className="mt-1"
                      checked={form.backupRange[opt.key]}
                      onChange={(e) =>
                        updateBackupRange(opt.key, e.currentTarget.checked)
                      }
                    />
                    <span>
                      <span className="font-semibold">{opt.label}</span>
                      <span className="mt-0.5 block text-[12px] text-[var(--color-fg-muted)]">
                        {opt.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </SettingSection>
          </div>

          {saveError ? (
            <p className="m-0 px-2 text-[12.5px] text-[var(--color-danger)]">{saveError}</p>
          ) : null}

          <Modal
            open={modalOpen}
            title={editingId ? '编辑配置' : '添加配置'}
            onClose={closeModal}
            className="webdav-config-modal-react"
            dialogId="webdavConfigModal"
            titleId="webdavConfigModalTitle"
            closeButtonId="closeWebdavConfigModal"
            keepMounted
            footer={
              <>
                <Button
                  id="cancelWebdavConfigModal"
                  variant="secondary"
                  className="webdav-modal-cancel-button"
                  onClick={closeModal}
                >
                  取消
                </Button>
                <Button
                  id="testWebdavConfigModal"
                  variant="secondary"
                  className="webdav-modal-test-button"
                  disabled={modalTesting}
                  onClick={() => void onTestModal()}
                >
                  <i className="fas fa-plug" aria-hidden="true" />{' '}
                  {modalTesting ? '测试中…' : '测试连接'}
                </Button>
                <Button
                  id="saveWebdavConfigModal"
                  variant="primary"
                  className="webdav-modal-save-button"
                  onClick={() => void onSaveModal()}
                >
                  保存
                </Button>
              </>
            }
          >
            <div className="webdav-modal-fields text-[var(--color-fg)]">
              <SettingField id="modalConfigName" label="配置名称" className="webdav-modal-field">
                <Input
                  id="modalConfigName"
                  value={draft.name}
                  placeholder="例如: 坚果云配置"
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setDraft((prev) => ({ ...prev, name: value }));
                  }}
                />
              </SettingField>

              <SettingField
                id="modalWebdavUrl"
                className="webdav-modal-field webdav-modal-url-field"
                label={
                  <span className="webdav-modal-label-content">
                    <span>WebDAV 地址</span>
                    <Button
                      id="modalCopyWebdavFullUrl"
                      variant="ghost"
                      size="sm"
                      className="webdav-modal-label-action"
                      title="复制完整地址"
                      aria-label="复制完整地址"
                      onClick={onCopyModalUrl}
                    >
                      <i className="fas fa-copy" aria-hidden="true" />
                    </Button>
                  </span>
                }
              >
                <div className="webdav-modal-url-row flex flex-wrap items-start gap-2">
                  <Input
                    id="modalWebdavUrl"
                    className="webdav-modal-url-input min-w-[200px] flex-1"
                    value={draft.url}
                    placeholder="例如: https://dav.jianguoyun.com/dav/"
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setDraft((prev) => ({ ...prev, url: value }));
                    }}
                  />
                  <SettingSelect
                    id="modalWebdavProvider"
                    value={draft.provider}
                    options={[...WEBDAV_PROVIDER_OPTIONS]}
                    className="webdav-modal-provider-select w-[120px]"
                    onChange={onProviderChange}
                  />
                  <Input
                    id="modalWebdavFolder"
                    className="webdav-modal-folder-input w-[150px]"
                    value={draft.folder}
                    placeholder="文件夹 (可选)"
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setDraft((prev) => ({ ...prev, folder: value }));
                    }}
                  />
                </div>
                <p className="webdav-modal-field-description">
                  选择厂商后会自动填充服务器地址，文件夹为远端存储路径（可选，留空则使用根目录）
                </p>
                <div
                  id="modalWebdavAlistHint"
                  hidden={!alistHint}
                  className="webdav-alist-hint"
                >
                  {alistHint ? (
                    <>
                      <div className="webdav-alist-hint-main">
                        <i className="fas fa-info-circle" aria-hidden="true" />
                        <span>{alistHint.message}</span>
                      </div>
                      <div className="webdav-alist-hint-action">
                        <code>{alistHint.suggestedUrl}</code>
                        <Button variant="secondary" size="sm" onClick={applyAlistHint}>
                          <i className="fas fa-magic" aria-hidden="true" /> 应用建议
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>
              </SettingField>

              <SettingField id="modalWebdavUser" label="用户名" className="webdav-modal-field">
                <div className="webdav-modal-input-wrap">
                  <Input
                    id="modalWebdavUser"
                    className="webdav-modal-input pr-11"
                    value={draft.username}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setDraft((prev) => ({
                        ...prev,
                        username: value,
                      }));
                    }}
                  />
                  <Button
                    id="modalCopyWebdavUser"
                    variant="ghost"
                    size="sm"
                    className="webdav-modal-input-action webdav-modal-copy-action"
                    title="复制用户名"
                    aria-label="复制用户名"
                    onClick={() =>
                      void copyText(
                        draft.username.trim(),
                        '用户名为空，无法复制',
                        '✓ 已复制用户名',
                      )
                    }
                  >
                    <i className="fas fa-copy" aria-hidden="true" />
                  </Button>
                </div>
              </SettingField>

              <SettingField id="modalWebdavPass" label="密码/应用密钥" className="webdav-modal-field">
                <div className="webdav-modal-input-wrap">
                  <Input
                    id="modalWebdavPass"
                    className="webdav-modal-input webdav-modal-password-input pr-20"
                    type={passwordVisible ? 'text' : 'password'}
                    value={draft.password}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setDraft((prev) => ({
                        ...prev,
                        password: value,
                      }));
                    }}
                  />
                  <Button
                    id="modalToggleWebdavPasswordVisibility"
                    variant="ghost"
                    size="sm"
                    className="webdav-modal-input-action webdav-modal-toggle-action"
                    title="显示/隐藏密码"
                    aria-label="显示/隐藏密码"
                    onClick={() => setPasswordVisible((v) => !v)}
                  >
                    <i
                      className={`fas ${passwordVisible ? 'fa-eye-slash' : 'fa-eye'}`}
                      aria-hidden="true"
                    />
                  </Button>
                  <Button
                    id="modalCopyWebdavPass"
                    variant="ghost"
                    size="sm"
                    className="webdav-modal-input-action webdav-modal-copy-action"
                    title="复制密码"
                    aria-label="复制密码"
                    onClick={() =>
                      void copyText(draft.password, '密码为空，无法复制', '✓ 已复制密码')
                    }
                  >
                    <i className="fas fa-copy" aria-hidden="true" />
                  </Button>
                </div>
              </SettingField>
            </div>
          </Modal>
        </div>
      )}
    </SettingsPageFrame>
  );
}
