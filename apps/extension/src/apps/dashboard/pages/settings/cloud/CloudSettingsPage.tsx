/**
 * @file CloudSettingsPage.tsx
 * @description Cloud 多端同步设置页：对齐其它设置页的卡片密度、状态反馈与操作提示
 * @module apps/dashboard/pages/settings/cloud
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DeviceInfo } from '@javdb/sync-protocol';
import { Badge } from '../../../../../ui/primitives/Badge/Badge';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import {
  createExtensionCloudClient,
  formatTypeCounts,
  humanizeCloudError,
  loadCloudAutoSyncSettings,
  loadCloudSession,
  loadCloudSettings,
  normalizeCloudBaseUrl,
  runCloudSyncNow,
  saveCloudAutoSyncSettings,
  saveCloudSettings,
  type CloudAutoSyncSettings,
  type CloudConnectionSettings,
  type CloudSessionRecord,
  type CloudSyncNowResult,
  type TypeCountMap,
} from '../../../../../features/cloudSync';
import './cloudSettings.css';

type StatusTone = 'idle' | 'ok' | 'err' | 'busy' | 'warn';
type HealthState = 'unknown' | 'ok' | 'err' | 'checking';

type SyncReport = CloudSyncNowResult & {
  finishedAt: number;
};

const INTERVAL_OPTIONS = [
  { value: '15', label: '15 分钟' },
  { value: '30', label: '30 分钟' },
  { value: '60', label: '1 小时' },
  { value: '180', label: '3 小时' },
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
  const [identifier, setIdentifier] = useState('admin');
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
  const [connDirty, setConnDirty] = useState(false);
  const [autoSync, setAutoSync] = useState<CloudAutoSyncSettings>({
    enabled: true,
    intervalMinutes: 30,
    updatedAt: 0,
  });

  const busy = busyAction != null;
  const loggedIn = Boolean(session?.accessToken);
  const normalizedDraft = useMemo(
    () => normalizeCloudBaseUrl(baseUrlDraft),
    [baseUrlDraft],
  );
  const connectionReady = Boolean(normalizedDraft);
  const baseUrlInvalid = baseUrlDraft.trim().length > 0 && !connectionReady;

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
      const { api } = await createExtensionCloudClient();
      setDevices(await api.listDevices());
    } catch {
      // token 可能过期
    }
  }, [loggedIn]);

  const persistConnection = useCallback(async () => {
    const baseUrl = normalizeCloudBaseUrl(baseUrlDraft);
    if (!baseUrl) {
      setStatus('请填写有效的 Cloud 地址，例如 http://127.0.0.1:18080', 'err');
      await toast('请填写有效的 Cloud 地址', 'warning');
      return null;
    }
    const next = await saveCloudSettings({
      baseUrl,
      deviceLabel: deviceLabelDraft.trim() || '浏览器扩展',
    });
    setSettings(next);
    setBaseUrlDraft(next.baseUrl);
    setDeviceLabelDraft(next.deviceLabel);
    setConnDirty(false);
    return next;
  }, [baseUrlDraft, deviceLabelDraft, setStatus]);

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
        const res = await fetch(`${root}/health`);
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          protocolVersion?: number;
        };
        if (!res.ok || !data.ok) {
          setHealthState('err');
          setHealthDetail(`异常 · HTTP ${res.status}`);
          if (!silent) {
            setStatus('健康检查失败：请确认 Cloud 服务已启动且地址端口正确', 'err');
            await toast('连接失败', 'error');
          }
          return false;
        }
        setHealthState('ok');
        setHealthDetail(`在线 · 协议 v${data.protocolVersion ?? '?'}`);
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
    [setStatus],
  );

  // 仅挂载加载一次，避免输入被 effect 覆盖
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, auto, sess] = await Promise.all([
          loadCloudSettings(),
          loadCloudAutoSyncSettings(),
          loadCloudSession(),
        ]);
        if (cancelled) return;
        setSettings(s);
        setBaseUrlDraft(s.baseUrl);
        setDeviceLabelDraft(s.deviceLabel);
        setAutoSync(auto);
        setSession(sess);
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled) return;
      try {
        const s = await loadCloudSettings();
        if (cancelled) return;
        if (normalizeCloudBaseUrl(s.baseUrl)) {
          void probeHealthUrl(s.baseUrl, { silent: true });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [probeHealthUrl]);

  useEffect(() => {
    if (loading || !loggedIn) return;
    void refreshDevices();
  }, [loading, loggedIn, session?.accessToken, refreshDevices]);

  const onSaveConnection = () =>
    void withBusy('save', async () => {
      const saved = await persistConnection();
      if (!saved) return;
      setStatus('连接配置已保存', 'ok');
      await toast('✓ 连接已保存', 'success');
      void probeHealthUrl(saved.baseUrl, { silent: true });
    });

  const onProbeHealth = () =>
    void withBusy('health', async () => {
      // 测试连接时一并保存草稿，避免「测的是旧地址」
      const saved = await persistConnection();
      if (!saved) return;
      await probeHealthUrl(saved.baseUrl, { silent: false });
    });

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
        const { api } = await createExtensionCloudClient(saved);
        await api.register({ identifier: identifier.trim(), password });
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
        const { api } = await createExtensionCloudClient(saved);
        await api.login({
          identifier: identifier.trim(),
          password,
          device: {
            id: saved.deviceId,
            label: saved.deviceLabel,
            clientType: 'extension',
            platform: navigator.userAgent.slice(0, 120),
          },
        });
        setSession(await loadCloudSession());
        setPassword('');
        setShowPassword(false);
        setStatus('登录成功，可以开始同步', 'ok');
        await toast('✓ 登录成功', 'success');
        try {
          setDevices(await api.listDevices());
        } catch {
          setDevices([]);
        }
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });

  const onLogout = () =>
    void withBusy('logout', async () => {
      try {
        const saved = settings ?? (await loadCloudSettings());
        const { api } = await createExtensionCloudClient(saved);
        await api.logout();
      } catch {
        try {
          const { api } = await createExtensionCloudClient();
          await api.tokens.clear();
        } catch {
          // ignore
        }
      }
      setSession(await loadCloudSession());
      setDevices([]);
      setSyncReport(null);
      setStatus('已退出本机 Cloud 会话', 'ok');
      await toast('已退出登录', 'info');
    });

  const onRefreshDevices = () =>
    void withBusy('devices', async () => {
      try {
        const { api } = await createExtensionCloudClient();
        const list = await api.listDevices();
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
        const { api } = await createExtensionCloudClient();
        await api.revokeDevice(device.id);
        setDevices(await api.listDevices());
        setStatus(`已踢出「${label}」`, 'ok');
        await toast(`✓ 已踢出 ${label}`, 'success');
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });
  };

  const onSyncNow = () =>
    void withBusy('sync', async () => {
      try {
        const result = await runCloudSyncNow();
        const report: SyncReport = { ...result, finishedAt: Date.now() };
        setSyncReport(report);
        const tone: StatusTone =
          result.code === 'SYNC_PARTIAL' ? 'warn' : 'ok';
        setStatus(result.message || `同步完成：↑${result.pushed} ↓${result.pulled}`, tone);
        await toast(
          result.message || '✓ 同步完成',
          result.code === 'SYNC_PARTIAL' ? 'warning' : 'success',
        );
        try {
          const { api } = await createExtensionCloudClient();
          setDevices(await api.listDevices());
        } catch {
          // ignore
        }
      } catch (e) {
        const msg = humanizeCloudError(e);
        setStatus(msg, 'err');
        await toast(msg, 'error');
      }
    });

  const onToggleAutoSync = (enabled: boolean) =>
    void withBusy('auto', async () => {
      const next = await saveCloudAutoSyncSettings({ enabled });
      setAutoSync(next);
      try {
        await chrome.runtime.sendMessage({ type: 'CLOUD_SYNC_SETUP_ALARM' });
      } catch {
        // ignore
      }
      setStatus(enabled ? '已开启后台自动同步' : '已关闭后台自动同步', 'ok');
      await toast(enabled ? '✓ 已开启自动同步' : '已关闭自动同步', 'info');
    });

  const onChangeInterval = (value: string) =>
    void withBusy('auto', async () => {
      const minutes = Number(value);
      const next = await saveCloudAutoSyncSettings({ intervalMinutes: minutes });
      setAutoSync(next);
      try {
        await chrome.runtime.sendMessage({ type: 'CLOUD_SYNC_SETUP_ALARM' });
      } catch {
        // ignore
      }
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
    >
      <div id="cloud-settings" className="cloud-settings">
        {/* 总览条 */}
      <div className="cloud-overview-grid">
        <OverviewCard
          label="服务"
          badge={healthBadge(healthState)}
          detail={healthDetail}
          meta={normalizedDraft || '未配置地址'}
          action={
            <button
              type="button"
              className="text-[11.5px] font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={() => onProbeHealth()}
            >
              {busyAction === 'health' ? '检测中…' : '测试'}
            </button>
          }
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
          meta={loggedIn ? '本机会话有效' : '完成下方账号登录'}
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

      {/* 已登录：同步主路径置顶 */}
      {loggedIn ? (
        <SettingSection
          title="同步"
          description="本地改动会自动入队；空云首传不会清空本地。结果以服务端返回为准。"
          contentClassName="gap-1"
          className="border-[var(--color-primary)]/30"
        >
          <div className="flex flex-wrap items-center gap-2 px-2 py-2">
            <Button
              type="button"
              variant="primary"
              size="lg"
              disabled={busy}
              onClick={() => onSyncNow()}
            >
              {busyAction === 'sync' ? '同步中…' : '立即同步'}
            </Button>
            <p className="m-0 max-w-sm text-[12.5px] leading-snug text-[var(--color-fg-muted)]">
              建议在改完一批标记后再点；后台自动同步可在下方开启。
            </p>
          </div>

          <div className="mx-2 mb-1 border-t border-[var(--color-border)]" />

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
          按顺序完成：① 填写并测试 Cloud 地址 → ② 登录账号 → ③ 立即同步。
          本机 Docker 默认地址多为 <code className="text-[var(--color-fg)]">http://127.0.0.1:18080</code>
          （Windows 常占用 8080）。
        </Callout>
      )}

      {/* 连接 */}
      <SettingSection
        title="连接服务"
        description="自建实例 Base URL。改地址后请保存或测试连接。"
      >
        <div className="grid gap-0 sm:grid-cols-2">
          <SettingField
            id="cloud-base-url"
            label="Cloud 地址"
            description={
              baseUrlInvalid
                ? '地址格式无效'
                : connDirty
                  ? '有未保存修改'
                  : '例 http://127.0.0.1:18080'
            }
          >
            <Input
              id="cloud-base-url"
              value={baseUrlDraft}
              invalid={baseUrlInvalid}
              onChange={(e) => {
                setBaseUrlDraft(e.target.value);
                setConnDirty(true);
              }}
              placeholder="http://127.0.0.1:18080"
              autoComplete="off"
              spellCheck={false}
              disabled={busy && busyAction === 'sync'}
            />
          </SettingField>
          <SettingField
            id="cloud-device-label"
            label="本机设备名称"
            description="出现在已登录设备列表"
          >
            <Input
              id="cloud-device-label"
              value={deviceLabelDraft}
              onChange={(e) => {
                setDeviceLabelDraft(e.target.value);
                setConnDirty(true);
              }}
              placeholder="浏览器扩展"
              autoComplete="off"
              disabled={busy && busyAction === 'sync'}
            />
          </SettingField>
        </div>

        <div className="px-2 pb-1">
          <div className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-bg-muted,#f4f5f7)] px-3 py-2">
            <div className="text-[12px] font-semibold text-[var(--color-fg-muted)]">设备 ID</div>
            <p className="mt-1 mb-0 break-all font-mono text-[11.5px] text-[var(--color-fg)]">
              {settings.deviceId}
            </p>
            <p className="mt-1 mb-0 text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
              与「关于」页 / WebDAV 的 Device ID 为同一本机身份。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-2 py-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !connectionReady}
            onClick={() => onSaveConnection()}
          >
            {busyAction === 'save' ? '保存中…' : connDirty ? '保存修改' : '保存连接'}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !connectionReady}
            onClick={() => onProbeHealth()}
          >
            {busyAction === 'health' ? '检测中…' : '测试连接'}
          </Button>
          {connDirty ? (
            <span className="text-[12px] text-[var(--color-warning,#d68910)]">未保存</span>
          ) : null}
        </div>
      </SettingSection>

      {/* 账号 */}
      <SettingSection
        title="账号"
        description={
          loggedIn
            ? '当前本机会话。退出后需重新登录才能同步。'
            : '使用引导管理员或自建账号。密码错误不会创建会话。'
        }
      >
        {loggedIn ? (
          <>
            <div className="mx-2 my-1 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-bg-muted,#f4f5f7)] px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-bold text-[var(--color-fg)]">
                  {settings.deviceLabel}
                </span>
                <Badge tone="primary">本机会话</Badge>
                {healthState === 'ok' ? <Badge tone="success">服务在线</Badge> : null}
              </div>
              <dl className="mt-2 mb-0 grid gap-1.5 text-[12.5px] sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="m-0 text-[var(--color-fg-muted)]">用户 ID</dt>
                  <dd className="m-0 truncate font-mono text-[var(--color-fg)]">
                    {session?.userId || '—'}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="m-0 text-[var(--color-fg-muted)]">设备 ID</dt>
                  <dd className="m-0 truncate font-mono text-[var(--color-fg)]">
                    {settings.deviceId}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onLogout()}>
                {busyAction === 'logout' ? '退出中…' : '退出登录'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-0 sm:grid-cols-2">
              <SettingField id="cloud-identifier" label="账号">
                <Input
                  id="cloud-identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  disabled={busy}
                />
              </SettingField>
              <SettingField id="cloud-password" label="密码">
                <div className="relative">
                  <Input
                    id="cloud-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={busy}
                    className="pr-10"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onLogin();
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-[var(--radius-2)] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <i className={showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'} aria-hidden="true" />
                  </button>
                </div>
              </SettingField>
            </div>
            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button type="button" variant="primary" disabled={busy} onClick={() => onLogin()}>
                {busyAction === 'login' ? '登录中…' : '登录'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => onRegister()}
              >
                {busyAction === 'register' ? '注册中…' : '注册新账号'}
              </Button>
            </div>
          </>
        )}
      </SettingSection>

      {!loggedIn ? (
        <SettingSection title="同步" description="登录后可立即同步并开启后台自动同步">
          <div className="flex flex-wrap items-center gap-2 px-2 py-2">
            <Button type="button" variant="primary" disabled>
              立即同步
            </Button>
            <span className="text-[12.5px] text-[var(--color-warning,#d68910)]">
              请先完成上方登录
            </span>
          </div>
          <EmptySyncHint />
        </SettingSection>
      ) : null}

      {/* 设备 */}
      <SettingSection
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
      <div className="cloud-scope-card">
        <div className="text-[13px] font-bold text-[var(--color-fg)]">同步范围与说明</div>
        <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
          <p className="m-0">
            <span className="font-semibold text-[var(--color-fg)]">会同步：</span>
            视频状态、演员、清单、新作品与订阅、资料、搜索方案、部分显示/同步偏好。
          </p>
          <p className="m-0">
            <span className="font-semibold text-[var(--color-fg)]">不会同步：</span>
            运行/磁力日志、磁力缓存、Emby 本机库、遥测、会话与密钥明文。
          </p>
          <p className="m-0">
            <span className="font-semibold text-[var(--color-fg)]">WebDAV：</span>
            仍是冷备份兜底，与 Cloud live 同步并存。Device ID 与关于页一致。
          </p>
        </div>
      </div>
      </div>
    </SettingsPageFrame>
  );
}

/* ---------- presentational helpers ---------- */

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
