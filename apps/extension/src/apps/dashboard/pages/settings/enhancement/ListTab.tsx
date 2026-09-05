/**
 * @file ListTab.tsx
 * @description 功能增强设置 - 列表页增强
 * @module apps/dashboard/pages/settings/enhancement
 */
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { KeywordFilterRule } from '../../../../../types';
import type { EnhancementSettingsFormState } from './enhancementSettingsModel';
import {
  SettingSection,
  parseIntNum,
  parseNum,
  removeFilterRuleAt,
  setFilterRuleEnabled,
  setFilterRuleHideEnabled,
  ONLINE_AVAILABILITY_SITE_OPTIONS,
  toggleOnlineAvailabilitySite,
  PREVIEW_SOURCE_OPTIONS,
  WATERMARK_POSITION_OPTIONS,
  getFilterActionLabel,
  TabProps,
} from './_shared';
export function ListTab({
  form,
  setToggle,
  patchForm,
  onOpenFilterRuleEditor,
  onToggleRule,
  onToggleRuleHide,
  onDeleteRule,
}: TabProps & {
  onOpenFilterRuleEditor: (index?: number) => void;
  onToggleRule: (i: number, enabled: boolean) => void;
  onToggleRuleHide: (i: number, hideEnabled: boolean) => void;
  onDeleteRule: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SettingSection title="内容过滤" description="按关键词隐藏/高亮列表中的影片卡片">
        <SettingToggleRow
          id="enableContentFilter"
          label="启用内容过滤"
          description="在列表页应用关键字过滤规则"
          checked={form.enableContentFilter}
          onChange={(v) => setToggle('enableContentFilter', v)}
        />
        {form.enableContentFilter ? (
          <div id="contentFilterConfig" className="mt-2 flex flex-col gap-2 px-2">
            <SettingToggleRow
              id="contentFilterHideEnabled"
              label="隐藏开关"
              description="关闭后，「隐藏」动作的匹配不再隐藏卡片（仅高亮/模糊/标记等动作仍生效）"
              checked={form.contentFilterHideEnabled}
              onChange={(v) => setToggle('contentFilterHideEnabled', v)}
            />
            <div className="filter-rules-header">
              <span>过滤规则列表</span>
              <Button id="addFilterRule" type="button" variant="secondary" size="sm" onClick={() => onOpenFilterRuleEditor()}>
                <i className="fas fa-plus" aria-hidden="true" /> 添加规则
              </Button>
            </div>
            <div id="filterRulesList" className="flex flex-col gap-2">
              {form.filterRules.length === 0 ? (
                <p className="m-0 px-1 text-xs text-[var(--color-fg-muted)]">
                  暂无过滤规则，点击「添加规则」开始配置。
                </p>
              ) : (
                form.filterRules.map((rule: KeywordFilterRule, index: number) => (
                  <div
                    key={rule.id || index}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-2)] hover:shadow-[var(--shadow-1)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{rule.name}</div>
                      <div className="text-xs text-[var(--color-fg-muted)]">
                        关键词：{rule.keyword || '—'} · 动作：{getFilterActionLabel(rule.action)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <SettingToggleRow
                        id={`filterRuleEnabled-${index}`}
                        label="启用"
                        checked={rule.enabled !== false}
                        onChange={(v) => onToggleRule(index, v)}
                        className="!py-1"
                      />
                      {rule.action === 'hide' ? (
                        <SettingToggleRow
                          id={`filterRuleHideEnabled-${index}`}
                          label="隐藏"
                          checked={rule.hideEnabled !== false}
                          onChange={(v) => onToggleRuleHide(index, v)}
                          className="!py-1"
                        />
                      ) : null}
                      <Button type="button" variant="ghost" size="sm" onClick={() => onOpenFilterRuleEditor(index)}>
                        <i className="fas fa-edit" aria-hidden="true" /> 编辑
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => onDeleteRule(index)}>
                        <i className="fas fa-trash" aria-hidden="true" /> 删除
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="点击增强" description="优化列表/详情卡片的点击打开行为">
        <SettingToggleRow
          id="enableClickEnhancement"
          label="启用点击增强"
          description="增强卡片点击：新标签打开、右键后台等"
          checked={form.enableClickEnhancement}
          onChange={(v) => setToggle('enableClickEnhancement', v)}
        />
        {form.enableClickEnhancement ? (
          <div id="clickEnhancementConfig" className="flex flex-col gap-1">
            <SettingToggleRow
              id="enableClickEnhancementList"
              label="列表页生效"
              checked={form.enableClickEnhancementList}
              onChange={(v) => setToggle('enableClickEnhancementList', v)}
            />
            <SettingToggleRow
              id="enableClickEnhancementDetail"
              label="详情相关列表生效"
              checked={form.enableClickEnhancementDetail}
              onChange={(v) => setToggle('enableClickEnhancementDetail', v)}
            />
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="视频预览" description="悬停列表封面播放预览">
        <SettingToggleRow
          id="enableVideoPreview"
          label="启用视频预览"
          description={`延迟：${form.previewDelay} ms`}
          checked={form.enableVideoPreview}
          onChange={(v) => setToggle('enableVideoPreview', v)}
        />
        {form.enableVideoPreview ? (
          <div id="listVideoPreviewConfig" className="flex flex-col gap-2">
            <SettingToggleRow
              id="enableVideoPreviewList"
              label="列表页预览"
              checked={form.enableVideoPreviewList}
              onChange={(v) => setToggle('enableVideoPreviewList', v)}
            />
            <SettingToggleRow
              id="enableVideoPreviewDetail"
              label="详情相关列表预览"
              checked={form.enableVideoPreviewDetail}
              onChange={(v) => setToggle('enableVideoPreviewDetail', v)}
            />
            <SettingField id="previewDelay" label="预览延迟时间 (ms)" description="悬停多久后开始加载预览">
              <Input
                id="previewDelay"
                type="number"
                min={100}
                max={5000}
                value={String(form.previewDelay)}
                onChange={(e) =>
                  patchForm({ previewDelay: parseIntNum(e.target.value, form.previewDelay) })
                }
              />
            </SettingField>
            <div className="form-group volume-control-group">
              <div className="volume-header">
                <label htmlFor="previewVolume">🔊 预览音量</label>
                <span className="volume-percentage">{Math.round(form.previewVolume * 100)}%</span>
              </div>
              <div className="volume-slider-wrapper">
                <input
                  id="previewVolume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={form.previewVolume}
                  className="modern-range"
                  onChange={(e) =>
                    patchForm({ previewVolume: parseNum(e.target.value, form.previewVolume) })
                  }
                />
                <div
                  className="range-track-fill"
                  style={{ width: `${Math.round(form.previewVolume * 100)}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="input-description">预览视频的音量大小，建议保持较低音量。</p>
            </div>
            <SettingField id="previewSourceGroup" label="预览源偏好">
              <SettingSelect
                id="preferredPreviewSource"
                value={form.preferredPreviewSource}
                options={PREVIEW_SOURCE_OPTIONS}
                onChange={(v) =>
                  patchForm({ preferredPreviewSource: v as EnhancementSettingsFormState['preferredPreviewSource'] })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="高清封面" description="始终启用（遗留 always-on）">
        <SettingToggleRow
          id="enableHighQualityCover"
          label="高清封面"
          description="列表封面使用高清资源"
          checked
          disabled
          onChange={() => undefined}
        />
      </SettingSection>

      <SettingSection title="演员水印" description="在列表封面叠加演员名水印">
        <SettingToggleRow
          id="enableActorWatermark"
          label="启用演员水印"
          checked={form.enableActorWatermark}
          onChange={(v) => setToggle('enableActorWatermark', v)}
        />
        {form.enableActorWatermark ? (
          <div id="actorWatermarkConfig" className="flex flex-col gap-2">
            <SettingField id="actorWatermarkPosition" label="水印位置">
              <SettingSelect
                id="actorWatermarkPosition"
                value={form.actorWatermarkPosition}
                options={WATERMARK_POSITION_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    actorWatermarkPosition: v as EnhancementSettingsFormState['actorWatermarkPosition'],
                  })
                }
              />
            </SettingField>
            <div className="form-group volume-control-group">
              <div className="volume-header">
                <label htmlFor="actorWatermarkOpacity">透明度</label>
                <span className="volume-percentage">{Math.round(form.actorWatermarkOpacity * 100)}%</span>
              </div>
              <div className="volume-slider-wrapper">
                <input
                  id="actorWatermarkOpacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.actorWatermarkOpacity}
                  className="modern-range"
                  onChange={(e) =>
                    patchForm({
                      actorWatermarkOpacity: parseNum(e.target.value, form.actorWatermarkOpacity),
                    })
                  }
                />
                <div
                  className="range-track-fill"
                  style={{ width: `${Math.round(form.actorWatermarkOpacity * 100)}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="input-description">自定义水印透明度，以减少视觉干扰。</p>
            </div>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="演员穿透" description="在列表卡片显示女性演员名">
        <SettingToggleRow
          id="enableActorPenetration"
          label="启用演员穿透"
          description="在卡片标题下方显示最多 3 位女性演员"
          checked={form.enableActorPenetration}
          onChange={(v) => setToggle('enableActorPenetration', v)}
        />
        {form.enableActorPenetration ? (
          <div className="flex flex-col gap-1.5">
            <p className="input-description" role="note">
              ✓ 开启后列表卡片将展示详情页解析出的真实演员，「显示设置 → 演员过滤」
              （隐藏未收藏 / 黑名单 / 未识别演员）据此判断，过滤准确性显著提升。
            </p>
            <p className="input-description" role="note">
              ⚠️ 该功能会为可见卡片发起详情页网络请求，并解析 HTML、读写本地缓存，
              会增加列表处理的网络与 CPU 开销。结果缓存 7 天，失败 10 分钟后重试；
              解析失败时卡片保持原状。
            </p>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="列表显示控制" description="列数与容器宽度（始终可用）">
        <SettingToggleRow
          id="enableListDisplayControl"
          label="列表显示控制"
          description="始终开启"
          checked
          disabled
          onChange={() => undefined}
        />
        <div id="listDisplayControlConfig" className="flex flex-col gap-2">
          <SettingField
            id="listColumnCount"
            label={`列数（${form.listColumnCount} 列）`}
            description="设置列表页每行显示的影片数量（1-8列）。"
          >
            <input
              id="listColumnCount"
              type="range"
              min={1}
              max={8}
              step={1}
              value={form.listColumnCount}
              className="modern-range"
              onChange={(e) =>
                patchForm({ listColumnCount: parseIntNum(e.target.value, form.listColumnCount) })
              }
            />
          </SettingField>
          <SettingField
            id="listContainerWidth"
            label={`容器宽度（${form.listContainerWidth}%）`}
            description="设置列表容器的宽度百分比（50%-150%），超过100%时会居中显示。"
          >
            <input
              id="listContainerWidth"
              type="range"
              min={50}
              max={150}
              step={5}
              value={form.listContainerWidth}
              className="modern-range"
              onChange={(e) =>
                patchForm({
                  listContainerWidth: parseIntNum(e.target.value, form.listContainerWidth),
                })
              }
            />
          </SettingField>
          <SettingToggleRow
            id="enableContainerExpansion"
            label="允许容器横向扩展"
            checked={form.enableContainerExpansion}
            onChange={(v) => setToggle('enableContainerExpansion', v)}
          />
        </div>
      </SettingSection>

      <SettingSection title="快捷操作" description="列表卡片上的状态与收藏快捷入口">
        <SettingToggleRow
          id="showStatusBadge"
          label="启用状态标签显示"
          description="在列表卡片显示已看/想看等状态"
          checked={form.showStatusBadge}
          onChange={(v) => setToggle('showStatusBadge', v)}
        />
        <SettingToggleRow
          id="enableStatusQuickAction"
          label="启用状态快捷标识"
          description="在列表上快速切换看过/想看"
          checked={form.enableStatusQuickAction}
          onChange={(v) => setToggle('enableStatusQuickAction', v)}
        />
        <SettingToggleRow
          id="enableListFavoriteQuickAction"
          label="启用收藏快捷按钮"
          description="在列表上快速收藏/取消收藏"
          checked={form.enableListFavoriteQuickAction}
          onChange={(v) => setToggle('enableListFavoriteQuickAction', v)}
        />
      </SettingSection>

      <SettingSection title="资源标签" description="列表卡片上的资源证据标注">
        <SettingToggleRow
          id="resourceTags"
          label="启用资源标签"
          description="在列表卡片标注中字/破解等资源证据"
          checked={form.resourceTags}
          onChange={(v) => setToggle('resourceTags', v)}
        />
      </SettingSection>

    </div>
  );
}

