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
import type { SettingsSectionNavItem } from '../shared/SettingsSectionNav';
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

const UPDATE_SECTION_IDS = {
  version: 'update-section-version',
  automatic: 'update-section-automatic',
  products: 'update-section-products',
  community: 'update-section-community',
  details: 'update-section-details',
} as const;

const UPDATE_SECTION_NAV_ITEMS: SettingsSectionNavItem[] = [
  { id: UPDATE_SECTION_IDS.version, label: '版本检查', shortLabel: '版本' },
  { id: UPDATE_SECTION_IDS.automatic, label: '自动检查设置', shortLabel: '自动检查' },
  { id: UPDATE_SECTION_IDS.products, label: '系列产品', shortLabel: '产品' },
  { id: UPDATE_SECTION_IDS.community, label: '社区与文档', shortLabel: '社区' },
  { id: UPDATE_SECTION_IDS.details, label: '版本详情', shortLabel: '详情' },
];

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
      sectionNavItems={UPDATE_SECTION_NAV_ITEMS}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="update-settings">
          <SettingSection
            id={UPDATE_SECTION_IDS.version}
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
            id={UPDATE_SECTION_IDS.automatic}
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

          <SettingSection
            id={UPDATE_SECTION_IDS.products}
            title="JavdBviewed 系列产品"
            description="围绕媒体收藏、跨端观看与自建同步服务持续建设。"
          >
            <div className="grid gap-2 px-2 py-2 sm:grid-cols-2">
              <div className="flex min-h-[74px] items-center gap-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-2)] bg-[var(--color-fg)] text-[10px] font-extrabold text-[var(--color-surface)]">WEB</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] text-[var(--color-fg)]">浏览器扩展</strong>
                  <span className="block truncate text-[11px] text-[var(--color-fg-muted)]">媒体库、收藏与播放</span>
                </span>
                <span className="shrink-0 rounded-[5px] bg-[var(--color-primary-soft)] px-2 py-1 text-[10px] font-extrabold text-[var(--color-primary-active)]">当前使用</span>
              </div>
              <a
                className="flex min-h-[74px] items-center gap-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 no-underline hover:border-[var(--color-primary)]"
                href="https://docs.we-together.club/download/#cloud-deploy"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-2)] bg-[var(--color-warning,#cc6c32)] text-[12px] font-extrabold text-white">C</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] text-[var(--color-fg)]">JavdBviewed Cloud</strong>
                  <span className="block truncate text-[11px] text-[var(--color-fg-muted)]">自建服务 · 多端数据同步 · 查看部署文档</span>
                </span>
                <span className="shrink-0 rounded-[5px] bg-[var(--color-primary-soft)] px-2 py-1 text-[10px] font-extrabold text-[var(--color-primary-active)]">测试中</span>
              </a>
              <div className="flex min-h-[74px] items-center gap-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-2)] bg-[var(--color-fg-muted)] text-[10px] font-extrabold text-white">DESK</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] text-[var(--color-fg)]">桌面端</strong>
                  <span className="block truncate text-[11px] text-[var(--color-fg-muted)]">独立窗口与本地媒体体验</span>
                </span>
                <span className="shrink-0 rounded-[5px] bg-[var(--color-surface)] px-2 py-1 text-[10px] font-extrabold text-[var(--color-fg-muted)]">开发中</span>
              </div>
              <div className="flex min-h-[74px] items-center gap-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-2)] bg-[var(--color-fg-muted)] text-[12px] font-extrabold text-white">A</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] text-[var(--color-fg)]">Android</strong>
                  <span className="block truncate text-[11px] text-[var(--color-fg-muted)]">移动端媒体库与观看</span>
                </span>
                <span className="shrink-0 rounded-[5px] bg-[var(--color-surface)] px-2 py-1 text-[10px] font-extrabold text-[var(--color-fg-muted)]">开发中</span>
              </div>
            </div>
            <a
              data-product-support="star"
              className="mx-2 mb-2 flex items-center gap-3 rounded-[var(--radius-2)] border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-3 py-3 no-underline hover:bg-[var(--color-primary-soft-hover,var(--color-primary-soft))]"
              href="https://github.com/JavdBviewed/JavdBviewed"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-2)] bg-[var(--color-primary)] text-lg text-white"
                aria-hidden="true"
              >
                ★
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-[13px] text-[var(--color-fg)]">
                  喜欢这个项目？欢迎在 GitHub 点个 Star 支持我们
                </strong>
                <span className="mt-0.5 block text-[11px] text-[var(--color-fg-muted)]">
                  你的支持会帮助我们持续完善扩展和更多客户端。
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-bold text-[var(--color-primary-active)]">
                给项目一个 Star
              </span>
            </a>
          </SettingSection>

          <SettingSection
            id={UPDATE_SECTION_IDS.community}
            title="社区与文档"
            description="获取使用帮助、加入社区或反馈问题。"
          >
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

          <SettingSection id={UPDATE_SECTION_IDS.details} title="版本详情">
            <div ref={versionInfoRef} className="dashboard-version-info px-2 py-2" />
          </SettingSection>
        </div>
      )}
    </SettingsPageFrame>
  );
}
