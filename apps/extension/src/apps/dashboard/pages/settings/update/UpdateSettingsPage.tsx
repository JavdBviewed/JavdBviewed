/**
 * @file UpdateSettingsPage.tsx
 * @description 版本与关于 React 全页
 * @module apps/dashboard/pages/settings/update
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import {
  getCurrentVersion,
  markLastUpdateCheckNow,
  openChangelog,
  openDownload,
  persistUpdateForm,
  readLastUpdateCheck,
  runUpdateCheck,
  toast,
} from './updateSettingsActions';
import {
  DEFAULT_UPDATE_SETTINGS_FORM,
  formatLastUpdateCheck,
  mapSettingsToUpdateForm,
  UPDATE_INTERVAL_OPTIONS,
  type UpdateSettingsFormState,
} from './updateSettingsModel';
import { getSettings } from '../shared/settingsPersist';

/**
 * 版本与关于完整页面
 */
export function UpdateSettingsPage() {
  const [form, setForm] = useState<UpdateSettingsFormState>(DEFAULT_UPDATE_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('…');
  const [latestVersion, setLatestVersion] = useState('检查中…');
  const [latestTone, setLatestTone] = useState<'normal' | 'checking' | 'error'>('checking');
  const [lastCheckLabel, setLastCheckLabel] = useState('从未检查');
  const [notice, setNotice] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const versionInfoRef = useRef<HTMLDivElement | null>(null);

  const refreshLastCheck = useCallback(() => {
    setLastCheckLabel(formatLastUpdateCheck(readLastUpdateCheck()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        setForm(mapSettingsToUpdateForm(settings));
        setCurrentVersion(getCurrentVersion());
        refreshLastCheck();
      } catch (err) {
        console.error('[UpdateSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLastCheck]);

  // 版本详情岛：复用遗留 renderDashboardVersionInfo
  useEffect(() => {
    if (loading) return;
    const el = versionInfoRef.current;
    if (!el) return;
    el.id = 'aboutVersionInfo';
    void import('../../../dashboardVersionInfo').then(({ renderDashboardVersionInfo }) => {
      renderDashboardVersionInfo('aboutVersionInfo');
    });
  }, [loading]);

  const checkUpdates = useCallback(
    async (nextForm: UpdateSettingsFormState, silent = false) => {
      if (checking) return;
      setChecking(true);
      setLatestTone('checking');
      setLatestVersion('检查中…');
      try {
        const result = await runUpdateCheck(nextForm);
        markLastUpdateCheckNow();
        refreshLastCheck();

        if (result.error) {
          setLatestVersion('检查失败');
          setLatestTone('error');
          setNotice(`检查更新失败: ${result.error}`);
          setHasUpdate(false);
          if (!silent) await toast('检查更新失败', 'error');
          return;
        }

        setLatestVersion(result.latestVersion || result.currentVersion || getCurrentVersion());
        setLatestTone('normal');
        if (result.hasUpdate) {
          setHasUpdate(true);
          setDownloadUrl(result.releaseUrl || null);
          setNotice(`发现新版本 ${result.latestVersion}！建议更新以获得最新功能和修复。`);
          if (!silent) await toast(`发现新版本 ${result.latestVersion}`, 'info');
        } else {
          setHasUpdate(false);
          setDownloadUrl(null);
          setNotice(`当前已是最新版本 ${result.currentVersion || getCurrentVersion()}。`);
          if (!silent) await toast('当前已是最新版本', 'success');
        }
      } catch (err) {
        setLatestVersion('检查失败');
        setLatestTone('error');
        setNotice(`检查更新失败: ${err instanceof Error ? err.message : '未知错误'}`);
        if (!silent) await toast('检查更新失败', 'error');
      } finally {
        setChecking(false);
      }
    },
    [checking, refreshLastCheck],
  );

  // 进入页延迟自动检查（与遗留一致）
  useEffect(() => {
    if (loading) return;
    const t = window.setTimeout(() => {
      void checkUpdates(form, true);
    }, 1000);
    return () => window.clearTimeout(t);
    // 仅首屏加载后触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const updateField = useCallback(
    async <K extends keyof UpdateSettingsFormState>(key: K, value: UpdateSettingsFormState[K]) => {
      const previous = form;
      const next = { ...form, [key]: value };
      setForm(next);
      try {
        await persistUpdateForm(next, { emitEvents: true, previous });
        if (key === 'autoUpdateCheck') {
          await toast(`自动检查更新已${value ? '启用' : '禁用'}`, 'success');
        } else if (key === 'updateCheckInterval') {
          await toast(`检查间隔已设置为 ${value} 小时`, 'success');
        } else if (key === 'includePrerelease') {
          await toast(`${value ? '将' : '不'}包含预发布版本`, 'success');
        }
      } catch (err) {
        console.error('[UpdateSettingsPage] save failed', err);
        setForm(previous);
        await toast('保存设置失败', 'error');
      }
    },
    [form],
  );

  return (
    <SettingsPageFrame
      title="版本与关于"
      description="检查更新、查看版本与项目链接。"
      rootDataAttrs={{ 'data-update-settings-react': '1' }}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="update-settings">
          <SettingSection
            title="版本检查"
            description="进入此页面会实时检查 GitHub 最新发布，自动检查间隔只用于顶部徽标和后台提醒。"
          >
            <div className="flex flex-col gap-3 px-2 py-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  id="checkUpdateNow"
                  variant="primary"
                  disabled={checking}
                  onClick={() => void checkUpdates(form, false)}
                >
                  {checking ? '检查中…' : '立即检查'}
                </Button>
                {hasUpdate ? (
                  <Button
                    id="downloadUpdate"
                    variant="secondary"
                    onClick={() => openDownload(downloadUrl)}
                  >
                    下载更新
                  </Button>
                ) : (
                  <button id="downloadUpdate" type="button" className="hidden" aria-hidden />
                )}
                <Button id="viewChangelog" variant="ghost" onClick={() => openChangelog()}>
                  查看更新日志
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                  <div className="text-[11px] text-[var(--color-fg-muted)]">当前版本</div>
                  <div id="currentVersion" className="mt-0.5 text-sm font-bold text-[var(--color-fg)]">
                    {currentVersion}
                  </div>
                </div>
                <div className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                  <div className="text-[11px] text-[var(--color-fg-muted)]">最新版本</div>
                  <div
                    id="latestVersion"
                    className={`mt-0.5 text-sm font-bold ${
                      latestTone === 'error'
                        ? 'text-[var(--color-danger,#c0392b)]'
                        : latestTone === 'checking'
                          ? 'text-[var(--color-fg-muted)]'
                          : 'text-[var(--color-fg)]'
                    }`}
                  >
                    {latestVersion}
                  </div>
                </div>
                <div className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                  <div className="text-[11px] text-[var(--color-fg-muted)]">上次检查</div>
                  <div id="lastUpdateCheck" className="mt-0.5 text-sm font-bold text-[var(--color-fg)]">
                    {lastCheckLabel}
                  </div>
                </div>
              </div>

              {notice ? (
                <div
                  id="updateNotification"
                  className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-fg)]"
                  role="status"
                >
                  <span id="updateMessage">{notice}</span>
                </div>
              ) : (
                <div id="updateNotification" className="hidden" aria-hidden>
                  <span id="updateMessage" />
                </div>
              )}
            </div>
          </SettingSection>

          <SettingSection
            title="自动检查设置"
            description="用于 dashboard 顶部徽标和自动提醒，不影响本页面实时检查"
          >
            <SettingToggleRow
              id="autoUpdateCheck"
              label="启用自动检查更新"
              description="定期自动检查是否有新版本发布"
              checked={form.autoUpdateCheck}
              onChange={(v) => void updateField('autoUpdateCheck', v)}
            />
            <div className="px-2 py-2">
              <label
                htmlFor="updateCheckInterval"
                className="mb-1 block text-[13.5px] font-semibold text-[var(--color-fg)]"
              >
                检查间隔
              </label>
              <p className="m-0 mb-2 text-[12px] text-[var(--color-fg-muted)]">
                设置自动检查更新的时间间隔
              </p>
              <SettingSelect
                id="updateCheckInterval"
                value={form.updateCheckInterval}
                options={UPDATE_INTERVAL_OPTIONS}
                onChange={(v) => void updateField('updateCheckInterval', v)}
              />
            </div>
            <SettingToggleRow
              id="includePrerelease"
              label="包含预发布版本"
              description="检查时包含测试版和预览版"
              checked={form.includePrerelease}
              onChange={(v) => void updateField('includePrerelease', v)}
            />
          </SettingSection>

          <SettingSection title="项目信息">
            <div className="grid gap-2 px-2 py-2 sm:grid-cols-3">
              <a
                className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-center text-[13px] font-semibold text-[var(--color-fg)] no-underline hover:border-[var(--color-primary)]"
                href="https://github.com/JavdBviewed/JavdBviewed"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub 项目
              </a>
              <a
                className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-center text-[13px] font-semibold text-[var(--color-fg)] no-underline hover:border-[var(--color-primary)]"
                href="https://t.me/javdbviewed"
                target="_blank"
                rel="noopener noreferrer"
              >
                Telegram 群组
              </a>
              <a
                className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-center text-[13px] font-semibold text-[var(--color-fg)] no-underline hover:border-[var(--color-primary)]"
                href="https://docs.we-together.club/"
                target="_blank"
                rel="noopener noreferrer"
              >
                帮助文档
              </a>
            </div>
          </SettingSection>

          <SettingSection title="版本详情">
            <div ref={versionInfoRef} className="dashboard-version-info px-2 py-2" />
          </SettingSection>
        </div>
      )}
    </SettingsPageFrame>
  );
}
