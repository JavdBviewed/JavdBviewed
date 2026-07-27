/**
 * @file Drive115SettingsPage.tsx
 * @description 115 网盘设置 React 全页（legacy class + drive115.css 保真）
 * @module apps/dashboard/pages/settings/drive115
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../settingsSubpageShell.css';
import { SettingsSectionNavLayout, type SettingsSectionNavItem } from '../shared/SettingsSectionNav';
import '../../../../../dashboard/styles/05-pages/settings/settings.css';
import '../../../../../dashboard/styles/05-pages/settings/drive115.css';
import { Badge } from '../../../../../ui/primitives/Badge/Badge';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { Modal } from '../../../../../ui/primitives/Modal/Modal';
import { sendRuntimeMessage } from '../../../../../platform/browser/runtimeMessages';
import { STORAGE_KEYS } from '../../../../../utils/config';
import { getValue } from '../../../../../utils/storage';
import type {
  Drive115IndexReport,
  Drive115IndexSkipReason,
} from '../../../../../features/drive115/mediaLibrary/types';
import {
  getSettings,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  chooseDownloadDir,
  clearDrive115LogsPanel,
  copyOpenlistManualUrl,
  exportDrive115LogsPanel,
  loadDrive115LogsPanel,
  manualRefreshAccessToken,
  openOpenlistManualUrl,
  persistDrive115Form,
  pollPkceAuthOnce,
  startPkceAuth,
  toast,
  validateDrive115Token,
  type AuthSession,
  type AuthStatusKind,
} from './drive115SettingsActions';
import {
  computeNextAutoRefreshAt,
  countRefreshIn2h,
  DEFAULT_DRIVE115_SETTINGS_FORM,
  DRIVE115_AUTH_MODE_OPTIONS,
  extractUserInfoDisplay,
  formatDrive115DateTime,
  getAccessTokenExpiryLabel,
  getAccessTokenStatusLabel,
  getRefreshTokenStatusLabel,
  mapDrive115IndexProgressSnapshot,
  mapSettingsToDrive115Form,
  OPENLIST_MANUAL_URL,
  type Drive115AuthMode,
  type Drive115IndexProgressView,
  type Drive115SettingsFormState,
} from './drive115SettingsModel';

const AUTO_SAVE_MS = 1000;

const DRIVE115_SECTION_IDS = {
  mode: 'drive115-section-mode',
  openlistManual: 'drive115-section-openlist-manual',
  pkce: 'drive115-section-pkce',
  credentials: 'drive115-section-credentials',
  download: 'drive115-section-download',
  mediaLibrary: 'drive115-section-media-library',
  logs: 'drive115-section-logs',
} as const;

const SKIP_REASON_LABELS: Record<Drive115IndexSkipReason, string> = {
  no_video: '无视频文件',
  no_pickcode: '有视频但缺 pick_code',
  unrecognized_code: '番号未识别',
  list_failed: '列目录失败',
  max_folders: '达影片文件夹上限（截断）',
  container_cap: '达分类目录上限（截断）',
};

function formatReportDuration(startedAt: number, finishedAt: number): number {
  if (!startedAt || !finishedAt || finishedAt < startedAt) return 0;
  return Math.max(0, Math.round((finishedAt - startedAt) / 1000));
}

/** 索引结果详情窗口：概览 + 跳过原因分组 + 入库/跳过明细 */
function Drive115IndexReportModal({
  open,
  report,
  onClose,
}: {
  open: boolean;
  report: Drive115IndexReport | null;
  onClose: () => void;
}) {
  if (!report) return null;
  const durationSec = formatReportDuration(report.startedAt, report.finishedAt);
  const reasonRows = (Object.keys(report.skipReasonCounts) as Drive115IndexSkipReason[])
    .map((reason) => ({ reason, count: report.skipReasonCounts[reason] || 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  const stats: Array<{ label: string; value: string | number; accent?: 'ok' | 'skip' }> = [
    { label: '入库', value: report.indexedTotal, accent: 'ok' },
    { label: '跳过', value: report.skippedTotal, accent: 'skip' },
    { label: '截断', value: report.truncatedFolders },
    { label: '根目录', value: `${report.rootsDone}/${report.rootsTotal}` },
    { label: 'API', value: report.apiCalls },
    { label: '耗时', value: `${durationSec}s` },
  ];

  return (
    <Modal open={open} title="索引结果详情" onClose={onClose} className="!max-w-3xl">
      <div className="space-y-5 text-[13px] text-[var(--color-fg)]">
        {/* 概览统计块 */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2"
            >
              <div className="text-[11px] text-[var(--color-fg-muted)]">{s.label}</div>
              <div
                className={
                  's-value text-[16px] font-bold ' +
                  (s.accent === 'ok'
                    ? 'text-[var(--color-success,#16a34a)]'
                    : s.accent === 'skip'
                      ? 'text-[var(--color-warning,#d97706)]'
                      : 'text-[var(--color-fg)]')
                }
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {report.cancelled ? (
          <div className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-fg-muted)]">
            本轮索引已被取消。
          </div>
        ) : null}
        {report.error ? (
          <div className="rounded-[var(--radius-2)] border border-[var(--color-danger,#c0392b)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-danger,#c0392b)]">
            错误：{report.error}
          </div>
        ) : null}

        {/* 跳过原因分组 */}
        {reasonRows.length ? (
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold">跳过原因</h3>
            <div className="overflow-hidden rounded-[var(--radius-2)] border border-[var(--color-border)]">
              {reasonRows.map((row, i) => (
                <div
                  key={row.reason}
                  className={
                    'flex items-center justify-between px-3 py-2 ' +
                    (i > 0 ? 'border-t border-[var(--color-border)]' : '')
                  }
                >
                  <span className="text-[var(--color-fg-muted)]">
                    {SKIP_REASON_LABELS[row.reason] || row.reason}
                  </span>
                  <span className="font-semibold tabular-nums">{row.count}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 入库明细 */}
        {report.indexed.length ? (
          <section className="space-y-2">
            <h3 className="flex items-baseline justify-between text-[13px] font-semibold">
              <span>入库明细</span>
              <span className="text-[11px] font-normal text-[var(--color-fg-muted)]">
                {report.indexedTotal > report.indexed.length
                  ? `显示 ${report.indexed.length} / 共 ${report.indexedTotal}`
                  : `共 ${report.indexed.length}`}
              </span>
            </h3>
            <div className="max-h-56 overflow-auto rounded-[var(--radius-2)] border border-[var(--color-border)]">
              {report.indexed.map((item, i) => (
                <div
                  key={`indexed-${i}`}
                  className={
                    'flex items-baseline gap-2 px-3 py-1.5 ' +
                    (i > 0 ? 'border-t border-[var(--color-border)]' : '')
                  }
                >
                  <span className="shrink-0 font-medium">{item.code || '(未识别)'}</span>
                  <span className="truncate text-[var(--color-fg-muted)]">
                    {item.title || item.folderName}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 跳过明细 */}
        {report.skipped.length ? (
          <section className="space-y-2">
            <h3 className="flex items-baseline justify-between text-[13px] font-semibold">
              <span>跳过明细</span>
              <span className="text-[11px] font-normal text-[var(--color-fg-muted)]">
                {report.skippedTotal > report.skipped.length
                  ? `显示 ${report.skipped.length} / 共 ${report.skippedTotal}`
                  : `共 ${report.skipped.length}`}
              </span>
            </h3>
            <div className="max-h-56 overflow-auto rounded-[var(--radius-2)] border border-[var(--color-border)]">
              {report.skipped.map((item, i) => (
                <div
                  key={`skipped-${i}`}
                  className={
                    'flex items-center justify-between gap-2 px-3 py-1.5 ' +
                    (i > 0 ? 'border-t border-[var(--color-border)]' : '')
                  }
                >
                  <span className="truncate">{item.folderName}</span>
                  <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-fg-muted)]">
                    {SKIP_REASON_LABELS[item.reason] || item.reason}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {report.truncatedList ? (
          <p className="text-[11px] text-[var(--color-fg-muted)]">明细过多，仅显示前若干条。</p>
        ) : null}
      </div>
    </Modal>
  );
}


type Drive115GroupProps = {
  title: string;
  id?: string;
  navId?: string;
  children: ReactNode;
  className?: string;
  beta?: boolean;
};

/**
 * legacy 风格设置分组：吃 drive115.css 的 .settings-group / h4
 */
function Drive115Group({ title, id, navId, children, className, beta }: Drive115GroupProps) {
  return (
    <section className={['settings-card', 'settings-group', className].filter(Boolean).join(' ')} id={id}>
      {navId ? <span id={navId} className="settings-section-anchor" aria-hidden="true" /> : null}
      <h4 className="flex items-center gap-2">
        <span>{title}</span>
        {beta ? <Badge tone="warning" className="shrink-0">Beta</Badge> : null}
      </h4>
      <div className="drive115-group-body">{children}</div>
    </section>
  );
}

/**
 * legacy 橙色滑块开关（#drive115-settings .drive115-toggle-*）
 */
function Drive115LegacyToggle(props: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  description?: string;
  disabled?: boolean;
}) {
  const { id, label, checked, onChange, description, disabled } = props;
  return (
    <div className="drive115-toggle-wrapper form-group">
      <div className="drive115-toggle-label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="drive115-toggle-text">{label}</span>
        <label className="drive115-toggle-label" style={{ margin: 0 }} htmlFor={id}>
          <div className="drive115-toggle-switch">
            <input
              type="checkbox"
              id={id}
              className="drive115-toggle-input"
              checked={checked}
              disabled={disabled}
              onChange={(e) => onChange(e.currentTarget.checked)}
            />
            <span className="drive115-toggle-slider" />
          </div>
        </label>
      </div>
      {description ? <p className="input-description">{description}</p> : null}
    </div>
  );
}


type Drive115FieldProps = {
  id: string;
  label: string;
  description?: string;
  children: ReactNode;
};

/** legacy form-group 字段 */
function Drive115Field({ id, label, description, children }: Drive115FieldProps) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {description ? <p className="input-description">{description}</p> : null}
    </div>
  );
}

type Drive115BtnProps = {
  id?: string;
  /** 语义变体：对齐 src/ui/primitives/Button（非页级私房色） */
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * 115 设置页按钮薄封装：统一走全局 Button 语义色 / disabled / 日夜 token。
 * outline → secondary（全局无 outline 时的等价次要动作）
 */
function Drive115Btn({
  id,
  variant = 'secondary',
  disabled,
  onClick,
  children,
  className,
}: Drive115BtnProps) {
  const mapped =
    variant === 'outline' || variant === 'ghost'
      ? variant === 'ghost'
        ? 'ghost'
        : 'secondary'
      : variant;
  return (
    <Button
      id={id}
      type="button"
      size="sm"
      variant={mapped}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
    </Button>
  );
}


function statusToneClass(tone: 'ok' | 'warn' | 'error' | 'muted'): string {
  if (tone === 'ok') return 'text-[var(--color-success,#27ae60)]';
  if (tone === 'warn') return 'text-[var(--color-warning,#d68910)]';
  if (tone === 'error') return 'text-[var(--color-danger,#c0392b)]';
  return 'text-[var(--color-fg-muted)]';
}

function authKindClass(kind: AuthStatusKind): string {
  if (kind === 'success') return 'bg-[var(--color-success,#27ae60)]/10 text-[var(--color-success,#27ae60)]';
  if (kind === 'error') return 'bg-[var(--color-danger,#c0392b)]/10 text-[var(--color-danger,#c0392b)]';
  if (kind === 'info') return 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]';
  return 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]';
}

/**
 * 115 网盘设置完整页面
 */
export function Drive115SettingsPage() {
  const [form, setForm] = useState<Drive115SettingsFormState>(DEFAULT_DRIVE115_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [userInfoStatus, setUserInfoStatus] = useState<{
    message: string;
    kind: 'ok' | 'error' | 'info';
  }>({ message: '等待验证', kind: 'info' });
  const [validating, setValidating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState<{ message: string; kind: AuthStatusKind }>({
    message: '未开始授权',
    kind: 'idle',
  });
  const [authQrUrl, setAuthQrUrl] = useState('');
  const [indexingMediaLibrary, setIndexingMediaLibrary] = useState(false);
  const [indexProgressText, setIndexProgressText] = useState('');
  const [indexProgress, setIndexProgress] = useState<Drive115IndexProgressView | null>(null);
  const [indexReport, setIndexReport] = useState<Drive115IndexReport | null>(null);
  const [showIndexReport, setShowIndexReport] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logStatsText, setLogStatsText] = useState('暂无日志');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsBusy, setLogsBusy] = useState(false);
  const [authDeviceMeta, setAuthDeviceMeta] = useState('');
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const formRef = useRef(form);
  formRef.current = form;
  const authSessionRef = useRef<AuthSession | null>(null);
  const authPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveToastAt = useRef(0);

  const applyIndexProgressSnapshot = useCallback((raw: unknown) => {
    const snap = mapDrive115IndexProgressSnapshot(raw);
    if (!snap) {
      setIndexProgress(null);
      setIndexingMediaLibrary(false);
      return;
    }
    setIndexProgress(snap);
    if (snap.message) setIndexProgressText(snap.message);
    setIndexingMediaLibrary(snap.running);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getValue<unknown>(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS, null);
        if (!cancelled) applyIndexProgressSnapshot(snap);
      } catch {
        /* ignore */
      }
      try {
        const rep = await getValue<Drive115IndexReport | null>(
          STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT,
          null,
        );
        if (!cancelled) setIndexReport(rep && typeof rep === 'object' ? rep : null);
      } catch {
        /* ignore */
      }
    })();

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' && area !== 'sync') return;
      const progressKey = STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS;
      if (changes[progressKey]) {
        applyIndexProgressSnapshot(changes[progressKey].newValue);
      }
      const reportKey = STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT;
      if (changes[reportKey]) {
        const next = changes[reportKey].newValue as Drive115IndexReport | undefined;
        setIndexReport(next && typeof next === 'object' ? next : null);
      }
    };
    try {
      chrome.storage?.onChanged?.addListener(onChanged);
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
      try {
        chrome.storage?.onChanged?.removeListener(onChanged);
      } catch {
        /* ignore */
      }
    };
  }, [applyIndexProgressSnapshot]);

  const persist = useCallback(async (nextForm: Drive115SettingsFormState) => {
    try {
      await persistDrive115Form(nextForm);
      setSaveError(null);
      const now = Date.now();
      if (!lastSaveToastAt.current || now - lastSaveToastAt.current > 3000) {
        lastSaveToastAt.current = now;
        await toast('设置已保存', 'success');
      }
    } catch (err) {
      console.error('[Drive115SettingsPage] save failed', err);
      setSaveError(err instanceof Error ? err.message : '保存失败');
      await toast('保存设置失败', 'error');
    }
  }, []);

  const { scheduleSave, flush } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  const clearAuthPolling = useCallback(() => {
    if (authPollTimerRef.current) {
      clearTimeout(authPollTimerRef.current);
      authPollTimerRef.current = null;
    }
  }, []);

  const resetAuthUi = useCallback(
    (options?: { keepQr?: boolean; keepStatus?: boolean }) => {
      clearAuthPolling();
      authSessionRef.current = null;
      if (!options?.keepQr) {
        setAuthQrUrl('');
        setAuthDeviceMeta('');
      }
      if (!options?.keepStatus) {
        setAuthStatus({ message: '未开始授权', kind: 'idle' });
      }
    },
    [clearAuthPolling],
  );

  const refreshLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const panel = await loadDrive115LogsPanel(100);
      setLogLines(panel.lines);
      setLogStatsText(panel.statsText);
    } catch (err) {
      console.error('[Drive115Settings] load logs failed', err);
      setLogLines([]);
      setLogStatsText('日志加载失败');
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const onClearLogs = useCallback(async () => {
    if (logsBusy) return;
    setLogsBusy(true);
    try {
      await clearDrive115LogsPanel();
      await toast('日志已清空', 'success');
      await refreshLogs();
    } catch (err) {
      console.error('[Drive115Settings] clear logs failed', err);
      await toast('清空日志失败', 'error');
    } finally {
      setLogsBusy(false);
    }
  }, [logsBusy, refreshLogs]);

  const onExportLogs = useCallback(async () => {
    if (logsBusy) return;
    setLogsBusy(true);
    try {
      await exportDrive115LogsPanel();
    } finally {
      setLogsBusy(false);
    }
  }, [logsBusy]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        const next = mapSettingsToDrive115Form(settings);
        setForm(next);
        if (next.v2UserInfo) {
          setUserInfoStatus({
            message: next.v2UserInfoExpired ? '已过期（缓存）' : '已缓存',
            kind: 'info',
          });
        }
      } catch (err) {
        console.error('[Drive115SettingsPage] load failed', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          void refreshLogs();
        }
      }
    })();
    return () => {
      cancelled = true;
      clearAuthPolling();
    };
  }, [clearAuthPolling, refreshLogs]);

  // access_token 到期倒计时
  useEffect(() => {
    if (!form.v2TokenExpiresAt) return;
    const timer = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [form.v2TokenExpiresAt]);

  // storage 同步（外部刷新 token 时跟随 UI）
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const handler = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes.settings) return;
      const newVal = changes.settings.newValue || {};
      const mapped = mapSettingsToDrive115Form(newVal);
      setForm((prev) => {
        // 若用户正在编辑且内容相同则跳过
        if (
          prev.v2AccessToken === mapped.v2AccessToken &&
          prev.v2RefreshToken === mapped.v2RefreshToken &&
          prev.v2TokenExpiresAt === mapped.v2TokenExpiresAt &&
          prev.enabled === mapped.enabled &&
          prev.v2AuthMode === mapped.v2AuthMode &&
          prev.v2ClientId === mapped.v2ClientId
        ) {
          return prev;
        }
        return { ...prev, ...mapped };
      });
    };
    chrome.storage.onChanged.addListener(handler);
    return () => {
      try {
        chrome.storage.onChanged.removeListener(handler);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const disabled = !form.enabled;

  const update = useCallback(
    <K extends keyof Drive115SettingsFormState>(
      key: K,
      value: Drive115SettingsFormState[K],
      options?: { immediate?: boolean },
    ) => {
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        if (options?.immediate) {
          void flush(next);
        } else {
          scheduleSave(next);
        }
        return next;
      });
    },
    [flush, scheduleSave],
  );

  const patchForm = useCallback(
    (patch: Partial<Drive115SettingsFormState>, options?: { save?: boolean; immediate?: boolean }) => {
      setForm((prev) => {
        const next = { ...prev, ...patch };
        if (options?.save !== false) {
          if (options?.immediate) void flush(next);
          else scheduleSave(next);
        }
        return next;
      });
    },
    [flush, scheduleSave],
  );

  const onEnabledChange = async (checked: boolean) => {
    const previous = form;
    const next = { ...form, enabled: checked };
    setForm(next);
    try {
      await persistDrive115Form(next);
      await toast(`115 网盘已${checked ? '启用' : '禁用'}`, 'success');
    } catch (err) {
      console.error('[Drive115SettingsPage] toggle enabled failed', err);
      setForm(previous);
      await toast('保存设置失败', 'error');
    }
  };

  const onAuthModeChange = async (value: string) => {
    const mode: Drive115AuthMode =
      value === 'self_app' ? 'self_app' : value === 'openlist_scan' ? 'openlist_scan' : 'openlist_manual';
    if (mode === 'openlist_manual') {
      resetAuthUi();
    }
    patchForm({ v2AuthMode: mode }, { immediate: true });
  };

  const runPollLoop = useCallback(
    async (session: AuthSession, mode: Drive115AuthMode) => {
      const result = await pollPkceAuthOnce(session, mode);
      if (authSessionRef.current?.uid !== session.uid) return;

      setAuthStatus({ message: result.message, kind: result.kind });

      if (result.formPatch) {
        setForm((prev) => ({ ...prev, ...result.formPatch }));
      }
      if (result.userInfo) {
        setUserInfoStatus({ message: '账号信息已更新', kind: 'ok' });
      } else if (result.kind === 'success') {
        setUserInfoStatus({ message: 'token 已保存，账号信息待刷新', kind: 'info' });
      }

      if (result.continuePolling) {
        authPollTimerRef.current = setTimeout(() => {
          void runPollLoop(session, mode);
        }, 1500);
        return;
      }

      if (result.done) {
        if (result.kind === 'success') {
          resetAuthUi({ keepQr: true, keepStatus: true });
        } else {
          clearAuthPolling();
          authSessionRef.current = null;
        }
      }
    },
    [clearAuthPolling, resetAuthUi],
  );

  const onStartAuth = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthStatus({ message: '正在生成二维码…', kind: 'info' });
    setAuthQrUrl('');
    setAuthDeviceMeta('');
    clearAuthPolling();
    try {
      const result = await startPkceAuth(formRef.current.v2AuthMode, formRef.current);
      setAuthStatus({ message: result.message, kind: result.kind });
      if (!result.success || !result.session) return;
      authSessionRef.current = result.session;
      setAuthQrUrl(result.qrImageUrl || '');
      setAuthDeviceMeta(result.deviceMeta || '');
      void runPollLoop(result.session, formRef.current.v2AuthMode);
    } finally {
      setAuthBusy(false);
    }
  };

  const onCancelAuth = () => {
    resetAuthUi();
  };

  const onValidateToken = async () => {
    if (validating) return;
    setValidating(true);
    setUserInfoStatus({ message: '获取用户信息中…', kind: 'info' });
    try {
      const result = await validateDrive115Token(formRef.current);
      if (result.success) {
        if (result.formPatch) {
          setForm((prev) => ({ ...prev, ...result.formPatch }));
        }
        setUserInfoStatus({ message: result.message, kind: 'ok' });
      } else {
        setUserInfoStatus({ message: result.message, kind: 'error' });
      }
    } finally {
      setValidating(false);
    }
  };

  const onManualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setUserInfoStatus({ message: '刷新中…', kind: 'info' });
    try {
      const result = await manualRefreshAccessToken(formRef.current);
      if (result.success) {
        if (result.formPatch) {
          setForm((prev) => ({ ...prev, ...result.formPatch }));
        }
        setUserInfoStatus({ message: result.message, kind: 'ok' });
      } else {
        setUserInfoStatus({ message: result.message, kind: 'error' });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const onChooseDir = async () => {
    const selection = await chooseDownloadDir(formRef.current.downloadDir);
    if (!selection) return;
    const next = {
      ...formRef.current,
      downloadDir: selection.cid,
      downloadDirName: selection.name,
      downloadDirPath: selection.path,
    };
    setForm(next);
    await flush(next);
    await toast(`已选择目录：${selection.path}`, 'success');
  };

  const onAddMediaLibraryRoot = async () => {
    const selection = await chooseDownloadDir('');
    if (!selection?.cid) return;
    const cid = selection.cid.trim();
    if (!cid) return;
    const prev = formRef.current.mediaLibraryRoots || [];
    const without = prev.filter((r) => r.cid !== cid);
    const nextRoots = [
      ...without,
      {
        cid,
        name: selection.name || undefined,
        path: selection.path || undefined,
        enabled: true,
      },
    ];
    const next = { ...formRef.current, mediaLibraryRoots: nextRoots };
    setForm(next);
    await flush(next);
    await toast(`已添加片库目录：${selection.path || selection.name || cid}`, 'success');
  };

  const onRemoveMediaLibraryRoot = async (cid: string) => {
    const nextRoots = (formRef.current.mediaLibraryRoots || []).filter((r) => r.cid !== cid);
    const next = { ...formRef.current, mediaLibraryRoots: nextRoots };
    setForm(next);
    await flush(next);
    await toast('已移除片库目录', 'success');
  };

  const onToggleMediaLibraryRoot = async (cid: string, enabled: boolean) => {
    const nextRoots = (formRef.current.mediaLibraryRoots || []).map((r) =>
      r.cid === cid ? { ...r, enabled } : r,
    );
    const next = { ...formRef.current, mediaLibraryRoots: nextRoots };
    setForm(next);
    await flush(next);
  };

  
  const onIndexMediaLibrary = async () => {
    if (indexingMediaLibrary || indexProgress?.running) return;
    const roots = (formRef.current.mediaLibraryRoots || []).filter((r) => r.enabled !== false);
    if (!roots.length) {
      await toast('请先添加并启用至少一个片库根目录', 'error');
      return;
    }
    if (!formRef.current.enabled || !formRef.current.v2AccessToken) {
      await toast('请先启用 115 并完成授权', 'error');
      return;
    }
    // 先落盘当前表单，避免未保存的 roots
    await flush(formRef.current);
    setIndexingMediaLibrary(true);
    setIndexProgressText('正在限频索引…');
    try {
      const resp: any = await sendRuntimeMessage({ type: 'DRIVE115_MEDIA_LIBRARY_INDEX' });
      // 刷新表单中的 lastIndex 元数据
      try {
        const settings = await getSettings();
        setForm(mapSettingsToDrive115Form(settings));
      } catch {
        /* ignore */
      }
      if (resp?.cancelled) {
        const msg = resp.message || '索引已取消';
        setIndexProgressText(msg);
        await toast(msg, 'success');
      } else if (resp?.success) {
        const stats = resp.stats || resp.state?.stats;
        const detail = stats
          ? `入库 ${stats.indexed || 0}，跳过 ${stats.skipped || 0}，API ${stats.apiCalls || 0}`
          : resp.message || '完成';
        setIndexProgressText(detail);
        await toast(`115 索引完成：${detail}`, 'success');
      } else {
        const msg = resp?.message || '索引失败';
        setIndexProgressText(msg);
        const extra = resp?.partialMerged
          ? ''
          : resp?.keptPrevious
            ? '（已保留上一份索引）'
            : '';
        await toast(`${msg}${extra}`, 'error');
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setIndexProgressText(msg);
      await toast(msg, 'error');
    } finally {
      setIndexingMediaLibrary(false);
    }
  };
  

  const onCancelMediaLibraryIndex = async () => {
    try {
      const resp: any = await sendRuntimeMessage({ type: 'DRIVE115_MEDIA_LIBRARY_CANCEL_INDEX' });
      const msg = resp?.message || (resp?.success ? '正在取消索引…' : '取消索引失败');
      setIndexProgressText(msg);
      if (resp?.success && resp.running === false) {
        setIndexingMediaLibrary(false);
        setIndexProgress((prev) => (prev ? { ...prev, running: false, phase: 'error', message: msg } : null));
      }
      await toast(msg, resp?.success ? 'success' : 'error');
    } catch (e: any) {
      const msg = e?.message || String(e);
      setIndexProgressText(msg);
      await toast(msg, 'error');
    }
  };

  const mediaLibraryLastIndexLabel = useMemo(() => {
    const ts = form.mediaLibraryLastIndexAt;
    if (!ts) return '尚未索引';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  }, [form.mediaLibraryLastIndexAt]);

  const refreshTokenLabel = useMemo(
    () => getRefreshTokenStatusLabel(form, nowSec),
    [form, nowSec],
  );
  const accessExpiry = useMemo(
    () => getAccessTokenExpiryLabel(form, nowSec),
    [form, nowSec],
  );
  const accessStatus = useMemo(() => getAccessTokenStatusLabel(form), [form]);
  const userDisplay = useMemo(
    () => extractUserInfoDisplay(form.v2UserInfo),
    [form.v2UserInfo],
  );
  const nextRefreshAt = useMemo(() => computeNextAutoRefreshAt(form), [form]);
  const refresh2hCount = useMemo(
    () => countRefreshIn2h(form.v2TokenRefreshHistorySec, nowSec),
    [form.v2TokenRefreshHistorySec, nowSec],
  );

  const showOpenlistManual = form.v2AuthMode === 'openlist_manual';
  const showScanPanel =
    form.v2AuthMode === 'self_app' || form.v2AuthMode === 'openlist_scan';
  const showClientId = form.v2AuthMode === 'self_app';
  const showOpenlistScanHint = form.v2AuthMode === 'openlist_scan';

  const sectionNavItems = useMemo<SettingsSectionNavItem[]>(() => [
    { id: DRIVE115_SECTION_IDS.mode, label: '模式与接口', shortLabel: '模式' },
    {
      id: DRIVE115_SECTION_IDS.openlistManual,
      label: 'OpenList 手动获取',
      shortLabel: 'OpenList',
      hidden: !showOpenlistManual,
    },
    {
      id: DRIVE115_SECTION_IDS.pkce,
      label: '扫码授权（PKCE）',
      shortLabel: '扫码',
      hidden: !showScanPanel,
    },
    { id: DRIVE115_SECTION_IDS.credentials, label: '凭据与状态', shortLabel: '凭据' },
    { id: DRIVE115_SECTION_IDS.download, label: '下载设置', shortLabel: '下载' },
    {
      id: DRIVE115_SECTION_IDS.mediaLibrary,
      label: '媒体库',
      shortLabel: '媒体库',
      badge: 'Beta',
    },
    { id: DRIVE115_SECTION_IDS.logs, label: '115 网盘日志', shortLabel: '日志' },
  ], [showOpenlistManual, showScanPanel]);

  return (
    <div
      className="settings-page w-full min-w-0"
      id="drive115-settings"
      data-drive115-settings-react="1"
      data-settings-stack="react-full"
    >
      <div className="ssp-back-bar">
        <button type="button" className="ssp-back settings-back-btn" data-action="back-to-settings">
          ← 返回设置
        </button>
      </div>
      <div className="settings-page-header">
        <h2>115 网盘</h2>
        <p className="settings-description">
          授权、离线下载，以及媒体库片库目录。片库依赖你已整理的封面与 NFO；扩展只做限频索引，不在线深刮。
        </p>
      </div>
      <div className="settings-page-body">
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="drive115-settings-container">
          {saveError ? (
            <p className="m-0 rounded-[var(--radius-2)] border border-[var(--color-danger,#c0392b)]/40 bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] text-[var(--color-danger,#c0392b)]">
              保存失败：{saveError}
            </p>
          ) : null}

          <SettingsSectionNavLayout items={sectionNavItems}>
            <Drive115Group title="模式与接口" navId={DRIVE115_SECTION_IDS.mode}>
            <Drive115LegacyToggle
              id="drive115Enabled"
              label="启用 115 网盘"
              description="支持三种入口：借用 OpenList（开源项目）手动获取、借用 OpenList 扫码、或使用自有 115 应用扫码授权。"
              checked={form.enabled}
              onChange={(v) => void onEnabledChange(v)}
            />

            <Drive115Field
              id="drive115V2AuthMode"
              label="获取方式"
              description="推荐没有 115 开放平台应用的用户先用 OpenList 方案；切换这里只影响上方授权区，不影响下方 token 手动填写。"
            >
              <select
                id="drive115V2AuthMode"
                disabled={disabled}
                value={form.v2AuthMode}
                onChange={(e) => void onAuthModeChange(e.currentTarget.value as Drive115AuthMode)}
              >
                {DRIVE115_AUTH_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Drive115Field>

            <Drive115Field
              id="drive115V2ApiBaseUrl"
              label="接口域名（v2）"
              description="可自定义 v2 接口基础域名，默认 https://proapi.115.com，无需以斜杠结尾。"
            >
              <Input
                id="drive115V2ApiBaseUrl"
                type="text"
                disabled={disabled}
                placeholder="例如：https://proapi.115.com"
                value={form.v2ApiBaseUrl}
                onChange={(e) => update('v2ApiBaseUrl', e.currentTarget.value)}
              />
            </Drive115Field>
          </Drive115Group>

          {showOpenlistManual ? (
            <Drive115Group title="OpenList 手动获取" id="drive115V2OpenlistPanel" navId={DRIVE115_SECTION_IDS.openlistManual}>
              <div className="flex flex-col gap-3 px-2 py-2 text-[13px] text-[var(--color-fg)]">
                <p className="m-0 text-[12.5px] text-[var(--color-fg-muted)]">
                  适合没有自有 115 开放平台应用的用户。先通过 OpenList 的相关工具拿到
                  <code className="mx-1">refresh_token</code> /
                  <code className="mx-1">access_token</code>
                  ，再粘贴到下方“凭据与状态”区域。
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-[var(--color-fg-muted)]">获取地址</div>
                    <code
                      id="drive115V2OpenlistManualUrl"
                      className="block break-all text-[13px]"
                    >
                      {OPENLIST_MANUAL_URL}
                    </code>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Drive115Btn
                      id="drive115V2OpenlistManualOpen"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => openOpenlistManualUrl()}
                    >
                      前往获取
                    </Drive115Btn>
                    <Drive115Btn
                      id="drive115V2OpenlistManualCopy"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => void copyOpenlistManualUrl()}
                    >
                      复制地址
                    </Drive115Btn>
                  </div>
                </div>
                <ol className="m-0 list-decimal space-y-1 pl-5 text-[12.5px] text-[var(--color-fg-muted)]">
                  <li>
                    打开上方地址后，选择 <code>115 网盘 (OAuth2)</code>。
                  </li>
                  <li>按页面提示跳转并登录 115 账号。</li>
                  <li>
                    勾选 <code>使用 OpenList 提供的参数</code>，再获取 token。
                  </li>
                  <li>
                    把得到的 <code>refresh_token</code> 和 <code>access_token</code> 粘贴到下方。
                  </li>
                  <li>点击“验证有效性”，确认当前 token 可用。</li>
                </ol>
              </div>
            </Drive115Group>
          ) : null}

          {showScanPanel ? (
            <Drive115Group title="扫码授权（PKCE）" id="drive115V2SelfAppPanel" navId={DRIVE115_SECTION_IDS.pkce}>
              {showClientId ? (
                <Drive115Field id="drive115V2ClientId" label="APP ID">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="drive115V2ClientId"
                      className="min-w-0 flex-1"
                      disabled={disabled}
                      placeholder="请输入 115 开放平台 APP ID"
                      value={form.v2ClientId}
                      onChange={(e) => update('v2ClientId', e.currentTarget.value)}
                    />
                    <Drive115Btn
                      id="drive115V2StartAuth"
                      variant="primary"
                      disabled={disabled || authBusy}
                      onClick={() => void onStartAuth()}
                    >
                      {authBusy ? '生成中…' : '生成二维码'}
                    </Drive115Btn>
                    <Drive115Btn
                      id="drive115V2CancelAuth"
                      variant="secondary"
                      disabled={disabled}
                      onClick={onCancelAuth}
                    >
                      取消授权
                    </Drive115Btn>
                  </div>
                </Drive115Field>
              ) : null}

              {showOpenlistScanHint ? (
                <>
                  <p
                    id="drive115V2OpenlistScanHint"
                    className="m-0 px-2 text-[12.5px] text-[var(--color-fg-muted)]"
                  >
                    当前使用内置 OpenList APP ID 进行扫码授权，无需手动填写。
                  </p>
                  <div className="flex flex-wrap gap-2 px-2 py-2">
                    <Drive115Btn
                      id="drive115V2StartAuthShared"
                      variant="primary"
                      disabled={disabled || authBusy}
                      onClick={() => void onStartAuth()}
                    >
                      {authBusy ? '生成中…' : '生成二维码'}
                    </Drive115Btn>
                    <Drive115Btn
                      id="drive115V2CancelAuthShared"
                      variant="secondary"
                      disabled={disabled}
                      onClick={onCancelAuth}
                    >
                      取消授权
                    </Drive115Btn>
                  </div>
                </>
              ) : null}

              <p id="drive115V2AuthFlowDesc" className="m-0 px-2 text-[12.5px] text-[var(--color-fg-muted)]">
                {form.v2AuthMode === 'openlist_scan'
                  ? '流程：使用内置 OpenList APP ID → 生成二维码 → 用 115 手机客户端扫码并确认 → 自动保存新 token。'
                  : '流程：输入 APP ID → 生成二维码 → 用 115 手机客户端扫码并确认 → 自动保存新 token。'}
              </p>

              <div
                id="drive115V2AuthPanel"
                className="drive115-auth-panel mx-2 mb-2 flex flex-wrap gap-4 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
              >
                <div className="flex h-[180px] w-[180px] items-center justify-center overflow-hidden rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)]">
                  {authQrUrl ? (
                    <img
                      id="drive115V2QrImage"
                      src={authQrUrl}
                      alt="115 扫码授权二维码"
                      className="drive115-auth-qr-img h-full w-full object-contain"
                    />
                  ) : (
                    <div
                      id="drive115V2QrPlaceholder"
                      className="drive115-auth-placeholder px-3 text-center text-[12px] text-[var(--color-fg-muted)]"
                    >
                      点击“生成二维码”开始授权
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    id="drive115V2AuthStatus"
                    className={`drive115-auth-status mb-2 inline-block rounded-[var(--radius-2)] px-2 py-1 text-[12.5px] ${authKindClass(authStatus.kind)}`}
                  >
                    {authStatus.message}
                  </div>
                  <div
                    id="drive115V2DeviceCodeMeta"
                    className="mb-2 text-[12px] text-[var(--color-fg-muted)]"
                  >
                    {authDeviceMeta}
                  </div>
                  <ul className="m-0 list-disc space-y-1 pl-4 text-[12px] text-[var(--color-fg-muted)]">
                    <li>PKCE 模式不需要 App Secret。</li>
                    <li>二维码失效后重新生成即可。</li>
                    <li>refresh_token 会用于后续自动刷新 access_token。</li>
                  </ul>
                </div>
              </div>
            </Drive115Group>
          ) : null}

          <Drive115Group title="凭据与状态" navId={DRIVE115_SECTION_IDS.credentials}>
            <Drive115Field id="drive115V2RefreshToken" label="refresh_token">
              <p
                id="drive115V2RefreshTokenStatusRow"
                className="m-0 mb-1 text-[12.5px] text-[var(--color-fg-muted)]"
              >
                状态：
                <span
                  id="drive115V2RefreshTokenStatus"
                  className={`ml-1 rounded px-2 py-0.5 text-[11px] ${statusToneClass(refreshTokenLabel.tone)}`}
                  title={refreshTokenLabel.title}
                >
                  {refreshTokenLabel.text}
                </span>
              </p>
              <textarea
                id="drive115V2RefreshToken"
                rows={3}
                disabled={disabled}
                placeholder="粘贴 refresh_token"
                className="min-h-[4.5rem] w-full resize-y break-all rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-[12.5px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus-visible:border-[var(--color-primary)] focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                value={form.v2RefreshToken}
                onChange={(e) => {
                  const trimmed = e.currentTarget.value;
                  const now = Math.floor(Date.now() / 1000);
                  patchForm({
                    v2RefreshToken: trimmed,
                    v2RefreshTokenIssuedAtSec: trimmed.trim() ? now : null,
                    v2RefreshTokenStatus: 'unknown',
                    v2RefreshTokenLastError: undefined,
                    v2RefreshTokenLastErrorCode: undefined,
                  });
                }}
              />
            </Drive115Field>

            <Drive115Field id="drive115V2AccessToken" label="access_token">
              <p className="m-0 mb-1 text-[12.5px] text-[var(--color-fg-muted)]">
                状态：
                <span
                  id="drive115V2TokenExpiry"
                  className={`ml-1 ${statusToneClass(accessExpiry.tone)}`}
                  title={
                    form.v2TokenExpiresAt
                      ? formatDrive115DateTime(form.v2TokenExpiresAt)
                      : ''
                  }
                >
                  {accessExpiry.text}
                </span>
                {accessStatus ? (
                  <span
                    id="drive115V2AccessTokenStatus"
                    className={`ml-2 rounded px-2 py-0.5 text-[11px] ${statusToneClass(accessStatus.tone)}`}
                  >
                    {accessStatus.text}
                  </span>
                ) : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <textarea
                  id="drive115V2AccessToken"
                  rows={3}
                  disabled={disabled}
                  placeholder="粘贴 access_token"
                  className="min-h-[4.5rem] min-w-0 flex-1 resize-y break-all rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-[12.5px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus-visible:border-[var(--color-primary)] focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                  value={form.v2AccessToken}
                  onChange={(e) => {
                    const trimmed = e.currentTarget.value;
                    patchForm({
                      v2AccessToken: trimmed,
                      v2TokenExpiresAt: trimmed.trim() ? form.v2TokenExpiresAt : null,
                      v2AccessTokenStatus: 'unknown',
                      v2AccessTokenLastError: undefined,
                      v2AccessTokenLastErrorCode: undefined,
                      v2UserInfoExpired: false,
                    });
                  }}
                />
                <div className="flex flex-col gap-2">
                  <Drive115Btn
                    id="drive115V2ValidateToken"
                    variant="primary"
                    disabled={disabled || validating}
                    onClick={() => void onValidateToken()}
                  >
                    {validating ? '验证中…' : '验证有效性'}
                  </Drive115Btn>
                  <Drive115Btn
                    id="drive115V2ManualRefresh"
                    variant="secondary"
                    disabled={disabled || refreshing}
                    onClick={() => void onManualRefresh()}
                  >
                    {refreshing ? '刷新中…' : '手动刷新 access_token'}
                  </Drive115Btn>
                </div>
              </div>
              <p className="m-0 mt-1 text-[12px] text-[var(--color-fg-muted)]">
                这里保留手动粘贴作为备用方案；正常情况下建议优先使用上方扫码授权。手动刷新会直接调用
                115 官方 <code>refreshToken</code> 接口。
              </p>
            </Drive115Field>

            <div className="px-2 py-2">
              <div className="mb-1 text-[13.5px] font-semibold text-[var(--color-fg)]">
                账号信息
              </div>
              <p
                id="drive115V2UserInfoStatus"
                className={`m-0 mb-2 text-[12.5px] ${
                  userInfoStatus.kind === 'ok'
                    ? 'text-[var(--color-success,#27ae60)]'
                    : userInfoStatus.kind === 'error'
                      ? 'text-[var(--color-danger,#c0392b)]'
                      : 'text-[var(--color-fg-muted)]'
                }`}
                data-kind={userInfoStatus.kind}
              >
                {userInfoStatus.message}
              </p>
              <div id="drive115V2UserInfoBox" className="drive115-user-info-box">
                {userDisplay ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      {userDisplay.avatar ? (
                        <img
                          src={userDisplay.avatar}
                          alt="avatar"
                          className="h-12 w-12 rounded-full object-cover shadow-sm"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-semibold text-[var(--color-fg)]">
                            {userDisplay.name}
                          </span>
                          {userDisplay.isVip ? (
                            <span className="rounded-full bg-[linear-gradient(135deg,#f2b01e,#e89f0e)] px-2 py-0.5 text-[11px] text-white">
                              {userDisplay.vipLevelName || 'VIP'}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
                          UID: {userDisplay.uid}
                          {userDisplay.vipExpireText
                            ? ` · 到期：${userDisplay.vipExpireText}`
                            : ''}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="h-2 overflow-hidden rounded bg-[var(--color-surface)]">
                        <div
                          className="h-full bg-[linear-gradient(90deg,#42a5f5,#1e88e5)]"
                          style={{ width: `${userDisplay.percent}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[12px] text-[var(--color-fg-muted)]">
                        <span>已用：{userDisplay.usedText}</span>
                        <span>剩余：{userDisplay.freeText}</span>
                        <span>总计：{userDisplay.totalText}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="drive115-user-info-empty">
                    授权成功后会在这里显示账号、VIP 和空间信息。
                  </div>
                )}
              </div>
            </div>

            <Drive115LegacyToggle
              id="drive115V2AutoRefresh"
              label="自动刷新 access_token"
              description="开启后，当 access_token 过期或即将在指定秒数内过期时，将自动使用 refresh_token 刷新并保存。"
              checked={form.v2AutoRefresh}
              disabled={disabled}
              onChange={(v) => update('v2AutoRefresh', v)}
            />

            <Drive115Field
              id="drive115V2AutoRefreshSkewSec"
              label="提前刷新(秒)"
              description="在 token 到期前提前多少秒触发自动刷新。"
            >
              <Input
                id="drive115V2AutoRefreshSkewSec"
                type="number"
                min={0}
                step={1}
                disabled={disabled}
                value={String(form.v2AutoRefreshSkewSec)}
                onChange={(e) => {
                  const n = Math.max(0, Math.floor(Number(e.currentTarget.value) || 0));
                  update('v2AutoRefreshSkewSec', n);
                }}
              />
            </Drive115Field>

            <Drive115Field
              id="drive115V2MinRefreshIntervalMin"
              label="最小自动刷新间隔(分钟)"
              description="范围 60-120。2 小时自动刷新上限固定为 3 次。"
            >
              <Input
                id="drive115V2MinRefreshIntervalMin"
                type="number"
                min={60}
                max={120}
                step={1}
                disabled={disabled}
                value={String(form.v2MinRefreshIntervalMin)}
                onChange={(e) => {
                  const raw = Math.floor(Number(e.currentTarget.value) || 60);
                  const n = Math.min(120, Math.max(60, raw));
                  update('v2MinRefreshIntervalMin', n);
                }}
              />
            </Drive115Field>

            <div
              id="drive115V2RefreshInfoBlock"
              className="mx-2 mb-2 space-y-1 text-[12px] text-[var(--color-fg-muted)]"
            >
              <div>
                最近自动刷新时间：
                <span id="drive115V2LastRefreshAt" className="text-[var(--color-fg)]">
                  {formatDrive115DateTime(form.v2LastTokenRefreshAtSec)}
                </span>
              </div>
              <div>
                下次自动刷新时间：
                <span id="drive115V2NextRefreshAt" className="text-[var(--color-fg)]">
                  {formatDrive115DateTime(nextRefreshAt)}
                </span>
              </div>
              <div>
                2小时内已刷新：
                <span id="drive115V2Refresh2hStat" className="text-[var(--color-fg)]">
                  {refresh2hCount}/3
                </span>
              </div>
            </div>
          </Drive115Group>

          <Drive115Group title="下载设置" navId={DRIVE115_SECTION_IDS.download}>
            <Drive115Field
              id="drive115DownloadDir"
              label="下载目录"
              description="离线下载保存目录。显示文件夹名称，可与媒体库片库目录相同，但字段独立。"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div
                  id="drive115DownloadDir"
                  className="min-w-0 flex-1 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]"
                  title={form.downloadDirPath || form.downloadDirName || form.downloadDir || ''}
                >
                  {form.downloadDirName || form.downloadDirPath ? (
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {form.downloadDirName || form.downloadDirPath}
                      </div>
                      {form.downloadDirPath &&
                      form.downloadDirName &&
                      form.downloadDirPath !== form.downloadDirName ? (
                        <div className="mt-0.5 truncate text-[11.5px] text-[var(--color-fg-muted)]">
                          {form.downloadDirPath}
                        </div>
                      ) : null}
                    </div>
                  ) : form.downloadDir ? (
                    <div className="min-w-0">
                      <div className="truncate text-[var(--color-fg-muted)]">
                        已选目录（仅有 ID，建议重新选择以显示名称）
                      </div>
                    </div>
                  ) : (
                    <span className="text-[var(--color-fg-subtle)]">未选择下载目录</span>
                  )}
                </div>
                <Drive115Btn
                  id="drive115ChooseDownloadDir"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => void onChooseDir()}
                >
                  选择文件夹
                </Drive115Btn>
              </div>
              {form.downloadDir ? (
                <div
                  id="drive115DownloadDirSummary"
                  className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-fg-muted)]"
                >
                  <span>目录 ID</span>
                  <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px]">
                    {form.downloadDir}
                  </code>
                </div>
              ) : null}
            </Drive115Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <Drive115Field
                id="drive115VerifyCount"
                label="验证次数"
                description="下载后验证文件的重试次数，建议 3-5 次。"
              >
                <Input
                  id="drive115VerifyCount"
                  type="number"
                  min={1}
                  max={20}
                  disabled={disabled}
                  value={String(form.verifyCount)}
                  onChange={(e) => {
                    const n = Math.max(1, Math.floor(Number(e.currentTarget.value) || 1));
                    update('verifyCount', n);
                  }}
                />
              </Drive115Field>

              <Drive115Field
                id="drive115MaxFailures"
                label="最大失败数"
                description="批量下载时允许的最大失败次数，0 表示不限制。"
              >
                <Input
                  id="drive115MaxFailures"
                  type="number"
                  min={0}
                  max={50}
                  disabled={disabled}
                  value={String(form.maxFailures)}
                  onChange={(e) => {
                    const n = Math.max(0, Math.floor(Number(e.currentTarget.value) || 0));
                    update('maxFailures', n);
                  }}
                />
              </Drive115Field>
            </div>
          </Drive115Group>

          <Drive115Group title="媒体库" navId={DRIVE115_SECTION_IDS.mediaLibrary} beta>
            <p className="m-0 px-2 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
              配置你已自备刮削的片库根目录（典型：每部影片一个文件夹，内含视频 + 封面 + NFO）。
              扩展只做浅层限频索引，不会在线深刮章节/相似/海报。片库目录与上方「下载目录」独立，可以相同。
            </p>

            <Drive115Field
              id="drive115MediaLibraryRoots"
              label="片库根目录"
              description="支持多个根目录。误选整盘时索引会有上限保护，请尽量只选已整理的片库。"
            >
              <div className="flex flex-col gap-2">
                {(form.mediaLibraryRoots || []).length === 0 ? (
                  <div className="rounded-[var(--radius-2)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-[12.5px] text-[var(--color-fg-muted)]">
                    尚未配置片库目录。请添加你已整理好的影片文件夹根目录。
                  </div>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {form.mediaLibraryRoots.map((root) => (
                      <li
                        key={root.cid}
                        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2"
                      >
                        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--color-fg)]">
                          <input
                            type="checkbox"
                            checked={root.enabled !== false}
                            disabled={disabled}
                            onChange={(e) =>
                              void onToggleMediaLibraryRoot(root.cid, e.currentTarget.checked)
                            }
                          />
                          启用
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-[var(--color-fg)]">
                            {root.name || root.path || root.cid}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--color-fg-muted)]">
                            {root.path && root.path !== root.name ? (
                              <span className="truncate">{root.path}</span>
                            ) : null}
                            <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5">
                              {root.cid}
                            </code>
                          </div>
                        </div>
                        <Drive115Btn
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => void onRemoveMediaLibraryRoot(root.cid)}
                        >
                          移除
                        </Drive115Btn>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Drive115Btn
                    id="drive115AddMediaLibraryRoot"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => void onAddMediaLibraryRoot()}
                  >
                    添加片库目录
                  </Drive115Btn>
                </div>
              </div>
            </Drive115Field>

            <Drive115Field
              id="drive115MediaLibraryScanDepth"
              label="索引深度"
              description="默认 2 层，适合“演员/番号/视频”结构；如果根目录下直接就是影片文件夹可选 1 层，最多 8 层；层数越大越可能误扫整盘，请配合上限保护谨慎使用。"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="drive115MediaLibraryScanDepth"
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  className="w-28"
                  disabled={disabled || indexingMediaLibrary || indexProgress?.running}
                  value={form.mediaLibraryScanDepth}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.currentTarget.value));
                    const depth = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 2;
                    update('mediaLibraryScanDepth', depth);
                  }}
                />
                <span className="text-[11.5px] text-[var(--color-fg-muted)]">
                  当前会向下扫描 {form.mediaLibraryScanDepth || 2} 层目录。
                </span>
              </div>
            </Drive115Field>

            <div className="mx-2 mb-1 space-y-2 text-[12px] text-[var(--color-fg-muted)]">
              <div className="flex flex-wrap items-center gap-2">
                <Drive115Btn
                  id="drive115IndexMediaLibrary"
                  variant="primary"
                  disabled={
                    disabled ||
                    (indexingMediaLibrary || indexProgress?.running) ||
                    (form.mediaLibraryRoots || []).filter((r) => r.enabled !== false).length === 0
                  }
                  onClick={() => void onIndexMediaLibrary()}
                >
                  {indexingMediaLibrary || indexProgress?.running ? '索引中…' : '立即索引'}
                </Drive115Btn>
                {indexingMediaLibrary || indexProgress?.running ? (
                  <Drive115Btn
                    id="drive115CancelMediaLibraryIndex"
                    variant="danger"
                    disabled={disabled}
                    onClick={() => void onCancelMediaLibraryIndex()}
                  >
                    取消索引
                  </Drive115Btn>
                ) : null}
                <span className="text-[11.5px]">
                  串行限频：按上方深度扫描，单次最多 300 个影片文件夹；中断会合并保存本轮已扫到的条目，若本轮 0 条则保留上一份索引。
                </span>
              </div>

              <div
                id="drive115IndexStatusPanel"
                className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 space-y-1.5"
              >
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-medium text-[var(--color-fg)]">索引状态</span>
                  <span
                    className={
                      indexingMediaLibrary || indexProgress?.running
                        ? 'text-[var(--color-primary,#e67e22)]'
                        : form.mediaLibraryLastIndexError
                          ? 'text-[var(--color-danger,#c0392b)]'
                          : 'text-[var(--color-fg-muted)]'
                    }
                  >
                    {indexingMediaLibrary || indexProgress?.running
                      ? '进行中'
                      : form.mediaLibraryLastIndexError
                        ? '上次失败/中断'
                        : form.mediaLibraryLastIndexAt
                          ? '空闲'
                          : '尚未索引'}
                  </span>
                </div>
                <div>
                  上次索引：
                  <span className="text-[var(--color-fg)]">{mediaLibraryLastIndexLabel}</span>
                </div>
                {(indexingMediaLibrary || indexProgress?.running) && indexProgress ? (
                  <div className="space-y-1 text-[var(--color-fg)]">
                    <div>{indexProgress.message || indexProgressText || '正在限频索引…'}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[var(--color-fg-muted)]">
                      <span>
                        根目录 {indexProgress.rootsDone || 0}/{indexProgress.rootsTotal || 0}
                      </span>
                      <span>已扫描文件夹 {indexProgress.foldersSeen || 0}</span>
                      <span>入库 {indexProgress.indexed || 0}</span>
                      <span>跳过 {indexProgress.skipped || 0}</span>
                      <span>API {indexProgress.apiCalls || 0}</span>
                    </div>
                    {indexReport && indexReport.skippedTotal > 0 ? (
                      <div className="text-[11.5px] text-[var(--color-fg-muted)]">
                        跳过原因：
                        {(Object.keys(indexReport.skipReasonCounts) as Drive115IndexSkipReason[])
                          .map((reason) => ({ reason, count: indexReport.skipReasonCounts[reason] || 0 }))
                          .filter((row) => row.count > 0)
                          .sort((a, b) => b.count - a.count)
                          .map((row) => `${SKIP_REASON_LABELS[row.reason] || row.reason} ${row.count}`)
                          .join(' · ')}
                      </div>
                    ) : null}
                  </div>
                ) : indexProgressText ? (
                  <div className="text-[11.5px] text-[var(--color-fg)]">{indexProgressText}</div>
                ) : null}
                {form.mediaLibraryLastIndexError ? (
                  <div className="text-[var(--color-danger,#c0392b)]">
                    上次错误：{form.mediaLibraryLastIndexError}
                  </div>
                ) : null}
                {indexReport ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11.5px] text-[var(--color-fg-muted)]">
                    <span>
                      本轮结果：入库 {indexReport.indexedTotal}，跳过 {indexReport.skippedTotal}
                      {indexReport.truncatedFolders
                        ? `，截断 ${indexReport.truncatedFolders}`
                        : ''}
                    </span>
                    <Button
                      id="drive115ViewIndexReport"
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowIndexReport(true)}
                    >
                      查看详情
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            <Drive115IndexReportModal
              open={showIndexReport}
              report={indexReport}
              onClose={() => setShowIndexReport(false)}
            />

          </Drive115Group>
          <Drive115Group title="115 网盘日志" navId={DRIVE115_SECTION_IDS.logs}>
            <div className="action-buttons-top">
              <Drive115Btn
                id="refreshDrive115Logs"
                variant="secondary"
                disabled={logsLoading || logsBusy}
                onClick={() => void refreshLogs()}
              >
                {logsLoading ? '刷新中…' : '刷新日志'}
              </Drive115Btn>
              <Drive115Btn
                id="clearDrive115Logs"
                variant="danger"
                disabled={logsLoading || logsBusy}
                onClick={() => void onClearLogs()}
              >
                清空日志
              </Drive115Btn>
              <Drive115Btn
                id="exportDrive115Logs"
                variant="secondary"
                disabled={logsLoading || logsBusy || logLines.length === 0}
                onClick={() => void onExportLogs()}
              >
                导出日志
              </Drive115Btn>
            </div>
            <div id="drive115LogStats" className="log-stats">
              {logStatsText}
            </div>
            <div
              id="drive115LogsList"
              className="logs-list mx-2 mb-2 max-h-64 overflow-auto rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-2"
            >
              {logsLoading ? (
                <div className="px-1 py-2 text-[12.5px] text-[var(--color-fg-muted)]">加载日志中…</div>
              ) : logLines.length === 0 ? (
                <div className="px-1 py-2 text-[12.5px] text-[var(--color-fg-muted)]">暂无日志</div>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {logLines.map((line, idx) => (
                    <li
                      key={`${idx}-${line.slice(0, 24)}`}
                      className="rounded-[var(--radius-1)] border border-[var(--color-border)]/70 bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[11.5px] leading-snug text-[var(--color-fg)]"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Drive115Group>

          </SettingsSectionNavLayout>
        </div>
      )}
      </div>
    </div>
  );
}


