/**
 * @file CloudSettingsPage.tsx
 * @description Cloud 多端同步设置页：对齐其它设置页的卡片密度、状态反馈与操作提示
 * @module apps/dashboard/pages/settings/cloud
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DeviceInfo } from '@javdb/sync-protocol';
import { Badge } from '../../../../../ui/primitives/Badge/Badge';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { Modal } from '../../../../../ui/primitives/Modal/Modal';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { SettingsHighlightNotice } from '../shared/SettingsHighlightNotice';
import type { SettingsSectionNavItem } from '../shared/SettingsSectionNav';
import {
  createExtensionCloudFacade,
  formatTypeCounts,
  humanizeCloudError,
  normalizeCloudBaseUrl,
  type CloudAutoSyncSettings,
  type CloudConnectionSettings,
  type CloudSessionRecord,
  type CloudSyncNowResult,
  type TypeCountMap,
} from '../../../../../features/cloudSync';
import './cloudSettings.css';

type StatusTone = 'idle' | 'ok' | 'err' | 'busy' | 'warn';
type HealthState = 'unknown' | 'ok' | 'err' | 'checking';
type AutoConnectionState = 'idle' | 'connecting' | 'failed';

type SyncReport = CloudSyncNowResult & {
  finishedAt: number;
};

type SyncProgressState = {
  open: boolean;
  stage: 'preparing' | 'syncing' | 'complete' | 'error';
  report?: SyncReport;
  error?: string;
};

const INTERVAL_OPTIONS = [
  { value: '15', label: '15 分钟' },
  { value: '30', label: '30 分钟' },
  { value: '60', label: '1 小时' },
  { value: '180', label: '3 小时' },
];

const CLOUD_SECTION_IDS = {
  overview: 'cloud-section-overview',
  sync: 'cloud-section-sync',
  connection: 'cloud-section-connection',
  devices: 'cloud-section-devices',
  scope: 'cloud-section-scope',
} as const;

const CLOUD_SECTION_NAV_ITEMS: SettingsSectionNavItem[] = [
  { id: CLOUD_SECTION_IDS.overview, label: '状态总览', shortLabel: '总览' },
  { id: CLOUD_SECTION_IDS.sync, label: '同步', shortLabel: '同步' },
  { id: CLOUD_SECTION_IDS.connection, label: '连接服务', shortLabel: '连接' },
  { id: CLOUD_SECTION_IDS.devices, label: '已登录设备', shortLabel: '设备' },
  { id: CLOUD_SECTION_IDS.scope, label: '同步范围与说明', shortLabel: '范围' },
];

async function toast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' | 'warn' = 'info',
): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type as 'success' | 'info' | 'error' | 'warning' | 'warn');
  } catch {
    // ignore
  }
}

/**
 * Cloud 同步设置完整页面
 */
