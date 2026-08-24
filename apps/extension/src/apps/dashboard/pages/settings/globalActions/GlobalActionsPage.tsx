/**
 * @file GlobalActionsPage.tsx
 * @description 全局操作 React 全页
 * @module apps/dashboard/pages/settings/globalActions
 */
import { Button } from '../../../../../ui/primitives/Button/Button';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import {
  clearAllLocalData,
  clearCacheData,
  clearTempData,
  reloadExtension,
  resetAllSettings,
} from './globalActionsActions';

/**
 * 全局操作完整页面
 */
export function GlobalActionsPage() {
  return (
    <SettingsPageFrame
      title="全局操作"
      description="执行全局性的数据管理操作。请谨慎使用这些功能。"
      rootDataAttrs={{ 'data-global-actions-react': '1' }}
    >
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
