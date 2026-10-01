/**
 * @file AdvancedSettingsPage.tsx
 * @description 高级配置 React 全页
 * @module apps/dashboard/pages/settings/advanced
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { getSettings } from '../shared/settingsPersist';
import {
  editSettingsJson,
  exportCompleteBackup,
  mapTelemetryEnabled,
  sendTestLog,
  setTelemetryEnabled,
  viewRawLogs,
  viewSettingsJson,
} from './advancedSettingsActions';
import {
  clearAllLocalData,
  clearCacheData,
  clearTempData,
  reloadExtension,
  resetAllSettings,
} from '../globalActions/globalActionsActions';

/**
 * 高级配置完整页面
 */
export function AdvancedSettingsPage() {
  const [telemetryEnabled, setTelemetry] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        setTelemetry(mapTelemetryEnabled(settings));
      } catch (err) {
        console.error('[AdvancedSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onTelemetryChange = async (checked: boolean) => {
    const prev = telemetryEnabled;
    setTelemetry(checked);
    const ok = await setTelemetryEnabled(checked);
    if (!ok) setTelemetry(prev);
  };

  return (
    <SettingsPageFrame
      title="高级配置"
      description="原始配置编辑与全局数据操作，请谨慎使用危险功能。"
      rootDataAttrs={{ 'data-advanced-settings-react': '1' }}
      pageId="advanced-settings"
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="advanced-settings">
          <SettingSection
            title="原始配置工作台"
            description="查看、编辑原始 JSON 配置，并导出完整备份。编辑配置会直接影响扩展行为。"
          >
            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button id="viewJsonBtn" variant="secondary" onClick={() => void viewSettingsJson()}>
                <i className="fas fa-eye" aria-hidden="true" /> 查看设置
              </Button>
              <Button id="editJsonBtn" variant="secondary" onClick={() => void editSettingsJson()}>
                <i className="fas fa-edit" aria-hidden="true" /> 编辑设置
              </Button>
              <Button id="exportJsonBtn" variant="primary" onClick={() => void exportCompleteBackup()}>
                <i className="fas fa-download" aria-hidden="true" /> 导出完整备份
              </Button>
            </div>
            <div className="mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] text-[var(--color-fg)]">
              编辑 JSON 前建议先导出完整备份，避免配置结构错误影响使用。
            </div>
          </SettingSection>

          <div className="grid gap-4 md:grid-cols-2">
            <SettingSection
              title="原始日志"
              description="查看扩展运行日志，用于定位异常和排查问题。"
            >
              <div className="flex flex-wrap gap-2 px-2 py-2">
                <Button id="viewRawLogsBtn" variant="secondary" onClick={() => void viewRawLogs()}>
                  <i className="fas fa-file-alt" aria-hidden="true" /> 查看日志
                </Button>
                <Button id="testLogBtn" variant="secondary" onClick={() => void sendTestLog()}>
                  <i className="fas fa-vial" aria-hidden="true" /> 测试日志
                </Button>
              </div>
              <p className="m-0 px-2 pb-2 text-[12px] text-[var(--color-fg-muted)]">
                日志查看为只读操作，测试日志会写入一条新的诊断日志。
              </p>
            </SettingSection>

            <SettingSection title="使用情况统计" description="帮助了解拓展功能使用状态。">
              <SettingToggleRow
                id="telemetryEnabled"
                label="发送匿名使用情况统计"
                checked={telemetryEnabled}
                onChange={(c) => void onTelemetryChange(c)}
              />
            </SettingSection>
          </div>

          <SettingSection title="使用建议" description="高级功能适合调试、迁移和恢复配置时使用。">
            <ul className="m-0 list-disc px-6 py-2 text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
              <li>先备份，再编辑。</li>
              <li>修改 JSON 后刷新页面确认配置生效。</li>
              <li>排查问题时先导出日志和完整备份。</li>
            </ul>
          </SettingSection>
        </div>
      )}
      {/* 2026-10-03 IA 裁决：全局操作页并入本页。
          包裹层 id 与 5 个按钮 id 原样保留（遗留 CSS 选择器 / 搜索定位 / e2e 锚点契约不变），
          且不受上方 loading 态影响，行为与独立成页时逐字一致。 */}
      <div className="flex flex-col gap-4" id="global-actions">
        <SettingSection title="全局数据操作" description="影响本地数据、缓存和扩展运行状态的危险操作。">
          <div className="flex flex-col gap-3 px-2 py-2">
            <p className="m-0 text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
              这里集中放置会影响本地数据、缓存和扩展运行状态的操作。危险操作会保留确认流程。
            </p>
            <div>
              <Button id="clearAllBtn" variant="danger" onClick={() => void clearAllLocalData()}>
                <i className="fas fa-trash" aria-hidden="true" /> 清空所有本地记录
              </Button>
            </div>
            <div className="rounded-[var(--radius-2)] border border-[var(--color-danger,#c0392b)]/30 bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] text-[var(--color-fg)]">
              清空所有本地记录会删除视频记录、演员数据和设置配置。
            </div>
          </div>
        </SettingSection>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingSection title="缓存管理" description="清理缓存和临时数据，保留核心记录。">
            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button id="clearCacheBtn" variant="secondary" onClick={() => void clearCacheData()}>
                <i className="fas fa-broom" aria-hidden="true" /> 清空缓存
              </Button>
              <Button id="clearTempDataBtn" variant="secondary" onClick={() => void clearTempData()}>
                <i className="fas fa-eraser" aria-hidden="true" /> 清空临时数据
              </Button>
            </div>
            <p className="m-0 px-2 pb-2 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
              <strong className="text-[var(--color-fg)]">清空缓存:</strong> 清除图片、头像等缓存文件。
              <br />
              <strong className="text-[var(--color-fg)]">清空临时数据:</strong>{' '}
              清除搜索历史、临时设置等非关键数据。
            </p>
          </SettingSection>

          <SettingSection title="系统操作" description="恢复默认配置或重新加载扩展运行环境。">
            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button id="resetSettingsBtn" variant="secondary" onClick={() => void resetAllSettings()}>
                <i className="fas fa-undo" aria-hidden="true" /> 重置所有设置
              </Button>
              <Button id="reloadExtensionBtn" variant="primary" onClick={() => void reloadExtension()}>
                <i className="fas fa-sync-alt" aria-hidden="true" /> 重新加载扩展
              </Button>
            </div>
            <p className="m-0 px-2 pb-2 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
              <strong className="text-[var(--color-fg)]">重置所有设置:</strong> 恢复默认设置，保留数据记录。
              <br />
              <strong className="text-[var(--color-fg)]">重新加载扩展:</strong>{' '}
              重新加载扩展程序，用于解决运行异常。
            </p>
          </SettingSection>
        </div>
      </div>
    </SettingsPageFrame>
  );
}