export function CloudSettingsPage() {
  const [settings, setSettings] = useState<CloudConnectionSettings | null>(null);
  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const [deviceLabelDraft, setDeviceLabelDraft] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [session, setSession] = useState<CloudSessionRecord | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [healthState, setHealthState] = useState<HealthState>('unknown');
  const [healthDetail, setHealthDetail] = useState('尚未检测');
  const [banner, setBanner] = useState<{ text: string; tone: StatusTone } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>({
    open: false,
    stage: 'preparing',
  });
  const [connDirty, setConnDirty] = useState(false);
  const [connectionEditorOpen, setConnectionEditorOpen] = useState(false);
  const [autoConnectionState, setAutoConnectionState] = useState<AutoConnectionState>('idle');
  const [autoSync, setAutoSync] = useState<CloudAutoSyncSettings>({
    enabled: true,
    intervalMinutes: 30,
    updatedAt: 0,
  });
  const autoConnectAttemptRef = useRef('');

  const facade = useMemo(() => createExtensionCloudFacade(), []);
  const busy = busyAction != null;
  const loggedIn = Boolean(session?.accessToken);
  const normalizedDraft = useMemo(
    () => normalizeCloudBaseUrl(baseUrlDraft),
    [baseUrlDraft],
  );
  const connectionReady = Boolean(normalizedDraft);
  const baseUrlInvalid = baseUrlDraft.trim().length > 0 && !connectionReady;
  const configuredBaseUrl = normalizeCloudBaseUrl(settings?.baseUrl || '') || '未配置地址';
  const hasSavedCredentials = Boolean(settings?.accountIdentifier && settings?.accountPassword);

  const setStatus = useCallback((text: string, tone: StatusTone) => {
    setBanner({ text, tone });
  }, []);

  const withBusy = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    try {
      await fn();
    } finally {
      setBusyAction(null);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!loggedIn) {
      setDevices([]);
      return;
    }
    try {
      setDevices(await facade.listDevices());
    } catch {
      // token 可能过期
    }
  }, [facade, loggedIn]);

  const persistConnection = useCallback(async () => {
    try {
      const next = await facade.saveConnection({
        baseUrl: baseUrlDraft,
        deviceLabel: deviceLabelDraft,
        identifier: identifier.trim(),
        password,
      });
      setSettings(next);
      setBaseUrlDraft(next.baseUrl);
      setDeviceLabelDraft(next.deviceLabel);
      setConnDirty(false);
      return next;
    } catch (e) {
      const msg = humanizeCloudError(e);
      setStatus(msg, 'err');
      await toast('请填写有效的 Cloud 地址', 'warning');
      return null;
    }
  }, [baseUrlDraft, deviceLabelDraft, facade, identifier, password, setStatus]);

  const probeHealthUrl = useCallback(
    async (baseUrl: string, opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      const root = normalizeCloudBaseUrl(baseUrl);
      if (!root) {
        setHealthState('err');
        setHealthDetail('地址无效');
        if (!silent) {
          setStatus('请填写有效的 Cloud 地址', 'err');
          await toast('地址无效', 'warning');
        }
        return false;
      }
      if (!silent) setHealthState('checking');
      try {
        const result = await facade.checkHealth(root);
        if (!result.ok) {
          setHealthState('err');
          setHealthDetail(result.detail);
          if (!silent) {
            setStatus('健康检查失败：请确认 Cloud 服务已启动且地址端口正确', 'err');
            await toast(result.detail === '地址无效' ? '地址无效' : '连接失败', 'error');
          }
          return false;
        }
        setHealthState('ok');
        setHealthDetail(result.detail);
        if (!silent) {
          setStatus('已连通 Cloud 服务', 'ok');
          await toast('✓ 连接正常', 'success');
        }
        return true;
      } catch (e) {
        setHealthState('err');
        setHealthDetail('无法连接');
        if (!silent) {
          const msg = humanizeCloudError(e);
          setStatus(msg, 'err');
          await toast(msg, 'error');
        }
        return false;
      }
    },
    [facade, setStatus],
  );

  const runSyncWithProgress = useCallback(async (showProgress = true): Promise<SyncReport> => {
    if (showProgress) setSyncProgress({ open: true, stage: 'preparing' });
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (showProgress) setSyncProgress({ open: true, stage: 'syncing' });
    const result = await facade.syncNow();
    const report: SyncReport = { ...result, finishedAt: Date.now() };
    setSyncReport(report);
    if (showProgress) setSyncProgress({ open: true, stage: 'complete', report });
    setStatus(
      result.message || `同步完成：↑${result.pushed} ↓${result.pulled}`,
      result.code === 'SYNC_PARTIAL' ? 'warn' : 'ok',
    );
    try {
      setDevices(await facade.listDevices());
    } catch {
      // 同步成功不依赖设备列表刷新
    }
    return report;
  }, [facade, setStatus]);

  const loginAndSync = useCallback(async (showProgress = true) => {
    if (!identifier.trim() || !password) {
      throw new Error('请填写账号与密码');
    }
    const state = await facade.login({ identifier: identifier.trim(), password });
    setSettings(state.settings);
    setAutoSync(state.autoSync);
    setSession(state.session);
    setDevices(state.devices);
    setShowPassword(false);
    await runSyncWithProgress(showProgress);
  }, [facade, identifier, password, runSyncWithProgress]);

  // 仅挂载加载一次，避免输入被 effect 覆盖
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loadedSettings: CloudConnectionSettings | null = null;
      try {
        const state = await facade.loadState();
        if (cancelled) return;
        loadedSettings = state.settings;
        setSettings(state.settings);
        setBaseUrlDraft(state.settings.baseUrl);
        setDeviceLabelDraft(state.settings.deviceLabel);
        setIdentifier(state.settings.accountIdentifier || '');
        setPassword(state.settings.accountPassword || '');
        setAutoSync(state.autoSync);
        setSession(state.session);
        setDevices(state.devices);
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled || !loadedSettings) return;
      if (normalizeCloudBaseUrl(loadedSettings.baseUrl)) {
        void probeHealthUrl(loadedSettings.baseUrl, { silent: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facade, probeHealthUrl]);

  useEffect(() => {
    if (loading || !loggedIn) return;
    void refreshDevices();
  }, [loading, loggedIn, session?.accessToken, refreshDevices]);

  const onSaveConnection = () =>
    void withBusy('save', async () => {
      try {
        const saved = await persistConnection();
        if (!saved) return;
        // 保存动作已负责首轮自动连接，避免 effect 随后用同一份凭证重复发起登录请求。
        autoConnectAttemptRef.current = `${saved.updatedAt}:${saved.baseUrl}:${saved.accountIdentifier}`;
        if (!identifier.trim() || !password) {
          setAutoConnectionState('idle');
          setStatus('连接已保存，请补充账号密码后自动连接', 'warn');
          await toast('连接已保存，请填写账号密码', 'info');
          setConnectionEditorOpen(false);
          void probeHealthUrl(saved.baseUrl, { silent: true });
          return;
        }
        setAutoConnectionState('connecting');
        if (!await probeHealthUrl(saved.baseUrl, { silent: true })) {
          setAutoConnectionState('failed');
          setStatus('连接已保存，但自动连接失败：请检查服务地址', 'err');
          setConnectionEditorOpen(false);
          return;
        }
        await loginAndSync(true);
        setAutoConnectionState('idle');
        setStatus('已自动登录并完成首次同步', 'ok');
        await toast('✓ 已自动登录并完成首次同步', 'success');
        setConnectionEditorOpen(false);
      } catch (e) {
        setAutoConnectionState('failed');
        const msg = humanizeCloudError(e);
        setStatus(`自动连接或同步失败：${msg}`, 'err');
        setConnectionEditorOpen(false);
      }
    });

  const onProbeHealth = () =>
    void withBusy('health', async () => {
      // 测试连接时一并保存草稿，避免「测的是旧地址」
      const saved = await persistConnection();
      if (!saved) return;
      await probeHealthUrl(saved.baseUrl, { silent: false });
    });

  const openConnectionEditor = () => {
    if (!settings) return;
    setBaseUrlDraft(settings.baseUrl);
    setDeviceLabelDraft(settings.deviceLabel);
    setIdentifier(settings.accountIdentifier || '');
    setPassword(settings.accountPassword || '');
    setShowPassword(false);
    setConnDirty(false);
    setConnectionEditorOpen(true);
  };

  const closeConnectionEditor = () => {
    if (!settings || busyAction === 'save' || busyAction === 'health') return;
    setBaseUrlDraft(settings.baseUrl);
    setDeviceLabelDraft(settings.deviceLabel);
    setIdentifier(settings.accountIdentifier || '');
    setPassword(settings.accountPassword || '');
    setShowPassword(false);
    setConnDirty(false);
    setConnectionEditorOpen(false);
  };

  const onRegister = () =>
    void withBusy('register', async () => {
      try {
        const saved = await persistConnection();
        if (!saved) return;
        if (!identifier.trim() || !password) {
          setStatus('请填写账号与密码', 'err');
          await toast('请填写账号与密码', 'warning');
          return;
        }
        const ok = await probeHealthUrl(saved.baseUrl, { silent: true });
        if (!ok) {
          setStatus('无法连接 Cloud，请先确认地址与服务状态', 'err');
          await toast('请先测试连接成功再注册', 'warning');
          return;
        }
        await facade.register({ identifier: identifier.trim(), password });
        setStatus('注册成功，请点击登录', 'ok');
        await toast('✓ 注册成功，请登录', 'success');
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });

  const onLogin = () =>
    void withBusy('login', async () => {
      try {
        const saved = await persistConnection();
        if (!saved) return;
        if (!identifier.trim() || !password) {
          setStatus('请填写账号与密码', 'err');
          await toast('请填写账号与密码', 'warning');
          return;
        }
        const ok = await probeHealthUrl(saved.baseUrl, { silent: true });
        if (!ok) {
          setStatus('无法连接 Cloud，请先确认地址与服务状态', 'err');
          await toast('请先测试连接成功再登录', 'warning');
          return;
        }
        await loginAndSync(true);
        setStatus('已自动登录并完成首次同步', 'ok');
        await toast('✓ 已自动登录并完成首次同步', 'success');
        setConnectionEditorOpen(false);
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });

  // 兼容旧版本只保存账号密码但尚未建立本机会话的用户：进入设置后自动恢复并同步一次。
  useEffect(() => {
    if (loading || loggedIn || !settings || busyAction) return;
    if (!settings.accountIdentifier || !settings.accountPassword) return;
    const attemptKey = `${settings.updatedAt}:${settings.baseUrl}:${settings.accountIdentifier}`;
    if (autoConnectAttemptRef.current === attemptKey) return;
    autoConnectAttemptRef.current = attemptKey;
    setAutoConnectionState('connecting');
    void withBusy('auto-connect', async () => {
      try {
        if (!await probeHealthUrl(settings.baseUrl, { silent: true })) {
          setAutoConnectionState('failed');
          setStatus('自动连接失败：请检查 Cloud 服务地址', 'err');
          return;
        }
        await loginAndSync(false);
        setAutoConnectionState('idle');
        setStatus('已自动登录并完成首次同步', 'ok');
      } catch (e) {
        setAutoConnectionState('failed');
        const msg = humanizeCloudError(e);
        setStatus(`自动连接或同步失败：${msg}`, 'err');
      }
    });
  }, [busyAction, loading, loggedIn, loginAndSync, probeHealthUrl, setStatus, settings, withBusy]);

  const onReconnect = () => {
    if (busy || !hasSavedCredentials) return;
    void withBusy('reconnect', async () => {
      setAutoConnectionState('connecting');
      try {
        if (!await probeHealthUrl(settings?.baseUrl || '', { silent: true })) {
          setAutoConnectionState('failed');
          setStatus('重新连接失败：请检查 Cloud 服务地址', 'err');
          return;
        }
        await loginAndSync(true);
        setAutoConnectionState('idle');
        setStatus('已重新连接并完成同步', 'ok');
      } catch (e) {
        setAutoConnectionState('failed');
        setStatus(`重新连接或同步失败：${humanizeCloudError(e)}`, 'err');
      }
    });
  };

  const onLogout = () =>
    void withBusy('logout', async () => {
      try {
        const state = await facade.logout();
        setSettings(state.settings);
        setAutoSync(state.autoSync);
        setSession(state.session);
        setDevices(state.devices);
        setSyncReport(null);
        setStatus('已退出本机 Cloud 会话', 'ok');
        await toast('已退出登录', 'info');
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });

  const onRefreshDevices = () =>
    void withBusy('devices', async () => {
      try {
        const list = await facade.listDevices();
        setDevices(list);
        setStatus(`设备列表已更新（${list.length} 台）`, 'ok');
        await toast(`✓ 已刷新 ${list.length} 台设备`, 'success');
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });

  const onRevokeDevice = (device: DeviceInfo) => {
    if (!settings) return;
    if (device.id === settings.deviceId) {
      setStatus('不能踢掉本机，请使用「退出登录」', 'warn');
      void toast('不能踢出本机设备', 'warning');
      return;
    }
    const label = device.label || device.id.slice(0, 8);
    if (!window.confirm(`确定踢出设备「${label}」？\n该设备需重新登录后才能同步。`)) {
      return;
    }
    void withBusy(`revoke:${device.id}`, async () => {
      try {
        setDevices(await facade.revokeDevice(device.id));
        setStatus(`已踢出「${label}」`, 'ok');
        await toast(`✓ 已踢出 ${label}`, 'success');
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });
  };

  const onSyncNow = () => {
    if (!loggedIn || busy) return;
    void withBusy('sync', async () => {
      try {
        await runSyncWithProgress(true);
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        setSyncProgress({ open: true, stage: 'error', error: msg });
      }
    });
  };

  const onToggleAutoSync = (enabled: boolean) =>
    void withBusy('auto', async () => {
      const next = await facade.setAutoSync({ enabled });
      setAutoSync(next);
      setStatus(enabled ? '已开启后台自动同步' : '已关闭后台自动同步', 'ok');
      await toast(enabled ? '✓ 已开启自动同步' : '已关闭自动同步', 'info');
    });

  const onChangeInterval = (value: string) =>
    void withBusy('auto', async () => {
      const minutes = Number(value);
      const next = await facade.setAutoSync({ intervalMinutes: minutes });
      setAutoSync(next);
      setStatus(`自动同步间隔：${next.intervalMinutes} 分钟`, 'ok');
      await toast(`✓ 间隔已设为 ${next.intervalMinutes} 分钟`, 'success');
    });

  if (loading || !settings) {
    return (
      <SettingsPageFrame
        title="Cloud 多端同步"
        description="连接自建 JavdBviewed-Cloud，多端共享用户资产"
        rootDataAttrs={{ 'data-cloud-settings-react': '1' }}
      >
        <div className="flex items-center gap-3 rounded-[var(--radius-3)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 shadow-[var(--shadow-1)]">
          <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-[var(--color-primary)]/60" />
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--color-fg)]">正在加载 Cloud 设置…</p>
            <p className="mt-1 mb-0 text-[12.5px] text-[var(--color-fg-muted)]">
              读取本机连接配置与登录会话
            </p>
          </div>
        </div>
      </SettingsPageFrame>
    );
  }

  const loginDetail = loggedIn
    ? `${settings.deviceLabel}${session?.userId ? ` · ${shortId(session.userId, 10)}` : ''}`
    : '登录后可同步用户资产';

  return (
    <SettingsPageFrame
      title="Cloud 多端同步"
      description="多浏览器 / 多端共用的账号数据中枢。与 WebDAV 冷备份并存，互不替代。"
      rootDataAttrs={{ 'data-cloud-settings-react': '1' }}
      sectionNavItems={CLOUD_SECTION_NAV_ITEMS}
    >
      <div id="cloud-settings" className="cloud-settings">
        <SettingsHighlightNotice title="Cloud 功能仍在测试中">
          多端同步已开放给自建服务使用，但仍可能遇到连接、合并或兼容问题。遇到异常可以到{' '}
          <a
            href="https://github.com/lmixture/JavdBviewed/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Issues
          </a>{' '}
          反馈现象、截图和日志。
        </SettingsHighlightNotice>

        {/* 总览条 */}
      <div id={CLOUD_SECTION_IDS.overview} className="cloud-overview-grid">
        <OverviewCard
          label="服务"
          badge={healthBadge(healthState)}
          detail={healthDetail}
          meta={configuredBaseUrl}
        />
        <OverviewCard
          label="登录"
          badge={
            loggedIn ? (
              <Badge tone="success">已登录</Badge>
            ) : (
              <Badge tone="warning">未登录</Badge>
            )
          }
          detail={loginDetail}
          meta={loggedIn ? '本机会话有效' : settings.accountIdentifier ? '已保存账号，登录后即可同步' : '完成下方账号登录'}
        />
        <OverviewCard
          label="上次同步"
          badge={
            syncReport ? (
              <Badge
                tone={
                  syncReport.code === 'SYNC_PARTIAL'
                    ? 'warning'
                    : syncReport.code === 'SYNC_EMPTY'
                      ? 'neutral'
                      : 'primary'
                }
              >
                {syncCodeLabel(syncReport.code)}
              </Badge>
            ) : (
              <Badge tone="neutral">尚无</Badge>
            )
          }
          detail={
            syncReport
              ? `↑${syncReport.stats?.uploaded ?? syncReport.pushed}  ↓${syncReport.stats?.downloaded ?? syncReport.pulled}`
              : loggedIn
                ? '点击「立即同步」'
                : '登录后可用'
          }
          meta={syncReport ? formatTime(syncReport.finishedAt) : '—'}
        />
      </div>

      {banner ? (
        <div
          className={`cloud-banner flex items-start gap-2 rounded-[var(--radius-2)] border px-3.5 py-2.5 text-[13px] leading-snug shadow-[var(--shadow-1)] ${bannerClass(banner.tone)}`}
          role="status"
        >
          {busy ? (
            <span className="mt-1 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-current" />
          ) : (
            <span className="mt-0.5 shrink-0 text-[14px]" aria-hidden>
              {banner.tone === 'err' ? '!' : banner.tone === 'warn' ? '△' : '✓'}
            </span>
          )}
          <span className="min-w-0 flex-1">{banner.text}</span>
          <button
            type="button"
            className="shrink-0 text-[12px] opacity-70 hover:opacity-100"
            onClick={() => setBanner(null)}
            aria-label="关闭提示"
          >
            关闭
          </button>
        </div>
      ) : null}

      {/* 同步设置 */}
      {loggedIn ? (
        <SettingSection
          id={CLOUD_SECTION_IDS.sync}
          title="同步设置"
          description="手动同步在「连接服务」摘要卡中执行。本地改动会自动入队；空云首传不会清空本地。"
          contentClassName="gap-1"
        >
          <SettingToggleRow
            id="cloud-auto-sync"
            label="后台自动同步"
            description="扩展后台按间隔执行（浏览器需允许扩展后台运行）"
            checked={autoSync.enabled}
            disabled={busy}
            onChange={(checked) => onToggleAutoSync(checked)}
          />
          <SettingField id="cloud-auto-interval" label="同步间隔">
            <SettingSelect
              id="cloud-auto-interval"
              value={String(autoSync.intervalMinutes)}
              options={INTERVAL_OPTIONS}
              disabled={busy || !autoSync.enabled}
              onChange={(v) => onChangeInterval(v)}
            />
          </SettingField>

          {syncReport ? <SyncResultPanel report={syncReport} /> : <EmptySyncHint />}
        </SettingSection>
      ) : (
        <Callout tone="info" title="开始使用">
          在下方「连接服务」中填写地址、测试连接并登录账号，完成后可直接从服务摘要卡同步。
          本机 Docker 默认地址多为 <code className="text-[var(--color-fg)]">http://127.0.0.1:18080</code>
          （Windows 常占用 8080）。
        </Callout>
      )}

      {/* 连接 */}
      <SettingSection
        id={CLOUD_SECTION_IDS.connection}
        title="连接服务"
        description="当前仅支持一个自建 Cloud 服务；连接参数在编辑弹窗中统一管理。"
      >
        <CloudConnectionSummary
          baseUrl={configuredBaseUrl}
          healthState={healthState}
          healthDetail={healthDetail}
          loggedIn={loggedIn}
          hasSavedCredentials={hasSavedCredentials}
          autoConnectionState={autoConnectionState}
          deviceLabel={settings.deviceLabel || '未命名设备'}
          syncBusy={busyAction === 'sync'}
          disabled={busy}
          onEdit={openConnectionEditor}
          onReconnect={onReconnect}
          onSync={onSyncNow}
        />

        <CloudConnectionEditDialog
          open={connectionEditorOpen}
          baseUrlDraft={baseUrlDraft}
          deviceLabelDraft={deviceLabelDraft}
          deviceId={settings.deviceId}
          baseUrlInvalid={baseUrlInvalid}
          connectionReady={connectionReady}
          connDirty={connDirty}
          busyAction={busyAction}
          loggedIn={loggedIn}
          session={session}
          identifier={identifier}
          password={password}
          showPassword={showPassword}
          onBaseUrlChange={(value) => {
            setBaseUrlDraft(value);
            setConnDirty(true);
          }}
          onDeviceLabelChange={(value) => {
            setDeviceLabelDraft(value);
            setConnDirty(true);
          }}
          onIdentifierChange={setIdentifier}
          onPasswordChange={setPassword}
          onTogglePassword={() => setShowPassword((value) => !value)}
          onClose={closeConnectionEditor}
          onSave={onSaveConnection}
          onProbe={onProbeHealth}
          onLogin={onLogin}
          onRegister={onRegister}
          onLogout={onLogout}
        />
      </SettingSection>

      {/* 设备 */}
      <SettingSection
        id={CLOUD_SECTION_IDS.devices}
        title="已登录设备"
        description="同一 Cloud 账号下的客户端。可踢出其它设备（本机请用退出登录）。"
      >
        <div className="flex flex-wrap gap-2 px-2 py-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || !loggedIn}
            onClick={() => onRefreshDevices()}
          >
            {busyAction === 'devices' ? '刷新中…' : '刷新列表'}
          </Button>
        </div>
        {!loggedIn ? (
          <p className="px-3 py-2 text-[13px] text-[var(--color-fg-muted)]">登录后显示设备</p>
        ) : devices.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-[var(--color-fg-muted)]">
            暂无设备数据，可点刷新
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2.5 px-2 pb-2">
            {devices.map((d) => {
              const isCurrent = d.id === settings.deviceId;
              const revoking = busyAction === `revoke:${d.id}`;
              return (
                <li
                  key={d.id}
                  className={`cloud-device-item rounded-[var(--radius-2)] border px-3 py-2.5 ${
                    isCurrent
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft,#eef5ff)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-[var(--color-fg)]">
                        <span className="truncate">{d.label || '未命名设备'}</span>
                        {isCurrent ? <Badge tone="primary">本机</Badge> : null}
                        <Badge tone="neutral">{d.clientType || 'client'}</Badge>
                      </div>
                      <p className="mt-1 mb-0 text-[12px] leading-snug text-[var(--color-fg-muted)]">
                        {d.platform ? d.platform.slice(0, 80) : '无平台信息'}
                      </p>
                      <p className="mt-0.5 mb-0 text-[11.5px] text-[var(--color-fg-muted)]">
                        最近活跃 {formatDeviceTime(d.lastSeenAt)}
                        {d.createdAt ? ` · 注册 ${formatDeviceTime(d.createdAt)}` : ''}
                      </p>
                    </div>
                    {!isCurrent ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => onRevokeDevice(d)}
                      >
                        {revoking ? '踢出中…' : '踢出'}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingSection>

      {/* 说明：常显，不折叠 */}
      <div id={CLOUD_SECTION_IDS.scope} className="cloud-scope-card">
        <div className="text-[13px] font-bold text-[var(--color-fg)]">同步范围与说明</div>
        <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
          <p className="m-0">
            <span className="font-semibold text-[var(--color-fg)]">会同步：</span>
            视频状态、演员、清单、新作品与订阅、资料、搜索方案、部分显示/同步偏好。
          </p>
          <p className="m-0">
            <span className="font-semibold text-[var(--color-fg)]">不会同步：</span>
            运行/磁力日志、磁力缓存、Emby 本机库、遥测与登录会话令牌。
          </p>
          <p className="m-0">
            <span className="font-semibold text-[var(--color-fg)]">WebDAV：</span>
            仍是冷备份兜底，与 Cloud live 同步并存。Device ID 与关于页一致。
          </p>
        </div>
      </div>
      <CloudSyncProgressDialog
        state={syncProgress}
        onClose={() => setSyncProgress((state) => ({ ...state, open: false }))}
        onRetry={onSyncNow}
      />
      </div>
    </SettingsPageFrame>
  );
}

/* ---------- presentational helpers ---------- */

function CloudConnectionSummary(props: {
  baseUrl: string;
  healthState: HealthState;
  healthDetail: string;
  loggedIn: boolean;
  hasSavedCredentials: boolean;
  autoConnectionState: AutoConnectionState;
  deviceLabel: string;
  syncBusy: boolean;
  disabled: boolean;
  onEdit: () => void;
  onReconnect: () => void;
  onSync: () => void;
}) {
  return (
    <div className="cloud-connection-summary mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-[var(--color-fg)]" title={props.baseUrl}>
            {props.baseUrl}
          </div>
          <dl className="mt-2 mb-0 grid gap-x-5 gap-y-2 text-[12px] sm:grid-cols-3">
            <div>
              <dt className="text-[var(--color-fg-muted)]">健康状态</dt>
              <dd className="m-0 mt-0.5 flex items-center gap-2 text-[var(--color-fg)]">
                {healthBadge(props.healthState)}
                <span className="truncate" title={props.healthDetail}>{props.healthDetail}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-muted)]">登录状态</dt>
              <dd className="m-0 mt-0.5 font-semibold text-[var(--color-fg)]">
                {props.loggedIn ? '已登录' : '未登录'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-muted)]">本机设备名</dt>
              <dd className="m-0 mt-0.5 truncate font-semibold text-[var(--color-fg)]" title={props.deviceLabel}>
                {props.deviceLabel}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={props.disabled || (!props.loggedIn && !props.hasSavedCredentials)}
            title={
              props.loggedIn
                ? '立即同步本机与 Cloud 数据'
                : props.autoConnectionState === 'connecting'
                  ? '正在自动连接并同步'
                  : props.hasSavedCredentials
                    ? '重新连接并同步 Cloud'
                    : '请先配置账号密码'
            }
            onClick={props.loggedIn ? props.onSync : props.hasSavedCredentials ? props.onReconnect : props.onEdit}
          >
            {props.autoConnectionState === 'connecting'
              ? '正在自动连接…'
              : props.syncBusy
                ? '同步中…'
                : props.loggedIn
                  ? '立即同步'
                  : props.hasSavedCredentials
                    ? '重新连接'
                    : '配置账号'}
          </Button>
          <Button variant="secondary" size="sm" disabled={props.disabled} onClick={props.onEdit}>
            编辑连接
          </Button>
        </div>
      </div>
    </div>
  );
}

function CloudConnectionEditDialog(props: {
  open: boolean;
  baseUrlDraft: string;
  deviceLabelDraft: string;
  deviceId: string;
  baseUrlInvalid: boolean;
  connectionReady: boolean;
  connDirty: boolean;
  busyAction: string | null;
  loggedIn: boolean;
  session: CloudSessionRecord | null;
  identifier: string;
  password: string;
  showPassword: boolean;
  onBaseUrlChange: (value: string) => void;
  onDeviceLabelChange: (value: string) => void;
  onIdentifierChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onClose: () => void;
  onSave: () => void;
  onProbe: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
}) {
  const connectionBusy = props.busyAction != null;

  return (
    <Modal
      open={props.open}
      title="连接服务"
      onClose={props.onClose}
      className="cloud-connection-edit-modal max-h-[calc(100vh-2rem)] !max-w-3xl overflow-y-auto"
      footer={
        <>
          <Button variant="secondary" disabled={connectionBusy} onClick={props.onClose}>
            取消
          </Button>
          <Button
            variant="secondary"
            disabled={connectionBusy || !props.connectionReady}
            onClick={props.onProbe}
          >
            {props.busyAction === 'health' ? '检测中…' : '测试连接'}
          </Button>
          <Button
            variant="primary"
            disabled={connectionBusy || !props.connectionReady}
            onClick={props.onSave}
          >
            {props.busyAction === 'save' ? '保存中…' : props.connDirty ? '保存修改' : '保存连接'}
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <SettingField
          id="cloud-base-url"
          label="Cloud 地址"
          description={
            props.baseUrlInvalid
              ? '地址格式无效'
              : props.connDirty
                ? '有未保存修改'
                : '例 http://127.0.0.1:18080'
          }
        >
          <Input
            id="cloud-base-url"
            value={props.baseUrlDraft}
            invalid={props.baseUrlInvalid}
            onChange={(event) => props.onBaseUrlChange(event.currentTarget.value)}
            placeholder="http://127.0.0.1:18080"
            autoComplete="off"
            spellCheck={false}
            disabled={connectionBusy}
          />
        </SettingField>
        <SettingField
          id="cloud-device-label"
          label="本机设备名称"
          description="出现在已登录设备列表"
        >
          <Input
            id="cloud-device-label"
            value={props.deviceLabelDraft}
            onChange={(event) => props.onDeviceLabelChange(event.currentTarget.value)}
            placeholder="浏览器扩展"
            autoComplete="off"
            disabled={connectionBusy}
          />
        </SettingField>
        <div className="sm:col-span-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-bg-muted,#f4f5f7)] px-3 py-2">
          <div className="text-[12px] font-semibold text-[var(--color-fg-muted)]">设备 ID</div>
          <p className="mt-1 mb-0 break-all font-mono text-[11.5px] text-[var(--color-fg)]">
            {props.deviceId}
          </p>
          <p className="mt-1 mb-0 text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
            与「关于」页 / WebDAV 的 Device ID 为同一本机身份。
          </p>
        </div>
        {props.connDirty ? (
          <span className="sm:col-span-2 text-[12px] text-[var(--color-warning,#d68910)]">
            当前修改尚未保存
          </span>
        ) : null}
      </div>
      <div className="mt-5 border-t border-[var(--color-border)] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-bold text-[var(--color-fg)]">账号与会话</div>
            <p className="mt-0.5 mb-0 text-[12px] leading-snug text-[var(--color-fg-muted)]">
              {props.loggedIn ? '当前浏览器已连接到该 Cloud 账号。' : '登录后可在服务摘要中立即同步。'}
            </p>
          </div>
          {props.loggedIn ? <Badge tone="success">已登录</Badge> : <Badge tone="warning">未登录</Badge>}
        </div>
        {props.loggedIn ? (
          <div className="mt-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-bg-muted,#f4f5f7)] px-3 py-2.5">
            <dl className="m-0 grid gap-2 text-[12px] sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-[var(--color-fg-muted)]">用户 ID</dt>
                <dd className="m-0 mt-0.5 truncate font-mono text-[var(--color-fg)]">{props.session?.userId || '—'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[var(--color-fg-muted)]">登录状态</dt>
                <dd className="m-0 mt-0.5 font-semibold text-[var(--color-fg)]">本机会话有效</dd>
              </div>
            </dl>
            <div className="mt-3">
              <Button type="button" variant="ghost" size="sm" disabled={connectionBusy} onClick={props.onLogout}>
                {props.busyAction === 'logout' ? '退出中…' : '退出登录'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <SettingField id="cloud-identifier" label="账号">
                <Input
                  id="cloud-identifier"
                  value={props.identifier}
                  onChange={(event) => props.onIdentifierChange(event.currentTarget.value)}
                  placeholder="admin"
                  autoComplete="username"
                  disabled={connectionBusy}
                />
              </SettingField>
              <SettingField id="cloud-password" label="密码">
                <div className="relative">
                  <Input
                    id="cloud-password"
                    type={props.showPassword ? 'text' : 'password'}
                    value={props.password}
                    onChange={(event) => props.onPasswordChange(event.currentTarget.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={connectionBusy}
                    className="pr-10"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') props.onLogin();
                    }}
                  />
                  <button
                    type="button"
                    disabled={connectionBusy}
                    aria-label={props.showPassword ? '隐藏密码' : '显示密码'}
                    title={props.showPassword ? '隐藏密码' : '显示密码'}
                    onClick={props.onTogglePassword}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-[var(--radius-2)] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <i className={props.showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'} aria-hidden="true" />
                  </button>
                </div>
              </SettingField>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="primary" disabled={connectionBusy} onClick={props.onLogin}>
                {props.busyAction === 'login' ? '登录中…' : '登录'}
              </Button>
              <Button type="button" variant="secondary" disabled={connectionBusy} onClick={props.onRegister}>
                {props.busyAction === 'register' ? '注册中…' : '注册新账号'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function CloudSyncProgressDialog(props: {
  state: SyncProgressState;
  onClose: () => void;
  onRetry: () => void;
}) {
  const working = props.state.stage === 'preparing' || props.state.stage === 'syncing';
  const title =
    props.state.stage === 'complete'
      ? '同步完成'
      : props.state.stage === 'error'
        ? '同步失败'
        : '正在同步 Cloud';
  const status =
    props.state.stage === 'preparing'
      ? '正在整理本机数据'
      : props.state.stage === 'syncing'
        ? '正在与 Cloud 服务同步并合并数据'
        : props.state.stage === 'complete'
          ? props.state.report?.message || '本次同步已完成'
          : props.state.error || '同步过程中发生未知错误';

  return (
    <Modal
      open={props.state.open}
      title={title}
      onClose={() => {
        if (!working) props.onClose();
      }}
      className="cloud-sync-progress-modal !max-w-xl"
      footer={
        working ? (
          <span className="text-[12px] text-[var(--color-fg-muted)]">同步进行中，请勿关闭此窗口。</span>
        ) : props.state.stage === 'error' ? (
          <>
            <Button variant="secondary" onClick={props.onClose}>关闭</Button>
            <Button variant="primary" onClick={props.onRetry}>重试同步</Button>
          </>
        ) : (
          <Button variant="primary" onClick={props.onClose}>完成</Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
              props.state.stage === 'error'
                ? 'bg-[var(--color-danger,#c0392b)]/12 text-[var(--color-danger,#c0392b)]'
                : props.state.stage === 'complete'
                  ? 'bg-[var(--color-success,#27ae60)]/12 text-[var(--color-success,#1e8449)]'
                  : 'bg-[var(--color-primary-soft,#eef5ff)] text-[var(--color-primary)]'
            }`}
            aria-hidden
          >
            {props.state.stage === 'error' ? '!' : props.state.stage === 'complete' ? '✓' : '…'}
          </span>
          <div>
            <p className="m-0 font-semibold text-[var(--color-fg)]">{status}</p>
            {working ? (
              <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                完成前会保留本窗口；同步不会因切换页面而取消。
              </p>
            ) : null}
          </div>
        </div>

        <ol className="m-0 grid list-none gap-2 p-0 text-[12px]">
          <SyncProgressStep label="整理本机数据" active={props.state.stage === 'preparing'} done={props.state.stage !== 'preparing'} />
          <SyncProgressStep
            label="与 Cloud 同步并合并"
            active={props.state.stage === 'syncing'}
            done={props.state.stage === 'complete'}
            failed={props.state.stage === 'error'}
          />
          <SyncProgressStep label="完成" done={props.state.stage === 'complete'} />
        </ol>

        {props.state.report ? <SyncResultPanel report={props.state.report} /> : null}
      </div>
    </Modal>
  );
}

function SyncProgressStep(props: {
  label: string;
  active?: boolean;
  done?: boolean;
  failed?: boolean;
}) {
  const tone = props.failed
    ? 'border-[var(--color-danger,#c0392b)]/35 bg-[var(--color-danger,#c0392b)]/8 text-[var(--color-danger,#c0392b)]'
    : props.done
      ? 'border-[var(--color-success,#27ae60)]/35 bg-[var(--color-success,#27ae60)]/8 text-[var(--color-success,#1e8449)]'
      : props.active
        ? 'border-[var(--color-primary)]/35 bg-[var(--color-primary-soft,#eef5ff)] text-[var(--color-primary)]'
        : 'border-[var(--color-border)] bg-[var(--color-bg-muted,#f4f5f7)] text-[var(--color-fg-muted)]';
  const marker = props.failed ? '!' : props.done ? '✓' : props.active ? '…' : '•';

  return (
    <li className={`flex items-center gap-2 rounded-[var(--radius-2)] border px-3 py-2 ${tone}`}>
      <span className={props.active ? 'animate-pulse' : ''} aria-hidden>{marker}</span>
      <span className="font-medium">{props.label}</span>
    </li>
  );
}

function OverviewCard(props: {
  label: string;
  badge: ReactNode;
  detail: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cloud-overview-card">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-[var(--color-fg-muted)]">
          {props.label}
        </span>
        <div className="flex items-center gap-1.5">
          {props.badge}
          {props.action}
        </div>
      </div>
      <p
        className="m-0 truncate text-[13.5px] font-semibold text-[var(--color-fg)]"
        title={props.detail}
      >
        {props.detail}
      </p>
      {props.meta ? (
        <p className="mt-0.5 mb-0 truncate text-[11.5px] text-[var(--color-fg-muted)]" title={props.meta}>
          {props.meta}
        </p>
      ) : null}
    </div>
  );
}

function Callout(props: {
  tone: 'info' | 'neutral' | 'warn';
  title: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const tone =
    props.tone === 'warn'
      ? 'border-[var(--color-warning,#d68910)]/35 bg-[var(--color-warning,#d68910)]/8'
      : props.tone === 'info'
        ? 'border-[var(--color-primary)]/25 bg-[var(--color-primary-soft,#eef5ff)]'
        : 'border-[var(--color-border)] bg-[var(--color-bg-muted,#f4f5f7)]';
  return (
    <div
      className={`mx-2 my-1 rounded-[var(--radius-2)] border px-3 ${props.compact ? 'py-2' : 'py-2.5'} ${tone}`}
    >
      <p className="m-0 text-[12.5px] font-bold text-[var(--color-fg)]">{props.title}</p>
      <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
        {props.children}
      </div>
    </div>
  );
}

function EmptySyncHint() {
  return (
    <p className="mx-2 mb-2 mt-1 rounded-[var(--radius-2)] border border-dashed border-[var(--color-border)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
      同步完成后，这里会显示服务端统计的上传 / 下载 / 合并 / 拒绝与类型分布。
    </p>
  );
}

function SyncResultPanel({ report }: { report: SyncReport }) {
  const serverByType: TypeCountMap = report.stats?.byType ?? {};
  const hasServerTypes = Object.keys(serverByType).length > 0;
  const partial = report.code === 'SYNC_PARTIAL';

  return (
    <div
      className={`mx-2 mb-2 mt-1 rounded-[var(--radius-2)] border p-3 ${
        partial
          ? 'border-[var(--color-warning,#d68910)]/40 bg-[var(--color-warning,#d68910)]/8'
          : 'border-[var(--color-border)] bg-[var(--color-bg-muted,#f4f5f7)]'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-[var(--color-fg)]">同步结果</span>
        {report.code ? (
          <Badge
            tone={
              partial ? 'warning' : report.code === 'SYNC_EMPTY' ? 'neutral' : 'success'
            }
          >
            {report.code}
          </Badge>
        ) : null}
      </div>
      {report.message ? (
        <p className="mt-0 mb-2 text-[12.5px] leading-relaxed text-[var(--color-fg)]">
          {report.message}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="上传" value={String(report.stats?.uploaded ?? report.pushed)} />
        <Metric label="下载" value={String(report.stats?.downloaded ?? report.pulled)} />
        <Metric label="合并" value={String(report.stats?.merged ?? 0)} />
        <Metric
          label="拒绝"
          value={String(report.stats?.rejected ?? 0)}
          emphasize={Boolean(report.stats?.rejected)}
        />
      </div>
      <p className="mt-2 mb-0 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
        <span className="font-semibold text-[var(--color-fg)]">下载类型：</span>
        {hasServerTypes ? formatTypeCounts(serverByType) : '无'}
      </p>
      <details className="mt-1.5 text-[12px] text-[var(--color-fg-muted)]">
        <summary className="cursor-pointer select-none font-semibold text-[var(--color-fg)]">
          本地库快照（非权威）
        </summary>
        <p className="mt-1 mb-0 leading-relaxed">{formatTypeCounts(report.localByType)}</p>
        <p className="mt-1 mb-0 text-[11px]">
          pending {report.pendingBefore}
          {report.enqueuedNow ? ` · 入队 ${report.enqueuedNow}` : ''}
          {` · 本地实体 ${report.localEntityCount}`}
        </p>
      </details>
      <p className="mt-1.5 mb-0 text-[11px] text-[var(--color-fg-muted)]">
        {formatTime(report.finishedAt)}
      </p>
    </div>
  );
}

function Metric(props: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div
      className={`rounded-[var(--radius-2)] border bg-[var(--color-surface)] px-2 py-1.5 text-center ${
        props.emphasize && props.value !== '0'
          ? 'border-[var(--color-warning,#d68910)]/50'
          : 'border-[var(--color-border)]'
      }`}
    >
      <div className="text-[17px] font-extrabold tabular-nums text-[var(--color-fg)]">
        {props.value}
      </div>
      <div className="text-[11px] font-semibold text-[var(--color-fg-muted)]">{props.label}</div>
    </div>
  );
}

function healthBadge(state: HealthState): ReactNode {
  if (state === 'ok') return <Badge tone="success">在线</Badge>;
  if (state === 'err') return <Badge tone="danger">异常</Badge>;
  if (state === 'checking') return <Badge tone="info">检测中</Badge>;
  return <Badge tone="neutral">未检测</Badge>;
}

function syncCodeLabel(code?: string): string {
  if (code === 'SYNC_EMPTY') return '无变更';
  if (code === 'SYNC_PARTIAL') return '部分成功';
  if (code === 'SYNC_OK') return '完成';
  return code || '完成';
}

function bannerClass(tone: StatusTone): string {
  if (tone === 'err') {
    return 'border-[var(--color-danger,#c0392b)]/30 bg-[var(--color-danger,#c0392b)]/8 text-[var(--color-danger,#c0392b)]';
  }
  if (tone === 'warn') {
    return 'border-[var(--color-warning,#d68910)]/35 bg-[var(--color-warning,#d68910)]/10 text-[var(--color-warning,#b9770e)]';
  }
  if (tone === 'ok') {
    return 'border-[var(--color-success,#27ae60)]/30 bg-[var(--color-success,#27ae60)]/8 text-[var(--color-success,#1e8449)]';
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)]';
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatDeviceTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '未知';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function shortId(id: string, n = 8): string {
  if (!id) return '—';
  return id.length <= n ? id : `${id.slice(0, n)}…`;
}
